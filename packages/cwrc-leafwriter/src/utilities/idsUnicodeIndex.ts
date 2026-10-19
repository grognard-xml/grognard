import idsUnicodeIndexData from '../resources/ids/idsUnicodeIndex.json';

/**
 * Phase A of the composer visual redesign (see
 * plugins/composer-visual-redesign.md §3): "does this exact IDS composition
 * already correspond to a real, assigned Unicode character?" - the check
 * zi.tools performs first, before anything else, and which CHHIV was
 * missing (its own Route A check only caught the narrower case of a
 * specific GlyphWiki entry named after a bare codepoint).
 *
 * Bundled from the CHISE IDS project's `ids.txt` (via
 * github.com/cjkvi/cjkvi-ids, GPL-2.0-or-later - see THIRD_PARTY_NOTICES.md)
 * as an exact-match `[idsString, character]` lookup table - see
 * scripts/build-ids-unicode-index.mjs. This is a different shape of lookup
 * from glyphwikiIndex.ts's unordered component-pair search: an IDS string is
 * a fully specified structure (operator + ordered components), so the match
 * is exact-or-nothing, not "which entries contain both of these."
 */

type RawEntry = [ids: string, char: string];

const RAW_ENTRIES = idsUnicodeIndexData as unknown as RawEntry[];

let byIds: Map<string, string> | null = null;

const index = (): Map<string, string> => {
  if (byIds) return byIds;
  byIds = new Map(RAW_ENTRIES);
  return byIds;
};

/** The already-assigned Unicode character for this exact IDS string (e.g.
 * "⿰言某" -> "謀"), or `null` if this exact structure has no standard
 * decomposition on record - most compositions won't match, but per
 * composer-visual-redesign.md's own empirical check, a real fraction do. */
export const findEncodedCharacterForIds = (ids: string): string | null => index().get(ids) ?? null;

let byChar: Map<string, string[]> | null = null;

const reverseIndex = (): Map<string, string[]> => {
  if (byChar) return byChar;
  byChar = new Map();
  for (const [rawIds, char] of RAW_ENTRIES) {
    // The bundled data has one entry with a leftover regional tag (`[O]"`).
    const ids = rawIds.replace(/\[[A-Z,]*\]"?$/, '');
    // A character that decomposes to itself (a stroke, a radical) is atomic.
    if (ids === char) continue;
    const list = byChar.get(char);
    if (!list) byChar.set(char, [ids]);
    else if (!list.includes(ids)) list.push(ids);
  }
  return byChar;
};

/** Every IDS the data records for this character (e.g. "謀" -> ["⿰言某"]), in
 * the data's own order, or `[]` when it cannot be broken apart: an atomic
 * component, a character the data has no entry for, or anything that is not a
 * single character. Only the first code point is considered. */
export const findIdsDecompositions = (input: string): string[] => {
  const char = Array.from(input.trim())[0];
  if (!char) return [];
  return reverseIndex().get(char) ?? [];
};
