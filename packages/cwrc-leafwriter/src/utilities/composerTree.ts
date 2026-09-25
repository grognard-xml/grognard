import { partCountFor, type IdsOperator } from './kageCompose';

/**
 * Phase D (plugins/composer-visual-redesign.md §4): the composer's state as
 * a small tree instead of a flat pair of strings, so a component slot can
 * itself be "not yet resolved - compose it" inline, to arbitrary depth,
 * instead of requiring a save-then-reopen round trip through a saved
 * project glyph id (which still works, and is exactly what a `leaf` slot
 * holding an id does under the hood).
 *
 * `parts` (Phase B, composer-visual-redesign.md §4) is a variable-length
 * array rather than fixed `first`/`second` fields, because ⿲/⿳ describe
 * three components, not two - see `partCountFor`. `parts.length` must equal
 * `partCountFor(operator)`; `resizePartsForOperator` is the one place that
 * invariant is enforced when the operator changes.
 */
export type ComposerSlot =
  | { kind: 'leaf'; input: string }
  | { kind: 'nested'; operator: IdsOperator; parts: ComposerSlot[] };

export const emptyLeafSlot = (): ComposerSlot => ({ kind: 'leaf', input: '' });

/** A slot is "filled" when every leaf beneath it has non-empty input -
 * used to gate the live preview/save the same way the old flat two-string
 * check did (`firstInput.trim() && secondInput.trim()`). */
export const isSlotFilled = (slot: ComposerSlot): boolean =>
  slot.kind === 'leaf' ? slot.input.trim().length > 0 : slot.parts.every(isSlotFilled);

/**
 * Adjusts a `parts` array to the length the (possibly just-changed)
 * `operator` requires: keeps existing slots for indices that still exist,
 * and pads with fresh empty leaves for any new ones (e.g. switching a
 * binary operator to ⿲/⿳ adds a third, empty slot instead of discarding the
 * two the scholar already filled in). Truncates, dropping the extra
 * slot(s), when switching the other way.
 */
export const resizePartsForOperator = (
  operator: IdsOperator,
  parts: ComposerSlot[],
): ComposerSlot[] => {
  const targetCount = partCountFor(operator);
  if (parts.length === targetCount) return parts;
  if (parts.length > targetCount) return parts.slice(0, targetCount);
  return [...parts, ...Array.from({ length: targetCount - parts.length }, emptyLeafSlot)];
};

const PART_LABELS = ['First component', 'Second component', 'Third component'];

/** A human label for the part at `index`. Covers every part count Phase B
 * introduced (2 or 3); a fourth part would need a fourth label, but no
 * standard IDS operator describes more than three. The layout square uses
 * position names ("Left", "Above") instead; this stays for anything that
 * still wants first/second/third. */
export const labelForPart = (index: number): string =>
  PART_LABELS[index] ?? `Component ${index + 1}`;

/** A slot the scholar has put something in: a leaf with text, or a nested
 * layout that contains one. An empty nested layout (all blank fields) does
 * not count — removing it throws nothing away. */
export const slotHasContent = (slot: ComposerSlot): boolean =>
  slot.kind === 'leaf' ? slot.input.trim().length > 0 : slot.parts.some(slotHasContent);

/**
 * Remove a nested layout and go back to one slot.
 * - Nothing typed underneath: an empty field.
 * - Exactly one part has anything in it: keep that part (a typed character,
 *   or a whole deeper layout). The other empty fields are dropped.
 * - Two or more parts have something in them: refuse. The caller tells the
 *   scholar to clear the extras first, rather than silently deleting work.
 */
export const flattenNestedSlot = (
  slot: ComposerSlot,
): { ok: true; slot: ComposerSlot } | { ok: false } => {
  if (slot.kind !== 'nested') return { ok: true, slot };
  const occupied = slot.parts.filter(slotHasContent);
  if (occupied.length > 1) return { ok: false };
  return { ok: true, slot: occupied[0] ?? emptyLeafSlot() };
};

/** The IDS string as the scholar is typing it. An empty field is `?`, so
 * the result column can show `⿰木?` before every box is filled. This is
 * display only — the saved mapping still comes from `composeIds`. */
export const draftIds = (operator: IdsOperator, parts: ComposerSlot[]): string =>
  `${operator}${parts
    .map((part) =>
      part.kind === 'leaf' ? part.input.trim() || '?' : draftIds(part.operator, part.parts),
    )
    .join('')}`;

/** `[]` is the outer layout. `[1, 0]` is the first box inside the second
 * top-level box. Returns null if the path doesn't land on a slot. */
export const slotAt = (parts: ComposerSlot[], path: number[]): ComposerSlot | null => {
  if (path.length === 0) return null;
  let current: ComposerSlot | undefined = parts[path[0]];
  for (let i = 1; i < path.length && current; i += 1) {
    if (current.kind !== 'nested') return null;
    current = current.parts[path[i]];
  }
  return current ?? null;
};

export const replaceSlotAt = (
  parts: ComposerSlot[],
  path: number[],
  next: ComposerSlot,
): ComposerSlot[] => {
  if (path.length === 0) return parts;
  const [head, ...rest] = path;
  return parts.map((part, index) => {
    if (index !== head) return part;
    if (rest.length === 0) return next;
    if (part.kind !== 'nested') return part;
    return { ...part, parts: replaceSlotAt(part.parts, rest, next) };
  });
};

/**
 * What a palette click does to the selected region (Phase C).
 * - The outer square: change its layout, keeping characters already typed.
 * - A single field: turn that field into a layout of the chosen shape.
 *   Text already in the field moves into the first box of the new layout.
 * - A layout that is itself inside a box: change that layout's shape.
 */
export const applyPaletteOperator = (
  rootOperator: IdsOperator,
  parts: ComposerSlot[],
  selection: number[],
  next: IdsOperator,
): { operator: IdsOperator; parts: ComposerSlot[] } => {
  if (selection.length === 0) {
    return { operator: next, parts: resizePartsForOperator(next, parts) };
  }
  const target = slotAt(parts, selection);
  if (!target) return { operator: rootOperator, parts };
  if (target.kind === 'leaf') {
    const nestedParts = Array.from({ length: partCountFor(next) }, emptyLeafSlot);
    if (target.input.trim()) nestedParts[0] = { kind: 'leaf', input: target.input };
    return {
      operator: rootOperator,
      parts: replaceSlotAt(parts, selection, {
        kind: 'nested',
        operator: next,
        parts: nestedParts,
      }),
    };
  }
  return {
    operator: rootOperator,
    parts: replaceSlotAt(parts, selection, {
      ...target,
      operator: next,
      parts: resizePartsForOperator(next, target.parts),
    }),
  };
};
