import CloseIcon from '@mui/icons-material/Close';
import { IconButton, LinearProgress, Stack, Tooltip, Typography } from '@mui/material';
import { useSyncExternalStore } from 'react';
import {
  clearAppUpdateProgress,
  getAppUpdateProgress,
  subscribeAppUpdateProgress,
} from '../../autoTagging/appUpdateProgress';

/** Bottom-bar progress for the background download of an app update. */
export const AppUpdateIndicator = () => {
  const progress = useSyncExternalStore(subscribeAppUpdateProgress, getAppUpdateProgress);
  if (!progress.active) return null;
  const downloading = progress.percent !== null;

  return (
    <Tooltip title={progress.detail}>
      <Stack
        direction="row"
        alignItems="center"
        spacing={0.75}
        sx={{ flexShrink: 0, maxWidth: 360 }}
      >
        <Typography variant="caption" sx={{ color: 'text.disabled', fontSize: '0.7rem' }} noWrap>
          {progress.label}
        </Typography>
        <LinearProgress
          variant="determinate"
          value={downloading ? progress.percent! : 100}
          sx={{ width: 56, height: 3, borderRadius: 1, opacity: 0.5, flexShrink: 0 }}
          color="inherit"
        />
        {!downloading && (
          <IconButton
            aria-label="Dismiss"
            onClick={clearAppUpdateProgress}
            size="small"
            sx={{ color: 'text.disabled', p: 0.125 }}
          >
            <CloseIcon sx={{ fontSize: 14 }} />
          </IconButton>
        )}
      </Stack>
    </Tooltip>
  );
};
