import fs from 'fs/promises';
import path from 'path';
import { isExistingProjectFolder } from './projectTypes';

export class MoveEntityDbError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoveEntityDbError';
  }
}

/**
 * Top-level names owned by the entity database; refuse move if any already
 * exist at dest. Authority packs/databases are deliberately NOT here - they
 * live in the local (non-synced) app-data folder, not the entity database
 * folder, so they never travel with a Move and are never mistaken for
 * pre-existing entity-db content at the destination. See
 * getLocalAuthorityAssetsDir in projectPrefs.ts.
 */
export const ENTITY_DB_RESERVED_NAMES = [
  'entities.xml',
  'user-id.txt',
  'entity-orders.jsonl',
  'achievements.json',
  'source-profiles.json',
  '.grognard-time-machine',
] as const;

const normalizeFolder = (folder: string): string =>
  path.resolve(folder.trim().replace(/[/\\]+$/, ''));

const isPathInside = (child: string, parent: string): boolean => {
  const rel = path.relative(parent, child);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
};

const assertSourceHasEntities = async (source: string): Promise<void> => {
  try {
    await fs.access(path.join(source, 'entities.xml'));
  } catch {
    throw new MoveEntityDbError(
      'The current entity database folder does not contain entities.xml.',
    );
  }
};

const assertNotProjectFolder = async (folder: string): Promise<void> => {
  if (await isExistingProjectFolder(folder)) {
    throw new MoveEntityDbError('That folder is a Grognard project. Choose a different folder.');
  }
};

const findReservedCollisions = async (destDir: string): Promise<string[]> => {
  let entries: string[];
  try {
    entries = await fs.readdir(destDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const reserved = new Set<string>(ENTITY_DB_RESERVED_NAMES);
  return entries.filter((entry) => reserved.has(entry));
};

const validateMovePaths = async (source: string, dest: string): Promise<void> => {
  const normalizedSource = normalizeFolder(source);
  const normalizedDest = normalizeFolder(dest);

  if (normalizedSource === normalizedDest) {
    throw new MoveEntityDbError('Source and destination are the same folder.');
  }

  try {
    const stat = await fs.stat(normalizedSource);
    if (!stat.isDirectory()) {
      throw new MoveEntityDbError('The current entity database path is not a folder.');
    }
  } catch (error) {
    if (error instanceof MoveEntityDbError) throw error;
    throw new MoveEntityDbError('The current entity database folder does not exist.');
  }

  await assertSourceHasEntities(normalizedSource);
  await assertNotProjectFolder(normalizedDest);

  if (isPathInside(normalizedDest, normalizedSource)) {
    throw new MoveEntityDbError(
      'The destination cannot be inside the current entity database folder.',
    );
  }
  if (isPathInside(normalizedSource, normalizedDest)) {
    throw new MoveEntityDbError(
      'The current entity database folder cannot be moved inside itself.',
    );
  }

  try {
    await fs.access(path.join(normalizedDest, 'entities.xml'));
    throw new MoveEntityDbError(
      'That folder already contains an entity database (entities.xml). Choose an empty folder or one without entities.xml.',
    );
  } catch (error) {
    if (error instanceof MoveEntityDbError) throw error;
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  const collisions = await findReservedCollisions(normalizedDest);
  if (collisions.length > 0) {
    throw new MoveEntityDbError(
      `The destination folder already contains entity-database files (${collisions.join(', ')}). Choose a different folder.`,
    );
  }
};

/**
 * Relocate the entire entity database folder to a new path (rename or copy+delete).
 * On failure the source folder is left intact; a newly created destination is removed.
 */
export async function moveEntityDbFolder(source: string, dest: string): Promise<void> {
  const normalizedSource = normalizeFolder(source);
  const normalizedDest = normalizeFolder(dest);
  await validateMovePaths(normalizedSource, normalizedDest);

  let destExisted = false;
  try {
    await fs.access(normalizedDest);
    destExisted = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  if (!destExisted) {
    try {
      await fs.rename(normalizedSource, normalizedDest);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
    }
  }

  const createdDest = !destExisted;
  try {
    await fs.cp(normalizedSource, normalizedDest, { recursive: true, force: false });
    await fs.access(path.join(normalizedDest, 'entities.xml'));
    await fs.rm(normalizedSource, { recursive: true, force: true });
  } catch (error) {
    if (createdDest) {
      await fs.rm(normalizedDest, { recursive: true, force: true }).catch(() => undefined);
    }
    if (error instanceof MoveEntityDbError) throw error;
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new MoveEntityDbError('Move failed: entities.xml not found at destination.');
    }
    throw error;
  }
}
