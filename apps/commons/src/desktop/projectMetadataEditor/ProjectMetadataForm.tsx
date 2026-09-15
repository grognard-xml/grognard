import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import {
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  FormControlLabel,
  IconButton,
  MenuItem,
  Radio,
  RadioGroup,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import {
  FIXED_LANGUAGE_OPTIONS,
  isKnownLanguageCode,
  languageLabelForCode,
} from '@cwrc/leafwriter/languageCodes';
import {
  NameTypePolicyPanel,
  type NameTypePolicyIO,
} from '../../../../../packages/cwrc-leafwriter/src/autoTagging/NameTypePolicyPanel';
import {
  ThingTypePolicyPanel,
  type ThingTypePolicyIO,
} from '../../../../../packages/cwrc-leafwriter/src/autoTagging/ThingTypePolicyPanel';
import {
  persistAuthoritySettings,
  readPersistedAuthoritySettings,
} from '../../../../../packages/cwrc-leafwriter/src/autoTagging/authoritySettings';
import { localizeMetadataFieldLabel } from '@src/desktop/metadataFieldLabels';
import { SOURCE_LANGUAGE_PATH } from '@src/desktop/projectLanguage';
import type { ProjectMetadataDialogState } from '@src/desktop/projectMetadataDialogState';
import type { TranslationLanguage } from '@src/desktop/translationTypes';
import { METADATA_FIELDS_TEMPLATE_PATH } from '@src/desktop/metadataFieldsTemplate';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProjectMetadataSavePayload, ProjectMetadataSaveResult } from '../projectMetadataSave';
import { TursoPedbSettings } from './TursoPedbSettings';

export interface ProjectMetadataEditorIO {
  loadState: () => Promise<ProjectMetadataDialogState | null>;
  saveMetadata: (
    payload: Omit<ProjectMetadataSavePayload, 'projectFilePath'>,
  ) => Promise<ProjectMetadataSaveResult>;
  nameTypePolicy: NameTypePolicyIO;
  thingTypePolicy: ThingTypePolicyIO;
  onCancel?: () => void;
  onSaved?: () => void;
}

interface ProjectMetadataFormProps {
  active?: boolean;
  io: ProjectMetadataEditorIO;
  layout?: 'page' | 'panel';
}

