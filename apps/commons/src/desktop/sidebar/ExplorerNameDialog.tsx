import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
} from '@mui/material';
import { useEffect, useState } from 'react';

interface ExplorerNameDialogProps {
  confirmLabel: string;
  initialValue: string;
  onCancel: () => void;
  onConfirm: (value: string) => void;
  open: boolean;
  placeholder: string;
  title: string;
  cancelLabel: string;
}

/**
 * Keeps the typed text in its own state: held by the explorer, every keystroke re-rendered the
 * whole file tree (thousands of rows after a large import), which made typing lag.
 */
export const ExplorerNameDialog = ({
  cancelLabel,
  confirmLabel,
  initialValue,
  onCancel,
  onConfirm,
  open,
  placeholder,
  title,
}: ExplorerNameDialogProps) => {
  const [value, setValue] = useState(initialValue);

  useEffect(() => {
    if (open) setValue(initialValue);
  }, [open, initialValue]);

  return (
    <Dialog fullWidth maxWidth="xs" onClose={onCancel} open={open}>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <TextField
          autoFocus
          fullWidth
          margin="dense"
          placeholder={placeholder}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') onConfirm(value);
          }}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>{cancelLabel}</Button>
        <Button onClick={() => onConfirm(value)} variant="contained">
          {confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
