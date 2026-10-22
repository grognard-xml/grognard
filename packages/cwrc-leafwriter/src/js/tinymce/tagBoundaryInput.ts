/**
 * Caret positions, typing and deleting at the edge of an inline tag.
 *
 * Show-tags brackets are CSS ::before/::after, so they cannot hold a caret.
 * "Just after </tag>" and "just inside the tag, at the last character" are
 * the same pixel. TinyMCE's fake caret then inserts on the wrong side. Two
 * things deal with that:
 *
 * - Editing. Callers snapshot the real text node on keydown, before that
 *   rewrite, and use these helpers to put a typed character (or an IME commit)
 *   on the side the snapshot recorded, and to delete forward at the first
 *   character of a tag.
 * - Arrow keys. At the edge of an inline segment there are two caret
 *   positions, outside and inside, so `boundaryArrowAction` makes one extra
 *   stop there: the arrow that enters a segment lands on its first (or last)
 *   character, and the arrow that leaves it lands in the neighbouring text.
 *   Block tags such as a paragraph are not stepped: the browser already
 *   handles them. The older three-position navigator (see
 *   docs/tag-boundary-navigation-planning.md) is not what this is.
 *
 * See GitHub issue 40.
 */

export type BoundarySide = 'before' | 'after';

/** A collapsed caret in a real text node. `offset` is a UTF-16 index. */
export interface TextCaret {
  node: Text;
  offset: number;
}

/**
 * Caret was outside the tag. `side: 'after'` means the tag is the previous
 * sibling (caret sits just after </tag>). `side: 'before'` means the tag is
 * the next sibling (caret sits just before <tag>).
 */
export interface OutsideInsertSnapshot {
  kind: 'outside';
  outside: Text | null;
  offset: number;
  side: BoundarySide;
  tag: Element;
  /** Text node on the tag edge TinyMCE tends to insert into by mistake. */
  insideEdge: Text | null;
  /** Set when an IME composition starts, so we can see which node grew. */
  outsideLength?: number;
  insideLength?: number;
}

/** Caret was at offset 0 of the first text node inside an inline tag. */
export interface InsideStartSnapshot {
  kind: 'inside-start';
  inside: Text;
  previous: Text | null;
  insideLength?: number;
  previousLength?: number;
}

export type BoundaryInsertSnapshot = OutsideInsertSnapshot | InsideStartSnapshot;

const isBogus = (node: Node | null): boolean =>
  !!node && node.nodeType === Node.ELEMENT_NODE && (node as Element).hasAttribute('data-mce-bogus');

/**
 * The node still has a parent. A removed node does not.
 * `isConnected` is false for a node in a detached tree, which is not the
 * same thing as "TinyMCE deleted this node."
 */
export const isAttached = (node: Node | null | undefined): node is Node =>
  !!node && node.parentNode !== null;

/**
 * Inline phrase tags and entities. The caret at their first character is the
 * same pixel as "just before the tag". Block tags (a paragraph div) are not:
 * their start is a real position, and TinyMCE can handle it.
 */
export const isAmbiguousInlineTag = (el: Element | null): boolean => {
  if (!el) return false;
  if (!el.hasAttribute('_tag') || el.getAttribute('_tag') === 'pb') return false;
  if (el.hasAttribute('_entity')) return true;
  return el.tagName.toUpperCase() === 'SPAN';
};

export const isFirstTextInParent = (node: Text): boolean => {
  let prev: Node | null = node.previousSibling;
  while (prev && isBogus(prev)) prev = prev.previousSibling;
  return prev === null;
};

/** First text node of an inline tag, and only when the caret is at offset 0. */
export const insideStartText = (
  container: Node,
  offset: number,
  isEdgeTag: (el: Element) => boolean = (el) => isAmbiguousInlineTag(el) === true,
): Text | null => {
  if (offset !== 0 || container.nodeType !== Node.TEXT_NODE) return null;
  const text = container as Text;
  const parent = text.parentElement;
  if (!parent || !isEdgeTag(parent)) return null;
  if (!isFirstTextInParent(text)) return null;
  return text;
};

/** The text node immediately outside an inline tag, on the opening-tag side. */
export const previousTextOutside = (inside: Text): Text | null => {
  let prev: Node | null = inside.parentElement?.previousSibling ?? null;
  while (prev && isBogus(prev)) prev = prev.previousSibling;
  return prev?.nodeType === Node.TEXT_NODE ? (prev as Text) : null;
};

/**
 * First (`before`) or last (`after`) real text node inside a tag.
 * This is where a mis-routed character lands.
 */
