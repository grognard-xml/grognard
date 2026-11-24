import { extractAttributeSelectors, loadCssRuleSuggestions } from './cssRuleSuggestions';

describe('extractAttributeSelectors', () => {
  test('finds exact-match attribute selectors with either quote style or none', () => {
    const css = `
      hi[rend='bold'] { font-weight: bold; }
      seg[type="lemma"]:before, title[level=m] { color: red; }
    `;
    expect(extractAttributeSelectors(css)).toEqual([
      { tagName: 'hi', attrName: 'rend', attrValue: 'bold' },
      { tagName: 'seg', attrName: 'type', attrValue: 'lemma' },
      { tagName: 'title', attrName: 'level', attrValue: 'm' },
    ]);
  });

  test('reads editor-style *[_tag] selectors and ignores duplicates', () => {
    const css = `
      *[_tag='seg'][type='lemma'] { color: red; }
      seg[type='lemma'] { color: blue; }
    `;
    expect(extractAttributeSelectors(css)).toEqual([
      { tagName: 'seg', attrName: 'type', attrValue: 'lemma' },
    ]);
  });

  test('skips existence checks, other operators, multi-attribute selectors, comments and at-rules', () => {
    const css = `
      /* seg[type='hidden'] { } */
      item[n]:before { }
      ref[target^='http'] { }
      seg[type='a'][subtype='b'] { }
      @media print { p { } }
    `;
    expect(extractAttributeSelectors(css)).toEqual([]);
  });
});

describe('loadCssRuleSuggestions', () => {
  afterEach(() => {
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  });

  test('returns nothing without a CSS path or when reading fails', async () => {
    expect(await loadCssRuleSuggestions('/p')).toEqual([]);
    (window as unknown as { electronAPI: unknown }).electronAPI = {
      readFile: jest.fn().mockRejectedValue(new Error('missing')),
    };
    expect(await loadCssRuleSuggestions('/p', 'schema/x.css')).toEqual([]);
  });

  test('reads the project-relative stylesheet', async () => {
    const readFile = jest.fn().mockResolvedValue("hi[rend='bold'] { }");
    (window as unknown as { electronAPI: unknown }).electronAPI = { readFile };
    const result = await loadCssRuleSuggestions('/p', 'schema/x.css');
    expect(readFile).toHaveBeenCalledWith('/p/schema/x.css');
    expect(result).toHaveLength(1);
  });
});
