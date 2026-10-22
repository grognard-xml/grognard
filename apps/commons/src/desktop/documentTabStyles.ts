import type { SxProps, Theme } from '@mui/material/styles';

/**
 * The open document's tab must be impossible to miss among many. It is filled with the theme's
 * primary colour with the matching contrast text, the same dark teal as the Database Window button
 * in light mode and a light teal in dark mode, against flat, dimmer tabs. It has a small corner
 * radius, not the button's pill shape, so it still reads as a tab. The weight does not change, so
 * selecting a tab never shifts the ones after it.
 */
export const documentTabSx: SxProps<Theme> = {
  minHeight: 28,
  textTransform: 'none',
  color: 'text.secondary',
  borderRadius: 1.5,
  '&:hover': { color: 'text.primary', bgcolor: 'action.hover' },
  '&.Mui-selected': {
    color: 'primary.contrastText',
    bgcolor: 'primary.main',
  },
  '&.Mui-selected:hover': { bgcolor: 'primary.main' },
};

/** The filled tab replaces MUI's underline indicator. */
export const documentTabIndicatorSx: SxProps<Theme> = { display: 'none' };
