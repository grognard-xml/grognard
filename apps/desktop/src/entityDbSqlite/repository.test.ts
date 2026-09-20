import { EntitySqliteRepository } from './repository';
import { applyEntityDbMigrations } from './schema';
import { computeEntityContentHash, replaceEntityContentBetween } from './xmlCodec';

describe('EntitySqliteRepository', () => {
  it('shows cross-authority dynasty labels once while retaining their source rows', async () => {
    const repository = await EntitySqliteRepository.open();
    await repository.createEntity({ id: 'person-nationality-merge', kind: 'person' });
    const insertSql = `INSERT INTO person_nationalities
       (person_id, label, reference, origin, source, status, created_at, updated_at)
       VALUES (?, ?, ?, 'authority', ?, 'active', ?, ?)`;
    await repository.backend.run(insertSql, [
      'person-nationality-merge',
      '唐',
      'CBDB:dynasty:6',
      'CBDB',
      '2026-08-02',
      '2026-08-02',
    ]);
    await repository.backend.run(insertSql, [
      'person-nationality-merge',
      '唐朝',
      null,
      'Norbert',
      '2026-08-02',
      '2026-08-02',
    ]);

    expect((await repository.getPanelSummary('person-nationality-merge'))?.nationalities).toEqual([
      '唐',
    ]);
    expect(
      await repository.backend.get('SELECT COUNT(*) AS count FROM person_nationalities'),
    ).toEqual({ count: 2 });
    await repository.close();
  });

  it('creates subtype records and returns typed summaries', async () => {
    const repository = await EntitySqliteRepository.open();
    const entity = await repository.createEntity({ id: 'person-test-1', kind: 'person' });

    expect(entity.kind).toBe('person');
    expect(
      await repository.backend.get('SELECT 1 FROM people WHERE entity_id = ?', [entity.id]),
    ).toEqual({ 1: 1 });
    expect(await repository.integrityCheck()).toEqual(['ok']);
    await repository.close();
  });

  it('stores and replaces rich entity note fragments without touching descriptions', async () => {
    const repository = await EntitySqliteRepository.open();
    await repository.createEntity({
      id: 'person-note-1',
      kind: 'person',
      description: 'Short bio',
    });
    const first =
      '<div type="grognard-entity-note"><note type="body" xml:lang="fr">Bonjour <note place="foot">Source</note></note></div>';
    const second =
      '<div type="grognard-entity-note"><note type="body" xml:lang="zh">你好</note></div>';

    await repository.setEntityNote('person-note-1', first);
    expect(await repository.getEntityNotes('person-note-1')).toEqual([{ xml: first }]);
    expect((await repository.getEntity('person-note-1'))?.description).toBe('Short bio');

    await repository.setEntityNote('person-note-1', second);
    expect(await repository.getEntityNotes('person-note-1')).toEqual([{ xml: second }]);
    expect((await repository.getEntity('person-note-1'))?.description).toBe('Short bio');
    await repository.close();
  });

  it('searches active names without scanning the XML document', async () => {
    const repository = await EntitySqliteRepository.open();
    await repository.createEntity({
      id: 'person-search-1',
      kind: 'person',
      description: 'A person',
    });
    await repository.addName({
      entityId: 'person-search-1',
      text: '孔遺',
      isPrimary: true,
      origin: 'xml',
      source: 'legacy-xml',
    });
    await repository.backend.run(
      `INSERT INTO entity_authorities
        (entity_id, authority_type, authority_value, origin, source, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        'person-search-1',
        'Wikidata',
        'Q1',
        'authority',
        'Wikidata',
        'active',
        '2026-01-01',
        '2026-01-01',
      ],
    );

    expect(await repository.searchNames('person', '  孔遺 ')).toEqual([
      expect.objectContaining({
        id: 'person-search-1',
        label: '孔遺',
        description: 'A person',
        idnos: [{ type: 'Wikidata', value: 'Q1' }],
      }),
    ]);
    expect(await repository.searchNames('place', '孔遺')).toEqual([]);
    await repository.close();
  });

  it('normalizes VIAF/Wikidata URIs when attaching authorities', async () => {
    const repository = await EntitySqliteRepository.open();
    await repository.createEntity({ id: 'person-auth-1', kind: 'person' });
    expect(
      await repository.attachAuthority({
        entityId: 'person-auth-1',
        type: 'viaf',
        value: 'http://viaf.org/viaf/68484316',
      }),
    ).toBe(true);
    expect((await repository.getPanelSummary('person-auth-1'))?.authorities).toEqual([
      { type: 'VIAF', value: '68484316' },
    ]);
    expect(
      await repository.attachAuthority({
        entityId: 'person-auth-1',
        type: 'VIAF',
        value: '68484316',
      }),
    ).toBe(false);
    expect(
      await repository.attachAuthority({
        entityId: 'person-auth-1',
        type: 'wikidata',
        value: 'http://www.wikidata.org/entity/Q42',
      }),
    ).toBe(true);
    expect((await repository.getPanelSummary('person-auth-1'))?.authorities).toEqual(
      expect.arrayContaining([
        { type: 'VIAF', value: '68484316' },
        { type: 'Wikidata', value: 'Q42' },
      ]),
    );
    await repository.close();
  });

  it('updates one name transactionally and preserves a tombstone', async () => {
    const repository = await EntitySqliteRepository.open();
    await repository.createEntity({
      id: 'person-test-2',
      kind: 'person',
      now: '2026-01-01T00:00:00.000Z',
    });
    const name = await repository.addName({
      entityId: 'person-test-2',
      text: '孔遺',
      isPrimary: true,
      origin: 'xml',
      source: 'legacy-xml',
      now: '2026-01-01T00:00:01.000Z',
    });

    expect((await repository.getSummary('person-test-2'))?.names).toHaveLength(1);
    await repository.tombstoneName(name.id, 'user-deleted', '2026-01-01T00:00:02.000Z');

    expect(await repository.listNames('person-test-2')).toEqual([]);
    expect((await repository.listNames('person-test-2', true))[0]).toMatchObject({
      text: '孔遺',
      status: 'withdrawn',
      origin: 'xml',
    });
    expect(
      await repository.backend.get(
        'SELECT reason FROM entity_tombstones WHERE table_name = ? AND row_id = ?',
        ['entity_names', name.id],
      ),
    ).toEqual({ reason: 'user-deleted' });
    expect((await repository.getEntity('person-test-2'))?.revision).toBe(2);
    await repository.close();
  });

  it('updates and tombstones all active assertions for a displayed name', async () => {
    const repository = await EntitySqliteRepository.open();
    await repository.createEntity({ id: 'person-name-ops', kind: 'person' });
    await repository.addName({
      entityId: 'person-name-ops',
      text: '孔遺',
      nameType: 'courtesy',
      isPrimary: true,
    });
    await repository.addName({
      entityId: 'person-name-ops',
      text: '孔遺',
      origin: 'authority',
      source: 'Wikidata',
    });

    expect(
      await repository.updateNamesByText({
        entityId: 'person-name-ops',
        text: '孔遺',
        nameType: 'variant',
        language: 'zh-Hant',
      }),
    ).toBe(2);
    expect(await repository.listNames('person-name-ops')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ nameType: 'variant', language: 'zh-Hant' }),
      ]),
    );

    // Ordinary type edits now collapse same-text/same-type rows immediately.
    expect(await repository.tombstoneNamesByText('person-name-ops', '孔遺')).toBe(1);
    expect(await repository.listNames('person-name-ops')).toEqual([]);
    expect(
      await repository.backend.get(
        "SELECT COUNT(*) AS count FROM entity_tombstones WHERE entity_id = ? AND table_name = 'entity_names'",
        ['person-name-ops'],
      ),
    ).toEqual({ count: 2 });
    await repository.close();
  });

  it('removes user names and rejects authority names while promoting a survivor', async () => {
    const repository = await EntitySqliteRepository.open();
    await repository.createEntity({ id: 'person-remove-name', kind: 'person' });
    await repository.addName({ entityId: 'person-remove-name', text: 'Primary', isPrimary: true });
    const authorityName = await repository.addName({
      entityId: 'person-remove-name',
      text: 'Authority variant',
      origin: 'authority',
      source: 'Wikidata',
    });

    expect(await repository.removeNameByText('person-remove-name', 'Authority variant')).toBe(true);
    expect(await repository.listNames('person-remove-name')).toEqual([
      expect.objectContaining({ text: 'Primary', isPrimary: true }),
    ]);
    expect(await repository.listNames('person-remove-name', true)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: authorityName.id, status: 'rejected' }),
      ]),
    );
    await repository.close();
  });

  it('returns a panel snapshot with fields and provenance-bearing assertions', async () => {
    const repository = await EntitySqliteRepository.open();
    await repository.createEntity({
      id: 'person-panel-1',
      kind: 'person',
      description: 'A scholar',
    });
    await repository.addName({ entityId: 'person-panel-1', text: '孔遺', isPrimary: true });
    await repository.backend.run(
      `INSERT INTO entity_authorities
          (entity_id, authority_type, authority_value, origin, source, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        'person-panel-1',
        'Wikidata',
        'Q1',
        'authority',
        'Wikidata',
        'active',
        '2026-01-01',
        '2026-01-01',
      ],
    );
    await repository.backend.run(
      `INSERT INTO entity_dates
          (entity_id, date_kind, start_year, origin, source, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        'person-panel-1',
        'birth',
        479,
        'authority',
        'Norbert',
        'active',
        '2026-01-01',
        '2026-01-01',
      ],
    );

    const snapshot = (await repository.getPanelSummary('person-panel-1'))!;
    expect(snapshot).toMatchObject({
      description: 'A scholar',
      authorities: [{ type: 'Wikidata', value: 'Q1' }],
      startYear: 479,
      assertions: expect.arrayContaining([
        expect.objectContaining({ element: 'idno', value: 'Q1', source: 'Wikidata' }),
        expect.objectContaining({ element: 'birth', value: '479', source: 'Norbert' }),
        expect.objectContaining({ element: 'note', noteType: 'description', value: 'A scholar' }),
      ]),
    });
    expect(await repository.listPanelSummaries()).toEqual([snapshot]);
    await repository.close();
  });

  it('reads the database UUID from SQLite metadata without XML export', async () => {
    const repository = await EntitySqliteRepository.open();
    await repository.backend.run('INSERT INTO database_metadata (key, value) VALUES (?, ?)', [
      'database_id',
      'db-test-uuid',
    ]);
    expect(await repository.getDatabaseId()).toBe('db-test-uuid');
    await repository.close();
  });

  it('includes noble titles and work authors in the panel snapshot', async () => {
    const repository = await EntitySqliteRepository.open();
    await repository.createEntity({ id: 'person-title-1', kind: 'person' });
    await repository.backend.run(
      `INSERT INTO person_titles
          (person_id, dynasty, place_name, role_name, posthumous_name, reference, origin, source, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        'person-title-1',
        '宋',
        '荊國',
        '公',
        '文忠',
        'T1',
        'authority',
        'Norbert',
        'active',
        '2026-01-01',
        '2026-01-01',
      ],
    );
    await repository.createEntity({ id: 'work-author-1', kind: 'work' });
    await repository.backend.run(
      `INSERT INTO work_authors
          (work_id, label, reference, origin, source, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        'work-author-1',
        '孔遺',
        'person-title-1',
        'authority',
        'CBDB',
        'active',
        '2026-01-01',
        '2026-01-01',
      ],
    );

    expect((await repository.getPanelSummary('person-title-1'))?.nobleTitles).toEqual([
      expect.objectContaining({ dynasty: '宋', fief: '荊國', title: '公' }),
    ]);
    expect((await repository.getPanelSummary('work-author-1'))?.authors).toEqual([
      expect.objectContaining({ name: '孔遺', ref: 'person-title-1' }),
    ]);
    expect((await repository.getPanelSummary('person-title-1'))?.assertions).toEqual(
      expect.arrayContaining([expect.objectContaining({ element: 'nobleTitle', value: '公' })]),
    );
    expect((await repository.getPanelSummary('work-author-1'))?.assertions).toEqual(
      expect.arrayContaining([expect.objectContaining({ element: 'author', value: '孔遺' })]),
    );
    await repository.close();
  });

  it('detects duplicate active authority identifiers from SQLite', async () => {
    const repository = await EntitySqliteRepository.open();
    await repository.createEntity({ id: 'person-dup-1', kind: 'person' });
    await repository.createEntity({ id: 'person-dup-2', kind: 'person' });
    for (const id of ['person-dup-1', 'person-dup-2']) {
      await repository.backend.run(
        `INSERT INTO entity_authorities
            (entity_id, authority_type, authority_value, origin, source, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          'Wikidata',
          'https://www.wikidata.org/entity/Q42',
          'authority',
          'Wikidata',
          'active',
          '2026-01-01',
          '2026-01-01',
        ],
      );
    }
    expect(await repository.listAuthorityDuplicates()).toEqual([
      { type: 'Wikidata', value: 'Q42', entityIds: ['person-dup-1', 'person-dup-2'] },
    ]);
    await repository.backend.run(
      `INSERT INTO entity_decisions
          (entity_id, decision_type, target_refs, origin, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      ['person-dup-1', 'duplicate-ok', '#person-dup-1 #person-dup-2', 'user', '2026-01-01'],
    );
    expect(await repository.listAuthorityDuplicates()).toEqual([]);
    await repository.close();
  });

  it('marks intentional duplicate groups and backfills missing target_refs from XML notes', async () => {
    const repository = await EntitySqliteRepository.open();
    await repository.createEntity({ id: 'person-dup-a', kind: 'person' });
    await repository.createEntity({ id: 'person-dup-b', kind: 'person' });
    for (const id of ['person-dup-a', 'person-dup-b']) {
      await repository.attachAuthority({
        entityId: id,
        type: 'Wikidata',
        value: 'Q99',
        origin: 'authority',
        source: 'Wikidata',
      });
    }
    expect(await repository.listAuthorityDuplicates()).toEqual([
      { type: 'Wikidata', value: 'Q99', entityIds: ['person-dup-a', 'person-dup-b'] },
    ]);
    expect(await repository.markDuplicateIntentional(['person-dup-a', 'person-dup-b'])).toBe(true);
    expect(await repository.listAuthorityDuplicates()).toEqual([]);

    const broken = await EntitySqliteRepository.open();
    await broken.createEntity({ id: 'person-old-1', kind: 'person' });
    await broken.createEntity({ id: 'person-old-2', kind: 'person' });
    await broken.backend.run(
      `INSERT INTO entity_decisions
          (entity_id, decision_type, target_refs, origin, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      ['person-old-1', 'duplicate-ok', null, 'xml', '2026-01-01'],
    );
    for (const id of ['person-old-1', 'person-old-2']) {
      await broken.attachAuthority({
        entityId: id,
        type: 'Wikidata',
        value: 'Q100',
        origin: 'authority',
        source: 'Wikidata',
      });
    }
    expect(await broken.listAuthorityDuplicates()).toHaveLength(1);
    const report = await broken.backfillDecisionTargets([
      {
        entityId: 'person-old-1',
        decisionType: 'duplicate-ok',
        targetRefs: '#person-old-1 #person-old-2',
      },
    ]);
    expect(report).toEqual({ updated: 1, inserted: 0, unchanged: 0 });
    expect(await broken.listAuthorityDuplicates()).toEqual([]);
    expect(
      await broken.backfillDecisionTargets([
        {
          entityId: 'person-old-1',
          decisionType: 'duplicate-ok',
          targetRefs: '#person-old-1 #person-old-2',
        },
      ]),
    ).toEqual({ updated: 0, inserted: 0, unchanged: 1 });
    await broken.close();
    await repository.close();
  });

  it('soft-deletes entities and merges names, authorities, and central mappings', async () => {
    const repository = await EntitySqliteRepository.open();
    await repository.createPopulatedEntity({
      id: 'person-keep',
      kind: 'person',
      names: [{ text: '甲', isPrimary: true }],
      authorities: [{ type: 'CBDB', value: '1', origin: 'authority', source: 'CBDB' }],
      description: 'Keeper bio',
    });
    await repository.createPopulatedEntity({
      id: 'person-drop',
      kind: 'person',
      names: [
        { text: '甲', isPrimary: true },
        { text: '號甲', nameType: 'courtesy' },
      ],
      authorities: [
        { type: 'CBDB', value: '1', origin: 'authority', source: 'CBDB' },
        { type: 'Wikidata', value: 'Q1', origin: 'authority', source: 'Wikidata' },
      ],
      familyName: '甲氏',
    });
    await repository.setCentralMapping('person-drop', 'user-1', 'central-drop');
    await repository.setCentralMapping('person-keep', 'user-1', 'central-keep');
    await repository.setCentralMapping('person-drop', 'user-2', 'central-only-drop');

    const merged = await repository.mergeEntities('person-keep', ['person-drop']);
    expect(merged.remap).toEqual({ 'person-drop': 'person-keep' });
    expect(merged.centralConflicts).toEqual([
      {
        userStableId: 'user-1',
        keptCentralId: 'central-keep',
        droppedCentralId: 'central-drop',
      },
    ]);
    expect((await repository.getEntity('person-drop'))?.deletedAt).toBeTruthy();
    expect(await repository.listEntityIds('person')).toEqual(['person-keep']);
    expect(
      (await repository.getPanelSummary('person-keep'))?.names.map((name) => name.text),
    ).toEqual(expect.arrayContaining(['甲', '號甲']));
    expect((await repository.getPanelSummary('person-keep'))?.authorities).toEqual(
      expect.arrayContaining([
        { type: 'CBDB', value: '1' },
        { type: 'Wikidata', value: 'Q1' },
      ]),
    );
    expect(await repository.getCentralId('person-keep', 'user-2')).toBe('central-only-drop');
    expect(await repository.getCentralId('person-keep', 'user-1')).toBe('central-keep');
    expect(await repository.listLinkedCentralIds('user-1')).toEqual(['central-keep']);
    expect(await repository.listLinkedCentralIds('user-2')).toEqual(['central-only-drop']);
    expect(await repository.countActiveEntities()).toBe(1);
    expect((await repository.getPanelSummary('person-keep'))?.familyName).toBe('甲氏');

    expect(await repository.softDeleteEntity('person-keep')).toBe(true);
    expect(await repository.listEntityIds('person')).toEqual([]);
    await expect(
      repository.createPopulatedEntity({
        id: 'person-keep',
        kind: 'person',
        names: [{ text: '復活', isPrimary: true }],
      }),
    ).rejects.toThrow(/resurrect/i);
    await repository.close();
  });

  it('finds entities by authority and by unique name+dates for promotion', async () => {
    const repository = await EntitySqliteRepository.open();
    await repository.createPopulatedEntity({
      id: 'person-auth',
      kind: 'person',
      names: [{ text: '孔遺', isPrimary: true }],
      authorities: [{ type: 'CBDB', value: '42' }],
    });
    await repository.setUserEntityDate({ entityId: 'person-auth', part: 'birth', year: 479 });
    await repository.createPopulatedEntity({
      id: 'person-other',
      kind: 'person',
      names: [{ text: '別人', isPrimary: true }],
    });
    expect(await repository.findEntityIdByAuthority('person', 'CBDB', '42')).toBe('person-auth');
    expect(await repository.findAllEntityIdsByAuthority('person', 'CBDB', '42')).toEqual([
      'person-auth',
    ]);
    expect(await repository.findAllEntityIdsByAuthority('place', 'CBDB', '42')).toEqual([]);
    expect(await repository.findEntityIdByNameDates('person', '孔遺', 479, null)).toBe(
      'person-auth',
    );
    expect(await repository.findEntityIdByNameDates('person', '孔遺', 480, null)).toBeNull();
    // Latin names match case-insensitively; duplicates stay ambiguous (null).
    await repository.createPopulatedEntity({
      id: 'person-latin',
      kind: 'person',
      names: [{ text: 'Kong Yi', isPrimary: true }],
    });
    expect(await repository.findEntityIdByNameDates('person', 'kong yi', null, null)).toBe(
      'person-latin',
    );
    await repository.createPopulatedEntity({
      id: 'person-latin-dup',
      kind: 'person',
      names: [{ text: 'Kong Yi', isPrimary: true }],
    });
    expect(await repository.findEntityIdByNameDates('person', 'Kong Yi', null, null)).toBeNull();
    await repository.close();
  });

  it('returns every entity sharing an authority for lookup conflict planning', async () => {
    const repository = await EntitySqliteRepository.open();
    await repository.createPopulatedEntity({
      id: 'person-a',
      kind: 'person',
      names: [{ text: 'A', isPrimary: true }],
      authorities: [{ type: 'Wikidata', value: 'Q1' }],
    });
    await repository.createPopulatedEntity({
      id: 'person-b',
      kind: 'person',
      names: [{ text: 'B', isPrimary: true }],
      authorities: [{ type: 'Wikidata', value: 'Q1' }],
    });
    await repository.createPopulatedEntity({
      id: 'place-q1',
      kind: 'place',
      names: [{ text: 'Somewhere', isPrimary: true }],
      authorities: [{ type: 'Wikidata', value: 'Q1' }],
    });
    expect(await repository.findAllEntityIdsByAuthority('person', 'Wikidata', 'Q1')).toEqual([
      'person-a',
      'person-b',
    ]);
    expect(await repository.findEntityIdByAuthority('person', 'Wikidata', 'Q1')).toBe('person-a');
    expect(await repository.findAllEntityIdsByAuthority('person', 'Wikidata', 'Q999')).toEqual([]);
    await repository.close();
  });

  it('mutates description, dates, nationality, origin, title, authors, and authorities in transactions', async () => {
    const repository = await EntitySqliteRepository.open();
    await repository.createEntity({ id: 'person-mut-1', kind: 'person' });
    await repository.createEntity({ id: 'work-mut-1', kind: 'work' });
    await repository.addName({ entityId: 'person-mut-1', text: '孔遺', isPrimary: true });

    await repository.updateDescription('person-mut-1', 'A short biography');
    await repository.setUserEntityDate({
      entityId: 'person-mut-1',
      part: 'birth',
      year: 479,
      precision: 'b.',
    });
    await repository.setUserEntityDate({
      entityId: 'person-mut-1',
      part: 'death',
      year: 502,
      precision: 'd.',
    });
    expect(await repository.addNationality({ entityId: 'person-mut-1', label: '宋' })).toBe(true);
    expect(await repository.addOrigin({ entityId: 'person-mut-1', label: '建康' })).toBe(true);
    expect(
      await repository.addNobleTitle('person-mut-1', {
        dynasty: '宋',
        fief: '荊國',
        title: '公',
      }),
    ).toBe(true);
    expect(
      await repository.attachAuthority({
        entityId: 'person-mut-1',
        type: 'Wikidata',
        value: 'Q42',
      }),
    ).toBe(true);

    await repository.setUserWorkDate({
      entityId: 'work-mut-1',
      startYear: 500,
      endYear: 510,
      startPrecision: 'ca.',
    });
    await repository.setUserWorkAuthors({
      entityId: 'work-mut-1',
      authors: [{ name: '孔遺', key: 'person-mut-1' }],
    });

    const person = await repository.getPanelSummary('person-mut-1');
    expect(person).toMatchObject({
      description: 'A short biography',
      startYear: 479,
      endYear: 502,
      nationalities: ['宋'],
      placesOfOrigin: ['建康'],
    });
    expect(person?.nobleTitles).toEqual([
      expect.objectContaining({ dynasty: '宋', fief: '荊國', title: '公' }),
    ]);
    expect(person?.authorities).toEqual([{ type: 'Wikidata', value: 'Q42' }]);
    expect(person?.assertions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: expect.stringMatching(/^entity_dates:\d+$/),
          element: 'birth',
          value: '0479',
        }),
        expect.objectContaining({
          key: expect.stringMatching(/^person_nationalities:\d+$/),
          element: 'nationality',
          value: '宋',
        }),
      ]),
    );

    const work = await repository.getPanelSummary('work-mut-1');
    expect(work?.workDate).toEqual({
      startYear: 500,
      endYear: 510,
      startPrecision: 'ca.',
      endPrecision: null,
    });
    expect(work?.authors).toEqual([
      expect.objectContaining({ name: '孔遺', ref: '#person-mut-1' }),
    ]);

    const nationalityKey = person!.assertions.find(
      (assertion) => assertion.element === 'nationality',
    )!.key;
    expect(await repository.rejectAssertion('person-mut-1', nationalityKey)).toBe(false); // user origin
    expect(await repository.removeAssertion('person-mut-1', nationalityKey)).toBe(true);
    expect((await repository.getPanelSummary('person-mut-1'))?.nationalities).toEqual([]);

    // Authority rows attached by the user are removable; re-attach as authority-origin for reject.
    await repository.backend.run(
      `UPDATE entity_authorities SET origin = 'authority', source = 'Wikidata' WHERE entity_id = ?`,
      ['person-mut-1'],
    );
    const authorityAssertion = (await repository.getPanelSummary('person-mut-1'))!.assertions.find(
      (assertion) => assertion.element === 'idno',
    )!;
    expect(await repository.rejectAssertion('person-mut-1', authorityAssertion.key)).toBe(true);
    expect((await repository.getPanelSummary('person-mut-1'))?.authorities).toEqual([]);

    expect(
      await repository.decoupleAuthority({
        entityId: 'person-mut-1',
        type: 'Wikidata',
        value: 'Q42',
      }),
    ).toBeGreaterThanOrEqual(0);
    await repository.close();
  });

  it('mutates family and given names into people scalars and entity_names', async () => {
    const repository = await EntitySqliteRepository.open();
    await repository.createEntity({ id: 'person-fg-1', kind: 'person' });
    await repository.addName({
      entityId: 'person-fg-1',
      text: '孔遺',
      isPrimary: true,
    });

    expect(
      await repository.updateNamesByText({
        entityId: 'person-fg-1',
        text: '孔',
        nameType: 'family',
      }),
    ).toBe(1);
    expect(
      await repository.addName({
        entityId: 'person-fg-1',
        text: '遺',
        nameType: 'given',
      }),
    ).toMatchObject({ nameType: 'given', nameRole: 'given' });

    expect(await repository.getPanelSummary('person-fg-1')).toMatchObject({
      familyName: '孔',
      givenName: '遺',
    });
    expect(
      await repository.backend.get(
        'SELECT family_name, given_name FROM people WHERE entity_id = ?',
        ['person-fg-1'],
      ),
    ).toEqual({ family_name: '孔', given_name: '遺' });

    await repository.updateNamesByText({
      entityId: 'person-fg-1',
      text: '孔',
      nameType: 'courtesy',
    });
    expect((await repository.getPanelSummary('person-fg-1'))?.familyName).toBeNull();
    expect(
      await repository.backend.get('SELECT family_name FROM people WHERE entity_id = ?', [
        'person-fg-1',
      ]),
    ).toEqual({ family_name: null });

    await repository.close();
  });

  it('inserts a typed name when classifying a mention surface not yet on the entity', async () => {
    const repository = await EntitySqliteRepository.open();
    await repository.createEntity({ id: 'person-zi-1', kind: 'person' });
    await repository.addName({
      entityId: 'person-zi-1',
      text: '蕭滴冽',
      isPrimary: true,
    });

    expect(
      await repository.updateNamesByText({
        entityId: 'person-zi-1',
        text: '圖寧',
        nameType: 'courtesy',
      }),
    ).toBe(1);

    const summary = await repository.getPanelSummary('person-zi-1');
    expect(summary?.names.map((name) => [name.text, name.nameType])).toEqual(
      expect.arrayContaining([
        ['蕭滴冽', null],
        ['圖寧', 'courtesy'],
      ]),
    );
    expect(
      await repository.backend.get(
        `SELECT name_type, name_role FROM entity_names
           WHERE entity_id = ? AND text = ? AND status = 'active'`,
        ['person-zi-1', '圖寧'],
      ),
    ).toEqual({ name_type: 'courtesy', name_role: 'variant' });

    // Clearing a type that was never stored remains a quiet no-op.
    expect(
      await repository.updateNamesByText({
        entityId: 'person-zi-1',
        text: '未知',
        nameType: null,
      }),
    ).toBe(0);

    await repository.close();
  });

  it('marks a classified-from-mention primary name as is_primary and demotes the old one', async () => {
    const repository = await EntitySqliteRepository.open();
    await repository.createEntity({ id: 'place-prim-1', kind: 'place' });
    await repository.addName({
      entityId: 'place-prim-1',
      text: "Rta'u rdzong",
      isPrimary: true,
      origin: 'xml',
    });

    expect(
      await repository.updateNamesByText({
        entityId: 'place-prim-1',
        text: 'ཏའུ',
        nameType: 'primary',
      }),
    ).toBe(1);

    expect(
      await repository.backend.all(
        `SELECT text, is_primary FROM entity_names
           WHERE entity_id = ? AND status = 'active' ORDER BY id`,
        ['place-prim-1'],
      ),
    ).toEqual([
      { text: "Rta'u rdzong", is_primary: 0 },
      { text: 'ཏའུ', is_primary: 1 },
    ]);

    await repository.close();
  });

  it('includes office affiliations as role assertions in the panel snapshot', async () => {
    const repository = await EntitySqliteRepository.open();
    await repository.createEntity({ id: 'person-office-1', kind: 'person' });
    await repository.createEntity({ id: 'office-1', kind: 'office' });
    await repository.backend.run(
      `INSERT INTO person_offices
          (person_id, office_id, office_label, reference, origin, source, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        'person-office-1',
        'office-1',
        '尚書令',
        '#office-1',
        'authority',
        'CBDB',
        'active',
        '2026-01-01',
        '2026-01-01',
      ],
    );
    await repository.backend.run(
      `INSERT INTO person_offices
          (person_id, office_label, origin, source, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['person-office-1', '舊職', 'authority', 'DILA', 'rejected', '2026-01-01', '2026-01-01'],
    );

    const snapshot = (await repository.getPanelSummary('person-office-1'))!;
    expect(snapshot.roles).toEqual(['尚書令']);
    expect(snapshot.assertions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: expect.stringMatching(/^person_offices:\d+$/),
          element: 'affiliation',
          value: '尚書令',
          origin: 'authority',
          source: 'CBDB',
          status: 'active',
          ref: '#office-1',
        }),
        expect.objectContaining({
          element: 'affiliation',
          value: '舊職',
          status: 'rejected',
          source: 'DILA',
        }),
      ]),
    );
    expect(
      await repository.rejectAssertion(
        'person-office-1',
        snapshot.assertions.find((a) => a.value === '尚書令')!.key,
      ),
    ).toBe(true);
    expect((await repository.getPanelSummary('person-office-1'))?.roles).toEqual([]);
    await repository.close();
  });

  it('applies, conflicts, and rejects CBDB concordance associations', async () => {
    const repository = await EntitySqliteRepository.open();
    await repository.createEntity({ id: 'person-conc-1', kind: 'person' });
    await repository.createEntity({ id: 'person-conc-2', kind: 'person' });
    await repository.attachAuthority({
      entityId: 'person-conc-1',
      type: 'CBDB',
      value: '141',
      origin: 'authority',
      source: 'CBDB',
    });
    const association = {
      source: 'CBDB',
      canonicalId: '141',
      mergedFromId: '96120',
      notes: 'same person',
    };

    expect(await repository.applyConcordanceAssociations([association])).toMatchObject({
      applied: 1,
      conflicts: [],
    });
    expect((await repository.getPanelSummary('person-conc-1'))?.authorities).toEqual(
      expect.arrayContaining([
        { type: 'CBDB', value: '141' },
        { type: 'CBDB', value: '96120' },
      ]),
    );

    // Multi-association apply stays batched in one outer transaction.
    await repository.createEntity({ id: 'person-conc-3', kind: 'person' });
    await repository.attachAuthority({
      entityId: 'person-conc-3',
      type: 'CBDB',
      value: '31',
      origin: 'authority',
      source: 'CBDB',
    });
    expect(
      await repository.applyConcordanceAssociations([
        {
          source: 'CBDB',
          canonicalId: '31',
          mergedFromId: '98561',
        },
        {
          source: 'CBDB',
          canonicalId: '55',
          mergedFromId: '468758',
        },
      ]),
    ).toMatchObject({ applied: 1, unresolved: 1 });
    expect((await repository.getPanelSummary('person-conc-3'))?.authorities).toEqual(
      expect.arrayContaining([
        { type: 'CBDB', value: '31' },
        { type: 'CBDB', value: '98561' },
      ]),
    );

    expect(await repository.rejectConcordance(association, 'person-conc-1')).toBe(true);
    expect(await repository.applyConcordanceAssociations([association])).toMatchObject({
      rejected: 1,
      applied: 0,
    });
    expect(await repository.listConcordanceRejections()).toHaveLength(1);
    expect((await repository.getPanelSummary('person-conc-1'))?.rejectedConcordances).toHaveLength(
      1,
    );

    const conflictRepo = await EntitySqliteRepository.open();
    await conflictRepo.createEntity({ id: 'person-a', kind: 'person' });
    await conflictRepo.createEntity({ id: 'person-b', kind: 'person' });
    await conflictRepo.attachAuthority({
      entityId: 'person-a',
      type: 'CBDB',
      value: '141',
      origin: 'authority',
      source: 'CBDB',
    });
    await conflictRepo.attachAuthority({
      entityId: 'person-b',
      type: 'CBDB',
      value: '96120',
      origin: 'authority',
      source: 'CBDB',
    });
    expect((await conflictRepo.applyConcordanceAssociations([association])).conflicts).toHaveLength(
      1,
    );
    await conflictRepo.close();
    await repository.close();
  });

  it('applies authority backfill patches without resurrecting rejected values', async () => {
    const repository = await EntitySqliteRepository.open();
    await repository.createEntity({ id: 'person-bf', kind: 'person' });
    await repository.addName({
      entityId: 'person-bf',
      text: '孔遺',
      isPrimary: true,
      origin: 'user',
    });
    await repository.backend.run(
      `INSERT INTO entity_names
           (entity_id, text, name_type, name_role, language, is_primary, origin, source, status, created_at, updated_at)
         VALUES (?, '世遠', 'courtesy', 'variant', NULL, 0, 'authority', 'CBDB', 'rejected', ?, ?)`,
      ['person-bf', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'],
    );

    const first = await repository.applyAuthorityBackfillPatch({
      entityId: 'person-bf',
      names: [
        { text: '世遠', nameType: 'courtesy', source: 'CBDB' },
        { text: '仲達', nameType: 'courtesy', source: 'CBDB' },
      ],
      dates: [{ source: 'CBDB', startYear: 100, endYear: 160 }],
      nationalities: [{ label: '漢', ref: 'Q7209', source: 'CBDB' }],
      familyName: '孔',
      givenName: '遺',
    });
    expect(first).toEqual({ changed: true, namesAdded: 3 });
    const allNames = (await repository.listNames('person-bf', true)).map((name) => name.text);
    expect(allNames).toEqual(expect.arrayContaining(['仲達', '孔遺', '世遠', '孔', '遺']));
    expect(
      (await repository.listNames('person-bf', true)).find((name) => name.text === '世遠')?.status,
    ).toBe('rejected');
    expect((await repository.getPanelSummary('person-bf'))?.familyName).toBe('孔');
    expect((await repository.getPanelSummary('person-bf'))?.givenName).toBe('遺');
    expect((await repository.getPanelSummary('person-bf'))?.startYear).toBe(100);
    expect((await repository.getPanelSummary('person-bf'))?.nationalities).toContain('漢');

    const second = await repository.applyAuthorityBackfillPatch({
      entityId: 'person-bf',
      names: [{ text: '仲達', nameType: 'courtesy', source: 'CBDB' }],
      dates: [{ source: 'CBDB', startYear: 100, endYear: 160 }],
      nationalities: [{ label: '漢', ref: 'Q7209', source: 'CBDB' }],
    });
    expect(second).toEqual({ changed: false, namesAdded: 0 });
    await repository.close();
  });

  it('keeps all family variants but sets canonical 姓 from the preferred patch field', async () => {
    const repository = await EntitySqliteRepository.open();
    await repository.createEntity({ id: 'person-tuoba', kind: 'person' });
    await repository.addName({
      entityId: 'person-tuoba',
      text: '拓拔建',
      isPrimary: true,
      origin: 'authority',
      source: 'NORBERT',
    });

    const result = await repository.applyAuthorityBackfillPatch({
      entityId: 'person-tuoba',
      names: [
        { text: '元', nameType: 'family', source: 'NORBERT' },
        { text: '拓拔', nameType: 'family', source: 'NORBERT' },
        { text: '托跋', nameType: 'family', source: 'NORBERT' },
        { text: '建', nameType: 'given', source: 'NORBERT' },
      ],
      familyName: '拓拔',
      givenName: '建',
    });
    expect(result.namesAdded).toBe(4);
    const names = (await repository.listNames('person-tuoba')).map((name) => name.text);
    expect(names).toEqual(expect.arrayContaining(['拓拔建', '元', '拓拔', '托跋', '建']));
    expect((await repository.getPanelSummary('person-tuoba'))?.familyName).toBe('拓拔');
    expect((await repository.getPanelSummary('person-tuoba'))?.givenName).toBe('建');

    // Re-backfill can correct a previously wrong scalar that is still one of the variants.
    await repository.backend.run('UPDATE people SET family_name = ? WHERE entity_id = ?', [
      '元',
      'person-tuoba',
    ]);
    const corrected = await repository.applyAuthorityBackfillPatch({
      entityId: 'person-tuoba',
      names: [
        { text: '元', nameType: 'family', source: 'NORBERT' },
        { text: '拓拔', nameType: 'family', source: 'NORBERT' },
        { text: '托跋', nameType: 'family', source: 'NORBERT' },
      ],
      familyName: '拓拔',
      givenName: '建',
    });
    expect(corrected.changed).toBe(true);
    expect((await repository.getPanelSummary('person-tuoba'))?.familyName).toBe('拓拔');
    await repository.close();
  });

  it('restores withdrawn family/given names and clears non-fine authority vitals', async () => {
    const repository = await EntitySqliteRepository.open();
    await repository.createEntity({ id: 'person-restore', kind: 'person' });
    await repository.addName({
      entityId: 'person-restore',
      text: '陳顯達',
      isPrimary: true,
      origin: 'authority',
      source: 'CBDB',
    });
    await repository.backend.run(
      `INSERT INTO entity_names
           (entity_id, text, name_type, name_role, language, is_primary, origin, source, status, created_at, updated_at)
         VALUES (?, '陳', 'family', 'family', NULL, 0, 'authority', 'CBDB', 'withdrawn', ?, ?)`,
      ['person-restore', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'],
    );
    await repository.backend.run(
      `INSERT INTO entity_names
           (entity_id, text, name_type, name_role, language, is_primary, origin, source, status, created_at, updated_at)
         VALUES (?, '顯達', 'given', 'given', NULL, 0, 'authority', 'CBDB', 'withdrawn', ?, ?)`,
      ['person-restore', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'],
    );
    const familyId = (
      (await repository.backend.get(
        `SELECT id FROM entity_names WHERE entity_id = ? AND text = '陳'`,
        ['person-restore'],
      )) as { id: number }
    ).id;
    await repository.backend.run(
      `INSERT INTO entity_tombstones (entity_id, table_name, row_id, reason, created_at)
         VALUES (?, 'entity_names', ?, 'mirror-copy-entity_names-status', ?)`,
      ['person-restore', familyId, '2026-01-01T00:00:00.000Z'],
    );
    await repository.backend.run(
      `INSERT INTO entity_dates
           (entity_id, date_kind, start_year, when_value, origin, source, status, created_at, updated_at)
         VALUES (?, 'birth', 479, '0479', 'authority', 'CBDB', 'active', ?, ?),
                (?, 'death', 502, '0502', 'authority', 'CBDB', 'active', ?, ?),
                (?, 'birth', 427, '0427', 'authority', 'DILA', 'active', ?, ?),
                (?, 'death', 500, '0500', 'authority', 'DILA', 'active', ?, ?)`,
      [
        'person-restore',
        '2026-01-01T00:00:00.000Z',
        '2026-01-01T00:00:00.000Z',
        'person-restore',
        '2026-01-01T00:00:00.000Z',
        '2026-01-01T00:00:00.000Z',
        'person-restore',
        '2026-01-01T00:00:00.000Z',
        '2026-01-01T00:00:00.000Z',
        'person-restore',
        '2026-01-01T00:00:00.000Z',
        '2026-01-01T00:00:00.000Z',
      ],
    );
    await repository.backend.run(
      'UPDATE people SET family_name = ?, given_name = ? WHERE entity_id = ?',
      ['陳', '顯達', 'person-restore'],
    );

    // Before cleanup, CBDB dynasty years win over DILA only when preferred first —
    // after reordering, DILA should already surface; clearing CBDB seals it.
    const result = await repository.applyAuthorityBackfillPatch({
      entityId: 'person-restore',
      names: [
        { text: '陳', nameType: 'family', source: 'CBDB' },
        { text: '顯達', nameType: 'given', source: 'CBDB' },
      ],
      familyName: '陳',
      givenName: '顯達',
      rewriteUnvalidatedPersonNames: true,
      clearAuthorityVitalSources: ['CBDB'],
    });
    expect(result.changed).toBe(true);
    const activeTexts = (await repository.listNames('person-restore'))
      .filter((name) => name.status === 'active')
      .map((name) => name.text)
      .sort();
    expect(activeTexts).toEqual(['陳', '陳顯達', '顯達'].sort());
    expect((await repository.getPanelSummary('person-restore'))?.familyName).toBe('陳');
    expect((await repository.getPanelSummary('person-restore'))?.givenName).toBe('顯達');
    expect((await repository.getPanelSummary('person-restore'))?.startYear).toBe(427);
    expect((await repository.getPanelSummary('person-restore'))?.endYear).toBe(500);
    await repository.close();
  });

  it('stores floruit as dates+fl. and clears wrongly minted birth/death for that source', async () => {
    const repository = await EntitySqliteRepository.open();
    await repository.createEntity({ id: 'person-floruit', kind: 'person' });
    await repository.addName({
      entityId: 'person-floruit',
      text: '活躍',
      isPrimary: true,
      origin: 'authority',
      source: 'CBDB',
    });
    // Simulate older mint that wrote floruit span as birth/death.
    await repository.backend.run(
      `INSERT INTO entity_dates
           (entity_id, date_kind, start_year, when_value, origin, source, status, created_at, updated_at)
         VALUES (?, 'birth', 479, '0479', 'authority', 'CBDB', 'active', ?, ?),
                (?, 'death', 502, '0502', 'authority', 'CBDB', 'active', ?, ?)`,
      [
        'person-floruit',
        '2026-01-01T00:00:00.000Z',
        '2026-01-01T00:00:00.000Z',
        'person-floruit',
        '2026-01-01T00:00:00.000Z',
        '2026-01-01T00:00:00.000Z',
      ],
    );

    const result = await repository.applyAuthorityBackfillPatch({
      entityId: 'person-floruit',
      dates: [{ source: 'CBDB', startYear: 479, endYear: 502, asFloruit: true }],
      clearAuthorityVitalSources: ['CBDB'],
    });
    expect(result.changed).toBe(true);
    const summary = await repository.getPanelSummary('person-floruit');
    expect(summary?.startYear).toBe(479);
    expect(summary?.endYear).toBe(502);
    expect(summary?.workDate?.startPrecision).toBe('fl.');
    expect(summary?.workDate?.startYear).toBe(479);
    expect(summary?.workDate?.endYear).toBe(502);
    const vitalKinds = (
      (await repository.backend.all(
        `SELECT date_kind FROM entity_dates
           WHERE entity_id = ? AND origin = 'authority' AND status = 'active'`,
        ['person-floruit'],
      )) as { date_kind: string }[]
    ).map((row) => row.date_kind);
    expect(vitalKinds).toEqual(['dates']);
    await repository.close();
  });

  it('rewrites unvalidated invented 姓名 on re-backfill and clears missing given', async () => {
    const repository = await EntitySqliteRepository.open();
    await repository.createEntity({ id: 'person-empress', kind: 'person' });
    await repository.addName({
      entityId: 'person-empress',
      text: '孝武昭路太后',
      isPrimary: true,
      origin: 'authority',
      source: 'NORBERT',
    });
    await repository.addName({
      entityId: 'person-empress',
      text: '孝',
      nameType: 'family',
      origin: 'authority',
      source: 'NORBERT',
    });
    await repository.addName({
      entityId: 'person-empress',
      text: '武昭路太后',
      nameType: 'given',
      origin: 'authority',
      source: 'NORBERT',
    });
    await repository.addName({
      entityId: 'person-empress',
      text: '路',
      nameType: 'family',
      origin: 'authority',
      source: 'NORBERT',
    });
    await repository.backend.run(
      'UPDATE people SET family_name = ?, given_name = ? WHERE entity_id = ?',
      ['孝', '武昭路太后', 'person-empress'],
    );

    const result = await repository.applyAuthorityBackfillPatch({
      entityId: 'person-empress',
      names: [{ text: '路', nameType: 'family', source: 'NORBERT' }],
      familyName: '路',
      givenName: null,
      rewriteUnvalidatedPersonNames: true,
    });
    expect(result.changed).toBe(true);
    const activeTexts = (await repository.listNames('person-empress'))
      .filter((name) => name.status === 'active')
      .map((name) => name.text)
      .sort();
    expect(activeTexts).toEqual(['孝武昭路太后', '路'].sort());
    expect((await repository.getPanelSummary('person-empress'))?.familyName).toBe('路');
    expect((await repository.getPanelSummary('person-empress'))?.givenName).toBeNull();
    await repository.close();
  });

  it('copies entity content between databases while preserving central mappings', async () => {
    const source = await EntitySqliteRepository.open();
    const target = await EntitySqliteRepository.open();
    await source.createPopulatedEntity({
      id: 'person-src',
      kind: 'person',
      names: [{ text: '孔遺', isPrimary: true }],
      description: 'from project',
    });
    await source.addName({
      entityId: 'person-src',
      text: '世遠',
      nameType: 'courtesy',
      origin: 'authority',
      source: 'CBDB',
    });
    await source.setUserEntityDate({ entityId: 'person-src', part: 'birth', year: 100 });
    await source.addNationality({ entityId: 'person-src', label: '漢' });

    await target.createPopulatedEntity({
      id: 'person-dst',
      kind: 'person',
      names: [{ text: 'Placeholder', isPrimary: true }],
      description: 'old',
    });
    await target.setCentralMapping('person-dst', 'user-a', 'person-central');

    const beforeCentral = await target.getCentralId('person-dst', 'user-a');
    const result = await replaceEntityContentBetween(source, 'person-src', target, 'person-dst');
    expect(result.changed).toBe(true);
    expect(await target.getCentralId('person-dst', 'user-a')).toBe(beforeCentral);
    expect((await target.getEntity('person-dst'))?.description).toBe('from project');
    expect((await target.listNames('person-dst')).map((name) => name.text)).toEqual(
      expect.arrayContaining(['孔遺', '世遠']),
    );
    expect((await target.getPanelSummary('person-dst'))?.nationalities).toContain('漢');
    expect(await computeEntityContentHash(source, 'person-src')).toBe(
      await computeEntityContentHash(target, 'person-dst'),
    );
    await source.close();
    await target.close();
  });

  it('accepts origin=xml on nationality, origin, office, and noble-title adds', async () => {
    const repository = await EntitySqliteRepository.open();
    await repository.createEntity({ id: 'person-xml-add', kind: 'person' });
    const source = 'xml:ch1#personWrapper:1';
    expect(
      await repository.addNationality({
        entityId: 'person-xml-add',
        label: '齊',
        origin: 'xml',
        source,
      }),
    ).toBe(true);
    expect(
      await repository.addOrigin({
        entityId: 'person-xml-add',
        label: '建康',
        origin: 'xml',
        source,
      }),
    ).toBe(true);
    expect(
      await repository.addNobleTitle('person-xml-add', {
        fief: '鄱陽',
        title: '王',
        origin: 'xml',
        source,
      }),
    ).toBe(true);
    expect(
      await repository.addOffice({
        entityId: 'person-xml-add',
        label: '尚書',
        origin: 'xml',
        source,
      }),
    ).toBe(true);
    expect(
      (await repository.getPanelSummary('person-xml-add'))?.assertions.filter(
        (row) => row.origin === 'xml',
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ element: 'nationality', value: '齊', origin: 'xml', source }),
        expect.objectContaining({ element: 'placeName', value: '建康', origin: 'xml', source }),
        expect.objectContaining({ element: 'nobleTitle', origin: 'xml', source }),
        expect.objectContaining({ element: 'affiliation', value: '尚書', origin: 'xml', source }),
      ]),
    );
    await repository.close();
  });

  it('reconciles XML-extracted nationality/office/title with orphan wrapper cleanup', async () => {
    const repository = await EntitySqliteRepository.open();
    await repository.createEntity({ id: 'person-xml-1', kind: 'person' });
    await repository.addName({ entityId: 'person-xml-1', text: '範', isPrimary: true });

    const first = await repository.reconcileXmlExtractedData({
      documentKey: 'chapter-1',
      wrappers: [
        {
          entityId: 'person-xml-1',
          source: 'xml:chapter-1#personWrapper:1',
          assertions: [
            { element: 'nationality', value: '漢' },
            { element: 'state', value: '侍中' },
          ],
        },
      ],
    });
    expect(first).toMatchObject({ wrappers: 1, added: 2, removed: 0 });
    expect(await repository.getPanelSummary('person-xml-1')).toMatchObject({
      nationalities: ['漢'],
      roles: ['侍中'],
    });

    // Validated nationality survives refresh that drops it from the wrapper.
    const nationalityKey = (await repository.getPanelSummary('person-xml-1'))!.assertions.find(
      (row) => row.element === 'nationality',
    )!.key;
    expect(await repository.validateAssertion('person-xml-1', nationalityKey)).toBe(true);

    const second = await repository.reconcileXmlExtractedData({
      documentKey: 'chapter-1',
      wrappers: [
        {
          entityId: 'person-xml-1',
          source: 'xml:chapter-1#personWrapper:1',
          assertions: [],
        },
      ],
    });
    expect(second.removed).toBe(1); // office only
    expect((await repository.getPanelSummary('person-xml-1'))?.nationalities).toEqual(['漢']);
    expect((await repository.getPanelSummary('person-xml-1'))?.roles).toEqual([]);

    // Re-add office, then drop the whole wrapper from the document refresh.
    await repository.reconcileXmlExtractedData({
      documentKey: 'chapter-1',
      wrappers: [
        {
          entityId: 'person-xml-1',
          source: 'xml:chapter-1#personWrapper:1',
          assertions: [{ element: 'state', value: '侍中' }],
        },
      ],
    });
    const orphaned = await repository.reconcileXmlExtractedData({
      documentKey: 'chapter-1',
      wrappers: [],
    });
    expect(orphaned.removed).toBe(1);
    expect((await repository.getPanelSummary('person-xml-1'))?.roles).toEqual([]);
    // Validated nationality still present.
    expect((await repository.getPanelSummary('person-xml-1'))?.nationalities).toEqual(['漢']);
    await repository.close();
  });

  it('reconciles a nobleTitle assertion missing a roleName without violating NOT NULL', async () => {
    // A bare title mention with no attached name (e.g. 建安王薨) can produce
    // a wrapper whose nobleTitle only has a placeName, or only a roleName —
    // person_titles.place_name/role_name are NOT NULL, so reconciliation
    // must coerce a missing side to '' rather than passing null through.
    const repository = await EntitySqliteRepository.open();
    await repository.createEntity({ id: 'person-xml-bare', kind: 'person' });

    // Should not throw/reject — an unhandled rejection here fails the test.
    await repository.reconcileXmlExtractedData({
      documentKey: 'chapter-1',
      wrappers: [
        {
          entityId: 'person-xml-bare',
          source: 'xml:chapter-1#personWrapper:1',
          assertions: [
            {
              element: 'nobleTitle',
              value: '建安王',
              children: [{ element: 'placeName', value: '建安' }],
            },
          ],
        },
      ],
    });

    expect(await repository.getPanelSummary('person-xml-bare')).toMatchObject({
      nobleTitles: expect.arrayContaining([expect.objectContaining({ fief: '建安' })]),
    });
    await repository.close();
  });

  it('rolls back a failed transaction', async () => {
    const repository = await EntitySqliteRepository.open();
    await expect(
      repository.transaction(async () => {
        await repository.backend.run(
          `INSERT INTO entities (id, kind, created_at, updated_at)
             VALUES (?, ?, ?, ?)`,
          ['nested-not-supported', 'place', '2026-01-01', '2026-01-01'],
        );
        throw new Error('abort');
      }),
    ).rejects.toThrow('abort');
    expect(await repository.getEntity('nested-not-supported')).toBeNull();
    await repository.close();
  });

  it('autoCleanNames promotes Latn, dedupes typed names, and removes untyped', async () => {
    const repository = await EntitySqliteRepository.open();
    await repository.createEntity({ id: 'person-auto-clean', kind: 'person' });
    await repository.addName({
      entityId: 'person-auto-clean',
      text: '王維',
      isPrimary: true,
      nameType: 'primary',
    });
    await repository.addName({
      entityId: 'person-auto-clean',
      text: '摩詰',
      nameType: 'courtesy',
      origin: 'authority',
      source: 'Norbert',
    });
    await repository.setRomanizedName('person-auto-clean', 'Wang Wei', 'zh-Latn');
    // Force an older untyped Latn (setRomanized now writes romanization).
    await repository.backend.run(
      `UPDATE entity_names SET name_type = NULL
         WHERE entity_id = ? AND language LIKE '%-Latn'`,
      ['person-auto-clean'],
    );
    await repository.addName({
      entityId: 'person-auto-clean',
      text: 'orphan-untyped',
      origin: 'user',
    });
    // Simulate a duplicate left by an older database version; ordinary writes
    // now normalize the same artifact immediately.
    await repository.backend.run(
      `INSERT INTO entity_names
           (entity_id, text, name_type, name_role, language, is_primary, origin, source, status, created_at, updated_at)
         SELECT entity_id, text, name_type, name_role, language, 0, origin, source, status, created_at, updated_at
         FROM entity_names WHERE entity_id = ? AND text = ? LIMIT 1`,
      ['person-auto-clean', '摩詰'],
    );

    const report = await repository.autoCleanNames();
    expect(report.promotedRomanizations).toBe(1);
    expect(report.dedupedNames).toBe(1);
    expect(report.removedUntyped).toBe(1);

    const names = await repository.listNames('person-auto-clean');
    expect(names.filter((n) => n.text === '摩詰')).toHaveLength(1);
    expect(names.find((n) => n.language?.includes('Latn'))).toEqual(
      expect.objectContaining({ nameType: 'romanization', text: 'Wang Wei' }),
    );
    expect(names.some((n) => n.text === 'orphan-untyped')).toBe(false);
    await repository.close();
  });

  it('setRomanizedName stores name_type romanization with a Latn language', async () => {
    const repository = await EntitySqliteRepository.open();
    await repository.createEntity({ id: 'place-rom', kind: 'place' });
    await repository.addName({
      entityId: 'place-rom',
      text: '建康',
      isPrimary: true,
      nameType: 'primary',
      language: 'zh-Hant',
    });
    await repository.setRomanizedName('place-rom', 'Jiankang', 'zh-Hant');
    const latn = (await repository.listNames('place-rom')).find((n) =>
      n.language?.includes('Latn'),
    );
    expect(latn).toEqual(
      expect.objectContaining({
        text: 'Jiankang',
        nameType: 'romanization',
        language: 'zh-Latn',
      }),
    );
    await repository.close();
  });

  it('migration 8 retags legacy Latn translations and mis-tagged zh-Hant Latin text', async () => {
    const repository = await EntitySqliteRepository.open();
    await repository.createEntity({ id: 'place-legacy-latn', kind: 'place' });
    await repository.createEntity({ id: 'place-legacy-mistag', kind: 'place' });
    const now = new Date().toISOString();
    await repository.backend.run(
      `INSERT INTO entity_names
           (entity_id, text, name_type, name_role, language, is_primary, origin, source, status, created_at, updated_at)
         VALUES
           ('place-legacy-latn', '安陸縣', 'primary', 'primary', 'zh-Hant', 1, 'user', NULL, 'active', ?, ?),
           ('place-legacy-latn', 'Anlu', 'translation', 'variant', 'zh-Latn', 0, 'user', NULL, 'active', ?, ?),
           ('place-legacy-mistag', '江南', 'primary', 'primary', 'zh-Hant', 1, 'user', NULL, 'active', ?, ?),
           ('place-legacy-mistag', 'Jiang Nan', 'translation', 'variant', 'zh-Hant', 0, 'user', NULL, 'active', ?, ?)`,
      [now, now, now, now, now, now, now, now],
    );

    await repository.backend.exec('PRAGMA user_version = 7');
    await applyEntityDbMigrations(repository.backend);

    const anlu = (await repository.listNames('place-legacy-latn')).find((n) => n.text === 'Anlu');
    expect(anlu).toEqual(
      expect.objectContaining({ nameType: 'romanization', language: 'zh-Latn' }),
    );
    const jiangNan = (await repository.listNames('place-legacy-mistag')).find(
      (n) => n.text === 'Jiang Nan',
    );
    expect(jiangNan).toEqual(
      expect.objectContaining({ nameType: 'romanization', language: 'zh-Hant-Latn' }),
    );
    await repository.close();
  });

  it('addName with nameType translation stores in entity_translations', async () => {
    const repository = await EntitySqliteRepository.open();
    await repository.createEntity({ id: 'work-gloss', kind: 'work' });
    await repository.addName({
      entityId: 'work-gloss',
      text: 'Livre des Jin',
      nameType: 'translation',
      language: 'fr',
    });
    expect((await repository.listNames('work-gloss')).some((n) => n.text === 'Livre des Jin')).toBe(
      false,
    );
    expect(await repository.listTranslations('work-gloss')).toEqual([
      expect.objectContaining({ text: 'Livre des Jin', language: 'fr', status: 'active' }),
    ]);
    const panel = await repository.getPanelSummary('work-gloss');
    expect(panel?.translations).toEqual([
      expect.objectContaining({ text: 'Livre des Jin', language: 'fr' }),
    ]);
    // Editor still sees the gloss as a translation name row.
    expect(panel?.names.find((n) => n.text === 'Livre des Jin')?.nameType).toBe('translation');
    await repository.close();
  });

  it('migration 9 moves vernacular glosses from entity_names into entity_translations', async () => {
    const repository = await EntitySqliteRepository.open();
    await repository.createEntity({ id: 'work-legacy-gloss', kind: 'work' });
    const now = new Date().toISOString();
    await repository.backend.run(
      `INSERT INTO entity_names
           (entity_id, text, name_type, name_role, language, is_primary, origin, source, status, created_at, updated_at)
         VALUES
           ('work-legacy-gloss', '晉書', 'primary', 'primary', 'zh-Hant', 1, 'user', NULL, 'active', ?, ?),
           ('work-legacy-gloss', 'Livre des Jin', 'translation', 'variant', 'fr', 0, 'user', NULL, 'active', ?, ?)`,
      [now, now, now, now],
    );

    await repository.backend.exec('PRAGMA user_version = 8');
    await applyEntityDbMigrations(repository.backend);

    expect(
      (await repository.listNames('work-legacy-gloss')).some((n) => n.text === 'Livre des Jin'),
    ).toBe(false);
    expect(await repository.listTranslations('work-legacy-gloss')).toEqual([
      expect.objectContaining({ text: 'Livre des Jin', language: 'fr' }),
    ]);
    await repository.close();
  });

  it('migration 10 withdraws dynasty spans stored as birth/death, keeps real lifespans', async () => {
    const repository = await EntitySqliteRepository.open();
    const now = new Date().toISOString();
    for (const id of [
      'person-norbert-span', // Rule A: NORBERT-attributed birth/death
      'person-sentinel-floor', // Rule B: -5999 synthetic Pre-Qin floor
      'person-era-pair', // Rule C: lone birth/death > 150 years apart
      'person-real-lifespan', // negative: a normal 61-year lifespan
      'person-ambiguous-multi', // negative: >2 birth/death rows — left for the refresh path
    ]) {
      await repository.createEntity({ id, kind: 'person' });
    }
    await repository.backend.run(
      `INSERT INTO entity_dates
           (entity_id, date_kind, start_year, origin, source, status, created_at, updated_at)
         VALUES
           ('person-norbert-span', 'birth', -5999, 'authority', 'NORBERT', 'active', ?, ?),
           ('person-norbert-span', 'death', -220,  'authority', 'NORBERT', 'active', ?, ?),
           ('person-sentinel-floor', 'birth', -5999, 'user', NULL, 'active', ?, ?),
           ('person-era-pair', 'birth', 420, 'authority', 'CBDB', 'active', ?, ?),
           ('person-era-pair', 'death', 907, 'authority', 'CBDB', 'active', ?, ?),
           ('person-real-lifespan', 'birth', 701, 'user', NULL, 'active', ?, ?),
           ('person-real-lifespan', 'death', 762, 'user', NULL, 'active', ?, ?),
           ('person-ambiguous-multi', 'birth', 701, 'authority', 'DILA', 'active', ?, ?),
           ('person-ambiguous-multi', 'death', 762, 'authority', 'DILA', 'active', ?, ?),
           ('person-ambiguous-multi', 'birth', 618, 'authority', 'CBDB', 'active', ?, ?),
           ('person-ambiguous-multi', 'death', 907, 'authority', 'CBDB', 'active', ?, ?)`,
      [...Array.from({ length: 22 }, () => now)],
    );

    await repository.backend.exec('PRAGMA user_version = 9');
    await applyEntityDbMigrations(repository.backend);

    const active = async (id: string) =>
      (
        (await repository.backend.all(
          `SELECT date_kind, start_year FROM entity_dates
             WHERE entity_id = ? AND status = 'active' ORDER BY date_kind, id`,
          [id],
        )) as { date_kind: string; start_year: number }[]
      ).map((row) => `${row.date_kind}:${row.start_year}`);

    expect(await active('person-norbert-span')).toEqual([]);
    expect(await active('person-sentinel-floor')).toEqual([]);
    expect(await active('person-era-pair')).toEqual([]);
    expect(await active('person-real-lifespan')).toEqual(['birth:701', 'death:762']);
    // >2 birth/death rows: too ambiguous to pick a bad pair blindly — the
    // per-entity authority refresh (clearAuthorityVitalSources) handles these.
    expect(await active('person-ambiguous-multi')).toEqual([
      'birth:701',
      'birth:618',
      'death:762',
      'death:907',
    ]);

    await repository.close();
  });

  it('normalizes mechanical name artifacts during ordinary name writes', async () => {
    const repository = await EntitySqliteRepository.open();
    await repository.createEntity({ id: 'person-name-integrity', kind: 'person' });
    await repository.addName({
      entityId: 'person-name-integrity',
      text: '王維',
      isPrimary: true,
      nameType: 'primary',
    });

    await repository.addName({
      entityId: 'person-name-integrity',
      text: '摩詰',
      nameType: 'courtesy',
    });
    await repository.addName({
      entityId: 'person-name-integrity',
      text: '摩詰',
      nameType: 'courtesy',
    });
    await repository.addName({
      entityId: 'person-name-integrity',
      text: 'nan',
      nameType: 'variant',
    });
    await repository.addName({ entityId: 'person-name-integrity', text: 'n', nameType: 'family' });
    await repository.addName({ entityId: 'person-name-integrity', text: 'an', nameType: 'given' });

    const active = await repository.listNames('person-name-integrity');
    expect(
      active.filter((name) => name.text === '摩詰' && name.nameType === 'courtesy'),
    ).toHaveLength(1);
    expect(active.some((name) => name.text === 'nan')).toBe(false);
    expect(active.some((name) => name.text === 'n' || name.text === 'an')).toBe(false);
    expect(
      await repository.backend.get(
        'SELECT family_name AS familyName, given_name AS givenName FROM people WHERE entity_id = ?',
        ['person-name-integrity'],
      ),
    ).toEqual({ familyName: null, givenName: null });
    await repository.close();
  });

  it('falls back to a generic dates row for a non-work, non-birth/death kind (place/org/office)', async () => {
    const repository = await EntitySqliteRepository.open();
    await repository.createEntity({ id: 'org-1', kind: 'org' });
    await repository.addName({ entityId: 'org-1', text: 'Hanlin Academy', isPrimary: true });
    await repository.backend.run(
      `INSERT INTO entity_dates
          (entity_id, date_kind, start_year, end_year, origin, source, status, created_at, updated_at)
         VALUES (?, 'dates', ?, ?, 'user', NULL, 'active', ?, ?)`,
      ['org-1', 738, 907, '2026-01-01', '2026-01-01'],
    );

    const summary = (await repository.getPanelSummary('org-1'))!;
    expect(summary.startYear).toBe(738);
    expect(summary.endYear).toBe(907);
    // Phase 3 (period-filtered office disambiguation): workDate now generalizes to any
    // kind with a generic dates row and no birth/death row, not just 'work'.
    expect(summary.workDate).toEqual({
      startYear: 738,
      endYear: 907,
      startPrecision: null,
      endPrecision: null,
    });
    await repository.close();
  });

  it('prefers a birth/death row over a generic dates row when both exist', async () => {
    const repository = await EntitySqliteRepository.open();
    await repository.createEntity({ id: 'person-mixed-dates', kind: 'person' });
    await repository.setUserEntityDate({
      entityId: 'person-mixed-dates',
      part: 'birth',
      year: 400,
    });
    await repository.backend.run(
      `INSERT INTO entity_dates
          (entity_id, date_kind, start_year, end_year, origin, source, status, created_at, updated_at)
         VALUES (?, 'dates', ?, ?, 'user', NULL, 'active', ?, ?)`,
      ['person-mixed-dates', 1, 999, '2026-01-01', '2026-01-01'],
    );

    const summary = (await repository.getPanelSummary('person-mixed-dates'))!;
    expect(summary.startYear).toBe(400);
    await repository.close();
  });

  it('sets and reads work_type via setWorkType/getPanelSummary, including bulk listPanelSummaries', async () => {
    const repository = await EntitySqliteRepository.open();
    await repository.createEntity({ id: 'work-type-1', kind: 'work' });
    await repository.setWorkType({ entityId: 'work-type-1', workType: 'chapter' });

    expect((await repository.getPanelSummary('work-type-1'))?.workType).toBe('chapter');
    expect(
      (await repository.listPanelSummaries('work')).find((summary) => summary.id === 'work-type-1')
        ?.workType,
    ).toBe('chapter');

    await repository.setWorkType({ entityId: 'work-type-1', workType: null });
    expect((await repository.getPanelSummary('work-type-1'))?.workType).toBe('book');
    await repository.close();
  });

  it('rejects an invalid work_type value via the CHECK constraint', async () => {
    const repository = await EntitySqliteRepository.open();
    await repository.createEntity({ id: 'work-type-invalid', kind: 'work' });
    await expect(
      repository.setWorkType({
        entityId: 'work-type-invalid',
        workType: 'novel' as unknown as null,
      }),
    ).rejects.toThrow();
    await repository.close();
  });

  it('populates a precision-carrying workDate for an office entity (Phase 3 period disambiguation)', async () => {
    const repository = await EntitySqliteRepository.open();
    await repository.createEntity({ id: 'office-period-1', kind: 'office' });
    await repository.setUserWorkDate({
      entityId: 'office-period-1',
      startYear: 265,
      endYear: 420,
      startPrecision: 'ca.',
    });

    const summary = await repository.getPanelSummary('office-period-1');
    expect(summary?.workDate).toEqual({
      startYear: 265,
      endYear: 420,
      startPrecision: 'ca.',
      endPrecision: null,
    });
    expect(summary?.startYear).toBe(265);
    expect(summary?.endYear).toBe(420);
    await repository.close();
  });

  it('does not populate workDate for place/org when no dates exist (regression)', async () => {
    const repository = await EntitySqliteRepository.open();
    await repository.createEntity({ id: 'place-no-dates', kind: 'place' });
    await repository.createEntity({ id: 'org-no-dates', kind: 'org' });

    expect((await repository.getPanelSummary('place-no-dates'))?.workDate).toBeNull();
    expect((await repository.getPanelSummary('org-no-dates'))?.workDate).toBeNull();
    await repository.close();
  });

  it('prefers a birth/death row over the generic dates row for workDate on a non-work kind', async () => {
    const repository = await EntitySqliteRepository.open();
    await repository.createEntity({ id: 'office-with-birth', kind: 'office' });
    await repository.setUserEntityDate({ entityId: 'office-with-birth', part: 'birth', year: 100 });
    await repository.setUserWorkDate({
      entityId: 'office-with-birth',
      startYear: 200,
      endYear: 300,
    });

    // birth/death rows take precedence in the existing startYear/endYear fallback chain,
    // so workDate (built from the same precedence) should stay null here rather than
    // reflect the generic 'dates' row.
    expect((await repository.getPanelSummary('office-with-birth'))?.workDate).toBeNull();
    await repository.close();
  });
});

