import { findEncodedCharacterForIds } from './idsUnicodeIndex';

/**
 * Exercises the actual bundled idsUnicodeIndex.json (no mock) against the
 * exact examples validated live against zi.tools on 2026-09-25 (see
 * plugins/composer-visual-redesign.md §1/§3) - a regression test for the
 * real shipped artifact, not just the lookup logic.
 */
describe('findEncodedCharacterForIds (real bundled data)', () => {
  it('matches the live zi.tools result for ⿰言某', () => {
    expect(findEncodedCharacterForIds('⿰言某')).toBe('謀');
  });

  it('matches the live zi.tools result for ⿰言齒', () => {
    expect(findEncodedCharacterForIds('⿰言齒')).toBe('𪘙');
  });

  it('correctly does not match ⿰牙齒 (confirmed on zi.tools as GlyphWiki-only, not standard Unicode)', () => {
    expect(findEncodedCharacterForIds('⿰牙齒')).toBeNull();
  });
});
