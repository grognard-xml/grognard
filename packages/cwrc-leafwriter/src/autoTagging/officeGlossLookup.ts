/**
 * Office gloss sidecars:
 * - Huckbot5000 → English (`metadata.translation`) for blank pack glosses
 * - MaxiRicci7000 → French (`metadata.translationFr`) without overwriting English
 */
import type { AuthorityCandidate } from './authority';
import type { EntityStore } from './entityStore';
import { bareNorbertAuthorityValue, norbertAuthorityLookupValues } from './norbertAuthorityId';
import type { AuthorityPackContent } from './packLoader';
import { authorityPackLines } from './packLoader';
import type { AuthorityPackId } from './packPaths';
import { tryProceduralOfficeTranslation } from './proceduralOfficeGloss';
import {
  buildParentOfIndex,
  tryParentOfTranslation,
  type ParentOfIndex,
} from './proceduralParentOfGloss';

export type { ParentOfIndex } from './proceduralParentOfGloss';

export const HUCKBOT_PROCEDURAL_SOURCE = 'Huckbot5000 (procedural)';
export const MAXIRICCI_PROCEDURAL_SOURCE = 'MaxiRicci7000 (procedural)';
export const HUCKBOT_PARENTOF_SOURCE = 'Huckbot5000 (parentOf)';
export const MAXIRICCI_PARENTOF_SOURCE = 'MaxiRicci7000 (parentOf)';

export const HUCKBOT_TRANSLATIONS_PACK_ID: AuthorityPackId = 'huckbot5000-translations';
export const HUCKBOT_INSIDERS_PACK_ID: AuthorityPackId = 'huckbot5000-insiders';
export const MAXIRICCI_TRANSLATIONS_PACK_ID: AuthorityPackId = 'maxiricci7000-translations';
export const NORBERT_OFFICE_RELATIONS_PACK_ID: AuthorityPackId = 'norbert-office-relations';

export type OfficeGlossIndex = Map<string, string>;

/** French index: officeId keys plus zh / zh\\tdynasty fallbacks for Batch A. */
export interface FrenchOfficeGlossIndex {
  byOfficeId: Map<string, string>;
  byZhDynasty: Map<string, string>;
  byZh: Map<string, string>;
}

interface GlossRow {
  translation?: string;
  officeIds?: string[];
  zh?: string;
  dynasty?: string;
  language?: string;
}

/**
 * Publishable English/French office gloss. Rejects CBDB's
 * `[Not Yet Translated]` placeholder and strips trailing `(Hucker)`.
 */
export function cleanPublishableOfficeGloss(raw: string | null | undefined): string | null {
  if (!raw || /not yet translated/i.test(raw)) return null;
  const gloss = String(raw)
    .replace(/\(Hucker\)/gi, '')
    .trim();
  return gloss || null;
}

/** `州縣長吏 (Senior Subalterns…, 宋)` — matches cbdbOfficeClue shape. */
export function formatOfficeClue(
  name: string,
  translation?: string | null,
  dynasty?: string | null,
): string {
  const inner = [translation, dynasty].filter((part): part is string => Boolean(part?.trim()));
  if (inner.length) return `${name} (${inner.join(', ')})`;
  return name;
}

/** Keys used in Huckbot/Maxi `officeIds` (`cbdb:office:7`, `norbert:office:42`, …). */
export function officeGlossLookupKeys(
  authorities: readonly { type: string; value: string }[],
): string[] {
  const keys = new Set<string>();
  for (const auth of authorities) {
    const type = auth.type.trim().toUpperCase();
    const value = auth.value.trim();
    if (!value) continue;
    if (type === 'CBDB') {
      if (value.toLowerCase().startsWith('cbdb:office:')) keys.add(value.toLowerCase());
      else keys.add(`cbdb:office:${value}`);
    } else if (type === 'NORBERT') {
      for (const variant of norbertAuthorityLookupValues(value)) {
        keys.add(`norbert:office:${variant}`);
        const bare = bareNorbertAuthorityValue(variant);
        if (bare !== variant) keys.add(`norbert:office:${bare}`);
      }
    }
  }
  return [...keys];
}

