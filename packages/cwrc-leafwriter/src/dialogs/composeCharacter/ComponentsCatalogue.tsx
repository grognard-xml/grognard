import {
  Box,
  Button,
  ButtonBase,
  Checkbox,
  Menu,
  MenuItem,
  Tooltip,
  Typography,
} from '@mui/material';
import { useEffect, useMemo, useState, type MouseEvent } from 'react';
import {
  buildComponentSections,
  FIRST_STROKE_LABELS,
  flattenShownComponents,
  type CatalogueFilters,
  type FirstStrokeClass,
} from '../../utilities/composerComponents';
import { findCharactersContaining, parseLookupQuery } from '../../utilities/idsContainingSearch';

interface Props {
  findInput: string;
  onToggleComponent: (component: string) => void;
}

/**
 * Middle-column Components tab: catalogue by stroke count, first-stroke
 * filter, View menu (radical variants / difficult / dim unavailable).
 */
export const ComponentsCatalogue = ({ findInput, onToggleComponent }: Props) => {
  const [showDifficult, setShowDifficult] = useState(false);
  const [showRadicalVariants, setShowRadicalVariants] = useState(true);
  const [dimUnavailable, setDimUnavailable] = useState(true);
  const [firstStrokes, setFirstStrokes] = useState<FirstStrokeClass[]>([]);
  const [viewAnchor, setViewAnchor] = useState<HTMLElement | null>(null);
  const [unavailable, setUnavailable] = useState<Set<string>>(() => new Set());

  const filters: CatalogueFilters = useMemo(
    () => ({ showDifficult, showRadicalVariants, firstStrokes }),
    [showDifficult, showRadicalVariants, firstStrokes],
  );

  const sections = useMemo(() => buildComponentSections(filters), [filters]);
  const shown = useMemo(() => flattenShownComponents(filters), [filters]);

  const selected = useMemo(
    () => new Set(Array.from(findInput).filter((ch) => shown.includes(ch))),
    [findInput, shown],
  );

  useEffect(() => {
    if (!dimUnavailable) {
      setUnavailable(new Set());
      return;
    }
    let cancelled = false;
    // Defer so tab switch stays snappy; index should already be warm.
    const id = window.setTimeout(() => {
      const query = parseLookupQuery(findInput);
      const dimmed = new Set<string>();
      for (const ch of shown) {
        if (selected.has(ch)) continue;
        const found = findCharactersContaining(query.components + ch, query.strokes);
        if (found.length === 0) dimmed.add(ch);
      }
      if (!cancelled) setUnavailable(dimmed);
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [dimUnavailable, findInput, shown, selected]);

  const toggleFirstStroke = (strokeClass: FirstStrokeClass) => {
    setFirstStrokes((prev) =>
      prev.includes(strokeClass)
        ? prev.filter((c) => c !== strokeClass)
        : [...prev, strokeClass].sort((a, b) => a - b),
    );
  };

  const openView = (event: MouseEvent<HTMLElement>) => setViewAnchor(event.currentTarget);
  const closeView = () => setViewAnchor(null);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, minHeight: 0, flex: 1 }}>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, alignItems: 'center' }}>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ letterSpacing: 0.6, mr: 0.5, textTransform: 'uppercase' }}
        >
          First stroke
        </Typography>
        {FIRST_STROKE_LABELS.map(({ class: strokeClass, glyph, tip }) => {
          const active = firstStrokes.includes(strokeClass);
          return (
            <Tooltip key={strokeClass} title={`First stroke: ${tip}`}>
              <ButtonBase
                aria-label={`First stroke: ${tip}`}
                aria-pressed={active}
                onClick={() => toggleFirstStroke(strokeClass)}
                sx={{
                  width: 28,
                  height: 28,
                  border: '1px solid',
                  borderColor: active ? 'primary.main' : 'divider',
                  bgcolor: active ? 'action.selected' : 'transparent',
                  borderRadius: 0.5,
                  fontFamily: 'serif',
                  fontSize: 16,
                }}
              >
                {glyph}
              </ButtonBase>
            </Tooltip>
          );
        })}
        <Box sx={{ flex: 1 }} />
        <Button size="small" onClick={openView}>
          View ▾
        </Button>
        <Menu anchorEl={viewAnchor} open={Boolean(viewAnchor)} onClose={closeView}>
          <MenuItem
            onClick={() => {
              setShowRadicalVariants((v) => !v);
              closeView();
            }}
          >
            <Checkbox size="small" checked={showRadicalVariants} sx={{ p: 0, mr: 1 }} />
            Radical variants
          </MenuItem>
          <MenuItem
            onClick={() => {
              setShowDifficult((v) => !v);
              closeView();
            }}
          >
            <Checkbox size="small" checked={showDifficult} sx={{ p: 0, mr: 1 }} />
            Difficult components
          </MenuItem>
          <MenuItem
            onClick={() => {
              setDimUnavailable((v) => !v);
              closeView();
            }}
          >
            <Checkbox size="small" checked={dimUnavailable} sx={{ p: 0, mr: 1 }} />
            Dim unavailable
          </MenuItem>
        </Menu>
      </Box>

      <Box sx={{ overflow: 'auto', flex: 1, minHeight: 180, maxHeight: 360 }}>
        {sections.map((section) => (
          <Box key={section.strokes} sx={{ mb: 1 }}>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: 'block', mb: 0.25 }}
            >
              {section.strokes} stroke{section.strokes === 1 ? '' : 's'}
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.25 }}>
              {section.components.map((ch) => {
                const isSelected = selected.has(ch);
                const isDimmed = dimUnavailable && unavailable.has(ch) && !isSelected;
                return (
                  <Tooltip key={ch} title={isDimmed ? `${ch} (no matches)` : ch}>
                    <ButtonBase
                      aria-label={`Toggle component ${ch}`}
                      aria-pressed={isSelected}
                      disabled={isDimmed}
                      onClick={() => onToggleComponent(ch)}
                      sx={{
                        width: 28,
                        height: 28,
                        borderRadius: 0.5,
                        border: '1px solid',
                        borderColor: isSelected ? 'primary.main' : 'transparent',
                        bgcolor: isSelected ? 'action.selected' : 'transparent',
                        opacity: isDimmed ? 0.35 : 1,
                        fontFamily: 'serif',
                        fontSize: 18,
                        lineHeight: 1,
                      }}
                    >
                      {ch}
                    </ButtonBase>
                  </Tooltip>
                );
              })}
            </Box>
          </Box>
        ))}
        {sections.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            No components match these filters.
          </Typography>
        )}
      </Box>
    </Box>
  );
};

export default ComponentsCatalogue;
