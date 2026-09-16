import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { writeFileAtomic } from './atomicWrite';
import { createEntitiesScaffold } from '../../../packages/cwrc-leafwriter/src/autoTagging/entities';
import { importEntitySqliteXml } from './entityDbSqlite/readService';

import {
  DEFAULT_METADATA_PATH,
  resolveProjectFileName,
  type AutoTaggingAuthoritySettings,
  type AutoTaggingValidationSettings,
  type DisambiguationSettings,
  type ProjectBundle,
  type ProjectFileConfig,
  type ProjectSchemaConfig,
} from './projectTypes';

export {
  DEFAULT_METADATA_PATH,
  PROJECT_FILE_NAME,
  LEGACY_PROJECT_FILE_NAME,
  resolveProjectFileName,
  isExistingProjectFolder,
  type ProjectBundle,
  type ProjectFileConfig,
  type ProjectMetadataFile,
  type ProjectSchemaConfig,
} from './projectTypes';

export const resolveProjectPath = (rootPath: string, relativePath: string): string => {
  if (path.isAbsolute(relativePath)) throw new Error('Project paths must be relative.');
  const resolvedRoot = path.resolve(rootPath);
  const resolved = path.resolve(resolvedRoot, relativePath);
  const relative = path.relative(resolvedRoot, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Project path escapes the project directory.');
  }
  return resolved;
};

const normalizeAutoTaggingAuthority = (raw: unknown): AutoTaggingAuthoritySettings | undefined => {
  if (!raw || typeof raw !== 'object') return undefined;
  const value = raw as AutoTaggingAuthoritySettings;
  const packs = Array.isArray(value.packs)
    ? value.packs.filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
    : undefined;
  const yearStart = typeof value.yearStart === 'number' ? value.yearStart : undefined;
  const yearEnd = typeof value.yearEnd === 'number' ? value.yearEnd : undefined;
  const out: AutoTaggingAuthoritySettings = {};
  if (packs?.length) out.packs = packs;
  if (
    value.dateFilter === 'none' ||
    value.dateFilter === 'limit' ||
    value.dateFilter === 'exclude'
  ) {
    out.dateFilter = value.dateFilter;
  }
  if (typeof value.yearFilterEnabled === 'boolean') out.yearFilterEnabled = value.yearFilterEnabled;
  if (yearStart != null) out.yearStart = yearStart;
  if (yearEnd != null) out.yearEnd = yearEnd;
  if (typeof value.hideUndated === 'boolean') out.hideUndated = value.hideUndated;
  if (Array.isArray(value.excludedNameTypes)) {
    out.excludedNameTypes = value.excludedNameTypes.filter(
      (entry): entry is string => typeof entry === 'string' && entry.trim().length > 0,
    );
  }
  if (value.nameTypeTaggingPolicy && typeof value.nameTypeTaggingPolicy === 'object') {
    const policy: Record<string, 'phase1' | 'phase2' | 'never'> = {};
    for (const [key, bucket] of Object.entries(value.nameTypeTaggingPolicy)) {
      if (bucket === 'phase1' || bucket === 'phase2' || bucket === 'never') {
        policy[key] = bucket;
      }
    }
    if (Object.keys(policy).length > 0) out.nameTypeTaggingPolicy = policy;
  }
  if (Array.isArray(value.customNameTypes)) {
    out.customNameTypes = value.customNameTypes.filter(
      (entry): entry is NonNullable<AutoTaggingAuthoritySettings['customNameTypes']>[number] =>
        !!entry &&
        typeof entry === 'object' &&
        typeof entry.id === 'string' &&
        typeof entry.label === 'string' &&
        (entry.bucket === 'phase1' || entry.bucket === 'phase2' || entry.bucket === 'never'),
    );
  }
  if (Array.isArray(value.customThingTypes)) {
    out.customThingTypes = value.customThingTypes.filter(
      (entry): entry is NonNullable<AutoTaggingAuthoritySettings['customThingTypes']>[number] =>
        !!entry &&
        typeof entry === 'object' &&
        typeof entry.id === 'string' &&
        typeof entry.label === 'string',
    );
  }
  if (typeof value.artMinCodePoints === 'number' && value.artMinCodePoints > 0) {
    out.artMinCodePoints = value.artMinCodePoints;
  }
  if (typeof value.showPackStringCounts === 'boolean') {
    out.showPackStringCounts = value.showPackStringCounts;
  }
  if (typeof value.matchAcrossLineBreaks === 'boolean') {
    out.matchAcrossLineBreaks = value.matchAcrossLineBreaks;
  }
  return Object.keys(out).length ? out : undefined;
};

