import { joinPath } from './pathJoin';

export type EntityStoreMode = 'central' | 'project';

/**
 * Where a **project**'s PEDB lives — mirrors ProjectFileConfig.pedb in
 * apps/desktop/src/projectTypes.ts (duplicated rather than imported: this
 * package doesn't depend on the desktop app). Never applies to central
 * mode — a scholar's personal CEDB is always local, never shared.
 */
export type EntityStorePedb = { backend: 'local' } | { backend: 'turso'; url: string };

export interface EntityStorePaths {
  mode: EntityStoreMode;
  entitiesPath: string;
  projectGrognardDir: string;
  projectRoot: string;
  centralFolder: string | null;
  /** Set only in project mode, only when the project declares a non-local PEDB. */
  pedb?: EntityStorePedb;
}

export interface EntityStoreResolveInput {
  projectRoot: string;
  entityStore?: EntityStoreMode;
  centralFolder?: string | null;
  pedb?: EntityStorePedb;
}

/** Resolve entity database and project hidden infra paths. */
export function resolveEntityStorePaths(input: EntityStoreResolveInput): EntityStorePaths {
  const mode: EntityStoreMode = input.entityStore === 'central' ? 'central' : 'project';
  const projectRoot = input.projectRoot.replace(/[/\\]+$/, '');
  const projectGrognardDir = joinPath(projectRoot, '.grognard');

  if (mode === 'project') {
    return {
      mode,
      entitiesPath: joinPath(projectRoot, 'entities.xml'),
      projectGrognardDir,
      projectRoot,
      centralFolder: null,
      pedb: input.pedb,
    };
  }

  const centralFolder = input.centralFolder?.trim() || null;
  if (!centralFolder) {
    throw new Error('Central entity database folder is not configured.');
  }

  return {
    mode,
    entitiesPath: joinPath(centralFolder, 'entities.xml'),
    projectGrognardDir,
    projectRoot,
    centralFolder,
  };
}
