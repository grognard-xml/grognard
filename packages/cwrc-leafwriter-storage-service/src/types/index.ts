import { Locales } from '@cwrc/leafwriter-storage-service/i18n';
import type { IconName } from '../icons';
import type { ProviderAuth } from './Provider';
export * from './assert';

export interface StorageDialogProps {
  open: boolean;
  config?: StorageDialogConfig;
  headerLabel?: string;
  onBackdropClick?: () => void;
  onCancel?: () => void;
  onChange?: (resource?: Resource) => void;
  onLoad?: (resource: Resource) => void;
  onSave?: (resource: Resource) => void;
  resource?: Resource | string;
  source?: StorageSource;
  type?: DialogType;
}

export type DialogType = 'load' | 'save';
export type StorageSource = 'cloud' | 'local' | 'paste' | 'url';

export interface StorageDialogConfig {
  allowLocalFiles?: boolean;
  allowedMimeTypes?: MimeTypeSupported[];
  allowPaste?: boolean;
  allowUrl?: boolean;
  defaultCommitMessage?: string;
  locale?: Locales | (string & {});
  preferProvider?: string;
  providers?: ProviderAuth[];
  showInvisibleFiles?: boolean;
  validate?: Validate;
}

export type MimeTypeSupported =
  | 'application/json'
  | 'application/pdf'
  | 'application/xml'
  | 'text/csv'
  | 'text/html'
  | 'text/markdown'
  | 'text/plain'
  | 'text/xml';

export interface FileDetail {
  content: string;
  file: File;
}

export interface SelectedItem {
  organization?: Organization;
  path?: string;
  repository?: Repository;
  type?: 'file' | 'folder' | 'repo' | 'org' | 'dir';
}

export type Validate = ({ content, filename }: { content: string; filename?: string }) => {
  valid: boolean;
  error?: string;
};

export type SuportedProviders = 'github' | 'gitlab';

export interface Resource {
  storageSource?: StorageSource;
  provider?: string;
  owner?: string;
  ownerType?: string;
  repo?: string;
  branch?: string;
  path?: string;
  filename?: string;
  content?: string;
  hash?: string;
  url?: string;
  writePermission?: boolean;
}

export interface SourcePanelOption {
  icon: IconName;
  label: string;
  value: StorageSource | SuportedProviders;
}

export type ErrorType = 'info' | 'warning' | 'error';

export interface Error {
  type: ErrorType;
  message: string;
}

export interface User {
  avatar_url?: string;
  email?: string;
  emailVerified?: boolean;
  firstName?: string;
  lastName?: string;
  username?: string;

  identities: Record<string, any>; //Allow more properties
  prefferedID: string;
}

export interface Owner {
  avatar_url?: string;
  id: string;
  name?: string;
  type: UserType;
  username: string;
}

export interface DropFile {
  file: File;
  preview: string;
}

export type CollectionSource = 'owner' | 'collaborator' | 'organization';
export type CollectionType = 'repos' | 'content' | 'organizations';

export type UserType = 'user' | 'organization';

export interface NavigateToPathParams {
  org?: Organization;
  repo?: Repository;
  path?: string;
}

export interface Repository {
  name: string;
  id: string;
  description?: string | null;
  default_branch: string;
  owner: {
    username: string;

    [x: string]: any;
  };
  path: string;
  writePermission?: boolean;

  [x: string]: any;
}

export interface Content {
  name: string;
  nameHighlight?: HighlightParts[];
  path: string;
  id?: string;
  type?: 'file' | 'folder' | 'dir';

  [x: string]: any;
}

export interface HighlightParts {
  highlight: boolean;
  text: string;
}

export interface Organization extends Owner {
  avatar_url?: string;

  [x: string]: any;
}

export interface PublicRepository extends Owner {
  provider: string;
  uuid: string;
}

export interface SearchResults {
  results: SearchResultsBlobs[] | Content[];
  searchType: string;
}

export interface SearchResultsBlobs extends Content {
  owner: User;
  repository: Repository;
  score?: number;
  text_matches: any[];
}

export interface MessageDialog {
  open: boolean;
  closable?: boolean;
  fullWidth?: boolean;
  labelCancelButton?: string;
  labelConfirmButton?: string;
  maxWidth?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  message?: string;
  onCancel?: () => void;
  onClose?: () => void;
  onConfirm?: () => void;
  progress?: boolean;
  title?: string;
}

export interface AlertDialog {
  open: boolean;
  message?: string;
  onClose?: () => void;
  type?: 'error' | 'info' | 'success' | 'warning';
}

export interface Submit {
  action: SubmitAction;
  resource: Resource;
}

export type SubmitAction = 'load' | 'save';

export interface FetchDocumentParams {
  filename?: string;
  path: string;
  repo?: Repository;
}

export interface GetFileLatestHashParams {
  filename: string;
  path: string[];
  repository: Repository;
  owner: Owner;
}