const normalizeDisambiguationSettings = (raw: unknown): DisambiguationSettings | undefined => {
  if (!raw || typeof raw !== 'object') return undefined;
  const value = raw as DisambiguationSettings;
  const out: DisambiguationSettings = {};
  if (typeof value.aiCuration === 'boolean') out.aiCuration = value.aiCuration;
  if (typeof value.disableCaching === 'boolean') out.disableCaching = value.disableCaching;
  if (
    value.dateFilter === 'none' ||
    value.dateFilter === 'limit' ||
    value.dateFilter === 'exclude'
  ) {
    out.dateFilter = value.dateFilter;
  }
  if (typeof value.yearStart === 'number') out.yearStart = value.yearStart;
  if (typeof value.yearEnd === 'number') out.yearEnd = value.yearEnd;
  if (typeof value.placeProximityKm === 'number' && Number.isFinite(value.placeProximityKm)) {
    out.placeProximityKm = value.placeProximityKm;
  }
  return Object.keys(out).length ? out : undefined;
};

const normalizeAutoTaggingValidation = (
  raw: unknown,
): AutoTaggingValidationSettings | undefined => {
  if (!raw || typeof raw !== 'object') return undefined;
  const value = raw as AutoTaggingValidationSettings;
  const out: AutoTaggingValidationSettings = {};
  if (typeof value.aiValidation === 'boolean') out.aiValidation = value.aiValidation;
  if (typeof value.autoAcceptThreshold === 'number') {
    out.autoAcceptThreshold = value.autoAcceptThreshold;
  }
  if (typeof value.curateRejectBelow === 'number') {
    out.curateRejectBelow = value.curateRejectBelow;
  }
  return Object.keys(out).length ? out : undefined;
};

const normalizePlugins = (raw: unknown): string[] | undefined => {
  if (!Array.isArray(raw)) return undefined;
  const plugins = [
    ...new Set(raw.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)),
  ];
  return plugins.length ? plugins : undefined;
};

const normalizePedb = (raw: unknown): ProjectFileConfig['pedb'] => {
  if (!raw || typeof raw !== 'object') return undefined;
  const value = raw as { backend?: unknown; url?: unknown };
  if (value.backend === 'turso' && typeof value.url === 'string' && value.url.trim()) {
    return { backend: 'turso', url: value.url.trim() };
  }
  if (value.backend === 'local') return { backend: 'local' };
  return undefined;
};

const normalizeConfig = (raw: Partial<ProjectFileConfig>, rootPath: string): ProjectFileConfig => ({
  version: 1,
  name: typeof raw.name === 'string' && raw.name.trim() ? raw.name : path.basename(rootPath),
  projectId:
    typeof raw.projectId === 'string' && raw.projectId.trim() ? raw.projectId.trim() : undefined,
  schema:
    raw.schema && typeof raw.schema.rng === 'string' && raw.schema.rng.trim()
      ? { ...raw.schema, rng: raw.schema.rng.trim() }
      : undefined,
  metadata:
    typeof raw.metadata === 'string' && raw.metadata.trim()
      ? raw.metadata.trim()
      : DEFAULT_METADATA_PATH,
  syncToCentral: typeof raw.syncToCentral === 'boolean' ? raw.syncToCentral : undefined,
  entityDatabaseId:
    typeof raw.entityDatabaseId === 'string' && raw.entityDatabaseId.trim()
      ? raw.entityDatabaseId.trim()
      : undefined,
  autoTaggingAuthority: normalizeAutoTaggingAuthority(raw.autoTaggingAuthority),
  autoTaggingValidation: normalizeAutoTaggingValidation(raw.autoTaggingValidation),
  disambiguation: normalizeDisambiguationSettings(raw.disambiguation),
  plugins: normalizePlugins(raw.plugins),
  pedb: normalizePedb(raw.pedb),
});

const writeConfigFile = async (
  projectFilePath: string,
  config: ProjectFileConfig,
): Promise<void> => {
  await writeFileAtomic(projectFilePath, JSON.stringify(config, null, 2));
};

/**
 * Serialize read-modify-write per project file so concurrent patches (e.g. an
 * auto-tagging crawl touching several files, each patching entityDatabaseId or
 * authority/disambiguation settings) cannot clobber each other's fields —
 * same race `mutateAppPrefs` guards against in projectPrefs.ts.
 */
const projectConfigWriteChains = new Map<string, Promise<unknown>>();

export const writeProjectConfig = async (
  projectFilePath: string,
  patch: Partial<ProjectFileConfig>,
): Promise<ProjectBundle> => {
  const rootPath = path.dirname(projectFilePath);
  const previous = projectConfigWriteChains.get(projectFilePath) ?? Promise.resolve();
  const next = previous.then(async () => {
    const raw = JSON.parse(
      await fs.readFile(projectFilePath, 'utf-8'),
    ) as Partial<ProjectFileConfig>;
    const config = normalizeConfig({ ...raw, ...patch }, rootPath);
    await writeConfigFile(projectFilePath, config);
    return { rootPath, projectFilePath, config };
  });
  projectConfigWriteChains.set(
    projectFilePath,
    next.catch(() => undefined),
  );
  return next;
};

