/**
 * Pure construction of a composed glyph's own KAGE data string from two
 * existing component names and an Ideographic Description Character layout
 * - the "basic component-based KAGE composition" step of the CHHIV glyph
 * composer (see plugins/glyph_maker.md). Deliberately does not do automatic
 * stroke-aware resizing/deformation (that's KAGE/GlyphWiki's own advanced
 * editing territory, explicitly deferred): each operator just places the two
 * components into a fixed, reasonable bounding box within the standard
 * 0-200 KAGE coordinate space, the same space every entry in kageCore.json
 * already uses. No manual drag/resize UI in this first pass either - see the
 * "Geometry editing" section of glyph_maker.md for that later phase.
 *
 * A KAGE "99:" record (component reference) has the shape
 *   99:stretch-h:stretch-v:left:top:right:bottom:name:0:0:0
 * per the format confirmed by direct inspection of the GlyphWiki dump and
 * kage-engine's own README example. `stretch-h`/`stretch-v` of `0` (no
 * stretch) and a plain bounding box is enough for a first, un-deformed
 * placement - kage-engine fits the referenced component's own geometry into
 * that box.
 */

/** All 12 standard Ideographic Description Characters (Phase B,
 * composer-visual-redesign.md §4) - the full Unicode-defined set, not just
 * the binary-operator subset Phase 1 shipped with. */
export type IdsOperator =
  '⿰' | '⿱' | '⿲' | '⿳' | '⿴' | '⿵' | '⿶' | '⿷' | '⿸' | '⿹' | '⿺' | '⿻';

export const IDS_OPERATORS: { operator: IdsOperator; label: string; partCount: 2 | 3 }[] = [
  { operator: '⿰', label: 'Left / right', partCount: 2 },
  { operator: '⿱', label: 'Above / below', partCount: 2 },
  { operator: '⿲', label: 'Left / middle / right', partCount: 3 },
  { operator: '⿳', label: 'Top / middle / bottom', partCount: 3 },
  { operator: '⿴', label: 'Full enclosure', partCount: 2 },
  { operator: '⿵', label: 'Surround from above', partCount: 2 },
  { operator: '⿶', label: 'Surround from below', partCount: 2 },
  { operator: '⿷', label: 'Surround from left', partCount: 2 },
  { operator: '⿸', label: 'Upper-left enclosure', partCount: 2 },
  { operator: '⿹', label: 'Upper-right enclosure', partCount: 2 },
  { operator: '⿺', label: 'Lower-left enclosure', partCount: 2 },
  { operator: '⿻', label: 'Overlap', partCount: 2 },
];

/** How many components an operator describes - 2 for every binary operator,
 * 3 only for ⿲/⿳. Falls back to 2 for anything not in `IDS_OPERATORS`
 * (there is no such value today, but this keeps the function total). */
export const partCountFor = (operator: IdsOperator): 2 | 3 =>
  IDS_OPERATORS.find((o) => o.operator === operator)?.partCount ?? 2;

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const FULL: Box = { left: 0, top: 0, right: 200, bottom: 200 };

/**
 * Default bounding boxes for each component, per operator, in the order
 * `composeKageData`'s `names` array should list them. Not palaeographically
 * tuned, but not arbitrary either: `⿰`/`⿱` are calibrated against real
 * GlyphWiki data (sampled ~6,000-6,600 genuine two-part left/right and
 * above/below compositions each from the bundled compound index) rather
 * than a naive even split - see the doc comment history in git blame for the
 * measurement (a clean half/half split leaves each component visually
 * isolated with its own margins, and since kage-engine doesn't stretch a
 * component to fill its box, stretch-h/stretch-v are `0` below, those two
 * margins stack into a gap that reads as too wide - real compositions
 * overlap by roughly 8-10% of the canvas instead). The remaining operators
 * (added in Phase B) use simple, reasonable geometric defaults in the same
 * spirit as ⿴/⿸/⿹/⿺ already did in Phase 1 - worth the same real-data
 * tuning pass later if visual feedback calls for it, same as ⿰/⿱ got.
 */
const boxesFor = (operator: IdsOperator): Box[] => {
  switch (operator) {
    case '⿰':
      return [
        { left: 0, top: 0, right: 108, bottom: 200 },
        { left: 92, top: 0, right: 200, bottom: 200 },
      ];
    case '⿱':
      return [
        { left: 0, top: 0, right: 200, bottom: 108 },
        { left: 0, top: 92, right: 200, bottom: 200 },
      ];
    case '⿲':
      return [
        { left: 0, top: 0, right: 74, bottom: 200 },
        { left: 63, top: 0, right: 137, bottom: 200 },
        { left: 126, top: 0, right: 200, bottom: 200 },
      ];
    case '⿳':
      return [
        { left: 0, top: 0, right: 200, bottom: 74 },
        { left: 0, top: 63, right: 200, bottom: 137 },
        { left: 0, top: 126, right: 200, bottom: 200 },
      ];
    case '⿴':
      return [FULL, { left: 40, top: 40, right: 160, bottom: 160 }];
    case '⿵':
      return [FULL, { left: 30, top: 60, right: 170, bottom: 200 }];
    case '⿶':
      return [FULL, { left: 30, top: 0, right: 170, bottom: 140 }];
    case '⿷':
      return [FULL, { left: 60, top: 30, right: 200, bottom: 170 }];
    case '⿸':
      return [FULL, { left: 60, top: 60, right: 200, bottom: 200 }];
    case '⿹':
      return [FULL, { left: 0, top: 60, right: 140, bottom: 200 }];
    case '⿺':
      return [FULL, { left: 60, top: 0, right: 200, bottom: 140 }];
    case '⿻':
      return [FULL, FULL];
    default:
      return [
        { left: 0, top: 0, right: 100, bottom: 200 },
        { left: 100, top: 0, right: 200, bottom: 200 },
      ];
  }
};

