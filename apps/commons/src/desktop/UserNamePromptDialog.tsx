import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ensureEntityDbFolder } from './entityDbOnboarding';

/** Same localStorage key as Leaf-Writer Guardrails → `setEnableXmlEditing`. */
const ENABLE_XML_EDITING_KEY = 'enableXmlEditing';

/** Full dialog width; height follows the image aspect ratio so nothing is cropped. */
const SplashImage = () => (
  <Box
    component="img"
    alt=""
    src="/assets/splash/splash_new.png"
    sx={{
      display: 'block',
      width: '100%',
      height: 'auto',
    }}
  />
);

const getCommonsUiBridge = () =>
  (
    window as Window & {
      __ljbCommonsUi?: {
        encoderName: string;
        encoderNameLoaded: boolean;
        setEncoderName: (name: string) => void | Promise<void>;
      };
    }
  ).__ljbCommonsUi;

/** Prefer the live editor preference; fall back to localStorage (default on). */
const readEnableXmlEditing = (): boolean => {
  const fromWriter = window.writer?.overmindState?.editor?.enableXmlEditing;
  if (typeof fromWriter === 'boolean') return fromWriter;
  try {
    const raw = localStorage.getItem(ENABLE_XML_EDITING_KEY);
    if (raw === null) return true;
    return JSON.parse(raw) as boolean;
  } catch {
    return true;
  }
};

/**
 * Persist via the editor action when ready; otherwise write localStorage so
 * editor init picks the choice up, and notify the desktop shell.
 */
const writeEnableXmlEditing = (value: boolean) => {
  const set = window.writer?.overmindActions?.editor?.setEnableXmlEditing as
    ((next: boolean) => void) | undefined;
  if (set) {
    set(value);
    return;
  }
  localStorage.setItem(ENABLE_XML_EDITING_KEY, JSON.stringify(value));
  window.dispatchEvent(
    new CustomEvent('leafwriter:enable-xml-editing-change', { detail: { value } }),
  );
};

/**
 * First-run gate: tagging name only. The entity database always lives in a
 * default folder deep in app data — never user-chosen, so it can never end
 * up in a cloud-synced folder (Dropbox, iCloud, OneDrive, …), where a
 * sync client racing SQLite's journal files can corrupt it.
 */
export const UserNamePromptDialog = () => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [enableXmlEditing, setEnableXmlEditing] = useState(readEnableXmlEditing);

  useEffect(() => {
    const checkOpen = () => {
      const bridge = getCommonsUiBridge();
      // Rule: no user name → splash. Wait until prefs have loaded so we do not
      // flash the dialog before a saved name is read from disk.
      if (!bridge?.encoderNameLoaded) return;
      setOpen(!bridge.encoderName.trim());
    };
    checkOpen();
    window.addEventListener('grognardCommonsUiChanged', checkOpen);
    return () => window.removeEventListener('grognardCommonsUiChanged', checkOpen);
  }, []);

  useEffect(() => {
    if (!open) return;
    setEnableXmlEditing(readEnableXmlEditing());
    // Make sure the default folder actually contains a database, so
    // finishing leaves tagging ready to use.
    void ensureEntityDbFolder();
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ value: boolean }>).detail;
      setEnableXmlEditing(detail.value);
    };
    window.addEventListener('leafwriter:enable-xml-editing-change', handler);
    return () => window.removeEventListener('leafwriter:enable-xml-editing-change', handler);
  }, [open]);

  const handleEnableXmlEditingChange = (checked: boolean) => {
    setEnableXmlEditing(checked);
    writeEnableXmlEditing(checked);
  };

  const canFinish = Boolean(name.trim());

  const finish = () => {
    if (!canFinish) return;
    // Re-apply in case the editor became ready after the user toggled.
    writeEnableXmlEditing(enableXmlEditing);
    void ensureEntityDbFolder();
    void getCommonsUiBridge()?.setEncoderName(name.trim());
    setOpen(false);
  };

  return (
    <Dialog disableEscapeKeyDown fullWidth maxWidth="xs" open={open}>
      <SplashImage />
      <DialogTitle>{t('LWC.desktop.user_name_prompt.title')}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 0.5 }}>
          <Stack spacing={1}>
            <Typography variant="body2">{t('LWC.desktop.user_name_prompt.message')}</Typography>
            <TextField
              autoFocus
              fullWidth
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && canFinish) finish();
              }}
              placeholder={t('LWC.desktop.user_name_prompt.placeholder')}
              size="small"
              value={name}
            />
          </Stack>

          <FormControlLabel
            control={
              <Switch
                checked={enableXmlEditing}
                onChange={(event) => handleEnableXmlEditingChange(event.target.checked)}
                size="small"
              />
            }
            label={
              <Typography variant="body2">
                {t('LWC.desktop.user_name_prompt.enable_xml_editing')}
              </Typography>
            }
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button disabled={!canFinish} onClick={finish} variant="contained">
          {t('LWC.desktop.user_name_prompt.save')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
