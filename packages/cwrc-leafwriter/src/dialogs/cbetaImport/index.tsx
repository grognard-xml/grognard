import {
  Alert,
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  FormGroup,
  LinearProgress,
  Link,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  MenuItem,
  Select,
  TextField,
  Typography,
} from '@mui/material';
import { useCallback, useEffect, useState } from 'react';
import { useActions } from '../../overmind';
import { CorpusWorkRow } from '../corpusWorkRow';
import type { IDialog } from '../type';
import { isPluginEnabled } from '../../plugins';
import { setImportJobPanelExpanded } from '../../importJobs/importJobProgress';

const PLUGIN_ID = 'cbeta-import';

const DIALOG_WIDTH = 720;
const DIALOG_HEIGHT = 580;
const RESULT_LIST_HEIGHT = 320;

type CbetaSplitUnit = 'mulu' | 'juan';

interface CbetaWorkHit {
  work_id: string;
  title: string;
  canon: string;
  dynasty: string;
  category: string;
  juan_count: number;
  /** ``<vol>n<no>`` stems backing the work; empty when it has no TEI source in xml-p5. */
  files?: string[];
}

/** A work is importable only when the catalogue entry maps to real xml-p5 file(s). */
const hasSource = (hit: CbetaWorkHit): boolean => (hit.files?.length ?? 0) > 0;

/**
 * `pluginsInvokePython` rejects with the raw Python traceback wrapped in Electron's
 * IPC prefix. Show the user just the final exception line; keep the rest in the console.
 */
const cleanPythonError = (raw: unknown): string => {
  const text = (raw instanceof Error ? raw.message : String(raw)).trim();
  const unwrapped = text
    .replace(/^Error invoking remote method '[^']*':\s*/, '')
    .replace(/^(?:Uncaught\s+)?Error:\s*/, '')
    .trim();
  if (!/Traceback \(most recent call last\)/.test(unwrapped)) return unwrapped;
  const lines = unwrapped
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (
      /^(?:[A-Za-z_][\w.]*\.)?[A-Za-z_]\w*(?:Error|Exception|Warning|Interrupt):\s/.test(lines[i])
    ) {
      return lines[i];
    }
  }
  return lines[lines.length - 1] ?? unwrapped;
};

interface CbetaCorpusStatus {
  present: boolean;
  path?: string;
  pinned_tag?: string;
  commit?: string;
}

export type CbetaImportDialogProps = IDialog;

const joinPath = (...parts: string[]): string =>
  parts.filter(Boolean).join('/').replace(/\/+/g, '/');

const invokePython = async <T,>(payload: Record<string, unknown>): Promise<T> => {
  const api = window.electronAPI;
  if (!api?.pluginsInvokePython)
    throw new Error('CBETA import is only available in the desktop app.');
  return (await api.pluginsInvokePython(PLUGIN_ID, payload)) as T;
};