describe('the "thing" entity kind', () => {
  it('creates a things subtype row', async () => {
    const repository = await EntitySqliteRepository.open();
    const entity = await repository.createEntity({ id: 'thing-qi', kind: 'thing' });

    expect(entity.kind).toBe('thing');
    expect(
      await repository.backend.get('SELECT 1 FROM things WHERE entity_id = ?', ['thing-qi']),
    ).toEqual({ 1: 1 });
    expect(await repository.integrityCheck()).toEqual(['ok']);
    await repository.close();
  });

  it('createPopulatedEntity accepts kind "thing" with names and authorities', async () => {
    const repository = await EntitySqliteRepository.open();
    await repository.createPopulatedEntity({
      id: 'thing-qi-2',
      kind: 'thing',
      description: 'A foundational concept in Chinese philosophy',
      names: [{ text: '氣', isPrimary: true }],
      authorities: [{ type: 'Wikidata', value: 'Q838368' }],
    });

    const summary = await repository.getPanelSummary('thing-qi-2');
    expect(summary?.kind).toBe('thing');
    expect(summary?.names.map((n) => n.text)).toEqual(['氣']);
    await repository.close();
  });

  it('updateSubtype writes, overwrites, and clears a subtype', async () => {
    const repository = await EntitySqliteRepository.open();
    await repository.createEntity({ id: 'thing-subtype-1', kind: 'thing' });

    expect((await repository.getPanelSummary('thing-subtype-1'))?.subtype).toBeNull();

    await repository.updateSubtype('thing-subtype-1', 'philosophical_concept');
    expect((await repository.getPanelSummary('thing-subtype-1'))?.subtype).toBe(
      'philosophical_concept',
    );
    expect(
      await repository.backend.get(
        `SELECT value FROM entity_metadata WHERE entity_id = ? AND key = 'subtype'`,
        ['thing-subtype-1'],
      ),
    ).toEqual({ value: 'philosophical_concept' });

    await repository.updateSubtype('thing-subtype-1', 'medicinal_plant');
    expect((await repository.getPanelSummary('thing-subtype-1'))?.subtype).toBe('medicinal_plant');
    expect(
      await repository.backend.get(
        `SELECT COUNT(*) AS count FROM entity_metadata WHERE key = 'subtype'`,
      ),
    ).toEqual({ count: 1 });

    await repository.updateSubtype('thing-subtype-1', null);
    expect((await repository.getPanelSummary('thing-subtype-1'))?.subtype).toBeNull();

    await repository.close();
  });

  it('surfaces subtype through listPanelSummaries as well as getPanelSummary', async () => {
    const repository = await EntitySqliteRepository.open();
    await repository.createEntity({ id: 'thing-subtype-2', kind: 'thing' });
    await repository.updateSubtype('thing-subtype-2', 'bibliographic_category');

    const list = await repository.listPanelSummaries('thing');
    expect(list.find((entity) => entity.id === 'thing-subtype-2')?.subtype).toBe(
      'bibliographic_category',
    );

    await repository.close();
  });

  it('surfaces subtype through listCandidateRecords for tag-bomb, but only for thing entities', async () => {
    const repository = await EntitySqliteRepository.open();
    await repository.createEntity({ id: 'thing-subtype-3', kind: 'thing' });
    await repository.updateSubtype('thing-subtype-3', 'medicinal_plant');
    await repository.createEntity({ id: 'person-no-subtype', kind: 'person' });

    const things = await repository.listCandidateRecords('thing');
    expect(things.find((record) => record.id === 'thing-subtype-3')?.subtype).toBe(
      'medicinal_plant',
    );

    const persons = await repository.listCandidateRecords('person');
    expect(persons.find((record) => record.id === 'person-no-subtype')?.subtype).toBeUndefined();

    await repository.close();
  });
});

