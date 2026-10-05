import { syncActiveVisualTabContent } from './liveVisualContent';

/** Cheap fingerprint of a document's text (length + FNV-1a), to tell whether results are stale. */
export const contentSignature = (content: string): string => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < content.length; i++) {
    hash ^= content.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${content.length}:${(hash >>> 0).toString(16)}`;
};

const isSourceEditorMode = () => window.writer?.overmindState?.ui?.editorViewMode === 'source';

const activeFilePath = (): string | null =>
  window.writer?.overmindState?.editor?.resource?.filePath ??
  window.writer?.overmindState?.project?.activeTabPath ??
  null;

const openTabContent = (filePath: string): string | undefined =>
  window.writer?.overmindState?.project?.openTabs?.find(
    (tab: { filePath: string }) => tab.filePath === filePath,
  )?.content;

/**
 * The text a search of `filePath` would run on right now, read synchronously from state: the live
 * Source buffer for the active file in Source mode, otherwise the tab's content (kept in step with
 * the Visual editor by `syncActiveVisualTabContent`). Undefined for files that aren't open.
 */
export const currentContentForFileSync = (filePath: string): string | undefined => {
  if (isSourceEditorMode() && filePath === activeFilePath()) {
    return window.writer?.overmindState?.ui?.sourceCurrentContent || openTabContent(filePath);
  }
  return openTabContent(filePath);
};

/** Signatures of the open files among `filePaths`, as of the search that just produced results. */
export const signaturesForFiles = (filePaths: string[]): Map<string, string> => {
  const signatures = new Map<string, string>();
  for (const filePath of filePaths) {
    const content = currentContentForFileSync(filePath);
    if (content !== undefined) signatures.set(filePath, contentSignature(content));
  }
  return signatures;
};

/**
 * True when any recorded file's text has changed since its results were computed - an edit, a
 * tag change such as <p> -> <head>, or an external reload. Offsets in such results are wrong, so
 * they must be recomputed rather than reused. For the active Visual file the live editor is read
 * first, because tab content only catches up on a sync.
 */
export const resultsAreStale = async (
  recorded: Map<string, string>,
  filePaths?: string[],
): Promise<boolean> => {
  for (const [filePath, signature] of recorded) {
    if (filePaths && !filePaths.includes(filePath)) continue;
    const live = await syncActiveVisualTabContent(filePath);
    const current = live ?? currentContentForFileSync(filePath);
    if (current !== undefined && contentSignature(current) !== signature) return true;
  }
  return false;
};
