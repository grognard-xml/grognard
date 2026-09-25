import {
  canonicalUnicodeChar,
  composeIds,
  composeKageData,
  displayNameFor,
  guessOperatorFromKageData,
  IDS_OPERATORS,
} from './kageCompose';

describe('composeKageData', () => {
  it('produces two 99: records referencing the given component names', () => {
    const data = composeKageData('⿰', 'u8a00', 'u67d0');
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

  it('gives every operator a left-right-swapped or stacked non-overlapping box for the two-part layout', () => {
    for (const { operator } of IDS_OPERATORS) {
      const data = composeKageData(operator, 'a', 'b');
      const [first, second] = data.split('$').map((r) => r.split(':').map(Number));
      // fields: [99, stretchH, stretchV, left, top, right, bottom, ...]
      expect(first[3]).toBeLessThan(first[5]); // left < right
      expect(first[4]).toBeLessThan(first[6]); // top < bottom
      expect(second[3]).toBeLessThan(second[5]);
      expect(second[4]).toBeLessThan(second[6]);
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
    expect(composeIds('⿰', 'u8a00', 'chhiv-0003')).toBe('⿰言chhiv-0003');
  });
});

describe('guessOperatorFromKageData', () => {
  it('recognizes its own left/right and above/below compositions round-trip', () => {
    expect(guessOperatorFromKageData(composeKageData('⿰', 'a', 'b'))).toBe('⿰');
    expect(guessOperatorFromKageData(composeKageData('⿱', 'a', 'b'))).toBe('⿱');
  });

  it('recognizes a full enclosure (one box mostly containing a much smaller one)', () => {
    expect(guessOperatorFromKageData(composeKageData('⿴', 'a', 'b'))).toBe('⿴');
  });

  it('recognizes near-total overlap as ⿻', () => {
    expect(guessOperatorFromKageData(composeKageData('⿻', 'a', 'b'))).toBe('⿻');
  });

  it('falls back to ⿻ for anything that is not a two-record composition', () => {
    expect(guessOperatorFromKageData('1:0:0:0:0:200:200')).toBe('⿻');
  });
});
