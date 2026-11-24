import { Button } from '@mui/material';
import type { DialogBarProps } from '@src/dialogs';
import { localesSchema, type Locales } from '@src/i18n';
import type { NotificationProps, PaletteMode } from '@src/types';
import i18next from 'i18next';
import { nanoid } from 'nanoid';
import type { OptionsObject, VariantType } from 'notistack';
import { Context } from '../index';

const SNACKBAR_AUTO_HIDE_MS: Partial<Record<VariantType, number>> = {
  success: 4000,
  info: 5000,
  warning: 7000,
  error: 8000,
  default: 5000,
};

const mergeSnackbarOptions = (options: OptionsObject = {}): OptionsObject => {
  const variant = (options.variant ?? 'default') as VariantType;
  const autoHideDuration =
    options.autoHideDuration ?? SNACKBAR_AUTO_HIDE_MS[variant] ?? SNACKBAR_AUTO_HIDE_MS.default;

  const merged: OptionsObject = {
    persist: false,
    autoHideDuration,
    ...options,
  };

  if (merged.persist) {
    delete merged.autoHideDuration;
  }

  return merged;
};

// * The following line is need for VSC extension i18n ally to work
// useTranslation()
const { t } = i18next;

const DESKTOP_WINDOW_MODE_STORAGE_KEY = 'desktopWindowMode';

//* INITIALIZE
/**
 * Run during initialization
 * It sets the theme appearance and language based on the user's preferences
 */
export const onInitializeOvermind = async (
  { state, actions, effects }: Context,
  _overmind: unknown,
) => {
  //DARK MODE
  const prefPaletteMode =
    effects.storage.api.getFromLocalStorage<PaletteMode>('themeAppearance') ?? 'system';

  actions.ui.setThemeAppearance(prefPaletteMode);

  //LANGUAGE
  const prefLocale = effects.storage.api.getFromLocalStorage<string>('i18nextLng');
  if (prefLocale) {
    state.ui.currentLocale = localesSchema.safeParse(prefLocale).success
      ? (prefLocale as Locales)
      : 'en';
  }

  state.ui.skipExplorerDeleteConfirm =
    effects.storage.api.getFromLocalStorage<boolean>('skipExplorerDeleteConfirm') ?? false;
  state.ui.skipEntityDetachConfirm =
    effects.storage.api.getFromLocalStorage<boolean>('skipEntityDetachConfirm') ?? false;

  const storedDesktopWindowMode = effects.storage.api.getFromLocalStorage<string>(
    DESKTOP_WINDOW_MODE_STORAGE_KEY,
  );
  if (storedDesktopWindowMode === 'editor' || storedDesktopWindowMode === 'database') {
    state.ui.desktopWindowMode = storedDesktopWindowMode;
  }
};

/**
 * Set the current page view
 */
export const setPage = async ({ state }: Context, value: string) => {
  state.ui.page = value;
};

/** Switch between the document editor and the full-width Database Window. */
export const setDesktopWindowMode = ({ state, effects }: Context, value: 'editor' | 'database') => {
  state.ui.desktopWindowMode = value;
  effects.storage.api.saveToLocalStorage(DESKTOP_WINDOW_MODE_STORAGE_KEY, value);
};

/**
 * Gets Google Analitics ID from the our local sercer API
 */
export const getGAID = async ({ effects }: Context) => {
  const response = await effects.ui.api.getGAID();
  return response;
};

export const setCookieConsent = ({ state }: Context, values?: string[]) => {
  state.ui.cookieConsent = values ?? [];
};

export const setThemeAppearance = ({ state, actions, effects }: Context, value: PaletteMode) => {
  state.ui.themeAppearance = value;

  effects.storage.api.saveToLocalStorage('themeAppearance', value);

  // Drop any stale MUI-persisted mode from earlier builds.
  try {
    window.localStorage.removeItem('mui-mode');
  } catch {
    // ignore
  }

  const applyResolvedDarkMode = (darkMode: boolean) => {
    actions.ui.setDarkMode(darkMode);
    setTimeout(() => window.dispatchEvent(new Event('changeTheme')), 0);
  };

  // Align Chromium prefers-color-scheme with the app preference so leftover
  // @media (prefers-color-scheme) CSS and OS listeners cannot flash the chrome.
  const electronAPI = window.electronAPI;
  if (electronAPI?.setNativeThemeSource) {
    void electronAPI.setNativeThemeSource(value).then(async () => {
      if (value === 'system') {
        const osDark = await electronAPI.getShouldUseDarkColors?.();
        applyResolvedDarkMode(osDark ?? window.matchMedia('(prefers-color-scheme: dark)').matches);
        return;
      }
      applyResolvedDarkMode(value === 'dark');
    });
    // Optimistic update for light/dark so the UI reacts immediately.
    if (value !== 'system') applyResolvedDarkMode(value === 'dark');
    return;
  }

  applyResolvedDarkMode(
    value === 'system'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
      : value === 'dark',
  );
};

