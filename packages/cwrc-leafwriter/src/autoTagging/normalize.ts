import type { WhitespacePolicy } from './types';

/**
 * Search text derived from a raw string, with a map from each search-text
 * index back to the raw offset it came from.
 */
export interface SearchText {
  text: string;
  /** map[i] = offset in the raw string of search-text char i. Length === text.length. */
  map: number[];
}

const isWhitespace = (char: string) => /\s/.test(char);

/**
 * Characters with no visible extent that must never take part in matching:
 * zero-width space, the joiners and the soft hyphen. Editors and pasted text
 * seed these into text nodes (TinyMCE's own U+FEFF markers are already
 * covered — JavaScript counts that one as whitespace), and a search text that
 * kept them would stop matching anchors built from the serialized XML.
 */
const isInvisible = (char: string) =>
  char === '\uFEFF' ||
  char === '\u200B' ||
  char === '\u200C' ||
  char === '\u200D' ||
  char === '\u00AD';

// --- Tibetan mark handling (shared by buildSearchText, the LLM matcher and the string matcher) ---

/** Non-breaking tsheg U+0F0C \u2192 plain tsheg U+0F0B: a display variant, length-preserving. */
const NON_BREAKING_TSHEG_CHAR = '\u0F0C';
const NON_BREAKING_TSHEG = /\u0F0C/g;
const PLAIN_TSHEG = '\u0F0B';

/**
 * Tibetan mark block, tsheg (U+0F0B) through gter-tsheg (U+0F14) \u2014 the
 * intersyllabic tsheg, the non-breaking tsheg and the shad family \u2014 plus
 * whitespace, anchored to a string edge.
 */
const TIBETAN_EDGE_MARKS = /^[\u0F0B-\u0F14\s]+|[\u0F0B-\u0F14\s]+$/g;

/** Any Tibetan code point (used to gate Tibetan-only rules cheaply). */
export const hasTibetan = (text: string): boolean => /[\u0F00-\u0FFF]/.test(text);

/** Fold the non-breaking tsheg to the plain tsheg everywhere in `text`. */
export const foldNonBreakingTsheg = (text: string): string =>
  text.replace(NON_BREAKING_TSHEG, PLAIN_TSHEG);

/** Strip tsheg / shad / whitespace from both ends of `text`. */
export const trimTibetanEdgeMarks = (text: string): string => text.replace(TIBETAN_EDGE_MARKS, '');

/**
 * Normalize an authority / dictionary string into a match key: NFC, fold the
 * non-breaking tsheg, and drop a leading or trailing tsheg / shad (authority
 * headwords are cited with a terminal shad the running text almost never
 * carries at that spot). A no-op for text without Tibetan marks.
 */
export function normalizeMatchPattern(pattern: string): string {
  const nfc = Array.from(pattern.normalize('NFC'))
    .filter((char) => !isInvisible(char))
    .join('');
  if (!hasTibetan(nfc)) return nfc;
  return trimTibetanEdgeMarks(foldNonBreakingTsheg(nfc));
}

/**
 * True when `char` (or end-of-string, passed as undefined) is a legitimate
 * right/left edge for a Tibetan match: a tsheg, a shad, whitespace, the
 * string edge, or the a-chung U+0F60 that begins the genitive/agentive
 * particles which fuse onto the previous syllable without a tsheg. Anything
 * else \u2014 a base letter, a vowel sign, a subjoined consonant \u2014 means the match
 * cut a syllable in half.
 */
export function isTibetanEdgeChar(char: string | undefined): boolean {
  if (char === undefined) return true;
  if (/\s/.test(char)) return true;
  const cp = char.codePointAt(0)!;
  if (cp >= 0x0f0b && cp <= 0x0f14) return true;
  return cp === 0x0f60;
}

/**
 * NFC-normalize every text node under root, in place. This is the single
 * central normalization point: anchors are created and resolved against
 * NFC text, and nothing downstream normalizes independently.
 */
export function normalizeDomText(root: Node): void {
  const doc = root.ownerDocument ?? (root as Document);
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    const text = node as Text;
    const nfc = text.data.normalize('NFC');
    if (nfc !== text.data) text.data = nfc;
    node = walker.nextNode();
  }
}

/**
 * Build search text from a raw (already NFC) string under the given
 * whitespace policy, keeping a map back to raw offsets.
 *
 * Tibetan overrides, applied whenever the node holds Tibetan script:
 *  - whitespace is collapsed, never deleted, even under the `'ignore'` policy.
 *    Tibetan is scriptio continua with an explicit syllable dot (tsheg), so a
 *    space in the source (after a shad, in modern prose, from OCR) is a real
 *    separator — deleting it would fuse two syllables into a form that is
 *    neither a word nor a valid match. (Mapping such a space to a tsheg so a
 *    matcher can cross it is a further step, deliberately not taken here.)
 *  - the non-breaking tsheg U+0F0C is folded to the plain tsheg U+0F0B, a
 *    length-preserving swap of a display variant so it matches pack keys.
 * A Tibetan node with no whitespace and no U+0F0C is unchanged — its hash,
 * and therefore existing anchors, are unaffected.
 */
export function buildSearchText(raw: string, policy: WhitespacePolicy): SearchText {
  const chars: string[] = [];
  const map: number[] = [];
  let pendingSpace = false;
  const tibetan = hasTibetan(raw);
  const collapse = policy === 'collapse' || tibetan;

  for (let i = 0; i < raw.length; i++) {
    const char = raw[i]!;
    if (isInvisible(char)) continue;
    if (isWhitespace(char)) {
      if (collapse) pendingSpace = true;
      continue;
    }
    if (pendingSpace && chars.length > 0) {
      chars.push(' ');
      map.push(map[map.length - 1]! + 1);
    }
    pendingSpace = false;
    chars.push(tibetan && char === NON_BREAKING_TSHEG_CHAR ? PLAIN_TSHEG : char);
    map.push(i);
  }

  return { text: chars.join(''), map };
}

/** FNV-1a 32-bit hash, hex-encoded. Used to detect stale anchors, not for security. */
export function hashText(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
