import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';

const FIND_DECORATION_CLASS = 'lw-source-find-hit';
const FIND_ACTIVE_DECORATION_CLASS = 'lw-source-find-hit-active';
const FIND_LINE_DECORATION_CLASS = 'lw-source-find-line-active';

let decorationCollection: monaco.editor.IEditorDecorationsCollection | undefined;
let registeredEditor: monaco.editor.IStandaloneCodeEditor | null = null;
let cachedHitRanges: { end: number; start: number }[] = [];

const revealFindHitRange = (editor: monaco.editor.IStandaloneCodeEditor, range: monaco.IRange) => {
  editor.revealRangeInCenterIfOutsideViewport(range, monaco.editor.ScrollType.Immediate);
};

const applyDecorationsForHits = (
  editor: monaco.editor.IStandaloneCodeEditor,
  content: string,
  hits: { end: number; start: number }[],
  activeStart: number,
  activeEnd: number,
) => {
  const decorations: monaco.editor.IModelDeltaDecoration[] = hits.map(({ start, end }) => {
    const isActive = start === activeStart && end === activeEnd;
    return {
      range: offsetToRange(content, start, end),
      options: {
        className: isActive ? FIND_ACTIVE_DECORATION_CLASS : FIND_DECORATION_CLASS,
        inlineClassName: isActive ? FIND_ACTIVE_DECORATION_CLASS : FIND_DECORATION_CLASS,
      },
    };
  });

  const activeRange = offsetToRange(content, activeStart, activeEnd);
  decorations.push({
    range: new monaco.Range(
      activeRange.startLineNumber,
      1,
      activeRange.endLineNumber,
      editor.getModel()?.getLineMaxColumn(activeRange.endLineNumber) ?? 1,
    ),
    options: {
      isWholeLine: true,
      className: FIND_LINE_DECORATION_CLASS,
    },
  });

  decorationCollection?.clear();
  decorationCollection = editor.createDecorationsCollection(decorations);
};

const buildSearchRegex = (query: string, useRegex: boolean, ignoreCase = false) => {
  const flags = ignoreCase ? 'giu' : 'gu';
  if (useRegex) {
    try {
      return new RegExp(query, flags);
    } catch {
      return null;
    }
  }

  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(escaped, flags);
};

const offsetToPosition = (content: string, offset: number) => {
  let line = 1;
  let lineStart = 0;

  for (let i = 0; i < offset && i < content.length; i++) {
    if (content[i] === '\n') {
      line += 1;
      lineStart = i + 1;
    }
  }

  return { lineNumber: line, column: offset - lineStart + 1 };
};

const offsetToRange = (content: string, start: number, end: number) => {
  const from = offsetToPosition(content, start);
  const to = offsetToPosition(content, end);
  return new monaco.Range(from.lineNumber, from.column, to.lineNumber, to.column);
};

export const registerSourceFindEditor = (editor: monaco.editor.IStandaloneCodeEditor | null) => {
  registeredEditor = editor;
  if (!editor) {
    decorationCollection?.clear();
    decorationCollection = undefined;
  }
};

export const clearFindHighlightsInSourceEditor = () => {
  decorationCollection?.clear();
  decorationCollection = undefined;
  cachedHitRanges = [];
};

export const setCursorOffsetInSourceEditor = ({
  offset,
  focusEditor = true,
}: {
  focusEditor?: boolean;
  offset: number;
}): boolean => {
  const editor = registeredEditor;
  if (!editor) return false;

  const model = editor.getModel();
  if (!model) return false;

  const clamped = Math.max(0, Math.min(offset, model.getValueLength()));
  const position = model.getPositionAt(clamped);
  editor.setPosition(position);
  editor.revealPositionInCenterIfOutsideViewport(position, monaco.editor.ScrollType.Immediate);
  if (focusEditor) {
    editor.focus();
  }

  window.dispatchEvent(new CustomEvent('lw:source-cursor-moved', { detail: { offset: clamped } }));

  return true;
};

