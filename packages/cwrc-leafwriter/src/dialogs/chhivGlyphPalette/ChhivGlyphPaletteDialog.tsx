import { Box, ButtonBase, Tooltip, Typography } from '@mui/material';
import { useEffect, useState } from 'react';
import type Writer from '../../js/Writer';
import { fetchResourceText } from '../../utilities/fetchResource';
import { insertExistingGlyph, type GlyphOccurrence } from '../../utilities/glyphPalette';

interface ThumbnailEntry {
  occurrence: GlyphOccurrence;
  /** null while loading, '' if the SVG file couldn't be read. */
  dataUrl: string | null;
}

const glyphKey = (occurrence: GlyphOccurrence): string =>
  occurrence.kind === 'ref'
    ? `ref:${occurrence.glyphId}`
    : `${occurrence.kind}:${occurrence.previewUrl}`;

/**
 * A palette of every glyph already used somewhere in the current document
 * (see glyphPalette.ts for how they're found and deduped). Clicking a
 * thumbnail inserts it at the cursor immediately and leaves the dialog
 * open, the same interaction as the plain-symbol CHHIV palette - so
 * repeated reuse of the same or different glyphs doesn't need reopening.
 */
export const ChhivGlyphPaletteDialog = ({
  occurrences,
  writer,
}: {
  occurrences: GlyphOccurrence[];
  writer: Writer;
}) => {
  const [entries, setEntries] = useState<ThumbnailEntry[]>(
    occurrences.map((occurrence) => ({ occurrence, dataUrl: null })),
  );

  useEffect(() => {
    let cancelled = false;
    void Promise.all(
      occurrences.map(async (occurrence) => {
        const svgText = await fetchResourceText(occurrence.previewUrl);
        const dataUrl = svgText ? `data:image/svg+xml,${encodeURIComponent(svgText)}` : '';
        return { occurrence, dataUrl };
      }),
    ).then((loaded) => {
      if (!cancelled) setEntries(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [occurrences]);

  if (occurrences.length === 0) {
    return (
      <Typography color="text.secondary" variant="body2">
        No glyphs have been inserted into this document yet.
      </Typography>
    );
  }

  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, maxWidth: 420 }}>
      {entries.map(({ occurrence, dataUrl }) => (
        <Tooltip key={glyphKey(occurrence)} title="Insert here">
          <ButtonBase
            disabled={dataUrl === null}
            onClick={() => insertExistingGlyph(writer, occurrence)}
            sx={{
              width: 40,
              height: 40,
              border: '1px solid',
              borderColor: 'divider',
              borderRadius: 1,
              flexShrink: 0,
            }}
          >
            {dataUrl ? (
              <Box
                sx={{
                  width: '70%',
                  height: '70%',
                  backgroundColor: 'text.primary',
                  WebkitMaskImage: `url("${dataUrl}")`,
                  maskImage: `url("${dataUrl}")`,
                  WebkitMaskSize: 'contain',
                  maskSize: 'contain',
                  WebkitMaskRepeat: 'no-repeat',
                  maskRepeat: 'no-repeat',
                  WebkitMaskPosition: 'center',
                  maskPosition: 'center',
                }}
              />
            ) : (
              <Typography color="text.disabled" variant="caption">
                {dataUrl === null ? '…' : '?'}
              </Typography>
            )}
          </ButtonBase>
        </Tooltip>
      ))}
    </Box>
  );
};

export default ChhivGlyphPaletteDialog;
