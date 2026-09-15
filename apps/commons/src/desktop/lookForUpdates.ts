/**
 * Unified "Look for Updates" — app binary, authority packs, plugins, and
 * (when a project is open) the catalog schema.
 *
 * Authority packs and plugins are applied immediately when an update is
 * found, matching the silent background poll in updater.ts: "look for
 * updates" is not just a check, it's the update.
 */
import type { AppUpdateCheckResult } from './appUpdateTypes';
import type { AuthorityLifecycleRunResult, AuthorityLifecycleStatus } from './authorityLifecycleTypes';
import type { SchemaUpdateCheckResult } from './schemaUpdateTypes';

export interface PluginUpdateReport {
  updated: { id: string; from: string; to: string }[];
  failed: { id: string; error: string }[];
}

export interface LookForUpdatesReport {
  app: AppUpdateCheckResult | null;
  /** Pre-update status: whether authority packs needed an update. */
  authority: AuthorityLifecycleStatus | null;
  /** Result of applying the authority pack update, if one was attempted. */
  authorityApplied: AuthorityLifecycleRunResult | null;
  /** Result of applying plugin updates; null when the bridge is unavailable. */
  pluginsApplied: PluginUpdateReport | null;
  schema: SchemaUpdateCheckResult | null;
}

interface LookForUpdatesApi {
  checkForAppUpdates?: () => Promise<AppUpdateCheckResult>;
  authorityLifecycleMaybeCheckUpdates?: (options?: {
    force?: boolean;
  }) => Promise<AuthorityLifecycleStatus | null>;
  authorityLifecycleUpdate?: () => Promise<AuthorityLifecycleRunResult>;
  pluginsUpdateInstalled?: () => Promise<PluginUpdateReport>;
  checkSchemaUpdate?: (
    projectFilePath: string,
    options?: { force?: boolean },
  ) => Promise<SchemaUpdateCheckResult>;
}

export const gatherUpdateReport = async (
  api: LookForUpdatesApi,
  options?: { projectFilePath?: string | null },
): Promise<LookForUpdatesReport> => {
  const projectFilePath = options?.projectFilePath?.trim() || null;

  const [app, authority, pluginsApplied, schema] = await Promise.all([
    api.checkForAppUpdates?.().catch((error): AppUpdateCheckResult => ({
      status: 'error',
      message: error instanceof Error ? error.message : String(error),
    })) ?? Promise.resolve(null),
    api.authorityLifecycleMaybeCheckUpdates?.({ force: true }).catch(() => null) ??
      Promise.resolve(null),
    api.pluginsUpdateInstalled?.().catch((error): PluginUpdateReport => ({
      updated: [],
      failed: [{ id: '*', error: error instanceof Error ? error.message : String(error) }],
    })) ?? Promise.resolve(null),
    projectFilePath && api.checkSchemaUpdate
      ? api.checkSchemaUpdate(projectFilePath, { force: true }).catch(() => null)
      : Promise.resolve(null),
  ]);

  let authorityApplied: AuthorityLifecycleRunResult | null = null;
  if (authority?.enabled && authority.updateAvailable && api.authorityLifecycleUpdate) {
    authorityApplied = await api.authorityLifecycleUpdate().catch(
      (error): AuthorityLifecycleRunResult => ({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }

  return { app, authority, authorityApplied, pluginsApplied, schema };
};

/** True when every applicable channel was already current — nothing to apply. */
export const everythingIsUpToDate = (report: LookForUpdatesReport): boolean => {
  const appOk =
    !report.app || report.app.status === 'current' || report.app.status === 'unsupported';
  const authorityOk = !report.authority?.enabled || !report.authority.updateAvailable;
  const pluginsOk =
    !report.pluginsApplied ||
    (report.pluginsApplied.updated.length === 0 && report.pluginsApplied.failed.length === 0);
  const schemaOk =
    !report.schema || report.schema.status === 'current' || report.schema.status === 'skipped';
  return appOk && authorityOk && pluginsOk && schemaOk;
};
