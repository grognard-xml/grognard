/**
 * Remembers where the scholar was in the Visual editor and puts them back there after the
 * document is reloaded (for instance after an outside program changed the file). The editor
 * rebuilds its whole DOM on a reload, so the place is kept as a character offset into the body's
 * text, not as a node or a pixel distance.
 */

export interface VisualPosition {
  /** Character offset of the caret, or null when the editor had no caret. */
  caret: number | null;
  /** Character offset of the text at the top of the viewport. */
  top: number | null;
  scrollTop: number;
}

interface EditorLike {
  getBody: () => HTMLElement;
  getDoc: () => Document;
  selection: { getRng: () => Range; setRng: (range: Range) => void };
}

const textOffset = (body: HTMLElement, node: Node, offset: number): number => {
  const range = body.ownerDocument.createRange();
  range.selectNodeContents(body);
  range.setEnd(node, offset);
  return range.toString().length;
};

const locate = (body: HTMLElement, target: number): { node: Text; offset: number } | null => {
  const walker = body.ownerDocument.createTreeWalker(body, NodeFilter.SHOW_TEXT);
  let seen = 0;
  let last: Text | null = null;
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    last = node;
    if (seen + node.data.length >= target) return { node, offset: target - seen };
    seen += node.data.length;
  }
  return last ? { node: last, offset: last.data.length } : null;
};

const scroller = (doc: Document): Element => doc.scrollingElement ?? doc.documentElement;

export const captureVisualPosition = (editor: EditorLike): VisualPosition | null => {
  try {
    const body = editor.getBody();
    const doc = editor.getDoc();
    const scrollTop = scroller(doc).scrollTop;

    let caret: number | null = null;
    const rng = editor.selection.getRng();
    if (body.contains(rng.startContainer))
      caret = textOffset(body, rng.startContainer, rng.startOffset);

    let top: number | null = null;
    const topRange = doc.caretRangeFromPoint?.(8, 8);
    if (topRange && body.contains(topRange.startContainer)) {
      top = textOffset(body, topRange.startContainer, topRange.startOffset);
    }
    return { caret, top, scrollTop };
  } catch {
    return null;
  }
};

export const restoreVisualPosition = (editor: EditorLike, position: VisualPosition): void => {
  try {
    const body = editor.getBody();
    const doc = editor.getDoc();

    if (position.caret !== null) {
      const spot = locate(body, position.caret);
      if (spot) {
        const range = doc.createRange();
        range.setStart(spot.node, spot.offset);
        range.collapse(true);
        editor.selection.setRng(range);
      }
    }

    const view = scroller(doc);
    // Scroll back to where the viewport was, then correct by the text that was at its top, which
    // still lines up when the outside change added or removed content above it.
    view.scrollTop = position.scrollTop;
    if (position.top !== null) {
      const spot = locate(body, position.top);
      if (spot) {
        const range = doc.createRange();
        range.setStart(spot.node, Math.min(spot.offset, spot.node.data.length));
        range.collapse(true);
        const rect = range.getBoundingClientRect();
        if (rect.height || rect.top) view.scrollTop += rect.top - 8;
      }
    }
  } catch {
    // The position is a convenience; a failure leaves the editor at the top.
  }
};
