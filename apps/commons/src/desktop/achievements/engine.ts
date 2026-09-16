import i18next from 'i18next';
import { normalizePathKey } from '../infrastructurePaths';
import type { TagUsageStats } from '../tagging/tagStats';
import { findAchievementDef } from './definitions';
import {
  aggregateGlobalMetrics,
  determineNewRankUnlocks,
  determineNewUnlocks,
  documentRootLanguage,
  metricsFromTagStats,
  PRECAUTIONARY_MEASURES_THRESHOLD,
} from './evaluate';
import { fetchFlagOfCommitmentCount } from './githubContributions';
import { getProjectMetrics, loadAchievementsState, saveAchievementsState } from './store';
import type { AchievementsState } from './types';

export type AchievementUnlockNotifier = (message: string) => void;

/** Portrait committed in Service Record — unlocks persist before this, but do not toast. */
const hasCreatedCharacter = (state: AchievementsState): boolean => state.avatar != null;

const notifyUnlocks = (
  state: AchievementsState,
  ids: string[],
  notify: AchievementUnlockNotifier,
) => {
  if (!hasCreatedCharacter(state) || ids.length === 0) return;
  if (ids.length > 3) {
    notify(`🎖️ ${ids.length} achievements unlocked — see your Service Record`);
    return;
  }
  const locale: 'fr' | 'en' = i18next.language?.startsWith('fr') ? 'fr' : 'en';
  for (const id of ids) {
    const def = findAchievementDef(id, locale);
    if (def) notify(`🎖️ Achievement unlocked: ${def.name} — ${def.description}`);
  }
};

/**
 * Call once the player first commits a portrait. Medals earned while
 * `avatar` was still null are already in `state.unlocked`; this is when
 * their toast notifications are allowed to fire.
 */
export const deliverWaitingUnlockNotifications = (
  state: AchievementsState,
  notify: AchievementUnlockNotifier,
): void => {
  notifyUnlocks(state, Object.keys(state.unlocked), notify);
};

const applyUnlocks = (state: AchievementsState, ids: string[], at: string): string[] => {
  const applied = ids.filter((id) => !state.unlocked[id]);
  for (const id of applied) state.unlocked[id] = { at };
  return applied;
};

/** Unlock a one-off achievement from an event outside the document-save path. */
export const unlockAchievement = async (
  id: string,
  notify: AchievementUnlockNotifier,
): Promise<AchievementsState> => {
  const state = await loadAchievementsState();
  const applied = applyUnlocks(state, [id], new Date().toISOString());
  if (applied.length > 0) {
    await saveAchievementsState(state);
    notifyUnlocks(state, applied, notify);
  }
  return state;
};

/**
 * Count one Time Machine opening. Unlocks Precautionary measures at the
 * tenth run (see PRECAUTIONARY_MEASURES_THRESHOLD).
 */
export const recordTimeMachineRun = async (
  notify: AchievementUnlockNotifier,
): Promise<AchievementsState> => {
  const state = await loadAchievementsState();
  state.timeMachineRuns = (state.timeMachineRuns ?? 0) + 1;
  const at = new Date().toISOString();
  const applied =
    state.timeMachineRuns >= PRECAUTIONARY_MEASURES_THRESHOLD
      ? applyUnlocks(state, ['precautionary-measures'], at)
      : [];
  await saveAchievementsState(state);
  notifyUnlocks(state, applied, notify);
  return state;
};

