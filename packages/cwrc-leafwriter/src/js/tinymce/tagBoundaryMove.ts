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

/** Length of the first visible character of `data`, with any invisible marks before it. */
const firstUnitLength = (data: string): number => {
  const marks = startsWithInvisible.exec(data)?.[0] ?? '';
  const first = segmentGraphemes(data.slice(marks.length))[0] ?? '';
  return first === '' ? 0 : marks.length + first.length;
};

/** Length of the last visible character of `data`, with any invisible marks after it. */
const lastUnitLength = (data: string): number => {
  const marks = endsWithInvisible.exec(data)?.[0] ?? '';
  const parts = segmentGraphemes(data.slice(0, data.length - marks.length));
  const last = parts[parts.length - 1] ?? '';
  return last === '' ? 0 : last.length + marks.length;
};

/** Remove and return the first visible character of `node`, with any invisible marks before it. */
const takeFirstGrapheme = (node: Text): string => {
  const length = firstUnitLength(node.data);
  const taken = node.data.slice(0, length);
  node.deleteData(0, length);
  return taken;
};

/** Remove and return the last visible character of `node`, with any invisible marks after it. */
const takeLastGrapheme = (node: Text): string => {
  const length = lastUnitLength(node.data);
  const taken = node.data.slice(node.data.length - length);
  node.deleteData(node.data.length - length, length);
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

  return { moved: true, caret: caretInsideBoundary(tag, edge, doc) };
};

/** Caret just inside the opening or closing boundary of `tag`. */
export const caretInsideBoundary = (tag: Element, edge: BoundaryEdge, doc: Document): TextCaret =>
  edge === 'start' ? { node: ensureEntryText(tag, doc), offset: 0 } : ensureEndCaret(tag, doc);

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

export interface DocPoint {
  node: Node;
  offset: number;
}

/** Where `b` lies relative to `a`: -1 before, 0 the same position, 1 after. */
const comparePoints = (doc: Document, a: DocPoint, b: DocPoint): -1 | 0 | 1 => {
  const range = doc.createRange();
  range.setStart(a.node, a.offset);
  range.collapse(true);
  return range.comparePoint(b.node, b.offset) as -1 | 0 | 1;
};

const indexOf = (node: Node): number =>
  Array.from(node.parentNode?.childNodes ?? []).indexOf(node as ChildNode);

/**
 * Where the boundary would sit after one more step, and whether that step takes a whole element
 * with it. Null when the step is not possible (parent edge, block element).
 */
const nextBoundaryPoint = (
  tag: Element,
  edge: BoundaryEdge,
  growing: boolean,
  isBlock: (node: Node) => boolean,
): { point: DocPoint; wholeElement: boolean } | null => {
  const outsideStep = edge === 'start' ? 'previousSibling' : 'nextSibling';
  const insideStep = edge === 'start' ? 'nextSibling' : 'previousSibling';

  const node = growing
    ? significant(edge === 'start' ? tag.previousSibling : tag.nextSibling, outsideStep)
    : significant(edge === 'start' ? tag.firstChild : tag.lastChild, insideStep);
  if (!node) return null;

  if (node.nodeType === Node.TEXT_NODE) {
    const text = node as Text;
    // The boundary lands at the start of the text left on the far side of the character moved.
    const atStartOfText = (growing ? edge === 'end' : edge === 'start') === true;
    const offset = atStartOfText
      ? firstUnitLength(text.data)
      : text.data.length - lastUnitLength(text.data);
    return { point: { node: text, offset }, wholeElement: false };
  }

  if (node.nodeType !== Node.ELEMENT_NODE || isBlock(node)) return null;
  const parent = growing ? node.parentNode! : tag;
  const index = indexOf(node);
  const after = growing ? edge === 'end' : edge === 'start';
  return { point: { node: parent, offset: after ? index + 1 : index }, wholeElement: true };
};

/**
 * Drag a boundary toward `target`, one step at a time, using the same rules as the keyboard move.
 * A whole neighbouring element is taken in or pushed out only once the target is clear of it, so
 * a boundary parked inside an element does not flicker. Returns how many steps were taken.
 */
export const dragTagBoundaryTo = (
  tag: Element,
  edge: BoundaryEdge,
  target: DocPoint,
  doc: Document,
  isBlock: (node: Node) => boolean = () => false,
  maxSteps = 500,
): number => {
  // A live range: it follows the target as characters move, where a fixed offset would drift.
  const live = doc.createRange();
  live.setStart(target.node, target.offset);
  live.collapse(true);

  let steps = 0;
  while (steps < maxSteps) {
    const here: DocPoint = { node: live.startContainer, offset: live.startOffset };
    const boundary: DocPoint =
      edge === 'start' ? { node: tag, offset: 0 } : { node: tag, offset: tag.childNodes.length };
    const side = comparePoints(doc, boundary, here); // target before (-1) or after (1)
    if (side === 0) break;

    const growing = edge === 'start' ? side < 0 : side > 0;
    const next = nextBoundaryPoint(tag, edge, growing, isBlock);
    if (!next) break;

    const toTarget = comparePoints(doc, next.point, here);
    if (growing) {
      // Do not overshoot a character; an element goes in whole.
      if (!next.wholeElement && (edge === 'start' ? toTarget > 0 : toTarget < 0)) break;
    } else if (edge === 'start' ? toTarget < 0 : toTarget > 0) {
      break; // the unit to push out is not clear of the target yet
    }

    const direction: BoundaryDirection = growing === (edge === 'end') ? 'right' : 'left';
    if (!moveTagBoundary(tag, edge, direction, doc, isBlock).moved) break;
    steps += 1;
  }
  return steps;
};

