import { getTeiXPathForEditorNode } from './teiXPath';

export interface VisualCaretPosition {
  offsetInElementText: number;
  teiXPath: string;
}

interface TeiSegment {
  index: number;
  tag: string;
}

interface StackEntry {
  index: number;
  name: string;
}

const localTagName = (name: string) => (name.includes(':') ? name.split(':').pop()! : name);

const parseTeiXPathSegments = (xpath: string): TeiSegment[] =>
  xpath
    .replace(/^\/+/, '')
    .split('/')
    .filter(Boolean)
    .map((segment) => {
      const match = segment.match(/^(?:[\w.-]+:)*([\w.-]+)(?:\[(\d+)\])?$/);
      if (!match) {
        const bare = segment.replace(/\[.*\]/, '');
        return { tag: localTagName(bare), index: 0 };
      }
      return {
        tag: match[1],
        index: match[2] ? parseInt(match[2], 10) - 1 : 0,
      };
    });

const findTagEnd = (content: string, tagStart: number) => {
  let quote: '"' | "'" | null = null;

  for (let j = tagStart + 1; j < content.length; j++) {
    const ch = content[j];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '>') return j;
  }

  return -1;
};

const parseOpenTag = (tagInner: string): { name: string; selfClosing: boolean } | null => {
  const trimmed = tagInner.trim();
  if (trimmed.startsWith('/')) return null;

  const selfClosing = trimmed.endsWith('/');
  const withoutSlash = selfClosing ? trimmed.slice(0, -1).trim() : trimmed;
  const nameMatch = withoutSlash.match(/^([\w:.-]+)/);
  if (!nameMatch) return null;

  return { name: nameMatch[1], selfClosing };
};

const stackMatchesTarget = (stack: StackEntry[], target: TeiSegment[]) =>
  stack.length === target.length &&
  stack.every(
    (entry, index) =>
      localTagName(entry.name).toLowerCase() === localTagName(target[index].tag).toLowerCase() &&
      entry.index === target[index].index,
  );

/** Map TEI xpath + character offset within element text to a source XML byte offset. */
export const findTextOffsetInXml = (
  content: string,
  teiXpath: string,
  charOffset: number,
): number | null => {
  if (charOffset < 0) return null;

  const target = parseTeiXPathSegments(teiXpath);
  if (target.length === 0) return null;

  const stack: StackEntry[] = [];
  const siblingCounts = new Map<string, number>();
  let elementTextOffset = 0;

  const parentPathKey = () =>
    stack.length === 0 ? '' : stack.map((entry) => `${entry.name}[${entry.index + 1}]`).join('/');

  const pushTag = (name: string) => {
    const key = `${parentPathKey()}/${name}`;
    const index = siblingCounts.get(key) ?? 0;
    siblingCounts.set(key, index + 1);
    stack.push({ name, index });
    elementTextOffset = 0;
  };

  const popTag = (name: string) => {
    const top = stack[stack.length - 1];
    if (top && localTagName(top.name) === localTagName(name)) {
      stack.pop();
      elementTextOffset = 0;
    }
  };

  const matches = () => stackMatchesTarget(stack, target);

  let i = 0;
  while (i < content.length) {
    if (content[i] !== '<') {
      const nextTag = content.indexOf('<', i);
      const textEnd = nextTag === -1 ? content.length : nextTag;
      const textLength = textEnd - i;

      if (matches() && stack.length > 0) {
        if (charOffset <= elementTextOffset + textLength) {
          return i + Math.max(0, charOffset - elementTextOffset);
        }
      }

      if (stack.length > 0) {
        elementTextOffset += textLength;
      }
      i = textEnd;
      continue;
    }

    const tagEnd = findTagEnd(content, i);
    if (tagEnd === -1) break;

    const inner = content.slice(i + 1, tagEnd);

    if (inner.startsWith('?') || inner.startsWith('!--') || inner.startsWith('!')) {
      i = tagEnd + 1;
      continue;
    }

    if (inner.startsWith('![CDATA[')) {
      const cdataContentStart = i + '<![CDATA['.length;
      const cdataEnd = content.indexOf(']]>', cdataContentStart);
      if (cdataEnd === -1) break;

      const cdataLength = cdataEnd - cdataContentStart;
      if (matches() && stack.length > 0) {
        if (charOffset <= elementTextOffset + cdataLength) {
          return cdataContentStart + Math.max(0, charOffset - elementTextOffset);
        }
      }

      if (stack.length > 0) {
        elementTextOffset += cdataLength;
      }
      i = cdataEnd + 3;
      continue;
    }

    if (inner.startsWith('/')) {
      const nameMatch = inner
        .slice(1)
        .trim()
        .match(/^([\w:.-]+)/);
      if (nameMatch) popTag(nameMatch[1]);
      i = tagEnd + 1;
      continue;
    }

    const parsed = parseOpenTag(inner);
    if (parsed) {
      pushTag(parsed.name);
      if (matches()) {
        if (charOffset === 0 || parsed.selfClosing) {
          return tagEnd + 1;
        }
      }
      if (parsed.selfClosing) {
        stack.pop();
      }
    }

    i = tagEnd + 1;
  }

  return null;
};