export const tagEdgeText = (tag: Element, side: BoundarySide): Text | null => {
  const children =
    side === 'before' ? Array.from(tag.childNodes) : Array.from(tag.childNodes).reverse();
  for (const node of children) {
    if (isBogus(node)) continue;
    if (node.nodeType === Node.TEXT_NODE) {
      if ((node as Text).data.length === 0) continue;
      return node as Text;
    }
    if (node.nodeType === Node.ELEMENT_NODE) {
      const nested = tagEdgeText(node as Element, side);
      if (nested) return nested;
    }
  }
  return null;
};

/** Caret from a selection container. Element containers point between children. */
export const caretFromSelection = (container: Node, offset: number): TextCaret | null => {
  if (container.nodeType === Node.TEXT_NODE) {
    return { node: container as Text, offset };
  }
  if (container.nodeType !== Node.ELEMENT_NODE) return null;
  const el = container as Element;
  const after = el.childNodes[offset] ?? null;
  const before = el.childNodes[offset - 1] ?? null;
  if (after?.nodeType === Node.TEXT_NODE) return { node: after as Text, offset: 0 };
  if (before?.nodeType === Node.TEXT_NODE) {
    return { node: before as Text, offset: (before as Text).length };
  }
  return null;
};

/** Skip TinyMCE's fake caret and empty text nodes. */
const nextSignificant = (node: Node | null): Node | null => {
  let current = node;
  while (current) {
    if (isBogus(current)) {
      current = current.nextSibling;
      continue;
    }
    if (
      current.nodeType === Node.TEXT_NODE &&
      (current as Text).data.replace(/[\uFEFF\u200B]/g, '').length === 0
    ) {
      current = current.nextSibling;
      continue;
    }
    return current;
  }
  return null;
};

/** The next inline tag, when no real text sits between it and `tag`. */
export const adjacentInlineAfter = (
  tag: Element,
  isInlineEdge: (el: Element) => boolean,
): Element | null => {
  const next = nextSignificant(tag.nextSibling);
  if (!next || next.nodeType !== Node.ELEMENT_NODE) return null;
  return isInlineEdge(next as Element) ? (next as Element) : null;
};

/**
 * The caret is on the pixel shared by the end of `tag` and whatever follows it.
 * That includes the last character inside the tag, offset 0 of the text after
 * it, and the first character of the next inline tag when nothing is between them.
 * The editor collapses those DOM positions onto one another.
 */
export const caretBesideTagEnd = (
  tag: Element,
  outside: Text | null,
  container: Node,
  offset: number,
  isInlineEdge: (el: Element) => boolean,
): boolean => {
  if (outside && container === outside && offset === 0) return true;
  if (caretAtEndOfTag(tag, container, offset)) return true;
  if (container.nodeType === Node.TEXT_NODE && offset === 0) {
    const parent = (container as Text).parentElement;
    if (
      parent &&
      parent !== tag &&
      isInlineEdge(parent) &&
      isFirstTextInParent(container as Text) &&
      adjacentInlineAfter(tag, isInlineEdge) === parent
    ) {
      return true;
    }
  }
  if (container.nodeType === Node.ELEMENT_NODE) {
    const el = container as Element;
    if (el === tag && offset >= tag.childNodes.length) return true;
    if (el.childNodes[offset] === tag || el.childNodes[offset - 1] === tag) return true;
  }
  return false;
};

/**
 * One step to the right of the "just after this tag" caret.
 * A following character moves into that text. An empty gap before another
 * inline tag steps into that tag, at its first character.
 */
export const stepPastOutsideCaret = (
  outside: Text,
  doc: Document,
  isInlineEdge: (el: Element) => boolean,
): { caret: TextCaret; enterTag: Element | null } => {
  if (outside.length > 0) {
    const step = firstGraphemeLength(outside.data);
    return {
      caret: { node: outside, offset: Math.min(step, outside.length) },
      enterTag: null,
    };
  }
  const next = nextSignificant(outside.nextSibling);
  if (next?.nodeType === Node.TEXT_NODE) {
    return { caret: { node: next as Text, offset: 0 }, enterTag: null };
  }
  if (next && next.nodeType === Node.ELEMENT_NODE && isInlineEdge(next as Element)) {
    const tag = next as Element;
    return { caret: { node: ensureEntryText(tag, doc), offset: 0 }, enterTag: tag };
  }
  return { caret: { node: outside, offset: outside.length }, enterTag: null };
};

/** A text node on `side` of `tag`, creating an empty one when the side has none. */
export const ensureOutsideText = (tag: Element, side: BoundarySide, doc: Document): Text => {
  const parent = tag.parentNode;
  if (!parent) {
    return doc.createTextNode('');
  }
  if (side === 'after') {
    const next = tag.nextSibling;
    if (next?.nodeType === Node.TEXT_NODE) return next as Text;
    const text = doc.createTextNode('');
    parent.insertBefore(text, next);
    return text;
  }
  const prev = tag.previousSibling;
  if (prev?.nodeType === Node.TEXT_NODE) return prev as Text;
  const text = doc.createTextNode('');
  parent.insertBefore(text, tag);
  return text;
};

