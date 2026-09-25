import $ from 'jquery';

import type Writer from '../js/Writer';
import { handleGraphics, refreshGraphicsInBody } from '../js/schema/mappings/utitlities';
import { assetDirForDocument, joinPath, relativeAssetUrl } from './assetPaths';
import { blobToUint8Array } from './clipboardImage';
import {
  createGlyphAssetsFromBytes,
  dataUrlToBytes,
  GAIJI_MARKER_PATTERN,
  GAIJI_PLACEHOLDER,
  GLYPH_ASSET_DIR,
  glyphIdForImageBytes,
  sharperImage,
} from './gaijiImport';
import {
  ensureGlyphCharDeclEntry,
  findGlyphCharDeclEntry,
  type GlyphGraphicSpec,
} from './glyphCharDecl';

export type GlyphContext =
  | {
      kind: 'legacy';
      gElement: Element;
      sourceGraphicElement: Element;
      normalizedGraphicElement: Element;
      glyphId: string;
    }
  | { kind: 'ref'; gElement: Element; glyphId: string };

const GLYPH_DIR = GLYPH_ASSET_DIR;

export const glyphDirForDocument = (documentPath: string): string =>
  assetDirForDocument(documentPath, GLYPH_DIR);

export const relativeGlyphUrl = (fileName: string): string => relativeAssetUrl(GLYPH_DIR, fileName);

