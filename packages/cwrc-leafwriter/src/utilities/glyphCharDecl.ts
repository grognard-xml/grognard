const XML_NS = 'http://www.w3.org/XML/1998/namespace';

export interface GlyphGraphicSpec {
  glyphId: string;
  sourceUrl: string;
  svgUrl: string;
  svgWidth: number;
  svgHeight: number;
}

export interface GlyphGraphicEntry {
  sourceUrl: string;
  svgUrl: string;
  width: number;
  height: number;
}

const childrenNamed = (parent: Element, localName: string): Element[] =>
  Array.from(parent.children).filter((child) => child.localName === localName);

const firstChildNamed = (parent: Element, localName: string): Element | null =>
  childrenNamed(parent, localName)[0] ?? null;

const createNamedElement = (doc: Document, ns: string | null, localName: string): Element =>
  ns ? doc.createElementNS(ns, localName) : doc.createElement(localName);

/**
 * A `<g>` element's TEI content model is text-only (no child elements) on
 * every schema Grognard uses that defines `<g>` at all - so a glyph's two
 * `<graphic>` elements can't legally live inside it. The standard TEI
 * mechanism for exactly this ("points to a description of the character or
 * glyph intended") is `<g ref="#id">` in the running text, with the actual
 * description registered once in `<teiHeader><encodingDesc><charDecl>` as
 * `<glyph xml:id="id">` - whose content model explicitly permits `<graphic>`
 * children. This function creates or updates that header registration; the
 * body only ever gets a bare `<g ref="#id">`.
 *
 * Returns null if `xml` doesn't parse or has no `<teiHeader>` at all (the
 * caller should fall back to a schema that doesn't support this - see
 * TEI Lite, which lacks `<g>`/`<charDecl>` entirely and uses a bare
 * `<graphic subtype="glyph">` in the running text instead).
 */
export const ensureGlyphCharDeclEntry = (xml: string, spec: GlyphGraphicSpec): string | null => {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror')) return null;

  const root = doc.documentElement;
  const ns = root.namespaceURI;

  const header = firstChildNamed(root, 'teiHeader');
  if (!header) return null;

  let encodingDesc = firstChildNamed(header, 'encodingDesc');
  if (!encodingDesc) {
    encodingDesc = createNamedElement(doc, ns, 'encodingDesc');
    const fileDesc = firstChildNamed(header, 'fileDesc');
    if (fileDesc) {
      header.insertBefore(encodingDesc, fileDesc.nextSibling);
    } else {
      header.insertBefore(encodingDesc, header.firstChild);
    }
  }

  let charDecl = firstChildNamed(encodingDesc, 'charDecl');
  if (!charDecl) {
    charDecl = createNamedElement(doc, ns, 'charDecl');
    encodingDesc.appendChild(charDecl);
  }

  // Replace-in-place if this id already has an entry (the "replace image" escape hatch).
  const existing = childrenNamed(charDecl, 'glyph').find(
    (el) => el.getAttributeNS(XML_NS, 'id') === spec.glyphId,
  );
  if (existing) charDecl.removeChild(existing);

  const glyph = createNamedElement(doc, ns, 'glyph');
  glyph.setAttributeNS(XML_NS, 'xml:id', spec.glyphId);

  const source = createNamedElement(doc, ns, 'graphic');
  source.setAttribute('type', 'source');
  source.setAttribute('url', spec.sourceUrl);
  glyph.appendChild(source);

  const normalized = createNamedElement(doc, ns, 'graphic');
  normalized.setAttribute('type', 'normalized');
  normalized.setAttribute('url', spec.svgUrl);
  normalized.setAttribute('mimeType', 'image/svg+xml');
  normalized.setAttribute('width', String(spec.svgWidth));
  normalized.setAttribute('height', String(spec.svgHeight));
  glyph.appendChild(normalized);

  charDecl.appendChild(glyph);

  return new XMLSerializer().serializeToString(doc);
};

/** Resolves a `<g ref="#id">` back to its `<charDecl><glyph xml:id="id">` entry. */
export const findGlyphCharDeclEntry = (xml: string, glyphId: string): GlyphGraphicEntry | null => {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror')) return null;

  const glyph = Array.from(doc.getElementsByTagName('*')).find(
    (el) => el.localName === 'glyph' && el.getAttributeNS(XML_NS, 'id') === glyphId,
  );
  if (!glyph) return null;

  const graphics = childrenNamed(glyph, 'graphic');
  const source = graphics.find((el) => el.getAttribute('type') === 'source');
  const normalized = graphics.find((el) => el.getAttribute('type') === 'normalized');
  if (!source || !normalized) return null;

  const width = Number(normalized.getAttribute('width'));
  const height = Number(normalized.getAttribute('height'));
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;

  return {
    sourceUrl: source.getAttribute('url') ?? '',
    svgUrl: normalized.getAttribute('url') ?? '',
    width,
    height,
  };
};