export interface BoundaryZone {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface BoundaryZones {
  start: BoundaryZone | null;
  end: BoundaryZone | null;
}

const MIN_ZONE_WIDTH = 3;
/** Alt-grab band at a tag's edge when no label is shown, and how far outside it still counts. */
const EDGE_GRAB_PX = 6;
const EDGE_GRAB_SLOP = 3;

const firstRect = (rects: ArrayLike<DOMRect>): DOMRect | null => {
  for (const rect of Array.from(rects)) {
    if (rect.width > 0 || rect.height > 0) return rect;
  }
  return null;
};

const lastRect = (rects: ArrayLike<DOMRect>): DOMRect | null => {
  for (let i = rects.length - 1; i >= 0; i -= 1) {
    if (rects[i]!.width > 0 || rects[i]!.height > 0) return rects[i]!;
  }
  return null;
};

/** Content box edge of a child: its first (or last) visible character, or an element's rects. */
const contentEdge = (child: Node, edge: BoundaryEdge): number | null => {
  if (child.nodeType === Node.TEXT_NODE) {
    const text = child as Text;
    const visible = text.data.replace(INVISIBLE, '');
    if (visible === '') return null;
    const range = text.ownerDocument.createRange();
    if (edge === 'start') {
      const at = text.data.length - text.data.replace(startsWithInvisible, '').length;
      range.setStart(text, at);
      range.setEnd(text, Math.min(at + 1, text.length));
      const rect = firstRect(range.getClientRects());
      return rect ? rect.left : null;
    }
    const at = text.data.length - (endsWithInvisible.exec(text.data)?.[0].length ?? 0);
    range.setStart(text, Math.max(at - 1, 0));
    range.setEnd(text, at);
    const rect = lastRect(range.getClientRects());
    return rect ? rect.right : null;
  }
  if (child.nodeType !== Node.ELEMENT_NODE) return null;
  const rects = (child as Element).getClientRects();
  const rect = edge === 'start' ? firstRect(rects) : lastRect(rects);
  return rect ? (edge === 'start' ? rect.left : rect.right) : null;
};

/**
 * Where the opening and closing tag labels sit. They are CSS ::before and ::after, so they have no
 * box of their own: each one is the gap between the tag's edge and its first (or last) content.
 * With `edgeGrab` (Alt held) a narrow band at each end of the tag also counts, so a boundary can be
 * grabbed when the labels are hidden. Left-to-right horizontal text only.
 */
export const boundaryZones = (tag: Element, edgeGrab = false): BoundaryZones => {
  const rects = tag.getClientRects();
  const first = firstRect(rects);
  const last = lastRect(rects);
  if (!first || !last) return { start: null, end: null };

  const firstChild = significant(tag.firstChild, 'nextSibling');
  const lastChild = significant(tag.lastChild, 'previousSibling');

  const startEdge = firstChild ? contentEdge(firstChild, 'start') : null;
  const endEdge = lastChild ? contentEdge(lastChild, 'end') : null;

  if (edgeGrab) {
    return {
      start:
        startEdge === null
          ? null
          : {
              left: first.left - EDGE_GRAB_SLOP,
              right: Math.min(Math.max(startEdge, first.left + EDGE_GRAB_PX), first.right),
              top: first.top,
              bottom: first.bottom,
            },
      end:
        endEdge === null
          ? null
          : {
              left: Math.max(Math.min(endEdge, last.right - EDGE_GRAB_PX), last.left),
              right: last.right + EDGE_GRAB_SLOP,
              top: last.top,
              bottom: last.bottom,
            },
    };
  }

  return {
    start:
      startEdge !== null && startEdge - first.left >= MIN_ZONE_WIDTH
        ? { left: first.left, right: startEdge, top: first.top, bottom: first.bottom }
        : null,
    end:
      endEdge !== null && last.right - endEdge >= MIN_ZONE_WIDTH
        ? { left: endEdge, right: last.right, top: last.top, bottom: last.bottom }
        : null,
  };
};

export const zoneAt = (zones: BoundaryZones, x: number, y: number): BoundaryEdge | null => {
  const inside = (zone: BoundaryZone | null) =>
    zone !== null && x >= zone.left && x <= zone.right && y >= zone.top && y <= zone.bottom;
  if (inside(zones.start)) return 'start';
  if (inside(zones.end)) return 'end';
  return null;
};
