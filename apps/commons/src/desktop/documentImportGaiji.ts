import {
  applyGaijiGlyphsToXml,
  createGlyphAssetsFromBytes,
  glyphIdForImageBytes,
  type GlyphAssetApi,
} from '@cwrc/leafwriter/gaijiImport';

/**
 * Inline images (usually gaiji set as pictures) in an imported .docx - see
 * extractDocxTextWithImages in apps/desktop/src/pastedImages.ts, which
 * leaves a marker in the text at each one.
 */
export interface DocxTextWithImages {
  text: string;
  images: { contentType: string; bytes: Uint8Array }[];
  warnings: string[];
}

/** Orlando has no glyph mechanism at all; TEI Lite only the inline `<graphic>` one. */
export const gaijiModeForCatalog = (
  catalogId: string | undefined,
): 'charDecl' | 'graphic' | null => {
  if (catalogId === 'orlando') return null;
  if (catalogId === 'teiLite') return 'graphic';
  return 'charDecl';
};

/**
 * Replaces the markers in a freshly built import document with glyphs whose
 * assets are written next to `outputPath` - the same `_glyphs/` layout and
 * `<g ref>`/`<charDecl>` shape the editor produces when an image is pasted,
 * so imported gaiji behave exactly like pasted ones. Identical images share
 * one glyph; an image that can't be converted becomes 〓.
 */
export const convertImportedGaiji = async ({
  api,
  images,
  mode,
  outputPath,
  xml,
}: {
  api: GlyphAssetApi | undefined;
  images: DocxTextWithImages['images'];
  mode: 'charDecl' | 'graphic';
  outputPath: string;
  xml: string;
}): Promise<{ xml: string; converted: number; failed: number }> => {
  const byGlyphId = new Map<string, ReturnType<typeof createGlyphAssetsFromBytes>>();
  const specs = await Promise.all(
    images.map(async ({ bytes }) => {
      if (bytes.length === 0) return null;
      const glyphId = await glyphIdForImageBytes(bytes);
      if (!byGlyphId.has(glyphId)) {
        byGlyphId.set(
          glyphId,
          createGlyphAssetsFromBytes({ api, bytes, documentPath: outputPath }).catch((error) => {
            console.warn('[document-import] could not convert image', error);
            return null;
          }),
        );
      }
      return byGlyphId.get(glyphId)!;
    }),
  );

  const failed = specs.filter((spec) => !spec).length;
  return {
    xml: applyGaijiGlyphsToXml(xml, specs, mode),
    converted: specs.length - failed,
    failed,
  };
};