export const insertAt = (caret: TextCaret, data: string): TextCaret => {
  const offset = Math.max(0, Math.min(caret.offset, caret.node.length));
  caret.node.insertData(offset, data);
  return { node: caret.node, offset: offset + data.length };
};

const isInvisibleMark = (char: string | undefined): boolean =>
  char === '\uFEFF' || char === '\u200B';

/** Length in UTF-16 units of the first user-perceived character of `text`: a base with its
 * variation selector (IVS), a Tibetan stack, a letter with its accents, a flag. Falls back to one
 * code point where `Intl.Segmenter` does not exist. */
const firstGraphemeLength = (text: string): number => {
  if (text.length === 0) return 0;
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    const first = segmenter.segment(text)[Symbol.iterator]().next();
    if (!first.done) return first.value.segment.length;
  }
  return text.codePointAt(0)! > 0xffff ? 2 : 1;
};

/**
 * Delete one visible character (a whole grapheme cluster, so no orphaned variation selector,
 * subjoined consonant or accent is left behind) at the start of `node`.
 * Returns false when only one real character is left: `prevent_delete.ts`
 * keeps that character's tag alive by inserting U+FEFF, and this helper
 * must not fight it. Leading U+FEFF / U+200B are skipped, not deleted.
 */
export const deleteFirstVisibleGrapheme = (node: Text): boolean => {
  let offset = 0;
  while (offset < node.length && isInvisibleMark(node.data[offset])) offset += 1;

  const rest = node.data.slice(offset);
  const length = firstGraphemeLength(rest);
  if (length === 0) return false;

  const visibleRest = rest.replace(/[\uFEFF\u200B]/g, '');
  if (visibleRest.length === length) return false;

  node.deleteData(offset, length);
  return true;
};

/**
 * True when Delete would pull content from after the tag into the tag.
 * A caret in the middle of the tag, or before a nested child, is not the end.
 */
export const caretAtEndOfTag = (tag: Element, container: Node, offset: number): boolean => {
  if (container !== tag && !tag.contains(container)) return false;
  if (container.nodeType === Node.TEXT_NODE) {
    const text = container as Text;
    if (offset < text.length) return false;
    let next: Node | null = text.nextSibling;
    while (next) {
      if (isBogus(next)) {
        next = next.nextSibling;
        continue;
      }
      if (next.nodeType === Node.TEXT_NODE) {
        const data = (next as Text).data.replace(/[\uFEFF\u200B]/g, '');
        if (data.length > 0) return false;
        next = next.nextSibling;
        continue;
      }
      return false;
    }
    return true;
  }
  return container === tag && offset >= tag.childNodes.length;
};

/**
 * After an IME commits, move `data` out of the tag only if the lengths show
 * it was added there. A character that was already in the document stays.
 * Returns null when the commit cannot be placed safely.
 */
export const relocateCompositionOutside = (
  data: string,
  snap: OutsideInsertSnapshot,
): TextCaret | null => {
  if (!data || snap.outsideLength === undefined || snap.insideLength === undefined) return null;

  const outside = snap.outside;
  if (
    isAttached(outside) &&
    outside.length === snap.outsideLength + data.length &&
    outside.data.slice(snap.offset, snap.offset + data.length) === data
  ) {
    return { node: outside, offset: snap.offset + data.length };
  }

  const inside = snap.insideEdge;
  const outsideUnchanged = !isAttached(outside) || outside.length === snap.outsideLength;
  if (
    !isAttached(inside) ||
    !outsideUnchanged ||
    inside.length !== snap.insideLength + data.length ||
    !isAttached(snap.tag)
  ) {
    return null;
  }

  const landedAtEnd = snap.side === 'after' && inside.data.endsWith(data);
  const landedAtStart = snap.side === 'before' && inside.data.startsWith(data);
  if (!landedAtEnd && !landedAtStart) return null;

  if (landedAtEnd) inside.deleteData(inside.length - data.length, data.length);
  else inside.deleteData(0, data.length);

  const node = isAttached(outside)
    ? outside
    : ensureOutsideText(snap.tag, snap.side, inside.ownerDocument);
  const offset = isAttached(outside)
    ? Math.min(snap.offset, node.length)
    : snap.side === 'before'
      ? node.length
      : 0;
  return insertAt({ node, offset }, data);
};

