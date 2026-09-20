/**
 * Palaeographic glyph images (paste/drop a character screenshot -> vectorize
 * -> inline, currentColor-masked character-like element) in the translation
 * pane and its footnotes - a plain-DOM/plain-Range counterpart to
 * `utilities/glyphEditor.ts` and `js/schema/mappings/utitlities.ts`'s
 * `handleGraphics`, which are both built on the main Visual editor's TinyMCE
 * `writer.tagger`/`_tag`-attribute convention that this pane doesn't use -
 * this pane's DOM already holds real element names directly (`<note>`,
 * `<bibl>`, `<ref>`...), so a glyph here is a real `<graphic>` element, not
 * an HTML span carrying a `_tag="graphic"` bookkeeping attribute.
 *
 * Deliberately the TEI-Lite-fallback shape only - a bare
 * `<graphic type="glyph" url="..." mimeType="image/svg+xml">` with no `<g>`
 * wrapper, no source-provenance sibling, and no `<teiHeader><charDecl>`
 * registration: translation files aren't schema-validated at all (confirmed
 * by grep - nothing in TranslationPane.tsx touches schemaManager except an
 * unrelated `getIdName()` call), so there's no schema-conformance reason to
 * use the heavier `<g ref="#id">` mechanism the main editor needs.
 */
import { joinPath } from '../utilities/assetPaths';
import { blobToUint8Array } from '../utilities/clipboardImage';
import {
  generatePastedGlyphId,
  glyphDirForDocument,
  relativeGlyphUrl,
} from '../utilities/glyphEditor';
import { fetchResourceText, resolveDocumentAssetUrl } from '../utilities/fetchResource';

export const GLYPH_SELECTOR = 'graphic[type="glyph"]';

/** Why a dropped/pasted image can't become a translation glyph right now, or
 * `null` if it can - mirrors `glyphImageUnavailableReason` in
 * `glyphEditor.ts`, but a translation glyph's asset path is anchored to the
 * translation file, not the main document, so it needs its own path to be
 * saved (the translation is created lazily and may not exist on disk yet). */
export const translationGlyphImageUnavailableReason = (
  translationPath: string | null | undefined,
): string | null => {
  if (!translationPath) {
    return 'LW.translationPane.glyphUnavailableNoFile';
  }
  if (!window.electronAPI?.vectorizeGlyphImage || !window.electronAPI?.writeBinaryFile) {
    return 'LW.translationPane.glyphUnavailableNoApi';
  }
  return null;
};

const saveTranslationGlyphAsset = async (
  translationPath: string,
  glyphId: string,
  bytes: Uint8Array,
  svg: string,
): Promise<string | null> => {
  const api = window.electronAPI;
  if (!api?.writeBinaryFile || !api.writeFile || !api.ensureDirectory) return null;

  const dir = glyphDirForDocument(translationPath);
  await api.ensureDirectory(dir);

  const sourceFileName = `${glyphId}.png`;
  const svgFileName = `${glyphId}.svg`;
  // The raw source is kept on disk for the same provenance reason as the
  // main editor's, even though (unlike there) nothing in the translation
  // XML points back to it - there's no schema-clean way to attach a second
  // sibling graphic without a wrapper here, and it's not worth inventing one.
  await api.writeBinaryFile(joinPath(dir, sourceFileName), bytes);
  await api.writeFile(joinPath(dir, svgFileName), svg);

  return relativeGlyphUrl(svgFileName);
};

/** Builds the `<graphic type="glyph">` element itself, not yet inserted. */
const buildGlyphElement = (svgUrl: string, width: number, height: number): Element => {
  const graphic = document.createElement('graphic');
  graphic.setAttribute('type', 'glyph');
  graphic.setAttribute('url', svgUrl);
  graphic.setAttribute('mimeType', 'image/svg+xml');
  graphic.setAttribute('width', String(width));
  graphic.setAttribute('height', String(height));
  return graphic;
};

