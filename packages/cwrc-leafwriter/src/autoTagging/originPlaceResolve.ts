/**
 * Side-effecting glue for Phase 5's origin-place import (§"Decision
 * (2026-07-26)" in docs/placename-geo-disambiguation-planning.md): mints a
 * project place entity from a person's confirmed place-of-origin assertions
 * and points those origin rows at it. The storage-mode decision itself is
 * `importOriginPlace` (pure, in ./originPlaceImport.ts) — this function is
 * only the mint/patch/backlink sequence around it.
 */
import { mintEntityId } from './entities';
import type { EntityStore } from './entityStore';
import { importOriginPlace, type OriginPlaceCandidate } from './originPlaceImport';

export interface OriginReferenceCandidate {
  /** The `person_origins` assertion key ("person_origins:<id>"). */
  key: string;
  text: string;
  source: string;
  /** Existing authority-internal id (e.g. a bare CBDB `c_addr` id) — never a project "#place-…" ref. */
  authorityRef?: string | null;
}

export interface ResolveOriginToPlaceEntityResult {
  placeEntityId: string;
  storageMode: 'coordinates' | 'id';
  /** Origin assertion keys that were actually re-pointed at the new place entity. */
  linkedKeys: string[];
}

/**
 * Candidates without an authority ref (a bare user-typed origin string, no
 * source record behind it) still name the minted entity but contribute no
 * source entry — there's no authority association to attach date ranges to,
 * and per Rule 3 that alone never blocks minting an id-mode place.
 */
export async function resolveOriginToPlaceEntity(
  store: EntityStore,
  personEntityId: string,
  candidates: OriginReferenceCandidate[],
  proximityKm: number,
): Promise<ResolveOriginToPlaceEntityResult | null> {
  if (candidates.length === 0) return null;
  const withAuthority = candidates.filter((candidate) => candidate.authorityRef?.trim());

  const decision = importOriginPlace(
    withAuthority.map((candidate): OriginPlaceCandidate => ({
      source: candidate.source,
      authId: candidate.authorityRef!.trim(),
      placeName: candidate.text,
    })),
    proximityKm,
  );

  const primaryName = candidates[0]!.text;
  const placeId = mintEntityId('place');
  await store.sqliteCreatePopulated({
    id: placeId,
    kind: 'place',
    names: [{ text: primaryName, isPrimary: true, origin: 'user' }],
  });
  await store.sqliteApplyAuthorityBackfillPatch({
    entityId: placeId,
    storageMode: decision.storageMode,
    geo: decision.geo
      ? [
          {
            source: decision.sourceEntries[0]?.source ?? 'user',
            lat: decision.geo.lat,
            lon: decision.geo.lon,
          },
        ]
      : undefined,
    adminLevels: decision.adminLevels,
    sourceEntries: decision.sourceEntries,
  });

  const linkedKeys: string[] = [];
  for (const candidate of withAuthority) {
    if (await store.sqliteSetOriginReference(personEntityId, candidate.key, `#${placeId}`)) {
      linkedKeys.push(candidate.key);
    }
  }

  return { placeEntityId: placeId, storageMode: decision.storageMode, linkedKeys };
}
