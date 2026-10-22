import type { SearchScope } from '../shared/searchScope';
import type { DocScope } from './docScope';

/** Most searches remembered per panel. */
export const MAX_SEARCH_HISTORY = 50;

export interface FindHistoryEntry {
  query: string;
  /** What was typed in Replace when this find was run or replaced with. `''` is a real
   * replacement (delete the match); `undefined` means no replacement was ever used. */
  replace?: string;
  ignoreCase: boolean;
  useRegex: boolean;
  scope: SearchScope;
  docScope: DocScope;
  customPath: string;
}

export interface XPathHistoryEntry {
  query: string;
  scope: SearchScope;
  customPath: string;
}

const FIND_KEY = 'grognard:searchHistory:find';
const XPATH_KEY = 'grognard:searchHistory:xpath';

/** Two searches are the same one when the text and everything that changes what it matches agree. */
export const findEntryKey = (entry: FindHistoryEntry): string =>
  JSON.stringify([
    entry.query,
    entry.ignoreCase,
    entry.useRegex,
    entry.scope,
    entry.docScope,
    entry.scope === 'custom' ? entry.customPath : '',
  ]);

export const xpathEntryKey = (entry: XPathHistoryEntry): string =>
  JSON.stringify([entry.query, entry.scope, entry.scope === 'custom' ? entry.customPath : '']);

/** Puts `entry` at the top, dropping an earlier identical search and anything past `max`. A search
 * run without a replacement keeps the replacement it was last used with. */
export const addFindEntry = (
  list: readonly FindHistoryEntry[],
  entry: FindHistoryEntry,
  max = MAX_SEARCH_HISTORY,
): FindHistoryEntry[] => {
  const query = entry.query.trim();
  if (!query) return [...list];
  const key = findEntryKey({ ...entry, query });
  const previous = list.find((item) => findEntryKey(item) === key);
  const merged: FindHistoryEntry = {
    ...entry,
    query,
    replace: entry.replace ?? previous?.replace,
  };
  return [merged, ...list.filter((item) => findEntryKey(item) !== key)].slice(0, max);
};

export const addXPathEntry = (
  list: readonly XPathHistoryEntry[],
  entry: XPathHistoryEntry,
  max = MAX_SEARCH_HISTORY,
): XPathHistoryEntry[] => {
  const query = entry.query.trim();
  if (!query) return [...list];
  const key = xpathEntryKey({ ...entry, query });
  return [{ ...entry, query }, ...list.filter((item) => xpathEntryKey(item) !== key)].slice(0, max);
};

const isScope = (value: unknown): value is SearchScope =>
  value === 'currentFile' || value === 'openTabs' || value === 'project' || value === 'custom';
const isDocScope = (value: unknown): value is DocScope =>
  value === 'source' || value === 'translation' || value === 'both';

const readList = <T>(key: string, parse: (raw: Record<string, unknown>) => T | null): T[] => {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) =>
        item && typeof item === 'object' ? parse(item as Record<string, unknown>) : null,
      )
      .filter((item): item is T => item !== null)
      .slice(0, MAX_SEARCH_HISTORY);
  } catch {
    return [];
  }
};

const writeList = (key: string, list: readonly unknown[]) => {
  try {
    localStorage.setItem(key, JSON.stringify(list));
  } catch {
    // Storage can be unavailable (private mode, quota): history is a convenience.
  }
};

export const readFindHistory = (): FindHistoryEntry[] =>
  readList(FIND_KEY, (raw) => {
    if (typeof raw.query !== 'string' || !raw.query.trim()) return null;
    return {
      query: raw.query,
      replace: typeof raw.replace === 'string' ? raw.replace : undefined,
      ignoreCase: raw.ignoreCase === true,
      useRegex: raw.useRegex === true,
      scope: isScope(raw.scope) ? raw.scope : 'currentFile',
      docScope: isDocScope(raw.docScope) ? raw.docScope : 'both',
      customPath: typeof raw.customPath === 'string' ? raw.customPath : '',
    };
  });

export const writeFindHistory = (list: readonly FindHistoryEntry[]) => writeList(FIND_KEY, list);

export const readXPathHistory = (): XPathHistoryEntry[] =>
  readList(XPATH_KEY, (raw) => {
    if (typeof raw.query !== 'string' || !raw.query.trim()) return null;
    return {
      query: raw.query,
      scope: isScope(raw.scope) ? raw.scope : 'currentFile',
      customPath: typeof raw.customPath === 'string' ? raw.customPath : '',
    };
  });

export const writeXPathHistory = (list: readonly XPathHistoryEntry[]) => writeList(XPATH_KEY, list);
