import { findEncodedCharacterForIds } from './idsUnicodeIndex';

jest.mock('../resources/ids/idsUnicodeIndex.json', () => [
  ['⿰言某', '謀'],
  ['⿰言齒', '𪘙'],
]);

describe('findEncodedCharacterForIds', () => {
  it('finds the assigned character for an exact IDS match', () => {
    expect(findEncodedCharacterForIds('⿰言某')).toBe('謀');
  });

  it('returns null for a structure with no standard decomposition on record', () => {
    expect(findEncodedCharacterForIds('⿰牙齒')).toBeNull();
  });

  it('is exact-match only - a different operator for the same components does not match', () => {
    expect(findEncodedCharacterForIds('⿱言某')).toBeNull();
  });
});
