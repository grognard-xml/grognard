import { reconcile } from '../services/lincs-api';
import {
  asSyncedEntityCandidate,
  buildDisambiguationCandidates,
  candidatesFromEntityFile,
  candidatesFromSqliteEntities,
  candidateLinks,
  candidatePassesYearFilter,
  centralizeOwnDatabaseSources,
  clearPersonPackIndexForTests,
  collapseCrossAuthorityCandidates,
  collectTypedNamesForCandidate,
  candidatePrimaryLabel,
  candidateRomanizationSubtitle,
  enrichCandidateNames,
  extractCbdbId,
  extractViafId,
  extractWikidataId,
  fetchLiveCandidates,
  isOwnDatabaseSource,
  mergeCandidates,
  mergeSelectedCandidates,
  normalizeGeo,
  toAuthoritySourcedFields,
  type DisambiguationCandidate,
} from './disambiguationCandidates';
import { AuthorityCache } from './authorityCache';
import { DilaPlaceDetailCache } from './dilaPlaceDetailCache';
import {
  clearWikidataNamesCacheForTests,
  clearWikidataTypedNamesCacheForTests,
} from './disambiguationMatch';
import { addEntity, createEntitiesScaffold, parseEntities } from './entities';
import { clearViafHeadingCacheForTests, viafIdsOnCandidate } from './viafNativeHeadings';

jest.mock('../services/lincs-api', () => ({ reconcile: jest.fn() }));
const mockReconcile = reconcile as jest.MockedFunction<typeof reconcile>;