export const getCursorOffsetInSourceEditor = (): number | null => {
  const editor = registeredEditor;
  if (!editor) return null;

  const model = editor.getModel();
  const position = editor.getPosition();
  if (!model || !position) return null;

  return model.getOffsetAt(position);
};

export const revealRangeInSourceEditor = ({
  content,
  start,
  end,
  focusEditor = true,
}: {
  content: string;
  end: number;
  focusEditor?: boolean;
  start: number;
}): boolean => {
  const editor = registeredEditor;
  if (!editor) return false;

  ensureHighlightStyles();
  clearFindHighlightsInSourceEditor();

  const range = offsetToRange(content, start, end);
  decorationCollection = editor.createDecorationsCollection([
    {
      range,
      options: {
        className: FIND_ACTIVE_DECORATION_CLASS,
        inlineClassName: FIND_ACTIVE_DECORATION_CLASS,
        isWholeLine: end - start > 120,
      },
    },
    {
      range: new monaco.Range(
        range.startLineNumber,
        1,
        range.endLineNumber,
        editor.getModel()?.getLineMaxColumn(range.endLineNumber) ?? 1,
      ),
      options: {
        isWholeLine: true,
        className: FIND_LINE_DECORATION_CLASS,
      },
    },
  ]);

  revealFindHitRange(editor, range);
  if (focusEditor) {
    editor.focus();
  }
  return true;
};

/** Scroll to a hit during cycling without re-scanning the file or forcing center scroll. */
export const scrollToSourceFindHit = ({
  content,
  end,
  start,
}: {
  content: string;
  end: number;
  start: number;
}): boolean => {
  const editor = registeredEditor;
  if (!editor) return false;

  ensureHighlightStyles();

  if (cachedHitRanges.length > 0) {
    applyDecorationsForHits(editor, content, cachedHitRanges, start, end);
  } else {
    const jumpRange = offsetToRange(content, start, end);
    revealFindHitRange(editor, jumpRange);
    return false;
  }

  const jumpRange = offsetToRange(content, start, end);
  revealFindHitRange(editor, jumpRange);

  return true;
};

export const applyFindJumpInSourceEditor = ({
  content,
  ignoreCase,
  query,
  useRegex,
  start,
  end,
}: {
  content: string;
  ignoreCase: boolean;
  query: string;
  useRegex: boolean;
  start: number;
  end: number;
}): boolean => {
  const editor = registeredEditor;
  if (!editor || !query.trim()) return false;

  ensureHighlightStyles();
  clearFindHighlightsInSourceEditor();

  const regex = buildSearchRegex(query.trim(), useRegex, ignoreCase);
  if (!regex) return false;

  const hits: { end: number; start: number }[] = [];

  for (const match of content.matchAll(regex)) {
    if (match.index === undefined) continue;

    const matchStart = match.index;
    const matchEnd = matchStart + match[0].length;
    hits.push({ start: matchStart, end: matchEnd });

    if (match[0].length === 0) {
      regex.lastIndex += 1;
    }
  }

  if (hits.length === 0) {
    hits.push({ start, end });
  }

  cachedHitRanges = hits;
  applyDecorationsForHits(editor, content, hits, start, end);

  const jumpRange = offsetToRange(content, start, end);
  revealFindHitRange(editor, jumpRange);

  return true;
};

const ensureHighlightStyles = () => {
  if (document.getElementById('lw-source-find-styles')) return;

  const style = document.createElement('style');
  style.id = 'lw-source-find-styles';
  style.textContent = `
    .${FIND_DECORATION_CLASS} {
      background-color: #fff176;
      border-radius: 1px;
    }
    .${FIND_ACTIVE_DECORATION_CLASS} {
      background-color: #ffb74d;
      box-shadow: 0 0 0 1px #f57c00;
      border-radius: 1px;
    }
    .${FIND_LINE_DECORATION_CLASS} {
      box-shadow: inset 5px 0 0 #c62828, inset -5px 0 0 #c62828;
    }
  `;
  document.head?.appendChild(style);
};