/** Mirror of relocateCompositionOutside for a caret that started inside. */
export const pullCompositionInside = (
  data: string,
  snap: InsideStartSnapshot,
): TextCaret | null => {
  if (!data || !isAttached(snap.inside) || snap.insideLength === undefined) return null;
  const inside = snap.inside;

  if (inside.length === snap.insideLength + data.length && inside.data.startsWith(data)) {
    return { node: inside, offset: data.length };
  }

  const previous = snap.previous;
  if (
    !isAttached(previous) ||
    snap.previousLength === undefined ||
    inside.length !== snap.insideLength ||
    previous.length !== snap.previousLength + data.length ||
    !previous.data.endsWith(data)
  ) {
    return null;
  }

  previous.deleteData(previous.length - data.length, data.length);
  inside.insertData(0, data);
  return { node: inside, offset: data.length };
};

/**
 * Put `data` on the snapshotted side of the tag.
 * If that text node already grew by `data` (TinyMCE inserted before we ran),
 * only move the caret. If nothing has grown yet, insert. If some other
 * change happened, return null and leave the document alone.
 */
export const placeTypedText = (
  data: string,
  snap: BoundaryInsertSnapshot,
  doc: Document,
): TextCaret | null => {
  if (!data) return null;

  if (snap.kind === 'outside') {
    if (snap.outsideLength !== undefined && snap.insideLength !== undefined) {
      const placed = relocateCompositionOutside(data, snap);
      if (placed) return placed;
      const outsideGrew = isAttached(snap.outside) && snap.outside.length !== snap.outsideLength;
      const insideGrew =
        isAttached(snap.insideEdge) && snap.insideEdge.length !== snap.insideLength;
      if (outsideGrew || insideGrew) return null;
    }
    const node = isAttached(snap.outside)
      ? snap.outside
      : isAttached(snap.tag)
        ? ensureOutsideText(snap.tag, snap.side, doc)
        : null;
    if (!node) return null;
    const offset = isAttached(snap.outside)
      ? Math.min(snap.offset, node.length)
      : snap.side === 'before'
        ? node.length
        : 0;
    return insertAt({ node, offset }, data);
  }

  if (snap.insideLength !== undefined) {
    const placed = pullCompositionInside(data, snap);
    if (placed) return placed;
    const insideGrew = snap.inside.length !== snap.insideLength;
    const previousGrew =
      isAttached(snap.previous) &&
      snap.previousLength !== undefined &&
      snap.previous.length !== snap.previousLength;
    if (insideGrew || previousGrew) return null;
  }
  if (!isAttached(snap.inside)) return null;
  return insertAt({ node: snap.inside, offset: 0 }, data);
};

/**
 * The two caret positions around an inline segment share one pixel.
 * Arrow keys choose which one typing will use:
 * - enter-start: step into the next segment, at its first character
 * - leave-to-before: step back out, to the end of the previous text
 * - leave-to-after: step out of the end of this segment, into the following text
 * - enter-end: step back into this segment, at its last character
 * A block such as a paragraph is not one of these: the browser can already
 * put the caret at the start of the next paragraph.
 */
export type BoundaryArrow = 'enter-start' | 'leave-to-before' | 'leave-to-after' | 'enter-end';

export const boundaryArrowAction = (args: {
  direction: 'forward' | 'backward';
  external: boolean;
  side: BoundarySide | null;
  boundaryTag: Element | null;
  container: Node;
  offset: number;
  isInlineEdge: (el: Element) => boolean;
}): BoundaryArrow | null => {
  const { direction, external, side, boundaryTag, container, offset, isInlineEdge } = args;

  if (
    direction === 'forward' &&
    external &&
    side === 'before' &&
    boundaryTag &&
    isInlineEdge(boundaryTag)
  ) {
    return 'enter-start';
  }
  if (
    direction === 'backward' &&
    external &&
    side === 'after' &&
    boundaryTag &&
    isInlineEdge(boundaryTag)
  ) {
    return 'enter-end';
  }

  if (container.nodeType !== Node.TEXT_NODE) return null;
  const text = container as Text;
  const parent = text.parentElement;
  if (!parent || !isInlineEdge(parent)) return null;
  if (direction === 'backward' && offset === 0 && isFirstTextInParent(text))
    return 'leave-to-before';
  if (direction === 'forward' && caretAtEndOfTag(parent, text, offset)) return 'leave-to-after';
  return null;
};

/** Text node that holds the caret at the first character of a segment. */
export const ensureEntryText = (tag: Element, doc: Document): Text => {
  let child: Node | null = tag.firstChild;
  while (child && isBogus(child)) child = child.nextSibling;
  if (child?.nodeType === Node.TEXT_NODE) return child as Text;
  const text = doc.createTextNode('');
  tag.insertBefore(text, tag.firstChild);
  return text;
};

/** Caret at the last character of a segment. */
export const ensureEndCaret = (tag: Element, doc: Document): TextCaret => {
  const edge = tagEdgeText(tag, 'after');
  if (edge) return { node: edge, offset: edge.length };
  const text = doc.createTextNode('');
  tag.appendChild(text);
  return { node: text, offset: 0 };
};
