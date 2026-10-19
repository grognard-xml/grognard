import { createTheme } from '@mui/material/styles';
import type {} from '@mui/material/themeCssVarsAugmentation';

export const theme = createTheme({
  cssVariables: {
    colorSchemeSelector: 'class',
    nativeColor: true,
  },
  colorSchemes: {
    light: {
      palette: {
        primary: { main: 'rgb(28, 64, 69)' },
        secondary: { main: 'rgb(255, 114, 0)' },
      },
    },
    dark: {
      palette: {
        primary: { main: 'rgb(191, 213, 213)' },
        secondary: { main: 'rgb(255, 114, 0)' },
      },
    },
  },
  typography: {
    fontFamily: "'Grognard Han', Lato, Helvetica, Arial, sans-serif",
    fontSize: 12,
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: `
        @font-face {
          font-family: 'Lato';
          font-style: normal;
          font-display: swap;s
          font-weight: 300;
          src: "local('Lato'), local('Lato-Regular')";
          unicodeRange: 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+2000-206F, U+2074, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF',
        }
      `,
    },
    MuiButton: { defaultProps: { size: 'small' } },
    MuiIconButton: { defaultProps: { size: 'small' } },
    MuiInputBase: { defaultProps: { size: 'small' } },
    MuiTextField: { defaultProps: { size: 'small' } },
    MuiSelect: { defaultProps: { size: 'small' } },
    MuiToolbar: { defaultProps: { variant: 'dense' } },
  },
  spacing: 6,
});
