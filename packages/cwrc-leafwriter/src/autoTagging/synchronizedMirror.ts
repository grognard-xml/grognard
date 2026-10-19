import type { EntityStore } from './entityStore';
import type { SqlitePanelSummaryLike } from './sqliteSummary';

const CHECKPOINT_FILE = 'central-sync-checkpoint.json';
const CENTRAL_MAPPING_TYPE = 'grognard-central';

export interface SyncPairCheckpoint {
  centralId: string;
  pedbHash: string;
  centralHash: string;
}

export interface SynchronizedMirrorCheckpoint {
  version: 1;
  centralDatabaseId: string | null;
  pairs: Record<string, SyncPairCheckpoint>;
}

export interface SynchronizedMirrorConflict {
  pedbId: string;
  centralId: string;
  reason: 'both-sides-changed';
}

export interface SynchronizedMirrorResult {
  centralChanged: boolean;
  projectChanged: boolean;
  checkpointChanged: boolean;
  uploadedProjectChanges: number;
  downloadedCentralChanges: number;
  conflicts: SynchronizedMirrorConflict[];
  unavailable: boolean;
}

const emptyCheckpoint = (): SynchronizedMirrorCheckpoint => ({
  version: 1,
  centralDatabaseId: null,
  pairs: {},
});

/** Remove local ids, concordance ids, and volatile timestamps before hashing content. */
function normalizedEntityXml(item: Element): string {
  const clone = item.cloneNode(true) as Element;
  const walker = clone.ownerDocument!.createTreeWalker(clone, 1);
  const elements: Element[] = [clone];
  let current: Node | null = walker.nextNode();
  while (current) {
    elements.push(current as Element);
    current = walker.nextNode();
  }
  for (const element of elements) {
    for (const attribute of Array.from(element.attributes)) {
      if (
        attribute.name === 'xml:id' ||
        attribute.localName === 'id' ||
        (element === clone && attribute.name === 'id')
      ) {
        element.removeAttributeNode(attribute);
      }
    }
    for (const child of Array.from(element.children)) {
      if (child.localName === 'idno' && child.getAttribute('type') === CENTRAL_MAPPING_TYPE) {
        child.remove();
      } else if (child.localName === 'note' && child.getAttribute('type') === 'grognard-changed') {
        child.remove();
      }
    }
  }
  return new XMLSerializer().serializeToString(clone);
}

function hash(value: string): string {
  // Small deterministic hash; this is a change detector, not a security hash.
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(16).padStart(8, '0');
}

export function entityContentHash(item: Element): string {
  return hash(normalizedEntityXml(item));
}

async function readCheckpoint(store: EntityStore): Promise<SynchronizedMirrorCheckpoint> {
  const raw = await store.readProjectGrognardFile(CHECKPOINT_FILE);
  if (!raw) return emptyCheckpoint();
  try {
    const parsed = JSON.parse(raw) as SynchronizedMirrorCheckpoint;
    if (parsed.version !== 1 || !parsed.pairs || typeof parsed.pairs !== 'object') {
      return emptyCheckpoint();
    }
    return parsed;
  } catch {
    return emptyCheckpoint();
  }
}

async function writeCheckpoint(
  store: EntityStore,
  checkpoint: SynchronizedMirrorCheckpoint,
): Promise<void> {
  await store.writeProjectGrognardFile(CHECKPOINT_FILE, `${JSON.stringify(checkpoint, null, 2)}\n`);
}

/**
 * How many PEDB entities still lack a central mapping for this user.
 * Cheap SQL count — used to decide whether to ask before catch-up sync.
 */
export async function countUnlinkedPedbEntities(
  projectStore: EntityStore,
  userStableId: string,
): Promise<number> {
  if (!(await projectStore.hasSqliteDatabase())) return 0;
  const counted = await projectStore.sqliteCountUnlinked(userStableId);
  if (typeof counted === 'number') return counted;
  // Fallback when the dedicated IPC is unavailable: list ids + mappings.
  const [ids, mappings] = await Promise.all([
    projectStore.sqliteEntityIds(),
    projectStore.sqliteListAllCentralMappings(userStableId),
  ]);
  if (!ids) return 0;
  const linked = new Set((mappings ?? []).map((row) => row.projectEntityId));
  return ids.reduce((count, id) => count + (linked.has(id) ? 0 : 1), 0);
}

/**
 * Authority ids on the project entity that central lacks, attached to central.
 * An id whose type central already holds with a different value is a genuine
 * conflict for curation, so it is left alone.
 */
async function attachProjectOnlyAuthorities(
  projectStore: EntityStore,
  centralStore: EntityStore,
  pedbId: string,
  centralId: string,
): Promise<boolean> {
  const [pedb, central] = (await Promise.all([
    projectStore.sqliteEntitySummary(pedbId),
    centralStore.sqliteEntitySummary(centralId),
  ])) as (SqlitePanelSummaryLike | null)[];
  if (!pedb || !central) return false;
  const centralAuthorities = central.authorities ?? [];
  let attached = false;
  for (const authority of pedb.authorities ?? []) {
    const sameType = centralAuthorities.filter(
      (own) => own.type.toLowerCase() === authority.type.toLowerCase(),
    );
    if (sameType.length > 0) continue;
    if (await centralStore.sqliteAttachAuthority(centralId, authority.type, authority.value)) {
      attached = true;
    }
  }
  return attached;
}

