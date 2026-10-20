import { findEncodedCharacterForIds } from './idsUnicodeIndex';

jest.mock('../resources/ids/idsUnicodeIndex.json', () => [
  ['⿰言某', '謀'],
  ['⿰言齒', '𪘙'],
  ['⿰業刂', '𠟪'],
  ['⿰氵甲', '一'],
  ['⿰水甲', '二'],
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

  it('matches across the forms of a radical', () => {
    expect(findEncodedCharacterForIds('⿰業刀')).toBe('𠟪');
    expect(findEncodedCharacterForIds('⿰訁某')).toBe('謀');
  });

  it('prefers an exact match over a radical-form match', () => {
    expect(findEncodedCharacterForIds('⿰氵甲')).toBe('一');
    expect(findEncodedCharacterForIds('⿰水甲')).toBe('二');
  });

  it('gives no answer when radical forms would match two different characters', () => {
    expect(findEncodedCharacterForIds('⿰⺡甲')).toBeNull();
  });
});
