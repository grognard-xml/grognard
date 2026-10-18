import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty';
import PauseIcon from '@mui/icons-material/Pause';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import StopIcon from '@mui/icons-material/Stop';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import {
  Box,
  Button,
  Chip,
  Collapse,
  IconButton,
  LinearProgress,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Paper,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import { useEffect, useState, useSyncExternalStore } from 'react';
import type {
  ImportJobSnapshot,
  ImportJuanRecord,
  ImportJuanState,
} from '../../../../apps/commons/src/desktop/importJobTypes';
import { ensureImportHeaderEntitiesForPaths } from '../../../../apps/commons/src/desktop/ensureImportHeaderEntities';
import { aiApiSettingsFromDesktop } from '../autoTagging/llmClientFromSettings';
import {
  applyImportJobProgress,
  focusImportJobAttention,
  getImportJobUiState,
  jobProgress,
  newlyWrittenFiles,
  setImportJobPanelExpanded,
  setImportJobReviewReturn,
  subscribeImportJobUiState,
  trialSummary,
  visibleImportJobs,
  visibleJuan,
} from './importJobProgress';

const stateIcon = (state: ImportJuanState) => {
  switch (state) {
    case 'done':
      return <CheckCircleOutlineIcon fontSize="small" color="success" />;
    case 'needs_attention':
    case 'failed':
      return <WarningAmberIcon fontSize="small" color="warning" />;
    case 'running':
      return <HourglassEmptyIcon fontSize="small" color="primary" />;
    case 'skipped':
      return <CheckCircleOutlineIcon fontSize="small" color="disabled" />;
    default:
      return <HourglassEmptyIcon fontSize="small" color="disabled" />;
  }
};

const formatEta = (job: ImportJobSnapshot): string => {
  const { done } = jobProgress(job);
  const pending = job.juan.filter((j) => j.state === 'pending' || j.state === 'running').length;
  if (job.status === 'completed') {
    const attention = job.juan.filter((j) => j.state === 'needs_attention').length;
    return attention > 0 ? `${attention} need attention` : 'Done';
  }
  if (job.status === 'blocked') return job.blockReason ?? 'Needs you';
  if (job.status === 'cancelled') return 'Cancelled';
  if (job.status === 'paused')
    return job.pauseReason === 'trial' ? 'Trial done: check it' : 'Paused';
  if (job.status === 'queued') return 'Queued';
  if (done < 3 || !job.avgMsPerJuan || pending === 0) return 'estimating…';
  const minutes = Math.max(1, Math.round((job.avgMsPerJuan * pending) / 60_000));
  return `about ${minutes} min left`;
};

const collapsedLabel = (job: ImportJobSnapshot): string => {
  const { done, total } = jobProgress(job);
  const attention = job.juan.filter((j) => j.state === 'needs_attention').length;
  const base =
    total > 0
      ? `${job.title} ${done}/${total} juan · ${formatEta(job)}`
      : `${job.title} · ${formatEta(job)}`;
  return attention > 0 ? `${base} · ⚠ ${attention}` : base;
};

const formatTokens = (n: number): string =>
  n >= 1_000_000
    ? `${(n / 1_000_000).toFixed(1)}M`
    : n >= 1000
      ? `${Math.round(n / 1000)}k`
      : `${n}`;

const openJuanFile = async (outputPath: string): Promise<void> => {
  const project = window.__leafWriterProject;
  await project?.refreshExplorer?.();
  await project?.openFile?.(outputPath);
};

// Files appear in the project as the job writes them; they are announced to the explorer (and get
// their header entities) in batches, not once per juan.
const pendingWritten = new Set<string>();
const pendingRewritten = new Set<string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

const flushWrittenFiles = async (): Promise<void> => {
  flushTimer = null;
  const written = [...pendingWritten];
  const rewritten = [...pendingRewritten];
  pendingWritten.clear();
  pendingRewritten.clear();
  const project = window.__leafWriterProject;
  if (written.length) {
    try {
      await ensureImportHeaderEntitiesForPaths(written);
    } catch {
      // entities are best-effort after a background write
    }
  }
  await project?.refreshExplorer?.();
  // A juan written again (Retry) may be open in the editor.
  for (const filePath of rewritten) {
    await project?.reloadFileFromDisk?.(filePath);
  }
};

const queueWrittenFiles = (written: string[], rewritten: string[], immediately: boolean): void => {
  written.forEach((p) => pendingWritten.add(p));
  rewritten.forEach((p) => pendingRewritten.add(p));
  if (pendingWritten.size === 0 && pendingRewritten.size === 0 && !immediately) return;
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => void flushWrittenFiles(), immediately ? 0 : 2000);
};