export const CbetaImportDialog = ({ onClose, open = false }: CbetaImportDialogProps) => {
  const { openDialog } = useActions().ui;
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<CbetaWorkHit[]>([]);
  const [selected, setSelected] = useState<CbetaWorkHit | null>(null);
  const [corpus, setCorpus] = useState<CbetaCorpusStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [status, setStatus] = useState('');
  const [imported, setImported] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cleanImport, setCleanImport] = useState(true);
  const [stripLineBreaks, setStripLineBreaks] = useState(false);
  const [splitUnit, setSplitUnit] = useState<CbetaSplitUnit>('mulu');

  const projectReady = Boolean(window.__leafWriterProject?.isProjectReady?.());

  const refreshStatus = useCallback(async () => {
    try {
      const next = await invokePython<CbetaCorpusStatus>({ op: 'status' });
      setCorpus(next);
      return next;
    } catch (e) {
      console.error('[cbeta-import] status', e);
      setError(cleanPythonError(e));
      return null;
    }
  }, []);

  const search = useCallback(async (text: string) => {
    try {
      const next = await invokePython<CbetaWorkHit[]>({ op: 'search', query: text, limit: 40 });
      setHits(next);
      setSelected((cur) => {
        if (cur && next.some((h) => h.work_id === cur.work_id)) return cur;
        return next.find(hasSource) ?? next[0] ?? null;
      });
    } catch (e) {
      // search stub raises until catalog_index is built (planning §5.7)
      console.error('[cbeta-import] search', e);
      setHits([]);
      setError(cleanPythonError(e));
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setImported(false);
    // Split by section headings into a clean reading edition by default, for
    // every catalog — the most common import shape.
    setCleanImport(true);
    setStripLineBreaks(false);
    setSplitUnit('mulu');
    void refreshStatus().then(async (info) => {
      if (info?.present) {
        void search('');
        return;
      }
      setSyncing(true);
      setStatus('Installing the CBETA corpus from GitHub (~1 GB, can take several minutes)…');
      setError(null);
      try {
        await window.electronAPI?.cbetaEnsureCorpus?.();
        const next = await refreshStatus();
        if (next?.present) {
          setStatus('Corpus ready.');
          void search('');
        }
      } catch (e) {
        console.error('[cbeta-import] ensure corpus', e);
        setError(cleanPythonError(e));
        setStatus('');
      } finally {
        setSyncing(false);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open || !corpus?.present) return;
    const h = window.setTimeout(() => void search(query), 200);
    return () => window.clearTimeout(h);
  }, [open, query, search, corpus?.present]);

  const runImport = async () => {
    if (!selected) return;
    if (!hasSource(selected)) {
      setError(
        `${selected.title} (${selected.work_id}) is in the CBETA catalogue but has no TEI/XML ` +
          `source in this release — it cannot be imported.`,
      );
      return;
    }
    const project = window.__leafWriterProject;
    const rootPath = project?.getProjectRootPath?.();
    const config = project?.getProjectConfig?.();
    const api = window.electronAPI;
    if (!project || !projectReady || !rootPath || !config) {
      setError('Open a project before importing from CBETA.');
      return;
    }
    if (!api?.importJobStart || !api.pluginsInvokePython) {
      setError('CBETA import is only available in the desktop app.');
      return;
    }

    setBusy(true);
    setError(null);
    setImported(false);
    setStatus(`Starting background import for ${selected.title}…`);

    try {
      // Final folder is canon/vol after convert; job rewrites destDir once known.
      const destDir = joinPath(rootPath, 'imported', 'cbeta', selected.work_id);
      await api.importJobStart({
        kind: 'cbeta',
        workId: selected.work_id,
        title: selected.title,
        projectRoot: rootPath,
        destDir,
        projectConfig: config,
        cleanImport,
        stripLineBreaks,
        splitUnit,
        crossFamily: config.schema?.catalogId !== 'cbeta',
      });
      setImportJobPanelExpanded(true);
      setImported(true);
      setStatus(`Import of ${selected.title} started in the background.`);
      onClose?.();
    } catch (e) {
      console.error('[cbeta-import] import', e);
      setError(cleanPythonError(e));
      setStatus('');
      setImported(false);
    } finally {
      setBusy(false);
    }
  };

  const canImport = Boolean(
    selected &&
    hasSource(selected) &&
    projectReady &&
    corpus?.present &&
    !busy &&
    !syncing &&
    window.electronAPI?.importJobStart,
  );
  const working = busy || syncing;

  return (
    <Dialog
      open={open}
      onClose={() => onClose?.()}
      maxWidth={false}
      scroll="paper"
      PaperProps={{
        sx: {
          width: DIALOG_WIDTH,
          height: DIALOG_HEIGHT,
          maxWidth: DIALOG_WIDTH,
          maxHeight: DIALOG_HEIGHT,
          display: 'flex',
          flexDirection: 'column',
        },
      }}
    >
      <DialogTitle sx={{ flexShrink: 0 }}>Import from CBETA</DialogTitle>
      <DialogContent
        sx={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          pt: 1,
        }}
      >
        {!isPluginEnabled(PLUGIN_ID) && (
          <Alert severity="warning" sx={{ mb: 1, flexShrink: 0 }}>
            Enable the “CBETA import” plugin in Tools → Plugins.
          </Alert>
        )}

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1, flexShrink: 0 }}>
          <Typography
            variant="body2"
            component="label"
            htmlFor="cbeta-split-unit"
            sx={{ flexShrink: 0 }}
          >
            Split by
          </Typography>
          <FormControl size="small" sx={{ minWidth: 200 }} disabled={working}>
            <Select
              id="cbeta-split-unit"
              value={splitUnit}
              onChange={(e) => setSplitUnit(e.target.value as CbetaSplitUnit)}
            >
              <MenuItem value="mulu">Section (mulu)</MenuItem>
              <MenuItem value="juan">Juan (卷)</MenuItem>
            </Select>
          </FormControl>
        </Box>

        <FormGroup sx={{ mb: 1, flexShrink: 0 }}>
          <FormControlLabel
            control={
              <Checkbox
                checked={cleanImport}
                disabled={working}
                onChange={(e) => setCleanImport(e.target.checked)}
              />
            }
            label="Clean import (Remove collation anchors, back-matter; text follows the Taishō edition.)"
          />
          <FormControlLabel
            control={
              <Checkbox
                checked={stripLineBreaks}
                disabled={working}
                onChange={(e) => setStripLineBreaks(e.target.checked)}
              />
            }
            label="Strip Taishō line breaks (&lt;lb&gt;)"
          />
          {!stripLineBreaks && (
            <Typography
              variant="caption"
              color="text.secondary"
              component="div"
              sx={{ pl: 4.5, mt: -0.5, mb: 0.5, maxWidth: 640 }}
            >
              Keeping <code>&lt;lb/&gt;</code> markers splits names across text nodes. Either enable{' '}
              <Link
                component="button"
                type="button"
                variant="caption"
                onClick={() => openDialog({ type: 'settings', props: { initialTab: 'project' } })}
                sx={{ verticalAlign: 'baseline' }}
              >
                Match across line and page breaks
              </Link>{' '}
              in Settings → Project (off by default), or check “Strip Taishō line breaks” above to
              join text at import.
            </Typography>
          )}
        </FormGroup>

        {working && !error && status && (
          <Box sx={{ flexShrink: 0, mb: 1 }}>
            <LinearProgress sx={{ mb: 0.5 }} />
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
              {status}
            </Typography>
          </Box>
        )}

        {(error || (corpus && !corpus.present && !working)) && (
          <Box sx={{ flexShrink: 0, mb: 1 }}>
            {corpus && !corpus.present && !working && !error && (
              <Alert severity="warning">
                CBETA corpus is not ready. Configure the CBETA import plugin in Tools → Plugins.
              </Alert>
            )}
            {error && (
              <Alert severity="error" onClose={() => setError(null)}>
                {error}
              </Alert>
            )}
          </Box>
        )}

        {!working && status && !error && imported && (
          <Alert severity="success" onClose={() => setStatus('')} sx={{ mb: 1, flexShrink: 0 }}>
            {status}
          </Alert>
        )}

        {!working && status && !error && !imported && (
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ mb: 1, display: 'block', flexShrink: 0 }}
          >
            {status}
          </Typography>
        )}

        <TextField
          fullWidth
          label="Search by title, work id (T0001), dynasty or 部類"
          value={query}
          disabled={!corpus?.present || working}
          onChange={(e) => setQuery(e.target.value)}
          sx={{ mb: 1, flexShrink: 0 }}
        />

        <List
          dense
          sx={{
            flex: 1,
            minHeight: RESULT_LIST_HEIGHT,
            overflow: 'auto',
            border: 1,
            borderColor: 'divider',
          }}
        >
          {hits.length === 0 && (
            <ListItem>
              <ListItemText primary={corpus?.present ? 'No matches.' : 'Corpus not synced.'} />
            </ListItem>
          )}
          {hits.map((hit) => {
            const available = hasSource(hit);
            return (
              <ListItemButton
                key={hit.work_id}
                disabled={!available}
                selected={selected?.work_id === hit.work_id}
                onClick={() => setSelected(hit)}
              >
                <CorpusWorkRow
                  section={hit.category}
                  ident={hit.work_id}
                  title={hit.title}
                  dynasty={hit.dynasty}
                  authors={hit.juan_count ? `${hit.juan_count} 卷` : undefined}
                  note={
                    available ? undefined : 'Not digitised in this CBETA release — no TEI source.'
                  }
                />
              </ListItemButton>
            );
          })}
        </List>
      </DialogContent>
      <DialogActions sx={{ flexShrink: 0 }}>
        <Button onClick={() => onClose?.()}>Close</Button>
        <Button variant="contained" disabled={!canImport} onClick={() => void runImport()}>
          Start in background
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export const isCbetaImportAvailable = (): boolean =>
  Boolean(window.electronAPI?.pluginsInvokePython);