/** Fallback: opening `<` of the element identified by TEI xpath. */
export const findElementOpenTagStartInXml = (content: string, teiXpath: string): number | null => {
  const target = parseTeiXPathSegments(teiXpath);
  if (target.length === 0) return null;

  const stack: StackEntry[] = [];
  const siblingCounts = new Map<string, number>();

  const parentPathKey = () =>
    stack.length === 0 ? '' : stack.map((entry) => `${entry.name}[${entry.index + 1}]`).join('/');

  const pushTag = (name: string) => {
    const key = `${parentPathKey()}/${name}`;
    const index = siblingCounts.get(key) ?? 0;
    siblingCounts.set(key, index + 1);
    stack.push({ name, index });
  };

  const popTag = (name: string) => {
    const top = stack[stack.length - 1];
    if (top && localTagName(top.name) === localTagName(name)) {
      stack.pop();
    }
  };

  let i = 0;
  while (i < content.length) {
    if (content[i] !== '<') {
      i += 1;
      continue;
    }

    const tagStart = i;
    const tagEnd = findTagEnd(content, tagStart);
    if (tagEnd === -1) break;

    const inner = content.slice(i + 1, tagEnd);

    if (inner.startsWith('?') || inner.startsWith('!--') || inner.startsWith('!')) {
      i = tagEnd + 1;
      continue;
    }

    if (inner.startsWith('![CDATA[')) {
      const cdataEnd = content.indexOf(']]>', i + '<![CDATA['.length);
      i = cdataEnd === -1 ? content.length : cdataEnd + 3;
      continue;
    }

    if (inner.startsWith('/')) {
      const nameMatch = inner
        .slice(1)
        .trim()
        .match(/^([\w:.-]+)/);
      if (nameMatch) popTag(nameMatch[1]);
      i = tagEnd + 1;
      continue;
    }

    const parsed = parseOpenTag(inner);
    if (parsed) {
      pushTag(parsed.name);
      if (stackMatchesTarget(stack, target)) {
        return tagStart;
      }
      if (parsed.selfClosing) {
        stack.pop();
      }
    }

    i = tagEnd + 1;
  }

  return null;
};

/** Read caret position from the WYSIWYG editor for Source mode sync. */
export const getVisualCaretForSourceSync = (): VisualCaretPosition | null => {
  const editor = window.writer?.editor;
  const body = editor?.getBody();
  if (!editor || !body) return null;

  const rng = editor.selection.getRng();
  if (!rng) return null;

  let element: Element | null;
  if (rng.startContainer.nodeType === Node.ELEMENT_NODE) {
    const el = rng.startContainer as Element;
    element = el.getAttribute('_tag') ? el : el.closest('[_tag]');
  } else {
    element = rng.startContainer.parentElement?.closest('[_tag]') ?? null;
  }

  if (!element) return null;

  const teiXPath = getTeiXPathForEditorNode(element);
  if (!teiXPath) return null;

  const doc = element.ownerDocument;
  const measureRange = doc.createRange();
  measureRange.selectNodeContents(element);
  measureRange.setEnd(rng.startContainer, rng.startOffset);

  return {
    teiXPath,
    offsetInElementText: measureRange.toString().length,
  };
};

export const mapVisualCaretToSourceOffset = (
  content: string,
  caret: VisualCaretPosition,
): number | null => {
  const textOffset = findTextOffsetInXml(content, caret.teiXPath, caret.offsetInElementText);
  if (textOffset !== null) return textOffset;
  return findElementOpenTagStartInXml(content, caret.teiXPath);
};

