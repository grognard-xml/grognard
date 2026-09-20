import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EntitySqliteRepository } from './repository';
import {
  backfillDecisionTargetsFromXml,
  exportEntitiesXml,
  extractDecisionTargetEntriesFromXml,
  importEntitiesXml,
} from './xmlCodec';

describe('entity XML codec', () => {
  it('imports the legacy entity database and exports a re-importable database', async () => {
    const xml = readFileSync(join(__dirname, 'fixtures/legacy-entities.xml'), 'utf8');
    const first = await EntitySqliteRepository.open();
    const imported = await importEntitiesXml(first, xml);

    expect(imported.databaseId).toBe('b1e98777-6266-413b-b125-7f6d5ec5bcc8');
    expect(imported.entitiesImported).toBe(4);
    expect(imported.namesImported).toBe(9);
    expect(imported.authoritiesImported).toBe(10);
    expect(imported.duplicateEntityIds).toEqual([]);
    expect(imported.unresolvedReferences).toEqual([]);
    expect(
      (await first.getSummary('person-40f8324a-1498-4a87-aa27-f4025a9f2e99'))?.names[0]?.text,
    ).toBe('江祏');
    expect(
      (await first.getSummary('work-828e5bea-eecd-4e0b-8fe1-b07b137041bc'))?.names[0]?.text,
    ).toBe('南齊書');

    const exported = await exportEntitiesXml(first);
    const second = await EntitySqliteRepository.open();
    const reimported = await importEntitiesXml(second, exported);

    expect(reimported.entitiesImported).toBe(4);
    expect(await second.listEntities()).toHaveLength(4);
    expect(await second.listNames('person-40f8324a-1498-4a87-aa27-f4025a9f2e99', true)).toEqual(
      expect.arrayContaining([expect.objectContaining({ text: '江祏' })]),
    );
    expect(await second.integrityCheck()).toEqual(['ok']);
    await first.close();
    await second.close();
  });

  it('structures date ranges, name roles, office data, relations, and extension data', async () => {
    const xml = `<?xml version="1.0"?><TEI xmlns="http://www.tei-c.org/ns/1.0">
      <teiHeader><fileDesc><titleStmt><title>Test</title></titleStmt><publicationStmt><idno type="grognard-entity-database">test-db</idno></publicationStmt><sourceDesc><p>Source</p></sourceDesc></fileDesc></teiHeader>
      <standOff>
        <listPerson><person xml:id="person-a"><persName type="primary">甲</persName><note type="familyName">甲氏</note><note type="dates" from="0479" to="0502" fromCirca="true" notAfter="0503" dateSystem="sanmiao" calendarPayload="{&quot;era&quot;:&quot;永明&quot;}">era text</note><affiliation ref="#office-a">尚書令</affiliation><note type="authority-cache" source="CBDB" when="2026-01-01">{&quot;x&quot;:1}</note><note type="duplicate-ok">reviewed</note></person></listPerson>
        <listOrg type="offices"><org xml:id="office-a"><orgName type="primary">尚書令</orgName><state type="office-classification" ref="CBDB:1">civil</state></org></listOrg>
        <listBibl><bibl xml:id="work-a"><title type="primary">A Work</title><author><persName ref="#person-a">甲</persName></author></bibl></listBibl>
        <listRelation type="office-hierarchy"><relation name="parentOf" active="#office-a" passive="#office-a" mutual="true"/></listRelation>
      </standOff>
    </TEI>`;
    const repository = await EntitySqliteRepository.open();
    const report = await importEntitiesXml(repository, xml);

    expect(report.entitiesImported).toBe(3);
    expect(report.duplicateEntityIds).toEqual([]);
    expect(report.unresolvedReferences).toEqual([]);
    expect(
      await repository.backend.get(
        "SELECT name_role FROM entity_names WHERE entity_id = ? AND name_role = 'family'",
        ['person-a'],
      ),
    ).toEqual(expect.objectContaining({ name_role: 'family' }));
    expect(
      await repository.backend.get('SELECT family_name FROM people WHERE entity_id = ?', [
        'person-a',
      ]),
    ).toEqual({ family_name: '甲氏' });
    expect(
      await repository.backend.get(
        'SELECT from_circa, not_after, date_system, calendar_payload FROM entity_dates WHERE entity_id = ?',
        ['person-a'],
      ),
    ).toEqual(
      expect.objectContaining({ from_circa: 1, not_after: '0503', date_system: 'sanmiao' }),
    );
    expect(
      await repository.backend.get(
        'SELECT COUNT(*) AS count FROM person_offices WHERE person_id = ?',
        ['person-a'],
      ),
    ).toEqual({ count: 1 });
    expect(
      await repository.backend.get(
        'SELECT COUNT(*) AS count FROM office_classifications WHERE office_id = ?',
        ['office-a'],
      ),
    ).toEqual({ count: 1 });
    expect(await repository.backend.get('SELECT COUNT(*) AS count FROM entity_relations')).toEqual({
      count: 1,
    });
    expect(await repository.backend.get('SELECT COUNT(*) AS count FROM authority_caches')).toEqual({
      count: 1,
    });
    expect(await repository.backend.get('SELECT COUNT(*) AS count FROM entity_decisions')).toEqual({
      count: 1,
    });

    const exported = await exportEntitiesXml(repository);
    expect(exported).toContain('fromCirca="true"');
    expect(exported).toContain('dateSystem="sanmiao"');
    expect(exported).toContain('listRelation');
    expect(exported).toContain('type="familyName"');
    expect(exported).toContain('>甲氏</note>');
    await repository.close();
  });

  it('extracts and backfills decision target refs from sibling XML', async () => {
    const xml = `<?xml version="1.0"?><TEI xmlns="http://www.tei-c.org/ns/1.0">
      <teiHeader><fileDesc><titleStmt><title>Test</title></titleStmt><publicationStmt><idno type="grognard-entity-database">test-db</idno></publicationStmt><sourceDesc><p>Source</p></sourceDesc></fileDesc></teiHeader>
      <standOff>
        <listPerson>
          <person xml:id="person-a"><persName>甲</persName><note type="duplicate-ok" target="#person-a #person-b">ok</note></person>
          <person xml:id="person-b"><persName>乙</persName><note type="concordance-rejected" source="CBDB" target="CBDB:1 CBDB:2"/></person>
        </listPerson>
      </standOff>
    </TEI>`;
    expect(extractDecisionTargetEntriesFromXml(xml)).toEqual([
      {
        entityId: 'person-a',
        decisionType: 'duplicate-ok',
        targetRefs: '#person-a #person-b',
        source: null,
        payloadJson: 'ok',
      },
      {
        entityId: 'person-b',
        decisionType: 'concordance-rejected',
        targetRefs: 'CBDB:1 CBDB:2',
        source: 'CBDB',
        payloadJson: null,
      },
    ]);

    const repository = await EntitySqliteRepository.open();
    await repository.createEntity({ id: 'person-a', kind: 'person' });
    await repository.createEntity({ id: 'person-b', kind: 'person' });
    await repository.backend.run(
      `INSERT INTO entity_decisions
          (entity_id, decision_type, target_refs, origin, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      ['person-a', 'duplicate-ok', null, 'xml', '2026-01-01'],
    );
    const report = await backfillDecisionTargetsFromXml(repository, xml);
    expect(report).toEqual({ updated: 1, inserted: 1, unchanged: 0 });
    expect(
      await repository.backend.get(
        `SELECT target_refs FROM entity_decisions
           WHERE entity_id = ? AND decision_type = 'duplicate-ok'`,
        ['person-a'],
      ),
    ).toEqual({ target_refs: '#person-a #person-b' });
    await repository.close();
  });

  it('round-trips a "thing" entity and a relation through export/import', async () => {
    const repository = await EntitySqliteRepository.open();
    await repository.createPopulatedEntity({
      id: 'thing-qi',
      kind: 'thing',
      description: 'A foundational concept',
      names: [{ text: '氣', isPrimary: true }],
    });
    await repository.updateSubtype('thing-qi', 'philosophical_concept');
    await repository.createEntity({ id: 'person-zhuangzi', kind: 'person' });
    await repository.createRelation({
      subjectEntityId: 'person-zhuangzi',
      objectEntityId: 'thing-qi',
      relationType: 'discussion',
    });

    const exported = await exportEntitiesXml(repository, { databaseId: 'test-thing-db' });
    expect(exported).toContain('<list type="things">');
    expect(exported).toContain('xml:id="thing-qi"');
    expect(exported).toContain('name="discussion"');
    expect(exported).toContain('<note type="subtype">philosophical_concept</note>');
    await repository.close();

    const reimported = await EntitySqliteRepository.open();
    const report = await importEntitiesXml(reimported, exported);

    expect(report.unresolvedReferences).toEqual([]);
    expect((await reimported.getEntity('thing-qi'))?.kind).toBe('thing');
    expect(
      await reimported.backend.get('SELECT 1 FROM things WHERE entity_id = ?', ['thing-qi']),
    ).toEqual({ 1: 1 });
    expect((await reimported.getPanelSummary('thing-qi'))?.subtype).toBe('philosophical_concept');
    expect(
      await reimported.backend.get(
        'SELECT relation_type, subject_entity_id, object_entity_id FROM entity_relations',
      ),
    ).toEqual({
      relation_type: 'discussion',
      subject_entity_id: 'person-zhuangzi',
      object_entity_id: 'thing-qi',
    });
    await reimported.close();
  });

  it('round-trips a persisted place cluster: storage mode, admin level, and sourceEntry dates', async () => {
    const repository = await EntitySqliteRepository.open();
    await repository.createEntity({ id: 'place-cluster-xml', kind: 'place' });
    await repository.addName({
      entityId: 'place-cluster-xml',
      text: '竟陵',
      isPrimary: true,
    });
    await repository.applyAuthorityBackfillPatch({
      entityId: 'place-cluster-xml',
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
        { source: 'CHGIS', authId: 'sys_456', dates: [{ from: 1000, to: 1400, label: 'Song' }] },
      ],
    });

    const exported = await exportEntitiesXml(repository, { databaseId: 'test-place-cluster-db' });
    expect(exported).toContain('type="coordinates"');
    expect(exported).toContain('<note type="adminLevel"');
    expect(exported).toContain('<sourceEntry source="CBDB" authId="c_addr_123"');
    expect(exported).toContain('<date from="0" to="260"></date>');
    expect(exported).toContain('<date from="704"></date>');
    expect(exported).toContain('<sourceEntry source="CHGIS" authId="sys_456"');
    expect(exported).toContain('<date from="1000" to="1400">Song</date>');
    // A source-entry authority never also gets a plain <idno> for the same value.
    expect(exported).not.toContain('<idno type="CBDB">c_addr_123</idno>');
    await repository.close();

    const reimported = await EntitySqliteRepository.open();
    const report = await importEntitiesXml(reimported, exported);
    expect(report.unresolvedReferences).toEqual([]);

    const summary = await reimported.getPanelSummary('place-cluster-xml');
    expect(summary?.storageMode).toBe('coordinates');
    expect(summary?.adminLevel).toEqual({ level: 'xian', source: 'CBDB' });
    expect(summary?.sourceEntries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'CBDB',
          authId: 'c_addr_123',
          dates: [
            { from: 0, to: 260, label: null },
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
    await reimported.close();
  });
});