describe('entity_relations repository methods', () => {
  it('creates a relation and lists it from both the subject and the object side', async () => {
    const repository = await EntitySqliteRepository.open();
    await repository.createEntity({ id: 'thing-qi', kind: 'thing' });
    await repository.createEntity({ id: 'person-zhuangzi', kind: 'person' });

    const relationId = await repository.createRelation({
      subjectEntityId: 'person-zhuangzi',
      objectEntityId: 'thing-qi',
      relationType: 'discussion',
    });
    expect(relationId).toBeGreaterThan(0);

    const fromSubject = await repository.listRelationsForEntity('person-zhuangzi');
    expect(fromSubject).toEqual([
      expect.objectContaining({
        id: relationId,
        relationType: 'discussion',
        isSubject: true,
        otherEntityId: 'thing-qi',
        otherEntityKind: 'thing',
      }),
    ]);

    const fromObject = await repository.listRelationsForEntity('thing-qi');
    expect(fromObject).toEqual([
      expect.objectContaining({
        id: relationId,
        relationType: 'discussion',
        isSubject: false,
        otherEntityId: 'person-zhuangzi',
        otherEntityKind: 'person',
      }),
    ]);

    await repository.close();
  });

  it('soft-removes a relation: it disappears from listings but the row survives withdrawn', async () => {
    const repository = await EntitySqliteRepository.open();
    await repository.createEntity({ id: 'thing-a', kind: 'thing' });
    await repository.createEntity({ id: 'thing-b', kind: 'thing' });
    const relationId = await repository.createRelation({
      subjectEntityId: 'thing-a',
      objectEntityId: 'thing-b',
      relationType: 'association',
      symmetric: true,
    });

    expect(await repository.updateRelationStatus(relationId, 'withdrawn')).toBe(true);
    expect(await repository.listRelationsForEntity('thing-a')).toEqual([]);
    expect(await repository.listRelationsForEntity('thing-b')).toEqual([]);
    expect(
      await repository.backend.get('SELECT status FROM entity_relations WHERE id = ?', [
        relationId,
      ]),
    ).toEqual({ status: 'withdrawn' });

    await repository.close();
  });

  it('replaceEntityContentFrom carries admin-level, source-entry dates, and storage mode across, remapping authority ids', async () => {
    const source = await EntitySqliteRepository.open();
    const target = await EntitySqliteRepository.open();
    await source.createEntity({ id: 'place-src', kind: 'place' });
    await target.createEntity({ id: 'place-dst', kind: 'place' });
    await source.applyAuthorityBackfillPatch({
      entityId: 'place-src',
      storageMode: 'coordinates',
      adminLevels: [{ source: 'CBDB', level: 'xian' }],
      sourceEntries: [
        {
          source: 'CBDB',
          authId: 'c_addr_123',
          dates: [
            { from: 0, to: 260 },
            { from: 704, to: null },
          ],
        },
      ],
    });

    expect(await target.replaceEntityContentFrom(source, 'place-src', 'place-dst')).toBe(true);

    const summary = await target.getPanelSummary('place-dst');
    expect(summary?.storageMode).toBe('coordinates');
    expect(summary?.adminLevel).toEqual({ level: 'xian', source: 'CBDB' });
    expect(summary?.sourceEntries).toEqual([
      {
        source: 'CBDB',
        authId: 'c_addr_123',
        dates: [
          { from: 0, to: 260, label: null },
          { from: 704, to: null, label: null },
        ],
      },
    ]);

    await source.close();
    await target.close();
  });
});

