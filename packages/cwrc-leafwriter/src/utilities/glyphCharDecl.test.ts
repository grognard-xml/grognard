import {
  clearPrunedGlyphDeclarations,
  ensureGlyphCharDeclEntry,
  findGlyphCharDeclEntry,
  reconcileGlyphDeclarations,
} from './glyphCharDecl';

const TEI_NS = 'http://www.tei-c.org/ns/1.0';

const baseXml = `<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="${TEI_NS}">
  <teiHeader>
    <fileDesc>
      <titleStmt><title>Test</title></titleStmt>
      <publicationStmt><p>Unpublished</p></publicationStmt>
      <sourceDesc><p>None</p></sourceDesc>
    </fileDesc>
  </teiHeader>
  <text><body><p>Hello</p></body></text>
</TEI>`;

const spec = {
  glyphId: 'glyph-1',
  sourceUrl: '_glyphs/glyph-1.png',
  svgUrl: '_glyphs/glyph-1.svg',
  svgWidth: 41,
  svgHeight: 49,
};

describe('ensureGlyphCharDeclEntry mappings', () => {
  it('writes mapping elements before the graphic children, in the given order', () => {
    const result = ensureGlyphCharDeclEntry(baseXml, {
      ...spec,
      mappings: [
        { type: 'ids', value: '⿰言某' },
        { type: 'kage', value: '99:0:0:0:0:100:200:u8a00:0:0:0' },
      ],
    });
    const doc = new DOMParser().parseFromString(result as string, 'application/xml');
    const glyph = doc.getElementsByTagNameNS(TEI_NS, 'glyph')[0];
    const childNames = Array.from(glyph.children).map((el) => el.localName);
    expect(childNames).toEqual(['mapping', 'mapping', 'graphic', 'graphic']);

    const mappings = Array.from(glyph.children).filter((el) => el.localName === 'mapping');
    expect(mappings[0].getAttribute('type')).toBe('ids');
    expect(mappings[0].textContent).toBe('⿰言某');
    expect(mappings[1].getAttribute('type')).toBe('kage');
  });

  it('omits mapping elements entirely when none are given (existing image-glyph callers unaffected)', () => {
    const result = ensureGlyphCharDeclEntry(baseXml, spec);
    const doc = new DOMParser().parseFromString(result as string, 'application/xml');
    const glyph = doc.getElementsByTagNameNS(TEI_NS, 'glyph')[0];
    expect(glyph.getElementsByTagNameNS(TEI_NS, 'mapping')).toHaveLength(0);
  });
});

describe('ensureGlyphCharDeclEntry', () => {
  it('creates encodingDesc/charDecl/glyph when none exist, right after fileDesc', () => {
    const result = ensureGlyphCharDeclEntry(baseXml, spec);
    expect(result).not.toBeNull();

    const doc = new DOMParser().parseFromString(result as string, 'application/xml');
    expect(doc.querySelector('parsererror')).toBeNull();

    const header = doc.getElementsByTagNameNS(TEI_NS, 'teiHeader')[0];
    const headerChildren = Array.from(header.children).map((el) => el.localName);
    expect(headerChildren).toEqual(['fileDesc', 'encodingDesc']);

    const glyph = doc.getElementsByTagNameNS(TEI_NS, 'glyph')[0];
    expect(glyph.getAttributeNS('http://www.w3.org/XML/1998/namespace', 'id')).toBe('glyph-1');

    const graphics = Array.from(glyph.children);
    expect(graphics.map((el) => el.getAttribute('type'))).toEqual(['source', 'normalized']);
    expect(graphics[0].getAttribute('url')).toBe('_glyphs/glyph-1.png');
    expect(graphics[1].getAttribute('url')).toBe('_glyphs/glyph-1.svg');
    expect(graphics[1].getAttribute('width')).toBe('41');
    expect(graphics[1].getAttribute('height')).toBe('49');
  });

  it('reuses an existing charDecl and appends a second glyph beside the first', () => {
    const once = ensureGlyphCharDeclEntry(baseXml, spec) as string;
    const twice = ensureGlyphCharDeclEntry(once, { ...spec, glyphId: 'glyph-2' }) as string;

    const doc = new DOMParser().parseFromString(twice, 'application/xml');
    const encodingDescs = doc.getElementsByTagNameNS(TEI_NS, 'encodingDesc');
    const charDecls = doc.getElementsByTagNameNS(TEI_NS, 'charDecl');
    expect(encodingDescs.length).toBe(1);
    expect(charDecls.length).toBe(1);

    const glyphIds = Array.from(doc.getElementsByTagNameNS(TEI_NS, 'glyph')).map((el) =>
      el.getAttributeNS('http://www.w3.org/XML/1998/namespace', 'id'),
    );
    expect(glyphIds).toEqual(['glyph-1', 'glyph-2']);
  });

  it('replaces an existing entry with the same id in place, rather than duplicating it', () => {
    const once = ensureGlyphCharDeclEntry(baseXml, spec) as string;
    const replaced = ensureGlyphCharDeclEntry(once, {
      ...spec,
      svgUrl: '_glyphs/glyph-1-retraced.svg',
      svgWidth: 50,
      svgHeight: 60,
    }) as string;

    const doc = new DOMParser().parseFromString(replaced, 'application/xml');
    const glyphs = doc.getElementsByTagNameNS(TEI_NS, 'glyph');
    expect(glyphs.length).toBe(1);
    const normalized = Array.from(glyphs[0].children).find(
      (el) => el.getAttribute('type') === 'normalized',
    );
    expect(normalized?.getAttribute('url')).toBe('_glyphs/glyph-1-retraced.svg');
    expect(normalized?.getAttribute('width')).toBe('50');
  });

  it('returns null for unparseable XML', () => {
    expect(ensureGlyphCharDeclEntry('<not-xml', spec)).toBeNull();
  });

  it('returns null when there is no teiHeader at all', () => {
    const noHeader = `<TEI xmlns="${TEI_NS}"><text><body><p>Hello</p></body></text></TEI>`;
    expect(ensureGlyphCharDeclEntry(noHeader, spec)).toBeNull();
  });
});

