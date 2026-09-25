const XML_NS = 'http://www.w3.org/XML/1998/namespace';

export interface GlyphGraphicSpec {
  glyphId: string;
  sourceUrl: string;
  svgUrl: string;
  svgWidth: number;
  svgHeight: number;
  /** Optional `<mapping type="...">value</mapping>` children, e.g. `{ type: 'ids', value: '⿰言某' }` -
   * written before the `<graphic>` children, per the schema agreed in plugins/glyph_maker.md §5. */
  mappings?: { type: string; value: string }[];
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

/** The document's `<teiHeader><encodingDesc><charDecl>`, created (in
 * TEI's canonical position) if missing. Null without a `<teiHeader>`. */
const getOrCreateCharDecl = (doc: Document): Element | null => {
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
  return charDecl;
};

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

  const ns = doc.documentElement.namespaceURI;
  const charDecl = getOrCreateCharDecl(doc);
  if (!charDecl) return null;

  // Replace-in-place if this id already has an entry (the "replace image" escape hatch).
  const existing = childrenNamed(charDecl, 'glyph').find(
    (el) => el.getAttributeNS(XML_NS, 'id') === spec.glyphId,
  );
  if (existing) charDecl.removeChild(existing);

  const glyph = createNamedElement(doc, ns, 'glyph');
  glyph.setAttributeNS(XML_NS, 'xml:id', spec.glyphId);

  for (const mapping of spec.mappings ?? []) {
    const mappingEl = createNamedElement(doc, ns, 'mapping');
    mappingEl.setAttribute('type', mapping.type);
    mappingEl.textContent = mapping.value;
    glyph.appendChild(mappingEl);
  }

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

/**
 * A `<glyph>` Grognard itself wrote: an xml:id, only `<mapping>`/`<graphic>`
 * children, and both its graphics pointing into `_glyphs/`. Pasted, imported
 * and composed glyphs all have this shape; a hand-authored declaration
 * almost never does, and is never pruned.
 */
const isGrognardGlyph = (glyph: Element): boolean => {
  if (!glyph.getAttributeNS(XML_NS, 'id')) return false;
  const children = Array.from(glyph.children);
  if (children.some((child) => child.localName !== 'mapping' && child.localName !== 'graphic')) {
    return false;
  }
  const graphics = children.filter((child) => child.localName === 'graphic');
  const inGlyphDir = (type: string) =>
    graphics.some(
      (graphic) =>
        graphic.getAttribute('type') === type &&
        (graphic.getAttribute('url') ?? '').startsWith('_glyphs/'),
    );
  return inGlyphDir('source') && inGlyphDir('normalized');
};

/** Removes `el` together with the indentation text right before it, so a
 * pruned entry doesn't leave a blank line behind. */
const removeWithLeadingWhitespace = (el: Element) => {
  const previous = el.previousSibling;
  if (previous?.nodeType === Node.TEXT_NODE && !previous.nodeValue?.trim()) {
    previous.parentNode?.removeChild(previous);
  }
  el.parentNode?.removeChild(el);
};

/**
 * Declarations pruned during this session, by id - so that undoing the
 * deletion of a glyph after a save (the undo restores the `<g ref>` in the
 * text, but the saved header no longer declares it) gets its declaration
 * back at the next save instead of leaving a dangling reference.
 */
const prunedGlyphDeclarations = new Map<string, Element>();

/**
 * Run on every save. Drops `<charDecl><glyph>` entries Grognard created
 * that nothing in the document points to any more (the usual leftover of
 * deleting a badly pasted gaiji), then drops `<charDecl>`/`<encodingDesc>`
 * if that left them empty (TEI requires both to have content). Restores
 * any entry pruned earlier this session that is referenced again.
 *
 * The glyph's files in `_glyphs/` are deliberately left alone: that folder
 * is shared by every document beside it, and ids are content hashes, so
 * another document may well use the same file.
 *
 * Returns `xml` untouched (same string) when there is nothing to change.
 */
export const reconcileGlyphDeclarations = (xml: string): string => {
  if (!xml.includes('<glyph') && prunedGlyphDeclarations.size === 0) return xml;

  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror')) return xml;
  const header = firstChildNamed(doc.documentElement, 'teiHeader');
  if (!header) return xml;

  // Every `#id` pointer anywhere outside Grognard's own glyph declarations
  // (TEI pointer attributes can hold several, space-separated).
  const referenced = new Set<string>();
  for (const el of Array.from(doc.getElementsByTagName('*'))) {
    const declaration = el.closest('glyph');
    if (declaration && isGrognardGlyph(declaration)) continue;
    for (const attr of Array.from(el.attributes)) {
      for (const token of attr.value.split(/\s+/)) {
        if (token.startsWith('#') && token.length > 1) referenced.add(token.slice(1));
      }
    }
  }

  let changed = false;
  const encodingDesc = firstChildNamed(header, 'encodingDesc');
  const existingCharDecl = encodingDesc ? firstChildNamed(encodingDesc, 'charDecl') : null;
  const declared = new Set(
    existingCharDecl
      ? childrenNamed(existingCharDecl, 'glyph').map((el) => el.getAttributeNS(XML_NS, 'id'))
      : [],
  );

  const toRestore = [...prunedGlyphDeclarations].filter(
    ([id]) => referenced.has(id) && !declared.has(id),
  );
  if (toRestore.length > 0) {
    const charDecl = getOrCreateCharDecl(doc);
    if (charDecl) {
      for (const [id, glyph] of toRestore) {
        charDecl.appendChild(doc.importNode(glyph, true));
        prunedGlyphDeclarations.delete(id);
        changed = true;
      }
    }
  }

  // Looked up again: restoring may have just created it.
  const currentEncodingDesc = firstChildNamed(header, 'encodingDesc');
  const charDecl = currentEncodingDesc ? firstChildNamed(currentEncodingDesc, 'charDecl') : null;
  if (charDecl) {
    for (const glyph of childrenNamed(charDecl, 'glyph')) {
      const id = glyph.getAttributeNS(XML_NS, 'id') ?? '';
      if (!isGrognardGlyph(glyph) || referenced.has(id)) continue;
      prunedGlyphDeclarations.set(id, glyph.cloneNode(true) as Element);
      removeWithLeadingWhitespace(glyph);
      changed = true;
    }

    if (changed && charDecl.children.length === 0) {
      const parent = charDecl.parentElement;
      removeWithLeadingWhitespace(charDecl);
      if (parent && parent.localName === 'encodingDesc' && parent.children.length === 0) {
        removeWithLeadingWhitespace(parent);
      }
    }
  }

  if (!changed) return xml;

  let result = new XMLSerializer().serializeToString(doc);
  // XMLSerializer drops the XML declaration - put the original back.
  const declaration = /^\s*<\?xml\s[^?]*\?>/.exec(xml)?.[0];
  if (declaration && !result.trimStart().startsWith('<?xml')) {
    result = `${declaration.trim()}\n${result}`;
  }
  return result;
};

/** Test hook: forget the session's pruned declarations. */
export const clearPrunedGlyphDeclarations = (): void => prunedGlyphDeclarations.clear();
