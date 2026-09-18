import type { EntitySummary } from './entityOps';
import type { EntityKind } from './entities';
import type { NameTypeId } from './nameTypes';

export interface SqlitePanelSummaryLike {
  id: string;
  kind: EntityKind;
  description: string | null;
  subtype: string | null;
  names: {
    text: string;
    nameType: string | null;
    language: string | null;
    status: 'active' | 'rejected' | 'withdrawn';
  }[];
  authorities: { type: string; value: string }[];
  familyName: string | null;
  givenName: string | null;
  startYear: number | null;
  endYear: number | null;
  workDate: EntitySummary['workDate'];
  workType: EntitySummary['workType'];
  location?: EntitySummary['location'];
  nationalities: string[];
  placesOfOrigin: string[];
  roles: string[];
  origins: EntitySummary['origins'];
  authors: EntitySummary['authors'];
  nobleTitles: EntitySummary['nobleTitles'];
  assertions: EntitySummary['assertions'];
  rejectedConcordances?: EntitySummary['rejectedConcordances'];
}

export function entitySummaryFromSqlite(snapshot: SqlitePanelSummaryLike): EntitySummary {
  const names = snapshot.names.filter((name) => name.status === 'active');
  const assertions = snapshot.assertions;
  return {
    id: snapshot.id,
    kind: snapshot.kind,
    names: names.map((name) => name.text),
    nameEntries: names.map((name) => ({
      text: name.text,
      lang: name.language,
      type: (name.nameType || null) as NameTypeId | null,
    })),
    romanized: names.find((name) => name.language?.endsWith('-Latn'))?.text ?? null,
    description: snapshot.description,
    subtype: snapshot.subtype,
    authorities: snapshot.authorities,
    familyName: snapshot.familyName,
    givenName: snapshot.givenName,
    startYear: snapshot.startYear,
    endYear: snapshot.endYear,
    workDate: snapshot.workDate,
    workType: snapshot.workType,
    location: snapshot.location ?? null,
    nationalities: snapshot.nationalities,
    placesOfOrigin: snapshot.placesOfOrigin,
    authors: snapshot.authors.filter((author) => author.status === 'active'),
    nobleTitles: snapshot.nobleTitles.filter((title) => title.status === 'active'),
    roles: snapshot.roles,
    origins: snapshot.origins,
    rejectedCount: assertions.filter((assertion) => assertion.status === 'rejected').length,
    rejectedAssertions: assertions
      .filter((assertion) => assertion.status === 'rejected')
      .map((assertion) => ({
        element: assertion.element,
        value: assertion.value,
        source: assertion.source,
      })),
    rejectedConcordances: snapshot.rejectedConcordances ?? [],
    assertions,
  };
}
