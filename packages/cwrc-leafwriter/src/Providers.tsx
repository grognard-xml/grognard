import { CssBaseline, ThemeProvider, useMediaQuery } from '@mui/material';
import { useColorScheme } from '@mui/material/styles';
import ModalProvider from 'mui-modal-provider';
import { SnackbarProvider } from 'notistack';
import { useEffect, useLayoutEffect } from 'react';
import App from './App';
import { useActions, useAppState } from './overmind';
import theme from './theme';
import type { LeafWriterOptions } from './types';

/**
 * Drive MUI's CSS-variable scheme from Overmind `darkMode` only.
 * Nested ThemeProviders must not fall back to OS `system` mode.
 */
const SyncColorScheme = ({ darkMode }: { darkMode: boolean }) => {
  const { setMode } = useColorScheme();
  useLayoutEffect(() => {
    setMode(darkMode ? 'dark' : 'light');
  }, [darkMode, setMode]);
  return null;
};

const Providers = (props: LeafWriterOptions) => {
  const { setDarkMode } = useActions().ui;
  const { darkMode, themeAppearance } = useAppState().ui;

  const preferDark = useMediaQuery('(prefers-color-scheme: dark)');

  useEffect(() => {
    if (themeAppearance === 'system') {
      setDarkMode(preferDark);
      window.dispatchEvent(new Event('changeTheme'));
    }
  }, [preferDark, setDarkMode, themeAppearance]);

  return (
    <ThemeProvider theme={theme} defaultMode={darkMode ? 'dark' : 'light'} storageManager={null}>
      <SyncColorScheme darkMode={darkMode} />
      <CssBaseline enableColorScheme />
      <ModalProvider>
        <SnackbarProvider autoHideDuration={5000} disableWindowBlurListener>
          <App {...props} />
        </SnackbarProvider>
      </ModalProvider>
    </ThemeProvider>
  );
};

export default Providers;
