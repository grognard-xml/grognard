import {
  applyHuckbotGlossToCandidate,
  applyHuckbotGlossToPackRow,
  applyMaxiRicciGlossToCandidate,
  buildHuckbotGlossIndex,
  buildMaxiRicciGlossIndex,
  cleanPublishableOfficeGloss,
  formatOfficeClue,
  HUCKBOT_PROCEDURAL_SOURCE,
  MAXIRICCI_PROCEDURAL_SOURCE,
  officeGlossLookupKeys,
  persistOfficeTranslationNames,
} from './officeGlossLookup';
import type { AuthorityCandidate } from './authority';
import type { EntityStore } from './entityStore';

describe('officeGlossLookup', () => {
  const glossNdjson = [
    JSON.stringify({
      source: 'Huckbot5000',
      kind: 'office',
      zh: '州縣長吏',
      dynasty: '宋',
      translation: 'Senior Subalterns of the Prefecture or District',
      officeIds: ['cbdb:office:987'],
    }),
    JSON.stringify({
      source: 'Huckbot5000',
      kind: 'office',
      zh: '太守',
      dynasty: '漢',
      translation: 'Governor',
      officeIds: ['norbert:office:42'],
    }),
  ].join('\n');

  const frenchNdjson = [
    JSON.stringify({
      source: 'MaxiRicci7000',
      kind: 'office',
      language: 'fr',
      zh: '州縣長吏',
      dynasty: '宋',
      translation: 'subalternes seniors de la préfecture ou du district',
      officeIds: ['cbdb:office:987'],
    }),
    JSON.stringify({
      source: 'MaxiRicci7000',
      kind: 'office',
      language: 'fr',
      zh: '理官',
      dynasty: 'HAN',
      translation: 'régulateur officiel',
      officeIds: [],
    }),
  ].join('\n');

  it('indexes by every officeId', () => {
    const index = buildHuckbotGlossIndex(glossNdjson);
    expect(index.get('cbdb:office:987')).toBe('Senior Subalterns of the Prefecture or District');
    expect(index.get('norbert:office:42')).toBe('Governor');
  });

  it('fills blank office translations and refreshes description', () => {
    const index = buildHuckbotGlossIndex(glossNdjson);
    const candidate: AuthorityCandidate = {
      source: 'CBDB',
      authorityId: '987',
      kind: 'office',
      primaryName: '州縣長吏',
      searchStrings: ['州縣長吏'],
      metadata: {
        dynasty: '宋',
        entityId: 'cbdb:office:987',
        description: '州縣長吏 (宋)',
      },
    };
    const enriched = applyHuckbotGlossToCandidate(candidate, index);
    expect(enriched.metadata?.translation).toBe('Senior Subalterns of the Prefecture or District');
    expect(enriched.metadata?.description).toBe(
      formatOfficeClue('州縣長吏', 'Senior Subalterns of the Prefecture or District', '宋'),
    );
  });

  it('does not overwrite an existing pack translation', () => {
    const index = buildHuckbotGlossIndex(glossNdjson);
    const candidate: AuthorityCandidate = {
      source: 'CBDB',
      authorityId: '987',
      kind: 'office',
      primaryName: '州縣長吏',
      searchStrings: ['州縣長吏'],
      metadata: {
        translation: 'Already present',
        entityId: 'cbdb:office:987',
      },
    };
    expect(applyHuckbotGlossToCandidate(candidate, index).metadata?.translation).toBe(
      'Already present',
    );
  });

  it('treats [Not Yet Translated] as empty so Huckbot can fill', () => {
    expect(cleanPublishableOfficeGloss('[Not Yet Translated]')).toBeNull();
    expect(cleanPublishableOfficeGloss('Heir Apparent (Hucker)')).toBe('Heir Apparent');
    const index = buildHuckbotGlossIndex(glossNdjson);
    const candidate: AuthorityCandidate = {
      source: 'CBDB',
      authorityId: '987',
      kind: 'office',
      primaryName: '州縣長吏',
      searchStrings: ['州縣長吏'],
      metadata: {
        translation: '[Not Yet Translated]',
        entityId: 'cbdb:office:987',
        dynasty: '宋',
      },
    };
    expect(applyHuckbotGlossToCandidate(candidate, index).metadata?.translation).toBe(
      'Senior Subalterns of the Prefecture or District',
    );
  });

  it('builds gloss lookup keys for CBDB and Norbert office idnos', () => {
    expect(
      officeGlossLookupKeys([
        { type: 'CBDB', value: '85931' },
        { type: 'NORBERT', value: 'office-1255' },
      ]),
    ).toEqual(
      expect.arrayContaining([
        'cbdb:office:85931',
        'norbert:office:office-1255',
        'norbert:office:1255',
      ]),
    );
  });

  it('enriches pack rows used by lookup', () => {
    const index = buildHuckbotGlossIndex(glossNdjson);
    const row = applyHuckbotGlossToPackRow(
      {
        authorityId: '42',
        primaryName: '太守',
        metadata: { entityId: 'norbert:office:42', dynasty: '漢' },
      },
      'norbert',
      index,
    );
    expect(row.metadata?.translation).toBe('Governor');
    expect(row.metadata?.description).toContain('Governor');
  });

  it('attaches French by officeId without touching English', () => {
    const en = buildHuckbotGlossIndex(glossNdjson);
    const fr = buildMaxiRicciGlossIndex(frenchNdjson);
    const candidate: AuthorityCandidate = {
      source: 'CBDB',
      authorityId: '987',
      kind: 'office',
      primaryName: '州縣長吏',
      searchStrings: ['州縣長吏'],
      metadata: { entityId: 'cbdb:office:987', dynasty: '宋' },
    };
    const withEn = applyHuckbotGlossToCandidate(candidate, en);
    const withBoth = applyMaxiRicciGlossToCandidate(withEn, fr);
    expect(withBoth.metadata?.translation).toBe('Senior Subalterns of the Prefecture or District');
    expect(withBoth.metadata?.translationFr).toBe(
      'subalternes seniors de la préfecture ou du district',
    );
  });

  it('falls back to zh(+dynasty) when officeIds are empty (Batch A)', () => {
    const fr = buildMaxiRicciGlossIndex(frenchNdjson);
    const candidate: AuthorityCandidate = {
      source: 'CBDB',
      authorityId: '1',
      kind: 'office',
      primaryName: '理官',
      searchStrings: ['理官'],
      metadata: { dynasty: 'HAN' },
    };
    expect(applyMaxiRicciGlossToCandidate(candidate, fr).metadata?.translationFr).toBe(
      'régulateur officiel',
    );
  });

  it('falls back to the procedural place+suffix template when no pack row matches', () => {
    const en = buildHuckbotGlossIndex(glossNdjson);
    const fr = buildMaxiRicciGlossIndex(frenchNdjson);
    const candidate: AuthorityCandidate = {
      source: 'CBDB',
      authorityId: '999',
      kind: 'office',
      primaryName: '豫章太守',
      searchStrings: ['豫章太守'],
      metadata: { entityId: 'cbdb:office:999' },
    };
    const withEn = applyHuckbotGlossToCandidate(candidate, en);
    expect(withEn.metadata?.translation).toBe('Commandery Governor of Yuzhang');
    expect(withEn.metadata?.translationSource).toBe(HUCKBOT_PROCEDURAL_SOURCE);

    const withBoth = applyMaxiRicciGlossToCandidate(withEn, fr);
    expect(withBoth.metadata?.translationFr).toBe('gouverneur de commanderie de Yuzhang');
    expect(withBoth.metadata?.translationFrSource).toBe(MAXIRICCI_PROCEDURAL_SOURCE);
  });

  it('procedural fallback still works with empty packs', () => {
    const candidate: AuthorityCandidate = {
      source: 'CBDB',
      authorityId: '1000',
      kind: 'office',
      primaryName: '枝江令',
      searchStrings: ['枝江令'],
      metadata: {},
    };
    expect(applyHuckbotGlossToCandidate(candidate, new Map()).metadata?.translation).toBe(
      'District Magistrate of Zhijiang',
    );
  });

  it('does not invent a translation for names outside the pattern', () => {
    const candidate: AuthorityCandidate = {
      source: 'CBDB',
      authorityId: '1001',
      kind: 'office',
      primaryName: '尚書令',
      searchStrings: ['尚書令'],
      metadata: {},
    };
    expect(
      applyHuckbotGlossToCandidate(candidate, new Map()).metadata?.translation,
    ).toBeUndefined();
  });

  describe('persistOfficeTranslationNames', () => {
    function fakeStore() {
      const added: { text: string; nameType?: string; language?: string; source?: string }[] = [];
      const store = {
        sqliteAddName: jest.fn(async (input: (typeof added)[number]) => {
          added.push(input);
        }),
      } as unknown as EntityStore;
      return { store, added };
    }

    it('falls back to the procedural template for a freeform office with no authority gloss', async () => {
      const { store, added } = fakeStore();
      const count = await persistOfficeTranslationNames(store, 'office-1', {
        primaryName: '豫章太守',
      });
      expect(count).toBe(2);
      expect(added).toEqual([
        expect.objectContaining({
          text: 'Commandery Governor of Yuzhang',
          language: 'en',
          source: HUCKBOT_PROCEDURAL_SOURCE,
        }),
        expect.objectContaining({
          text: 'gouverneur de commanderie de Yuzhang',
          language: 'fr',
          source: MAXIRICCI_PROCEDURAL_SOURCE,
        }),
      ]);
    });

    it('prefers an authority-sourced gloss over the procedural fallback', async () => {
      const { store, added } = fakeStore();
      const count = await persistOfficeTranslationNames(store, 'office-1', {
        translation: 'Governor from pack',
        enSource: 'CBDB',
        primaryName: '豫章太守',
      });
      expect(count).toBe(2);
      expect(added[0]).toEqual(
        expect.objectContaining({ text: 'Governor from pack', language: 'en', source: 'CBDB' }),
      );
      expect(added[1]).toEqual(
        expect.objectContaining({
          text: 'gouverneur de commanderie de Yuzhang',
          language: 'fr',
          source: MAXIRICCI_PROCEDURAL_SOURCE,
        }),
      );
    });

    it('adds nothing when the name matches no pattern and no gloss is supplied', async () => {
      const { store, added } = fakeStore();
      const count = await persistOfficeTranslationNames(store, 'office-1', {
        primaryName: '尚書令',
      });
      expect(count).toBe(0);
      expect(added).toEqual([]);
    });
  });
});
