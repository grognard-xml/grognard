import { emptyLeafSlot, isSlotFilled, type ComposerSlot } from './composerTree';

describe('isSlotFilled', () => {
  it('is false for an empty leaf', () => {
    expect(isSlotFilled(emptyLeafSlot())).toBe(false);
  });

  it('is true for a leaf with input', () => {
    expect(isSlotFilled({ kind: 'leaf', input: '言' })).toBe(true);
  });

  it('is true for a nested slot only when both children are filled', () => {
    const partial: ComposerSlot = {
      kind: 'nested',
      operator: '⿱',
      first: { kind: 'leaf', input: '攴' },
      second: emptyLeafSlot(),
    };
    expect(isSlotFilled(partial)).toBe(false);

    const full: ComposerSlot = { ...partial, second: { kind: 'leaf', input: '女' } };
    expect(isSlotFilled(full)).toBe(true);
  });

  it('recurses through arbitrarily deep nesting', () => {
    const deep: ComposerSlot = {
      kind: 'nested',
      operator: '⿰',
      first: { kind: 'leaf', input: '言' },
      second: {
        kind: 'nested',
        operator: '⿱',
        first: { kind: 'leaf', input: '攴' },
        second: emptyLeafSlot(),
      },
    };
    expect(isSlotFilled(deep)).toBe(false);
  });
});