describe('Phase 5: origin-place reference linking', () => {
  it('setOriginReference points an existing person_origins row at a place entity', async () => {
    const repository = await EntitySqliteRepository.open();
    await repository.createEntity({ id: 'person-origin-1', kind: 'person' });
    await repository.addOrigin({
      entityId: 'person-origin-1',
      label: '鄱陽',
      source: 'CBDB',
      ref: 'c_addr_123',
    });
    await repository.createEntity({ id: 'place-xyz', kind: 'place' });

    const key = (await repository.getPanelSummary('person-origin-1'))!.assertions.find(
      (assertion) => assertion.element === 'placeName',
    )!.key;

    expect(await repository.setOriginReference('person-origin-1', key, '#place-xyz')).toBe(true);
    expect(
      await repository.backend.get('SELECT reference FROM person_origins WHERE id = ?', [
        Number(key.split(':')[1]),
      ]),
    ).toEqual({ reference: '#place-xyz' });

    // Refuses to touch a row belonging to a different entity.
    expect(await repository.setOriginReference('some-other-person', key, '#place-xyz')).toBe(false);

    await repository.close();
  });
});

describe('Phase 5: persisted place clusters (admin level, source-entry dates, storage mode)', () => {
  it('applies storage mode, admin-level candidates, and per-source date ranges via applyAuthorityBackfillPatch', async () => {
    const repository = await EntitySqliteRepository.open();
    await repository.createEntity({ id: 'place-cluster-1', kind: 'place' });

    const result = await repository.applyAuthorityBackfillPatch({
      entityId: 'place-cluster-1',
      storageMode: 'coordinates',
      geo: [{ source: 'CBDB', lat: 32.05, lon: 118.78 }],
      adminLevels: [{ source: 'CBDB', level: 'xian' }],
      sourceEntries: [
        {
          source: 'CBDB',
          authId: 'c_addr_123',
          dates: [
            { from: 0, to: 260 },
            { from: 501, to: 504 },
            { from: 704, to: null, label: null },
          ],
        },
        { source: 'CHGIS', authId: 'sys_456', dates: [{ from: 1000, to: 1400, label: 'Song' }] },
      ],
    });
    expect(result.changed).toBe(true);

    const summary = await repository.getPanelSummary('place-cluster-1');
    expect(summary?.storageMode).toBe('coordinates');
    expect(summary?.adminLevel).toEqual({ level: 'xian', source: 'CBDB' });
    expect(summary?.sourceEntries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'CBDB',
          authId: 'c_addr_123',
          dates: [
            { from: 0, to: 260, label: null },
            { from: 501, to: 504, label: null },
            { from: 704, to: null, label: null },
          ],
        }),
        expect.objectContaining({
          source: 'CHGIS',
          authId: 'sys_456',
          dates: [{ from: 1000, to: 1400, label: 'Song' }],
        }),
      ]),
    );
    // Attaching a source entry also writes an ordinary idno, so existing
    // crosswalk lookups (collectEntityIdsByAuthorities) keep finding it.
    expect(summary?.authorities).toEqual(
      expect.arrayContaining([
        { type: 'CBDB', value: 'c_addr_123' },
        { type: 'CHGIS', value: 'sys_456' },
      ]),
    );

    // Re-applying the identical patch is a no-op, not a duplicate insert.
    const second = await repository.applyAuthorityBackfillPatch({
      entityId: 'place-cluster-1',
      sourceEntries: [
        {
          source: 'CBDB',
          authId: 'c_addr_123',
          dates: [
            { from: 0, to: 260 },
            { from: 501, to: 504 },
            { from: 704, to: null },
          ],
        },
      ],
      adminLevels: [{ source: 'CBDB', level: 'xian' }],
    });
    expect(second.changed).toBe(false);
    expect(
      (await repository.getPanelSummary('place-cluster-1'))?.sourceEntries.find(
        (entry) => entry.source === 'CBDB',
      )?.dates,
    ).toHaveLength(3);

    await repository.close();
  });

  it("accepts an admin-level candidate as the entity's own, replacing any prior user pick", async () => {
    const repository = await EntitySqliteRepository.open();
    await repository.createEntity({ id: 'place-cluster-2', kind: 'place' });
    await repository.applyAuthorityBackfillPatch({
      entityId: 'place-cluster-2',
      adminLevels: [
        { source: 'CBDB', level: 'xian' },
        { source: 'CHGIS', level: 'zhou' },
      ],
    });
    const candidates = (await repository.getPanelSummary('place-cluster-2'))!.assertions.filter(
      (assertion) => assertion.noteType === 'adminLevel',
    );
    expect(candidates).toHaveLength(2);
    const chgisKey = candidates.find((c) => c.source === 'CHGIS')!.key;

    expect(await repository.acceptAdminLevelAssertion('place-cluster-2', chgisKey)).toBe(true);
    const summary = await repository.getPanelSummary('place-cluster-2');
    // Accepted candidate is promoted to origin='user' and wins selection…
    expect(summary?.adminLevel).toEqual({ level: 'zhou', source: null });
    // …the other authority candidate (CBDB) is left in place, still visible/rejectable.
    expect(
      await repository.backend.get('SELECT COUNT(*) AS count FROM place_admin_levels'),
    ).toEqual({ count: 2 });

    await repository.close();
  });

  it("delinking an authority removes only that authority's admin-level and date contributions", async () => {
    const repository = await EntitySqliteRepository.open();
    await repository.createEntity({ id: 'place-cluster-3', kind: 'place' });
    await repository.applyAuthorityBackfillPatch({
      entityId: 'place-cluster-3',
      adminLevels: [
        { source: 'CBDB', level: 'xian' },
        { source: 'CHGIS', level: 'xian' },
      ],
      sourceEntries: [
        { source: 'CBDB', authId: 'c_addr_123', dates: [{ from: 0, to: 260 }] },
        { source: 'CHGIS', authId: 'sys_456', dates: [{ from: 1000, to: 1400, label: 'Song' }] },
      ],
    });

    const removed = await repository.decoupleAuthority({
      entityId: 'place-cluster-3',
      type: 'CBDB',
      value: 'c_addr_123',
    });
    expect(removed).toBeGreaterThan(0);

    const summary = await repository.getPanelSummary('place-cluster-3');
    // CBDB's admin-level candidate and its authority row (+ cascaded dates) are gone…
    expect(summary?.sourceEntries).toEqual([
      { source: 'CHGIS', authId: 'sys_456', dates: [{ from: 1000, to: 1400, label: 'Song' }] },
    ]);
    // …CHGIS's own admin-level candidate is untouched.
    expect(
      await repository.backend.all(
        `SELECT source FROM place_admin_levels WHERE entity_id = ? ORDER BY source`,
        ['place-cluster-3'],
      ),
    ).toEqual([{ source: 'CHGIS' }]);
    expect(
      await repository.backend.get(
        'SELECT COUNT(*) AS count FROM place_authority_dates pad JOIN entity_authorities ea ON ea.id = pad.authority_id WHERE ea.entity_id = ?',
        ['place-cluster-3'],
      ),
    ).toEqual({ count: 1 });

    await repository.close();
  });
});
