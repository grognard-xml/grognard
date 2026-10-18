import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  LinearProgress,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  TextField,
  Typography,
} from '@mui/material';
import { useCallback, useEffect, useState } from 'react';
import { CorpusWorkRow } from '../corpusWorkRow';
import type { IDialog } from '../type';
import { isPluginEnabled } from '../../plugins';
import { setImportJobPanelExpanded } from '../../importJobs/importJobProgress';
import { toPlainJobOptions } from '../../importJobs/toPlainJobOptions';

interface DaozangWorkHit {
  id: string;
  dz_no: string;
  title: string;
  rel_path: string;
  section: string;
  dynasty: string;
  authors: string;
  file_title: string;
}

interface DaozangStatus {
  ready: boolean;
  textCount: number;
  source?: 'user-cache' | 'bundled' | 'none';
  manifest?: {
    syncedAt?: string;
    transcriber?: string;
  };
}

export type DaozangImportDialogProps = IDialog;

const joinPath = (...parts: string[]): string =>
  parts.filter(Boolean).join('/').replace(/\/+/g, '/');

export const DaozangImportDialog = ({ onClose, open = false }: DaozangImportDialogProps) => {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<DaozangWorkHit[]>([]);
  const [selected, setSelected] = useState<DaozangWorkHit | null>(null);
  const [statusInfo, setStatusInfo] = useState<DaozangStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);

  const projectReady = Boolean(window.__leafWriterProject?.isProjectReady?.());

  const refreshStatus = useCallback(async () => {
    const api = window.electronAPI?.daozangStatus;
    if (!api) return;
    const next = await api();
    setStatusInfo(next);
    return next;
  }, []);

  const search = useCallback(async (text: string) => {
    const api = window.electronAPI?.daozangSearch;
    if (!api) return;
    const next = await api(text);
    setHits(next);
    setSelected((current) => {
      if (current && next.some((hit) => hit.rel_path === current.rel_path)) return current;
      return next[0] ?? null;
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    void refreshStatus().then((info) => {
      if (info?.ready) void search('');
    });
  }, [open, refreshStatus, search]);

  useEffect(() => {
    if (!open || !statusInfo?.ready) return;
    const handle = window.setTimeout(() => {
      void search(query);
    }, 200);
    return () => window.clearTimeout(handle);
  }, [open, query, search, statusInfo?.ready]);

  const runImport = async () => {
    if (!selected) return;
    const project = window.__leafWriterProject;
    const rootPath = project?.getProjectRootPath?.();
    const config = project?.getProjectConfig?.();
    if (!project || !projectReady || !rootPath || !config) {
      setError('Open a project before importing from the Daozang corpus.');
      return;
    }
    const api = window.electronAPI;
    if (!api?.importJobStart || !api.pluginsInvokePython || !api.daozangResolveText) {
      setError('Daozang import is only available in the desktop app.');
      return;
    }

    setBusy(true);
    setError(null);
    setStatus(`Starting background import for ${selected.title}…`);

    try {
      const destDir = joinPath(rootPath, 'imported', 'daozang');
      await api.importJobStart(
        toPlainJobOptions({
          kind: 'daozang',
          workId: selected.id,
          title: selected.title,
          relPath: selected.rel_path,
          projectRoot: rootPath,
          destDir,
          projectConfig: config,
        }),
      );
      setImportJobPanelExpanded(true);
      setStatus(`Import of ${selected.title} started in the background.`);
      onClose?.();
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : String(importError));
      setStatus('');
    } finally {
      setBusy(false);
    }
  };

  const canImport = Boolean(
    selected && projectReady && statusInfo?.ready && !busy && window.electronAPI?.importJobStart,
  );

  return (
    <Dialog open={open} onClose={() => onClose?.()} maxWidth="md" fullWidth>
      <DialogTitle>Import from Daozang</DialogTitle>
      <DialogContent>
        {!isPluginEnabled('daozang-import') && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            Enable the “Daozang import” plugin in Tools → Plugins.
          </Alert>
        )}

        <Typography variant="body2" sx={{ mb: 2 }}>
          Search the {statusInfo?.textCount || 1504} 方瞳子 (Fang Tongzi) punctuated transcriptions.
        </Typography>

        {statusInfo && !statusInfo.ready && (
          <Alert severity="error" sx={{ mb: 2 }}>
            The bundled corpus is missing. Reinstall the “Daozang import” plugin.
          </Alert>
        )}

        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        {busy && (
          <Box sx={{ mb: 2 }}>
            <LinearProgress />
            {status && (
              <Typography variant="caption" sx={{ mt: 1, display: 'block' }}>
                {status}
              </Typography>
            )}
          </Box>
        )}

        {!busy && status && (
          <Typography variant="caption" sx={{ mb: 2, display: 'block' }}>
            {status}
          </Typography>
        )}

        <TextField
          fullWidth
          label="Search by title, 道藏 number, section, dynasty or author"
          value={query}
          disabled={!statusInfo?.ready || busy}
          onChange={(event) => setQuery(event.target.value)}
          sx={{ mb: 2 }}
        />

        <List dense sx={{ maxHeight: 320, overflow: 'auto', border: 1, borderColor: 'divider' }}>
          {hits.length === 0 && (
            <ListItem>
              <ListItemText primary={statusInfo?.ready ? 'No matches.' : 'Corpus unavailable.'} />
            </ListItem>
          )}
          {hits.map((hit) => (
            <ListItemButton
              key={hit.rel_path}
              selected={selected?.rel_path === hit.rel_path}
              onClick={() => setSelected(hit)}
            >
              <CorpusWorkRow
                section={hit.section}
                ident={hit.dz_no ? `DZ ${hit.dz_no}` : undefined}
                title={hit.title}
                fileTitle={hit.file_title}
                dynasty={hit.dynasty}
                authors={hit.authors}
              />
            </ListItemButton>
          ))}
        </List>
      </DialogContent>
      <DialogActions>
        <Button onClick={() => onClose?.()}>Close</Button>
        <Button variant="contained" disabled={!canImport} onClick={() => void runImport()}>
          Start in background
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export const isDaozangImportAvailable = (): boolean =>
  Boolean(
    window.electronAPI?.daozangStatus &&
    window.electronAPI?.daozangSearch &&
    window.electronAPI?.pluginsInvokePython,
  );