export const localCalendarDay = (date: Date): string => {
  const year = String(date.getFullYear()).padStart(4, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const GITHUB_CONTRIBUTIONS_REFRESH_MS = 60 * 60 * 1000;

/**
 * Refreshes the Flag of Commitment count if it's missing or stale (opens of
 * the Service Record dialog call this, not the save path - it's a network
 * call and has no business slowing down every document save). No-ops
 * silently when there's no cached GitHub token (leaderboard not linked yet).
 */
export const refreshGithubContributions = async (
  notify: AchievementUnlockNotifier,
): Promise<AchievementsState> => {
  const state = await loadAchievementsState();
  const isStale =
    !state.githubContributions ||
    Date.now() - new Date(state.githubContributions.fetchedAt).getTime() >
      GITHUB_CONTRIBUTIONS_REFRESH_MS;
  if (!isStale) return state;

  const token = await window.electronAPI?.getCachedLeaderboardToken?.();
  if (!token) return state;

  const count = await fetchFlagOfCommitmentCount(token);
  if (count === null) return state;

  state.githubContributions = { count, fetchedAt: new Date().toISOString() };
  const applied = applyUnlocks(
    state,
    determineNewRankUnlocks(state, aggregateGlobalMetrics(state)),
    new Date().toISOString(),
  );
  await saveAchievementsState(state);
  notifyUnlocks(state, applied, notify);
  return state;
};

/** Record one successful leaderboard publication per local calendar day. */
export const recordLeaderboardPublication = async (
  publishedAt: Date,
  notify: AchievementUnlockNotifier,
): Promise<AchievementsState> => {
  const state = await loadAchievementsState();
  const day = localCalendarDay(publishedAt);
  if (state.leaderboardPublicationDays.includes(day)) return state;

  state.leaderboardPublicationDays.push(day);
  state.leaderboardPublicationDays.sort();
  const applied = applyUnlocks(
    state,
    determineNewRankUnlocks(state, aggregateGlobalMetrics(state)),
    publishedAt.toISOString(),
  );
  await saveAchievementsState(state);
  notifyUnlocks(state, applied, notify);
  return state;
};

const toRelativePath = (rootPath: string, filePath: string): string => {
  const normalizedRoot = normalizePathKey(rootPath).replace(/\/+$/, '');
  const normalizedFile = normalizePathKey(filePath);
  return normalizedFile.startsWith(`${normalizedRoot}/`)
    ? normalizedFile.slice(normalizedRoot.length + 1)
    : normalizedFile;
};

/** Count the live SQLite entity database at the project root or central folder. */
const countEntityDatabase = async (rootPath: string): Promise<number | null> => {
  const api = window.electronAPI;
  if (!api) return null;

  const root = rootPath.replace(/[/\\]+$/, '');
  const sqliteCandidates: string[] = [`${root}/entities.sqlite`];
  try {
    const central = await api.getEntityDbFolder();
    if (central) {
      const centralRoot = central.replace(/[/\\]+$/, '');
      sqliteCandidates.push(`${centralRoot}/entities.sqlite`);
    }
  } catch {
    // No central folder configured.
  }

  if (api.entitySqliteCountEntities) {
    for (const candidate of sqliteCandidates) {
      try {
        if (!(await api.pathExists(candidate))) continue;
        const count = await api.entitySqliteCountEntities({ databasePath: candidate });
        if (typeof count === 'number') return count;
      } catch {
        // Try the next candidate.
      }
    }
  }

  return null;
};

/** Serialize achievement writes so rapid Ctrl+S does not lose saveCount. */
let achievementsSaveQueue: Promise<void> = Promise.resolve();

/**
 * Fire-and-forget achievements pass, called after a successful document
 * save. Must never throw into the save pipeline.
 */
export const processSaveForAchievements = async (options: {
  rootPath: string;
  /**
   * Stable per-project id from the project file (grognard.project.json) (see
   * ProjectFileConfig.projectId). Falls back to the normalized root path
   * for callers that predate this field, but that fallback re-splits a
   * project's stats if it's later opened from a different absolute path
   * (e.g. a second machine) - always prefer passing the real id.
   */
  projectId?: string;
  filePath: string;
  xml: string;
  stats: TagUsageStats;
  sourceMode: boolean;
  notify: AchievementUnlockNotifier;
}): Promise<void> => {
  const run = async () => {
    try {
      const { rootPath, projectId, filePath, xml, stats, sourceMode, notify } = options;
      const state = await loadAchievementsState();
      const savedAt = new Date();

      state.saveCount += 1;
      if (sourceMode) state.sourceModeSaveCount = (state.sourceModeSaveCount ?? 0) + 1;

      const projectKey = projectId ?? normalizePathKey(rootPath);
      const project = getProjectMetrics(state, projectKey);

      const relativePath = toRelativePath(rootPath, filePath);
      if (!project.savedDocs.includes(relativePath)) project.savedDocs.push(relativePath);

      const docLanguage = documentRootLanguage(xml);
      if (docLanguage && !project.docLanguages.includes(docLanguage)) {
        project.docLanguages.push(docLanguage);
      }

      const tagMetrics = metricsFromTagStats(stats);
      project.tagsTotal = Math.max(project.tagsTotal, tagMetrics.tagsTotal);
      project.disambiguated = Math.max(project.disambiguated, tagMetrics.disambiguated);
      project.placesDisambiguated = Math.max(
        project.placesDisambiguated,
        tagMetrics.placesDisambiguated,
      );

      const entityCount = await countEntityDatabase(rootPath);
      if (entityCount != null) {
        project.entities = Math.max(project.entities, entityCount);
      }

      let encoderName = '';
      try {
        encoderName = (await window.electronAPI?.getEncoderName()) ?? '';
      } catch {
        encoderName = '';
      }

      const global = aggregateGlobalMetrics(state);
      const newUnlocks = determineNewUnlocks(state, global, {
        savedAt,
        encoderName,
        fileCounts: stats.files[relativePath] ?? null,
        xml,
        sourceMode,
        roll: Math.random(),
        pickRoll: Math.random(),
      });

      const applied = applyUnlocks(state, newUnlocks, savedAt.toISOString());

      await saveAchievementsState(state);
      notifyUnlocks(state, applied, notify);
    } catch {
      // Decorative feature: swallow everything.
    }
  };

  const queued = achievementsSaveQueue.then(run, run);
  achievementsSaveQueue = queued.then(
    () => undefined,
    () => undefined,
  );
  return queued;
};
