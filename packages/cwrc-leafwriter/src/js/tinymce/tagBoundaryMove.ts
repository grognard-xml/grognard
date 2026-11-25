import { ensureEndCaret, ensureEntryText, type TextCaret } from './tagBoundaryInput';

/**
 * Move the opening or closing boundary of an inline tag one character (or one whole inline
 * element) at a time, by keyboard.
 *
 * The opening boundary grows to the left and shrinks to the right; the closing boundary grows to
 * the right and shrinks to the left. A boundary never crosses its parent's edge, a block element,
 * or the other boundary (a tag keeps at least one visible character).
 */

export type BoundaryEdge = 'start' | 'end';
export type BoundaryDirection = 'left' | 'right';

export interface BoundaryMoveResult {
  moved: boolean;
  /** Caret to place, just inside the boundary that moved. */
  caret: TextCaret | null;
}

const INVISIBLE = /[\uFEFF\u200B]/g;
const startsWithInvisible = /^[\uFEFF\u200B]+/;
const endsWithInvisible = /[\uFEFF\u200B]+$/;

const isBogus = (node: Node): boolean =>
  node.nodeType === Node.ELEMENT_NODE && (node as Element).hasAttribute('data-mce-bogus');

/** Skips bogus nodes and empty text nodes. */
const significant = (node: Node | null, step: 'previousSibling' | 'nextSibling'): Node | null => {
  let current = node;
  while (
    current &&
    (isBogus(current) || (current.nodeType === Node.TEXT_NODE && (current as Text).length === 0))
  ) {
    current = current[step];
  }
  return current;
};

const segmentGraphemes = (text: string): string[] => {
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    return Array.from(segmenter.segment(text), (part) => part.segment);
  }
  return Array.from(text);
};

/** Remove and return the first visible character of `node`, with any invisible marks before it. */
const takeFirstGrapheme = (node: Text): string => {
  const marks = startsWithInvisible.exec(node.data)?.[0] ?? '';
  const rest = node.data.slice(marks.length);
  const first = segmentGraphemes(rest)[0] ?? '';
  const taken = marks + first;
  node.deleteData(0, taken.length);
  return taken;
};

/** Remove and return the last visible character of `node`, with any invisible marks after it. */
const takeLastGrapheme = (node: Text): string => {
  const marks = endsWithInvisible.exec(node.data)?.[0] ?? '';
  const rest = node.data.slice(0, node.data.length - marks.length);
  const parts = segmentGraphemes(rest);
  const last = parts[parts.length - 1] ?? '';
  const taken = last + marks;
  node.deleteData(node.data.length - taken.length, taken.length);
  return taken;
};

const visibleLength = (node: Node): number =>
  (node.textContent ?? '').replace(INVISIBLE, '').length;

const removeIfEmpty = (node: Text): void => {
  if (node.length === 0) node.remove();
};

/** Put `data` at the start (or end) of the tag's own first (or last) text node. */
const pushIntoTag = (tag: Element, edge: BoundaryEdge, data: string, doc: Document): void => {
  const neighbour = significant(
    edge === 'start' ? tag.firstChild : tag.lastChild,
    edge === 'start' ? 'nextSibling' : 'previousSibling',
  );
  if (neighbour?.nodeType === Node.TEXT_NODE) {
    if (edge === 'start') (neighbour as Text).insertData(0, data);
    else (neighbour as Text).appendData(data);
    return;
  }
  const text = doc.createTextNode(data);
  if (edge === 'start') tag.insertBefore(text, neighbour ?? tag.firstChild);
  else tag.insertBefore(text, neighbour ? neighbour.nextSibling : null);
};

/** Put `data` just outside the tag, joining a neighbouring text node when there is one. */
const pushOutOfTag = (tag: Element, edge: BoundaryEdge, data: string, doc: Document): void => {
  const outside = significant(
    edge === 'start' ? tag.previousSibling : tag.nextSibling,
    edge === 'start' ? 'previousSibling' : 'nextSibling',
  );
  if (outside?.nodeType === Node.TEXT_NODE) {
    if (edge === 'start') (outside as Text).appendData(data);
    else (outside as Text).insertData(0, data);
    return;
  }
  const text = doc.createTextNode(data);
  tag.parentNode?.insertBefore(text, edge === 'start' ? tag : tag.nextSibling);
};

