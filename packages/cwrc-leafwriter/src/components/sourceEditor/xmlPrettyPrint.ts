/**
 * Conservative XML pretty-printer for the source editor.
 *
 * Whitespace is significant in mixed content (a TEI <p> with inline <persName>
 * children), so this only re-indents elements that hold no text of their own and
 * leaves every other element byte-for-byte as written:
 *
 *  - An element is "structural" when its children are all elements, comments or
 *    PIs (the gaps between them are whitespace) and it is not under
 *    xml:space="preserve".
 *  - A structural element gets one child per line, indented two spaces per level.
 *    Line breaks are only *added* where the schema says the element cannot hold
 *    text (`canContainText(name) === false`); where that is unknown or true, only
 *    gaps that already contain a line break are re-indented.
 *  - Everything else (text-bearing elements, CDATA, anything malformed) is copied
 *    verbatim, descendants included.
 *
 * Returns null when the document is not well-formed enough to parse, so the
 * caller can say so instead of mangling it.
 */

export interface PrettyPrintOptions {
  /** Schema lookup: true/false when known, undefined when it is not. */
  canContainText?: (name: string) => boolean | undefined;
  indent?: string;
}

interface ElementNode {
  kind: 'element';
  name: string;
  start: number;
  /** Offset just past the closing tag (or the self-closing tag). */
  end: number;
  /** Offset just past the opening tag. */
  contentStart: number;
  /** Offset of the closing tag; equals `end` for self-closing elements. */
  contentEnd: number;
  selfClosing: boolean;
  preserveSpace: boolean;
  children: Node[];
}
interface LeafNode {
  kind: 'comment' | 'pi' | 'text' | 'cdata';
  start: number;
  end: number;
}
type Node = ElementNode | LeafNode;

const NAME_START = /[A-Za-z_:]/;
const NAME_CHAR = /[\w:.-]/;

const parse = (text: string): Node[] | null => {
  const root: Node[] = [];
  const stack: ElementNode[] = [];
  const current = () => (stack.length > 0 ? stack[stack.length - 1]!.children : root);

  let i = 0;
  while (i < text.length) {
    const lt = text.indexOf('<', i);
    if (lt === -1) {
      current().push({ kind: 'text', start: i, end: text.length });
      break;
    }
    if (lt > i) current().push({ kind: 'text', start: i, end: lt });

    if (text.startsWith('<!--', lt)) {
      const end = text.indexOf('-->', lt + 4);
      if (end === -1) return null;
      current().push({ kind: 'comment', start: lt, end: end + 3 });
      i = end + 3;
      continue;
    }
    if (text.startsWith('<![CDATA[', lt)) {
      const end = text.indexOf(']]>', lt + 9);
      if (end === -1) return null;
      current().push({ kind: 'cdata', start: lt, end: end + 3 });
      i = end + 3;
      continue;
    }
    if (text[lt + 1] === '?') {
      const end = text.indexOf('?>', lt + 2);
      if (end === -1) return null;
      current().push({ kind: 'pi', start: lt, end: end + 2 });
      i = end + 2;
      continue;
    }
    if (text[lt + 1] === '!') {
      // DOCTYPE and friends: treat like a PI (own line, verbatim). An internal
      // subset in brackets is not supported, so refuse rather than guess.
      const end = text.indexOf('>', lt + 2);
      if (end === -1 || text.slice(lt, end).includes('[')) return null;
      current().push({ kind: 'pi', start: lt, end: end + 1 });
      i = end + 1;
      continue;
    }

    const closing = text[lt + 1] === '/';
    const nameStart = lt + (closing ? 2 : 1);
    if (!NAME_START.test(text[nameStart] ?? '')) return null;
    let nameEnd = nameStart + 1;
    while (nameEnd < text.length && NAME_CHAR.test(text[nameEnd]!)) nameEnd += 1;
    const name = text.slice(nameStart, nameEnd);

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
        return null;
      }
    }
    if (tagEnd === -1) return null;
    i = tagEnd + 1;

    if (closing) {
      const open = stack.pop();
      if (!open || open.name !== name) return null;
      open.contentEnd = lt;
      open.end = tagEnd + 1;
      continue;
    }

    const selfClosing = text[tagEnd - 1] === '/';
    const parent = stack[stack.length - 1];
    const spacePreserve = /\sxml:space\s*=\s*["']preserve["']/.test(text.slice(nameEnd, tagEnd));
    const node: ElementNode = {
      kind: 'element',
      name,
      start: lt,
      end: tagEnd + 1,
      contentStart: tagEnd + 1,
      contentEnd: tagEnd + 1,
      selfClosing,
      preserveSpace: spacePreserve || (parent?.preserveSpace ?? false),
      children: [],
    };
    current().push(node);
    if (!selfClosing) stack.push(node);
  }

  return stack.length === 0 ? root : null;
};

const isBlank = (text: string, node: Node) => /^\s*$/.test(text.slice(node.start, node.end));

export const prettyPrintXml = (text: string, options: PrettyPrintOptions = {}): string | null => {
  const nodes = parse(text);
  if (!nodes) return null;
  const unit = options.indent ?? '  ';
  const eol = text.includes('\r\n') ? '\r\n' : '\n';

  const textAllowed = new Map<string, boolean | undefined>();
  const canContainText = (name: string) => {
    if (!textAllowed.has(name)) {
      let answer: boolean | undefined;
      try {
        answer = options.canContainText?.(name);
      } catch {
        answer = undefined;
      }
      textAllowed.set(name, answer);
    }
    return textAllowed.get(name);
  };

  // Children that are not whitespace-only text, with whether any text is real.
  const significantChildren = (element: ElementNode) =>
    element.children.filter((child) => child.kind !== 'text' || !isBlank(text, child));

  const isStructural = (element: ElementNode) => {
    if (element.selfClosing || element.preserveSpace) return false;
    const kids = significantChildren(element);
    if (kids.length === 0) return false;
    // Real text, CDATA: the element holds content of its own.
    if (kids.some((kid) => kid.kind === 'text' || kid.kind === 'cdata')) return false;
    // Whitespace we may rewrite: either the schema forbids text here, or every
    // gap between children (and around them) already contains a line break.
    if (canContainText(element.name) === false) return true;
    const gaps = element.children.filter((child) => child.kind === 'text');
    const allBroken =
      gaps.length === kids.length + 1 &&
      gaps.every((gap) => text.slice(gap.start, gap.end).includes('\n'));
    return allBroken;
  };

  const emit = (node: Node, depth: number): string => {
    if (node.kind !== 'element') return text.slice(node.start, node.end);
    if (!isStructural(node)) return text.slice(node.start, node.end);

    const pad = unit.repeat(depth + 1);
    const openTag = text.slice(node.start, node.contentStart);
    const closeTag = text.slice(node.contentEnd, node.end);
    const lines = significantChildren(node).map((child) => pad + emit(child, depth + 1));
    return `${openTag}${eol}${lines.join(eol)}${eol}${unit.repeat(depth)}${closeTag}`;
  };

  // Top level: each node on its own line, document order kept.
  const top = nodes.filter((node) => node.kind !== 'text' || !isBlank(text, node));
  if (top.some((node) => node.kind === 'text' || node.kind === 'cdata')) return null;
  const body = top.map((node) => emit(node, 0)).join(eol);
  const trailingNewline = /\n\s*$/.test(text) ? eol : '';
  return body + trailingNewline;
};
