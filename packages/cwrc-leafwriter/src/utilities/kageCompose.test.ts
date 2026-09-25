import {
  canonicalUnicodeChar,
  composeIds,
  composeKageData,
  displayNameFor,
  guessOperatorFromKageData,
  IDS_OPERATORS,
  partCountFor,
} from './kageCompose';

describe('composeKageData', () => {
  it('produces two 99: records referencing the given component names for a binary operator', () => {
    const data = composeKageData('⿰', ['u8a00', 'u67d0']);
    const records = data.split('$');
    expect(records).toHaveLength(2);
    for (const record of records) {
      const fields = record.split(':');
      expect(fields[0]).toBe('99');
      expect(fields).toHaveLength(11);
    }
    expect(records[0]).toContain(':u8a00:');
    expect(records[1]).toContain(':u67d0:');
  });

  it('produces three 99: records for a three-part operator (⿲/⿳)', () => {
    for (const operator of ['⿲', '⿳'] as const) {
      const data = composeKageData(operator, ['a', 'b', 'c']);
      const records = data.split('$');
      expect(records).toHaveLength(3);
      expect(records[0]).toContain(':a:');
      expect(records[1]).toContain(':b:');
      expect(records[2]).toContain(':c:');
    }
  });

  it('gives every operator a valid (left < right, top < bottom) box for each of its parts', () => {
    for (const { operator, partCount } of IDS_OPERATORS) {
      const names = Array.from({ length: partCount }, (_, i) => `part${i}`);
      const data = composeKageData(operator, names);
      const records = data.split('$').map((r) => r.split(':').map(Number));
      expect(records).toHaveLength(partCount);
      for (const fields of records) {
        expect(fields[3]).toBeLessThan(fields[5]); // left < right
        expect(fields[4]).toBeLessThan(fields[6]); // top < bottom
      }
    }
  });
});

describe('partCountFor', () => {
  it('is 3 for the two three-part operators', () => {
    expect(partCountFor('⿲')).toBe(3);
    expect(partCountFor('⿳')).toBe(3);
  });

  it('is 2 for every other operator', () => {
    for (const { operator, partCount } of IDS_OPERATORS) {
      if (operator === '⿲' || operator === '⿳') continue;
      expect(partCount).toBe(2);
      expect(partCountFor(operator)).toBe(2);
    }
  });
});

describe('canonicalUnicodeChar', () => {
  it('returns the literal character for a bare u<hex> name', () => {
    expect(canonicalUnicodeChar('u8a00')).toBe('言');
  });

  it('returns null for a suffixed GlyphWiki variant name (not the character itself)', () => {
    expect(canonicalUnicodeChar('u5927-04')).toBeNull();
  });

  it('returns null for a project glyph id or any other non-canonical name', () => {
    expect(canonicalUnicodeChar('chhiv-0017')).toBeNull();
    expect(canonicalUnicodeChar('ebag_kxr-00271')).toBeNull();
  });
});

describe('displayNameFor', () => {
  it('converts a bare u<hex> name to its literal character', () => {
    expect(displayNameFor('u8a00')).toBe('言');
  });

  it('leaves a non-bare name (project glyph id, suffixed variant) unchanged', () => {
    expect(displayNameFor('chhiv-0017')).toBe('chhiv-0017');
    expect(displayNameFor('u5927-04')).toBe('u5927-04');
  });
});

describe('composeIds', () => {
  it('builds an IDS string using literal characters where available', () => {
    expect(composeIds('⿰', ['u8a00', 'chhiv-0003'])).toBe('⿰言chhiv-0003');
  });

  it('builds a three-part IDS string in order', () => {
    expect(composeIds('⿲', ['u4e00', 'u4e8c', 'u4e09'])).toBe('⿲一二三');
  });
});

describe('guessOperatorFromKageData', () => {
  it('recognizes its own left/right and above/below compositions round-trip', () => {
    expect(guessOperatorFromKageData(composeKageData('⿰', ['a', 'b']))).toBe('⿰');
    expect(guessOperatorFromKageData(composeKageData('⿱', ['a', 'b']))).toBe('⿱');
  });

  it('recognizes a full enclosure (one box mostly containing a much smaller one)', () => {
    expect(guessOperatorFromKageData(composeKageData('⿴', ['a', 'b']))).toBe('⿴');
  });

  it('recognizes near-total overlap as ⿻', () => {
    expect(guessOperatorFromKageData(composeKageData('⿻', ['a', 'b']))).toBe('⿻');
  });

  it('falls back to ⿻ for anything that is not a two-record composition', () => {
    expect(guessOperatorFromKageData('1:0:0:0:0:200:200')).toBe('⿻');
  });
});