/** Clock + random suffix: two glyphs made in the same millisecond must not collide. */
export const generatePastedGlyphId = (): string =>
  `glyph-paste-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const activeDocumentFilePath = (): string | null =>
  window.__leafWriterProject?.getActiveFilePath?.() ?? null;

/**
 * Why a dropped/pasted image can't be turned into a glyph right now, or
 * `null` if it can. Checked *before* deciding whether to let the browser's
 * own default image handling through, so a paste/drop that we recognize as
 * an image either becomes a glyph or gets a clear reason - never silently
 * nothing (paste) or a raw untagged `<img>` TinyMCE inserted on its own
 * (drop), both of which look like the feature is broken rather than blocked.
 */
export const glyphImageUnavailableReason = (): string | null => {
  if (!activeDocumentFilePath()) {
    return 'LW.Save the document before inserting a glyph image.';
  }
  if (!window.electronAPI?.vectorizeGlyphImage || !window.electronAPI?.writeBinaryFile) {
    return 'LW.Glyph image insertion is unavailable — try restarting the app.';
  }
  return null;
};

/**
 * Saves both the raw pasted bytes and the vectorized SVG next to the open
 * document, under `_glyphs/`. The raw source is kept (never rendered) so a
 * palaeographer can later compare "what was actually on the page" against
 * the cleaned-up glyph - see `<graphic type="source">` in insertGlyph.
 */
const saveGlyphAssets = async (
  glyphId: string,
  bytes: Uint8Array,
  svg: string,
): Promise<{ sourceUrl: string; svgUrl: string } | null> => {
  const docPath = activeDocumentFilePath();
  const api = window.electronAPI;
  if (!docPath || !api?.writeBinaryFile || !api.writeFile || !api.ensureDirectory) return null;

  const dir = glyphDirForDocument(docPath);
  await api.ensureDirectory(dir);

  const sourceFileName = `${glyphId}.png`;
  const svgFileName = `${glyphId}.svg`;
  await api.writeBinaryFile(joinPath(dir, sourceFileName), bytes);
  await api.writeFile(joinPath(dir, svgFileName), svg);

  return {
    sourceUrl: relativeGlyphUrl(sourceFileName),
    svgUrl: relativeGlyphUrl(svgFileName),
  };
};

/** Full document XML (with header) lives separately from the visual DOM -
 * see getStoredDocumentXml's doc comment in utitlities.ts for why. Mirrors
 * the read/write pattern already used elsewhere in this package
 * (useTeiHeaderRepairPrompt.tsx): update both the `__desktopStoredDocumentXml`
 * global and the overmind state that also tracks it, since different
 * consumers read from different ones. */
const getStoredDocumentXml = (writer: Writer): string | null =>
  window.__desktopStoredDocumentXml ?? writer.overmindState?.document?.xml ?? null;

const setStoredDocumentXml = (writer: Writer, xml: string): void => {
  window.__desktopStoredDocumentXml = xml;
  writer.overmindActions?.document?.updateXMLHeader?.(xml);
  writer.overmindActions?.document?.setDocumentXml?.(xml);
};

/** TEI Lite defines neither `<g>` nor `<charDecl>`/`<glyph>` - every other
 * registered schema (TEI All, TEI Simple Print, jTEI, CBETA) does, with an
 * identical text-only content model for `<g>` (confirmed by reading each
 * RNG directly), so `<g ref="#id">` + a `<charDecl>` registration is valid
 * there without any schema patching. */
const supportsGlyphCharDecl = (writer: Writer): boolean =>
  writer.schemaManager.getCurrentSchema()?.mapping !== 'teiLite';

/**
 * `addStructureTag`'s default (ADD) path leaves the selection *inside* the
 * new tag's content (its `\uFEFF` sentinel) - the right thing for an
 * ordinary text tag, where typing over the sentinel is how you fill it in.
 * A glyph never gets real text content (it's marked `_textallowed="false"`
 * and `contenteditable="false"` once styled), so leaving the caret inside
 * it is actively wrong: a second glyph inserted right after the first would
 * capture that stale "inside the previous glyph" selection as its own
 * bookmark, and land nested inside it instead of beside it - two glyphs
 * visually piled on the same spot. It also confuses TinyMCE's normal
 * click-to-select/Backspace-to-delete handling for `contenteditable=false`
 * widgets, which expects the caret to sit *beside* them, not inside their
 * (illegal, from the widget's perspective) content. Moving the caret to
 * just after the element once it exists in the DOM fixes both.
 */
export const placeCaretAfterElement = (writer: Writer, el: Element | null | undefined): void => {
  const editor = writer.editor;
  if (!editor || !el || !el.isConnected) return;
  const rng = editor.dom.createRng();
  rng.setStartAfter(el);
  rng.collapse(true);
  editor.selection.setRng(rng);
};

export const insertGlyph = async (
  writer: Writer,
  options: {
    glyphId: string;
    sourceUrl: string;
    svgUrl: string;
    svgWidth: number;
    svgHeight: number;
    /** Optional `<mapping>` entries (ids/kage/unicode/...) - see GlyphGraphicSpec. */
    mappings?: { type: string; value: string }[];
    /** Reference an existing `<charDecl>` entry for this id as-is instead of
     * rewriting it - which would drop any `<mapping>`s added to it since. */
    reuseExistingDeclaration?: boolean;
  },
): Promise<boolean> => {
  const bookmark = writer.editor?.selection.getBookmark(1);
  if (!bookmark) return false;

  let insertedEl: Element;

  if (supportsGlyphCharDecl(writer)) {
    const storedXml = getStoredDocumentXml(writer);
    if (!storedXml) return false;
    const { reuseExistingDeclaration, ...spec } = options;
    const updatedXml =
      reuseExistingDeclaration && findGlyphCharDeclEntry(storedXml, options.glyphId)
        ? storedXml
        : ensureGlyphCharDeclEntry(storedXml, spec);
    if (!updatedXml) return false;

    // `<g>`'s content model is text-only on every schema that defines it
    // (confirmed by reading the RNG directly) - no `<graphic>` children,
    // just the standard `ref` attribute pointing at the charDecl entry
    // just written above.
    const gTag = writer.tagger.addStructureTag({
      action: writer.tagger.ADD,
      tagName: 'g',
      attributes: { type: 'glyph', n: options.glyphId, ref: `#${options.glyphId}` },
      bookmark,
    });
    if (!gTag?.id) return false;
    insertedEl = gTag;

    setStoredDocumentXml(writer, updatedXml);
  } else {
    // TEI Lite fallback: a bare <graphic> directly in the running text -
    // the only non-standard-character mechanism it actually offers. No
    // source-provenance sibling here (the raw PNG still lands in
    // _glyphs/ on disk; it's just not referenced from the XML) - keeping
    // that pairing schema-valid on a schema this minimal isn't worth the
    // added complexity for what's expected to be a rarely-used combination.
    const glyphGraphic = writer.tagger.addStructureTag({
      action: writer.tagger.ADD,
      tagName: 'graphic',
      attributes: {
        type: 'glyph',
        url: options.svgUrl,
        mimeType: 'image/svg+xml',
        width: String(options.svgWidth),
        height: String(options.svgHeight),
      },
      bookmark,
    });
    if (!glyphGraphic?.id) return false;
    insertedEl = glyphGraphic;
  }

  const body = writer.editor?.getBody();
  if (body) {
    // Apply glyph chrome after processNewContent so ID fixups can't race the
    // mask styling — and so we clear the insert-time \uFEFF sentinel last.
    writer.tagger.processNewContent(body);
    refreshGraphicsInBody(body, { documentFilePath: activeDocumentFilePath() });
  }
  placeCaretAfterElement(writer, insertedEl);
  writer.event('contentChanged').publish();
  return true;
};

