import $ from 'jquery';

import type Writer from '../js/Writer';
import { handleGraphics, refreshGraphicsInBody } from '../js/schema/mappings/utitlities';
import { assetDirForDocument, joinPath, relativeAssetUrl } from './assetPaths';
import { blobToUint8Array } from './clipboardImage';
import { ensureGlyphCharDeclEntry, type GlyphGraphicSpec } from './glyphCharDecl';

export type GlyphContext =
  | {
      kind: 'legacy';
      gElement: Element;
      sourceGraphicElement: Element;
      normalizedGraphicElement: Element;
      glyphId: string;
    }
  | { kind: 'ref'; gElement: Element; glyphId: string };

const GLYPH_DIR = '_glyphs';

export const glyphDirForDocument = (documentPath: string): string =>
  assetDirForDocument(documentPath, GLYPH_DIR);

export const relativeGlyphUrl = (fileName: string): string => relativeAssetUrl(GLYPH_DIR, fileName);

export const generatePastedGlyphId = (): string => `glyph-paste-${Date.now().toString(36)}`;

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

export const insertGlyph = async (
  writer: Writer,
  options: {
    glyphId: string;
    sourceUrl: string;
    svgUrl: string;
    svgWidth: number;
    svgHeight: number;
  },
): Promise<boolean> => {
  const bookmark = writer.editor?.selection.getBookmark(1);
  if (!bookmark) return false;

  if (supportsGlyphCharDecl(writer)) {
    const storedXml = getStoredDocumentXml(writer);
    if (!storedXml) return false;
    const updatedXml = ensureGlyphCharDeclEntry(storedXml, options);
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
  }

  const body = writer.editor?.getBody();
  if (body) {
    // Apply glyph chrome after processNewContent so ID fixups can't race the
    // mask styling — and so we clear the insert-time \uFEFF sentinel last.
    writer.tagger.processNewContent(body);
    refreshGraphicsInBody(body, { documentFilePath: activeDocumentFilePath() });
  }
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
  const bytes = await blobToUint8Array(file);
  const api = window.electronAPI;
  if (!api?.vectorizeGlyphImage) return false;

  const result = await api.vectorizeGlyphImage(bytes);
  const glyphId = generatePastedGlyphId();
  const saved = await saveGlyphAssets(glyphId, bytes, result.svg);
  if (!saved) return false;

  return insertGlyph(writer, {
    glyphId,
    sourceUrl: saved.sourceUrl,
    svgUrl: saved.svgUrl,
    svgWidth: result.width,
    svgHeight: result.height,
  });
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
