import {
  addFindEntry,
  addXPathEntry,
  MAX_SEARCH_HISTORY,
  readFindHistory,
  readXPathHistory,
  writeFindHistory,
  writeXPathHistory,
  type FindHistoryEntry,
} from './searchHistory';

const find = (query: string, over: Partial<FindHistoryEntry> = {}): FindHistoryEntry => ({
  query,
  ignoreCase: false,
  useRegex: false,
  scope: 'currentFile',
  docScope: 'both',
  customPath: '',
  ...over,
});

describe('addFindEntry', () => {
  it('puts the newest search first', () => {
    const list = addFindEntry(addFindEntry([], find('a')), find('b'));
    expect(list.map((entry) => entry.query)).toEqual(['b', 'a']);
  });

  it('moves a repeated search to the top instead of listing it twice', () => {
    const list = addFindEntry(addFindEntry(addFindEntry([], find('a')), find('b')), find('a'));
    expect(list.map((entry) => entry.query)).toEqual(['a', 'b']);
  });

  it('treats the same text with other options or scope as another search', () => {
    let list = addFindEntry([], find('a'));
    list = addFindEntry(list, find('a', { useRegex: true }));
    list = addFindEntry(list, find('a', { scope: 'project' }));
    list = addFindEntry(list, find('a', { ignoreCase: true }));
    expect(list).toHaveLength(4);
  });

  it('ignores the custom folder unless the scope is a custom one', () => {
    let list = addFindEntry([], find('a', { customPath: '/x' }));
    list = addFindEntry(list, find('a', { customPath: '/y' }));
    expect(list).toHaveLength(1);
    list = addFindEntry(list, find('b', { scope: 'custom', customPath: '/x' }));
    list = addFindEntry(list, find('b', { scope: 'custom', customPath: '/y' }));
    expect(list).toHaveLength(3);
  });

  it('keeps the replacement a search was last used with when it is run again without one', () => {
    let list = addFindEntry([], find('a', { replace: 'b' }));
    list = addFindEntry(list, find('a'));
    expect(list[0]?.replace).toBe('b');
  });

  it('replaces the replacement when a new one is used, and treats "" as a real one', () => {
    let list = addFindEntry([], find('a', { replace: 'b' }));
    list = addFindEntry(list, find('a', { replace: 'c' }));
    expect(list[0]?.replace).toBe('c');
    list = addFindEntry(list, find('a', { replace: '' }));
    expect(list[0]?.replace).toBe('');
  });

  it('does not record an empty search', () => {
    expect(addFindEntry([], find('   '))).toEqual([]);
  });

  it('trims the text and keeps at most the limit', () => {
    expect(addFindEntry([], find('  a  '))[0]?.query).toBe('a');
    let list: FindHistoryEntry[] = [];
    for (let i = 0; i < MAX_SEARCH_HISTORY + 10; i++) list = addFindEntry(list, find(`q${i}`));
    expect(list).toHaveLength(MAX_SEARCH_HISTORY);
    expect(list[0]?.query).toBe(`q${MAX_SEARCH_HISTORY + 9}`);
  });
});

describe('addXPathEntry', () => {
  it('orders, dedupes and ignores empty queries', () => {
    const entry = (query: string) => ({ query, scope: 'currentFile' as const, customPath: '' });
    let list = addXPathEntry([], entry('//p'));
    list = addXPathEntry(list, entry('//note'));
    list = addXPathEntry(list, entry('//p'));
    list = addXPathEntry(list, entry('  '));
    expect(list.map((item) => item.query)).toEqual(['//p', '//note']);
  });
});

describe('storage', () => {
  beforeEach(() => localStorage.clear());

  it('round-trips both histories', () => {
    writeFindHistory([find('a', { replace: '', useRegex: true })]);
    expect(readFindHistory()).toEqual([find('a', { replace: '', useRegex: true })]);
    writeXPathHistory([{ query: '//p', scope: 'project', customPath: '' }]);
    expect(readXPathHistory()).toEqual([{ query: '//p', scope: 'project', customPath: '' }]);
  });

  it('survives damaged or odd data', () => {
    localStorage.setItem('grognard:searchHistory:find', '{not json');
    expect(readFindHistory()).toEqual([]);
    localStorage.setItem('grognard:searchHistory:find', JSON.stringify({ a: 1 }));
    expect(readFindHistory()).toEqual([]);
    localStorage.setItem(
      'grognard:searchHistory:find',
      JSON.stringify([null, 3, { query: '' }, { query: 'ok', scope: 'nowhere', useRegex: 'yes' }]),
    );
    expect(readFindHistory()).toEqual([find('ok')]);
  });

  it('keeps working when storage throws', () => {
    const spy = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const setSpy = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(readFindHistory()).toEqual([]);
    expect(() => writeFindHistory([find('a')])).not.toThrow();
    spy.mockRestore();
    setSpy.mockRestore();
  });
});