/**
 * Common entry point for both paste and drag-and-drop of an image file:
 * vectorize via the Electron main-process pipeline (composite/flatten/
 * despeckle/trace - see apps/desktop/src/glyphVectorize.ts), then insert
 * the glyph via insertGlyph (see there for the schema-dependent shape).
 */
export const insertGlyphFromImageFile = async (writer: Writer, file: File): Promise<boolean> => {
  const spec = await prepareGlyphFromImageBytes(writer, await blobToUint8Array(file));
  return spec ? insertGlyph(writer, { ...spec, reuseExistingDeclaration: true }) : false;
};

/**
 * The async half of inserting an image as a glyph: trace it and write its
 * assets, or reuse the document's existing glyph for identical bytes (ids
 * are content hashes - see glyphIdForImageBytes). Split from insertGlyph so
 * a batch can do all the slow work first, then touch the DOM in one go.
 */
export const prepareGlyphFromImageBytes = async (
  writer: Writer,
  bytes: Uint8Array,
): Promise<GlyphGraphicSpec | null> => {
  const documentPath = activeDocumentFilePath();
  if (!documentPath) return null;
  try {
    return await createGlyphAssetsFromBytes({
      api: window.electronAPI,
      bytes,
      documentPath,
      xml: supportsGlyphCharDecl(writer) ? getStoredDocumentXml(writer) : null,
    });
  } catch (error) {
    console.warn('[glyph] could not convert image', error);
    return null;
  }
};

/** Bytes for an `<img src>` found in pasted HTML: inline data, one of Word's
 * clipboard temp files (read by the main process - see readPastedImageFile),
 * or a web image. Null for anything else (blob:, cid:, a deleted temp file). */
export const readPastedImageBytes = async (src: string): Promise<Uint8Array | null> => {
  const api = window.electronAPI;
  if (/^data:/i.test(src)) return dataUrlToBytes(src);
  if (/^file:/i.test(src)) return (await api?.readPastedImageFile?.(src)) ?? null;
  if (/^https?:/i.test(src)) return (await api?.fetchRemoteImageBytes?.(src)) ?? null;
  return null;
};

const findGaijiMarker = (
  body: HTMLElement,
): { node: Text; start: number; end: number; index: number } | null => {
  const walker = body.ownerDocument.createTreeWalker(body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.nodeValue ?? '';
    const match = new RegExp(GAIJI_MARKER_PATTERN).exec(text);
    if (match) {
      return {
        node: node as Text,
        start: match.index,
        end: match.index + match[0].length,
        index: Number(match[1]),
      };
    }
  }
  return null;
};

/**
 * Second half of a paste with inline images (see gaijiImport.ts): the text
 * is already in the document with a marker where each image was. Convert
 * every image first (slow, async), then replace all markers in a single
 * undo step - each with its glyph, or 〓 where the image couldn't be read
 * or converted, so nothing disappears silently.
 */
export const convertGaijiMarkersInEditor = async (
  writer: Writer,
  sources: string[],
  /** Other copies of the same images, index-aligned with `sources` (Word's
   * RTF renditions - see readClipboardRtfImages); whichever of the two has
   * more pixels is traced. */
  alternates?: (Uint8Array | null)[],
): Promise<{ converted: number; failed: number }> => {
  // Keyed by content hash: the same gaiji repeated in one paste is traced once.
  const specsByGlyphId = new Map<string, Promise<GlyphGraphicSpec | null>>();
  const specs = await Promise.all(
    sources.map(async (src, index) => {
      const fromHtml = await readPastedImageBytes(src);
      const bytes = sharperImage(fromHtml, alternates?.[index] ?? null);
      if (!bytes) return null;
      const glyphId = await glyphIdForImageBytes(bytes);
      if (!specsByGlyphId.has(glyphId)) {
        specsByGlyphId.set(glyphId, prepareGlyphFromImageBytes(writer, bytes));
      }
      return specsByGlyphId.get(glyphId)!;
    }),
  );

  const editor = writer.editor;
  const body = editor?.getBody();
  if (!editor || !body) return { converted: 0, failed: sources.length };

  let converted = 0;
  let failed = 0;
  const replaceAll = () => {
    for (let marker = findGaijiMarker(body); marker; marker = findGaijiMarker(body)) {
      const range = editor.dom.createRng();
      range.setStart(marker.node, marker.start);
      range.setEnd(marker.node, marker.end);
      range.deleteContents();
      editor.selection.setRng(range);

      const spec = specs[marker.index];
      if (spec) {
        // insertGlyph does all of its DOM work synchronously, so it lands
        // inside this transaction despite being declared async.
        void insertGlyph(writer, { ...spec, reuseExistingDeclaration: true });
        converted += 1;
      } else {
        const placeholder = editor.getDoc().createTextNode(GAIJI_PLACEHOLDER);
        range.insertNode(placeholder);
        placeCaretAfterElement(writer, placeholder as unknown as Element);
        failed += 1;
      }
    }
  };
  editor.undoManager.transact(replaceAll);
  body.normalize();

  writer.event('contentChanged').publish();
  return { converted, failed };
};

