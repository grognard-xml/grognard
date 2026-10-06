/**
 * Remembers which regions were collapsed per document, across restarts.
 * Stored in localStorage as a small LRU map; every access tolerates storage
 * being unavailable.
 */

export interface SavedFold {
  line: number;
  name: string;
}

const STORAGE_KEY = 'grognard.sourceEditor.folds';
const MAX_DOCUMENTS = 100;

const readAll = (): Record<string, SavedFold[]> => {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}');
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, SavedFold[]>) : {};
  } catch {
    return {};
  }
};

/** `undefined` means nothing was ever saved; `[]` means everything was expanded. */
export const loadFoldState = (key: string): SavedFold[] | undefined => {
  const saved = readAll()[key];
  if (!Array.isArray(saved)) return undefined;
  return saved.filter((fold) => typeof fold?.line === 'number' && typeof fold?.name === 'string');
};

export const saveFoldState = (key: string, folds: SavedFold[]) => {
  try {
    const all = readAll();
    delete all[key]; // re-insert last so the oldest entries are the ones dropped
    all[key] = folds;
    const keys = Object.keys(all);
    for (const old of keys.slice(0, Math.max(0, keys.length - MAX_DOCUMENTS))) delete all[old];
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // storage unavailable or full: folds simply will not persist
  }
};
