import {
  addEntity,
  addOfficeRelation,
  appendAuthoritySourcedValues,
  backfillEntityTimestamps,
  createEntitiesScaffold,
  findEntity,
  getDatabaseId,
  getEntityChanged,
  isEntityDatabase,
  GROGNARD_AUTOTAG_RESP,
  mergedPeriodDisplay,
  mintEntityId,
  nextEntityId,
  parseEntities,
  readOfficeRelations,
  serializeEntities,
  TAG_TO_KIND,
  touchEntity,
} from './entities';
import { readEntityValueProvenance } from './entityProvenance';

const UUID_ID =
  /^(person|place|org|work|office)-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('entities scaffold', () => {
  it('creates an empty TEI standoff with core lists and a dedicated office list', () => {
    const doc = parseEntities(createEntitiesScaffold('test-db-id'));
    expect(doc.getElementsByTagName('parsererror')).toHaveLength(0);
    for (const list of ['listPerson', 'listPlace', 'listOrg', 'listBibl']) {
      expect(doc.getElementsByTagName(list).length).toBeGreaterThanOrEqual(1);
    }
    expect(
      Array.from(doc.getElementsByTagName('listOrg')).some(
        (list) => list.getAttribute('type') === 'offices',
      ),
    ).toBe(true);
    expect(getDatabaseId(doc)).toBe('test-db-id');
    expect(isEntityDatabase(doc)).toBe(true);
  });
});

describe('nextEntityId', () => {
  it('starts at 000001 per type and is typed', () => {
    const doc = parseEntities(createEntitiesScaffold());
    expect(nextEntityId(doc, 'person')).toBe('person-000001');
    expect(nextEntityId(doc, 'place')).toBe('place-000001');
  });

  it('takes the highest existing sequential suffix + 1, independent of insertion order', () => {
    const doc = parseEntities(createEntitiesScaffold());
    // Grandfathered sequential ids (as minted by pre-UUID versions).
    addEntity(doc, 'person', { name: 'A' }).element.setAttribute('xml:id', 'person-000001');
    addEntity(doc, 'person', { name: 'B' }).element.setAttribute('xml:id', 'person-000002');
    expect(nextEntityId(doc, 'person')).toBe('person-000003');
    // places are numbered independently
    expect(nextEntityId(doc, 'place')).toBe('place-000001');
  });

  it('skips ids that already exist (collision-safe)', () => {
    const doc = parseEntities(createEntitiesScaffold());
    // pre-seed a gap: person-000005 present, lower ones absent
    const { element } = addEntity(doc, 'person', { name: 'X' });
    element.setAttribute('xml:id', 'person-000005');
    expect(nextEntityId(doc, 'person')).toBe('person-000006');
  });
});

describe('mintEntityId', () => {
  it('mints a kind-prefixed UUID that is a legal xml:id (never starts with a digit)', () => {
    for (const kind of ['person', 'place', 'org', 'work', 'office'] as const) {
      const id = mintEntityId(kind);
      expect(id).toMatch(UUID_ID);
      expect(id.startsWith(`${kind === 'work' ? 'work' : kind}-`)).toBe(true);
      expect(/^\d/.test(id)).toBe(false);
    }
  });

  it('mints unique ids', () => {
    const ids = new Set(Array.from({ length: 50 }, () => mintEntityId('person')));
    expect(ids.size).toBe(50);
  });
});

describe('office entities and relations', () => {
  it('stores offices separately from organizations in TEI-compatible listOrg records', () => {
    const doc = parseEntities(createEntitiesScaffold());
    const office = addEntity(doc, 'office', {
      name: '尚書省',
      authorityIds: [{ type: 'CBDB', value: '42' }],
      officeTypeIds: ['cbdb:office-type:0603'],
    });
    const org = addEntity(doc, 'org', { name: '白馬寺' });
    expect(office.element.localName).toBe('org');
    expect(office.element.getAttribute('type')).toBe('office');
    expect(office.element.getElementsByTagName('orgName')[0]?.textContent).toBe('尚書省');
    expect(office.element.getElementsByTagName('state')[0]?.getAttribute('ref')).toBe(
      'cbdb:office-type:0603',
    );
    expect(org.element.getAttribute('type')).toBeNull();
    expect(office.id).toMatch(/^office-/);
  });

  it('deduplicates parentOf assertions and round-trips their provenance', () => {
    const doc = parseEntities(createEntitiesScaffold());
    const parentId = addEntity(doc, 'office', { name: '尚書省' }).id;
    const childId = addEntity(doc, 'office', { name: '吏部' }).id;
    const relation = {
      parentId,
      childId,
      source: 'norbert',
      rule: 'office-concatenation',
      sourceIds: ['1', '2'],
      confidence: 'inferred' as const,
    };
    expect(addOfficeRelation(doc, relation).created).toBe(true);
    expect(addOfficeRelation(doc, relation).created).toBe(false);
    const reparsed = parseEntities(serializeEntities(doc));
    const rows = readOfficeRelations(reparsed);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject(relation);
  });
});

