import { analyzeXmlFolds, getFoldLabel } from './xmlFoldingParser';

const byName = (xml: string, name: string) => analyzeXmlFolds(xml).filter((r) => r.name === name);

describe('analyzeXmlFolds', () => {
  test('folds a multi-line element and keeps its close tag visible', () => {
    const xml = ['<div>', '  <p>a</p>', '  <p>b</p>', '</div>'].join('\n');
    expect(byName(xml, 'div')).toMatchObject([{ startLine: 1, endLine: 3 }]);
  });

  test('does not fold single-line elements or one-line-body elements', () => {
    expect(analyzeXmlFolds('<p>one line</p>')).toEqual([]);
    expect(analyzeXmlFolds('<p>\n</p>')).toEqual([]);
  });

  test('folds through the close line when text precedes the close tag', () => {
    const xml = ['<p>', 'text</p>'].join('\n');
    expect(byName(xml, 'p')).toMatchObject([{ startLine: 1, endLine: 2 }]);
  });

  test('ignores self-closing tags, declarations, PIs and CDATA', () => {
    const xml = [
      '<?xml version="1.0"?>',
      '<?xml-model href="x"?>',
      '<div>',
      '  <pb n="1"/>',
      '  <![CDATA[ <p> ]]>',
      '</div>',
    ].join('\n');
    expect(analyzeXmlFolds(xml)).toMatchObject([{ name: 'div', startLine: 3, endLine: 5 }]);
  });

  test('handles ">" inside quoted attribute values', () => {
    const xml = ['<div n="a>b">', '  <p>x</p>', '</div>'].join('\n');
    expect(byName(xml, 'div')).toMatchObject([{ startLine: 1, endLine: 2 }]);
  });

  test('folds multi-line comments as comments', () => {
    const xml = ['<!--', 'a', 'b', '-->', '<p/>'].join('\n');
    expect(analyzeXmlFolds(xml)).toMatchObject([{ kind: 'comment', startLine: 1, endLine: 4 }]);
  });

  test('keeps the outermost region when two elements open on one line', () => {
    const xml = ['<a><b>', 'x', '</b>', '</a>'].join('\n');
    expect(analyzeXmlFolds(xml)).toMatchObject([{ name: 'a', startLine: 1, endLine: 3 }]);
  });

  test('survives a stray close tag and unclosed elements', () => {
    expect(() => analyzeXmlFolds('</x>\n<a>\n<b>\n</a>')).not.toThrow();
    expect(byName('</x>\n<a>\n<b>\n</a>', 'a')).toMatchObject([{ startLine: 2, endLine: 3 }]);
  });

  test('collects type, head text and cit counts for labels', () => {
    const xml = [
      '<div type="omen-category">',
      '  <head>日名<hi>體</hi></head>',
      '  <p>',
      '    <cit><bibl/></cit>',
      '    <cit><bibl/></cit>',
      '  </p>',
      '</div>',
    ].join('\n');
    const [div] = byName(xml, 'div');
    expect(div).toMatchObject({ type: 'omen-category', headText: '日名體', citCount: 2 });
    expect(getFoldLabel(div!)).toBe('日名體 · 2 cit');
    expect(getFoldLabel(byName(xml, 'p')[0]!)).toBe('2 cit');
  });

  test('has no label for plain elements', () => {
    expect(getFoldLabel(byName('<teiHeader>\n<x/>\n<y/>\n</teiHeader>', 'teiHeader')[0]!)).toBe(
      null,
    );
  });
});
