import {
  ALLOWED_PARENTS,
  buildParentOfIndex,
  tryParentOfTranslation,
} from './proceduralParentOfGloss';

describe('proceduralParentOfGloss', () => {
  const relationsNdjson = [
    JSON.stringify({
      type: 'parentOf',
      id: 'norbert:parent:1:2',
      evidence: { labels: ['太子', '太子右庶子'] },
    }),
    JSON.stringify({
      type: 'parentOf',
      id: 'norbert:parent:3:4',
      evidence: { labels: ['尚書', '尚書令史'] },
    }),
  ].join('\n');

  it('indexes only allowlisted parents', () => {
    const index = buildParentOfIndex(relationsNdjson);
    expect(index.get('太子右庶子')).toEqual(
      expect.objectContaining({ parent: '太子', child: '太子右庶子' }),
    );
    // 尚書 is not on ALLOWED_PARENTS — no edge indexed for it.
    expect(index.has('尚書令史')).toBe(false);
    expect(ALLOWED_PARENTS.has('尚書')).toBe(false);
  });

  it('composes "{remainder} of the {parent}" when the remainder already has a gloss', () => {
    const index = buildParentOfIndex(relationsNdjson);
    const result = tryParentOfTranslation('太子右庶子', index, (remainder) => {
      expect(remainder).toBe('右庶子');
      return { en: 'Right Serviceman', fr: 'serviteur de droite' };
    });
    expect(result?.en).toBe('Right Serviceman of the Heir Apparent');
    expect(result?.fr).toBe("serviteur de droite de l'héritier du trône");
    expect(result?.parent).toBe('太子');
    expect(result?.remainder).toBe('右庶子');
  });

  it('returns null when the remainder has no gloss in either language', () => {
    const index = buildParentOfIndex(relationsNdjson);
    const result = tryParentOfTranslation('太子右庶子', index, () => ({}));
    expect(result).toBeNull();
  });

  it('builds English only when only English is resolved', () => {
    const index = buildParentOfIndex(relationsNdjson);
    const result = tryParentOfTranslation('太子右庶子', index, () => ({ en: 'Right Serviceman' }));
    expect(result?.en).toBe('Right Serviceman of the Heir Apparent');
    expect(result?.fr).toBeUndefined();
  });

  it('returns null for a name with no parentOf edge', () => {
    const index = buildParentOfIndex(relationsNdjson);
    expect(tryParentOfTranslation('豫章太守', index, () => ({ en: 'x', fr: 'y' }))).toBeNull();
  });

  it('avoids double-embedding the parent phrase', () => {
    const index = buildParentOfIndex(relationsNdjson);
    const result = tryParentOfTranslation('太子右庶子', index, () => ({
      en: 'Right Serviceman of the Heir Apparent',
      fr: undefined,
    }));
    expect(result).toBeNull();
  });
});
