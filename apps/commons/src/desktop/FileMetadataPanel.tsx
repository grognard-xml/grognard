import {
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { EntityLookupField, type EntityLookupValue } from '@src/desktop/EntityLookupField';
import { isoYearString } from '../../../../packages/cwrc-leafwriter/src/autoTagging/entities';
import { isPluginEnabled } from '../../../../packages/cwrc-leafwriter/src/plugins/registry';
import { useTranslation } from 'react-i18next';
import {
  applyFileHeaderFields,
  documentSupportsFileMetadata,
  getActiveTabXml,
  isTeiCatalogForFileMetadata,
  pushXmlToActiveEditor,
  readFileMetadataFromXml,
} from '@src/desktop/fileMetadata';
import { localizeMetadataFieldLabel } from '@src/desktop/metadataFieldLabels';
import {
  readMetadataFieldsTemplate,
  resolveFileMetadataFields,
  type MetadataFieldsTemplate,
} from '@src/desktop/metadataFieldsTemplate';
import {
  applySourceDescriptionToXml,
  emptySourceDescription,
  readSourceDescriptionFromXml,
  type SourceDescription,
  type SourceFormat,
} from '@src/desktop/sourceDescription';
import {
  applyProfileToSource,
  applySourceProfileToFolderFiles,
  createSourceProfile,
  fileInSameFolder,
  profileLabelFromSource,
  readGlobalSourceProfiles,
  scanProjectSourceProfiles,
  toSharedSource,
  upsertGlobalSourceProfile,
} from '@src/desktop/sourceProfiles';
import type { DedupedProjectSource, SourceProfile } from '@src/desktop/sourceProfileTypes';
import { SourceProfileImportDialog } from '@src/desktop/SourceProfileImportDialog';
import { SourceProfileSaveDialog } from '@src/desktop/SourceProfileSaveDialog';
import { isDesktop } from '@src/types/desktop';
import { useActions, useAppState } from '@src/overmind';
import { useCallback, useEffect, useRef, useState } from 'react';

/** Structured TEI source metadata: book title, authors, dates, edition, source. */
const TeiSourceFields = ({
  disabled,
  onChange,
  value,
}: {
  disabled: boolean;
  onChange: (next: SourceDescription) => void;
  value: SourceDescription;
}) => {
  const { t } = useTranslation();
  const isRange =
    value.workDate.when === undefined &&
    (value.workDate.notBefore !== undefined || value.workDate.notAfter !== undefined);
  const [rangeMode, setRangeMode] = useState(isRange);

  useEffect(() => {
    setRangeMode(isRange);
    // Only resync the toggle when the underlying document changes shape.
  }, [isRange]);

  // EntityLookupField's work-title flow calls onChange (title link) and then,
  // after awaiting a Wikidata fetch, onWorkDetails (author/date backfill).
  // Both merge onto "the current value" — but the async gap means onWorkDetails
  // would otherwise close over the pre-link value and revert the title update
  // when it fires. Merge against a ref instead so the second merge always sees
  // whatever the first one already committed.
  const valueRef = useRef(value);
  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  const update = (patch: Partial<SourceDescription>) => onChange({ ...valueRef.current, ...patch });

  const toggleRange = (checked: boolean) => {
    setRangeMode(checked);
    if (checked) {
      update({
        workDate: value.workDate.when
          ? { notBefore: value.workDate.when, notAfter: value.workDate.when }
          : { notBefore: value.workDate.notBefore, notAfter: value.workDate.notAfter },
      });
    } else {
      update({
        workDate: { when: value.workDate.notBefore || value.workDate.notAfter || undefined },
      });
    }
  };

  return (
    <>
      <EntityLookupField
        disabled={disabled}
        kind="work"
        label={t('LWC.desktop.file_metadata.book_title')}
        mode="single"
        onChange={([item]: EntityLookupValue[]) =>
          update({
            title: item?.name ?? '',
            titleRef: item?.ref,
            titleKey: item?.key,
          })
        }
        onPersistedChange={(item) =>
          update({
            title: item.name,
            titleRef: item.ref,
            titleKey: item.key,
          })
        }
        onWorkDetails={({ workYear, authors }) => {
          const current = valueRef.current;
          const patch: Partial<SourceDescription> = {};
          const dateIsEmpty =
            !current.workDate.when && !current.workDate.notBefore && !current.workDate.notAfter;
          if (workYear != null && dateIsEmpty) {
            patch.workDate = { when: isoYearString(workYear) };
          }
          if (authors.length > 0 && current.authors.length === 0) {
            patch.authors = authors;
          }
          if (Object.keys(patch).length > 0) update(patch);
        }}
        tag="title"
        values={
          value.title ? [{ name: value.title, ref: value.titleRef, key: value.titleKey }] : []
        }
      />

      <EntityLookupField
        disabled={disabled}
        kind="person"
        label={t('LWC.desktop.author_pill.authors_label')}
        mode="multi"
        onChange={(authors: EntityLookupValue[]) => update({ authors })}
        onPersistedChange={(item) => {
          const current = valueRef.current;
          update({
            authors: current.authors.map((author) =>
              author.name === item.name && author.ref === item.ref
                ? { ...author, key: item.key }
                : author,
            ),
          });
        }}
        tag="persName"
        values={value.authors}
      />

      <Box>
        <Stack alignItems="center" direction="row" spacing={1}>
          {rangeMode ? (
            <>
              <TextField
                disabled={disabled}
                label={t('LWC.desktop.file_metadata.not_before')}
                onChange={(event) =>
                  update({
                    workDate: { ...value.workDate, when: undefined, notBefore: event.target.value },
                  })
                }
                size="small"
                sx={{ flex: 1 }}
                value={value.workDate.notBefore ?? ''}
              />
              <TextField
                disabled={disabled}
                label={t('LWC.desktop.file_metadata.not_after')}
                onChange={(event) =>
                  update({
                    workDate: { ...value.workDate, when: undefined, notAfter: event.target.value },
                  })
                }
                size="small"
                sx={{ flex: 1 }}
                value={value.workDate.notAfter ?? ''}
              />
            </>
          ) : (
            <TextField
              disabled={disabled}
              label={t('LWC.desktop.file_metadata.year')}
              onChange={(event) => update({ workDate: { when: event.target.value } })}
              size="small"
              sx={{ flex: 1 }}
              value={value.workDate.when ?? ''}
            />
          )}
        </Stack>
        <FormControlLabel
          control={
            <Checkbox
              checked={rangeMode}
              disabled={disabled}
              onChange={(event) => toggleRange(event.target.checked)}
              size="small"
            />
          }
          label={
            <Typography color="text.secondary" variant="caption">
              {t('LWC.desktop.file_metadata.uncertain_date')}
            </Typography>
          }
        />
      </Box>

      <Stack direction="row" spacing={1}>
        <TextField
          disabled={disabled}
          label={t('LWC.desktop.file_metadata.edition')}
          onChange={(event) => update({ edition: event.target.value })}
          size="small"
          sx={{ flex: 2 }}
          value={value.edition}
        />
        <TextField
          disabled={disabled}
          helperText={t('LWC.desktop.file_metadata.year_of_edition_hint')}
          label={t('LWC.desktop.file_metadata.year_of_edition')}
          onChange={(event) => update({ editionDate: event.target.value })}
          size="small"
          sx={{ flex: 1 }}
          value={value.editionDate}
        />
      </Stack>

      <TextField
        disabled={disabled}
        fullWidth
        label={t('LWC.desktop.file_metadata.transcription_source')}
        minRows={3}
        multiline
        onChange={(event) => update({ sourceNote: event.target.value })}
        size="small"
        value={value.sourceNote}
      />

      {isPluginEnabled('chhiv') && (
        <TextField
          select
          disabled={disabled}
          fullWidth
          label={t('LWC.desktop.file_metadata.format')}
          onChange={(event) =>
            update({ format: (event.target.value || undefined) as SourceFormat | undefined })
          }
          size="small"
          value={value.format ?? ''}
        >
          <MenuItem value="">
            <em>{t('LWC.desktop.file_metadata.format_none')}</em>
          </MenuItem>
          <MenuItem value="book">{t('LWC.desktop.file_metadata.format_book')}</MenuItem>
          <MenuItem value="slips">{t('LWC.desktop.file_metadata.format_slips')}</MenuItem>
          <MenuItem value="boards">{t('LWC.desktop.file_metadata.format_boards')}</MenuItem>
        </TextField>
      )}
    </>
  );
};

const SourceProfileControls = ({
  activeTabPath,
  catalogId,
  disabled,
  onApplySource,
  onAfterFolderApply,
  openTabs,
  rootPath,
  sourceValues,
}: {
  activeTabPath: string | null;
  catalogId?: string | null;
  disabled: boolean;
  onApplySource: (next: SourceDescription) => void;
  onAfterFolderApply: () => Promise<void>;
  openTabs: { dirty: boolean; filePath: string }[];
  rootPath: string | null;
  sourceValues: SourceDescription;
}) => {
  const { t } = useTranslation();
  const { notifyViaSnackbar } = useActions().ui;
  const { reloadTabFromDisk } = useActions().project;
  const [profiles, setProfiles] = useState<SourceProfile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const [importEntries, setImportEntries] = useState<DedupedProjectSource[]>([]);
  const [saveOpen, setSaveOpen] = useState(false);
  const [folderApplyBusy, setFolderApplyBusy] = useState(false);

  const reloadProfiles = useCallback(async () => {
    if (!isDesktop()) return;
    try {
      const next = await readGlobalSourceProfiles();
      setProfiles(next);
    } catch {
      setProfiles([]);
    }
  }, []);

  useEffect(() => {
    void reloadProfiles();
  }, [reloadProfiles]);

  const applySharedSource = useCallback(
    (shared: ReturnType<typeof toSharedSource>) => {
      const merged = applyProfileToSource(sourceValues, shared);
      onApplySource(merged);
    },
    [onApplySource, sourceValues],
  );

  const handleApplySelected = () => {
    const profile = profiles.find((entry) => entry.id === selectedProfileId);
    if (!profile) return;
    applySharedSource(profile.source);
  };

  const handleApplyToFolder = async () => {
    const profile = profiles.find((entry) => entry.id === selectedProfileId);
    if (!profile || !rootPath || !activeTabPath || folderApplyBusy) return;

    const folderTabs = openTabs.filter((tab) => fileInSameFolder(tab.filePath, activeTabPath));
    const dirtyTabs = folderTabs.filter((tab) => tab.dirty);

    if (dirtyTabs.length > 0 && window.electronAPI?.showNativeMessageBox) {
      const warn = await window.electronAPI.showNativeMessageBox({
        type: 'warning',
        title: t('LWC.desktop.unsaved_documents'),
        message: t('LWC.desktop.bulk_update_warning', { count: dirtyTabs.length }),
        buttons: [t('LWC.commons.continue'), t('LWC.commons.cancel')],
        cancelId: 1,
        defaultId: 1,
      });
      if (warn.response !== 0) return;
    }

    if (window.electronAPI?.showNativeMessageBox) {
      const folderFileCount = window.electronAPI.listProjectXmlFiles
        ? (await window.electronAPI.listProjectXmlFiles(rootPath)).filter((file) =>
            fileInSameFolder(file.path, activeTabPath),
          ).length
        : folderTabs.length;

      const confirm = await window.electronAPI.showNativeMessageBox({
        type: 'question',
        title: t('LWC.desktop.file_metadata.profile_apply_to_folder'),
        message: t('LWC.desktop.file_metadata.profile_apply_to_folder_confirm', {
          label: profile.label,
          count: folderFileCount,
        }),
        buttons: [t('LWC.desktop.file_metadata.profile_apply_to_folder'), t('LWC.commons.cancel')],
        cancelId: 1,
        defaultId: 0,
      });
      if (confirm.response !== 0) return;
    }

    setFolderApplyBusy(true);
    try {
      const result = await applySourceProfileToFolderFiles(
        rootPath,
        activeTabPath,
        catalogId,
        profile.source,
      );

      for (const tab of folderTabs) {
        await reloadTabFromDisk(tab.filePath);
      }
      await onAfterFolderApply();

      const summary = t('LWC.desktop.updated_files_summary', {
        updated: result.updated,
        skipped: result.skipped,
      });
      if (result.errors.length > 0) {
        notifyViaSnackbar({
          message: result.errors[0],
          options: { variant: 'error' },
        });
      } else {
        notifyViaSnackbar({
          message: summary,
          options: { variant: 'success' },
        });
      }
    } catch (error) {
      notifyViaSnackbar({
        message: error instanceof Error ? error.message : t('LWC.error.something_went_wrong'),
        options: { variant: 'error' },
      });
    } finally {
      setFolderApplyBusy(false);
    }
  };

  const handleSaveProfile = async (label: string) => {
    const profile = createSourceProfile(sourceValues, label, profiles);
    const next = await upsertGlobalSourceProfile(profile);
    setProfiles(next);
    setSelectedProfileId(profile.id);
    setSaveOpen(false);
  };

  const openImportDialog = async () => {
    if (!rootPath) return;
    setImportOpen(true);
    setImportLoading(true);
    try {
      const entries = await scanProjectSourceProfiles(rootPath, catalogId);
      setImportEntries(entries);
    } catch {
      setImportEntries([]);
    } finally {
      setImportLoading(false);
    }
  };

  const handleImportApply = (entry: DedupedProjectSource) => {
    applySharedSource(entry.source);
    setImportOpen(false);
  };

  const handleImportAddToLibrary = async (entry: DedupedProjectSource) => {
    const profile = createSourceProfile(entry.source, entry.label, profiles);
    const next = await upsertGlobalSourceProfile(profile);
    setProfiles(next);
    setSelectedProfileId(profile.id);
  };

  if (!isDesktop()) return null;

  return (
    <>
      <Stack spacing={1}>
        <TextField
          select
          fullWidth
          disabled={disabled || profiles.length === 0}
          label={t('LWC.desktop.file_metadata.source_profile')}
          size="small"
          value={selectedProfileId}
          onChange={(event) => setSelectedProfileId(event.target.value)}
          InputLabelProps={{ shrink: true }}
          SelectProps={{
            displayEmpty: true,
            renderValue: (value) => {
              if (!value) {
                return t('LWC.desktop.file_metadata.profile_none');
              }
              return profiles.find((profile) => profile.id === value)?.label ?? '';
            },
          }}
        >
          <MenuItem value="">
            <em>{t('LWC.desktop.file_metadata.profile_none')}</em>
          </MenuItem>
          {profiles.map((profile) => (
            <MenuItem key={profile.id} value={profile.id}>
              {profile.label}
            </MenuItem>
          ))}
        </TextField>
        <Stack direction="row" flexWrap="wrap" gap={0.5}>
          <Button
            disabled={disabled || !selectedProfileId}
            onClick={handleApplySelected}
            size="small"
            variant="contained"
          >
            {t('LWC.desktop.file_metadata.profile_apply')}
          </Button>
          <Button
            disabled={
              disabled || !selectedProfileId || !activeTabPath || !rootPath || folderApplyBusy
            }
            onClick={() => void handleApplyToFolder()}
            size="small"
            variant="outlined"
          >
            {t('LWC.desktop.file_metadata.profile_apply_to_folder')}
          </Button>
          <Button
            disabled={disabled}
            onClick={() => setSaveOpen(true)}
            size="small"
            variant="outlined"
          >
            {t('LWC.desktop.file_metadata.profile_save_as')}
          </Button>
          <Button
            disabled={disabled || !rootPath}
            onClick={() => void openImportDialog()}
            size="small"
            variant="outlined"
          >
            {t('LWC.desktop.file_metadata.import_from_project')}
          </Button>
        </Stack>
      </Stack>

      <SourceProfileSaveDialog
        defaultLabel={profileLabelFromSource(toSharedSource(sourceValues))}
        onClose={() => setSaveOpen(false)}
        onSave={(label) => void handleSaveProfile(label)}
        open={saveOpen}
      />

      <SourceProfileImportDialog
        entries={importEntries}
        loading={importLoading}
        onAddToLibrary={(entry) => void handleImportAddToLibrary(entry)}
        onApply={handleImportApply}
        onClose={() => setImportOpen(false)}
        open={importOpen}
      />
    </>
  );
};

export const FileMetadataPanel = ({ visible = true }: { visible?: boolean }) => {
  const { t } = useTranslation();
  const { activeTabPath, config, openTabs, rootPath } = useAppState().project;
  const { readonly } = useAppState().editor;
  const { markTabDirty, updateTabContent } = useActions().project;

  const [values, setValues] = useState<Record<string, string>>({});
  const [sourceValues, setSourceValues] = useState<SourceDescription>(emptySourceDescription());
  const skipNextSyncRef = useRef(false);
  const loadedTabRef = useRef<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const valuesRef = useRef(values);
  const sourceValuesRef = useRef(sourceValues);

  const [fieldsTemplate, setFieldsTemplate] = useState<MetadataFieldsTemplate | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!rootPath) {
      setFieldsTemplate(null);
      return;
    }
    readMetadataFieldsTemplate(rootPath).then((template) => {
      if (!cancelled) setFieldsTemplate(template);
    });
    return () => {
      cancelled = true;
    };
  }, [rootPath]);

  const catalogId = config?.schema?.catalogId;
  // Structured TEI fields unless a project template overrides the file fields.
  const structured = isTeiCatalogForFileMetadata(catalogId) && !(fieldsTemplate?.file?.length ?? 0);
  const metadataFields = resolveFileMetadataFields(fieldsTemplate, catalogId);
  const supported = Boolean(
    activeTabPath &&
    documentSupportsFileMetadata(
      activeTabPath ? getActiveTabXml(activeTabPath, openTabs) : '',
      catalogId,
    ),
  );

  useEffect(() => {
    valuesRef.current = values;
  }, [values]);

  useEffect(() => {
    sourceValuesRef.current = sourceValues;
  }, [sourceValues]);

  useEffect(() => {
    if (!visible) return;
    if (!activeTabPath) {
      loadedTabRef.current = null;
      setValues({});
      setSourceValues(emptySourceDescription());
      return;
    }

    if (skipNextSyncRef.current) {
      skipNextSyncRef.current = false;
      loadedTabRef.current = activeTabPath;
      return;
    }

    // Reload from XML only when the user opens a different file — not on every
    // editor buffer update, which would wipe in-progress authority links.
    if (loadedTabRef.current === activeTabPath) return;
    loadedTabRef.current = activeTabPath;

    const currentXml = getActiveTabXml(activeTabPath, openTabs);
    if (!currentXml) return;

    if (structured) {
      const next = readSourceDescriptionFromXml(currentXml);
      sourceValuesRef.current = next;
      setSourceValues(next);
    } else {
      const next = readFileMetadataFromXml(currentXml, catalogId, fieldsTemplate?.file);
      valuesRef.current = next;
      setValues(next);
    }
  }, [activeTabPath, catalogId, fieldsTemplate, openTabs, structured, visible]);

  const pushUpdatedXml = useCallback(
    (nextXml: string, currentXml: string) => {
      if (!activeTabPath || nextXml === currentXml) return;
      skipNextSyncRef.current = true;
      pushXmlToActiveEditor({
        content: nextXml,
        filePath: activeTabPath,
        markTabDirty,
        updateTabContent,
      });
    },
    [activeTabPath, markTabDirty, updateTabContent],
  );

  const commitChanges = useCallback(
    (nextValues: Record<string, string>) => {
      if (!activeTabPath || readonly) return;
      const currentXml = getActiveTabXml(activeTabPath, openTabs);
      if (!currentXml) return;
      pushUpdatedXml(applyFileHeaderFields(currentXml, nextValues, catalogId), currentXml);
    },
    [activeTabPath, catalogId, openTabs, pushUpdatedXml, readonly],
  );

  const commitSourceChanges = useCallback(
    (next: SourceDescription) => {
      if (!activeTabPath || readonly) return;
      const currentXml = getActiveTabXml(activeTabPath, openTabs);
      if (!currentXml) return;
      pushUpdatedXml(
        applySourceDescriptionToXml(currentXml, next, catalogId === 'teiAll'),
        currentXml,
      );
      sourceValuesRef.current = next;
      setSourceValues(next);
    },
    [activeTabPath, catalogId, openTabs, pushUpdatedXml, readonly],
  );

  const handleFieldChange = (path: string, value: string) => {
    const nextValues = { ...valuesRef.current, [path]: value };
    valuesRef.current = nextValues;
    setValues(nextValues);

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => commitChanges(nextValues), 300);
  };

  const handleSourceChange = (next: SourceDescription) => {
    sourceValuesRef.current = next;
    setSourceValues(next);

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => commitSourceChanges(next), 300);
  };

  const applySourceImmediately = useCallback(
    (next: SourceDescription) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      sourceValuesRef.current = next;
      setSourceValues(next);
      commitSourceChanges(next);
    },
    [commitSourceChanges],
  );

  const refreshSourceFromActiveTab = useCallback(async () => {
    if (!activeTabPath || !structured) return;
    const xml =
      (await window.electronAPI?.readFile(activeTabPath).catch(() => null)) ??
      getActiveTabXml(activeTabPath, openTabs);
    if (!xml) return;
    const next = readSourceDescriptionFromXml(xml);
    loadedTabRef.current = activeTabPath;
    sourceValuesRef.current = next;
    setSourceValues(next);
  }, [activeTabPath, openTabs, structured]);

  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    [],
  );

  if (!activeTabPath) {
    return (
      <Paper elevation={0} square sx={{ height: '100%', p: 2 }}>
        <Typography color="text.secondary" variant="body2">
          {t('LWC.desktop.file_metadata.open_file_prompt')}
        </Typography>
      </Paper>
    );
  }

  if (!supported) {
    return (
      <Paper elevation={0} square sx={{ height: '100%', p: 2 }}>
        <Typography color="text.secondary" variant="body2">
          {t('LWC.desktop.file_metadata.unsupported_schema')}
        </Typography>
      </Paper>
    );
  }

  return (
    <Paper
      elevation={0}
      square
      sx={[
        { height: '100%', overflow: 'auto', p: 2 },
        (theme) =>
          theme.applyStyles('dark', {
            bgcolor: theme.vars.palette.background.paper,
          }),
      ]}
    >
      <Stack spacing={2}>
        <Typography variant="subtitle2">{t('LWC.desktop.file_metadata.panel_title')}</Typography>
        {structured ? (
          <>
            <SourceProfileControls
              activeTabPath={activeTabPath}
              catalogId={catalogId}
              disabled={readonly}
              onAfterFolderApply={refreshSourceFromActiveTab}
              onApplySource={applySourceImmediately}
              openTabs={openTabs}
              rootPath={rootPath}
              sourceValues={sourceValues}
            />
            <TeiSourceFields
              disabled={readonly}
              onChange={handleSourceChange}
              value={sourceValues}
            />
          </>
        ) : (
          metadataFields.map((field) => {
            const label = localizeMetadataFieldLabel(field.path, field.label, t);
            const isSource = field.path === 'sourceDesc/p' || field.path === 'FILEDESC/SOURCEDESC';
            return (
              <TextField
                key={field.path}
                disabled={readonly}
                fullWidth
                label={label}
                minRows={field.multiline || isSource ? 3 : undefined}
                multiline={Boolean(field.multiline) || isSource}
                onChange={(event) => handleFieldChange(field.path, event.target.value)}
                size="small"
                value={values[field.path] ?? ''}
              />
            );
          })
        )}
        <Box>
          <Typography color="text.secondary" variant="caption">
            {t('LWC.desktop.file_metadata.project_defaults_hint')}
          </Typography>
        </Box>
      </Stack>
    </Paper>
  );
};