export const ImportJobPanel = () => {
  const state = useSyncExternalStore(subscribeImportJobUiState, getImportJobUiState);
  const jobs = visibleImportJobs(state);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.onImportJobProgress) return;
    const unsub = api.onImportJobProgress((event) => {
      const prev = getImportJobUiState();
      applyImportJobProgress(event);
      const { written, rewritten } = newlyWrittenFiles(prev.jobs, event.jobs);
      const justFinished = event.jobs.some(
        (job) =>
          job.status === 'completed' &&
          prev.jobs.find((j) => j.jobId === job.jobId)?.status !== 'completed',
      );
      queueWrittenFiles(written, rewritten, justFinished);
    });
    void api.importJobSnapshot?.().then((event) => applyImportJobProgress(event));

    // Saved jobs are looked up for the project that is open, again when another one is opened.
    let restoredRoot: string | null = null;
    const restoreForOpenProject = () => {
      const root = window.__leafWriterProject?.getProjectRootPath?.();
      if (root && root !== restoredRoot) {
        restoredRoot = root;
        void api.importJobRestoreFromProject?.(root);
      }
    };
    restoreForOpenProject();
    window.addEventListener('focus', restoreForOpenProject);
    return () => {
      unsub();
      window.removeEventListener('focus', restoreForOpenProject);
    };
  }, []);

  if (jobs.length === 0 && !state.reviewReturn) return null;

  const primary = jobs.find((j) => j.jobId === state.activeJobId) ?? jobs[0];
  const amber =
    primary &&
    (primary.status === 'blocked' || primary.juan.some((j) => j.state === 'needs_attention'));
  const primaryProgress = primary ? jobProgress(primary) : null;

  const reviewNext = (job: ImportJobSnapshot) => {
    const next = job.juan.find((j) => j.state === 'needs_attention' && j.outputPath);
    if (!next?.outputPath) return;
    const remaining = job.juan.filter((j) => j.state === 'needs_attention').length;
    setImportJobReviewReturn({ jobId: job.jobId, remaining });
    setImportJobPanelExpanded(false);
    void openJuanFile(next.outputPath);
  };

  return (
    <>
      {state.reviewReturn && (
        <Chip
          label={`Back to queue (${state.reviewReturn.remaining} left)`}
          color="warning"
          onClick={() => {
            focusImportJobAttention(state.reviewReturn!.jobId);
            setImportJobReviewReturn(null);
          }}
          sx={{
            position: 'fixed',
            bottom: 56,
            right: 16,
            zIndex: 1400,
          }}
        />
      )}
      <Paper
        elevation={6}
        sx={{
          position: 'fixed',
          bottom: 40,
          right: 16,
          zIndex: 1350,
          width: state.expanded ? 420 : 'auto',
          minWidth: 260,
          maxWidth: 'min(420px, calc(100vw - 32px))',
          bgcolor: amber ? 'warning.light' : 'background.paper',
          border: 1,
          borderColor: amber ? 'warning.main' : 'divider',
          overflow: 'hidden',
        }}
      >
        <Stack
          direction="row"
          alignItems="center"
          spacing={1}
          sx={{ px: 1.5, py: 0.75, cursor: 'pointer' }}
          onClick={() => setImportJobPanelExpanded(!state.expanded)}
        >
          {amber && <ErrorOutlineIcon fontSize="small" color="warning" />}
          <Typography variant="body2" sx={{ flex: 1, fontSize: '0.8rem' }}>
            {primary ? collapsedLabel(primary) : 'Imports'}
            {jobs.length > 1 ? ` (+${jobs.length - 1})` : ''}
          </Typography>
          <IconButton size="small" aria-label={state.expanded ? 'Collapse' : 'Expand'}>
            {state.expanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
          </IconButton>
        </Stack>
        {primary && primaryProgress && (
          <LinearProgress
            variant={
              primary.status === 'running' && primaryProgress.total === 0
                ? 'indeterminate'
                : 'determinate'
            }
            value={primaryProgress.fraction * 100}
            color={amber ? 'warning' : 'primary'}
            aria-label={`${primary.title} progress`}
          />
        )}

        <Collapse in={state.expanded}>
          <Box sx={{ px: 1.5, pb: 1.5, pt: 1, maxHeight: 360, overflow: 'auto' }}>
            {jobs.map((job) => (
              <JobBlock
                key={job.jobId}
                job={job}
                focusAttention={state.focusAttentionJobId === job.jobId}
                onReviewNext={() => reviewNext(job)}
                onOpen={async (juan) => {
                  if (!juan.outputPath) return;
                  const remaining = job.juan.filter((j) => j.state === 'needs_attention').length;
                  setImportJobReviewReturn({ jobId: job.jobId, remaining });
                  await openJuanFile(juan.outputPath);
                }}
              />
            ))}
          </Box>
        </Collapse>
      </Paper>
    </>
  );
};

