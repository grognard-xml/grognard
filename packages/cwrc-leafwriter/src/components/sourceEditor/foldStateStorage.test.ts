import { loadFoldState, saveFoldState } from './foldStateStorage';

describe('foldStateStorage', () => {
  beforeEach(() => window.localStorage.clear());

  test('returns undefined for a document never saved, [] for one saved empty', () => {
    expect(loadFoldState('a.xml')).toBeUndefined();
    saveFoldState('a.xml', []);
    expect(loadFoldState('a.xml')).toEqual([]);
  });

  test('round-trips folds per document', () => {
    saveFoldState('a.xml', [{ line: 2, name: 'teiHeader' }]);
    saveFoldState('b.xml', [{ line: 30, name: 'div' }]);
    expect(loadFoldState('a.xml')).toEqual([{ line: 2, name: 'teiHeader' }]);
    expect(loadFoldState('b.xml')).toEqual([{ line: 30, name: 'div' }]);
  });

  test('drops the oldest documents past the cap', () => {
    for (let i = 0; i < 105; i += 1) saveFoldState(`d${i}.xml`, []);
    expect(loadFoldState('d0.xml')).toBeUndefined();
    expect(loadFoldState('d104.xml')).toEqual([]);
  });

  test('survives corrupt or unavailable storage', () => {
    window.localStorage.setItem('grognard.sourceEditor.folds', '{not json');
    expect(loadFoldState('a.xml')).toBeUndefined();
    expect(() => saveFoldState('a.xml', [])).not.toThrow();
  });
});
