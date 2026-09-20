import {
  CBDB_PERSON_URL,
  DILA_URL,
  WIKIDATA_ITEM_URL,
} from '../../../../../packages/cwrc-leafwriter/src/autoTagging/disambiguationCandidates';
import type { AuthorityId } from '../../../../../packages/cwrc-leafwriter/src/autoTagging/entities';

/** Lookup URL for an authority idno, or null when no viewer exists for it. */
export function authorityLookupUrl(ref: AuthorityId): string | null {
  const value = ref.value.trim();
  if (/^https?:\/\//i.test(value)) return value;

  const type = ref.type.toLowerCase();
  if (type === 'wikidata') {
    const qid = value.match(/^Q\d+$/i)?.[0];
    return qid ? WIKIDATA_ITEM_URL(qid.toUpperCase()) : null;
  }
  if (type === 'cbdb') return CBDB_PERSON_URL(value);
  if (type === 'dila') return DILA_URL(value);
  if (type === 'viaf' && /^\d+$/.test(value)) return `https://viaf.org/viaf/${value}`;
  return null;
}
