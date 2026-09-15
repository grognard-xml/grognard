import { entityStoreFromDesktop } from '../../../../packages/cwrc-leafwriter/src/autoTagging/entityStore';
import { applyPendingOrders } from '@src/desktop/entityDb/applyOrders';
import {
  applyPendingCentralOrders,
  loadBridgeContext,
  syncNonConflictingLinkedEntities,
} from '@src/desktop/entityDb/bridge';
import {
  purgeReportedOrphans,
  reconstituteReportedOrphans,
  runEntityDatabaseCheck,
  sweepProjectOrphans,
} from '../../../../packages/cwrc-leafwriter/src/autoTagging/entityDatabaseCheck';
import { resolveEntityStorePaths } from '../../../../packages/cwrc-leafwriter/src/autoTagging/entityStoreResolve';
import { useAppState } from '@src/overmind';
import { isDesktop } from '@src/types/desktop';
import { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

export const useEntityDatabaseLifecycle = () => {
  const { config, projectFilePath, rootPath } = useAppState().project;
  const { t } = useTranslation();
  const checkedProjectRef = useRef<string | null>(null);
  const staleEntitiesRef = useRef(false);

  const resolveEntitiesPath = useCallback((): string | null => {
    if (!isDesktop() || !rootPath) return null;
    try {
      const paths = resolveEntityStorePaths({ projectRoot: rootPath });
      return paths.entitiesPath;
    } catch {
      return null;
    }
  }, [rootPath]);

  /**
   * SQLite is the live authority; entities.xml is interchange only. A
   * Turso-backed project has no local file to watch for external changes —
   * changes arrive over the network from other collaborators, not via a
   * file a watcher could see — so there's nothing to return here for one.
   */
  const resolveWatchedEntityDbPath = useCallback(async (): Promise<string | null> => {
    const store = entityStoreFromDesktop();
    if (!store || store.sqlitePath.startsWith('grognard-turso:')) return null;
    if (!(await store.hasSqliteDatabase())) return null;
    return store.sqlitePath;
  }, []);

  useEffect(() => {
    if (!isDesktop() || !projectFilePath || !rootPath) return;
    if (checkedProjectRef.current === projectFilePath) return;

    const store = entityStoreFromDesktop();
    if (!store || !window.electronAPI) return;

    checkedProjectRef.current = projectFilePath;

    void (async () => {
      // Check this project into the shared-database registry so merge/delete
      // key propagation knows every project tree using this entities.xml.
      await store.registerProjectInRegistry().catch(() => undefined);

      const checkApi = {
        listProjectXmlFiles: (path: string) => window.electronAPI!.listProjectXmlFiles(path),
        readFile: (path: string) => window.electronAPI!.readFile(path),
        writeFile: (path: string, content: string) => window.electronAPI!.writeFile(path, content),
        showNativeMessageBox: (
          options: Parameters<typeof window.electronAPI.showNativeMessageBox>[0],
        ) => window.electronAPI!.showNativeMessageBox(options),
        updateProjectFileConfig: (path: string, patch: Record<string, unknown>) =>
          window.electronAPI!.updateProjectFileConfig(path, patch),
      };

      console.info('[entity-db-check] running check for project', {
        projectFilePath,
        projectRoot: rootPath,
        projectDatabaseId: config?.entityDatabaseId,
        entitiesPath: store.entitiesPath,
      });

      const checkResult = await runEntityDatabaseCheck(
        store,
        {
          projectDatabaseId: config?.entityDatabaseId,
          projectRoot: rootPath,
          projectFilePath,
        },
        checkApi,
      );

      console.info('[entity-db-check] check completed', {
        status: checkResult.status,
        databaseId: checkResult.databaseId,
      });

      // Replay any merge/delete orders recorded elsewhere (other machine, fresh
      // clone, a tree the eager crawl couldn't see). Idempotent; safe to run on
      // every open.
      if (!config?.syncToCentral) {
        try {
          const result = await applyPendingOrders(store);
          if (result.ordersApplied > 0 && (result.summary?.filesChanged ?? 0) > 0) {
            console.info(
              `[entity-orders] applied ${result.ordersApplied} order(s); ` +
                `updated ${result.summary?.filesChanged} file(s) in this project.`,
            );
          }
        } catch {
          // never block project open on order replay
        }
      }

      // Converge this project's central-database mappings against any
      // Absorb/delete that happened in the central database itself — a
      // duplicate merged there doesn't rewrite this PEDB's corpus keys (it
      // never touches this id space), but the `grognard-central` mapping that
      // named the merged-away id would otherwise sit stale/"broken" until
      // someone opens the Bridge inbox by hand.
      if (!config?.syncToCentral) {
        try {
          const availability = await loadBridgeContext();
          if (availability.available) {
            const synced = await applyPendingCentralOrders(availability.context);
            if (synced.repointed > 0 || synced.cleared > 0) {
              console.info(
                `[central-orders] applied ${synced.ordersApplied} order(s); ` +
                  `repointed ${synced.repointed}, cleared ${synced.cleared} mapping(s).`,
              );
            }
            // Pull non-conflicting central content (new courtesy names, etc.)
            // into linked PEDB entities. Does not overwrite scalar conflicts.
            const pulled = await syncNonConflictingLinkedEntities(availability.context);
            if (pulled.synced > 0) {
              console.info(
                `[bridge] auto-synced ${pulled.synced} linked entit${pulled.synced === 1 ? 'y' : 'ies'} from central.`,
              );
            }
          }
        } catch (error) {
          // never block project open on central order replay

          console.error('[central-orders] skipped (SQLite required or apply failed):', error);
        }
      }

      // Gentle orphan check: after orders have converged, surface corpus keys
      // that resolve to nothing — but only the genuine orphans (stray files from
      // another edition are reported separately and never auto-stripped).
      try {
        let report = await sweepProjectOrphans(store, checkApi, rootPath);
        if (report.orphanKeyCount > 0) {
          // A cloud drive can deliver changed corpus XML before the matching
          // SQLite PEDB update. Give that paired update a short chance to land,
          // then re-read the live database before telling the user anything is
          // missing. This is deliberately a re-scan, not a cached result.
          await new Promise<void>((resolve) => window.setTimeout(resolve, 1500));
          report = await sweepProjectOrphans(store, checkApi, rootPath);
        }
        if (report.orphanKeyCount > 0) {
          const bridge = await loadBridgeContext().catch(() => ({ available: false }));
          const mayArriveFromLinkedDatabase = config?.syncToCentral === true || bridge.available;
          const strayNote =
            report.strayFiles.length > 0
              ? t('LWC.desktop.orphan_keys.stray_note', { count: report.strayFiles.length })
              : '';
          const { response } = await window.electronAPI!.showNativeMessageBox({
            type: 'warning',
            title: t('LWC.desktop.orphan_keys.title'),
            message: t('LWC.desktop.orphan_keys.message', {
              keys: report.orphanKeyCount,
              files: report.orphanFiles.length,
            }),
            detail: mayArriveFromLinkedDatabase
              ? t('LWC.desktop.orphan_keys.linked_detail', { strayNote })
              : t('LWC.desktop.orphan_keys.local_detail', { strayNote }),
            buttons: [
              t('LWC.desktop.orphan_keys.leave_intact'),
              t('LWC.desktop.orphan_keys.ingest'),
              t('LWC.desktop.orphan_keys.strip'),
            ],
            defaultId: 0,
            cancelId: 0,
          });
          if (response === 1) {
            const created = await reconstituteReportedOrphans(store, checkApi, report);

            console.info(
              `[orphan-sweep] ingested ${created} stub entit${created === 1 ? 'y' : 'ies'}.`,
            );
          } else if (response === 2) {
            const purged = await purgeReportedOrphans(checkApi, report);

            console.info(`[orphan-sweep] stripped ${purged} orphan key(s).`);
          }
        }
      } catch {
        // never block project open on the orphan sweep
      }
    })();
  }, [config?.entityDatabaseId, config?.syncToCentral, projectFilePath, rootPath, t]);

  useEffect(() => {
    if (!isDesktop() || !window.electronAPI?.onExternalFileChange) return;
    let watchedPath: string | null = null;
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;

    void (async () => {
      watchedPath = await resolveWatchedEntityDbPath();
      if (cancelled || !watchedPath || !window.electronAPI?.onExternalFileChange) return;
      const pathToWatch = watchedPath;
      unsubscribe = window.electronAPI.onExternalFileChange((filePath) => {
        if (filePath.replace(/\\/g, '/') !== pathToWatch.replace(/\\/g, '/')) return;
        staleEntitiesRef.current = true;
        void window.electronAPI
          ?.showNativeMessageBox?.({
            type: 'question',
            title: t('LWC.desktop.entity_database_changed.title'),
            message: t('LWC.desktop.entity_database_changed.message'),
            buttons: [
              t('LWC.desktop.entity_database_changed.reload'),
              t('LWC.desktop.entity_database_changed.keep'),
            ],
          })
          .then(({ response }) => {
            if (response === 0) staleEntitiesRef.current = false;
          });
      });
    })();

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [resolveWatchedEntityDbPath, t]);

  return { entitiesPath: resolveEntitiesPath(), staleEntitiesRef };
};
