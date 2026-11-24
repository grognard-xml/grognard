import { updateTagColor } from './tagColors';
import type { TagColorEntry } from './tagColors';

/**
 * Undo/redo for tag appearance changes (schema/tag-colors.json), interleaved with the
 * visual editor's own undo stack. Each change remembers the editor's undo position when it
 * was made; Undo/Redo take the appearance change only when it is the most recent step at
 * the editor's current position, otherwise they fall through to the document.
 */

export const TAG_COLORS_CHANGED_EVENT = 'desktop:tag-colors-changed';

export interface AppearanceChange {
  rootPath: string;
  /** Rule key: `persName` or `persName[type=author]`. */
  key: string;
  before: TagColorEntry | null;
  after: TagColorEntry | null;
}

interface AppearanceEntry extends AppearanceChange {
  position: number;
  at: number;
}

const MAX_ENTRIES = 200;
/** Changes to the same rule closer together than this (a colour-picker drag) form one step. */
const COALESCE_MS = 1000;

let undoStack: AppearanceEntry[] = [];
let redoStack: AppearanceEntry[] = [];
let position = 0;
let flushPending: (() => Promise<void>) | null = null;

/** The panel registers how to write out a debounced, not-yet-saved colour change. */
export const setAppearanceFlushHandler = (handler: (() => Promise<void>) | null): void => {
  flushPending = handler;
};

export const clearAppearanceHistory = (): void => {
  undoStack = [];
  redoStack = [];
  position = 0;
};

export const setAppearanceDocumentPosition = (next: number): void => {
  position = next;
};

export const recordAppearanceChange = (change: AppearanceChange, now = Date.now()): void => {
  redoStack = [];
  const top = undoStack[undoStack.length - 1];
  if (
    top &&
    top.rootPath === change.rootPath &&
    top.key === change.key &&
    top.position === position &&
    now - top.at < COALESCE_MS
  ) {
    top.after = change.after;
    top.at = now;
    return;
  }
  undoStack.push({ ...change, position, at: now });
  if (undoStack.length > MAX_ENTRIES) undoStack.shift();
};

export const canUndoAppearance = (): boolean => {
  const top = undoStack[undoStack.length - 1];
  return Boolean(top && top.position >= position);
};

export const canRedoAppearance = (): boolean => {
  const top = redoStack[redoStack.length - 1];
  return Boolean(top && top.position <= position);
};

const apply = async (entry: AppearanceEntry, colors: TagColorEntry | null): Promise<void> => {
  await updateTagColor(entry.rootPath, entry.key, colors);
  window.dispatchEvent(
    new CustomEvent(TAG_COLORS_CHANGED_EVENT, { detail: { rootPath: entry.rootPath } }),
  );
};

/** Undo the latest appearance change if it is newer than the document's current position. */
export const undoAppearance = async (): Promise<boolean> => {
  if (!canUndoAppearance()) return false;
  await flushPending?.();
  const entry = undoStack.pop()!;
  redoStack.push(entry);
  await apply(entry, entry.before);
  return true;
};

export const redoAppearance = async (): Promise<boolean> => {
  if (!canRedoAppearance()) return false;
  await flushPending?.();
  const entry = redoStack.pop()!;
  undoStack.push(entry);
  await apply(entry, entry.after);
  return true;
};

interface UndoLevelLike {
  level?: unknown;
}

interface BindableEditor {
  on: (name: string, callback: (event: UndoLevelLike) => void) => unknown;
  off?: (name: string, callback: (event: UndoLevelLike) => void) => unknown;
  undoManager: { data: unknown[] };
}

/** Follow the editor's undo position (data index of the level just added/undone/redone). */
export const bindAppearanceHistoryToEditor = (editor: BindableEditor): (() => void) => {
  const sync = (event: UndoLevelLike) => {
    const index = editor.undoManager.data.indexOf(event.level);
    if (index >= 0) setAppearanceDocumentPosition(index);
  };
  const onAddUndo = (event: UndoLevelLike) => {
    sync(event);
    // A new document edit abandons any redo branch, including colour changes in it.
    redoStack = [];
  };
  const onClear = () => clearAppearanceHistory();

  editor.on('AddUndo', onAddUndo);
  editor.on('Undo', sync);
  editor.on('Redo', sync);
  editor.on('ClearUndos', onClear);

  return () => {
    editor.off?.('AddUndo', onAddUndo);
    editor.off?.('Undo', sync);
    editor.off?.('Redo', sync);
    editor.off?.('ClearUndos', onClear);
  };
};
