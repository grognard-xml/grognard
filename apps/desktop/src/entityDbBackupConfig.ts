/**
 * Persisted configuration for the entity-database cloud backup.
 *
 * The R2 secret access key is a write credential, so unlike the LLM API key
 * (which sits in plaintext in project-prefs.json) the whole config blob is
 * encrypted at rest with Electron's `safeStorage` — OS keychain on macOS,
 * libsecret/kwallet on Linux, DPAPI on Windows. The ciphertext lives in a
 * dedicated file under userData; nothing sensitive touches the prefs file.
 */
import { app, safeStorage } from 'electron';
import fs from 'fs/promises';
import path from 'path';
import type { R2Config } from './r2Client';

export interface EntityDbBackupConfig {
  enabled: boolean;
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  /** Key prefix inside the bucket. Always ends with a slash. */
  prefix: string;
  intervalMinutes: number;
}

/** Safe to send to the renderer: proves a secret is set without revealing it. */
export interface EntityDbBackupConfigView {
  enabled: boolean;
  endpoint: string;
  accessKeyId: string;
  bucket: string;
  prefix: string;
  intervalMinutes: number;
  hasSecret: boolean;
  encryptionAvailable: boolean;
  /**
   * Credentials are stored but could not be decrypted — typically an OS
   * keychain prompt that was dismissed or could not be satisfied. Distinct from
   * "never configured", which leaves every field blank too but is not a fault.
   */
  credentialsLocked: boolean;
}

const CONFIG_FILENAME = 'entity-db-backup-config.enc';
const MIN_INTERVAL_MINUTES = 5;
const MAX_INTERVAL_MINUTES = 24 * 60;
const DEFAULT_INTERVAL_MINUTES = 15;
const DEFAULT_PREFIX = 'entity-db-backups/';

const getConfigPath = () => path.join(app.getPath('userData'), CONFIG_FILENAME);

const normalizePrefix = (value: string): string => {
  const trimmed = value.trim().replace(/^\/+/, '');
  if (!trimmed) return DEFAULT_PREFIX;
  return trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
};

const clampInterval = (value: unknown): number => {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : NaN;
  if (Number.isNaN(n)) return DEFAULT_INTERVAL_MINUTES;
  return Math.min(MAX_INTERVAL_MINUTES, Math.max(MIN_INTERVAL_MINUTES, n));
};

const sanitize = (value: Partial<EntityDbBackupConfig> | undefined): EntityDbBackupConfig => ({
  enabled: value?.enabled === true,
  endpoint: typeof value?.endpoint === 'string' ? value.endpoint.trim().replace(/\/$/, '') : '',
  accessKeyId: typeof value?.accessKeyId === 'string' ? value.accessKeyId.trim() : '',
  secretAccessKey: typeof value?.secretAccessKey === 'string' ? value.secretAccessKey : '',
  bucket: typeof value?.bucket === 'string' ? value.bucket.trim() : '',
  prefix: normalizePrefix(typeof value?.prefix === 'string' ? value.prefix : ''),
  intervalMinutes: clampInterval(value?.intervalMinutes),
});

export const isBackupEncryptionAvailable = (): boolean => {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
};

/** True once a backup config has ever been saved. A plain file check —
 * doesn't touch `safeStorage`, so it's safe to call before the keychain
 * should be involved at all (e.g. an unconfigured, freshly installed app). */
const hasStoredBackupConfig = async (): Promise<boolean> => {
  try {
    await fs.access(getConfigPath());
    return true;
  } catch {
    return false;
  }
};

/** Full config including the secret. Main-process only — never hand this to a renderer. */
export const readBackupConfig = async (): Promise<EntityDbBackupConfig | null> => {
  let ciphertext: Buffer;
  try {
    ciphertext = await fs.readFile(getConfigPath());
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  if (!isBackupEncryptionAvailable()) {
    throw new Error(
      'Backup credentials are encrypted but this OS session cannot decrypt them ' +
        '(no keychain/keyring available).',
    );
  }
  try {
    const json = safeStorage.decryptString(ciphertext);
    return sanitize(JSON.parse(json) as Partial<EntityDbBackupConfig>);
  } catch (error) {
    throw new Error(
      `Could not read entity-database backup config: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error },
    );
  }
};

export const readBackupConfigView = async (): Promise<EntityDbBackupConfigView> => {
  // Nothing has ever been saved: don't probe safeStorage just to report
  // status on an unconfigured, freshly installed app — that's the one call
  // site this status check reaches on every launch, configured or not.
  const encryptionAvailable = (await hasStoredBackupConfig())
    ? isBackupEncryptionAvailable()
    : true;
  let config: EntityDbBackupConfig | null = null;
  let credentialsLocked = false;
  try {
    config = await readBackupConfig();
  } catch {
    // A decrypt failure still lets the panel render (with everything blank)
    // rather than throwing at it — but it must not look like "not configured":
    // `readBackupConfig` returns null for a missing file and only throws when a
    // file is there and unreadable, so reaching here means backups are silently
    // off until the keychain lets us in.
    credentialsLocked = true;
  }
  return {
    enabled: config?.enabled ?? false,
    endpoint: config?.endpoint ?? '',
    accessKeyId: config?.accessKeyId ?? '',
    bucket: config?.bucket ?? '',
    prefix: config?.prefix ?? DEFAULT_PREFIX,
    intervalMinutes: config?.intervalMinutes ?? DEFAULT_INTERVAL_MINUTES,
    hasSecret: Boolean(config?.secretAccessKey),
    encryptionAvailable,
    credentialsLocked,
  };
};

/**
 * Merge `patch` over the stored config and persist. A `secretAccessKey` of
 * `undefined` (or an omitted key) keeps the existing secret; pass an empty
 * string to clear it.
 */
export const writeBackupConfig = async (
  patch: Partial<EntityDbBackupConfig>,
): Promise<EntityDbBackupConfigView> => {
  if (!isBackupEncryptionAvailable()) {
    throw new Error(
      'Cannot save backup credentials: this OS session has no keychain/keyring for ' +
        'encrypted storage. On Linux, unlock a login keyring and restart.',
    );
  }
  const current = (await readBackupConfig().catch(() => null)) ?? sanitize(undefined);
  const merged = sanitize({
    ...current,
    ...patch,
    secretAccessKey:
      patch.secretAccessKey === undefined ? current.secretAccessKey : patch.secretAccessKey,
  });
  const ciphertext = safeStorage.encryptString(JSON.stringify(merged));
  const configPath = getConfigPath();
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(`${configPath}.tmp`, ciphertext);
  await fs.rename(`${configPath}.tmp`, configPath);
  return readBackupConfigView();
};

export const clearBackupConfig = async (): Promise<void> => {
  await fs.rm(getConfigPath(), { force: true });
};

export const toR2Config = (config: EntityDbBackupConfig): R2Config => ({
  endpoint: config.endpoint,
  accessKeyId: config.accessKeyId,
  secretAccessKey: config.secretAccessKey,
  bucket: config.bucket,
});

/** True when every field the uploader needs is present. */
export const isBackupConfigComplete = (
  config: EntityDbBackupConfig | null,
): config is EntityDbBackupConfig =>
  Boolean(
    config && config.endpoint && config.accessKeyId && config.secretAccessKey && config.bucket,
  );

export const backupConfigConstants = {
  MIN_INTERVAL_MINUTES,
  MAX_INTERVAL_MINUTES,
  DEFAULT_INTERVAL_MINUTES,
  DEFAULT_PREFIX,
};
