import {
  boundaryZones,
  dragTagBoundaryTo,
  zoneAt,
  type BoundaryEdge,
  type DocPoint,
} from './tagBoundaryMove';

/**
 * Drag the opening or closing label of an inline tag (the pills shown in show-tags mode) to move
 * that boundary. Press on a label and move: the boundary follows the pointer, character by
 * character, under the same rules as the keyboard move (see tagBoundaryMove.ts). The whole drag is
 * one undo step. A press that does not move is left to the editor as an ordinary click.
 *
 * Holding Alt grabs a narrow band at either end of the tag's text instead, so this also works when
 * the labels are hidden.
 */

export interface TagBoundaryDragOptions {
  body: HTMLElement;
  doc: Document;
  isImmovable: (node: Node) => boolean;
  isInlineTag: (el: Element) => boolean;
  /** The document is editable. */
  isEnabled: () => boolean;
  /** Show-tags mode is on, so the labels can be grabbed without Alt. */
  tagsVisible: () => boolean;
  /** Commit the undo step before the first change. */
  beginUndoStep: () => void;
  /** Apply DOM changes without TinyMCE adding an undo level for each. */
  withoutUndo: (fn: () => void) => void;
  /** The drag moved at least one boundary step. */
  onFinish: (tag: Element, edge: BoundaryEdge) => void;
}

const DRAG_THRESHOLD_PX = 4;
const MAX_ANCESTORS = 6;

const pointFromXY = (doc: Document, x: number, y: number): DocPoint | null => {
  const withCaret = doc as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  };
  if (withCaret.caretRangeFromPoint) {
    const range = withCaret.caretRangeFromPoint(x, y);
    return range ? { node: range.startContainer, offset: range.startOffset } : null;
  }
  const position = withCaret.caretPositionFromPoint?.(x, y);
  return position ? { node: position.offsetNode, offset: position.offset } : null;
};

export const attachTagBoundaryDrag = (options: TagBoundaryDragOptions): (() => void) => {
  const { body, doc } = options;
  let pending: { tag: Element; edge: BoundaryEdge; x: number; y: number } | null = null;
  let dragging = false;
  let steps = 0;
  let latest: { x: number; y: number } | null = null;
  let frame = 0;
  let savedCursor: string | null = null;

  /** The inline tag whose opening or closing label is under the pointer. */
  const labelUnder = (
    target: EventTarget | null,
    x: number,
    y: number,
    edgeGrab: boolean,
  ): { tag: Element; edge: BoundaryEdge } | null => {
    // Not `instanceof Element`: the editor is an iframe, whose elements belong to another realm.
    let el: Element | null =
      (target as Node | null)?.nodeType === Node.ELEMENT_NODE ? (target as Element) : null;
    for (let depth = 0; el && el !== body && depth < MAX_ANCESTORS; el = el.parentElement) {
      if (!options.isInlineTag(el)) continue;
      depth += 1;
      const edge = zoneAt(boundaryZones(el, edgeGrab), x, y);
      if (edge) return { tag: el, edge };
    }
    return null;
  };

  const setCursor = (cursor: string | null) => {
    if (cursor !== null) {
      if (savedCursor === null) savedCursor = body.style.cursor;
      body.style.cursor = cursor;
    } else if (savedCursor !== null) {
      body.style.cursor = savedCursor;
      savedCursor = null;
    }
  };

  const applyDrag = () => {
    frame = 0;
    if (!dragging || !pending || !latest) return;
    const { tag, edge } = pending;
    const point = pointFromXY(doc, latest.x, latest.y);
    if (!point) return;
    options.withoutUndo(() => {
      steps += dragTagBoundaryTo(tag, edge, point, doc, options.isImmovable);
    });
  };

  const onMouseDown = (event: MouseEvent) => {
    pending = null;
    if (event.button !== 0 || event.detail > 1) return;
    if (event.shiftKey || event.ctrlKey || event.metaKey) return;
    if (!options.isEnabled()) return;
    // Without Alt, only the visible labels can be grabbed.
    if (!event.altKey && !options.tagsVisible()) return;
    const hit = labelUnder(event.target, event.clientX, event.clientY, event.altKey);
    if (hit) pending = { ...hit, x: event.clientX, y: event.clientY };
  };

  const onMouseMove = (event: MouseEvent) => {
    if (pending && !dragging) {
      if (event.buttons !== 1) {
        pending = null;
        return;
      }
      if (
        Math.abs(event.clientX - pending.x) + Math.abs(event.clientY - pending.y) <
        DRAG_THRESHOLD_PX
      ) {
        return;
      }
      dragging = true;
      steps = 0;
      options.beginUndoStep();
      doc.getSelection()?.removeAllRanges();
      setCursor('ew-resize');
    }

    if (dragging) {
      event.preventDefault();
      latest = { x: event.clientX, y: event.clientY };
      if (!frame) frame = window.requestAnimationFrame(applyDrag);
      return;
    }

    // Hover: show that the label can be dragged.
    if (event.buttons === 0 && options.isEnabled() && (event.altKey || options.tagsVisible())) {
      const hit = labelUnder(event.target, event.clientX, event.clientY, event.altKey);
      setCursor(hit ? 'ew-resize' : null);
    } else if (event.buttons === 0) {
      setCursor(null);
    }
  };

  const finish = () => {
    const finished = pending;
    const wasDragging = dragging;
    pending = null;
    dragging = false;
    if (frame) {
      window.cancelAnimationFrame(frame);
      applyDrag();
    }
    latest = null;
    if (!wasDragging) return;
    setCursor(null);
    if (finished && steps > 0) options.onFinish(finished.tag, finished.edge);
  };

  const onClick = (event: MouseEvent) => {
    // The release that ends a drag is not a click on the text underneath.
    if (suppressClick) {
      suppressClick = false;
      event.preventDefault();
      event.stopPropagation();
    }
  };
  let suppressClick = false;

  const onMouseUp = () => {
    if (dragging) suppressClick = true;
    finish();
  };
  const onSelectStart = (event: Event) => {
    if (dragging) event.preventDefault();
  };

  body.addEventListener('mousedown', onMouseDown, true);
  doc.addEventListener('mousemove', onMouseMove, true);
  doc.addEventListener('mouseup', onMouseUp, true);
  doc.addEventListener('mouseleave', finish);
  body.addEventListener('click', onClick, true);
  doc.addEventListener('selectstart', onSelectStart, true);

  return () => {
    body.removeEventListener('mousedown', onMouseDown, true);
    doc.removeEventListener('mousemove', onMouseMove, true);
    doc.removeEventListener('mouseup', onMouseUp, true);
    doc.removeEventListener('mouseleave', finish);
    body.removeEventListener('click', onClick, true);
    doc.removeEventListener('selectstart', onSelectStart, true);
    setCursor(null);
  };
};
