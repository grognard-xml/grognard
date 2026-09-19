import type Writer from '../js/Writer';
import { resolveDocumentAssetUrl } from './fetchResource';
import { findGlyphCharDeclEntry } from './glyphCharDecl';
import { generatePastedGlyphId } from './glyphEditor';
import { refreshGraphicsInBody } from '../js/schema/mappings/utitlities';

/**
 * Every glyph already inserted somewhere in the current document, deduped by
 * resolved SVG url (what actually gets rendered) - regardless of which of
 * the three insertion shapes produced it (see glyphEditor.ts's doc comments
 * for why there are three). Reusing one never re-vectorizes or writes a new
 * file: a `ref` entry points at the same charDecl registration; the other
 * two shapes point at the same existing `_glyphs/*.svg`.
 *
 * `previewUrl` is resolved (grognard://…) for rendering a thumbnail;
 * `relativeUrl` is the original document-relative path as it must be
 * written back into a new `url` attribute - never the resolved one, which
 * is a runtime-only, machine-specific value.
 */
export type GlyphOccurrence =
  | { kind: 'ref'; glyphId: string; previewUrl: string }
  | { kind: 'legacy' | 'bare'; relativeUrl: string; previewUrl: string };

const activeDocumentFilePath = (): string | null =>
  window.__leafWriterProject?.getActiveFilePath?.() ?? null;

const getStoredDocumentXml = (writer: Writer): string | null =>
  window.__desktopStoredDocumentXml ?? writer.overmindState?.document?.xml ?? null;

export const scanGlyphOccurrences = (writer: Writer): GlyphOccurrence[] => {
  const body = writer.editor?.getBody();
  if (!body) return [];

  const documentFilePath = activeDocumentFilePath();
  const storedXml = getStoredDocumentXml(writer);
  const seen = new Map<string, GlyphOccurrence>();

  for (const el of Array.from(body.querySelectorAll('[_tag="g"][type="glyph"][ref]'))) {
    const refAttr = el.getAttribute('ref') ?? '';
    const glyphId = refAttr.startsWith('#') ? refAttr.slice(1) : refAttr;
    if (!glyphId || !storedXml || seen.has(glyphId)) continue;
    const entry = findGlyphCharDeclEntry(storedXml, glyphId);
    if (!entry) continue;
    const previewUrl = resolveDocumentAssetUrl(entry.svgUrl, documentFilePath);
    seen.set(glyphId, { kind: 'ref', glyphId, previewUrl });
  }

  for (const el of Array.from(
    body.querySelectorAll('[_tag="g"][type="glyph"] > [_tag="graphic"][type="normalized"]'),
  )) {
    const relativeUrl = el.getAttribute('url');
    if (!relativeUrl) continue;
    const previewUrl = resolveDocumentAssetUrl(relativeUrl, documentFilePath);
    const key = `legacy:${previewUrl}`;
    if (seen.has(key)) continue;
    seen.set(key, { kind: 'legacy', relativeUrl, previewUrl });
  }

  for (const el of Array.from(body.querySelectorAll('[_tag="graphic"][type="glyph"]'))) {
    const relativeUrl = el.getAttribute('url');
    if (!relativeUrl) continue;
    const previewUrl = resolveDocumentAssetUrl(relativeUrl, documentFilePath);
    const key = `bare:${previewUrl}`;
    if (seen.has(key)) continue;
    seen.set(key, { kind: 'bare', relativeUrl, previewUrl });
  }

  return Array.from(seen.values());
};

/** Inserts a reused occurrence at the cursor - the same three shapes
 * insertGlyph produces, minus any of the vectorization/file-writing work,
 * since the asset (and, for `ref`, the charDecl registration) already
 * exists. */
export const insertExistingGlyph = (writer: Writer, occurrence: GlyphOccurrence): boolean => {
  const bookmark = writer.editor?.selection.getBookmark(1);
  if (!bookmark) return false;

  if (occurrence.kind === 'ref') {
    const gTag = writer.tagger.addStructureTag({
      action: writer.tagger.ADD,
      tagName: 'g',
      attributes: { type: 'glyph', n: occurrence.glyphId, ref: `#${occurrence.glyphId}` },
      bookmark,
    });
    if (!gTag?.id) return false;
  } else if (occurrence.kind === 'legacy') {
    const gTag = writer.tagger.addStructureTag({
      action: writer.tagger.ADD,
      tagName: 'g',
      attributes: { type: 'glyph', n: generatePastedGlyphId() },
      bookmark,
    });
    if (!gTag?.id) return false;
    writer.tagger.addStructureTag({
      action: writer.tagger.INSIDE,
      tagName: 'graphic',
      attributes: { type: 'normalized', url: occurrence.relativeUrl, mimeType: 'image/svg+xml' },
      bookmark: { tagId: gTag.id },
    });
  } else {
    const graphicTag = writer.tagger.addStructureTag({
      action: writer.tagger.ADD,
      tagName: 'graphic',
      attributes: { type: 'glyph', url: occurrence.relativeUrl, mimeType: 'image/svg+xml' },
      bookmark,
    });
    if (!graphicTag?.id) return false;
  }

  const body = writer.editor?.getBody();
  if (body) {
    writer.tagger.processNewContent(body);
    refreshGraphicsInBody(body, { documentFilePath: activeDocumentFilePath() });
  }
  writer.event('contentChanged').publish();
  return true;
};