const detectSchema = async (rootPath: string): Promise<ProjectSchemaConfig | undefined> => {
  const schemaDir = path.join(rootPath, 'schema');

  try {
    const entries = await fs.readdir(schemaDir, { withFileTypes: true });
    const rng = entries.find((entry) => !entry.isDirectory() && /\.rng$/i.test(entry.name));
    if (rng) {
      const css = entries.find(
        (entry) =>
          !entry.isDirectory() &&
          /\.css$/i.test(entry.name) &&
          entry.name.startsWith(rng.name.replace(/\.rng$/i, '')),
      );
      return {
        rng: `schema/${rng.name}`,
        css: css ? `schema/${css.name}` : undefined,
      };
    }

    const rnc = entries.find((entry) => !entry.isDirectory() && /\.rnc$/i.test(entry.name));
    if (rnc) {
      const rngName = rnc.name.replace(/\.rnc$/i, '.rng');
      const hasRng = entries.some((entry) => entry.name === rngName);
      return {
        rng: `schema/${hasRng ? rngName : rnc.name}`,
        css: entries.find((e) => e.name === 'cbeta.css') ? 'schema/cbeta.css' : undefined,
      };
    }
  } catch {
    // no schema directory
  }

  return undefined;
};

/**
 * A project's live entity database (entities.xml + entities.sqlite) lives
 * directly in the project root — see resolveEntityStorePaths's 'project'
 * mode in packages/cwrc-leafwriter/src/autoTagging/entityStoreResolve.ts,
 * which every EntityStore consumer defaults to unless a caller explicitly
 * asks for the separate central/personal database. Nothing used to scaffold
 * these files for a brand-new project, so lookup/disambiguation failed with
 * "Entity database is not migrated to SQLite" the first time a new project
 * touched them. Idempotent (checks entities.xml first) so it is also safe to
 * call for existing projects that predate this fix.
 */
const ensureProjectEntityDatabase = async (
  rootPath: string,
  config: ProjectFileConfig,
): Promise<void> => {
  const entitiesXmlPath = path.join(rootPath, 'entities.xml');
  try {
    await fs.access(entitiesXmlPath);
    return;
  } catch {
    // fall through and scaffold below
  }

  // Never let a scaffold failure (e.g. a read-only project folder) block
  // project load/restore entirely — callers propagate this as a bundle-load
  // failure otherwise, which is a much worse outcome than a missing database
  // that Settings > Entity database can still recover from later.
  try {
    const scaffold = createEntitiesScaffold();
    await writeFileAtomic(entitiesXmlPath, scaffold);
    // A Turso-backed project's live database is remote, not this local
    // file — scaffolding a local entities.sqlite here would just be a
    // stray, never-used file. Its schema is created lazily on first real
    // open instead (EntitySqliteRepository.open() always runs migrations).
    // entities.xml is still minted either way, as interchange/export scaffold.
    if (config.pedb?.backend !== 'turso') {
      await importEntitySqliteXml({
        databasePath: path.join(rootPath, 'entities.sqlite'),
        xml: scaffold,
      });
    }
  } catch (error) {
    console.error(`[project] Failed to scaffold entity database in ${rootPath}:`, error);
  }
};

export const loadOrCreateProject = async (rootPath: string): Promise<ProjectBundle> => {
  const projectFilePath = path.join(rootPath, await resolveProjectFileName(rootPath));

  let raw: string;
  try {
    raw = await fs.readFile(projectFilePath, 'utf-8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    const config: ProjectFileConfig = {
      version: 1,
      name: path.basename(rootPath),
      projectId: randomUUID(),
      schema: await detectSchema(rootPath),
      metadata: DEFAULT_METADATA_PATH,
    };
    await writeConfigFile(projectFilePath, config);
    await ensureProjectEntityDatabase(rootPath, config);
    return { rootPath, projectFilePath, config };
  }

  const parsed = JSON.parse(raw) as Partial<ProjectFileConfig>;
  const config = normalizeConfig(parsed, rootPath);
  let dirty = false;
  if (!config.projectId) {
    config.projectId = randomUUID();
    dirty = true;
  }
  if (!config.schema) {
    config.schema = await detectSchema(rootPath);
    dirty = true;
  }
  if (dirty) await writeConfigFile(projectFilePath, config);
  await ensureProjectEntityDatabase(rootPath, config);
  return { rootPath, projectFilePath, config };
};

export const loadProjectFile = async (projectFilePath: string): Promise<ProjectBundle | null> => {
  try {
    const stat = await fs.stat(projectFilePath);
    if (!stat.isFile()) return null;

    const rootPath = path.dirname(projectFilePath);
    const raw = await fs.readFile(projectFilePath, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<ProjectFileConfig>;
    const config = normalizeConfig(parsed, rootPath);
    let dirty = false;

    if (!config.projectId) {
      config.projectId = randomUUID();
      dirty = true;
    }

    if (config.schema?.rng) {
      try {
        await fs.stat(resolveProjectPath(rootPath, config.schema.rng));
      } catch {
        config.schema = await detectSchema(rootPath);
        dirty = true;
      }
    } else {
      config.schema = await detectSchema(rootPath);
      dirty = true;
    }

    if (dirty) await writeConfigFile(projectFilePath, config);
    await ensureProjectEntityDatabase(rootPath, config);

    return { rootPath, projectFilePath, config };
  } catch {
    return null;
  }
};
