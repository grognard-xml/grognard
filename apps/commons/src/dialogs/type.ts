import { DialogProps as MuiDialogProps } from '@mui/material/Dialog';
import { IconName } from '@src/icons';
import { Options as ModalProviderOptions } from 'mui-modal-provider';
import type { MissingAssetType } from '../../../../packages/cwrc-leafwriter/src/utilities/chineseAssetStatus';
export declare type ModalComponentProps<P> = Omit<P, 'open'>;

export type SeverityType = 'error' | 'info' | 'success' | 'warning';
export interface DialogActionProps {
  action: string;
  label?: string;
  variant?: 'contained' | 'outlined' | 'text';
}

export interface IDialog extends Partial<Omit<MuiDialogProps, 'onClose'>> {
  actions?: DialogActionProps[];
  icon?: IconName;
  onBeforeClose?: (action?: string) => Promise<boolean | void>;
  onClose?: <T>(action?: string, data?: T) => void;
  preventEscape?: boolean;
  severity?: SeverityType;
  title?: string;
  type?: DialogType;
  initialUrl?: string;
  importScope?: 'page' | 'work';
  /** Corpus-import dialogs: run immediately and close on success when opened from
   * the browser extension, unless the import needs a choice (e.g. edition tree). */
  autoRun?: boolean;
}

export type DialogType =
  | 'chineseAssets'
  | 'export'
  | 'import'
  | 'kanripoImport'
  | 'daozangImport'
  | 'cbetaImport'
  | 'bdrcImport'
  | 'wikisourceImport'
  | 'privacy'
  | 'signIn'
  | 'simple'
  | 'templates';

interface SimpleDialogMessageProps {
  data?: Record<string, unknown>;
  onChangeData?: (data: Record<string, unknown>) => void;
}

export interface SimpleDialogProps extends IDialog {
  Body?: React.FC<SimpleDialogMessageProps> | string;
  /** Keyboard shortcuts for actions, as `event.key` -> action (e.g. `{ Enter: 'ok' }`).
   * Escape already closes with `'escapeKeyDown'` unless `preventEscape` is set. */
  keyBindings?: Record<string, string>;
}

export interface ChineseAssetsDialogProps extends IDialog {
  missingAssets?: MissingAssetType[];
}

/** Props the Kanripo import dialog accepts when it's opened programmatically
 * rather than from the menu - see useProjectMenu's onKanripoImportOrder
 * handler, which pre-fills the dialog from a kanripo:// deep link. Mirrors
 * KanripoImportDialogProps in packages/cwrc-leafwriter's own dialogs/type.ts;
 * `initialUrl` is shared with the Wikisource import and already sits on
 * IDialog above. */
export interface KanripoImportDialogProps extends IDialog {
  initialKrId?: string;
  initialImportScope?: 'work' | 'juan';
  initialJuan?: string;
}

/** Pre-fills the BDRC import dialog from a browser-extension order — see
 * useProjectMenu's onBdrcImportOrder handler. `initialRef` is an etext id,
 * a `VE…` volume id, or a library.bdrc.io reader URL. */
export interface BdrcImportDialogProps extends IDialog {
  initialRef?: string;
  autoRun?: boolean;
}

export type DialogProps = SimpleDialogProps &
  ChineseAssetsDialogProps &
  KanripoImportDialogProps &
  BdrcImportDialogProps;

export interface DialogBarProps {
  dismissed?: boolean;
  displayId?: string;
  options?: ModalProviderOptions;
  props?: ModalComponentProps<DialogProps>;
  type?: DialogType;
}