/** Decoded characters in content[from..to): an entity reference such as &amp; or &#8211; is one,
 * matching how the editor DOM presents the text. */
const decodedCharCount = (content: string, from: number, to: number): number => {
  let count = 0;
  let i = from;
  while (i < to) {
    if (content[i] === '&') {
      const semi = content.indexOf(';', i + 1);
      if (semi !== -1 && semi < to && semi - i <= 12) {
        count += 1;
        i = semi + 1;
        continue;
      }
    }
    count += 1;
    i += 1;
  }
  return count;
};

/**
 * The inverse of `mapVisualCaretToSourceOffset`: where the Visual editor's caret belongs for a
 * cursor at `offset` in the XML source. Returns the innermost element containing the offset and
 * the number of text characters from the start of that element's content to the offset, text in
 * its child elements included (what `getVisualCaretForSourceSync` measures). A cursor inside a tag
 * maps to the start of the element that tag opens, or the end of the one it closes. Null when the
 * offset is outside the root element.
 */
export const mapSourceOffsetToVisualCaret = (
  content: string,
  offset: number,
): VisualCaretPosition | null => {
  if (offset < 0 || offset > content.length) return null;

  const stack: StackEntry[] = [];
  const siblingCounts = new Map<string, number>();
  /** Text counted so far for each open element, children's text included once they close. */
  const textAtLevel: number[] = [];

  const parentPathKey = () =>
    stack.length === 0 ? '' : stack.map((entry) => `${entry.name}[${entry.index + 1}]`).join('/');
  const xpathForStack = () =>
    `/${stack
      .map((entry) => (entry.index === 0 ? entry.name : `${entry.name}[${entry.index + 1}]`))
      .join('/')}`;
  const countSibling = (name: string) => {
    const key = `${parentPathKey()}/${name}`;
    const index = siblingCounts.get(key) ?? 0;
    siblingCounts.set(key, index + 1);
    return index;
  };
  const here = (extraChars: number): VisualCaretPosition | null =>
    stack.length === 0
      ? null
      : {
          teiXPath: xpathForStack(),
          offsetInElementText: (textAtLevel[textAtLevel.length - 1] ?? 0) + extraChars,
        };
  const addText = (n: number) => {
    if (textAtLevel.length > 0) textAtLevel[textAtLevel.length - 1] += n;
  };

  let i = 0;
  while (i < content.length) {
    if (content[i] !== '<') {
      const nextTag = content.indexOf('<', i);
      const textEnd = nextTag === -1 ? content.length : nextTag;
      if (offset <= textEnd) return here(decodedCharCount(content, i, offset));
      addText(decodedCharCount(content, i, textEnd));
      i = textEnd;
      continue;
    }

    if (offset === i) return here(0);

    const tagEnd = findTagEnd(content, i);
    if (tagEnd === -1) break;
    const inner = content.slice(i + 1, tagEnd);

    if (inner.startsWith('![CDATA[')) {
      const cdataStart = i + '<![CDATA['.length;
      const cdataEnd = content.indexOf(']]>', cdataStart);
      if (cdataEnd === -1) break;
      if (offset <= cdataEnd) return here(Math.max(0, offset - cdataStart));
      addText(cdataEnd - cdataStart);
      i = cdataEnd + 3;
      continue;
    }

    if (inner.startsWith('?') || inner.startsWith('!')) {
      if (offset <= tagEnd) return here(0);
      i = tagEnd + 1;
      continue;
    }

    if (inner.startsWith('/')) {
      if (offset <= tagEnd) return here(0);
      const closing = inner
        .slice(1)
        .trim()
        .match(/^([\w:.-]+)/)?.[1];
      const top = stack[stack.length - 1];
      if (closing && top && localTagName(top.name) === localTagName(closing)) {
        stack.pop();
        const childText = textAtLevel.pop() ?? 0;
        addText(childText);
      }
      i = tagEnd + 1;
      continue;
    }

    const parsed = parseOpenTag(inner);
    if (parsed) {
      const index = countSibling(parsed.name);
      if (parsed.selfClosing) {
        if (offset <= tagEnd) return here(0);
      } else {
        stack.push({ name: parsed.name, index });
        textAtLevel.push(0);
        if (offset <= tagEnd) return here(0);
      }
    } else if (offset <= tagEnd) {
      return here(0);
    }

    i = tagEnd + 1;
  }

  return null;
};
