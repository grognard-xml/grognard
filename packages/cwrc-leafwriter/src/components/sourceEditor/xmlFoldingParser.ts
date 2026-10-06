/**
 * Tag-aware fold analysis for the XML source editor. Pure text in, plain data
 * out, so it can be unit-tested without Monaco.
 *
 * Why not Monaco's default (indentation) folding: TEI paragraphs mix text and
 * inline elements on long lines, so indentation does not follow nesting.
 */

export interface XmlFoldRegion {
  /** 1-based first line (stays visible when folded). */
  startLine: number;
  /** 1-based last line hidden when folded. */
  endLine: number;
  name: string;
  /** `type` attribute of the opening tag, when present. */
  type?: string;
  /** Text of the first `<head>` child, for division labels. */
  headText?: string;
  /** Number of `<cit>` elements inside. */
  citCount: number;
  kind: 'element' | 'comment';
}

interface OpenElement {
  name: string;
  type?: string;
  startLine: number;
  contentStart: number;
  headText?: string;
  citCount: number;
}

const NAME_START = /[A-Za-z_:]/;
const NAME_CHAR = /[\w:.-]/;

const stripTags = (xml: string) =>
  xml
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();

export const analyzeXmlFolds = (text: string): XmlFoldRegion[] => {
  // Offsets of each line start, for offset → line lookups.
  const lineStarts = [0];
  for (let i = 0; i < text.length; i += 1) if (text[i] === '\n') lineStarts.push(i + 1);
  const lineAt = (offset: number) => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid]! <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
  const onlyWhitespaceBefore = (offset: number) => {
    for (let i = offset - 1; i >= 0 && text[i] !== '\n'; i -= 1) {
      if (text[i] !== ' ' && text[i] !== '\t' && text[i] !== '\r') return false;
    }
    return true;
  };

  const regions: XmlFoldRegion[] = [];
  const stack: OpenElement[] = [];

  const addRegion = (region: XmlFoldRegion) => {
    if (region.endLine > region.startLine) regions.push(region);
  };

  let i = 0;
  while (i < text.length) {
    const lt = text.indexOf('<', i);
    if (lt === -1) break;

    if (text.startsWith('<!--', lt)) {
      const end = text.indexOf('-->', lt + 4);
      const closeAt = end === -1 ? text.length : end + 3;
      addRegion({
        startLine: lineAt(lt),
        endLine: lineAt(closeAt - 1),
        name: '!--',
        citCount: 0,
        kind: 'comment',
      });
      i = closeAt;
      continue;
    }
    if (text.startsWith('<![CDATA[', lt)) {
      const end = text.indexOf(']]>', lt + 9);
      i = end === -1 ? text.length : end + 3;
      continue;
    }
    if (text[lt + 1] === '?' || text[lt + 1] === '!') {
      const end = text.indexOf('>', lt + 2);
      i = end === -1 ? text.length : end + 1;
      continue;
    }

    const closing = text[lt + 1] === '/';
    const nameStart = lt + (closing ? 2 : 1);
    if (!NAME_START.test(text[nameStart] ?? '')) {
      i = lt + 1;
      continue;
    }
    let nameEnd = nameStart + 1;
    while (nameEnd < text.length && NAME_CHAR.test(text[nameEnd]!)) nameEnd += 1;
    const name = text.slice(nameStart, nameEnd);

    // Find the tag's closing `>`, ignoring any inside quoted attribute values.
    let quote: string | null = null;
    let tagEnd = -1;
    for (let j = nameEnd; j < text.length; j += 1) {
      const ch = text[j]!;
      if (quote) {
        if (ch === quote) quote = null;
      } else if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (ch === '>') {
        tagEnd = j;
        break;
      } else if (ch === '<') {
        break; // malformed; do not run on into the next tag
      }
    }
    if (tagEnd === -1) {
      i = nameEnd;
      continue;
    }
    i = tagEnd + 1;

    if (closing) {
      let depth = stack.length - 1;
      while (depth >= 0 && stack[depth]!.name !== name) depth -= 1;
      if (depth < 0) continue; // stray close tag
      stack.length = depth + 1; // drop anything left open inside it
      const open = stack.pop()!;

      if (name === 'head') {
        const parent = stack[stack.length - 1];
        if (parent && parent.headText === undefined) {
          const label = stripTags(text.slice(open.contentStart, lt));
          if (label) parent.headText = label;
        }
      }

      // Keep a close tag that starts its own line visible, as VS Code does;
      // otherwise (text before it on the line) fold through its line.
      const closeLine = lineAt(lt);
      const endLine = onlyWhitespaceBefore(lt) ? closeLine - 1 : closeLine;
      addRegion({
        startLine: open.startLine,
        endLine,
        name,
        type: open.type,
        headText: open.headText,
        citCount: open.citCount,
        kind: 'element',
      });
      continue;
    }

    const selfClosing = text[tagEnd - 1] === '/';
    if (name === 'cit') for (const open of stack) open.citCount += 1;
    if (selfClosing) continue;

    const typeMatch = /\stype\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(text.slice(nameEnd, tagEnd));
    stack.push({
      name,
      type: typeMatch ? (typeMatch[1] ?? typeMatch[2]) : undefined,
      startLine: lineAt(lt),
      contentStart: tagEnd + 1,
      citCount: 0,
    });
  }

  // Monaco keeps one range per start line; prefer the outermost (first opened,
  // so it ends last).
  regions.sort((a, b) => a.startLine - b.startLine || b.endLine - a.endLine);
  const unique: XmlFoldRegion[] = [];
  for (const region of regions) {
    if (unique[unique.length - 1]?.startLine === region.startLine) continue;
    unique.push(region);
  }
  return unique;
};

/** Text shown after a collapsed region's opening line, or null for the default. */
export const getFoldLabel = (region: XmlFoldRegion): string | null => {
  const parts: string[] = [];
  if (region.headText) parts.push(region.headText);
  // Counts on the structural wrappers (TEI, text, body) would only be noise.
  if (region.citCount > 0 && (region.name === 'p' || region.name === 'div'))
    parts.push(`${region.citCount} cit`);
  return parts.length > 0 ? parts.join(' · ') : null;
};
