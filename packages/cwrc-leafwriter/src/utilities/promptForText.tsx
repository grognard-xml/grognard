import { TextField } from '@mui/material';
import i18n from '../i18n';
import type { SimpleDialogMessageProps } from '../dialogs/type';

/**
 * A single-field text prompt built on the existing `'simple'` dialog type
 * (see `SimpleDialog.tsx`'s `Body`/`onChangeData` contract) rather than a
 * new dialog type - this is a one-off value collection, not a feature with
 * its own UI. Resolves to the trimmed input, or `null` if the user
 * cancelled (matching `window.prompt`'s contract, so callers can treat a
 * cancel as "insert nothing" without a separate boolean).
 */
export const promptForText = (title: string, label: string): Promise<string | null> => {
  return new Promise((resolve) => {
    const Body = ({ data, onChangeData }: SimpleDialogMessageProps) => (
      <TextField
        autoFocus
        fullWidth
        label={label}
        margin="dense"
        value={data?.value ?? ''}
        onChange={(event) => onChangeData?.({ value: event.target.value })}
      />
    );

    window.writer?.overmindActions?.ui?.openDialog({
      type: 'simple',
      props: {
        maxWidth: 'xs',
        title,
        Body,
        actions: [
          { action: 'cancel', label: i18n.t('LW.commons.cancel') },
          { action: 'confirm', label: i18n.t('LW.commons.ok'), variant: 'contained' },
        ],
        onClose: (action?: string, data?: { value?: string }) => {
          const value = data?.value ?? '';
          resolve(action === 'confirm' ? value.trim() : null);
        },
      },
    });
  });
};
