/**
 * Book-title marks that people put inside `<title>` (and `<bibl>`): 《》
 * (Taiwan, mainland), 〈〉 (article titles), 『』 (Japan) and their vertical
 * presentation forms. They are typography, not part of the work's name, so
 * they are stripped before a surface is looked up or saved to an entity
 * database - `《史記》` and `史記` must find, and become, the same entity.
 *
 * 「」 are also an article-title mark in Japanese, but ordinarily quotation
 * marks, so they are removed only when they wrap the whole string.
 */
const TITLE_MARKS = /[《》〈〉『』︽︾︿﹀﹃﹄]/gu;
const WRAPPING_CORNER_QUOTES = /^[「﹁]([^「」﹁﹂]*)[」﹂]$/u;

export function stripTitleMarks(text: string): string {
  const stripped = text.replace(TITLE_MARKS, '').trim();
  const wrapped = WRAPPING_CORNER_QUOTES.exec(stripped);
  return wrapped ? wrapped[1].trim() : stripped;
}
