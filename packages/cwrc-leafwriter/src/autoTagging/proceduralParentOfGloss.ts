/**
 * In-app procedural translations for compound offices linked by Norbert
 * `parentOf` edges (e.g. 太子 + 右庶子 → 太子右庶子, "Right Serviceman of the
 * Heir Apparent"). Ported from the offline Huckbot5000 script
 * (`authoritypacks/huckbot5000/proceduralParentOf.mjs`) so the same reviewed
 * template applies live, the same way `proceduralOfficeGloss.ts` already does
 * for place+suffix compounds.
 *
 * Deliberately conservative: `ALLOWED_PARENTS` covers only the three parents
 * already reviewed offline (household titles where "{X} of the {parent}"
 * reads correctly in both languages). Ministry-style parents (尚書, 司徒, …)
 * are NOT included here — many of Norbert's other frequent parent strings are
 * rank/verbal modifiers (領, 都督, 開府, 平, …), not nouns, and "{X} of the
 * {parent}" would be nonsense for those. Expanding the allowlist needs a
 * per-parent review pass, not a blind addition.
 */
import { authorityPackLines, type AuthorityPackContent } from './packLoader';

const CJK_ONLY = /^[一-鿿]+$/;

/** Parents where "{role} of the {parent}" matches Hucker-style English. */
export const ALLOWED_PARENTS = new Set(['太子', '公主', '親王']);

/** Remainder must be at least this many characters. */
export const MIN_REMAINDER_LEN = 2;

/** Stable parent glosses for the allowlist. */
export const DEFAULT_PARENT_GLOSS_EN: Record<string, string> = {
  太子: 'Heir Apparent',
  公主: 'Imperial Princess',
  親王: 'Prince',
};

/** French composed as a full prepositional phrase (article agreement varies by parent). */
export const DEFAULT_PARENT_PHRASE_FR: Record<string, string> = {
  太子: "de l'héritier du trône",
  公主: 'de la princesse impériale',
  親王: 'du prince',
};

export interface ParentOfEdge {
  parent: string;
  child: string;
  relationId: string;
}

export type ParentOfIndex = Map<string, ParentOfEdge>;

interface OfficeRelationRow {
  type?: string;
  id?: string;
  evidence?: { labels?: string[] };
}

/** Build child-name → parentOf edge index from `norbert/office-relations.ndjson`. */
export function buildParentOfIndex(content: AuthorityPackContent): ParentOfIndex {
  const byChild: ParentOfIndex = new Map();
  for (const line of authorityPackLines(content)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let row: OfficeRelationRow;
    try {
      row = JSON.parse(trimmed) as OfficeRelationRow;
    } catch {
      continue;
    }
    if (row.type !== 'parentOf') continue;
    const labels = row.evidence?.labels;
    const parent = String(labels?.[0] ?? '')
      .normalize('NFKC')
      .trim();
    const child = String(labels?.[1] ?? '')
      .normalize('NFKC')
      .trim();
    if (!parent || !child) continue;
    if (!ALLOWED_PARENTS.has(parent)) continue;
    if (!child.startsWith(parent) || child.length <= parent.length) continue;
    const remainder = child.slice(parent.length);
    if (remainder.length < MIN_REMAINDER_LEN || !CJK_ONLY.test(remainder)) continue;
    if (!byChild.has(child)) {
      byChild.set(child, { parent, child, relationId: row.id ?? `${parent}:${child}` });
    }
  }
  return byChild;
}

export interface ProceduralParentOfGloss {
  en?: string;
  fr?: string;
  parent: string;
  remainder: string;
  relationId: string;
}

/**
 * Try the parentOf template against a roleName, given a resolver for the
 * remainder office's own gloss (pack lookup and/or the place+suffix
 * procedural template — the caller decides what counts as "already glossed").
 */
export function tryParentOfTranslation(
  zh: string,
  index: ParentOfIndex,
  resolveRemainderGloss: (remainder: string) => { en?: string | null; fr?: string | null },
): ProceduralParentOfGloss | null {
  const name = String(zh ?? '')
    .normalize('NFKC')
    .trim();
  const edge = index.get(name);
  if (!edge) return null;

  const remGloss = resolveRemainderGloss(edge.child.slice(edge.parent.length));
  const parentGlossEn = DEFAULT_PARENT_GLOSS_EN[edge.parent];
  const parentPhraseFr = DEFAULT_PARENT_PHRASE_FR[edge.parent];

  let en: string | undefined;
  if (
    remGloss.en &&
    parentGlossEn &&
    !remGloss.en.toLowerCase().includes(parentGlossEn.toLowerCase())
  ) {
    en = `${remGloss.en} of the ${parentGlossEn}`;
  }
  let fr: string | undefined;
  if (
    remGloss.fr &&
    parentPhraseFr &&
    !remGloss.fr.toLowerCase().includes(parentPhraseFr.toLowerCase())
  ) {
    fr = `${remGloss.fr} ${parentPhraseFr}`;
  }
  if (!en && !fr) return null;

  return {
    en,
    fr,
    parent: edge.parent,
    remainder: edge.child.slice(edge.parent.length),
    relationId: edge.relationId,
  };
}
