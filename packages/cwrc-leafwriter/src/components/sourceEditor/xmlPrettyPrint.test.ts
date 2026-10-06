import { prettyPrintXml } from './xmlPrettyPrint';

// Stand-in for the schema: only these elements may hold text.
const textual = new Set(['p', 'head', 'quote', 'bibl', 'title', 'note']);
const canContainText = (name: string) => textual.has(name);

describe('prettyPrintXml', () => {
  test('indents element-only containers and splits flat markup where the schema forbids text', () => {
    const xml = '<TEI><text><body><div><head>A</head><p>x</p></div></body></text></TEI>';
    expect(prettyPrintXml(xml, { canContainText })).toBe(
      [
        '<TEI>',
        '  <text>',
        '    <body>',
        '      <div>',
        '        <head>A</head>',
        '        <p>x</p>',
        '      </div>',
        '    </body>',
        '  </text>',
        '</TEI>',
      ].join('\n'),
    );
  });

  test('never adds whitespace inside text-bearing elements', () => {
    const xml = '<div><p>a<persName>b</persName> <hi>c</hi>d</p></div>';
    expect(prettyPrintXml(xml, { canContainText })).toBe(
      ['<div>', '  <p>a<persName>b</persName> <hi>c</hi>d</p>', '</div>'].join('\n'),
    );
  });

  test('a mixed-content parent of bare elements is left flat when the schema allows text', () => {
    const xml = '<div><p><cit>a</cit><cit>b</cit></p></div>';
    expect(prettyPrintXml(xml, { canContainText })).toBe(
      ['<div>', '  <p><cit>a</cit><cit>b</cit></p>', '</div>'].join('\n'),
    );
  });

  test('re-indents an already line-broken text-capable parent without adding breaks', () => {
    const xml = ['<div>', '<p>', '      <cit>a</cit>', '<cit>b</cit>', '</p>', '</div>'].join('\n');
    expect(prettyPrintXml(xml, { canContainText })).toBe(
      ['<div>', '  <p>', '    <cit>a</cit>', '    <cit>b</cit>', '  </p>', '</div>'].join('\n'),
    );
  });

  test('without schema knowledge it only re-indents, never adds line breaks', () => {
    expect(prettyPrintXml('<a><b>x</b><c>y</c></a>')).toBe('<a><b>x</b><c>y</c></a>');
    expect(prettyPrintXml('<a>\n<b>x</b>\n</a>')).toBe('<a>\n  <b>x</b>\n</a>');
  });

  test('keeps xml:space="preserve" subtrees untouched', () => {
    const xml = '<a><pre xml:space="preserve"><b/>\n  <c/></pre></a>';
    expect(prettyPrintXml(xml, { canContainText: () => false })).toBe(
      ['<a>', '  <pre xml:space="preserve"><b/>\n  <c/></pre>', '</a>'].join('\n'),
    );
  });

  test('puts prolog nodes on their own lines and keeps a trailing newline', () => {
    const xml = '<?xml version="1.0"?><?xml-model href="x"?><!-- c --><a><b/></a>\n';
    expect(prettyPrintXml(xml, { canContainText: () => false })).toBe(
      [
        '<?xml version="1.0"?>',
        '<?xml-model href="x"?>',
        '<!-- c -->',
        '<a>',
        '  <b/>',
        '</a>',
        '',
      ].join('\n'),
    );
  });

  test('is idempotent', () => {
    const xml = '<TEI><text><body><div><head>A</head><p>x<hi>y</hi></p></div></body></text></TEI>';
    const once = prettyPrintXml(xml, { canContainText })!;
    expect(prettyPrintXml(once, { canContainText })).toBe(once);
  });

  test('keeps CRLF line endings', () => {
    const out = prettyPrintXml('<a>\r\n<b/>\r\n</a>', { canContainText: () => false })!;
    expect(out).toBe('<a>\r\n  <b/>\r\n</a>');
  });

  test('handles ">" in attribute values', () => {
    expect(prettyPrintXml('<a n="1>2"><b/></a>', { canContainText: () => false })).toBe(
      '<a n="1>2">\n  <b/>\n</a>',
    );
  });

  test('returns null for malformed XML', () => {
    expect(prettyPrintXml('<a><b></a>')).toBeNull();
    expect(prettyPrintXml('<a>')).toBeNull();
    expect(prettyPrintXml('</a>')).toBeNull();
    expect(prettyPrintXml('text only')).toBeNull();
    expect(prettyPrintXml('<!DOCTYPE a [<!ENTITY x "y">]><a/>')).toBeNull();
  });
});
