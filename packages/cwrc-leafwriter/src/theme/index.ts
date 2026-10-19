import { createTheme } from '@mui/material';
import { SimplePaletteColorOptions } from '@mui/material/styles';
import type {} from '@mui/material/themeCssVarsAugmentation';
import { IconLeafWriter } from '../icons';

interface Entity {
  color: SimplePaletteColorOptions;
  icon: IconLeafWriter;
}

interface Entities {
  person: Entity;
  place: Entity;
  organization: Entity;
  org: Entity;
  office: Entity;
  work: Entity;
  thing: Entity;
  citation: Entity;
  note: Entity;
  date: Entity;
  correction: Entity;
  keyword: Entity;
  link: Entity;
  concept: Entity;
}

declare module '@mui/material/styles' {
  interface Theme {
    entity: Entities;
  }

  interface ThemeOptions {
    entity?: Entities;
  }
}

const theme = createTheme({
  cssVariables: {
    colorSchemeSelector: 'class',
    nativeColor: true,
  },
  entity: {
    person: {
      color: { main: 'rgb(46, 134, 222)' },
      icon: 'person',
    },
    place: {
      color: { main: 'rgb(255, 159, 67)' },
      icon: 'place',
    },
    organization: {
      color: { main: 'rgb(176, 185, 122)' },
      icon: 'organization',
    },
    org: {
      color: { main: 'rgb(176, 185, 122)' },
      icon: 'organization',
    },
    office: {
      color: { main: 'rgb(142, 92, 48)' },
      icon: 'office',
    },
    work: {
      color: { main: 'rgb(175, 70, 240)' },
      icon: 'work',
    },
    concept: {
      color: { main: 'rgb(70, 101, 240)' },
      icon: 'concept',
    },
    thing: {
      color: { main: 'rgb(131, 149, 167)' },
      icon: 'thing',
    },
    citation: {
      color: { main: 'rgb(0, 128, 64)' },
      icon: 'citation',
    },
    note: {
      color: { main: 'rgb(224, 190, 0)' },
      icon: 'note',
    },
    date: {
      color: { main: 'rgb(253, 119, 170)' },
      icon: 'date',
    },
    correction: {
      color: { main: 'rgb(191, 4, 4)' },
      icon: 'correction',
    },
    keyword: {
      color: { main: 'rgb(16, 172, 132)' },
      icon: 'keyword',
    },
    link: {
      color: { main: 'rgb(70, 130, 180)' },
      icon: 'link',
    },
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
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: `
          @font-face {
            font-family: 'Lato';
            font-style: normal;
            font-display: swap;
            font-weight: 300;
            src: "local('Lato'), local('Lato-Regular')";
            unicodeRange: 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+2000-206F, U+2074, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF',
          }
        `,
    },
  },
});

export default theme;