describe('entity changed timestamps', () => {
  it('addEntity stamps a changed timestamp', () => {
    const doc = parseEntities(createEntitiesScaffold());
    const { element } = addEntity(doc, 'person', { name: '張衡' });
    expect(getEntityChanged(element)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('touchEntity creates then updates the timestamp in place (one note)', () => {
    const doc = parseEntities(createEntitiesScaffold());
    const { element } = addEntity(doc, 'person', { name: '張衡' });
    touchEntity(element, '2020-01-01T00:00:00.000Z');
    expect(getEntityChanged(element)).toBe('2020-01-01T00:00:00.000Z');
    touchEntity(element, '2026-07-23T12:00:00.000Z');
    expect(getEntityChanged(element)).toBe('2026-07-23T12:00:00.000Z');
    const changedNotes = Array.from(element.getElementsByTagName('note')).filter(
      (n) => n.getAttribute('type') === 'grognard-changed',
    );
    expect(changedNotes).toHaveLength(1);
  });

  it('backfills only entities that lack a timestamp', () => {
    const doc = parseEntities(createEntitiesScaffold());
    const { element: stamped } = addEntity(doc, 'person', { name: 'A' });
    touchEntity(stamped, '2019-05-05T00:00:00.000Z');
    // simulate a legacy record with no timestamp
    const { element: legacy } = addEntity(doc, 'person', { name: 'B' });
    legacy.getElementsByTagName('note')[0]!.remove(); // strip its changed note
    const count = backfillEntityTimestamps(doc, '2026-07-23T00:00:00.000Z');
    expect(count).toBe(1);
    expect(getEntityChanged(stamped)).toBe('2019-05-05T00:00:00.000Z');
    expect(getEntityChanged(legacy)).toBe('2026-07-23T00:00:00.000Z');
  });

  it('round-trips the changed timestamp through serialization', () => {
    const doc = parseEntities(createEntitiesScaffold());
    const { id } = addEntity(doc, 'person', { name: '張衡' });
    const reparsed = parseEntities(serializeEntities(doc));
    expect(getEntityChanged(findEntity(reparsed, id)!)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('addEntity', () => {
  it('writes a typed entity with name, authority idnos, and provenance', () => {
    const doc = parseEntities(createEntitiesScaffold());
    const { id } = addEntity(
      doc,
      'person',
      {
        name: '張衡',
        authorityIds: [
          { type: 'CBDB', value: '1762' },
          { type: 'Wikidata', value: 'Q11332' },
        ],
      },
      GROGNARD_AUTOTAG_RESP,
    );

    expect(id).toMatch(UUID_ID);
    const el = findEntity(doc, id)!;
    expect(el.nodeName).toBe('person');
    expect(el.getAttribute('resp')).toBe(GROGNARD_AUTOTAG_RESP);
    expect(el.getElementsByTagName('persName')[0]?.textContent).toBe('張衡');

    const idnos = Array.from(el.getElementsByTagName('idno'));
    expect(idnos.map((i) => `${i.getAttribute('type')}:${i.textContent}`)).toEqual([
      'CBDB:1762',
      'Wikidata:Q11332',
    ]);

    // lands in the right list
    expect(doc.getElementsByTagName('listPerson')[0]?.getElementsByTagName('person')).toHaveLength(
      1,
    );
  });

  it('writes repeatable nobleTitle relations with decomposed title parts', () => {
    const doc = parseEntities(createEntitiesScaffold());
    const { id } = addEntity(doc, 'person', {
      name: '範',
      nobleTitles: [
        {
          ref: 'norbert:noble-title:zhou-wang',
          resp: GROGNARD_AUTOTAG_RESP,
          source: 'doc-1',
          when: '2026-07-26T00:00:00.000Z',
          placeName: { text: '鄱陽', ref: 'norbert:place:poyang' },
          roleName: { text: '王', ref: 'norbert:rank:wang' },
        },
        {
          ref: 'norbert:noble-title:prince-of-b',
          placeName: { text: 'B', ref: 'norbert:place:b' },
          roleName: { text: 'Prince', ref: 'norbert:rank:prince' },
          posthumousName: { text: '景王', ref: 'norbert:posthumous:jing-wang' },
        },
      ],
    });

    const nobleTitles = Array.from(findEntity(doc, id)!.getElementsByTagName('nobleTitle'));
    expect(nobleTitles).toHaveLength(2);
    expect(nobleTitles[0]?.getAttribute('ref')).toBe('norbert:noble-title:zhou-wang');
    expect(nobleTitles[0]?.getAttribute('resp')).toBe(GROGNARD_AUTOTAG_RESP);
    expect(nobleTitles[0]?.getAttribute('source')).toBe('doc-1');
    expect(nobleTitles[0]?.getAttribute('when')).toBe('2026-07-26T00:00:00.000Z');
    expect(nobleTitles[0]?.getElementsByTagName('placeName')[0]?.textContent).toBe('鄱陽');
    expect(nobleTitles[0]?.getElementsByTagName('roleName')[0]?.textContent).toBe('王');
    const posthumous = nobleTitles[1]?.getElementsByTagName('persName')[0];
    expect(posthumous?.textContent).toBe('景王');
    expect(posthumous?.getAttribute('type')).toBe('posthumous');
    expect(nobleTitles[1]?.getElementsByTagName('placeName')[0]?.getAttribute('ref')).toBe(
      'norbert:place:b',
    );
  });

  it('writes dual-script names: typed/lang primary, -Latn romanization, typed alt names', () => {
    const doc = parseEntities(createEntitiesScaffold());
    const { id } = addEntity(doc, 'person', {
      name: '張衡',
      nameLang: 'zh-Hant',
      romanizedName: 'Zhang Heng',
      altNames: [{ text: '平子', type: 'courtesy' }, { text: '张衡' }],
    });

    const names = Array.from(findEntity(doc, id)!.getElementsByTagName('persName'));
    expect(
      names.map((el) => [el.textContent, el.getAttribute('xml:lang'), el.getAttribute('type')]),
    ).toEqual([
      ['張衡', 'zh-Hant', 'primary'],
      ['Zhang Heng', 'zh-Latn', null],
      ['平子', null, 'courtesy'],
      ['张衡', null, null],
    ]);
  });

  it('dedupes alt names against the primary and romanized names', () => {
    const doc = parseEntities(createEntitiesScaffold());
    const { id } = addEntity(doc, 'person', {
      name: '張衡',
      nameLang: 'zh-Hant',
      romanizedName: 'Zhang Heng',
      altNames: [{ text: '張衡' }, { text: 'Zhang Heng' }, { text: ' 平子 ' }, { text: '平子' }],
    });
    const names = Array.from(findEntity(doc, id)!.getElementsByTagName('persName'));
    expect(names.map((el) => el.textContent)).toEqual(['張衡', 'Zhang Heng', '平子']);
  });

  it('keeps legacy calls attribute-free', () => {
    const doc = parseEntities(createEntitiesScaffold());
    const { id } = addEntity(doc, 'person', { name: '張衡' });
    const name = findEntity(doc, id)!.getElementsByTagName('persName')[0]!;
    expect(name.getAttribute('xml:lang')).toBeNull();
    expect(name.getAttribute('type')).toBeNull();
  });

  it('round-trips xml:lang and type attributes through serialization', () => {
    const doc = parseEntities(createEntitiesScaffold());
    addEntity(doc, 'person', {
      name: '張衡',
      nameLang: 'zh-Hant',
      romanizedName: 'Zhang Heng',
      altNames: [{ text: '平子', type: 'courtesy' }],
    });
    const reparsed = parseEntities(serializeEntities(doc));
    const names = Array.from(reparsed.getElementsByTagName('persName'));
    expect(
      names.map((el) => [el.textContent, el.getAttribute('xml:lang'), el.getAttribute('type')]),
    ).toEqual([
      ['張衡', 'zh-Hant', 'primary'],
      ['Zhang Heng', 'zh-Latn', null],
      ['平子', null, 'courtesy'],
    ]);
  });

  it('stores an authority cache note as JSON', () => {
    const doc = parseEntities(createEntitiesScaffold());
    const { id } = addEntity(doc, 'place', {
      name: '洛陽',
      cache: { source: 'CHGIS', data: { lat: 34.6, lng: 112.4 }, when: '2026-07-03T00:00:00Z' },
    });
    const note = findEntity(doc, id)!.getElementsByTagName('note')[0]!;
    expect(note.getAttribute('type')).toBe('authority-cache');
    expect(note.getAttribute('source')).toBe('CHGIS');
    expect(JSON.parse(note.textContent!)).toEqual({ lat: 34.6, lng: 112.4 });
  });

  it('writes person life dates as birth/death @when, BCE as negative ISO years', () => {
    const doc = parseEntities(createEntitiesScaffold());
    const { id } = addEntity(doc, 'person', {
      name: '張衡',
      description: 'Han dynasty polymath',
      startYear: 78,
      endYear: 139,
    });
    const el = findEntity(doc, id)!;
    expect(el.getElementsByTagName('birth')[0]?.getAttribute('when')).toBe('0078');
    expect(el.getElementsByTagName('death')[0]?.getAttribute('when')).toBe('0139');
    const note = el.getElementsByTagName('note')[0]!;
    expect(note.getAttribute('type')).toBe('description');
    expect(note.textContent).toBe('Han dynasty polymath');

    const { id: bceId } = addEntity(doc, 'person', {
      name: '孔子',
      startYear: -551,
      endYear: -479,
    });
    const bce = findEntity(doc, bceId)!;
    expect(bce.getElementsByTagName('birth')[0]?.getAttribute('when')).toBe('-0551');
    expect(bce.getElementsByTagName('death')[0]?.getAttribute('when')).toBe('-0479');
  });

  it('writes non-person years as a dates note', () => {
    const doc = parseEntities(createEntitiesScaffold());
    const { id } = addEntity(doc, 'place', { name: '洛陽', startYear: -1036, endYear: 938 });
    const note = findEntity(doc, id)!.getElementsByTagName('note')[0]!;
    expect(note.getAttribute('type')).toBe('dates');
    expect(note.textContent).toBe('-1036/0938');
  });

  it('round-trips through serialization', () => {
    const doc = parseEntities(createEntitiesScaffold());
    const { id } = addEntity(doc, 'org', { name: '道藏' });
    const reparsed = parseEntities(serializeEntities(doc));
    expect(findEntity(reparsed, id)?.nodeName).toBe('org');
    expect(reparsed.getElementsByTagName('org')).toHaveLength(1);
  });

  it('writes one element per source when two authorities agree on nationality', () => {
    const doc = parseEntities(createEntitiesScaffold());
    const { id } = addEntity(doc, 'person', {
      name: '劉善明',
      authorityAssertions: [
        { source: 'CBDB', nationality: [{ canonicalId: 'dynasty:song-liu', label: '宋(劉)' }] },
        { source: 'DILA', nationality: [{ canonicalId: 'dynasty:song-liu', label: '宋(劉)' }] },
      ],
    });
    const nationalities = Array.from(findEntity(doc, id)!.getElementsByTagName('nationality'));
    expect(nationalities).toHaveLength(2);
    expect(nationalities.map((el) => readEntityValueProvenance(el).source).sort()).toEqual([
      'CBDB',
      'DILA',
    ]);
    expect(nationalities.every((el) => el.textContent === '宋(劉)')).toBe(true);
  });

  it('writes two distinct birth elements when two authorities disagree on the year', () => {
    const doc = parseEntities(createEntitiesScaffold());
    const { id } = addEntity(doc, 'person', {
      name: '劉善明',
      authorityAssertions: [
        { source: 'CBDB', startYear: 420 },
        { source: 'DILA', startYear: 425 },
      ],
    });
    const births = Array.from(findEntity(doc, id)!.getElementsByTagName('birth'));
    expect(births).toHaveLength(2);
    expect(
      births.map((el) => [readEntityValueProvenance(el).source, el.getAttribute('when')]).sort(),
    ).toEqual([
      ['CBDB', '0420'],
      ['DILA', '0425'],
    ]);
  });

  it('leaves non-authorityAssertions callers producing the same XML as before', () => {
    const doc = parseEntities(createEntitiesScaffold());
    const { id } = addEntity(doc, 'person', {
      name: '張衡',
      startYear: 78,
      endYear: 139,
      nationality: [{ id: 'n1', canonicalId: 'dynasty:han', label: 'Han' }],
    });
    const el = findEntity(doc, id)!;
    expect(el.getElementsByTagName('birth')).toHaveLength(1);
    expect(el.getElementsByTagName('death')).toHaveLength(1);
    expect(el.getElementsByTagName('nationality')).toHaveLength(1);
  });
});

describe('mergedPeriodDisplay', () => {
  it('formats one fragment per source, joined by "; "', () => {
    expect(
      mergedPeriodDisplay([
        { source: 'CBDB', startYear: 420, endYear: 478 },
        { source: 'DILA', startYear: 704 },
      ]),
    ).toBe('CBDB: 420–478; DILA: 704–');
  });

  it('marks floruit ranges with "fl."', () => {
    expect(mergedPeriodDisplay([{ source: 'CBDB', startYear: 1120, asFloruit: true }])).toBe(
      'CBDB: fl. 1120–',
    );
  });

  it('collapses an equal start/end to a single year', () => {
    expect(mergedPeriodDisplay([{ source: 'DILA', startYear: 704, endYear: 704 }])).toBe(
      'DILA: 704',
    );
  });

  it('skips sources with no year data and returns undefined when none remain', () => {
    expect(
      mergedPeriodDisplay([{ source: 'CBDB', nationality: [{ canonicalId: 'x', label: 'Song' }] }]),
    ).toBeUndefined();
    expect(mergedPeriodDisplay(undefined)).toBeUndefined();
    expect(mergedPeriodDisplay([])).toBeUndefined();
  });
});

describe('appendAuthoritySourcedValues', () => {
  it('adds one element per new source and is a no-op for an exact re-add', () => {
    const doc = parseEntities(createEntitiesScaffold());
    const { id } = addEntity(doc, 'person', { name: '劉善明' });
    const el = findEntity(doc, id)!;

    const firstChange = appendAuthoritySourcedValues(doc, el, 'placeName', [
      { text: '彭城', source: 'CBDB' },
    ]);
    expect(firstChange).toBe(true);
    expect(el.getElementsByTagName('placeName')).toHaveLength(1);

    const secondChange = appendAuthoritySourcedValues(doc, el, 'placeName', [
      { text: '彭城', source: 'DILA' },
    ]);
    expect(secondChange).toBe(true);
    expect(el.getElementsByTagName('placeName')).toHaveLength(2);

    const noopChange = appendAuthoritySourcedValues(doc, el, 'placeName', [
      { text: '彭城', source: 'CBDB' },
    ]);
    expect(noopChange).toBe(false);
    expect(el.getElementsByTagName('placeName')).toHaveLength(2);
  });

  it('stamps authority provenance on note[type] values', () => {
    const doc = parseEntities(createEntitiesScaffold());
    const { id } = addEntity(doc, 'person', { name: '劉善明' });
    const el = findEntity(doc, id)!;
    appendAuthoritySourcedValues(doc, el, 'note', [
      { text: 'A Song dynasty official.', noteType: 'description', source: 'Wikidata' },
    ]);
    const note = Array.from(el.getElementsByTagName('note')).find(
      (n) => n.getAttribute('type') === 'description',
    )!;
    expect(readEntityValueProvenance(note)).toEqual({
      origin: 'authority',
      source: 'WIKIDATA',
      status: 'active',
    });
  });
});

describe('TAG_TO_KIND', () => {
  it('maps mention tags to entity kinds', () => {
    expect(TAG_TO_KIND.persName).toBe('person');
    expect(TAG_TO_KIND.placeName).toBe('place');
    expect(TAG_TO_KIND.orgName).toBe('org');
    expect(TAG_TO_KIND.title).toBe('work');
  });
});
