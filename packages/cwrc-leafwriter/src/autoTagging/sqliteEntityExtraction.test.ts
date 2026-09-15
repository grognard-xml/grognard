import { parseEntities } from './entities';
import { EntitySqliteRepository } from '../../../../apps/desktop/src/entityDbSqlite/repository';
import {
  ingestExtractedEntityDataSqlite,
  refreshExtractedEntityDataForDocumentSqlite,
} from './sqliteEntityExtraction';

describe('sqlite entity extraction reconciliation', () => {
  const storeFrom = (repository: EntitySqliteRepository) => ({
    sqliteReconcileXmlExtractedData: async (
      input: Parameters<EntitySqliteRepository['reconcileXmlExtractedData']>[0],
    ) => repository.reconcileXmlExtractedData(input),
  });

  it('does not remove validated (user) values when the XML assertion vanishes', async () => {
    const repository = await EntitySqliteRepository.open();
    await repository.createEntity({ id: 'person-1', kind: 'person' });
    await repository.addName({ entityId: 'person-1', text: '張衡', isPrimary: true });
    const source = 'xml:chapter-1#personWrapper:1';
    const store = storeFrom(repository);

    await ingestExtractedEntityDataSqlite(store, 'chapter-1', 'person-1', source, [
      { element: 'nationality', value: '漢' },
    ]);
    expect((await repository.getPanelSummary('person-1'))?.nationalities).toEqual(['漢']);

    // Validate: origin becomes user, source retained (panel validateAssertion).
    const key = (await repository.getPanelSummary('person-1'))!.assertions.find(
      (row) => row.element === 'nationality',
    )!.key;
    expect(await repository.validateAssertion('person-1', key)).toBe(true);

    await ingestExtractedEntityDataSqlite(store, 'chapter-1', 'person-1', source, []);
    expect((await repository.getPanelSummary('person-1'))?.nationalities).toEqual(['漢']);
    await repository.close();
  });

  it('cleans up assertions when a keyed person wrapper is unwrapped', async () => {
    const repository = await EntitySqliteRepository.open();
    await repository.createEntity({ id: 'person-fan', kind: 'person' });
    await repository.addName({ entityId: 'person-fan', text: '範', isPrimary: true });
    const store = storeFrom(repository);
    const corpus = parseEntities(
      `<TEI><text><name type="personWrapper" key="person-fan"><nationality>漢</nationality><persName key="person-fan">範</persName></name></text></TEI>`,
    );
    const extract = (wrapper: Element) =>
      Array.from(wrapper.getElementsByTagName('nationality')).map((element) => ({
        element: 'nationality',
        value: element.textContent!.trim(),
      }));

    expect(
      (await refreshExtractedEntityDataForDocumentSqlite(store, corpus, 'chapter-1', extract))
        .added,
    ).toBe(1);
    expect((await repository.getPanelSummary('person-fan'))?.nationalities).toEqual(['漢']);

    const wrapper = corpus.getElementsByTagName('name')[0]!;
    wrapper.removeAttribute('type');
    wrapper.removeAttribute('key');
    expect(
      (await refreshExtractedEntityDataForDocumentSqlite(store, corpus, 'chapter-1', extract))
        .removed,
    ).toBe(1);
    expect((await repository.getPanelSummary('person-fan'))?.nationalities).toEqual([]);
    await repository.close();
  });

  it('maps placeName, state, and nobleTitle into typed person tables', async () => {
    const repository = await EntitySqliteRepository.open();
    await repository.createEntity({ id: 'person-2', kind: 'person' });
    const store = storeFrom(repository);
    const source = 'xml:doc#personWrapper:1';
    await ingestExtractedEntityDataSqlite(store, 'doc', 'person-2', source, [
      { element: 'placeName', value: '建康' },
      { element: 'state', value: '尚書' },
      {
        element: 'nobleTitle',
        value: '鄱陽王',
        children: [
          { element: 'placeName', value: '鄱陽' },
          { element: 'roleName', value: '王' },
        ],
      },
    ]);
    const summary = (await repository.getPanelSummary('person-2'))!;
    expect(summary.placesOfOrigin).toEqual(['建康']);
    expect(summary.roles).toEqual(['尚書']);
    expect(summary.nobleTitles).toEqual([expect.objectContaining({ fief: '鄱陽', title: '王' })]);
    expect(summary.assertions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          element: 'placeName',
          origin: 'xml',
          source,
          value: '建康',
        }),
        expect.objectContaining({
          element: 'affiliation',
          origin: 'xml',
          source,
          value: '尚書',
        }),
        expect.objectContaining({
          element: 'nobleTitle',
          origin: 'xml',
          source,
        }),
      ]),
    );
    await repository.close();
  });
});
