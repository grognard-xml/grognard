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
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Paper,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import { useEffect, useSyncExternalStore } from 'react';
import type {
  ImportJobSnapshot,
  ImportJuanRecord,
  ImportJuanState,
} from '../../../../apps/commons/src/desktop/importJobTypes';
import { ensureImportHeaderEntitiesForPaths } from '../../../../apps/commons/src/desktop/ensureImportHeaderEntities';
import {
  applyImportJobProgress,
  focusImportJobAttention,
  getImportJobUiState,
  setImportJobPanelExpanded,
  setImportJobReviewReturn,
  subscribeImportJobUiState,
  visibleImportJobs,
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
  const done = job.juan.filter((j) =>
    ['done', 'needs_attention', 'failed', 'skipped'].includes(j.state),
  ).length;
  const pending = job.juan.filter((j) => j.state === 'pending' || j.state === 'running').length;
  if (job.status === 'completed') {
    const attention = job.juan.filter((j) => j.state === 'needs_attention').length;
    return attention > 0 ? `${attention} need attention` : 'Done';
  }
  if (job.status === 'blocked') return job.blockReason ?? 'Needs you';
  if (job.status === 'paused') return 'Paused';
  if (job.status === 'queued') return 'Queued';
  if (done < 3 || !job.avgMsPerJuan || pending === 0) return 'estimating…';
  const minutes = Math.max(1, Math.round((job.avgMsPerJuan * pending) / 60_000));
  return `about ${minutes} min left`;
};

const collapsedLabel = (job: ImportJobSnapshot): string => {
  const total = job.juan.length;
  const done = job.juan.filter((j) =>
    ['done', 'needs_attention', 'failed', 'skipped'].includes(j.state),
  ).length;
  const attention = job.juan.filter((j) => j.state === 'needs_attention').length;
  const base =
    total > 0
      ? `${job.title} ${done}/${total} juan · ${formatEta(job)}`
      : `${job.title} · ${formatEta(job)}`;
  return attention > 0 ? `${base} · ⚠ ${attention}` : base;
};

const openJuanFile = async (outputPath: string): Promise<void> => {
  const project = window.__leafWriterProject;
  await project?.refreshExplorer?.();
  await project?.openFile?.(outputPath);
};

const refreshWrittenFiles = async (job: ImportJobSnapshot): Promise<void> => {
  const written = job.juan.map((j) => j.outputPath).filter((p): p is string => Boolean(p));
  if (!written.length) return;
  try {
    await ensureImportHeaderEntitiesForPaths(written);
  } catch {
    // entities are best-effort after background write
  }
  await window.__leafWriterProject?.refreshExplorer?.();
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
      for (const job of event.jobs) {
        const was = prev.jobs.find((j) => j.jobId === job.jobId);
        if (job.status === 'completed' && was?.status !== 'completed') {
          void refreshWrittenFiles(job);
        }
      }
    });
    void api.importJobSnapshot?.().then((event) => applyImportJobProgress(event));
    const root = window.__leafWriterProject?.getProjectRootPath?.();
    if (root) void api.importJobRestoreFromProject?.(root);
    return unsub;
  }, []);

  if (jobs.length === 0 && !state.reviewReturn) return null;

  const primary = jobs.find((j) => j.jobId === state.activeJobId) ?? jobs[0];
  const amber =
    primary &&
    (primary.status === 'blocked' || primary.juan.some((j) => j.state === 'needs_attention'));

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
          maxWidth: 'min(420px, calc(100vw - 32px))',
          bgcolor: amber ? 'warning.light' : 'background.paper',
          border: 1,
          borderColor: amber ? 'warning.main' : 'divider',
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

        <Collapse in={state.expanded}>
          <Box sx={{ px: 1.5, pb: 1.5, maxHeight: 360, overflow: 'auto' }}>
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
  const attention = job.juan.filter((j) => j.state === 'needs_attention');
  const done = job.juan.filter((j) => j.state === 'done').length;

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
            <IconButton size="small" onClick={() => void api?.importJobResume?.(job.jobId)}>
              <PlayArrowIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
        {job.status !== 'completed' && job.status !== 'cancelled' && (
          <Tooltip title="Cancel">
            <IconButton size="small" onClick={() => void api?.importJobCancel?.(job.jobId)}>
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

      {job.status === 'blocked' && job.blockReason && (
        <Typography variant="caption" color="warning.dark" display="block" sx={{ mb: 0.5 }}>
          {job.blockReason}
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
        {job.juan.map((juan) => (
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
              ) : juan.outputPath && job.status === 'completed' ? (
                <Button size="small" onClick={() => onOpen(juan)}>
                  Open
                </Button>
              ) : null
            }
          >
            <ListItemIcon sx={{ minWidth: 28 }}>{stateIcon(juan.state)}</ListItemIcon>
            <ListItemText
              primary={juan.stem}
              secondary={juan.reason}
              primaryTypographyProps={{ variant: 'caption' }}
              secondaryTypographyProps={{ variant: 'caption' }}
            />
          </ListItem>
        ))}
      </List>
    </Box>
  );
};
