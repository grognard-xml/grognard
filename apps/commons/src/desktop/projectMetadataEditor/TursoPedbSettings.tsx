import {
  Box,
  Button,
  FormControlLabel,
  Radio,
  RadioGroup,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

type PedbBackend = 'local' | 'turso';

/**
 * Project-level "which database backend" switch — local `entities.sqlite`
 * (default, single-user) or a shared Turso database (genuine concurrent
 * multi-collaborator edits, no local file). Self-contained, like
 * `desktop-entity-database.tsx`'s central-folder controls: it reads/writes
 * the project file directly rather than folding into `ProjectMetadataForm`'s
 * TEI-header save/dirty-tracking flow, which is a different concern.
 *
 * The backend a project uses is resolved once, when the project is opened
 * (`entityStoreResolve.ts`) — a change made here only takes effect the next
 * time this project is opened, which the saved-state message says plainly
 * rather than pretending to hot-swap the live connection.
 */
export const TursoPedbSettings = ({ active = true }: { active?: boolean }) => {
  const { t } = useTranslation();
  const [projectFilePath, setProjectFilePath] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [backend, setBackend] = useState<PedbBackend>('local');
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [hasStoredToken, setHasStoredToken] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [migrating, setMigrating] = useState(false);
  const [migrateResult, setMigrateResult] = useState<{
    ok: boolean;
    tables?: number;
    rows?: number;
    error?: string;
  } | null>(null);

  useEffect(() => {
    if (!active) return;
    const path = window.__leafWriterProject?.getProjectFilePath?.() ?? null;
    setProjectFilePath(path);
    if (!path || !window.electronAPI?.reloadProjectBundle) {
      setLoading(false);
      return;
    }
    setLoading(true);
    void (async () => {
      const bundle = await window.electronAPI!.reloadProjectBundle(path);
      const pedb = bundle?.config.pedb;
      if (pedb?.backend === 'turso') {
        setBackend('turso');
        setUrl(pedb.url);
        setHasStoredToken((await window.electronAPI?.entityDbTursoHasToken?.(pedb.url)) ?? false);
      } else {
        setBackend('local');
        setUrl('');
        setHasStoredToken(false);
      }
      setToken('');
      setTestResult(null);
      setSaveError(null);
      setSaveSuccess(false);
      setLoading(false);
    })();
  }, [active]);

  const handleBackendChange = (next: PedbBackend) => {
    setBackend(next);
    setTestResult(null);
    setSaveError(null);
    setSaveSuccess(false);
    setMigrateResult(null);
  };

  const handleTest = async () => {
    if (!url.trim() || !token.trim() || !window.electronAPI?.entityDbTursoTestConnection) return;
    setTesting(true);
    setTestResult(null);
    try {
      setTestResult(await window.electronAPI.entityDbTursoTestConnection(url.trim(), token.trim()));
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    if (!projectFilePath || !window.electronAPI?.updateProjectFileConfig) return;
    setSaveError(null);
    setSaveSuccess(false);

    if (backend === 'local') {
      setSaving(true);
      try {
        await window.electronAPI.updateProjectFileConfig(projectFilePath, {
          pedb: { backend: 'local' },
        });
        setSaveSuccess(true);
      } catch (error) {
        setSaveError(error instanceof Error ? error.message : String(error));
      } finally {
        setSaving(false);
      }
      return;
    }

    const trimmedUrl = url.trim();
    if (!trimmedUrl) {
      setSaveError(t('LWC.desktop.project.shared_database_url_required'));
      return;
    }
    const trimmedToken = token.trim();
    if (!trimmedToken && !hasStoredToken) {
      setSaveError(t('LWC.desktop.project.shared_database_token_required'));
      return;
    }

    setSaving(true);
    try {
      if (trimmedToken) {
        await window.electronAPI.entityDbTursoSetToken?.(trimmedUrl, trimmedToken);
      }
      await window.electronAPI.updateProjectFileConfig(projectFilePath, {
        pedb: { backend: 'turso', url: trimmedUrl },
      });
      setHasStoredToken((await window.electronAPI.entityDbTursoHasToken?.(trimmedUrl)) ?? false);
      setToken('');
      setSaveSuccess(true);
      setMigrateResult(null);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  const handleMigrate = async () => {
    if (!projectFilePath || !window.electronAPI?.entityDbTursoMigrateLocalData) return;
    setMigrating(true);
    setMigrateResult(null);
    try {
      setMigrateResult(await window.electronAPI.entityDbTursoMigrateLocalData(projectFilePath));
    } finally {
      setMigrating(false);
    }
  };

  if (loading || !projectFilePath) return null;

  return (
    <Box sx={{ pt: 1 }}>
      <Typography sx={{ pb: 0.5 }} variant="subtitle2">
        {t('LWC.desktop.project.shared_database')}
      </Typography>
      <Typography color="text.secondary" sx={{ pb: 1 }} variant="body2">
        {t('LWC.desktop.project.shared_database_hint')}
      </Typography>

      <RadioGroup
        row
        value={backend}
        onChange={(event) => handleBackendChange(event.target.value as PedbBackend)}
      >
        <FormControlLabel
          control={<Radio />}
          label={t('LWC.desktop.project.shared_database_local')}
          value="local"
        />
        <FormControlLabel
          control={<Radio />}
          label={t('LWC.desktop.project.shared_database_turso')}
          value="turso"
        />
      </RadioGroup>

      {backend === 'turso' && (
        <Stack spacing={1} sx={{ pt: 0.5, maxWidth: 480 }}>
          <TextField
            fullWidth
            label={t('LWC.desktop.project.shared_database_url')}
            onChange={(event) => {
              setUrl(event.target.value);
              setTestResult(null);
            }}
            placeholder={t('LWC.desktop.project.shared_database_url_placeholder')}
            size="small"
            value={url}
          />
          <TextField
            fullWidth
            label={t('LWC.desktop.project.shared_database_token')}
            onChange={(event) => {
              setToken(event.target.value);
              setTestResult(null);
            }}
            placeholder={t('LWC.desktop.project.shared_database_token_placeholder')}
            size="small"
            type="password"
            value={token}
          />
          {hasStoredToken && !token && (
            <Typography color="text.secondary" variant="caption">
              {t('LWC.desktop.project.shared_database_token_stored')}
            </Typography>
          )}
          <Typography color="text.secondary" variant="caption">
            {t('LWC.desktop.project.shared_database_token_hint')}
          </Typography>

          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center', pt: 0.5 }}>
            <Button
              disabled={testing || !url.trim() || !token.trim()}
              onClick={() => void handleTest()}
              size="small"
              variant="outlined"
            >
              {testing
                ? t('LWC.desktop.project.shared_database_testing')
                : t('LWC.desktop.project.shared_database_test')}
            </Button>
            {testResult && (
              <Typography color={testResult.ok ? 'success.main' : 'error'} variant="caption">
                {testResult.ok
                  ? t('LWC.desktop.project.shared_database_test_ok')
                  : t('LWC.desktop.project.shared_database_test_failed', {
                      error: testResult.error ?? '',
                    })}
              </Typography>
            )}
          </Box>
        </Stack>
      )}

      <Box sx={{ pt: 1 }}>
        <Button
          disabled={saving}
          onClick={() => void handleSave()}
          size="small"
          variant="contained"
        >
          {t('LWC.desktop.project.shared_database_save')}
        </Button>
      </Box>
      {saveSuccess && (
        <Typography color="success.main" sx={{ pt: 0.5 }} variant="caption" component="p">
          {t('LWC.desktop.project.shared_database_saved')}
        </Typography>
      )}
      {saveError && (
        <Typography color="error" sx={{ pt: 0.5 }} variant="caption" component="p">
          {t('LWC.desktop.project.shared_database_save_failed', { error: saveError })}
        </Typography>
      )}

      {backend === 'turso' && saveSuccess && (
        <Box sx={{ pt: 1.5, maxWidth: 480 }}>
          <Typography color="text.secondary" sx={{ pb: 0.5 }} variant="caption" component="p">
            {t('LWC.desktop.project.shared_database_migrate_hint')}
          </Typography>
          <Button
            disabled={migrating}
            onClick={() => void handleMigrate()}
            size="small"
            variant="outlined"
          >
            {migrating
              ? t('LWC.desktop.project.shared_database_migrating')
              : t('LWC.desktop.project.shared_database_migrate')}
          </Button>
          {migrateResult && (
            <Typography
              color={migrateResult.ok ? 'success.main' : 'error'}
              sx={{ pt: 0.5 }}
              variant="caption"
              component="p"
            >
              {migrateResult.ok
                ? t('LWC.desktop.project.shared_database_migrate_ok', {
                    rows: migrateResult.rows ?? 0,
                    tables: migrateResult.tables ?? 0,
                  })
                : t('LWC.desktop.project.shared_database_migrate_failed', {
                    error: migrateResult.error ?? '',
                  })}
            </Typography>
          )}
        </Box>
      )}
    </Box>
  );
};