/** Inserts `graphic` at `range` (deleting any current selection first, same
 * as this pane's own `insertFragmentAtRange`) and leaves the cursor just
 * after it. */
const insertAtRange = (range: Range, graphic: Element): void => {
  range.deleteContents();
  range.insertNode(graphic);
  const after = document.createRange();
  after.setStartAfter(graphic);
  after.collapse(true);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(after);
};

export const insertTranslationGlyphFromImageFile = async (
  translationPath: string,
  file: File,
  range: Range,
): Promise<boolean> => {
  const api = window.electronAPI;
  if (!api?.vectorizeGlyphImage) return false;

  const bytes = await blobToUint8Array(file);
  const result = await api.vectorizeGlyphImage(bytes);
  const glyphId = generatePastedGlyphId();
  const svgUrl = await saveTranslationGlyphAsset(translationPath, glyphId, bytes, result.svg);
  if (!svgUrl) return false;

  insertAtRange(range, buildGlyphElement(svgUrl, result.width, result.height));
  return true;
};

/** A dragged web image arrives as a remote URL, not bytes - same as
 * `insertGlyphFromRemoteImageUrl` in `glyphEditor.ts`. */
export const insertTranslationGlyphFromRemoteImageUrl = async (
  translationPath: string,
  url: string,
  range: Range,
): Promise<boolean> => {
  const api = window.electronAPI;
  if (!api?.fetchRemoteImageBytes) return false;

  const bytes = await api.fetchRemoteImageBytes(url);
  if (!bytes) return false;

  const file = new File([bytes.slice()], 'dropped-image', { type: 'image/png' });
  return insertTranslationGlyphFromImageFile(translationPath, file, range);
};

/**
 * Marks every glyph under `root` non-editable (so it behaves as an atomic
 * click-to-select, Backspace-to-delete unit, same reasoning as this
 * session's main-editor glyph fixes) and (re-)applies its CSS mask.
 *
 * Must be re-run after anything that can strip a live glyph's attributes -
 * in particular `sanitizeTranslationFragment`'s attribute pass, which
 * treats `contenteditable` and `style` as editing-only and strips them from
 * *every* element on *every* paste, not just newly pasted content (the
 * exact same reason `normalizeFootnoteNotes`/`prepareAtomicCitationFields`
 * are re-run after every paste too). No attempt is made to cache/skip
 * already-styled glyphs across calls - re-fetching a handful of small local
 * SVG files on an occasional paste is not worth the bookkeeping.
 */
export const prepareAtomicGlyphFields = (
  root: ParentNode,
  translationPath: string | null | undefined,
): void => {
  for (const graphic of Array.from(root.querySelectorAll(GLYPH_SELECTOR))) {
    const el = graphic as HTMLElement;
    el.setAttribute('contenteditable', 'false');
    el.style.display = 'inline-block';
    el.style.width = '1em';
    el.style.height = '1em';
    el.style.lineHeight = '0';
    el.style.verticalAlign = 'baseline';
    el.style.transform = 'translateY(var(--lw-glyph-baseline-shift, 0.22em))';
    el.style.color = 'inherit';
    el.style.backgroundColor = 'currentColor';
    el.style.maskSize = 'contain';
    el.style.maskRepeat = 'no-repeat';
    el.style.maskPosition = 'center';
    el.style.setProperty('-webkit-mask-size', 'contain');
    el.style.setProperty('-webkit-mask-repeat', 'no-repeat');
    el.style.setProperty('-webkit-mask-position', 'center');

    const relativeUrl = el.getAttribute('url');
    if (!relativeUrl) continue;
    const resolvedUrl = resolveDocumentAssetUrl(relativeUrl, translationPath ?? null);
    void fetchResourceText(resolvedUrl).then((svgText) => {
      if (!svgText) return;
      const dataUrl = `data:image/svg+xml,${encodeURIComponent(svgText)}`;
      el.style.maskImage = `url("${dataUrl}")`;
      el.style.setProperty('-webkit-mask-image', `url("${dataUrl}")`);
    });
  }
};
