import { getVisualCaretForSourceSync, type VisualCaretPosition } from './sourceCursorSync';
import { findEditorNodeByTeiXPath } from './teiXPath';

export type { StoredCursorPosition } from './cursorPositionFilter';
export { filterVisualCursorPositions } from './cursorPositionFilter';

export type LeafWriterCursorPosition =
  ({ mode: 'source' } & { offset: number }) | ({ mode: 'visual' } & VisualCaretPosition);

/** The editor's root element is not always a direct child of the editor body, so use the lookup
 * the location bar uses, which also finds a wrapped root. */
const findElementByTeiXPath = (xpath: string): Element | null => {
  const body = window.writer?.editor?.getBody();
  return body ? findEditorNodeByTeiXPath(body, xpath) : null;
};

export const setVisualCaret = ({ offsetInElementText, teiXPath }: VisualCaretPosition): boolean => {
  const editor = window.writer?.editor;
  const element = findElementByTeiXPath(teiXPath);
  if (!editor || !element) {
    return false;
  }

  const doc = element.ownerDocument;
  const range = doc.createRange();
  const walker = doc.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let remaining = Math.max(0, offsetInElementText);
  let textNode = walker.nextNode();

  while (textNode) {
    const length = textNode.textContent?.length ?? 0;
    if (remaining <= length) {
      range.setStart(textNode, remaining);
      range.collapse(true);
      editor.selection.setRng(range);
      editor.currentNode = element;
      editor.focus();
      element.scrollIntoView({ block: 'center' });
      window.writer?.event('nodeChanged').publish(element);
      return true;
    }
    remaining -= length;
    textNode = walker.nextNode();
  }

  range.selectNodeContents(element);
  range.collapse(false);
  editor.selection.setRng(range);
  editor.currentNode = element;
  editor.focus();
  element.scrollIntoView({ block: 'center' });
  window.writer?.event('nodeChanged').publish(element);
  return true;
};

/**
 * Puts the Visual editor's caret at `caret` once the editor can take it. Leaving Source mode shows
 * the editor again (and, when Source edits changed the document, reloads it first, which resets the
 * caret to the start), so the placement is retried for a moment and, after a reload, waits for the
 * document to finish loading. Call it before the reload is started so the load is not missed.
 */
export const placeVisualCaretWhenReady = (
  caret: VisualCaretPosition,
  options?: { afterReload?: boolean },
): void => {
  const run = () => {
    let placed = false;
    const place = () => {
      if (window.writer?.overmindState?.ui?.editorViewMode !== 'visual') return;
      if (setVisualCaret(caret)) placed = true;
    };
    const delays = [0, 100, 300, 800];
    for (const delay of delays) window.setTimeout(place, delay);
    // Say why when it never lands, instead of leaving the caret at the start without a word.
    window.setTimeout(
      () => {
        if (placed) return;
        const body = window.writer?.editor?.getBody();
        console.warn('[caret-restore] could not place the Visual caret', {
          caret,
          mode: window.writer?.overmindState?.ui?.editorViewMode,
          hasEditorBody: Boolean(body),
          bodyChildTags: body
            ? Array.from(body.children)
                .slice(0, 5)
                .map((child) => child.getAttribute('_tag') ?? child.tagName)
            : [],
          rootFound: Boolean(body?.querySelector('[_tag]')),
          elementFound: Boolean(findElementByTeiXPath(caret.teiXPath)),
        });
      },
      delays[delays.length - 1]! + 100,
    );
  };

  const writer = window.writer;
  if (!options?.afterReload || !writer) {
    run();
    return;
  }

  let finished = false;
  const onLoaded = () => {
    if (finished) return;
    finished = true;
    writer.event('documentLoaded').unsubscribe(onLoaded);
    run();
  };
  writer.event('documentLoaded').subscribe(onLoaded);
  // A reload that never reports back must not leave the listener behind.
  window.setTimeout(() => {
    if (finished) return;
    finished = true;
    writer.event('documentLoaded').unsubscribe(onLoaded);
  }, 10000);
};

export const captureLeafWriterCursorPosition = (): LeafWriterCursorPosition | null => {
  const mode = window.writer?.overmindState?.ui?.editorViewMode;
  if (mode === 'source') {
    const offset = window.__leafWriterSourceFind?.getCursorOffset?.();
    return typeof offset === 'number' ? { mode: 'source', offset } : null;
  }

  const visualCaret = getVisualCaretForSourceSync();
  return visualCaret ? { mode: 'visual', ...visualCaret } : null;
};

export const restoreLeafWriterCursorPosition = async (
  position: LeafWriterCursorPosition,
): Promise<boolean> => {
  if (position.mode === 'source') {
    await window.writer?.overmindActions?.ui?.enterSourceMode?.({ restoring: true });
    return (
      window.__leafWriterSourceFind?.setCursorOffset?.({
        offset: position.offset,
        focusEditor: true,
      }) ?? false
    );
  }

  window.writer?.overmindActions?.ui?.setEditorViewMode?.('visual');
  return setVisualCaret(position);
};

declare global {
  interface Window {
    __leafWriterCursorSession?: {
      capture: typeof captureLeafWriterCursorPosition;
      restore: typeof restoreLeafWriterCursorPosition;
    };
  }
}

window.__leafWriterCursorSession = {
  capture: captureLeafWriterCursorPosition,
  restore: restoreLeafWriterCursorPosition,
};