const grow = (
  tag: Element,
  edge: BoundaryEdge,
  doc: Document,
  isBlock: (node: Node) => boolean,
): boolean => {
  const outside = significant(
    edge === 'start' ? tag.previousSibling : tag.nextSibling,
    edge === 'start' ? 'previousSibling' : 'nextSibling',
  );
  if (!outside) return false; // already at the parent's edge

  if (outside.nodeType === Node.TEXT_NODE) {
    const text = outside as Text;
    const data = edge === 'start' ? takeLastGrapheme(text) : takeFirstGrapheme(text);
    if (!data) return false;
    removeIfEmpty(text);
    pushIntoTag(tag, edge, data, doc);
    return true;
  }

  if (outside.nodeType !== Node.ELEMENT_NODE || isBlock(outside)) return false;
  if (edge === 'start') tag.insertBefore(outside, tag.firstChild);
  else tag.appendChild(outside);
  return true;
};

const shrink = (
  tag: Element,
  edge: BoundaryEdge,
  doc: Document,
  isBlock: (node: Node) => boolean,
): boolean => {
  const inner = significant(
    edge === 'start' ? tag.firstChild : tag.lastChild,
    edge === 'start' ? 'nextSibling' : 'previousSibling',
  );
  if (!inner) return false;

  if (inner.nodeType === Node.TEXT_NODE) {
    const text = inner as Text;
    // Keep at least one visible character inside.
    const peek = segmentGraphemes(text.data.replace(INVISIBLE, ''));
    const one = (edge === 'start' ? peek[0] : peek[peek.length - 1]) ?? '';
    if (one === '' || visibleLength(tag) <= one.length) return false;
    const data = edge === 'start' ? takeFirstGrapheme(text) : takeLastGrapheme(text);
    removeIfEmpty(text);
    pushOutOfTag(tag, edge, data, doc);
    return true;
  }

  if (inner.nodeType !== Node.ELEMENT_NODE || isBlock(inner)) return false;
  if (visibleLength(tag) <= visibleLength(inner)) return false;
  tag.parentNode?.insertBefore(inner, edge === 'start' ? tag : tag.nextSibling);
  return true;
};

export const moveTagBoundary = (
  tag: Element,
  edge: BoundaryEdge,
  direction: BoundaryDirection,
  doc: Document,
  isBlock: (node: Node) => boolean = () => false,
): BoundaryMoveResult => {
  const growing = (edge === 'start') === (direction === 'left');
  const moved = growing ? grow(tag, edge, doc, isBlock) : shrink(tag, edge, doc, isBlock);
  if (!moved) return { moved: false, caret: null };

  const caret =
    edge === 'start' ? { node: ensureEntryText(tag, doc), offset: 0 } : ensureEndCaret(tag, doc);
  return { moved: true, caret };
};

/** Which boundary the caret is nearer to; a tie goes to the closing one. */
export const chooseBoundaryEdge = (tag: Element, container: Node, offset: number): BoundaryEdge => {
  if (container !== tag && !tag.contains(container)) return 'end';
  const range = tag.ownerDocument.createRange();
  range.setStart(tag, 0);
  range.setEnd(container, offset);
  const before = range.toString().replace(INVISIBLE, '').length;
  const total = visibleLength(tag);
  return before * 2 < total ? 'start' : 'end';
};

/** Alt+Shift+←/→ (Windows, Linux) or Ctrl+Option+←/→ (Mac). */
export const matchesTagBoundaryMove = (event: KeyboardEvent, isMac: boolean): boolean => {
  if (event.code !== 'ArrowLeft' && event.code !== 'ArrowRight') return false;
  if (event.isComposing || event.metaKey) return false;
  return isMac
    ? event.ctrlKey && event.altKey && !event.shiftKey
    : event.altKey && event.shiftKey && !event.ctrlKey;
};