export function lookupEnglishOfficeGloss(
  glosses: OfficeGlossIndex,
  authorities: readonly { type: string; value: string }[],
): string | undefined {
  for (const key of officeGlossLookupKeys(authorities)) {
    const hit = glosses.get(key);
    if (hit) return hit;
  }
  return undefined;
}

export function lookupFrenchOfficeGloss(
  glosses: FrenchOfficeGlossIndex,
  authorities: readonly { type: string; value: string }[],
  zh?: string | null,
  dynasty?: string | null,
): string | undefined {
  return lookupFrenchGloss(glosses, officeGlossLookupKeys(authorities), zh ?? undefined, dynasty);
}

/**
 * Write English/French roleName glosses onto an office entity (entity_translations).
 * Skips placeholders; addTranslation dedupes identical text+language.
 *
 * When no authority-sourced gloss is supplied (e.g. a freeform "create new" office
 * with no CBDB/Norbert pack match), falls back to the same place+suffix procedural
 * template used for pack-matched candidates and bulk backfill — so any office entity
 * minted anywhere in the app, not just via an authority candidate, still gets a
 * gloss when its name fits the template (太守/刺史/令).
 */
export async function persistOfficeTranslationNames(
  store: EntityStore,
  entityId: string,
  glosses: {
    translation?: string | null;
    translationFr?: string | null;
    enSource?: string | null;
    frSource?: string | null;
    /** Office's primary Chinese name, used for the procedural fallback. */
    primaryName?: string | null;
  },
): Promise<number> {
  let added = 0;
  let translation = glosses.translation;
  let translationFr = glosses.translationFr;
  let enSource = glosses.enSource;
  let frSource = glosses.frSource;
  if (
    (!cleanPublishableOfficeGloss(translation) || !cleanPublishableOfficeGloss(translationFr)) &&
    glosses.primaryName?.trim()
  ) {
    const procedural = tryProceduralOfficeTranslation(glosses.primaryName);
    if (procedural) {
      if (!cleanPublishableOfficeGloss(translation)) {
        translation = procedural.en;
        enSource = enSource ?? HUCKBOT_PROCEDURAL_SOURCE;
      }
      if (!cleanPublishableOfficeGloss(translationFr)) {
        translationFr = procedural.fr;
        frSource = frSource ?? MAXIRICCI_PROCEDURAL_SOURCE;
      }
    }
  }
  const en = cleanPublishableOfficeGloss(translation);
  if (en) {
    await store.sqliteAddName({
      entityId,
      text: en,
      nameType: 'translation',
      language: 'en',
      origin: 'authority',
      source: enSource ?? 'Huckbot5000',
    });
    added += 1;
  }
  const fr = cleanPublishableOfficeGloss(translationFr);
  if (fr) {
    await store.sqliteAddName({
      entityId,
      text: fr,
      nameType: 'translation',
      language: 'fr',
      origin: 'authority',
      source: frSource ?? 'MaxiRicci7000',
    });
    added += 1;
  }
  return added;
}

function normalizeZh(zh: string | undefined): string {
  return String(zh ?? '')
    .normalize('NFKC')
    .trim();
}

function zhDynastyKey(zh: string, dynasty: string | null | undefined): string {
  return `${normalizeZh(zh)}\t${String(dynasty ?? '').trim()}`;
}

/** Build officeId → English gloss from the Huckbot translations NDJSON. */
export function buildHuckbotGlossIndex(content: AuthorityPackContent): OfficeGlossIndex {
  const index: OfficeGlossIndex = new Map();
  for (const line of authorityPackLines(content)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let row: GlossRow;
    try {
      row = JSON.parse(trimmed) as GlossRow;
    } catch {
      continue;
    }
    const gloss = row.translation?.trim();
    if (!gloss) continue;
    for (const officeId of row.officeIds ?? []) {
      const key = officeId.trim();
      if (key && !index.has(key)) index.set(key, gloss);
    }
  }
  return index;
}

/** Build zh → English gloss (first wins) from the Huckbot translations NDJSON — used to
 *  resolve a parentOf compound's "remainder" office by name, not officeId. */
