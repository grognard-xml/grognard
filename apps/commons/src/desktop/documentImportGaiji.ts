import {
  applyGaijiGlyphsToXml,
  createGlyphAssetsFromBytes,
  gaijiMarker,
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

const KANRIPO_GAIJI_PATTERN =
  /<g type="kanripo" n="(KR\d{4})"><graphic url="_gaiji\/\1\.png" height="1em"\/><\/g>/g;

/**
 * Kanripo's converter leaves each unresolved &KRnnnn; as a bare PNG
 * `<g type="kanripo"><graphic/></g>` copied into `_gaiji/`. Run those PNGs
 * through the same vectorize -> `_glyphs/` -> `<g ref>`/`<charDecl>` path as
 * pasted and .docx images, so they are sized and aligned like any other
 * glyph. A gaiji whose PNG can't be read or converted keeps its PNG form.
 */
export const convertKanripoGaiji = async ({
  api,
  readBytes,
  gaijiDir,
  mode,
  outputPath,
  xml,
}: {
  api: GlyphAssetApi | undefined;
  readBytes: ((filePath: string) => Promise<Uint8Array>) | undefined;
  gaijiDir: string;
  mode: 'charDecl' | 'graphic';
  outputPath: string;
  xml: string;
}): Promise<{ xml: string; converted: number; failed: number }> => {
  const ids = [...new Set(Array.from(xml.matchAll(KANRIPO_GAIJI_PATTERN), (match) => match[1]))];
  if (ids.length === 0 || !readBytes) return { xml, converted: 0, failed: ids.length };

  const specs = await Promise.all(
    ids.map(async (id) => {
      try {
        const bytes = await readBytes(`${gaijiDir.replace(/[\\/]+$/, '')}/${id}.png`);
        if (bytes.length === 0) return null;
        return await createGlyphAssetsFromBytes({ api, bytes, documentPath: outputPath });
      } catch (error) {
        console.warn(`[kanripo-import] could not convert ${id}`, error);
        return null;
      }
    }),
  );

  const marked = xml.replace(KANRIPO_GAIJI_PATTERN, (whole, id: string) => {
    const index = ids.indexOf(id);
    return specs[index] ? gaijiMarker(index) : whole;
  });
  const failed = specs.filter((spec) => !spec).length;
  return {
    xml: applyGaijiGlyphsToXml(marked, specs, mode),
    converted: specs.length - failed,
    failed,
  };
};
