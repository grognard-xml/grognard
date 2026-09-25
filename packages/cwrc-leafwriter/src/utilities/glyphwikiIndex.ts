/**
 * Phase 2 "find before compose" lookup (see plugins/glyph_maker.md §7-9,
 * Phase 2): does GlyphWiki already have a glyph combining two given
 * components? Deliberately scoped narrower than a general GlyphWiki search:
 *
 * - Direct-containment only, not gwsearch's full nested-component DAG - it
 *   answers "does some glyph use exactly A and B as its two direct parts",
 *   which is exactly what a two-component composer ever needs to ask.
 * - Restricted, when the bundle was built, to compounds whose both direct
 *   components are already in kageCore.json (the composer's own component
 *   vocabulary) - see scripts/build-glyphwiki-compound-index.mjs. That
 *   guarantees every candidate this module can ever return is renderable
 *   with data already bundled, with no extra network/geometry fetch.
 *
 * Bundled as static JSON (like kageCore.json), same rationale: this is a
 * filtered slice of GlyphWiki's dump, not the full ~295 MB thing - see the
 * decision-gate numbers this module's own build script reports.
 */

import glyphwikiCompoundIndexData from '../resources/glyphwiki/glyphwikiCompoundIndex.json';

export interface GlyphwikiCandidate {
  /** The GlyphWiki entry name this candidate is registered under, e.g. "abyterus_g0000". */
  name: string;
  /** This candidate's own KAGE data (its two "99:" component records). */
  kageData: string;
  componentA: string;
  componentB: string;
}

/** [name, kageData, componentA, componentB] tuples - compact form to avoid
 * repeating four JSON key names across 280k+ entries (see
 * scripts/build-glyphwiki-compound-index.mjs). */
type RawEntry = [string, string, string, string];

const RAW_ENTRIES = glyphwikiCompoundIndexData as unknown as RawEntry[];

const pairKey = (a: string, b: string): string => [a, b].sort().join('\u0000');

let byPair: Map<string, GlyphwikiCandidate[]> | null = null;

const index = (): Map<string, GlyphwikiCandidate[]> => {
  if (byPair) return byPair;
  byPair = new Map();
  for (const [name, kageData, componentA, componentB] of RAW_ENTRIES) {
    const entry: GlyphwikiCandidate = { name, kageData, componentA, componentB };
    const key = pairKey(componentA, componentB);
    const existing = byPair.get(key);
    if (existing) existing.push(entry);
    else byPair.set(key, [entry]);
  }
  return byPair;
};

/** Every bundled GlyphWiki entry that combines `componentA` and `componentB`
 * as its two direct components, in either order - independent of which IDS
 * operator/layout the composer's own preview currently has selected, since
 * GlyphWiki's actual geometry for the same pair may use a different shape
 * than the composer's default box formula. */
export const findGlyphwikiCandidates = (
  componentA: string,
  componentB: string,
): GlyphwikiCandidate[] => index().get(pairKey(componentA, componentB)) ?? [];
