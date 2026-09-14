import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Link,
  Stack,
  Typography,
} from '@mui/material';
import { useEffect, useState } from 'react';

const PROJECT_URL = 'https://grognard-xml.github.io/site';
const PRIVACY_URL = 'https://grognard-xml.github.io/site/privacy.html';
const BUG_REPORT_URL = 'https://github.com/grognard-xml/grognard/issues/new?template=bug_report.md';

interface AboutDialogProps {
  onClose: () => void;
  open: boolean;
}

export const AboutDialog = ({ onClose, open }: AboutDialogProps) => {
  const [appVersion, setAppVersion] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void window.electronAPI?.getAppVersion?.().then((version) => {
      if (!cancelled && typeof version === 'string' && version.trim()) {
        setAppVersion(version.trim());
      }
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  return (
    <Dialog fullWidth maxWidth="xs" onClose={onClose} open={open}>
      <DialogTitle>About Grognard</DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          <Typography variant="body2">
            A desktop XML editor for scholarly text encoding, built on LEAF-Writer.
          </Typography>
          <Link href={PROJECT_URL} rel="noopener noreferrer" target="_blank" variant="body2">
            Project website
          </Link>
          {appVersion && (
            <Typography color="text.secondary" variant="caption">
              Version {appVersion}
            </Typography>
          )}
          <Stack direction="row" flexWrap="wrap" gap={2}>
            <Link href={PRIVACY_URL} rel="noopener noreferrer" target="_blank" variant="body2">
              Privacy policy
            </Link>
            <Link href={BUG_REPORT_URL} rel="noopener noreferrer" target="_blank" variant="body2">
              Bugs / requests
            </Link>
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>OK</Button>
      </DialogActions>
    </Dialog>
  );
};
