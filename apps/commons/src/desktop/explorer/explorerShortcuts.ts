export type ExplorerShortcut = 'delete' | 'newFolder' | 'open' | 'parent' | 'rename';

export interface ExplorerKeyEvent {
  altKey: boolean;
  ctrlKey: boolean;
  key: string;
  metaKey: boolean;
  shiftKey: boolean;
}

/** Fired by the menu bridge on Cmd+O; the explorer sets `detail.handled` when it used it. */
export const EXPLORER_OPEN_FOCUSED_EVENT = 'desktop:explorer-open-focused';

/**
 * Maps a key press in the file navigator to the same command the system's own file manager uses:
 *  - macOS (Finder): Return renames, Cmd+O or Cmd+Down opens, Cmd+Up goes to the parent folder,
 *    Cmd+Delete moves to the trash, Cmd+Shift+N makes a new folder.
 *  - Windows and Linux (Explorer, Nautilus): Enter opens (left to the tree's own handling), F2
 *    renames, Delete deletes, Ctrl+Shift+N makes a new folder, Alt+Up goes to the parent folder.
 * Returns null for any other key. Cmd+O is a menu accelerator, so on macOS it never reaches this
 * function; see EXPLORER_OPEN_FOCUSED_EVENT.
 */
export const resolveExplorerShortcut = (
  event: ExplorerKeyEvent,
  isMac: boolean,
): ExplorerShortcut | null => {
  const { altKey, ctrlKey, key, metaKey, shiftKey } = event;
  const isDelete = key === 'Backspace' || key === 'Delete';

  if (key === 'F2' && !altKey && !ctrlKey && !metaKey && !shiftKey) return 'rename';

  if (isMac) {
    if (ctrlKey || altKey) return null;
    if (!metaKey) return key === 'Enter' && !shiftKey ? 'rename' : null;
    if (shiftKey) return key.toLowerCase() === 'n' ? 'newFolder' : null;
    if (key === 'ArrowDown' || key.toLowerCase() === 'o') return 'open';
    if (key === 'ArrowUp') return 'parent';
    return isDelete ? 'delete' : null;
  }

  if (metaKey) return null;
  if (ctrlKey) return shiftKey && !altKey && key.toLowerCase() === 'n' ? 'newFolder' : null;
  if (altKey) return key === 'ArrowUp' && !shiftKey ? 'parent' : null;
  if (shiftKey) return null;
  return key === 'Delete' ? 'delete' : null;
};
