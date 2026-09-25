import { findGlyphwikiCandidates } from './glyphwikiIndex';

jest.mock('../resources/glyphwiki/glyphwikiCompoundIndex.json', () => [
  ['gw-entry-1', '99:...$99:...', 'u8a00', 'u67d0'],
  ['gw-entry-2', '99:...$99:...', 'u67d0', 'u8a00'],
  ['gw-entry-3', '99:...$99:...', 'u4e00', 'u4e8c'],
]);

describe('findGlyphwikiCandidates', () => {
  it('finds candidates regardless of which component is passed first', () => {
    expect(findGlyphwikiCandidates('u8a00', 'u67d0')).toHaveLength(2);
    expect(findGlyphwikiCandidates('u67d0', 'u8a00')).toHaveLength(2);
  });

  it('returns an empty array for a pair with no candidates', () => {
    expect(findGlyphwikiCandidates('u8a00', 'u4e00')).toEqual([]);
  });

  it('finds a different pair independently', () => {
    const results = findGlyphwikiCandidates('u4e00', 'u4e8c');
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('gw-entry-3');
  });
});
