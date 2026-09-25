import type { IdsOperator } from './kageCompose';

/**
 * Phase D (plugins/composer-visual-redesign.md §4): the composer's state as
 * a small tree instead of a flat pair of strings, so a component slot can
 * itself be "not yet resolved - compose it" inline, to arbitrary depth,
 * instead of requiring a save-then-reopen round trip through a saved
 * project glyph id (which still works, and is exactly what a `leaf` slot
 * holding an id does under the hood).
 */
export type ComposerSlot =
  | { kind: 'leaf'; input: string }
  | { kind: 'nested'; operator: IdsOperator; first: ComposerSlot; second: ComposerSlot };

export const emptyLeafSlot = (): ComposerSlot => ({ kind: 'leaf', input: '' });

/** A slot is "filled" when every leaf beneath it has non-empty input -
 * used to gate the live preview/save the same way the old flat two-string
 * check did (`firstInput.trim() && secondInput.trim()`). */
export const isSlotFilled = (slot: ComposerSlot): boolean =>
  slot.kind === 'leaf'
    ? slot.input.trim().length > 0
    : isSlotFilled(slot.first) && isSlotFilled(slot.second);