describe('disambiguationCandidates', () => {
  afterEach(() => {
    clearPersonPackIndexForTests();
  });

  it('keeps valid WGS84 coordinates and rejects projected CHGIS coordinates', () => {
    expect(normalizeGeo({ lat: 34.76179, lon: 117.4856 })).toEqual({
      lat: 34.76179,
      lon: 117.4856,
    });
    expect(normalizeGeo({ lat: 3868251.59, lon: 20103198.36 })).toBeUndefined();
    expect(normalizeGeo({ lat: Number.NaN, lon: 117 })).toBeUndefined();
  });

  it('finds local entity-file matches', () => {
    const doc = parseEntities(createEntitiesScaffold());
    const listPerson = doc.getElementsByTagName('listPerson')[0]!;
    const person = doc.createElementNS('http://www.tei-c.org/ns/1.0', 'person');
    person.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:id', 'person-000001');
    const name = doc.createElementNS('http://www.tei-c.org/ns/1.0', 'persName');
    name.textContent = '張衡';
    person.appendChild(name);
    listPerson.appendChild(person);

    const rows = candidatesFromEntityFile(doc, 'persName', '張衡');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.localEntityId).toBe('person-000001');
    expect(rows[0]?.sources).toContain('entity-file');
  });

  it('builds the same shape of candidates from SQLite entity snapshots', () => {
    const rows = candidatesFromSqliteEntities(
      [
        {
          id: 'person-000001',
          label: '張衡',
          description: 'Eastern Han polymath',
          authorities: [{ type: 'CBDB', value: '376' }],
          names: [
            { text: '張衡', language: 'zh-Hant' },
            { text: 'Zhang Heng', language: 'zh-Latn' },
          ],
          startYear: 78,
          endYear: 139,
        },
        {
          id: 'person-other',
          label: '其他',
          names: [{ text: '其他', language: 'zh-Hant' }],
        },
      ],
      '張衡',
      'pedb',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      localEntityId: 'person-000001',
      label: '張衡',
      startYear: 78,
      endYear: 139,
      projectLangName: '張衡',
      romanizedName: 'Zhang Heng',
      sources: ['entity-file'],
    });
    expect(rows[0]?.authorityIds).toEqual([{ type: 'CBDB', value: '376' }]);
  });

  it('matches an entity-file name that carries a <choice><sic>/<corr>', () => {
    const doc = parseEntities(createEntitiesScaffold());
    const ns = 'http://www.tei-c.org/ns/1.0';
    const listPerson = doc.getElementsByTagName('listPerson')[0]!;
    const person = doc.createElementNS(ns, 'person');
    person.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:id', 'person-000002');
    const name = doc.createElementNS(ns, 'persName');
    const choice = doc.createElementNS(ns, 'choice');
    const sic = doc.createElementNS(ns, 'sic');
    sic.textContent = '張';
    const corr = doc.createElementNS(ns, 'corr');
    corr.textContent = '章';
    choice.appendChild(sic);
    choice.appendChild(corr);
    name.appendChild(choice);
    name.appendChild(doc.createTextNode('衡'));
    person.appendChild(name);
    listPerson.appendChild(person);

    const rows = candidatesFromEntityFile(doc, 'persName', '章衡');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.localEntityId).toBe('person-000002');
    expect(rows[0]?.label).toBe('章衡');
  });

  it('prefers the description note over an authority-cache note on the same entity', () => {
    const doc = parseEntities(createEntitiesScaffold());
    addEntity(doc, 'person', {
      name: '桓玄',
      cache: { source: 'CBDB', data: { foo: 'bar' } },
      description: 'Jin-dynasty usurper',
    });

    const rows = candidatesFromEntityFile(doc, 'persName', '桓玄');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.description).toBe('Jin-dynasty usurper');
  });

  it('matches local entities on alternative names, keeping the display name as label', () => {
    const doc = parseEntities(createEntitiesScaffold());
    addEntity(doc, 'person', {
      name: '張衡',
      nameLang: 'zh-Hant',
      romanizedName: 'Zhang Heng',
      altNames: [{ text: '平子', type: 'courtesy' }],
    });

    for (const surface of ['張衡', '平子', 'Zhang Heng']) {
      const rows = candidatesFromEntityFile(doc, 'persName', surface);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.label).toBe('張衡');
      expect(rows[0]?.projectLangName).toBe('張衡');
      expect(rows[0]?.romanizedName).toBe('Zhang Heng');
    }
  });

  describe('typed names ingestion', () => {
    afterEach(() => {
      clearWikidataNamesCacheForTests();
      clearWikidataTypedNamesCacheForTests();
    });

    it("excludes the primary-typed pack entry from a candidate's typedNames", async () => {
      mockReconcile.mockResolvedValue([]);
      const originalFetch = global.fetch;
      global.fetch = jest.fn().mockResolvedValue({ ok: false, json: async () => ({}) } as Response);
      const cbdbPack = [
        JSON.stringify({
          source: 'CBDB',
          authorityId: '1762',
          kind: 'person',
          primaryName: '王安石',
          searchStrings: ['王安石', '王介甫'],
          names: [
            { text: '王安石', type: 'primary' },
            { text: '王', type: 'family' },
            { text: '安石', type: 'given' },
            { text: '介甫', type: 'courtesy' },
            { text: '王介甫', type: 'courtesy' },
          ],
          metadata: { pinyin: 'Wang Anshi' },
        }),
      ].join('\n');
      const readPackFile = jest.fn(async (packId: string) => {
        if (packId === 'cbdb-persons') return cbdbPack;
        throw new Error(`not installed: ${packId}`);
      });

      try {
        const rows = await buildDisambiguationCandidates(
          parseEntities(createEntitiesScaffold()),
          'persName',
          '王安石',
          new AuthorityCache(null, null),
          ['Wikidata', 'VIAF'],
          false,
          readPackFile,
        );

        const cbdbRow = rows.find((row) => row.sources.includes('CBDB'));
        expect(cbdbRow?.typedNames).toEqual([
          { text: '王', type: 'family', lang: undefined },
          { text: '安石', type: 'given', lang: undefined },
          { text: '介甫', type: 'courtesy', lang: undefined },
        ]);
      } finally {
        global.fetch = originalFetch;
      }
    });

    it('collectTypedNamesForCandidate merges pack names with Wikidata claims', async () => {
      const originalFetch = global.fetch;
      global.fetch = jest.fn(
        async () =>
          ({
            ok: true,
            json: async () => ({
              entities: {
                Q11332: {
                  claims: {
                    P1782: [
                      { mainsnak: { datavalue: { value: { text: '平子', language: 'zh' } } } },
                    ],
                    P1786: [
                      { mainsnak: { datavalue: { value: { text: '西鄂侯', language: 'zh' } } } },
                    ],
                  },
                },
              },
            }),
          }) as unknown as Response,
      ) as unknown as typeof fetch;
      try {
        const names = await collectTypedNamesForCandidate({
          id: 'wd',
          label: '張衡',
          sources: ['Wikidata', 'CBDB'],
          uri: 'https://www.wikidata.org/wiki/Q11332',
          typedNames: [{ text: '平子', type: 'courtesy', lang: 'zh-Hant' }],
        });
        // pack-provided entry wins for 平子; Wikidata adds the posthumous name
        expect(names).toEqual([
          { text: '平子', type: 'courtesy', lang: 'zh-Hant' },
          { text: '西鄂侯', type: 'posthumous', lang: 'zh' },
        ]);
      } finally {
        global.fetch = originalFetch;
      }
    });
  });

  describe('mergeSelectedCandidates script preference', () => {
    const rows: DisambiguationCandidate[] = [
      {
        id: 'ndl',
        label: 'チョウ・コウ',
        sources: ['NDL'],
        romanizedName: 'Chou Kou',
      },
      {
        id: 'cbdb',
        label: '張衡',
        sources: ['CBDB'],
        projectLangName: '張衡',
        romanizedName: 'Zhang Heng',
      },
    ];

    it('keeps first-row label without the preference flag (legacy behavior)', () => {
      expect(mergeSelectedCandidates(rows)?.label).toBe('チョウ・コウ');
    });

    it('prefers a non-Latin label and propagates dual-script fields with the flag', () => {
      const merged = mergeSelectedCandidates(rows, { preferNonLatinLabel: true })!;
      expect(merged.label).toBe('チョウ・コウ'); // first non-Latin label wins deterministically
      expect(merged.projectLangName).toBe('張衡');
      expect(merged.romanizedName).toBe('Chou Kou');
    });

    it('prefers a non-Latin label over a Latin first row', () => {
      const latinFirst: DisambiguationCandidate[] = [
        { id: 'viaf', label: 'Zhang Heng', sources: ['VIAF'] },
        { id: 'cbdb', label: '張衡', sources: ['CBDB'], projectLangName: '張衡' },
      ];
      expect(mergeSelectedCandidates(latinFirst)?.label).toBe('Zhang Heng');
      expect(mergeSelectedCandidates(latinFirst, { preferNonLatinLabel: true })?.label).toBe(
        '張衡',
      );
    });

    it('preserves geo from whichever row carries it', () => {
      const withGeo: DisambiguationCandidate[] = [
        { id: 'dila', label: '竟陵', sources: ['DILA'] },
        { id: 'chgis', label: '竟陵', sources: ['CHGIS'], geo: { lat: 30.65, lon: 113.15 } },
      ];
      expect(mergeSelectedCandidates(withGeo)?.geo).toEqual({ lat: 30.65, lon: 113.15 });
    });
  });

  describe('enrichCandidateNames', () => {
    afterEach(() => {
      clearWikidataNamesCacheForTests();
      clearViafHeadingCacheForTests();
    });

    const labelsResponse = (entities: Record<string, Record<string, string>>) =>
      ({
        ok: true,
        json: async () => ({
          entities: Object.fromEntries(
            Object.entries(entities).map(([qid, labels]) => [
              qid,
              {
                labels: Object.fromEntries(
                  Object.entries(labels).map(([lang, value]) => [lang, { value }]),
                ),
              },
            ]),
          ),
        }),
      }) as Response;

    it('fills project-language and Latin names from Wikidata labels', async () => {
      const fetchImpl = jest
        .fn()
        .mockResolvedValue(
          labelsResponse({ Q11332: { 'zh-hant': '張衡', zh: '张衡', en: 'Zhang Heng' } }),
        );
      const candidates: DisambiguationCandidate[] = [
        {
          id: 'wd',
          label: 'Zhang Heng',
          sources: ['Wikidata'],
          uri: 'https://www.wikidata.org/wiki/Q11332',
        },
      ];

      await enrichCandidateNames(candidates, 'zh-Hant', fetchImpl);
      expect(candidates[0]?.projectLangName).toBe('張衡');
      expect(candidates[0]?.romanizedName).toBe('Zhang Heng');
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it('promotes Tibetan script to the primary label and uses Wylie, not the English label', async () => {
      const fetchImpl = jest.fn().mockResolvedValue(
        labelsResponse({
          Q42: { bo: 'དཔོན་ཚང་ཡེ་ཤེས།', en: 'Pön Tsang Yeshe' },
        }),
      );
      const candidates: DisambiguationCandidate[] = [
        {
          id: 'wd',
          label: 'Pön Tsang Yeshe',
          sources: ['Wikidata'],
          uri: 'https://www.wikidata.org/wiki/Q42',
        },
      ];

      await enrichCandidateNames(candidates, 'bo', fetchImpl);
      expect(candidates[0]?.projectLangName).toBe('དཔོན་ཚང་ཡེ་ཤེས།');
      expect(candidates[0]?.label).toBe('དཔོན་ཚང་ཡེ་ཤེས།');
      expect(candidates[0]?.romanizedName).not.toBe('Pön Tsang Yeshe');
      expect(candidates[0]?.romanizedName).toMatch(/[a-z]/i);
    });

    it('puts Wylie on the subtitle only when there is no description or dates', () => {
      const tibetan: DisambiguationCandidate = {
        id: 'wd',
        label: 'དཔོན་ཚང་ཡེ་ཤེས།',
        sources: ['Wikidata'],
        projectLangName: 'དཔོན་ཚང་ཡེ་ཤེས།',
        romanizedName: 'dpon tshang ye shes',
      };
      expect(candidatePrimaryLabel(tibetan)).toBe('དཔོན་ཚང་ཡེ་ཤེས།');
      expect(candidateRomanizationSubtitle(tibetan)).toBe('dpon tshang ye shes');
      expect(
        candidateRomanizationSubtitle({ ...tibetan, description: 'Tibetan lama' }),
      ).toBeUndefined();
      expect(candidateRomanizationSubtitle({ ...tibetan, startYear: 982 })).toBeUndefined();
    });

    it('autogenerates pinyin when no Latin label exists', async () => {
      const fetchImpl = jest
        .fn()
        .mockResolvedValue(labelsResponse({ Q999999: { 'zh-hant': '司馬遷' } }));
      const candidates: DisambiguationCandidate[] = [
        {
          id: 'wd',
          label: '司馬遷',
          sources: ['Wikidata'],
          uri: 'https://www.wikidata.org/wiki/Q999999',
        },
      ];

      await enrichCandidateNames(candidates, 'zh-Hant', fetchImpl);
      expect(candidates[0]?.projectLangName).toBe('司馬遷');
      expect(candidates[0]?.romanizedName).toBe('Si Ma Qian');
    });

    it('survives fetch failure by falling back to autogeneration', async () => {
      const fetchImpl = jest.fn().mockRejectedValue(new Error('offline'));
      const candidates: DisambiguationCandidate[] = [
        {
          id: 'wd',
          label: '張衡',
          sources: ['Wikidata'],
          uri: 'https://www.wikidata.org/wiki/Q11332',
        },
      ];

      await enrichCandidateNames(candidates, 'zh-Hant', fetchImpl);
      expect(candidates[0]?.projectLangName).toBe('張衡');
      expect(candidates[0]?.romanizedName).toBe('Zhang Heng');
    });

    it('does nothing without a project language', async () => {
      const fetchImpl = jest.fn();
      const candidates: DisambiguationCandidate[] = [
        {
          id: 'wd',
          label: '張衡',
          sources: ['Wikidata'],
          uri: 'https://www.wikidata.org/wiki/Q11332',
        },
      ];
      await enrichCandidateNames(candidates, null, fetchImpl);
      expect(candidates[0]?.projectLangName).toBeUndefined();
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('promotes VIAF cluster headings in Tibetan and Chinese', async () => {
      const cluster = {
        mainHeadings: { data: [{ text: 'Bdud-ʼjoms ʼJigs-bral-ye-śes-rdo-rje 1904-1987' }] },
        x400s: {
          data: [
            {
              subfield: [{ code: 'a', content: 'བདུད་འཇོམས་འཇིགས་བྲལ་ཡེ་ཤེས་རྡོ་རྗེ།' }],
            },
            { subfield: [{ code: 'a', content: '敦珠' }] },
            { subfield: [{ code: 'a', content: '敦珠仁波切' }] },
          ],
        },
      };
      const fetchImpl = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => cluster,
      } as Response);

      const tibetan: DisambiguationCandidate[] = [
        {
          id: 'viaf',
          label: 'Bdud-ʼjoms ʼJigs-bral-ye-śes-rdo-rje, 1904-1987',
          sources: ['VIAF'],
          uri: 'https://viaf.org/viaf/29939963',
        },
      ];
      expect(viafIdsOnCandidate(tibetan[0]!)).toEqual(['29939963']);
      await enrichCandidateNames(tibetan, 'bo', fetchImpl);
      expect(tibetan[0]?.label).toBe('བདུད་འཇོམས་འཇིགས་བྲལ་ཡེ་ཤེས་རྡོ་རྗེ།');
      expect(tibetan[0]?.projectLangName).toBe('བདུད་འཇོམས་འཇིགས་བྲལ་ཡེ་ཤེས་རྡོ་རྗེ།');

      clearViafHeadingCacheForTests();
      const chinese: DisambiguationCandidate[] = [
        {
          id: 'viaf',
          label: 'Bdud-ʼjoms ʼJigs-bral-ye-śes-rdo-rje, 1904-1987',
          sources: ['VIAF'],
          uri: 'https://viaf.org/viaf/29939963',
        },
      ];
      await enrichCandidateNames(chinese, 'zh-Hant', fetchImpl);
      expect(chinese[0]?.label).toBe('敦珠仁波切');
      expect(chinese[0]?.projectLangName).toBe('敦珠仁波切');
      // VIAF's Latin heading here is Wylie, not pinyin; autogenerate from the Chinese name.
      expect(chinese[0]?.romanizedName).toBe('Dun Zhu Ren Bo Qie');
    });
  });

  it('extracts Wikidata ids from VIAF source codes', () => {
    expect(extractWikidataId('WKP|Q1137864')).toBe('Q1137864');
    expect(extractWikidataId('https://www.wikidata.org/wiki/Q42')).toBe('Q42');
  });

  it('extracts CBDB ids from reconcile descriptions', () => {
    expect(extractCbdbId('person, CBDB ID = 392870')).toBe('392870');
    expect(extractCbdbId('Tang dynasty person CBDB = 178700')).toBe('178700');
  });

  it('stores CBDB id from Wikidata description on live candidates', async () => {
    // Covered indirectly via authorityIdsFromCrossRefs in fetchLiveCandidates;
    // test enrichment through candidateLinks after manual candidate shape.
    const links = candidateLinks({
      id: 'wd',
      label: 'Sima Guofan',
      sources: ['Wikidata'],
      description: 'person, CBDB ID = 392870',
      authorityIds: [
        { type: 'Wikidata', value: 'https://www.wikidata.org/wiki/Q42' },
        { type: 'CBDB', value: '392870' },
      ],
    });
    expect(links.some((link) => link.kind === 'cbdb' && link.url.includes('392870'))).toBe(true);
  });

  it('extracts concordance ids beyond CBDB from free-text cross references', async () => {
    mockReconcile.mockImplementation(async ({ options }) => {
      const authorityId = (options as { authorityId?: string })?.authorityId;
      if (authorityId === 'wikidata') {
        return [
          {
            uri: 'https://www.wikidata.org/wiki/Q1137864',
            label: 'Example Person',
            description:
              'Sources: https://viaf.org/viaf/404064183, https://authority.dila.edu.tw/person/?fromInner=A001492, https://id.ndl.go.jp/auth/ndlna/00270123',
          },
        ];
      }
      if (authorityId === 'viaf') {
        return [
          {
            uri: 'https://viaf.org/viaf/404064183',
            label: 'Example Person',
            description:
              'Sources: https://www.wikidata.org/wiki/Q1137864, https://authority.dila.edu.tw/person/?fromInner=A001492, https://id.ndl.go.jp/auth/ndlna/00270123',
          },
        ];
      }
      return [];
    });

    const cache = new AuthorityCache(null, null);
    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({ ok: false, json: async () => ({}) } as Response);

    try {
      const rows = await fetchLiveCandidates('persName', 'Example Person', cache, [
        'Wikidata',
        'VIAF',
      ]);
      const row = rows[0];
      expect(row?.authorityIds).toEqual(
        expect.arrayContaining([
          { type: 'Wikidata', value: 'Q1137864' },
          { type: 'VIAF', value: 'https://viaf.org/viaf/404064183' },
          { type: 'DILA', value: 'A001492' },
          { type: 'NDL', value: '00270123' },
        ]),
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('collapses Wikidata and VIAF when they share a Q id', () => {
    const rows = collapseCrossAuthorityCandidates([
      {
        id: 'https://www.wikidata.org/wiki/Q1137864',
        label: 'Example Person',
        sources: ['Wikidata'],
        uri: 'https://www.wikidata.org/wiki/Q1137864',
        authorityIds: [{ type: 'Wikidata', value: 'https://www.wikidata.org/wiki/Q1137864' }],
      },
      {
        id: 'https://viaf.org/viaf/404064183',
        label: 'Example Person',
        description: 'Sources: WKP|Q1137864',
        sources: ['VIAF'],
        uri: 'https://viaf.org/viaf/404064183',
        authorityIds: [{ type: 'VIAF', value: 'https://viaf.org/viaf/404064183' }],
      },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.sources).toEqual(expect.arrayContaining(['Wikidata', 'VIAF']));
    expect(rows[0]?.authorityIds).toHaveLength(2);
  });

  it('collapses local PEDB offices with Norbert pack hits that share a NORBERT id', () => {
    const rows = collapseCrossAuthorityCandidates([
      {
        id: 'office-norbert-4135',
        label: '吳郡太守',
        sources: ['entity-file'],
        fromEntityFile: true,
        localEntityId: 'office-norbert-4135',
        authorityIds: [{ type: 'NORBERT', value: 'office-4135' }],
      },
      {
        id: 'urn:grognard:authority:norbert:office:4135',
        label: '吳郡太守',
        sources: ['NORBERT'],
        uri: 'urn:grognard:authority:norbert:office:4135',
        authorityIds: [{ type: 'NORBERT', value: 'office-4135' }],
      },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.sources).toEqual(expect.arrayContaining(['entity-file', 'NORBERT']));
    expect(rows[0]?.localEntityId).toBe('office-norbert-4135');
    expect(rows[0]?.fromEntityFile).toBe(true);
  });

  it('does not collapse same-named offices that lack a shared authority id', () => {
    const rows = collapseCrossAuthorityCandidates([
      {
        id: 'office-local-1',
        label: '吳郡太守',
        sources: ['entity-file'],
        fromEntityFile: true,
        localEntityId: 'office-local-1',
      },
      {
        id: 'urn:grognard:authority:norbert:office:4135',
        label: '吳郡太守',
        sources: ['NORBERT'],
        uri: 'urn:grognard:authority:norbert:office:4135',
        authorityIds: [{ type: 'NORBERT', value: '4135' }],
      },
    ]);
    expect(rows).toHaveLength(2);
  });

  it('retains pre-deduplication authority assertions in the pending projection', () => {
    const cached = collapseCrossAuthorityCandidates([
      {
        id: 'dila-a003126',
        label: '徐孝嗣',
        description: 'Sources: WKP|Q1',
        sources: ['DILA'],
        uri: 'https://authority.dila.edu.tw/person/?fromInner=A003126',
        authorityIds: [{ type: 'DILA', value: 'A003126' }],
        startYear: 453,
        endYear: 499,
      },
      {
        id: 'wikidata-Q1',
        label: '徐孝嗣',
        sources: ['Wikidata'],
        uri: 'https://www.wikidata.org/entity/Q1',
        authorityIds: [{ type: 'Wikidata', value: 'Q1' }],
        startYear: 452,
        endYear: 500,
      },
    ])[0]!;

    const reloaded = mergeCandidates([[cached]])[0]!;
    expect(reloaded.authorityAssertions).toHaveLength(2);
    expect(reloaded.authorityAssertions?.map((row) => [row.sources[0], row.startYear])).toEqual(
      expect.arrayContaining([
        ['DILA', 453],
        ['Wikidata', 452],
      ]),
    );
  });

  it('collapses candidates from different authorities that share identical birth and death years', () => {
    const rows = collapseCrossAuthorityCandidates([
      {
        id: 'https://www.wikidata.org/wiki/Q1',
        label: 'Example Person',
        sources: ['Wikidata'],
        startYear: 1200,
        endYear: 1260,
      },
      {
        id: 'https://viaf.org/viaf/1',
        label: 'Example Person (variant)',
        sources: ['VIAF'],
        startYear: 1200,
        endYear: 1260,
      },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.sources).toEqual(expect.arrayContaining(['Wikidata', 'VIAF']));
  });

  it('does not collapse candidates from different authorities when years differ, are only partially known, or come from the same authority', () => {
    const differentYears = collapseCrossAuthorityCandidates([
      { id: 'a', label: 'Person A', sources: ['Wikidata'], startYear: 1200, endYear: 1260 },
      { id: 'b', label: 'Person B', sources: ['VIAF'], startYear: 1200, endYear: 1261 },
    ]);
    expect(differentYears).toHaveLength(2);

    const partialYears = collapseCrossAuthorityCandidates([
      { id: 'a', label: 'Person A', sources: ['Wikidata'], startYear: 1200 },
      { id: 'b', label: 'Person B', sources: ['VIAF'], startYear: 1200 },
    ]);
    expect(partialYears).toHaveLength(2);

    const sameAuthority = collapseCrossAuthorityCandidates([
      { id: 'a', label: 'Person A', sources: ['Wikidata'], startYear: 1200, endYear: 1260 },
      { id: 'b', label: 'Person B', sources: ['Wikidata'], startYear: 1200, endYear: 1260 },
    ]);
    expect(sameAuthority).toHaveLength(2);
  });

  it('collapses place candidates within the proximity radius, taking the centroid as geo', () => {
    const rows = collapseCrossAuthorityCandidates(
      [
        { id: 'cbdb-a', label: '竟陵', sources: ['CBDB'], geo: { lat: 30.65, lon: 113.15 } },
        { id: 'chgis-a', label: '竟陵', sources: ['CHGIS'], geo: { lat: 30.652, lon: 113.152 } },
      ],
      { tag: 'placeName', placeProximityKm: 5 },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.sources).toEqual(expect.arrayContaining(['CBDB', 'CHGIS']));
    expect(rows[0]?.geo?.lat).toBeCloseTo(30.651, 2);
    expect(rows[0]?.geo?.lon).toBeCloseTo(113.151, 2);
  });

  it('keeps two same-named places distinct when they are beyond the proximity radius', () => {
    // Two real, ~2000km-apart places both named 竟陵 — the canonical "same
    // name, different place" fixture (see geoCluster.test.ts).
    const rows = collapseCrossAuthorityCandidates(
      [
        { id: 'cbdb-a', label: '竟陵', sources: ['CBDB'], geo: { lat: 30.65, lon: 113.15 } },
        { id: 'cbdb-b', label: '竟陵', sources: ['CHGIS'], geo: { lat: 39.9, lon: 116.4 } },
      ],
      { tag: 'placeName', placeProximityKm: 5 },
    );
    expect(rows).toHaveLength(2);
  });

  it('does not merge place candidates when either side has no coordinates', () => {
    const rows = collapseCrossAuthorityCandidates(
      [
        { id: 'cbdb-a', label: '竟陵', sources: ['CBDB'], geo: { lat: 30.65, lon: 113.15 } },
        { id: 'dila-a', label: '竟陵', sources: ['DILA'] },
      ],
      { tag: 'placeName', placeProximityKm: 5 },
    );
    expect(rows).toHaveLength(2);
  });

  it('does not apply geo-cluster merging outside place groups', () => {
    const rows = collapseCrossAuthorityCandidates(
      [
        { id: 'a', label: 'Person A', sources: ['Wikidata'], geo: { lat: 30.65, lon: 113.15 } },
        { id: 'b', label: 'Person B', sources: ['VIAF'], geo: { lat: 30.652, lon: 113.152 } },
      ],
      { tag: 'persName', placeProximityKm: 5 },
    );
    expect(rows).toHaveLength(2);
  });

  it('extracts VIAF ids from locale-prefixed permalinks (e.g. viaf.org/fr/viaf/…)', () => {
    expect(extractViafId('https://viaf.org/fr/viaf/16332263')).toBe('16332263');
    expect(extractViafId('https://viaf.org/viaf/16332263')).toBe('16332263');
  });

  it('collapses Wikidata and VIAF when the VIAF permalink has a locale segment', () => {
    const rows = collapseCrossAuthorityCandidates([
      {
        id: 'https://www.wikidata.org/wiki/Q967998',
        label: 'Fu Jian',
        sources: ['Wikidata'],
        uri: 'https://www.wikidata.org/wiki/Q967998',
        description: 'VIAF: https://viaf.org/fr/viaf/16332263, CBDB ID = 178700',
        authorityIds: [{ type: 'Wikidata', value: 'https://www.wikidata.org/wiki/Q967998' }],
      },
      {
        id: 'https://viaf.org/fr/viaf/16332263',
        label: 'Fu Jian',
        sources: ['VIAF'],
        uri: 'https://viaf.org/fr/viaf/16332263',
        description: 'Sources: https://www.wikidata.org/wiki/Q967998',
        authorityIds: [{ type: 'VIAF', value: 'https://viaf.org/fr/viaf/16332263' }],
      },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.sources).toEqual(expect.arrayContaining(['Wikidata', 'VIAF']));
  });

  it('keeps VIAF rows even when their heading does not literally match the surface', async () => {
    mockReconcile.mockImplementation(async ({ options }) => {
      const authorityId = (options as { authorityId?: string })?.authorityId;
      if (authorityId === 'wikidata') {
        return [
          {
            uri: 'https://www.wikidata.org/wiki/Q967998',
            label: '苻堅',
            description: undefined,
          },
        ];
      }
      // VIAF headings are authority-specific (e.g. LC-style "Name, dates") and won't
      // equal the raw CJK surface text — this must not get dropped by exact matching.
      return [
        {
          uri: 'https://viaf.org/viaf/16332263',
          label: 'Fu, Jian, 338-385',
          description: undefined,
        },
      ];
    });
    const cache = new AuthorityCache(null, null);
    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({ ok: false, json: async () => ({}) } as Response);

    try {
      const rows = await fetchLiveCandidates('persName', '苻堅', cache, ['Wikidata', 'VIAF']);
      expect(rows.some((row) => row.sources.includes('VIAF'))).toBe(true);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('skips VIAF for Tibetan-script surface text — VIAF has no Tibetan coverage and fails open with unrelated catalog rows instead of no results', async () => {
    mockReconcile.mockImplementation(async ({ options }) => {
      const authorityId = (options as { authorityId?: string })?.authorityId;
      if (authorityId === 'wikidata') {
        return [
          {
            // filterReconcileByExactSurface (applied to Wikidata only) keeps a row
            // only when its label/aliases exactly match the surface, so the label
            // here must be the Tibetan-script form, not the English exonym.
            uri: 'https://www.wikidata.org/wiki/Q5869',
            label: 'ལྷ་ས',
            description: 'prefecture-level city and capital of Tibet',
          },
        ];
      }
      // A VIAF-Geographic query for Tibetan script does not fail closed — it
      // returns an arbitrary slice of unrelated geographic headings (observed
      // live: Australia, Slovenia, Belarus, Lisbon… for "ལྷ་ས"). If the gate in
      // fetchLiveCandidates ever regresses, this mock reproduces that shape so
      // the test fails loudly instead of the bug only showing up live.
      return [
        { uri: 'http://viaf.org/viaf/128919823', label: 'Austrália.', description: 'Australien' },
        { uri: 'http://viaf.org/viaf/141826349', label: 'Slóvenía', description: 'Slovenija' },
      ];
    });
    const cache = new AuthorityCache(null, null);
    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockImplementation(async (url: string) => {
      // filterWikidataByKind's SPARQL "is this QID a place" check — say yes,
      // it's beside the point of this test (VIAF gating).
      if (typeof url === 'string' && url.includes('query.wikidata.org/sparql')) {
        return {
          ok: true,
          json: async () => ({
            results: { bindings: [{ item: { value: 'http://www.wikidata.org/entity/Q5869' } }] },
          }),
        } as Response;
      }
      return { ok: false, json: async () => ({}) } as Response;
    });

    try {
      const rows = await fetchLiveCandidates('placeName', 'ལྷ་ས', cache, ['Wikidata', 'VIAF']);
      expect(rows.every((row) => !row.sources.includes('VIAF'))).toBe(true);
      expect(rows.some((row) => row.sources.includes('Wikidata') && row.label === 'ལྷ་ས')).toBe(
        true,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('surfaces CBDB/DILA candidates from installed packs without hitting the network', async () => {
    mockReconcile.mockResolvedValue([]);
    const cbdbPack = [
      JSON.stringify({
        source: 'CBDB',
        authorityId: '178700',
        kind: 'person',
        primaryName: '桓玄',
        searchStrings: ['桓玄'],
        metadata: {
          dateSource: 'fine',
          startYear: 369,
          endYear: 404,
          description: '桓玄 (Huan Xuan, 369–404, 晉 Jin)',
        },
      }),
    ].join('\n');
    const dilaPack = [
      JSON.stringify({
        source: 'DILA',
        authorityId: 'A012345',
        kind: 'person',
        primaryName: '桓玄',
        searchStrings: ['桓玄'],
        metadata: {
          dateSource: 'fine',
          startYear: 369,
          endYear: 404,
          description: '桓玄 (369–404, 晉, 曾廢晉安帝自立為帝)',
          crosswalk: { wikidata: ['Q551740'] },
        },
      }),
    ].join('\n');
    const readPackFile = jest.fn(async (packId: string) => {
      if (packId === 'cbdb-persons') return cbdbPack;
      if (packId === 'dila-persons') return dilaPack;
      throw new Error(`not installed: ${packId}`);
    });
    const doc = parseEntities(createEntitiesScaffold());
    const cache = new AuthorityCache(null, null);

    const rows = await buildDisambiguationCandidates(
      doc,
      'persName',
      '桓玄',
      cache,
      ['Wikidata', 'VIAF'],
      false,
      readPackFile,
    );

    expect(rows.some((row) => row.sources.includes('CBDB'))).toBe(true);
    expect(rows.some((row) => row.sources.includes('DILA'))).toBe(true);
    const dilaRow = rows.find((row) => row.sources.includes('DILA'));
    expect(dilaRow?.startYear).toBe(369);
    expect(dilaRow?.endYear).toBe(404);
    expect(dilaRow?.description).toContain('曾廢晉安帝自立為帝');
  });

  it('surfaces DILA and CHGIS place candidates from installed packs for placeName lookups', async () => {
    mockReconcile.mockResolvedValue([]);
    const dilaPlacesPack = [
      JSON.stringify({
        source: 'DILA',
        authorityId: 'PL-0001',
        kind: 'place',
        primaryName: '長安',
        searchStrings: ['長安'],
        metadata: { description: 'DILA place' },
      }),
    ].join('\n');
    const chgisPlacesPack = [
      JSON.stringify({
        source: 'CHGIS',
        authorityId: 'CH-001',
        kind: 'place',
        primaryName: '長安',
        searchStrings: ['長安'],
        metadata: { startYear: 618, endYear: 907, description: 'CHGIS place' },
      }),
    ].join('\n');
    const readPackFile = jest.fn(async (packId: string) => {
      if (packId === 'dila-places') return dilaPlacesPack;
      if (packId === 'chgis-places') return chgisPlacesPack;
      throw new Error(`not installed: ${packId}`);
    });
    const doc = parseEntities(createEntitiesScaffold());
    const cache = new AuthorityCache(null, null);

    const rows = await buildDisambiguationCandidates(
      doc,
      'placeName',
      '長安',
      cache,
      ['Wikidata', 'VIAF'],
      false,
      readPackFile,
    );

    expect(rows.some((row) => row.sources.includes('DILA'))).toBe(true);
    expect(rows.some((row) => row.sources.includes('CHGIS'))).toBe(true);
    const chgisRow = rows.find((row) => row.sources.includes('CHGIS'));
    expect(chgisRow?.startYear).toBe(618);
    expect(chgisRow?.endYear).toBe(907);
  });

  it('surfaces office candidates and retains hierarchy metadata', async () => {
    mockReconcile.mockResolvedValue([]);
    const parentOffice = {
      source: 'Norbert',
      authorityId: '10',
      entityId: 'norbert:office:10',
      name: '州',
    };
    const norbertOffices = [
      JSON.stringify({
        source: 'Norbert',
        authorityId: '11',
        kind: 'office',
        primaryName: '刺史',
        searchStrings: ['刺史'],
        metadata: { followsOffice: true, parentOffice },
      }),
    ].join('\n');
    const readPackFile = jest.fn(async (packId: string) => {
      if (packId === 'norbert-offices') return norbertOffices;
      throw new Error(`not installed: ${packId}`);
    });
    const doc = parseEntities(createEntitiesScaffold());
    const cache = new AuthorityCache(null, null);

    const rows = await buildDisambiguationCandidates(
      doc,
      'roleName',
      '刺史',
      cache,
      [],
      false,
      readPackFile,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      sources: ['NORBERT'],
      authorityIds: [{ type: 'NORBERT', value: 'office-11' }],
      authorityMetadata: { followsOffice: true, parentOffice },
    });
  });

  it('threads metadata.geo from a place pack row onto the DisambiguationCandidate', async () => {
    mockReconcile.mockResolvedValue([]);
    const chgisPlacesPack = [
      JSON.stringify({
        source: 'CHGIS',
        authorityId: 'CH-002',
        kind: 'place',
        primaryName: '竟陵',
        searchStrings: ['竟陵'],
        metadata: { geo: { lat: 30.65, lon: 113.15 }, description: 'CHGIS 竟陵' },
      }),
    ].join('\n');
    const readPackFile = jest.fn(async (packId: string) => {
      if (packId === 'chgis-places') return chgisPlacesPack;
      throw new Error(`not installed: ${packId}`);
    });
    const doc = parseEntities(createEntitiesScaffold());
    const cache = new AuthorityCache(null, null);

    const rows = await buildDisambiguationCandidates(
      doc,
      'placeName',
      '竟陵',
      cache,
      ['Wikidata', 'VIAF'],
      false,
      readPackFile,
    );

    const chgisRow = rows.find((row) => row.sources.includes('CHGIS'));
    expect(chgisRow?.geo).toEqual({ lat: 30.65, lon: 113.15 });
  });

  it("does not leak one DILA place record's dates onto another record sharing the same name", async () => {
    mockReconcile.mockResolvedValue([]);
    // DILA splits a place into one row per dynasty/era — same primaryName, distinct authorityId.
    const dilaPlacesPack = [
      JSON.stringify({
        source: 'DILA',
        authorityId: 'PL000000000001',
        kind: 'place',
        primaryName: '始興',
        searchStrings: ['始興'],
        metadata: { description: '始興 (265~316)', startYear: 265, endYear: 316 },
      }),
      JSON.stringify({
        source: 'DILA',
        authorityId: 'PL000000000002',
        kind: 'place',
        primaryName: '始興',
        searchStrings: ['始興'],
        metadata: { description: '始興 (589~618)', startYear: 589, endYear: 618 },
      }),
    ].join('\n');
    const readPackFile = jest.fn(async (packId: string) => {
      if (packId === 'dila-places') return dilaPlacesPack;
      throw new Error(`not installed: ${packId}`);
    });
    const doc = parseEntities(createEntitiesScaffold());
    const cache = new AuthorityCache(null, null);

    const rows = await buildDisambiguationCandidates(
      doc,
      'placeName',
      '始興',
      cache,
      [],
      false,
      readPackFile,
    );

    const dilaRows = rows.filter((row) => row.sources.includes('DILA'));
    expect(dilaRows).toHaveLength(2);
    const byUri = new Map(dilaRows.map((row) => [row.uri, row]));
    const first = byUri.get('https://authority.dila.edu.tw/place/?fromInner=PL000000000001');
    const second = byUri.get('https://authority.dila.edu.tw/place/?fromInner=PL000000000002');
    expect(first?.startYear).toBe(265);
    expect(first?.endYear).toBe(316);
    expect(second?.startYear).toBe(589);
    expect(second?.endYear).toBe(618);

    // authorityIds must hold the bare id, not the already-formatted record URL —
    // otherwise DILA_URL()/candidateLinks() wraps a full URL inside another URL
    // (e.g. ".../person/?fromInner=https://authority.dila.edu.tw/place/...").
    expect(first?.authorityIds).toContainEqual({ type: 'DILA', value: 'PL000000000001' });
    expect(second?.authorityIds).toContainEqual({ type: 'DILA', value: 'PL000000000002' });
  });

  it('prefixes the description with the dynasty from a lazily-fetched DILA place record', async () => {
    mockReconcile.mockResolvedValue([]);
    const dilaPlacesPack = [
      JSON.stringify({
        source: 'DILA',
        authorityId: 'PL000000029418',
        kind: 'place',
        primaryName: '武陵郡',
        searchStrings: ['武陵郡'],
        metadata: { description: '武陵郡 (中研院歷史地名 — 中國-湖南省-常德市-武陵區)' },
      }),
    ].join('\n');
    const readPackFile = jest.fn(async (packId: string) => {
      if (packId === 'dila-places') return dilaPlacesPack;
      throw new Error(`not installed: ${packId}`);
    });
    const doc = parseEntities(createEntitiesScaffold());
    const cache = new AuthorityCache(null, null);
    const dilaDetailCache = new DilaPlaceDetailCache(null, null);
    // Pre-populate the cache as if the background fetch already landed.
    await dilaDetailCache.set('PL000000029418', {
      remark: '（317 ~ 420）郡級行政中心所在地。',
      dynasty: '東晉',
      startYear: 317,
      endYear: 420,
    });

    const rows = await buildDisambiguationCandidates(
      doc,
      'placeName',
      '武陵郡',
      cache,
      [],
      false,
      readPackFile,
      dilaDetailCache,
    );

    const dilaRow = rows.find((row) => row.sources.includes('DILA'));
    expect(dilaRow?.dynasty).toBe('東晉');
    expect(dilaRow?.description).toBe('東晉：（317 ~ 420）郡級行政中心所在地。');
  });

  it('accepts dilaDetailCache and onDilaDatesReady parameters for lazy date enrichment', async () => {
    const dilaDetailCache = new DilaPlaceDetailCache(null, null);
    const onDilaDatesReady = jest.fn();

    const doc = parseEntities(createEntitiesScaffold());
    const cache = new AuthorityCache(null, null);

    // Call with the new optional parameters; should not throw or crash.
    const rows = await buildDisambiguationCandidates(
      doc,
      'placeName',
      'nonexistent',
      cache,
      [], // no enabled authorities to keep results deterministic
      false,
      undefined,
      dilaDetailCache,
      undefined,
      onDilaDatesReady,
    );

    // Should return an array (possibly empty with no authorities/packs/entities).
    expect(Array.isArray(rows)).toBe(true);
  });

  it('merges manually selected candidates', () => {
    const merged = mergeSelectedCandidates([
      {
        id: 'a',
        label: 'A',
        sources: ['Wikidata'],
        authorityIds: [{ type: 'Wikidata', value: 'https://www.wikidata.org/wiki/Q1' }],
      },
      {
        id: 'b',
        label: 'B',
        sources: ['VIAF'],
        authorityIds: [{ type: 'VIAF', value: 'https://viaf.org/viaf/99' }],
      },
    ]);
    expect(merged?.sources).toEqual(['Wikidata', 'VIAF']);
    expect(merged?.authorityIds).toHaveLength(2);
  });

  it('dedupes central-database candidates by centralEntityId when re-merging cache', () => {
    const freshCentral: DisambiguationCandidate = {
      id: 'person-cedb-1',
      label: '江德麟',
      romanizedName: 'Jiang De Lin',
      sources: ['central-database'],
      centralEntityId: 'person-cedb-1',
      fromEntityFile: true,
    };
    const cached: DisambiguationCandidate = {
      ...freshCentral,
      sources: ['central-database', 'Wikidata'],
    };

    const rows = mergeCandidates([[freshCentral], [cached]]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.centralEntityId).toBe('person-cedb-1');
    expect(rows[0]?.sources).toEqual(['central-database', 'Wikidata']);
  });

  it('collapses Local/Central provenance to Central for synced entity candidates', () => {
    expect(isOwnDatabaseSource('central-database')).toBe(true);
    expect(isOwnDatabaseSource('entity-file')).toBe(true);
    expect(isOwnDatabaseSource('Wikidata')).toBe(false);
    expect(centralizeOwnDatabaseSources(['central-database', 'Wikidata', 'entity-file'])).toEqual([
      'central-database',
      'Wikidata',
    ]);
    expect(centralizeOwnDatabaseSources(['Wikidata'])).toEqual(['Wikidata']);

    const linked = asSyncedEntityCandidate(
      {
        id: 'person-cedb-1',
        label: '王羲之',
        sources: ['central-database', 'CBDB'],
        centralEntityId: 'person-cedb-1',
        fromEntityFile: true,
      },
      'person-pedb-9',
    );
    expect(linked.sources).toEqual(['central-database', 'CBDB']);
    expect(linked.localEntityId).toBe('person-pedb-9');
    expect(linked.centralEntityId).toBeUndefined();

    const unlinked = asSyncedEntityCandidate(
      {
        id: 'person-cedb-2',
        label: '王獻之',
        sources: ['central-database'],
        centralEntityId: 'person-cedb-2',
        fromEntityFile: true,
      },
      null,
    );
    expect(unlinked.sources).toEqual(['central-database']);
    expect(unlinked.localEntityId).toBeUndefined();
    expect(unlinked.centralEntityId).toBe('person-cedb-2');
  });

  it('builds external links for candidates', () => {
    const links = candidateLinks({
      id: 'x',
      label: 'Test',
      sources: ['Wikidata', 'VIAF'],
      uri: 'https://www.wikidata.org/wiki/Q42',
      description: 'WKP|Q42 · viaf.org/viaf/123',
    });
    const wikidata = links.find((link) => link.kind === 'wikidata');
    expect(wikidata?.url).toBe('https://www.wikidata.org/wiki/Q42');
    expect(links.some((link) => link.kind === 'viaf' && link.url.includes('123'))).toBe(true);
  });

  it('links Wikidata candidates to the item page (not enwiki sitelink)', () => {
    const links = candidateLinks({
      id: 'x',
      label: '陳卓',
      sources: ['Wikidata'],
      uri: 'https://www.wikidata.org/wiki/Q65884952',
    });
    expect(links[0]?.url).toBe('https://www.wikidata.org/wiki/Q65884952');
    expect(links[0]?.title).toBe('Wikidata (Q65884952)');
  });

  it('builds a BUDA show link from a Wikidata BDRC id (no private pack required)', () => {
    const links = candidateLinks({
      id: 'x',
      label: 'Test',
      sources: ['Wikidata'],
      uri: 'https://www.wikidata.org/wiki/Q42',
      authorityIds: [
        { type: 'Wikidata', value: 'Q42' },
        { type: 'BDRC', value: 'P1KG18539' },
      ],
    });
    const bdrc = links.find((link) => link.kind === 'bdrc');
    expect(bdrc?.url).toBe('https://library.bdrc.io/show/bdr:P1KG18539');
    expect(bdrc?.title).toBe('BDRC P1KG18539');
  });

  it('strips BUDA search-state query strings from BDRC URLs', () => {
    const links = candidateLinks({
      id: 'x',
      label: 'Test',
      sources: ['Wikidata'],
      description: 'https://library.bdrc.io/show/bdr:P1KG18539?s=session',
    });
    expect(links.find((link) => link.kind === 'bdrc')?.url).toBe(
      'https://library.bdrc.io/show/bdr:P1KG18539',
    );
  });

  describe('candidatePassesYearFilter', () => {
    const base: DisambiguationCandidate = { id: 'x', label: 'x', sources: ['Wikidata'] };

    it('passes everything when the filter mode is none', () => {
      expect(candidatePassesYearFilter(base, { mode: 'none', start: 0, end: 100 })).toBe(true);
      expect(candidatePassesYearFilter(base)).toBe(true);
    });

    it('limit mode keeps overlapping ranges and excludes undated candidates', () => {
      const dated = { ...base, startYear: 226, endYear: 249 };
      expect(candidatePassesYearFilter(dated, { mode: 'limit', start: 200, end: 300 })).toBe(true);
      expect(candidatePassesYearFilter(dated, { mode: 'limit', start: 300, end: 400 })).toBe(false);
      expect(candidatePassesYearFilter(base, { mode: 'limit', start: 200, end: 300 })).toBe(false);
    });

    it('exclude mode drops overlapping ranges and keeps undated candidates', () => {
      const dated = { ...base, startYear: 226, endYear: 249 };
      expect(candidatePassesYearFilter(dated, { mode: 'exclude', start: 200, end: 300 })).toBe(
        false,
      );
      expect(candidatePassesYearFilter(dated, { mode: 'exclude', start: 300, end: 400 })).toBe(
        true,
      );
      expect(candidatePassesYearFilter(base, { mode: 'exclude', start: 200, end: 300 })).toBe(true);
    });

    it('exclude mode uses birth and mean dates rather than death alone', () => {
      const diesLate = { ...base, startYear: 100, endYear: 250 };
      const meanTooLate = { ...base, startYear: 100, endYear: 500 };
      const bornTooLate = { ...base, startYear: 201, endYear: 250 };
      const filter = { mode: 'exclude' as const, start: 200, end: 2000 };

      expect(candidatePassesYearFilter(diesLate, filter)).toBe(true);
      expect(candidatePassesYearFilter(meanTooLate, filter)).toBe(false);
      expect(candidatePassesYearFilter(bornTooLate, filter)).toBe(false);
    });

    it('treats a single-year candidate (only startYear) as a point in time', () => {
      const born = { ...base, startYear: 1990 };
      expect(candidatePassesYearFilter(born, { mode: 'limit', start: 1980, end: 2000 })).toBe(true);
      expect(candidatePassesYearFilter(born, { mode: 'limit', start: 2000, end: 2010 })).toBe(
        false,
      );
    });

    it('normalizes a reversed range', () => {
      const dated = { ...base, startYear: 226, endYear: 249 };
      expect(candidatePassesYearFilter(dated, { mode: 'limit', start: 300, end: 200 })).toBe(true);
    });

    it('filters CBDB-style index/floruit years carried on the candidate', () => {
      const indexAnchor: DisambiguationCandidate = {
        ...base,
        startYear: 1035,
        endYear: 1095,
        dateSource: 'index',
      };
      expect(candidatePassesYearFilter(indexAnchor, { mode: 'limit', start: 960, end: 1280 })).toBe(
        true,
      );
      expect(candidatePassesYearFilter(indexAnchor, { mode: 'limit', start: 400, end: 600 })).toBe(
        false,
      );
    });
  });

  describe('toAuthoritySourcedFields', () => {
    it('mints floruit as asFloruit and does not mint index years as vitals', () => {
      const floruit = toAuthoritySourcedFields([
        {
          id: 'cbdb:1',
          label: '活躍',
          sources: ['CBDB'],
          startYear: 479,
          endYear: 502,
          dateSource: 'floruit',
          authorityMetadata: { dateSource: 'floruit', startYear: 479, endYear: 502 },
          description: '活躍 (fl. 479–502, 齊)',
        },
      ]);
      expect(floruit?.[0]?.asFloruit).toBe(true);
      expect(floruit?.[0]?.startYear).toBe(479);
      expect(floruit?.[0]?.endYear).toBe(502);
      expect(floruit?.[0]?.description).toBe('活躍 (fl. 479–502, 齊)');

      const indexOnly = toAuthoritySourcedFields([
        {
          id: 'cbdb:2',
          label: '指數',
          sources: ['CBDB'],
          startYear: 1035,
          endYear: 1095,
          dateSource: 'index',
          authorityMetadata: { dateSource: 'index', startYear: 1035, endYear: 1095 },
          description: '指數 (fl. 1065, 宋)',
        },
      ]);
      expect(indexOnly?.[0]?.startYear).toBeUndefined();
      expect(indexOnly?.[0]?.endYear).toBeUndefined();
      expect(indexOnly?.[0]?.asFloruit).toBeUndefined();
      expect(indexOnly?.[0]?.description).toBe('指數 (宋)');
    });
  });
});
