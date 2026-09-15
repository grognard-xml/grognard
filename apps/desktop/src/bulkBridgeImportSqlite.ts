/**
 * SQLite catch-up bulk bridge: link/mint unlinked PEDB entities into CEDB.
 * Progress/proposal types match the DOM bulkBridgeImport contract so the
 * worker and BulkSyncIndicator stay unchanged.
 */

import {
  mintEntityId,
  type EntityKind,
} from '../../../packages/cwrc-leafwriter/src/autoTagging/entities';
import type {
  BulkBridgeProgress,
  BulkBridgeProposal,
  BulkBridgeResult,
} from '../../../packages/cwrc-leafwriter/src/autoTagging/bulkBridgeImport';
import { EntitySqliteRepository } from './entityDbSqlite/repository';

export interface BulkBridgeSqliteOptions {
  source: EntitySqliteRepository;
  central: EntitySqliteRepository;
  userStableId: string;
  chunkSize?: number;
  /** Persist / ignore-write after this many processed source rows; defaults to ten chunks. */
  checkpointInterval?: number;
  /**
   * When true (default), entities with no CEDB authority match are minted into
   * CEDB and linked. When false, they become `no-authority-match` proposals.
   */
  mintUnmatched?: boolean;
  onCheckpoint?: (progress: BulkBridgeProgress) => Promise<void> | void;
  onProgress?: (progress: BulkBridgeProgress) => void;
  onProposal?: (proposal: BulkBridgeProposal) => void;
  shouldCancel?: () => boolean;
}

/** Same Wikidata/VIAF normalisation as EntitySqliteRepository. */
function normalizeAuthorityValue(type: string, value: string): string {
  const trimmed = value.trim();
  if (/^wikidata$/i.test(type)) {
    const match = trimmed.match(/(Q\d+)\s*$/i);
    if (match) return match[1]!.toUpperCase();
  }
  if (/^viaf$/i.test(type)) {
    const match = trimmed.match(/(\d+)\s*\/?\s*$/);
    if (match) return match[1]!;
  }
  return trimmed;
}

const authorityKey = (kind: string, type: string, value: string) =>
  `${kind}\t${type.trim().toLowerCase()}\t${normalizeAuthorityValue(type, value)}`;

const yieldToEventLoop = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

async function listActiveAuthorities(
  repository: EntitySqliteRepository,
  entityId: string,
): Promise<{ type: string; value: string }[]> {
  return (await repository.backend.all(
    `SELECT authority_type AS type, authority_value AS value
       FROM entity_authorities
       WHERE entity_id = ? AND status = 'active'
       ORDER BY id`,
    [entityId],
  )) as { type: string; value: string }[];
}

async function primaryNameOf(
  repository: EntitySqliteRepository,
  entityId: string,
): Promise<string | null> {
  const row = (await repository.backend.get(
    `SELECT text FROM entity_names
       WHERE entity_id = ? AND status = 'active'
       ORDER BY is_primary DESC, id
       LIMIT 1`,
    [entityId],
  )) as { text?: string } | undefined;
  return row?.text?.trim() || null;
}

function addToAuthorityIndex(
  index: Map<string, string[]>,
  kind: string,
  entityId: string,
  authorities: { type: string; value: string }[],
): void {
  for (const authority of authorities) {
    if (!authority.type.trim() || !authority.value.trim()) continue;
    const key = authorityKey(kind, authority.type, authority.value);
    const ids = index.get(key) ?? [];
    if (!ids.includes(entityId)) ids.push(entityId);
    index.set(key, ids);
  }
}

/**
 * Import unlinked project entities into the central SQLite database.
 *
 * Already-linked PEDB rows are skipped (steady-state mirror handles those).
 * Unique authority matches are linked; ambiguous matches become proposals;
 * unmatched rows are minted (default) or proposed.
 */
