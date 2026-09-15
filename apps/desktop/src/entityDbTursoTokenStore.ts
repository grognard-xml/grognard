/**
 * Encrypted, per-database storage for a collaborator's own Turso auth token.
 *
 * Mirrors entitySyncAuthSecret.ts / entityDbBackupConfig.ts — Electron
 * `safeStorage`, OS keychain-backed — but keyed by the project's PEDB url
 * (`ProjectFileConfig.pedb.url`, not secret) rather than a single global
 * token, since one machine may work on several different Turso-backed
 * projects over time, each needing its own token. The token itself is
 * never written to the shared, git-synced project file.
 */
import { app, safeStorage } from 'electron';
import { createHash } from 'crypto';
import fs from 'fs/promises';
import path from 'path';

const filenameForUrl = (url: string): string => {
  const digest = createHash('sha256').update(url).digest('hex').slice(0, 16);
  return `entity-db-turso-token-${digest}.enc`;
};

const getPath = (url: string): string => path.join(app.getPath('userData'), filenameForUrl(url));

export const isTursoTokenStorageAvailable = (): boolean => {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
};

export const readTursoAuthToken = async (url: string): Promise<string | null> => {
  let ciphertext: Buffer;
  try {
    ciphertext = await fs.readFile(getPath(url));
  } catch {
    return null;
  }
  if (!isTursoTokenStorageAvailable()) return null;
  try {
    return safeStorage.decryptString(ciphertext) || null;
  } catch {
    return null;
  }
};

export const hasTursoAuthToken = async (url: string): Promise<boolean> =>
  (await readTursoAuthToken(url)) !== null;

/** `null`/`''` clears the stored token for this url; any other string replaces it. */
export const writeTursoAuthToken = async (url: string, token: string | null): Promise<void> => {
  const filePath = getPath(url);
  if (!token) {
    await fs.rm(filePath, { force: true });
    return;
  }
  if (!isTursoTokenStorageAvailable()) {
    throw new Error(
      'Cannot store the Turso auth token: this OS session has no keychain/keyring for encrypted storage.',
    );
  }
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(`${filePath}.tmp`, safeStorage.encryptString(token));
  await fs.rename(`${filePath}.tmp`, filePath);
};