const JobBlock = ({
  job,
  focusAttention,
  onReviewNext,
  onOpen,
}: {
  job: ImportJobSnapshot;
  focusAttention: boolean;
  onReviewNext: () => void;
  onOpen: (juan: ImportJuanRecord) => void;
}) => {
  const api = window.electronAPI;
  const [showAll, setShowAll] = useState(false);
  const attention = job.juan.filter((j) => j.state === 'needs_attention');
  const done = job.juan.filter((j) => j.state === 'done').length;
  const progress = jobProgress(job);
  const trial = trialSummary(job);
  const view = visibleJuan(job, showAll);

  const resume = () => {
    // The API key is not saved with a job, so a resumed AI import takes the app's current settings.
    const ai = aiApiSettingsFromDesktop();
    void api?.importJobResume?.(job.jobId, {
      aiSettings: ai
        ? {
            baseUrl: ai.baseUrl,
            apiKey: ai.apiKey,
            model: ai.model,
            concurrency: ai.concurrency,
          }
        : null,
    });
  };

  const cancel = () => {
    const unfinished = job.juan.filter(
      (j) => j.state === 'pending' || j.state === 'running',
    ).length;
    const message =
      progress.done > 0
        ? `Cancel the import of ${job.title}? The ${progress.done} juan already written stay in the project.`
        : `Cancel the import of ${job.title}?`;
    if (unfinished > 0 || job.juan.length === 0) {
      if (!window.confirm(message)) return;
    }
    void api?.importJobCancel?.(job.jobId);
  };

  return (
    <Box sx={{ mb: 1.5 }}>
      <Stack direction="row" alignItems="center" spacing={0.5} sx={{ mb: 0.5 }}>
        <Typography variant="subtitle2" sx={{ flex: 1 }}>
          {job.title}
        </Typography>
        {job.status === 'running' && (
          <Tooltip title="Pause">
            <IconButton size="small" onClick={() => void api?.importJobPause?.(job.jobId)}>
              <PauseIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
        {(job.status === 'paused' || job.status === 'blocked' || job.status === 'queued') && (
          <Tooltip title="Resume">
            <IconButton size="small" onClick={resume}>
              <PlayArrowIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
        {job.status !== 'completed' && job.status !== 'cancelled' && (
          <Tooltip title="Cancel">
            <IconButton size="small" onClick={cancel}>
              <StopIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
        {(job.status === 'completed' || job.status === 'cancelled') && (
          <Button size="small" onClick={() => void api?.importJobDismiss?.(job.jobId)}>
            Dismiss
          </Button>
        )}
      </Stack>

      {job.juan.length > 0 && (
        <LinearProgress
          variant="determinate"
          value={progress.fraction * 100}
          sx={{ mb: 0.5 }}
          aria-label={`${job.title} progress`}
        />
      )}

      {job.status === 'blocked' && job.blockReason && (
        <Typography variant="caption" color="warning.dark" display="block" sx={{ mb: 0.5 }}>
          {job.blockReason}
        </Typography>
      )}

      {trial && (
        <Typography variant="caption" display="block" sx={{ mb: 0.5 }}>
          Trial juan {trial.stem} is written
          {trial.tokens > 0 ? ` (${formatTokens(trial.tokens)} tokens` : ''}
          {trial.tokens > 0 && trial.cost != null ? `, about $${trial.cost.toFixed(3)}` : ''}
          {trial.tokens > 0 ? ')' : ''}.
          {trial.remaining > 0 && trial.tokens > 0
            ? ` The other ${trial.remaining} juan would use about ${formatTokens(trial.remainingTokens)} tokens${
                trial.remainingCost != null ? ` (about $${trial.remainingCost.toFixed(2)})` : ''
              }.`
            : ''}{' '}
          Open it, then press Resume to continue or Cancel to stop.
        </Typography>
      )}

      {job.status === 'completed' && (
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>
          {done} ok
          {attention.length ? `, ${attention.length} need attention` : ''}.
          {job.actualCost > 0 ? ` Cost ≈ $${job.actualCost.toFixed(3)}.` : ''}{' '}
          {Math.round(job.elapsedMs / 1000)}s elapsed.
        </Typography>
      )}

      {attention.length > 0 && (
        <Button size="small" variant="outlined" sx={{ mb: 0.5 }} onClick={onReviewNext}>
          Review next ({attention.length})
        </Button>
      )}

      <List dense disablePadding>
        {view.shown.map((juan) => (
          <ListItem
            key={`${juan.stem}-${juan.sourceKey}`}
            sx={{
              py: 0,
              bgcolor:
                focusAttention && juan.state === 'needs_attention' ? 'warning.light' : undefined,
            }}
            secondaryAction={
              juan.state === 'needs_attention' || juan.state === 'failed' ? (
                <Stack direction="row" spacing={0.5}>
                  {juan.outputPath && (
                    <Button size="small" onClick={() => onOpen(juan)}>
                      Open
                    </Button>
                  )}
                  <Button
                    size="small"
                    onClick={() => void api?.importJobRetryJuan?.(job.jobId, juan.stem)}
                  >
                    Retry
                  </Button>
                  <Button
                    size="small"
                    onClick={() => void api?.importJobAcceptJuan?.(job.jobId, juan.stem)}
                  >
                    Accept
                  </Button>
                </Stack>
              ) : juan.outputPath && (job.status === 'completed' || showAll) ? (
                <Button size="small" onClick={() => onOpen(juan)}>
                  Open
                </Button>
              ) : null
            }
          >
            <ListItemIcon sx={{ minWidth: 28 }}>{stateIcon(juan.state)}</ListItemIcon>
            <ListItemText
              primary={juan.stem}
              secondary={juan.reason ?? juan.detail}
              primaryTypographyProps={{ variant: 'caption' }}
              secondaryTypographyProps={{ variant: 'caption' }}
            />
          </ListItem>
        ))}
      </List>
      {!showAll && (view.hiddenDone > 0 || view.hiddenOther > 0) && (
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
          {view.hiddenDone > 0 ? `${view.hiddenDone} finished` : ''}
          {view.hiddenDone > 0 && view.hiddenOther > 0 ? ' · ' : ''}
          {view.hiddenOther > 0 ? `${view.hiddenOther} more waiting` : ''}{' '}
          <Button size="small" onClick={() => setShowAll(true)}>
            Show all {job.juan.length}
          </Button>
        </Typography>
      )}
      {showAll && job.juan.length > 30 && (
        <Button size="small" onClick={() => setShowAll(false)}>
          Show fewer
        </Button>
      )}
    </Box>
  );
};
