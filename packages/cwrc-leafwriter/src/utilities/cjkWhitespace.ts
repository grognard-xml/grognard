/**
 * Whitespace cleanup for East Asian no-space scripts (Chinese, Japanese,
 * Korean, Tibetan). Source XML is often pretty-printed with spaces and line
 * breaks between characters; in these scripts that whitespace is not part of
 * the text and shows as spurious gaps in WYSIWYG.
 *
 * The rule is character-based, not language-based: a whitespace run is removed
 * only when it sits between characters in a no-space East Asian script (and
 * never when a Latin/word character is on either side). That makes it safe to
 * run on any document regardless of its declared language — Latin text is left
 * untouched — so callers don't need reliable language metadata.
 *
 * This includes the ideographic space U+3000 that Mandoku/Kanripo inserts
 * between citations: Chinese does not use inter-character space, so leaving
 * those in produces gaps next to punctuation (e.g. around 「」).
 */

// No-space East Asian scripts, plus CJK symbols/punctuation and full/half-width
// forms (so whitespace around 、。「」（）《》 etc. is also cleaned).
const EAST_ASIAN =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Tibetan}\p{Script=Bopomofo}\u3000-〿︰-﹏＀-￯]/u;

/** Any Unicode whitespace, including the ideographic space U+3000. */
const isStrippableWhitespace = (ch: string): boolean => /\s/u.test(ch);

const isEastAsian = (ch: string): boolean => ch !== '' && EAST_ASIAN.test(ch);

/** A character from a script that uses inter-word spaces (keep spacing around it). */
const isSpacedWordChar = (ch: string): boolean => ch !== '' && /[0-9A-Za-zÀ-ɏ]/.test(ch);

/**
 * Remove whitespace between East Asian characters (ASCII spaces, newlines,
 * exotic paste spaces, and the ideographic space U+3000). A run is dropped when
 * at least one neighbour is East Asian and neither neighbour is a spaced-word
 * (Latin) character; a run between two Latin words collapses to one space;
 * anything else is left as-is.
 */
export function stripCjkWhitespace(text: string): string {
  let out = '';
  let i = 0;
  const n = text.length;
  while (i < n) {
    const ch = text[i]!;
    if (!isStrippableWhitespace(ch)) {
      out += ch;
      i += 1;
      continue;
    }
    let j = i;
    while (j < n && isStrippableWhitespace(text[j]!)) j += 1;
    const prev = out.length > 0 ? out[out.length - 1]! : '';
    const next = j < n ? text[j]! : '';

    if (
      (isEastAsian(prev) || isEastAsian(next)) &&
      !isSpacedWordChar(prev) &&
      !isSpacedWordChar(next)
    ) {
      // between East Asian characters (or trimming next to one) — drop it
    } else if (isSpacedWordChar(prev) && isSpacedWordChar(next)) {
      out += ' ';
    } else {
      out += text.slice(i, j); // unknown context — don't damage
    }
    i = j;
  }
  return out;
}

/** Apply {@link stripCjkWhitespace} to every text node under `root`, in place. */
export function stripCjkWhitespaceInElement(root: Node): void {
  const doc = root.ownerDocument ?? (root as Document);
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    const text = node as Text;
    const cleaned = stripCjkWhitespace(text.data);
    if (cleaned !== text.data) text.data = cleaned;
    node = walker.nextNode();
  }
}