async function synchronizeMirroredProjectSqlite(
  projectStore: EntityStore,
  centralStore: EntityStore,
  userStableId: string,
): Promise<SynchronizedMirrorResult> {
  const result: SynchronizedMirrorResult = {
    centralChanged: false,
    projectChanged: false,
    checkpointChanged: false,
    uploadedProjectChanges: 0,
    downloadedCentralChanges: 0,
    conflicts: [],
    unavailable: false,
  };

  // Catch-up (promote/link/mint for unlinked PEDB rows) is an explicit
  // background job — this path only converges already-linked pairs.

  const checkpoint = await readCheckpoint(projectStore);
  const nextPairs: Record<string, SyncPairCheckpoint> = {};
  let pedbIds: string[];
  try {
    pedbIds = (await projectStore.sqliteEntityIds()) ?? [];
  } catch {
    result.unavailable = true;
    return result;
  }

  for (const pedbId of pedbIds) {
    const centralId = await projectStore.sqliteGetCentralId(pedbId, userStableId);
    if (!centralId) continue;

    const [pedbSummary, centralSummary] = await Promise.all([
      projectStore.sqliteEntitySummary(pedbId) as Promise<{ kind?: string } | null>,
      centralStore.sqliteEntitySummary(centralId) as Promise<{ kind?: string } | null>,
    ]);
    if (!pedbSummary?.kind || !centralSummary?.kind || pedbSummary.kind !== centralSummary.kind) {
      continue;
    }

    const pedbHash = await projectStore.sqliteEntityContentHash(pedbId);
    const centralHash = await centralStore.sqliteEntityContentHash(centralId);
    if (!pedbHash || !centralHash) continue;

    const prior = checkpoint.pairs[pedbId];
    let nextPedbHash = pedbHash;
    let nextCentralHash = centralHash;

    const copyToCentral = async () => {
      const changed = await centralStore.sqliteReplaceEntityContentFrom(
        projectStore.sqlitePath,
        pedbId,
        centralId,
      );
      if (changed) result.centralChanged = true;
      nextCentralHash = (await centralStore.sqliteEntityContentHash(centralId)) ?? centralHash;
    };
    const copyToProject = async () => {
      const changed = await projectStore.sqliteReplaceEntityContentFrom(
        centralStore.sqlitePath,
        centralId,
        pedbId,
      );
      if (changed) result.projectChanged = true;
      nextPedbHash = (await projectStore.sqliteEntityContentHash(pedbId)) ?? pedbHash;
    };

    if (prior && prior.centralId === centralId) {
      const pedbChanged = pedbHash !== prior.pedbHash;
      const centralChanged = centralHash !== prior.centralHash;
      if (pedbChanged && centralChanged && pedbHash !== centralHash) {
        result.conflicts.push({ pedbId, centralId, reason: 'both-sides-changed' });
        continue;
      }
      if (pedbChanged && !centralChanged) {
        await copyToCentral();
        result.uploadedProjectChanges += 1;
      } else if (!pedbChanged && centralChanged) {
        await copyToProject();
        result.downloadedCentralChanges += 1;
      }
    } else if (pedbHash !== centralHash) {
      // First time this pair is seen: central wins, but never at the cost of
      // authority ids only the project knows (e.g. the Wikidata id from an
      // import header) — carry those over first so the copy cannot strip them.
      if (await attachProjectOnlyAuthorities(projectStore, centralStore, pedbId, centralId)) {
        result.centralChanged = true;
        nextCentralHash = (await centralStore.sqliteEntityContentHash(centralId)) ?? centralHash;
      }
      await copyToProject();
      result.downloadedCentralChanges += 1;
    }

    nextPairs[pedbId] = {
      centralId,
      pedbHash: nextPedbHash,
      centralHash: nextCentralHash,
    };
  }

  const nextCheckpoint: SynchronizedMirrorCheckpoint = {
    version: 1,
    centralDatabaseId: (await centralStore.sqliteDatabaseId()) ?? null,
    pairs: nextPairs,
  };
  if (JSON.stringify(nextCheckpoint) !== JSON.stringify(checkpoint)) {
    await writeCheckpoint(projectStore, nextCheckpoint);
    result.checkpointChanged = true;
  }
  return result;
}

/**
 * Synchronize a project mirror against CEDB using the last checkpoint as the
 * common ancestor. CEDB wins only when PEDB is unchanged; an offline PEDB edit
 * is uploaded when CEDB is unchanged; simultaneous edits are reported.
 */
export async function synchronizeMirroredProject(
  projectStore: EntityStore,
  centralStore: EntityStore,
  userStableId: string,
): Promise<SynchronizedMirrorResult> {
  const useSqliteContent =
    (await projectStore.hasSqliteDatabase()) &&
    (await centralStore.hasSqliteDatabase()) &&
    typeof window !== 'undefined' &&
    Boolean(window.electronAPI?.entitySqliteReplaceEntityContent) &&
    Boolean(window.electronAPI?.entitySqliteEntityContentHash);

  if (useSqliteContent) {
    return synchronizeMirroredProjectSqlite(projectStore, centralStore, userStableId);
  }

  // No DOM promote/copy/saveEntities fallthrough — that path full-reimports
  // into live SQLite when a sibling .sqlite exists.
  return {
    centralChanged: false,
    projectChanged: false,
    checkpointChanged: false,
    uploadedProjectChanges: 0,
    downloadedCentralChanges: 0,
    conflicts: [],
    unavailable: true,
  };
}