export async function bulkBridgeImportSqlite(
  options: BulkBridgeSqliteOptions,
): Promise<BulkBridgeResult> {
  const chunkSize = Math.max(25, options.chunkSize ?? 250);
  const mintUnmatched = options.mintUnmatched !== false;
  const checkpointInterval = Math.max(chunkSize, options.checkpointInterval ?? chunkSize * 10);
  const { source, central, userStableId } = options;

  const centralByAuthority = new Map<string, string[]>();

  const progress = (update: Partial<BulkBridgeProgress>) =>
    options.onProgress?.({
      stage: 'indexing',
      done: 0,
      total: 0,
      matched: 0,
      proposed: 0,
      ambiguous: 0,
      merged: 0,
      lastSourceId: null,
      ...update,
    });

  const centralIds = await central.listEntityIds();
  for (let offset = 0; offset < centralIds.length; offset += chunkSize) {
    for (const id of centralIds.slice(offset, offset + chunkSize)) {
      const entity = await central.getEntity(id);
      if (!entity || entity.deletedAt) continue;
      addToAuthorityIndex(
        centralByAuthority,
        entity.kind,
        id,
        await listActiveAuthorities(central, id),
      );
    }
    progress({
      done: Math.min(offset + chunkSize, centralIds.length),
      total: centralIds.length,
      lastSourceId: null,
    });
    await yieldToEventLoop();
    if (options.shouldCancel?.()) {
      return {
        matched: 0,
        proposed: 0,
        ambiguous: 0,
        merged: 0,
        sourceChanged: false,
        centralChanged: false,
        proposals: [],
      };
    }
  }

  const sourceIds = await source.listEntityIds();
  const proposals: BulkBridgeProposal[] = [];
  let matched = 0;
  let proposed = 0;
  let ambiguous = 0;
  let merged = 0;
  let sourceChanged = false;
  let centralChanged = false;
  let done = 0;
  let lastSourceId: string | null = null;

  const emitMatching = () =>
    progress({
      stage: 'matching',
      done,
      total: sourceIds.length,
      matched,
      proposed,
      ambiguous,
      merged,
      lastSourceId,
    });

  const maybeCheckpoint = async () => {
    if (done > 0 && (done % checkpointInterval < chunkSize || done === sourceIds.length)) {
      await options.onCheckpoint?.({
        stage: 'matching',
        done,
        total: sourceIds.length,
        matched,
        proposed,
        ambiguous,
        merged,
        lastSourceId,
      });
    }
  };

  for (let offset = 0; offset < sourceIds.length; offset += chunkSize) {
    for (const sourceId of sourceIds.slice(offset, offset + chunkSize)) {
      lastSourceId = sourceId;
      done += 1;

      if (await source.getCentralId(sourceId, userStableId)) continue;

      const entity = await source.getEntity(sourceId);
      if (!entity || entity.deletedAt) continue;

      const authorities = await listActiveAuthorities(source, sourceId);
      const candidates = new Set<string>();
      for (const authority of authorities) {
        for (const id of centralByAuthority.get(
          authorityKey(entity.kind, authority.type, authority.value),
        ) ?? []) {
          candidates.add(id);
        }
      }
      const candidateIds = [...candidates];

      if (candidateIds.length === 1) {
        const centralId = candidateIds[0]!;
        if (await source.setCentralMapping(sourceId, userStableId, centralId)) sourceChanged = true;
        matched += 1;
        continue;
      }

      if (candidateIds.length > 1) {
        const proposal: BulkBridgeProposal = {
          sourceId,
          kind: entity.kind as EntityKind,
          name: await primaryNameOf(source, sourceId),
          authorities,
          reason: 'ambiguous-authority-match',
          candidateCentralIds: candidateIds,
        };
        proposals.push(proposal);
        options.onProposal?.(proposal);
        ambiguous += 1;
        continue;
      }

      if (!mintUnmatched) {
        const proposal: BulkBridgeProposal = {
          sourceId,
          kind: entity.kind as EntityKind,
          name: await primaryNameOf(source, sourceId),
          authorities,
          reason: 'no-authority-match',
          candidateCentralIds: [],
        };
        proposals.push(proposal);
        options.onProposal?.(proposal);
        proposed += 1;
        continue;
      }

      const centralId = mintEntityId(entity.kind as EntityKind);
      await central.createEntity({
        id: centralId,
        kind: entity.kind,
        description: entity.description,
      });
      if (!(await central.replaceEntityContentFrom(source, sourceId, centralId))) {
        throw new Error(`Failed to mint central entity from ${sourceId}`);
      }
      if (await source.setCentralMapping(sourceId, userStableId, centralId)) sourceChanged = true;
      centralChanged = true;
      addToAuthorityIndex(
        centralByAuthority,
        entity.kind,
        centralId,
        await listActiveAuthorities(central, centralId),
      );
      matched += 1;
      merged += 1;
    }

    emitMatching();
    await maybeCheckpoint();
    await yieldToEventLoop();
    if (options.shouldCancel?.()) break;
  }

  progress({
    stage: 'complete',
    done,
    total: sourceIds.length,
    matched,
    proposed,
    ambiguous,
    merged,
    lastSourceId: null,
  });

  return {
    matched,
    proposed,
    ambiguous,
    merged,
    sourceChanged,
    centralChanged,
    proposals,
  };
}