describe('findGlyphCharDeclEntry', () => {
  it('resolves a registered glyph back to its graphic urls and dimensions', () => {
    const xml = ensureGlyphCharDeclEntry(baseXml, spec) as string;
    const entry = findGlyphCharDeclEntry(xml, 'glyph-1');
    expect(entry).toEqual({
      sourceUrl: '_glyphs/glyph-1.png',
      svgUrl: '_glyphs/glyph-1.svg',
      width: 41,
      height: 49,
    });
  });

  it('returns null for an id that was never registered', () => {
    const xml = ensureGlyphCharDeclEntry(baseXml, spec) as string;
    expect(findGlyphCharDeclEntry(xml, 'nonexistent')).toBeNull();
  });

  it('returns null when width/height are missing or non-positive', () => {
    const xml = `<?xml version="1.0"?><TEI xmlns="${TEI_NS}"><teiHeader><encodingDesc><charDecl>
      <glyph xml:id="bad"><graphic type="source" url="a.png"/><graphic type="normalized" url="a.svg"/></glyph>
    </charDecl></encodingDesc></teiHeader><text><body/></text></TEI>`;
    expect(findGlyphCharDeclEntry(xml, 'bad')).toBeNull();
  });
});

describe('reconcileGlyphDeclarations', () => {
  beforeEach(() => clearPrunedGlyphDeclarations());

  const docWith = (body: string, extraGlyphs = '') => {
    let xml = ensureGlyphCharDeclEntry(baseXml, spec) as string;
    xml = ensureGlyphCharDeclEntry(xml, { ...spec, glyphId: 'glyph-2' }) as string;
    xml = xml.replace('</charDecl>', `${extraGlyphs}</charDecl>`);
    // As saved files have it (ensureGlyphCharDeclEntry's serializer drops it).
    if (!xml.startsWith('<?xml')) xml = `<?xml version="1.0" encoding="UTF-8"?>\n${xml}`;
    return xml.replace('<p>Hello</p>', body);
  };

  it('leaves the document byte-for-byte alone when every glyph is used', () => {
    const xml = docWith('<p>a<g type="glyph" ref="#glyph-1"/>b<g ref="#glyph-2"/></p>');
    expect(reconcileGlyphDeclarations(xml)).toBe(xml);
    expect(reconcileGlyphDeclarations(baseXml)).toBe(baseXml);
  });

  it('prunes unreferenced Grognard glyphs and keeps the XML declaration', () => {
    const xml = docWith('<p>a<g type="glyph" ref="#glyph-1"/>b</p>');
    const result = reconcileGlyphDeclarations(xml);
    expect(result.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(result).toContain('xml:id="glyph-1"');
    expect(result).not.toContain('xml:id="glyph-2"');
    expect(result).toContain('<p>a<g type="glyph" ref="#glyph-1"/>b</p>');
  });

  it('drops charDecl and encodingDesc once they are empty', () => {
    const result = reconcileGlyphDeclarations(docWith('<p>no glyphs left</p>'));
    expect(result).not.toContain('charDecl');
    expect(result).not.toContain('encodingDesc');
    expect(result).not.toMatch(/\n\s*\n\s*<\/teiHeader>/);
  });

  it('keeps encodingDesc when it has other content', () => {
    const xml = docWith('<p>none</p>').replace(
      '<encodingDesc>',
      '<encodingDesc><projectDesc><p>Mine</p></projectDesc>',
    );
    const result = reconcileGlyphDeclarations(xml);
    expect(result).not.toContain('charDecl');
    expect(result).toContain('<encodingDesc><projectDesc><p>Mine</p></projectDesc>');
  });

  it('never prunes hand-authored declarations', () => {
    const handWritten =
      '<glyph xml:id="hand"><glyphName>MY GLYPH</glyphName><graphic url="img/hand.png"/></glyph>';
    const result = reconcileGlyphDeclarations(docWith('<p>none</p>', handWritten));
    expect(result).toContain('xml:id="hand"');
    expect(result).not.toContain('xml:id="glyph-1"');
  });

  it('counts pointers in any attribute, including space-separated lists', () => {
    const xml = docWith('<p><seg corresp="#other #glyph-2">x</seg><g ref="#glyph-1"/></p>');
    expect(reconcileGlyphDeclarations(xml)).toBe(xml);
  });

  it('restores a pruned declaration when an undo brings its reference back', () => {
    const referenced = docWith('<p><g ref="#glyph-1"/><g ref="#glyph-2"/></p>');
    // Save 1: glyph-2 was deleted, so it is pruned.
    const saved = reconcileGlyphDeclarations(referenced.replace('<g ref="#glyph-2"/>', ''));
    expect(saved).not.toContain('xml:id="glyph-2"');
    // Undo restores the <g>; save 2 must declare it again.
    const afterUndo = saved.replace(
      '<g ref="#glyph-1"/>',
      '<g ref="#glyph-1"/><g ref="#glyph-2"/>',
    );
    const restored = reconcileGlyphDeclarations(afterUndo);
    expect(findGlyphCharDeclEntry(restored, 'glyph-2')).toEqual({
      sourceUrl: '_glyphs/glyph-1.png',
      svgUrl: '_glyphs/glyph-1.svg',
      width: 41,
      height: 49,
    });
  });
});