export const replaceRangeInSourceEditor = ({
  content,
  end,
  replacement,
  start,
}: {
  content: string;
  end: number;
  replacement: string;
  start: number;
}): boolean => {
  const editor = registeredEditor;
  if (!editor) return false;

  const range = offsetToRange(content, start, end);
  const ok = editor.executeEdits('find-replace', [
    {
      range,
      text: replacement,
      forceMoveMarkers: true,
    },
  ]);

  if (ok) {
    cachedHitRanges = [];
    const newEnd = start + replacement.length;
    const selectionRange = offsetToRange(editor.getValue(), start, newEnd);
    editor.setSelection(selectionRange);
    editor.focus();
  }

  return ok;
};

export const undoSourceEditor = async (): Promise<string | null> => {
  const editor = registeredEditor;
  if (!editor) return null;

  const before = editor.getValue();
  editor.focus();
  const action = editor.getAction('editor.action.undo');
  if (action) {
    await Promise.resolve(action.run());
  } else {
    editor.trigger('keyboard', 'editor.action.undo', null);
  }

  const after = editor.getValue();
  if (after === before) return null;

  window.writer?.overmindActions?.ui?.setSourceCurrentContent?.(after);

  return after;
};

export const redoSourceEditor = async (): Promise<string | null> => {
  const editor = registeredEditor;
  if (!editor) return null;

  const before = editor.getValue();
  editor.focus();
  const action = editor.getAction('editor.action.redo');
  if (action) {
    await Promise.resolve(action.run());
  } else {
    editor.trigger('keyboard', 'editor.action.redo', null);
  }

  const after = editor.getValue();

  if (after === before) {
    return null;
  }

  window.writer?.overmindActions?.ui?.setSourceCurrentContent?.(after);

  return after;
};

export const DESKTOP_OPEN_FIND_EVENT = 'desktop:open-find';

declare global {
  interface Window {
    /** One-shot: the next external value sync into the source editor replaces content via
     * setValue (clearing the undo stack) instead of an undoable edit. Set by desktop reload
     * paths after translation reindexing so id writes can't be undone. */
    __leafWriterNextSourceSyncResetsUndo?: boolean;
    /** The last change of the Source editor's cursor and what caused it (see XmlMonacoEditor). */
    __leafWriterSourceCursorTrace?: { at: number; offset: number; reason: number; source: string };
    __leafWriterSourceFind?: {
      applyJump: typeof applyFindJumpInSourceEditor;
      clear: typeof clearFindHighlightsInSourceEditor;
      replaceRange: typeof replaceRangeInSourceEditor;
      revealRange: typeof revealRangeInSourceEditor;
      scrollToHit: typeof scrollToSourceFindHit;
      getCursorOffset: typeof getCursorOffsetInSourceEditor;
      setCursorOffset: typeof setCursorOffsetInSourceEditor;
      undo: typeof undoSourceEditor;
      redo: typeof redoSourceEditor;
    };
  }
}

window.__leafWriterSourceFind = {
  applyJump: applyFindJumpInSourceEditor,
  clear: clearFindHighlightsInSourceEditor,
  replaceRange: replaceRangeInSourceEditor,
  revealRange: revealRangeInSourceEditor,
  scrollToHit: scrollToSourceFindHit,
  getCursorOffset: getCursorOffsetInSourceEditor,
  setCursorOffset: setCursorOffsetInSourceEditor,
  undo: undoSourceEditor,
  redo: redoSourceEditor,
};

export const dispatchDesktopOpenFind = () => {
  window.dispatchEvent(new CustomEvent(DESKTOP_OPEN_FIND_EVENT));
};
