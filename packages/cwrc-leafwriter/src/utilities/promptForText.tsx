import { TextField } from '@mui/material';
import type { SimpleDialogMessageProps } from '../dialogs/type';

/**
 * A single-field text prompt built on the existing `'simple'` dialog type
 * (see `SimpleDialog.tsx`'s `Body`/`onChangeData`/`onSubmit` contract)
 * rather than a new dialog type - this is a one-off value collection, not a
 * feature with its own UI. No visible buttons: Enter confirms, Escape or a
 * backdrop click cancels (both already SimpleDialog's default behaviour).
 * Resolves to the trimmed input, or `null` if the user cancelled (matching
 * `window.prompt`'s contract, so callers can treat a cancel as "insert
 * nothing" without a separate boolean).
 */
export const promptForText = (title: string, label: string): Promise<string | null> => {
  return new Promise((resolve) => {
    const Body = ({ data, onChangeData, onSubmit }: SimpleDialogMessageProps) => (
      <TextField
        autoFocus
        fullWidth
        label={label}
        margin="dense"
        value={data?.value ?? ''}
        onChange={(event) => onChangeData?.({ value: event.target.value })}
        onKeyDown={(event) => {
          if (event.key === 'Enter') onSubmit?.();
        }}
      />
    );

    window.writer?.overmindActions?.ui?.openDialog({
      type: 'simple',
      props: {
        maxWidth: 'xs',
        title,
        Body,
        actions: [],
        onClose: (action?: string, data?: { value?: string }) => {
          const value = data?.value ?? '';
          resolve(action === 'confirm' ? value.trim() : null);
        },
      },
    });
  });
};
