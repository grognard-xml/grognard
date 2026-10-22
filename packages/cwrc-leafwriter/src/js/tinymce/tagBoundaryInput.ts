/**
 * Typing and deleting at the edge of an inline tag.
 *
 * Show-tags brackets are CSS ::before/::after, so they cannot hold a caret.
 * "Just after </tag>" and "just inside the tag, at the last character" are
 * the same pixel. TinyMCE's fake caret then inserts on the wrong side.
 *
 * Callers snapshot the real text node on keydown, before that rewrite, and
 * use these helpers to put the character on the side the snapshot recorded.
 * Arrow-key stops are intentionally not part of this. See GitHub issue 40.
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

/**
 * Delete one visible code point at the start of `node`.
 * Returns false when only one real character is left: `prevent_delete.ts`
 * keeps that character's tag alive by inserting U+FEFF, and this helper
 * must not fight it. Leading U+FEFF / U+200B are skipped, not deleted.
 */
export const deleteFirstVisibleCodePoint = (node: Text): boolean => {
  const visible = node.data.replace(/[\uFEFF\u200B]/g, '');
  if ([...visible].length <= 1) return false;
  let offset = 0;
  while (
    offset < node.length &&
    (node.data[offset] === '\uFEFF' || node.data[offset] === '\u200B')
  ) {
    offset += 1;
  }
  const codePoint = node.data.codePointAt(offset);
  if (codePoint === undefined) return false;
  node.deleteData(offset, codePoint > 0xffff ? 2 : 1);
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
