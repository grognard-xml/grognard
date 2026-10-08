import {
  Alert,
  Box,
  Button,
  Checkbox,
  Collapse,
  FormControlLabel,
  ListItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface AiApiSettings {
  apiKey: string;
  baseUrl: string;
  customInstructions: string;
  model: string;
  temperature: number;
  streamResults: boolean;
  placeholderRetryLimit: number;
  /** When true, AI curation runs unconditionally — no per-run opt-in checkbox (e.g. Disambiguate). */
  alwaysOn: boolean;
  concurrency: number;
  reasoningEffort: string;
  verifiedAt: string | null;
  verifiedBaseUrl: string;
  verifiedModel: string;
}

interface AiConnectionResult {
  error?: string;
  models?: string[];
  ok: boolean;
}

const DEFAULT_AI_API_SETTINGS: AiApiSettings = {
  apiKey: '',
  baseUrl: 'http://localhost:1234/v1',
  customInstructions: '',
  model: '',
  temperature: 0.1,
  streamResults: true,
  placeholderRetryLimit: 1,
  alwaysOn: false,
  concurrency: 0,
  reasoningEffort: '',
  verifiedAt: null,
  verifiedBaseUrl: '',
  verifiedModel: '',
};

const getCommonsUiBridge = () =>
  (
    window as Window & {
      __ljbCommonsUi?: {
        aiApiSettings: AiApiSettings | null;
        setAiApiSettings: (settings: Partial<AiApiSettings>) => void | Promise<void>;
        testAiConnection: (settings: Partial<AiApiSettings>) => Promise<AiConnectionResult>;
      };
    }
  ).__ljbCommonsUi;

export const DesktopAiApi = () => {
  const { t } = useTranslation();
  const bridge = getCommonsUiBridge();
  const [settings, setSettings] = useState<AiApiSettings>(
    bridge?.aiApiSettings ?? DEFAULT_AI_API_SETTINGS,
  );
  const [status, setStatus] = useState<{
    message: string;
    severity: 'error' | 'info' | 'success';
  } | null>(null);
  const [checking, setChecking] = useState(false);
  const [forgetting, setForgetting] = useState(false);

  useEffect(() => {
    if (!bridge?.aiApiSettings) return;
    setSettings(bridge.aiApiSettings);
  }, [bridge?.aiApiSettings]);

  if (!bridge) return null;

  const updateSetting = <Key extends keyof AiApiSettings>(key: Key, value: AiApiSettings[Key]) => {
    setSettings((current) => ({ ...current, [key]: value }));
    setStatus(null);
  };

  const persistPreference = async (patch: Partial<AiApiSettings>) => {
    setSettings((current) => ({ ...current, ...patch }));
    setStatus(null);
    await bridge.setAiApiSettings(patch);
  };

  const establishConnection = async () => {
    if (!settings.model.trim()) {
      setStatus({ severity: 'error', message: t('LW.settings.ai_api.choose_model_first') });
      return;
    }

    setChecking(true);
    setStatus(null);
    try {
      const result = await bridge.testAiConnection(settings);
      if (!result.ok) {
        setStatus({
          severity: 'error',
          message: result.error ?? t('LW.settings.ai_api.connection_failed'),
        });
        return;
      }

      const verified = {
        ...settings,
        verifiedAt: new Date().toISOString(),
        verifiedBaseUrl: settings.baseUrl.trim(),
        verifiedModel: settings.model.trim(),
      };
      await bridge.setAiApiSettings(verified);
      setSettings(verified);

      const modelCount = result.models?.length ?? 0;
      setStatus({
        severity: 'success',
        message:
          modelCount > 0
            ? t('LW.settings.ai_api.connected_with_models', { count: modelCount })
            : t('LW.settings.ai_api.connected_without_models'),
      });
    } catch (error) {
      setStatus({
        severity: 'error',
        message: error instanceof Error ? error.message : t('LW.settings.ai_api.connection_failed'),
      });
    } finally {
      setChecking(false);
    }
  };

  const forgetSettings = async () => {
    setForgetting(true);
    setStatus(null);
    try {
      await bridge.setAiApiSettings(DEFAULT_AI_API_SETTINGS);
      setSettings(DEFAULT_AI_API_SETTINGS);
      setStatus({ severity: 'info', message: t('LW.settings.ai_api.settings_cleared') });
    } catch (error) {
      setStatus({
        severity: 'error',
        message: error instanceof Error ? error.message : 'Could not forget the AI settings.',
      });
    } finally {
      setForgetting(false);
    }
  };

  const hasSavedConnection =
    Boolean(settings.verifiedAt) &&
    settings.verifiedBaseUrl.trim() === settings.baseUrl.trim() &&
    settings.verifiedModel.trim() === settings.model.trim();

  return (
    <ListItem dense disableGutters sx={{ alignItems: 'flex-start', py: 0.25 }}>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography color="text.secondary" sx={{ mb: 1 }} variant="caption">
          {t('LW.settings.ai_api.description')}
        </Typography>

        <Stack spacing={0.75}>
          <TextField
            fullWidth
            label={t('LW.settings.ai_api.base_url')}
            onChange={(event) => updateSetting('baseUrl', event.target.value)}
            size="small"
            value={settings.baseUrl}
          />
          <FormControlLabel
            control={
              <Checkbox
                checked={settings.streamResults}
                onChange={(event) => updateSetting('streamResults', event.target.checked)}
                size="small"
              />
            }
            label={
              <Typography variant="body2">{t('LW.settings.ai_api.stream_results')}</Typography>
            }
            sx={{ ml: 0 }}
          />
          <TextField
            fullWidth
            label={t('LW.settings.ai_api.api_key')}
            onChange={(event) => updateSetting('apiKey', event.target.value)}
            size="small"
            type="password"
            value={settings.apiKey}
          />
          <TextField
            fullWidth
            label={t('LW.settings.ai_api.model')}
            onChange={(event) => updateSetting('model', event.target.value)}
            size="small"
            value={settings.model}
          />
          <TextField
            fullWidth
            inputProps={{ max: 2, min: 0, step: 0.1 }}
            label={t('LW.settings.ai_api.temperature')}
            onChange={(event) => {
              const next = Number(event.target.value);
              updateSetting('temperature', Number.isFinite(next) ? next : 0.1);
            }}
            size="small"
            type="number"
            value={settings.temperature}
          />
          <TextField
            fullWidth
            helperText={t('LW.settings.ai_api.placeholder_retry_limit_help')}
            inputProps={{ max: 5, min: 0, step: 1 }}
            label={t('LW.settings.ai_api.placeholder_retry_limit')}
            onChange={(event) => {
              const next = Number(event.target.value);
              updateSetting(
                'placeholderRetryLimit',
                Number.isFinite(next) ? Math.min(5, Math.max(0, Math.floor(next))) : 1,
              );
            }}
            size="small"
            type="number"
            value={settings.placeholderRetryLimit ?? 1}
          />
          <TextField
            fullWidth
            helperText={t('LW.settings.ai_api.concurrency_help')}
            inputProps={{ max: 16, min: 0, step: 1 }}
            label={t('LW.settings.ai_api.concurrency')}
            onChange={(event) => {
              const next = Number(event.target.value);
              updateSetting(
                'concurrency',
                Number.isFinite(next) ? Math.min(16, Math.max(0, Math.floor(next))) : 0,
              );
            }}
            size="small"
            type="number"
            value={settings.concurrency ?? 0}
          />
          <TextField
            fullWidth
            helperText={t('LW.settings.ai_api.reasoning_effort_help')}
            label={t('LW.settings.ai_api.reasoning_effort')}
            onChange={(event) => updateSetting('reasoningEffort', event.target.value)}
            placeholder="minimal"
            size="small"
            value={settings.reasoningEffort ?? ''}
          />
          <TextField
            fullWidth
            label={t('LW.settings.ai_api.translation_instructions')}
            minRows={3}
            multiline
            onChange={(event) => updateSetting('customInstructions', event.target.value)}
            placeholder={t('LW.settings.ai_api.translation_instructions_placeholder')}
            size="small"
            value={settings.customInstructions}
          />
          <FormControlLabel
            control={
              <Checkbox
                checked={settings.alwaysOn}
                onChange={(event) => void persistPreference({ alwaysOn: event.target.checked })}
                size="small"
              />
            }
            label={<Typography variant="body2">{t('LW.settings.ai_api.always_on')}</Typography>}
            sx={{ ml: 0 }}
          />
          <Typography color="text.secondary" variant="caption">
            {t('LW.settings.ai_api.always_on_help')}
          </Typography>

          <Collapse in={Boolean(status)}>
            {status ? (
              <Alert severity={status.severity} sx={{ py: 0 }}>
                {status.message}
              </Alert>
            ) : null}
          </Collapse>

          <Stack alignItems="center" direction="row" spacing={1}>
            <Button
              disabled={checking || !settings.model.trim()}
              onClick={() => void establishConnection()}
              size="small"
              variant="contained"
            >
              {checking ? 'Establishing...' : 'Establish connection'}
            </Button>
            <Button
              disabled={
                forgetting ||
                (!settings.apiKey.trim() && !settings.baseUrl.trim() && !settings.model.trim())
              }
              onClick={() => void forgetSettings()}
              size="small"
              variant="outlined"
            >
              {forgetting ? 'Forgetting...' : 'Forget'}
            </Button>
            <Paper
              elevation={0}
              sx={{
                bgcolor: 'action.hover',
                border: '1px solid',
                borderColor: 'divider',
                color: 'text.secondary',
                px: 1.25,
                py: 0.5,
              }}
            >
              <Typography variant="caption">
                {hasSavedConnection ? 'Saved' : 'Not saved'}
              </Typography>
            </Paper>
          </Stack>
        </Stack>
      </Box>
    </ListItem>
  );
};
