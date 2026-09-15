import fs from 'fs/promises';
import path from 'path';
import {
  ENTITY_KINDS,
  parseIsoYear,
  type EntityKind,
} from '../../../../packages/cwrc-leafwriter/src/autoTagging/entities';
import {
  EntitySqliteRepository,
  type SqliteEntityPanelSummary,
} from '../../../desktop/src/entityDbSqlite/repository';

/**
 * Raw, un-localized precision marker exactly as entityOps.ts's
 * `setUserEntityDate`/`DatePrecision` stores it (`'b.'`, `'b. ca.'`, `'fl.'`,
 * `'d.'`, `'d. ca.'`, `'active'`, `'active ca.'`, `'active to'`,
 * `'active to ca.'`, or null). Left as the stored string rather than a typed
 * enum here — display-side localization (English vs. other languages) is the
 * client's job, not this read layer's.
 */
export interface EntityDates {
  startYear: number | null;
  endYear: number | null;
  startPrecision: string | null;
  endPrecision: string | null;
}

export interface EntitySummary {
  id: string;
  kind: EntityKind;
  /** All name/title rows found on the entity, in database order. */
  names: { lang: string | null; text: string }[];
  primaryName: string | null;
  romanizedName: string | null;
  description: string | null;
  dates: EntityDates | null;
  familyName: string | null;
  authorityIds: { type: string | null; value: string }[];
}

const stripDiacritics = (value: string): string =>
  value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/** Diacritic-, case-, and space-insensitive, per the candidate window's search rules. */
const normalizeForSearch = (value: string): string =>
  stripDiacritics(value).toLowerCase().replace(/\s+/g, '');

export const ALL_ENTITY_KINDS = Object.keys(ENTITY_KINDS) as EntityKind[];

export const isEntityKind = (value: string): value is EntityKind =>
  (ALL_ENTITY_KINDS as string[]).includes(value);

export class ProjectEntitiesUnavailableError extends Error {}

const fileExists = async (filePath: string): Promise<boolean> => {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
};

const datesFromSqlitePanel = (panel: SqliteEntityPanelSummary): EntityDates | null => {
  if (panel.kind === 'work' && panel.workDate) {
    const { startYear, endYear, startPrecision, endPrecision } = panel.workDate;
    if (startYear == null && endYear == null) return null;
    return { startYear, endYear, startPrecision, endPrecision };
  }

  const birth = panel.assertions.find(
    (assertion) => assertion.element === 'birth' && assertion.status === 'active',
  );
  const death = panel.assertions.find(
    (assertion) => assertion.element === 'death' && assertion.status === 'active',
  );
  if (birth || death) {
    return {
      startYear: panel.startYear,
      endYear: panel.endYear,
      startPrecision: birth?.precision ?? null,
      endPrecision: death?.precision ?? null,
    };
  }

  const datesNote = panel.assertions.find(
    (assertion) =>
      assertion.element === 'note' &&
      assertion.noteType === 'dates' &&
      assertion.status === 'active',
  );
  if (datesNote?.value) {
    const parts = datesNote.value.trim().split('/');
    const startYear = parseIsoYear(parts[0]);
    const endYear = parseIsoYear(parts[1]);
    if (startYear != null || endYear != null) {
      return {
        startYear,
        endYear,
        startPrecision: datesNote.precision ?? null,
        endPrecision: null,
      };
    }
  }

  if (panel.startYear == null && panel.endYear == null) return null;
  return {
    startYear: panel.startYear,
    endYear: panel.endYear,
    startPrecision: null,
    endPrecision: null,
  };
};