export const setSkipExplorerDeleteConfirm = ({ state, effects }: Context, value: boolean) => {
  state.ui.skipExplorerDeleteConfirm = value;
  effects.storage.api.saveToLocalStorage('skipExplorerDeleteConfirm', value);
};

export const setSkipEntityDetachConfirm = ({ state, effects }: Context, value: boolean) => {
  state.ui.skipEntityDetachConfirm = value;
  effects.storage.api.saveToLocalStorage('skipEntityDetachConfirm', value);
};

export const setDarkMode = ({ state }: Context, value: boolean) => {
  state.ui.darkMode = value;

  //Cookies consent form
  if (value && !document.body.classList.contains('c_darkmode')) {
    document.body.classList.add('c_darkmode');
  }

  if (!value && document.body.classList.contains('c_darkmode')) {
    document.body.classList.remove('c_darkmode');
  }

  return state.ui.darkMode;
};

/**
 * Switch language to the value provided. If value is not valid, it fallsback to `en-CA`.
 * @param {string} locale - The value of the language code that was selected.
 * @returns The value of the language code.
 */
export const switchLanguage = ({ state, effects }: Context, locale: string) => {
  const localeSupported = localesSchema.safeParse(locale).success ? (locale as Locales) : 'en';

  i18next.changeLanguage(localeSupported);
  state.ui.currentLocale = localeSupported;
  effects.storage.api.saveToLocalStorage('i18nextLng', localeSupported);

  // Propagate the changes to other modules that might be listening in the page
  setTimeout(() => window.dispatchEvent(new Event('changeLanguage')), 0);

  return locale;
};

// * Notification

export const notifyViaSnackbar = ({ state }: Context, notification: NotificationProps | string) => {
  if (typeof notification === 'string') notification = { message: notification };

  let key = notification.options && notification.options.key;
  if (!key) key = new Date().getTime() + Math.random();

  state.ui.notifications = [
    ...state.ui.notifications,
    {
      ...notification,
      key,
      options: mergeSnackbarOptions(notification.options),
    },
  ];
};

export const closeNotificationSnackbar = ({ state }: Context, key?: string | number) => {
  const dismissAll = !key;
  state.ui.notifications = state.ui.notifications.map((notification) =>
    dismissAll || notification.key === key
      ? { ...notification, dismissed: true }
      : { ...notification },
  );
};

export const removeNotificationSnackbar = ({ state }: Context, key: string | number) => {
  state.ui.notifications = state.ui.notifications.filter(
    (notification) => notification.key !== key,
  );
};

/**
 * Convenient method to trigger snackbar notifications
 * It takes a message and a variant (error, warning, info, success) and emits a notification via the snackbar
 * @param  - `message` - The message to display in the snackbar.
 * @param  - Optional - `persists` - If notiicattion should persists until the users dismiss it. (Default: true)
 * @param  - Optional - `variant` - Type of of notification: error, warning, info, success. (Default: 'error')
 */
export const emitNotification = async (
  { actions }: Context,
  {
    message,
    persist = true,
    variant = 'error',
  }: { message: string; persist?: boolean; variant?: VariantType },
) => {
  actions.ui.notifyViaSnackbar({
    message,
    options: {
      action: (key) => (
        <Button color="inherit" onPointerDown={() => actions.ui.closeNotificationSnackbar(key)}>
          {`${t('LWC.commons.dismiss')}`}
        </Button>
      ),
      persist,
      variant,
    },
  });
};

// * Dialog

export const openDialog = ({ state }: Context, dialogBar: DialogBarProps) => {
  if (!dialogBar.props?.id) dialogBar.props = { ...dialogBar.props, id: nanoid() };
  if (!dialogBar.type) dialogBar.type = 'simple';
  state.ui.dialogBar = [...state.ui.dialogBar, dialogBar];
};

export const closeDialog = ({ state }: Context, id: string) => {
  state.ui.dialogBar = [
    ...state.ui.dialogBar.map((dialogBar) => {
      if (dialogBar.props?.id === id) dialogBar.dismissed = true;
      return dialogBar;
    }),
  ];
};

export const closeForegroundPopup = ({ state, actions }: Context): boolean => {
  const openDialogs = state.ui.dialogBar.filter((dialog) => !dialog.dismissed && dialog.props?.id);
  if (openDialogs.length === 0) return false;

  const top = openDialogs[openDialogs.length - 1];
  actions.ui.closeDialog(top.props!.id!);
  top.props?.onClose?.('escapeKeyDown');
  return true;
};

export const removeDialog = ({ state }: Context, id: string) => {
  state.ui.dialogBar = state.ui.dialogBar.filter((dialogBar) => dialogBar.props?.id !== id);
};

export const setDialogDisplayId = (
  { state }: Context,
  { id, displayId }: { id: string; displayId: string },
) => {
  state.ui.dialogBar = [
    ...state.ui.dialogBar.map((dialogBar) => {
      if (dialogBar.props?.id === id) dialogBar.displayId = displayId;
      return dialogBar;
    }),
  ];
};