export function buildHuckbotZhGlossIndex(content: AuthorityPackContent): Map<string, string> {
  const index = new Map<string, string>();
  for (const line of authorityPackLines(content)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let row: GlossRow;
    try {
      row = JSON.parse(trimmed) as GlossRow;
    } catch {
      continue;
    }
    const gloss = row.translation?.trim();
    const zh = normalizeZh(row.zh);
    if (!gloss || !zh) continue;
    if (!index.has(zh)) index.set(zh, gloss);
  }
  return index;
}

/** Build French gloss indexes from MaxiRicci7000 translations NDJSON. */
export function buildMaxiRicciGlossIndex(content: AuthorityPackContent): FrenchOfficeGlossIndex {
  const byOfficeId = new Map<string, string>();
  const byZhDynasty = new Map<string, string>();
  const byZh = new Map<string, string>();

  for (const line of authorityPackLines(content)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let row: GlossRow;
    try {
      row = JSON.parse(trimmed) as GlossRow;
    } catch {
      continue;
    }
    const gloss = row.translation?.trim();
    if (!gloss) continue;
    // Prefer language:fr rows when present; accept untagged legacy rows.
    if (row.language && row.language !== 'fr') continue;

    for (const officeId of row.officeIds ?? []) {
      const key = officeId.trim();
      if (key && !byOfficeId.has(key)) byOfficeId.set(key, gloss);
    }
    const zh = normalizeZh(row.zh);
    if (!zh) continue;
    const zd = zhDynastyKey(zh, row.dynasty);
    if (!byZhDynasty.has(zd)) byZhDynasty.set(zd, gloss);
    if (!byZh.has(zh)) byZh.set(zh, gloss);
  }
  return { byOfficeId, byZhDynasty, byZh };
}

function officeEntityIdsForCandidate(candidate: AuthorityCandidate): string[] {
  const ids = new Set<string>();
  const meta = candidate.metadata;
  if (meta?.entityId) ids.add(meta.entityId);
  if (meta?.canonicalEntityId) ids.add(meta.canonicalEntityId);
  const source = String(candidate.source ?? '')
    .trim()
    .toLowerCase();
  if (source && candidate.authorityId) {
    ids.add(`${source}:office:${candidate.authorityId}`);
  }
  return [...ids];
}

function lookupFrenchGloss(
  index: FrenchOfficeGlossIndex,
  ids: string[],
  zh: string | undefined,
  dynasty: string | null | undefined,
): string | undefined {
  for (const id of ids) {
    const hit = index.byOfficeId.get(id);
    if (hit) return hit;
  }
  const name = normalizeZh(zh);
  if (!name) return undefined;
  if (dynasty) {
    const hit = index.byZhDynasty.get(zhDynastyKey(name, dynasty));
    if (hit) return hit;
  }
  return index.byZh.get(name);
}

/**
 * Fill `metadata.translation` (and refresh `description`) when the office pack
 * row has no *publishable* English gloss yet. CBDB's `[Not Yet Translated]`
 * counts as empty so Huckbot can fill.
 */
export function applyHuckbotGlossToCandidate(
  candidate: AuthorityCandidate,
  glosses: OfficeGlossIndex,
): AuthorityCandidate {
  if (candidate.kind !== 'office') return candidate;
  const existing = cleanPublishableOfficeGloss(candidate.metadata?.translation);
  if (existing) {
    if (existing === candidate.metadata?.translation?.trim()) return candidate;
    const dynasty = candidate.metadata?.dynasty;
    return {
      ...candidate,
      metadata: {
        ...candidate.metadata,
        translation: existing,
        description: formatOfficeClue(candidate.primaryName, existing, dynasty),
      },
    };
  }
  let gloss: string | undefined;
  for (const id of officeEntityIdsForCandidate(candidate)) {
    gloss = cleanPublishableOfficeGloss(glosses.get(id)) ?? undefined;
    if (gloss) break;
  }

  const dynasty = candidate.metadata?.dynasty;
  if (gloss) {
    return {
      ...candidate,
      metadata: {
        ...candidate.metadata,
        translation: gloss,
        description: formatOfficeClue(candidate.primaryName, gloss, dynasty),
      },
    };
  }

  // No pack row for this office (e.g. a place+suffix compound the offline
  // Huckbot run never enumerated) — try the same procedural template live.
  const procedural = tryProceduralOfficeTranslation(candidate.primaryName);
  if (!procedural) return candidate;
  return {
    ...candidate,
    metadata: {
      ...candidate.metadata,
      translation: procedural.en,
      translationSource: HUCKBOT_PROCEDURAL_SOURCE,
      description: formatOfficeClue(candidate.primaryName, procedural.en, dynasty),
    },
  };
}