const summaryFromSqlitePanel = (
  panel: SqliteEntityPanelSummary,
  kind: EntityKind,
): EntitySummary => {
  const activeNames = panel.names.filter((name) => name.status === 'active');
  const primary =
    activeNames.find((name) => name.nameType === 'primary' || name.nameRole === 'primary') ??
    activeNames[0];
  const romanized = activeNames.find((name) => (name.language ?? '').endsWith('-Latn'));
  return {
    id: panel.id,
    kind,
    names: activeNames.map((name) => ({ lang: name.language, text: name.text })),
    primaryName: primary?.text ?? null,
    romanizedName: romanized?.text ?? null,
    description: panel.description,
    dates: datesFromSqlitePanel(panel),
    familyName: panel.familyName,
    authorityIds: panel.authorities.map((authority) => ({
      type: authority.type,
      value: authority.value,
    })),
  };
};

interface SqliteRoot {
  root: string;
  repository: EntitySqliteRepository;
}

const openSqliteRoot = async (root: string): Promise<SqliteRoot | null> => {
  const sqlitePath = path.join(root, 'entities.sqlite');
  if (!(await fileExists(sqlitePath))) return null;
  try {
    return { root, repository: await EntitySqliteRepository.open(sqlitePath) };
  } catch {
    return null;
  }
};

const closeRoots = async (sources: SqliteRoot[]): Promise<void> => {
  for (const source of sources) {
    try {
      await source.repository.close();
    } catch {
      // Best-effort close after the request finishes.
    }
  }
};

/**
 * Opens whichever of `roots` have an `entities.sqlite`. Roots without SQLite
 * are skipped — a project not being open, or the central database not yet
 * existing, are normal states here, not errors. Sibling `entities.xml` is
 * ignored (interchange only; not a live authority).
 */
const readAvailableSqliteRoots = async (roots: string[]): Promise<SqliteRoot[]> => {
  const sources: SqliteRoot[] = [];
  for (const root of roots) {
    const source = await openSqliteRoot(root);
    if (source) sources.push(source);
  }
  return sources;
};

export interface ProjectStatus {
  entitiesFound: boolean;
  databaseId: string | null;
}

/** Reports the first available root's info — `roots` is expected in priority order (project before central). */
export const readCombinedStatus = async (roots: string[]): Promise<ProjectStatus> => {
  const sources = await readAvailableSqliteRoots(roots);
  try {
    const [found] = sources;
    if (!found) return { entitiesFound: false, databaseId: null };
    return { entitiesFound: true, databaseId: await found.repository.getDatabaseId() };
  } finally {
    await closeRoots(sources);
  }
};

const entityMatchesNeedle = (summary: EntitySummary, needle: string): boolean => {
  if (!needle) return true;
  const haystack = [...summary.names.map((n) => n.text), summary.description ?? '']
    .map(normalizeForSearch)
    .join(' ');
  return haystack.includes(needle);
};

/** Searches every available root (project + central), de-duplicating by id — an entity synced to both isn't shown twice. */
export const searchEntities = async (
  roots: string[],
  query: string,
  kinds: EntityKind[],
  limit: number,
): Promise<EntitySummary[]> => {
  const sources = await readAvailableSqliteRoots(roots);
  try {
    const needle = normalizeForSearch(query);
    const out: EntitySummary[] = [];
    const seenIds = new Set<string>();

    for (const source of sources) {
      for (const kind of kinds) {
        for (const panel of await source.repository.listPanelSummaries(kind)) {
          if (seenIds.has(panel.id)) continue;
          const summary = summaryFromSqlitePanel(panel, kind);
          if (!entityMatchesNeedle(summary, needle)) continue;
          seenIds.add(summary.id);
          out.push(summary);
          if (out.length >= limit) return out;
        }
      }
    }
    return out;
  } finally {
    await closeRoots(sources);
  }
};

/** Checks every available root (project + central) for a matching id — project takes priority on order. */
export const getEntityById = async (roots: string[], id: string): Promise<EntitySummary | null> => {
  const sources = await readAvailableSqliteRoots(roots);
  try {
    for (const source of sources) {
      const panel = await source.repository.getPanelSummary(id);
      if (!panel) continue;
      return summaryFromSqlitePanel(panel, panel.kind as EntityKind);
    }
    return null;
  } finally {
    await closeRoots(sources);
  }
};
