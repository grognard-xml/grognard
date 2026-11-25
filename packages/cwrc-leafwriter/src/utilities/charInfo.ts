/**
 * Rich Unihan-backed character metadata for the Compose dialog Examine panel
 * (plugins/marinaMoji-composer-parity.md). Data is marinaMoji's char_info
 * table, shipped as JSON and loaded lazily so the rest of the editor does
 * not pay for ~5 MB until Compose opens.
 */

export interface CharInfo {
  cp?: string;
  strokes?: string;
  pinyin?: string;
  ja_on?: string;
  ja_kun?: string;
  rs?: string;
  definition?: string;
  variants?: string;
  ja_kana?: string;
  old_form?: string;
  new_form?: string;
  region_forms?: string;
  ivs_forms?: string;
}

type CharInfoIndex = Record<string, CharInfo>;

let indexPromise: Promise<CharInfoIndex> | null = null;
let index: CharInfoIndex | null = null;

const loadIndex = (): Promise<CharInfoIndex> => {
  if (index) return Promise.resolve(index);
  if (!indexPromise) {
    indexPromise = import('../resources/charInfo/charInfoIndex.json').then((mod) => {
      // Webpack JSON modules expose `.default`; Jest's mock is the object itself.
      const loaded = (mod as { default?: CharInfoIndex }).default ?? (mod as CharInfoIndex);
      index = loaded;
      return index;
    });
  }
  return indexPromise;
};

/** Ensure the index is warm (call when Compose opens). */
export const preloadCharInfo = (): Promise<void> => loadIndex().then(() => undefined);

export const getCharInfo = async (char: string): Promise<CharInfo | null> => {
  if (!char) return null;
  const table = await loadIndex();
  return table[char] ?? null;
};

/** Synchronous lookup after preload (or null if not yet loaded / unknown). */
export const getCharInfoSync = (char: string): CharInfo | null => {
  if (!index || !char) return null;
  return index[char] ?? null;
};

export const variantList = (info: CharInfo | null | undefined): string[] => {
  if (!info?.variants) return [];
  return info.variants.split(/\s+/).filter(Boolean);
};
