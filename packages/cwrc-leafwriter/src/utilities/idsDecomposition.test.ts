import { parseIdsToComposerTree } from './composerTree';
import { findIdsDecompositions } from './idsUnicodeIndex';

describe('findIdsDecompositions (real bundled data)', () => {
  it('breaks 謀 into 言 and 某', () => {
    expect(findIdsDecompositions('謀')).toEqual(['⿰言某']);
  });

  it('returns every recorded way when there are several', () => {
    expect(findIdsDecompositions('丟')).toEqual(['⿱王厶', '⿱一去']);
  });

  it('does not break an atomic character, an unknown one or non-characters', () => {
    expect(findIdsDecompositions('一')).toEqual([]);
    expect(findIdsDecompositions('木')).toEqual([]);
    expect(findIdsDecompositions('a')).toEqual([]);
    expect(findIdsDecompositions('')).toEqual([]);
    expect(findIdsDecompositions('   ')).toEqual([]);
  });

  it('drops a leftover regional tag in the data', () => {
    expect(findIdsDecompositions('𪫉')).toEqual(['⿰⿳日亠早彡', '⿰彦彡']);
  });

  it('breaks apart characters from Ext G, H and I', () => {
    expect(findIdsDecompositions('\u{30000}')).toEqual(['⿱一𠄌']);
    expect(findIdsDecompositions('\u{2EBF1}')).toEqual(['⿵丹丶']);
    expect(findIdsDecompositions('\u{31350}').length).toBeGreaterThan(0);
  });

  it('uses only the first character of the input', () => {
    expect(findIdsDecompositions('謀木')).toEqual(['⿰言某']);
    expect(findIdsDecompositions('𠀀謀')).toEqual(findIdsDecompositions('𠀀'));
  });
});

describe('parseIdsToComposerTree', () => {
  it('parses a flat two-part IDS', () => {
    expect(parseIdsToComposerTree('⿰言某')).toEqual({
      operator: '⿰',
      parts: [
        { kind: 'leaf', input: '言' },
        { kind: 'leaf', input: '某' },
      ],
      unencodedCount: 0,
    });
  });

  it('nests where the IDS nests', () => {
    expect(parseIdsToComposerTree('⿱一⿰丿丨')).toEqual({
      operator: '⿱',
      parts: [
        { kind: 'leaf', input: '一' },
        {
          kind: 'nested',
          operator: '⿰',
          parts: [
            { kind: 'leaf', input: '丿' },
            { kind: 'leaf', input: '丨' },
          ],
        },
      ],
      unencodedCount: 0,
    });
  });

  it('reads three-part operators', () => {
    const parsed = parseIdsToComposerTree('⿲彳亍丨');
    expect(parsed?.parts).toHaveLength(3);
  });

  it('leaves unencoded components empty and counts them', () => {
    const parsed = parseIdsToComposerTree('⿹②一');
    expect(parsed?.parts).toEqual([
      { kind: 'leaf', input: '' },
      { kind: 'leaf', input: '一' },
    ]);
    expect(parsed?.unencodedCount).toBe(1);
  });

  it('refuses malformed input and bare characters', () => {
    expect(parseIdsToComposerTree('言')).toBeNull();
    expect(parseIdsToComposerTree('⿰言')).toBeNull();
    expect(parseIdsToComposerTree('⿰言某木')).toBeNull();
    expect(parseIdsToComposerTree('')).toBeNull();
  });

  it('parses every decomposition the data holds for 丟, 万 and 丝', () => {
    for (const char of ['丟', '万', '丝']) {
      for (const ids of findIdsDecompositions(char)) {
        expect(parseIdsToComposerTree(ids)).not.toBeNull();
      }
    }
  });
});