/** Attach French gloss without touching English `translation`. */
export function applyMaxiRicciGlossToCandidate(
  candidate: AuthorityCandidate,
  glosses: FrenchOfficeGlossIndex,
): AuthorityCandidate {
  if (candidate.kind !== 'office') return candidate;
  const existingFr = cleanPublishableOfficeGloss(candidate.metadata?.translationFr);
  if (existingFr) {
    if (existingFr === candidate.metadata?.translationFr?.trim()) return candidate;
    return {
      ...candidate,
      metadata: { ...candidate.metadata, translationFr: existingFr },
    };
  }
  const gloss = cleanPublishableOfficeGloss(
    lookupFrenchGloss(
      glosses,
      officeEntityIdsForCandidate(candidate),
      candidate.primaryName,
      candidate.metadata?.dynasty,
    ),
  );
  if (gloss) {
    return {
      ...candidate,
      metadata: {
        ...candidate.metadata,
        translationFr: gloss,
      },
    };
  }

  const procedural = tryProceduralOfficeTranslation(candidate.primaryName);
  if (!procedural) return candidate;
  return {
    ...candidate,
    metadata: {
      ...candidate.metadata,
      translationFr: procedural.fr,
      translationFrSource: MAXIRICCI_PROCEDURAL_SOURCE,
    },
  };
}

/**
 * Fill any still-missing `translation`/`translationFr` via the Norbert
 * parentOf procedural template (太子/公主/親王 compounds), given the remainder
 * office's own gloss (pack- or zh-indexed, falling back to the place+suffix
 * template). Never overwrites an existing gloss in either language — runs
 * after {@link applyHuckbotGlossToCandidate}/{@link applyMaxiRicciGlossToCandidate}
 * as the last procedural tier.
 */
export function applyParentOfGlossToCandidate(
  candidate: AuthorityCandidate,
  parentOfIndex: ParentOfIndex,
  enZhGlosses: Map<string, string>,
  frZhGlosses: Map<string, string>,
): AuthorityCandidate {
  if (candidate.kind !== 'office') return candidate;
  const hasEn = Boolean(cleanPublishableOfficeGloss(candidate.metadata?.translation));
  const hasFr = Boolean(cleanPublishableOfficeGloss(candidate.metadata?.translationFr));
  if (hasEn && hasFr) return candidate;

  const resolved = tryParentOfTranslation(candidate.primaryName, parentOfIndex, (remainder) => ({
    en:
      cleanPublishableOfficeGloss(enZhGlosses.get(remainder)) ??
      tryProceduralOfficeTranslation(remainder)?.en,
    fr:
      cleanPublishableOfficeGloss(frZhGlosses.get(remainder)) ??
      tryProceduralOfficeTranslation(remainder)?.fr,
  }));
  if (!resolved) return candidate;

  const dynasty = candidate.metadata?.dynasty;
  const metadata = { ...candidate.metadata };
  if (!hasEn && resolved.en) {
    metadata.translation = resolved.en;
    metadata.translationSource = HUCKBOT_PARENTOF_SOURCE;
    metadata.description = formatOfficeClue(candidate.primaryName, resolved.en, dynasty);
  }
  if (!hasFr && resolved.fr) {
    metadata.translationFr = resolved.fr;
    metadata.translationFrSource = MAXIRICCI_PARENTOF_SOURCE;
  }
  return { ...candidate, metadata };
}

/** Same fill for lookup `PackRow` shapes (authority-pack-lookup). */
export function applyHuckbotGlossToPackRow<
  T extends {
    primaryName?: string;
    authorityId?: string;
    metadata?: AuthorityCandidate['metadata'];
  },