const componentRecord = (box: Box, name: string): string =>
  `99:0:0:${box.left}:${box.top}:${box.right}:${box.bottom}:${name}:0:0:0`;

/** Builds the new glyph's own KAGE data - a `$`-joined list of "99:" records
 * referencing `names` in order (2 names for a binary operator, 3 for ⿲/⿳ -
 * see `partCountFor`), each of which must already be resolvable (either in
 * the bundled kageCore.json or in an already-composed project glyph's own
 * KAGE data) for kage-engine to render the result. */
export const composeKageData = (operator: IdsOperator, names: string[]): string => {
  const boxes = boxesFor(operator);
  return names
    .map((name, i) => componentRecord(boxes[i] ?? boxes[boxes.length - 1], name))
    .join('$');
};

const BARE_UNICODE_NAME_RE = /^u([0-9a-f]{4,6})$/i;

/**
 * The literal Unicode character a KAGE lookup name canonically corresponds
 * to, or `null` if it doesn't. Only a *bare* "u<hex>" name qualifies -
 * GlyphWiki's own convention for "this entry is that Unicode character
 * itself", not a suffixed variant/gaiji name (e.g. "u5927-04" is a
 * particular drawn form, not the character u5927 itself). This is Route A
 * from plugins/glyph_maker.md: "if the required character exists in
 * Unicode... no gaiji object is necessary" - used to tell a GlyphWiki
 * candidate that already IS an ordinary encoded character (insert the plain
 * character, no SVG/registry entry at all) apart from one that merely
 * combines two components into a new, still-unencoded gaiji.
 */
export const canonicalUnicodeChar = (name: string): string | null => {
  const match = BARE_UNICODE_NAME_RE.exec(name);
  return match ? String.fromCodePoint(parseInt(match[1], 16)) : null;
};

/** A KAGE lookup name's display form for the IDS string: the literal
 * character for a bare "u<hex>" name (e.g. "u8a00" -> "言"), or the name
 * itself for anything else (a project glyph id, a suffixed GlyphWiki
 * variant name, ...), since those have no single character to show. */
export const displayNameFor = (name: string): string => canonicalUnicodeChar(name) ?? name;

/** The IDS string for the composition, e.g. "⿰言某" - stored as the
 * `<mapping type="ids">` value per the agreed `<charDecl><glyph>` schema. */
export const composeIds = (operator: IdsOperator, names: string[]): string =>
  `${operator}${names.map(displayNameFor).join('')}`;

const parseBox = (record: string): Box => {
  const fields = record.split(':');
  return {
    left: Number(fields[3]),
    top: Number(fields[4]),
    right: Number(fields[5]),
    bottom: Number(fields[6]),
  };
};

const area = (box: Box): number =>
  Math.max(0, box.right - box.left) * Math.max(0, box.bottom - box.top);

const overlapArea = (a: Box, b: Box): number => {
  const width = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
  const height = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  return width * height;
};

/**
 * Best-effort guess at which IDS operator an *existing* two-part KAGE
 * composition (e.g. a GlyphWiki-adopted candidate, whose real geometry the
 * composer didn't produce) most resembles - informational only, since IDS
 * here is "semantic/search metadata, not a rendering instruction" (see
 * composeIds above); a wrong guess mislabels the operator shown in the UI,
 * it doesn't affect rendering. Not used for anything the composer itself
 * produces (that always knows its own operator already).
 */
export const guessOperatorFromKageData = (kageData: string): IdsOperator => {
  const records = kageData.split('$');
  if (records.length !== 2) return '⿻';
  const [a, b] = records.map(parseBox);

  const smaller = area(a) < area(b) ? a : b;
  const larger = area(a) < area(b) ? b : a;
  if (
    area(larger) > 0 &&
    overlapArea(larger, smaller) / area(smaller) > 0.9 &&
    area(smaller) / area(larger) < 0.7
  ) {
    return '⿴';
  }
  if (overlapArea(a, b) / Math.min(area(a) || 1, area(b) || 1) > 0.7) return '⿻';

  const centerA = { x: (a.left + a.right) / 2, y: (a.top + a.bottom) / 2 };
  const centerB = { x: (b.left + b.right) / 2, y: (b.top + b.bottom) / 2 };
  const dx = Math.abs(centerA.x - centerB.x);
  const dy = Math.abs(centerA.y - centerB.y);
  return dx >= dy ? '⿰' : '⿱';
};
