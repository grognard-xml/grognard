import {
  applyPaletteOperator,
  draftIds,
  emptyLeafSlot,
  flattenNestedSlot,
  isSlotFilled,
  resizePartsForOperator,
  type ComposerSlot,
} from './composerTree';

describe('isSlotFilled', () => {
  it('is false for an empty leaf', () => {
    expect(isSlotFilled(emptyLeafSlot())).toBe(false);
  });

  it('is true for a leaf with input', () => {
    expect(isSlotFilled({ kind: 'leaf', input: '言' })).toBe(true);
  });

  it('is true for a nested slot only when every part is filled', () => {
    const partial: ComposerSlot = {
      kind: 'nested',
      operator: '⿱',
      parts: [{ kind: 'leaf', input: '攴' }, emptyLeafSlot()],
    };
    expect(isSlotFilled(partial)).toBe(false);

    const full: ComposerSlot = {
      ...partial,
      parts: [partial.parts[0], { kind: 'leaf', input: '女' }],
    };
    expect(isSlotFilled(full)).toBe(true);
  });

  it('checks all three parts of a three-part operator', () => {
    const threePartMissingMiddle: ComposerSlot = {
      kind: 'nested',
      operator: '⿲',
      parts: [{ kind: 'leaf', input: '一' }, emptyLeafSlot(), { kind: 'leaf', input: '三' }],
    };
    expect(isSlotFilled(threePartMissingMiddle)).toBe(false);

    const threePartFull: ComposerSlot = {
      ...threePartMissingMiddle,
      parts: [
        threePartMissingMiddle.parts[0],
        { kind: 'leaf', input: '二' },
        threePartMissingMiddle.parts[2],
      ],
    };
    expect(isSlotFilled(threePartFull)).toBe(true);
  });

  it('recurses through arbitrarily deep nesting', () => {
    const deep: ComposerSlot = {
      kind: 'nested',
      operator: '⿰',
      parts: [
        { kind: 'leaf', input: '言' },
        {
          kind: 'nested',
          operator: '⿱',
          parts: [{ kind: 'leaf', input: '攴' }, emptyLeafSlot()],
        },
      ],
    };
    expect(isSlotFilled(deep)).toBe(false);
  });
});

describe('resizePartsForOperator', () => {
  it('leaves the array unchanged when switching between two binary operators', () => {
    const parts: ComposerSlot[] = [{ kind: 'leaf', input: '言' }, emptyLeafSlot()];
    expect(resizePartsForOperator('⿱', parts)).toBe(parts); // same reference, no new array needed
  });

  it('pads with a fresh empty leaf when switching from a binary to a three-part operator', () => {
    const parts: ComposerSlot[] = [
      { kind: 'leaf', input: '一' },
      { kind: 'leaf', input: '二' },
    ];
    const resized = resizePartsForOperator('⿲', parts);
    expect(resized).toHaveLength(3);
    expect(resized[0]).toBe(parts[0]);
    expect(resized[1]).toBe(parts[1]);
    expect(resized[2]).toEqual(emptyLeafSlot());
  });

  it('truncates, dropping the extra slot, when switching from a three-part operator back to binary', () => {
    const parts: ComposerSlot[] = [
      { kind: 'leaf', input: '一' },
      { kind: 'leaf', input: '二' },
      { kind: 'leaf', input: '三' },
    ];
    const resized = resizePartsForOperator('⿰', parts);
    expect(resized).toEqual([
      { kind: 'leaf', input: '一' },
      { kind: 'leaf', input: '二' },
    ]);
  });
});

describe('draftIds', () => {
  it('uses ? for an empty field and nests inner layouts', () => {
    const parts: ComposerSlot[] = [
      { kind: 'leaf', input: '木' },
      {
        kind: 'nested',
        operator: '⿱',
        parts: [emptyLeafSlot(), emptyLeafSlot()],
      },
      emptyLeafSlot(),
    ];
    expect(draftIds('⿲', parts)).toBe('⿲木⿱???');
  });
});

describe('applyPaletteOperator', () => {
  const binary: ComposerSlot[] = [{ kind: 'leaf', input: '木' }, emptyLeafSlot()];

  it('changes the outer layout when the square itself is selected', () => {
    const next = applyPaletteOperator('⿱', binary, [], '⿲');
    expect(next.operator).toBe('⿲');
    expect(next.parts).toHaveLength(3);
    expect(next.parts[0]).toEqual({ kind: 'leaf', input: '木' });
  });

  it('turns the selected field into a layout and keeps what was typed there', () => {
    const next = applyPaletteOperator('⿰', binary, [0], '⿱');
    expect(next.operator).toBe('⿰');
    expect(next.parts[0]).toEqual({
      kind: 'nested',
      operator: '⿱',
      parts: [{ kind: 'leaf', input: '木' }, emptyLeafSlot()],
    });
    expect(next.parts[1]).toEqual(emptyLeafSlot());
  });

  it('changes a selected inner layout instead of the outer one', () => {
    const nested = applyPaletteOperator('⿰', binary, [1], '⿱');
    const changed = applyPaletteOperator('⿰', nested.parts, [1], '⿴');
    expect(changed.operator).toBe('⿰');
    expect(changed.parts[1]).toMatchObject({ kind: 'nested', operator: '⿴' });
    expect(changed.parts[0]).toEqual({ kind: 'leaf', input: '木' });
  });
});

describe('flattenNestedSlot', () => {
  it('drops an empty layout', () => {
    expect(
      flattenNestedSlot({
        kind: 'nested',
        operator: '⿰',
        parts: [emptyLeafSlot(), emptyLeafSlot()],
      }),
    ).toEqual({ ok: true, slot: emptyLeafSlot() });
  });

  it('keeps the one part that has something in it', () => {
    expect(
      flattenNestedSlot({
        kind: 'nested',
        operator: '⿱',
        parts: [{ kind: 'leaf', input: '木' }, emptyLeafSlot()],
      }),
    ).toEqual({ ok: true, slot: { kind: 'leaf', input: '木' } });
  });

  it('refuses when more than one part has something in it', () => {
    expect(
      flattenNestedSlot({
        kind: 'nested',
        operator: '⿰',
        parts: [
          { kind: 'leaf', input: '木' },
          { kind: 'leaf', input: '口' },
        ],
      }),
    ).toEqual({ ok: false });
  });
});
