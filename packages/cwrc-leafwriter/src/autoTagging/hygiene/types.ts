import type { EntityKind } from '../entities';
import type { EntitySummary, NameEntry } from '../entityOps';
import type { NameTypeId } from '../nameTypes';
import type { EntityDataAssertion } from '../../plugins/entityDataExtractors';

/** Peer shown on the right review card — another Grognard entity or an authority pack hit. */
export type HygienePeer =
  | { kind: 'entity'; entityId: string }
  | {
      kind: 'authority';
      authorityType: string;
      authorityValue: string;
      primaryName: string;
      romanized?: string | null;
      familyName?: string | null;
      givenName?: string | null;
      courtesyNames?: string[];
      startYear?: number | null;
      endYear?: number | null;
      nationalities?: string[];
      description?: string | null;
      names?: NameEntry[];
    };

export type HygieneFindingKind =
  | 'familyPrefixedAltName'
  | 'missingFamilyOrGiven'
  | 'badRomanization'
  | 'badPrimary'
  | 'emptyDescription'
  | 'rejectedBlockingGoodName'
  | 'authorityIdDuplicate'
  | 'nearDuplicate'
  | 'unlinkedAuthorityHit'
  | 'harvestWrapper';

export type HygieneProposal =
  | {
      action: 'stripAltName';
      fromText: string;
      toText: string;
      nameType: NameTypeId;
    }
  | {
      action: 'setFamilyGiven';
      familyName: string;
      givenName: string;
      romanizedName?: string | null;
    }
  | { action: 'setRomanized'; text: string }
  | { action: 'renamePrimary'; text: string }
  | { action: 'setDescription'; text: string }
  | { action: 'restoreName'; assertionKey: string; text: string }
  | { action: 'merge'; keepId: string; dropIds: string[] }
  | { action: 'markDuplicateIntentional'; entityIds: string[] }
  | {
      action: 'attachAuthority';
      authorityType: string;
      authorityValue: string;
    }
  | {
      action: 'ingestHarvest';
      documentKey: string;
      source: string;
      assertions: EntityDataAssertion[];
    };

export interface HygieneFinding {
  id: string;
  kind: HygieneFindingKind;
  /** Left-card entity (stored Grognard record). */
  entityId: string;
  /** Extra entity ids involved (merge / near-dup / authority-id dup). */
  relatedEntityIds?: string[];
  peer?: HygienePeer;
  /** Short human-readable why this was flagged. */
  evidence: string;
  proposal: HygieneProposal;
}

/** Display shape shared by both review cards. */
export interface CompareCardModel {
  title: string;
  subtitle?: string;
  kind?: EntityKind;
  primaryName: string | null;
  romanized: string | null;
  familyName: string | null;
  givenName: string | null;
  otherNames: NameEntry[];
  startYear: number | null;
  endYear: number | null;
  nationalities: string[];
  placesOfOrigin: string[];
  roles?: string[];
  nobleTitles?: string[];
  description: string | null;
  /** thing kind only: user-defined sub-category id. */
  subtype?: string | null;
  /** place kind only: the currently accepted coordinate + its source. */
  location?: { lat: number; lon: number; source: string | null } | null;
  authorities: { type: string; value: string }[];
  /** Field keys to lightly highlight as differing / proposed. */
  highlightFields?: string[];
}

export function entityToCompareCard(
  entity: EntitySummary,
  options?: { title?: string; highlightFields?: string[] },
): CompareCardModel {
  const otherNames = entity.nameEntries.filter(
    (entry) =>
      entry.type !== 'family' &&
      entry.type !== 'given' &&
      entry.type !== 'primary' &&
      !entry.lang?.endsWith('-Latn'),
  );
  return {
    title: options?.title ?? entity.names[0] ?? entity.id,
    subtitle: entity.id,
    kind: entity.kind,
    primaryName: entity.names[0] ?? null,
    romanized: entity.romanized,
    familyName: entity.familyName,
    givenName: entity.givenName,
    otherNames,
    startYear: entity.startYear,
    endYear: entity.endYear,
    location: entity.location ?? null,
    nationalities: entity.nationalities,
    placesOfOrigin: entity.placesOfOrigin,
    roles: entity.roles,
    nobleTitles: entity.nobleTitles.map(
      (title) =>
        [title.fief, title.posthumousName, title.title].filter(Boolean).join('') || title.title,
    ),
    description: entity.description,
    subtype: entity.subtype,
    authorities: entity.authorities,
    highlightFields: options?.highlightFields,
  };
}

export function authorityPeerToCompareCard(
  peer: Extract<HygienePeer, { kind: 'authority' }>,
): CompareCardModel {
  return {
    title: peer.primaryName,
    subtitle: `${peer.authorityType}: ${peer.authorityValue}`,
    primaryName: peer.primaryName,
    romanized: peer.romanized ?? null,
    familyName: peer.familyName ?? null,
    givenName: peer.givenName ?? null,
    otherNames:
      peer.names ??
      (peer.courtesyNames ?? []).map((text) => ({ text, lang: null, type: 'courtesy' as const })),
    startYear: peer.startYear ?? null,
    endYear: peer.endYear ?? null,
    nationalities: peer.nationalities ?? [],
    placesOfOrigin: [],
    description: peer.description ?? null,
    authorities: [{ type: peer.authorityType, value: peer.authorityValue }],
  };
}

/** Right-card preview of harvested wrapper facts not yet on the entity. */
export function harvestProposalToCompareCard(
  finding: HygieneFinding,
  entityName?: string,
): CompareCardModel | null {
  if (finding.proposal.action !== 'ingestHarvest') return null;
  const assertions = finding.proposal.assertions;
  const nationalities: string[] = [];
  const placesOfOrigin: string[] = [];
  const roles: string[] = [];
  const nobleTitles: string[] = [];
  for (const assertion of assertions) {
    if (assertion.element === 'nationality') nationalities.push(assertion.value);
    else if (assertion.element === 'placeName') placesOfOrigin.push(assertion.value);
    else if (assertion.element === 'state' || assertion.element === 'affiliation') {
      roles.push(assertion.value);
    } else if (assertion.element === 'nobleTitle') nobleTitles.push(assertion.value);
  }
  return {
    title: 'Harvested',
    subtitle: finding.proposal.source,
    primaryName: entityName ?? null,
    romanized: null,
    familyName: null,
    givenName: null,
    otherNames: [],
    startYear: null,
    endYear: null,
    nationalities,
    placesOfOrigin,
    roles,
    nobleTitles,
    description: finding.evidence,
    authorities: [],
    highlightFields: [
      ...(nationalities.length ? ['nationalities'] : []),
      ...(placesOfOrigin.length ? ['origins'] : []),
      ...(roles.length ? ['roles'] : []),
      ...(nobleTitles.length ? ['nobleTitles'] : []),
    ],
  };
}
