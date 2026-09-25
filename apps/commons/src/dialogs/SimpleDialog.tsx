import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import { Button, Dialog, DialogActions, DialogContent, DialogTitle, Icon } from '@mui/material';
import { getIcon } from '@src/icons';
import { nanoid } from 'nanoid';
import { useState } from 'react';
import { useActions } from '../overmind';
import type { SimpleDialogProps } from './type';

export const SimpleDialog = ({
  actions = [{ action: 'close', label: 'close' }],
  Body,
  id = nanoid(),
  icon,
  keyBindings,
  maxWidth = 'sm',
  onBeforeClose,
  onClose,
  open = true,
  preventEscape = false,
  severity,
  title,
  children,
}: SimpleDialogProps) => {
  const { closeDialog } = useActions().ui;

  const [data, setData] = useState<Record<string, unknown>>({});
  const [actionsDisabled, setActionsDisabled] = useState(false);

  const handleShouldClose = async (action?: string) => {
    if (!onBeforeClose) return true;
    return await onBeforeClose(action);
  };

  const handleClose = async (_event: MouseEvent, reason: string) => {
    if (preventEscape && (reason === 'backdropClick' || reason === 'escapeKeyDown')) {
      return;
    }

    setActionsDisabled(true);
    const shouldClose = await handleShouldClose();
    if (shouldClose === false) {
      setActionsDisabled(false);
      return;
    }

    closeDialog(id);
    onClose?.(reason, data);
  };

  const handleAction = async (action: string) => {
    setActionsDisabled(true);
    const shouldClose = await handleShouldClose(action);
    if (shouldClose === false) {
      setActionsDisabled(false);
      return;
    }

    closeDialog(id);
    onClose?.(action, data);
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    const action = keyBindings?.[event.key];
    if (!action || actionsDisabled) return;
    event.preventDefault();
    event.stopPropagation();
    void handleAction(action);
  };

  return (
    <Dialog
      aria-labelledby="alert-dialog-title"
      fullWidth
      id={id}
      maxWidth={maxWidth}
      onClose={handleClose}
      onKeyDown={keyBindings ? handleKeyDown : undefined}
      open={open}
    >
      <DialogTitle
        id="alert-dialog-title"
        display="flex"
        justifyContent="center"
        alignItems="center"
        py={2.5}
        gap={1}
        textTransform="capitalize"
      >
        {icon ? (
          <Icon component={getIcon(icon)} />
        ) : (
          <>
            {severity === 'error' && <ErrorOutlineIcon color="error" />}
            {severity === 'warning' && <WarningAmberIcon color="warning" />}
          </>
        )}
        {title}
      </DialogTitle>
      {(children || Body) && (
        <DialogContent sx={{ pt: 0.5 }}>
          {children
            ? children
            : typeof Body === 'string'
              ? Body
              : Body && <Body data={data} onChangeData={setData} />}
        </DialogContent>
      )}
      <DialogActions
        sx={[
          {
            mx: 1.5,
            justifyContent: 'flex-end',
            marginRight: 0,
          },
          actions.length > 1 && {
            justifyContent: 'space-between',
            marginRight: 'auto',
          },
        ]}
      >
        {actions.map(({ action, label, variant }, index) => (
          <Button
            key={index}
            disabled={actionsDisabled}
            onPointerDown={() => handleAction(action)}
            variant={variant ?? 'text'}
          >
            {label ?? action}
          </Button>
        ))}
      </DialogActions>
    </Dialog>
  );
};