/** A dragged web image arrives as a remote URL, not bytes - fetch it via the
 * main process (see fetchRemoteImageBytes in apps/desktop/src/main.ts, which
 * isn't subject to the source page's CORS policy) and route it through the
 * same pipeline as a locally-dropped file. */
export const insertGlyphFromRemoteImageUrl = async (
  writer: Writer,
  url: string,
): Promise<boolean> => {
  const api = window.electronAPI;
  if (!api?.fetchRemoteImageBytes) return false;

  const bytes = await api.fetchRemoteImageBytes(url);
  if (!bytes) return false;

  const file = new File([bytes.slice()], 'dropped-image', { type: 'image/png' });
  return insertGlyphFromImageFile(writer, file);
};

/** Recognizes both the current `<g ref="#id">` shape and the legacy
 * `<g type="glyph"><graphic>...` shape inserted before this file existed
 * (still rendered - see isGlyphGraphic in utitlities.ts - just no longer
 * produced by insertGlyph). Returns null for the TEI Lite bare-`<graphic>`
 * fallback: with no `<g>`/`<charDecl>` for it to point into, there's no
 * escape hatch there yet beyond delete-and-repaste. */
export const resolveGlyphContext = (element: Element | null | undefined): GlyphContext | null => {
  if (!element) return null;

  const gElement =
    element.getAttribute('_tag') === 'g' && element.getAttribute('type') === 'glyph'
      ? element
      : element.parentElement?.getAttribute('_tag') === 'g' &&
          element.parentElement?.getAttribute('type') === 'glyph'
        ? element.parentElement
        : null;
  if (!gElement) return null;

  const glyphId = gElement.getAttribute('n') || '';
  if (!glyphId) return null;

  const graphics = Array.from(gElement.querySelectorAll('[_tag="graphic"], [_tag="GRAPHIC"]'));
  const sourceGraphicElement = graphics.find((el) => el.getAttribute('type') === 'source');
  const normalizedGraphicElement = graphics.find((el) => el.getAttribute('type') === 'normalized');
  if (sourceGraphicElement && normalizedGraphicElement) {
    return { kind: 'legacy', gElement, sourceGraphicElement, normalizedGraphicElement, glyphId };
  }

  if (gElement.getAttribute('ref') === `#${glyphId}`) {
    return { kind: 'ref', gElement, glyphId };
  }

  return null;
};

/** Re-runs vectorization against a fresh image and replaces the glyph's graphic(s) in place - the escape hatch for a bad auto-trace. */
export const replaceGlyphImage = async (
  writer: Writer,
  context: GlyphContext,
  file: File,
): Promise<boolean> => {
  const bytes = await blobToUint8Array(file);
  const api = window.electronAPI;
  if (!api?.vectorizeGlyphImage) return false;

  const result = await api.vectorizeGlyphImage(bytes);
  const saved = await saveGlyphAssets(context.glyphId, bytes, result.svg);
  if (!saved) return false;

  if (context.kind === 'legacy') {
    writer.tagger.setAttributesForTag(context.sourceGraphicElement, {
      ...writer.tagger.getAttributesForTag(context.sourceGraphicElement),
      url: saved.sourceUrl,
    });
    writer.tagger.setAttributesForTag(context.normalizedGraphicElement, {
      ...writer.tagger.getAttributesForTag(context.normalizedGraphicElement),
      url: saved.svgUrl,
      width: String(result.width),
      height: String(result.height),
    });

    const documentFilePath = activeDocumentFilePath();
    handleGraphics($(context.sourceGraphicElement), { documentFilePath });
    handleGraphics($(context.normalizedGraphicElement), { documentFilePath });
  } else {
    const storedXml = getStoredDocumentXml(writer);
    if (!storedXml) return false;
    const spec: GlyphGraphicSpec = {
      glyphId: context.glyphId,
      sourceUrl: saved.sourceUrl,
      svgUrl: saved.svgUrl,
      svgWidth: result.width,
      svgHeight: result.height,
    };
    const updatedXml = ensureGlyphCharDeclEntry(storedXml, spec);
    if (!updatedXml) return false;

    setStoredDocumentXml(writer, updatedXml);
    handleGraphics($(context.gElement), { documentFilePath: activeDocumentFilePath() });
  }

  writer.editor?.undoManager.add();
  writer.event('contentChanged').publish();
  return true;
};