export const ProjectMetadataForm = ({
  active = true,
  io,
  layout = 'panel',
}: ProjectMetadataFormProps) => {
  const { t } = useTranslation();
  const [state, setState] = useState<ProjectMetadataDialogState | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [alignmentUnit, setAlignmentUnit] = useState<'div' | 'p' | 'ab'>('p');
  const [languages, setLanguages] = useState<TranslationLanguage[]>([]);
  const [newLangCode, setNewLangCode] = useState('');
  const [syncToCentral, setSyncToCentral] = useState(false);
  const [savedSyncToCentral, setSavedSyncToCentral] = useState(false);
  const [confirmSyncOpen, setConfirmSyncOpen] = useState(false);
  const [pendingApplyToDocuments, setPendingApplyToDocuments] = useState(false);
  const [syncReport, setSyncReport] = useState<{ broken: number; conflicts: number } | null>(null);
  const [savedSnapshot, setSavedSnapshot] = useState<string | null>(null);
  const [matchAcrossLineBreaks, setMatchAcrossLineBreaks] = useState(false);

  const snapshotFromState = useCallback(
    (
      dialogState: ProjectMetadataDialogState,
      nextAlignmentUnit: 'div' | 'p' | 'ab',
      nextLanguages: TranslationLanguage[],
      nextSyncToCentral: boolean,
      pendingLangCode = '',
    ) =>
      JSON.stringify({
        values: dialogState.values,
        custom: dialogState.custom,
        alignmentUnit: nextAlignmentUnit,
        languages: nextLanguages,
        syncToCentral: nextSyncToCentral,
        pendingLangCode,
      }),
    [],
  );

  const applyDialogState = useCallback(
    (dialogState: ProjectMetadataDialogState | null) => {
      if (dialogState) {
        const nextAlignmentUnit = dialogState.translation.alignmentUnit ?? 'p';
        const nextLanguages = dialogState.translation.languages;
        setState(dialogState);
        setAlignmentUnit(nextAlignmentUnit);
        setLanguages(nextLanguages);
        setNewLangCode('');
        setSyncToCentral(dialogState.syncToCentral);
        setSavedSyncToCentral(dialogState.syncToCentral);
        setMatchAcrossLineBreaks(readPersistedAuthoritySettings()?.matchAcrossLineBreaks === true);
        setSavedSnapshot(
          snapshotFromState(
            dialogState,
            nextAlignmentUnit,
            nextLanguages,
            dialogState.syncToCentral,
          ),
        );
        setError(null);
      } else {
        setError(t('LWC.desktop.project.errors.could_not_load_edition_metadata'));
        setSavedSnapshot(null);
      }
      setLoading(false);
    },
    [snapshotFromState, t],
  );

  const isDirty = useMemo(() => {
    if (!state || savedSnapshot === null) return false;
    return (
      snapshotFromState(state, alignmentUnit, languages, syncToCentral, newLangCode.trim()) !==
      savedSnapshot
    );
  }, [
    alignmentUnit,
    languages,
    newLangCode,
    savedSnapshot,
    snapshotFromState,
    state,
    syncToCentral,
  ]);

  const confirmDiscardUnsaved = useCallback(async (): Promise<boolean> => {
    if (!isDirty) return true;
    const title = t('LWC.desktop.project.dialogs.unsaved_settings_title');
    const message = t('LWC.desktop.project.dialogs.unsaved_settings_message');
    if (window.electronAPI?.showNativeMessageBox) {
      const result = await window.electronAPI.showNativeMessageBox({
        type: 'warning',
        title,
        message,
        buttons: [t('LWC.desktop.project.dialogs.discard_changes_button'), t('LWC.commons.cancel')],
        cancelId: 1,
        defaultId: 1,
      });
      return result.response === 0;
    }
    return window.confirm(`${title}\n\n${message}`);
  }, [isDirty, t]);

  useEffect(() => {
    if (!active || !isDirty) {
      delete window.__ljbConfirmDiscardProjectSettings;
      return;
    }
    window.__ljbConfirmDiscardProjectSettings = () => {
      const title = t('LWC.desktop.project.dialogs.unsaved_settings_title');
      const message = t('LWC.desktop.project.dialogs.unsaved_settings_message');
      return window.confirm(`${title}\n\n${message}`);
    };
    return () => {
      delete window.__ljbConfirmDiscardProjectSettings;
    };
  }, [active, isDirty, t]);

  useEffect(() => {
    if (!active) return;
    setLoading(true);
    void io.loadState().then(applyDialogState);
  }, [active, applyDialogState, io]);

  const updateField = (path: string, value: string) => {
    setState((prev) => (prev ? { ...prev, values: { ...prev.values, [path]: value } } : prev));
  };

  const updateCustom = (index: number, key: 'path' | 'label' | 'value', value: string) => {
    setState((prev) => {
      if (!prev) return prev;
      const custom = prev.custom.map((row, i) => (i === index ? { ...row, [key]: value } : row));
      return { ...prev, custom };
    });
  };

  const addCustomRow = () => {
    setState((prev) =>
      prev
        ? {
            ...prev,
            custom: [...prev.custom, { path: '', label: '', value: '' }],
          }
        : prev,
    );
  };

  const removeCustomRow = (index: number) => {
    setState((prev) =>
      prev ? { ...prev, custom: prev.custom.filter((_, i) => i !== index) } : prev,
    );
  };

  const addLanguage = () => {
    const code = newLangCode.trim();
    if (!code || languages.some((lang) => lang.code === code)) return;
    setLanguages((prev) => [...prev, { code, label: languageLabelForCode(code) }]);
    setNewLangCode('');
  };

  const removeLanguage = (code: string) => {
    setLanguages((prev) => prev.filter((lang) => lang.code !== code));
  };

  const performSave = async (applyToDocuments: boolean) => {
    if (!state) return;
    setSubmitting(true);
    setError(null);
    try {
      const pendingCode = newLangCode.trim();
      const languagesToSave =
        pendingCode && !languages.some((lang) => lang.code === pendingCode)
          ? [...languages, { code: pendingCode, label: languageLabelForCode(pendingCode) }]
          : languages;

      const result = await io.saveMetadata({
        values: state.values,
        custom: state.custom,
        applyToDocuments,
        translationAlignmentUnit: alignmentUnit,
        translationLanguages: languagesToSave,
        syncToCentral,
      });

      if (!result.ok) {
        if (result.error !== 'cancelled') {
          setError(result.error ?? t('LWC.desktop.project.errors.could_not_save_metadata'));
        }
        return;
      }
      if (result.syncReport && (result.syncReport.broken > 0 || result.syncReport.conflicts > 0)) {
        setSyncReport(result.syncReport);
        return;
      }
      setSavedSyncToCentral(syncToCentral);
      const refreshed = await io.loadState();
      applyDialogState(refreshed);
      io.onSaved?.();
    } catch (error) {
      const message =
        error instanceof Error && error.message.trim()
          ? error.message
          : t('LWC.desktop.project.errors.could_not_save_metadata');
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSave = (applyToDocuments: boolean) => {
    if (!state || submitting) return;
    if (syncToCentral && !savedSyncToCentral) {
      setPendingApplyToDocuments(applyToDocuments);
      setConfirmSyncOpen(true);
      return;
    }
    void performSave(applyToDocuments);
  };

  const isFirstSetup = state?.mode === 'firstSetup';
  const requiresLanguage =
    state?.fields.some((field) => field.path === SOURCE_LANGUAGE_PATH) ?? false;
  const languageMissing = requiresLanguage && !(state?.values[SOURCE_LANGUAGE_PATH] ?? '').trim();

  const formBody = (
    <>
      {loading ? (
        <Typography color="text.secondary">{t('LWC.commons.loading')}</Typography>
      ) : !state ? (
        <Typography color="error" variant="body2">
          {error ?? t('LWC.desktop.project.errors.could_not_load_project_settings')}
        </Typography>
      ) : (
        <>
          {state.note && (
            <Typography color="text.secondary" variant="body2">
              {state.note.startsWith('LWC.')
                ? t(state.note, { path: METADATA_FIELDS_TEMPLATE_PATH })
                : state.note}
            </Typography>
          )}

          {state.fields.map((field) =>
            field.path === SOURCE_LANGUAGE_PATH ? (
              <TextField
                fullWidth
                key={field.path}
                label={localizeMetadataFieldLabel(field.path, field.label, t)}
                InputLabelProps={{ shrink: true }}
                onChange={(event) => updateField(field.path, event.target.value)}
                required
                select
                size="small"
                value={state.values[field.path] ?? ''}
              >
                <MenuItem value="">{t('LWC.desktop.project.select_language')}</MenuItem>
                {(state.values[field.path] ?? '') !== '' &&
                  !isKnownLanguageCode(state.values[field.path] ?? '') && (
                    <MenuItem value={state.values[field.path]}>
                      {t('LWC.desktop.project.legacy_language', {
                        code: state.values[field.path],
                      })}
                    </MenuItem>
                  )}
                {FIXED_LANGUAGE_OPTIONS.map((option) => (
                  <MenuItem key={option.code} value={option.code}>
                    {option.label} ({option.code})
                  </MenuItem>
                ))}
              </TextField>
            ) : (
              <TextField
                fullWidth
                key={field.path}
                label={localizeMetadataFieldLabel(field.path, field.label, t)}
                multiline={field.path.includes('projectDesc')}
                onChange={(event) => updateField(field.path, event.target.value)}
                size="small"
                value={state.values[field.path] ?? ''}
              />
            ),
          )}

          <Typography sx={{ pt: 1 }} variant="subtitle2">
            {t('LWC.desktop.project.custom_fields')}
          </Typography>

          {state.custom.map((row, index) => (
            <Stack direction="row" key={`custom-${index}`} spacing={1}>
              <TextField
                label={t('LWC.desktop.project.tei_path')}
                onChange={(event) => updateCustom(index, 'path', event.target.value)}
                size="small"
                sx={{ flex: 1.2 }}
                value={row.path}
              />
              <TextField
                label={t('LWC.desktop.project.label')}
                onChange={(event) => updateCustom(index, 'label', event.target.value)}
                size="small"
                sx={{ flex: 1 }}
                value={row.label}
              />
              <TextField
                label={t('LWC.desktop.project.value')}
                onChange={(event) => updateCustom(index, 'value', event.target.value)}
                size="small"
                sx={{ flex: 1.2 }}
                value={row.value}
              />
              <IconButton
                aria-label={t('LWC.desktop.project.remove_custom_field')}
                onClick={() => removeCustomRow(index)}
              >
                <DeleteOutlineIcon />
              </IconButton>
            </Stack>
          ))}

          <Button onClick={addCustomRow} size="small" variant="text">
            {t('LWC.desktop.project.add_custom_field')}
          </Button>

          <Typography sx={{ pt: 1 }} variant="subtitle2">
            {t('LWC.desktop.project.entity_database')}
          </Typography>
          <Typography color="text.secondary" variant="body2">
            {t('LWC.desktop.project.entity_database_hint')}
          </Typography>
          <FormControlLabel
            control={
              <Checkbox
                checked={syncToCentral}
                onChange={(event) => setSyncToCentral(event.target.checked)}
              />
            }
            label={t('LWC.desktop.project.sync_to_central')}
          />

          <TursoPedbSettings active={active} />

          <Typography sx={{ pt: 1 }} variant="subtitle2">
            {t('LWC.desktop.project.translation')}
          </Typography>
          <Typography color="text.secondary" variant="body2">
            {state.translation.locked
              ? t('LWC.desktop.project.alignment_unit_locked')
              : t('LWC.desktop.project.alignment_granularity_hint')}
          </Typography>
          <RadioGroup
            row
            value={alignmentUnit}
            onChange={(event) => setAlignmentUnit(event.target.value as 'div' | 'p' | 'ab')}
          >
            <FormControlLabel
              control={<Radio disabled={state.translation.locked} />}
              label={t('LWC.desktop.project.div_alignment')}
              value="div"
            />
            <FormControlLabel
              control={<Radio disabled={state.translation.locked} />}
              label={t('LWC.desktop.project.paragraph_alignment')}
              value="p"
            />
            <FormControlLabel
              control={<Radio disabled={state.translation.locked} />}
              label={t('LWC.desktop.project.ab_alignment')}
              value="ab"
            />
          </RadioGroup>

          <Typography variant="body2" sx={{ fontWeight: 500 }}>
            {t('LWC.desktop.project.languages')}
          </Typography>

          {languages.map((lang) => (
            <Stack alignItems="center" direction="row" key={lang.code} spacing={1}>
              <TextField
                disabled
                label={t('LWC.desktop.project.code')}
                size="small"
                sx={{ flex: 1 }}
                value={lang.code}
              />
              <TextField
                disabled
                label={t('LWC.desktop.project.label')}
                size="small"
                sx={{ flex: 2 }}
                value={lang.label}
              />
              <IconButton
                aria-label={t('LWC.desktop.project.remove_language')}
                onClick={() => removeLanguage(lang.code)}
              >
                <DeleteOutlineIcon />
              </IconButton>
            </Stack>
          ))}

          <Stack alignItems="center" direction="row" spacing={1}>
            <TextField
              label={t('LWC.desktop.project.add_translation_language')}
              InputLabelProps={{ shrink: true }}
              onChange={(event) => setNewLangCode(event.target.value)}
              select
              size="small"
              sx={{ flex: 2 }}
              value={newLangCode}
            >
              <MenuItem value="" />
              {FIXED_LANGUAGE_OPTIONS.filter(
                (option) => !languages.some((lang) => lang.code === option.code),
              ).map((option) => (
                <MenuItem key={option.code} value={option.code}>
                  {option.label} ({option.code})
                </MenuItem>
              ))}
            </TextField>
            <Button disabled={!newLangCode} onClick={addLanguage} size="small" variant="text">
              {t('LWC.commons.add')}
            </Button>
          </Stack>

          <Box sx={{ pt: 1 }}>
            <Typography sx={{ pb: 0.5 }} variant="subtitle2">
              {t('LW.settings.authorities.match_across_line_breaks')}
            </Typography>
            <Typography color="text.secondary" sx={{ pb: 1 }} variant="body2">
              {t('LW.settings.authorities.match_across_line_breaks_description')}
            </Typography>
            <FormControlLabel
              control={
                <Checkbox
                  checked={matchAcrossLineBreaks}
                  onChange={(event) => {
                    const checked = event.target.checked;
                    setMatchAcrossLineBreaks(checked);
                    const current = readPersistedAuthoritySettings() ?? {};
                    void persistAuthoritySettings({ ...current, matchAcrossLineBreaks: checked });
                  }}
                />
              }
              label={t('LW.settings.authorities.match_across_line_breaks_enable')}
            />
          </Box>

          <Box sx={{ pt: 1 }}>
            <NameTypePolicyPanel
              io={io.nameTypePolicy}
              sourceLanguage={(state.values[SOURCE_LANGUAGE_PATH] ?? '').trim() || null}
            />
          </Box>

          <Box sx={{ pt: 1 }}>
            <ThingTypePolicyPanel io={io.thingTypePolicy} />
          </Box>

          {error && (
            <Typography color="error" variant="body2">
              {error}
            </Typography>
          )}
        </>
      )}
    </>
  );

  const actionBar = (
    <Stack direction="row" flexWrap="wrap" gap={1} justifyContent="flex-end" sx={{ pt: 1 }}>
      {layout === 'page' && !isFirstSetup && io.onCancel && (
        <Button
          disabled={submitting}
          onClick={() => {
            void (async () => {
              if (!(await confirmDiscardUnsaved())) return;
              io.onCancel?.();
            })();
          }}
        >
          {t('LWC.commons.cancel')}
        </Button>
      )}
      {!isFirstSetup && (
        <Button
          disabled={submitting || languageMissing}
          onClick={() => handleSave(false)}
          variant="outlined"
        >
          {t('LWC.desktop.project.save_defaults_only')}
        </Button>
      )}
      <Button
        color="primary"
        disabled={submitting || !state || languageMissing}
        onClick={() => handleSave(!isFirstSetup)}
        variant="contained"
      >
        {isFirstSetup
          ? t('LWC.desktop.project.save_button')
          : t('LWC.desktop.project.save_and_update_documents_button')}
      </Button>
    </Stack>
  );

  const confirmDialogs = (
    <>
      <Dialog
        open={confirmSyncOpen}
        onClose={() => setConfirmSyncOpen(false)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>{t('LWC.desktop.project.sync_confirm_title')}</DialogTitle>
        <DialogContent>
          <DialogContentText>{t('LWC.desktop.project.sync_confirm_message')}</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmSyncOpen(false)}>{t('LWC.commons.cancel')}</Button>
          <Button
            variant="contained"
            onClick={() => {
              setConfirmSyncOpen(false);
              void performSave(pendingApplyToDocuments);
            }}
          >
            {t('LWC.desktop.project.sync_now')}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!syncReport} onClose={() => setSyncReport(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('LWC.desktop.project.sync_report_title')}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {syncReport
              ? t('LWC.desktop.project.sync_report_message', {
                  broken: syncReport.broken,
                  conflicts: syncReport.conflicts,
                })
              : ''}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSyncReport(null)}>{t('LWC.commons.close')}</Button>
        </DialogActions>
      </Dialog>
    </>
  );

  if (layout === 'page') {
    return (
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          height: '100vh',
          bgcolor: 'background.default',
        }}
      >
        <Box
          sx={{ px: 2, py: 1.5, borderBottom: 1, borderColor: 'divider', WebkitAppRegion: 'drag' }}
        >
          <Typography variant="h6">{t('LWC.desktop.project.settings')}</Typography>
          <Typography color="text.secondary" variant="body2">
            {isFirstSetup
              ? t('LWC.desktop.project.first_setup_message')
              : t('LWC.desktop.project.defaults_message')}
          </Typography>
        </Box>

        <Stack spacing={2} sx={{ flex: 1, p: 2, WebkitAppRegion: 'no-drag', overflow: 'auto' }}>
          {formBody}
        </Stack>

        <Box sx={{ p: 2, borderTop: 1, borderColor: 'divider', WebkitAppRegion: 'no-drag' }}>
          {actionBar}
        </Box>

        {confirmDialogs}
      </Box>
    );
  }

  return (
    <Stack spacing={2}>
      <Typography color="text.secondary" variant="body2">
        {t('LWC.desktop.project.defaults_message')}
      </Typography>
      {formBody}
      {actionBar}
      {confirmDialogs}
    </Stack>
  );
};