>(row: T, source: string, glosses: OfficeGlossIndex): T {
  const existing = cleanPublishableOfficeGloss(row.metadata?.translation);
  if (existing) {
    if (existing === row.metadata?.translation?.trim()) return row;
    const name = row.primaryName?.trim() || '';
    return {
      ...row,
      metadata: {
        ...row.metadata,
        translation: existing,
        description: formatOfficeClue(name, existing, row.metadata?.dynasty),
      },
    };
  }
  const ids = new Set<string>();
  if (row.metadata?.entityId) ids.add(row.metadata.entityId);
  if (row.metadata?.canonicalEntityId) ids.add(row.metadata.canonicalEntityId);
  const src = source.trim().toLowerCase();
  if (src && row.authorityId) ids.add(`${src}:office:${row.authorityId}`);

  let gloss: string | undefined;
  for (const id of ids) {
    gloss = cleanPublishableOfficeGloss(glosses.get(id)) ?? undefined;
    if (gloss) break;
  }

  const name = row.primaryName?.trim() || '';
  if (gloss) {
    return {
      ...row,
      metadata: {
        ...row.metadata,
        translation: gloss,
        description: formatOfficeClue(name, gloss, row.metadata?.dynasty),
      },
    };
  }

  const procedural = tryProceduralOfficeTranslation(name);
  if (!procedural) return row;
  return {
    ...row,
    metadata: {
      ...row.metadata,
      translation: procedural.en,
      translationSource: HUCKBOT_PROCEDURAL_SOURCE,
      description: formatOfficeClue(name, procedural.en, row.metadata?.dynasty),
    },
  };
}

export function applyMaxiRicciGlossToPackRow<
  T extends {
    primaryName?: string;
    authorityId?: string;
    metadata?: AuthorityCandidate['metadata'];
  },
>(row: T, source: string, glosses: FrenchOfficeGlossIndex): T {
  const existingFr = cleanPublishableOfficeGloss(row.metadata?.translationFr);
  if (existingFr) {
    if (existingFr === row.metadata?.translationFr?.trim()) return row;
    return { ...row, metadata: { ...row.metadata, translationFr: existingFr } };
  }

  const ids: string[] = [];
  if (row.metadata?.entityId) ids.push(row.metadata.entityId);
  if (row.metadata?.canonicalEntityId) ids.push(row.metadata.canonicalEntityId);
  const src = source.trim().toLowerCase();
  if (src && row.authorityId) ids.push(`${src}:office:${row.authorityId}`);

  const gloss = cleanPublishableOfficeGloss(
    lookupFrenchGloss(glosses, ids, row.primaryName, row.metadata?.dynasty),
  );
  if (gloss) {
    return {
      ...row,
      metadata: {
        ...row.metadata,
        translationFr: gloss,
      },
    };
  }

  const procedural = tryProceduralOfficeTranslation(row.primaryName?.trim() || '');
  if (!procedural) return row;
  return {
    ...row,
    metadata: {
      ...row.metadata,
      translationFr: procedural.fr,
      translationFrSource: MAXIRICCI_PROCEDURAL_SOURCE,
    },
  };
}

/** Same parentOf fill as {@link applyParentOfGlossToCandidate}, for lookup `PackRow` shapes. */
export function applyParentOfGlossToPackRow<
  T extends {
    primaryName?: string;
    authorityId?: string;
    metadata?: AuthorityCandidate['metadata'];
  },
>(
  row: T,
  parentOfIndex: ParentOfIndex,
  enZhGlosses: Map<string, string>,
  frZhGlosses: Map<string, string>,
): T {
  const hasEn = Boolean(cleanPublishableOfficeGloss(row.metadata?.translation));
  const hasFr = Boolean(cleanPublishableOfficeGloss(row.metadata?.translationFr));
  if (hasEn && hasFr) return row;

  const name = row.primaryName?.trim() || '';
  const resolved = tryParentOfTranslation(name, parentOfIndex, (remainder) => ({
    en:
      cleanPublishableOfficeGloss(enZhGlosses.get(remainder)) ??
      tryProceduralOfficeTranslation(remainder)?.en,
    fr:
      cleanPublishableOfficeGloss(frZhGlosses.get(remainder)) ??
      tryProceduralOfficeTranslation(remainder)?.fr,
  }));
  if (!resolved) return row;

  const dynasty = row.metadata?.dynasty;
  const metadata = { ...row.metadata };
  if (!hasEn && resolved.en) {
    metadata.translation = resolved.en;
    metadata.translationSource = HUCKBOT_PARENTOF_SOURCE;
    metadata.description = formatOfficeClue(name, resolved.en, dynasty);
  }
  if (!hasFr && resolved.fr) {
    metadata.translationFr = resolved.fr;
    metadata.translationFrSource = MAXIRICCI_PARENTOF_SOURCE;
  }
  return { ...row, metadata };
}

