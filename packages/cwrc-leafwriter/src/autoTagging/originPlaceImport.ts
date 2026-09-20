/**
 * Origin-place import decision (Phase 5, §"Decision (2026-07-26): origin-place
 * import modes" in docs/placename-geo-disambiguation-planning.md).
 *
 * A confirmed place-of-origin assertion (or, more generally, any set of
 * authority hits a user has decided name the same real-world place) is
 * imported as one of two entity storage modes:
 *
 * - `coordinates`: every candidate that carries a coordinate falls within the
 *   configured proximity radius of every other, and admin levels don't
 *   conflict. One representative point is selected; every source's own
 *   strings/ids/dates are preserved as source entries, not averaged away.
 * - `id`: a geographic conflict (candidates outside the radius),
 *   incompatible administrative levels, or no candidate carrying coordinates
 *   at all. No coordinate is promoted to the entity level, but every
 *   candidate's strings, ids, coordinates, and dates are still preserved as
 *   source metadata.
 *
 * This module is a pure decision function — it does not touch entities.xml
 * or the SQLite store. Its output maps directly onto
 * `EntityStore.sqliteApplyAuthorityBackfillPatch`'s `storageMode`/`geo`/
 * `adminLevels`/`sourceEntries` fields.
 */
import { clusterByDistance, type GeoPoint } from './geoCluster';

export interface OriginPlaceDateRange {
  from?: number | null;
  to?: number | null;
  label?: string | null;
}

export interface OriginPlaceCandidate {
  /** Normalized authority label, e.g. "CBDB", "CHGIS", "DILA". */
  source: string;
  /** Authority-internal id for this record. */
  authId: string;
  /** The name string this authority asserts, when known. */
  placeName?: string;
  geo?: GeoPoint;
  /** Normalized administrative-level code (see admin_type_concordance.tsv). */
  adminLevel?: string;
  dates?: OriginPlaceDateRange[];
}

export type PlaceStorageMode = 'coordinates' | 'id';

export interface OriginPlaceImportResult {
  storageMode: PlaceStorageMode;
  /** Only set when storageMode is 'coordinates' — one selected representative point. */
  geo?: GeoPoint;
  /** Reason a coordinate wasn't promoted, when storageMode is 'id' with ≥1 geo-bearing candidate. */
  conflict?: 'geo-out-of-radius' | 'admin-level-mismatch';
  placeNames: { text: string; source: string }[];
  adminLevels: { source: string; level: string }[];
  sourceEntries: {
    source: string;
    authId: string;
    dates?: OriginPlaceDateRange[];
  }[];
}

/**
 * True when every present, non-empty admin level agrees (case-insensitive).
 * A candidate that omits its admin level never conflicts — missing data is
 * not a reason to reject a coherent geographic cluster (Rule 1 still needs a
 * geographic check of its own; this only guards the "different administrative
 * identity" half of Rule 2's conflict list).
 */
export function adminLevelsCompatible(candidates: OriginPlaceCandidate[]): boolean {
  const levels = new Set(
    candidates
      .map((candidate) => candidate.adminLevel?.trim().toLowerCase())
      .filter((level): level is string => Boolean(level)),
  );
  return levels.size <= 1;
}

/**
 * Decide storage mode for a set of authority candidates the user has
 * confirmed name the same place, per Decision (2026-07-26)'s three rules.
 * `proximityKm` is the same project-configurable radius used for
 * disambiguation clustering (`placeProximityKm`, default 5km) — it groups
 * candidates from a string search; it is never a search by lat/lon and never
 * an identity oracle on its own.
 */
export function importOriginPlace(
  candidates: OriginPlaceCandidate[],
  proximityKm: number,
): OriginPlaceImportResult {
  const placeNames = candidates
    .filter((candidate) => candidate.placeName?.trim())
    .map((candidate) => ({ text: candidate.placeName!.trim(), source: candidate.source }));
  const adminLevels = candidates
    .filter((candidate) => candidate.adminLevel?.trim())
    .map((candidate) => ({ source: candidate.source, level: candidate.adminLevel!.trim() }));
  const sourceEntries = candidates.map((candidate) => ({
    source: candidate.source,
    authId: candidate.authId,
    dates: candidate.dates,
  }));

  const geoBearing = candidates.filter(
    (candidate): candidate is OriginPlaceCandidate & { geo: GeoPoint } => Boolean(candidate.geo),
  );

  // Rule 3: no candidate has coordinates at all.
  if (geoBearing.length === 0) {
    return { storageMode: 'id', placeNames, adminLevels, sourceEntries };
  }

  // Rule 2 (admin-level half): a hard compatibility check, independent of geometry.
  if (!adminLevelsCompatible(candidates)) {
    return {
      storageMode: 'id',
      conflict: 'admin-level-mismatch',
      placeNames,
      adminLevels,
      sourceEntries,
    };
  }

  // Rule 1 vs Rule 2 (geo half): every geo-bearing candidate must land in one
  // shared cluster — a split into more than one cluster is the "coordinate
  // clusters outside the radius" conflict.
  const clusters = clusterByDistance(
    geoBearing.map((candidate) => candidate.geo),
    proximityKm,
  );
  if (clusters.length > 1) {
    return {
      storageMode: 'id',
      conflict: 'geo-out-of-radius',
      placeNames,
      adminLevels,
      sourceEntries,
    };
  }

  // Coherent cluster: select a representative point. User-sourced candidates
  // (if any slip in here — this fn is source-agnostic) would be preferred by
  // a caller before this point; among authority hits, the first is as good
  // a representative as any single point, since all are within the radius.
  return {
    storageMode: 'coordinates',
    geo: geoBearing[0]!.geo,
    placeNames,
    adminLevels,
    sourceEntries,
  };
}