let glossIndexPromise: Promise<OfficeGlossIndex> | null = null;
let frenchGlossIndexPromise: Promise<FrenchOfficeGlossIndex> | null = null;
let parentOfIndexPromise: Promise<ParentOfIndex> | null = null;
let huckbotZhGlossIndexPromise: Promise<Map<string, string>> | null = null;

type PackReader = (packId: AuthorityPackId) => Promise<AuthorityPackContent>;

/**
 * Session-cached Huckbot gloss index. Missing pack → empty map (older installs).
 */
export function loadHuckbotGlossIndex(readPack: PackReader): Promise<OfficeGlossIndex> {
  if (!glossIndexPromise) {
    const publicGlosses = readPack(HUCKBOT_TRANSLATIONS_PACK_ID)
      .then((content) => buildHuckbotGlossIndex(content))
      .catch(() => new Map<string, string>());
    const insiderGlosses = readPack(HUCKBOT_INSIDERS_PACK_ID)
      .then((content) => buildHuckbotGlossIndex(content))
      .catch(() => new Map<string, string>());
    glossIndexPromise = Promise.all([publicGlosses, insiderGlosses]).then(
      ([published, insiders]) => {
        for (const [key, gloss] of insiders) {
          if (!published.has(key)) published.set(key, gloss);
        }
        return published;
      },
    );
  }
  return glossIndexPromise;
}

export function loadMaxiRicciGlossIndex(readPack: PackReader): Promise<FrenchOfficeGlossIndex> {
  if (!frenchGlossIndexPromise) {
    frenchGlossIndexPromise = readPack(MAXIRICCI_TRANSLATIONS_PACK_ID)
      .then((content) => buildMaxiRicciGlossIndex(content))
      .catch(() => ({ byOfficeId: new Map(), byZhDynasty: new Map(), byZh: new Map() }));
  }
  return frenchGlossIndexPromise;
}

/** Session-cached Norbert parentOf index. Missing pack → empty map (older installs). */
export function loadParentOfIndex(readPack: PackReader): Promise<ParentOfIndex> {
  if (!parentOfIndexPromise) {
    parentOfIndexPromise = readPack(NORBERT_OFFICE_RELATIONS_PACK_ID)
      .then((content) => buildParentOfIndex(content))
      .catch(() => new Map() as ParentOfIndex);
  }
  return parentOfIndexPromise;
}

/** Session-cached zh → English gloss index, for parentOf remainder resolution. */
export function loadHuckbotZhGlossIndex(readPack: PackReader): Promise<Map<string, string>> {
  if (!huckbotZhGlossIndexPromise) {
    huckbotZhGlossIndexPromise = readPack(HUCKBOT_TRANSLATIONS_PACK_ID)
      .then((content) => buildHuckbotZhGlossIndex(content))
      .catch(() => new Map<string, string>());
  }
  return huckbotZhGlossIndexPromise;
}

/** Drop cached gloss indexes (call with pack-content cache clears after reinstall). */
export function clearHuckbotGlossIndexCache(): void {
  glossIndexPromise = null;
  huckbotZhGlossIndexPromise = null;
}

export function clearMaxiRicciGlossIndexCache(): void {
  frenchGlossIndexPromise = null;
}

export function clearParentOfIndexCache(): void {
  parentOfIndexPromise = null;
}

export function clearOfficeGlossIndexCaches(): void {
  clearHuckbotGlossIndexCache();
  clearMaxiRicciGlossIndexCache();
  clearParentOfIndexCache();
}
