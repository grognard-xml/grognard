import { joinPath } from './assetPaths';

/**
 * Project-level `KRnnnn -> character` table for Kanripo gaiji the bundled KR-Gaiji charlist
 * leaves blank (about two thirds of it). Lives at the project root so it is shared by every
 * import and every file in the project; the importer applies it ahead of the charlist.
 */
export const GAIJI_OVERRIDES_FILE = 'gaiji-overrides.json';

export type GaijiOverrides = Record<string, string>;

const KR_ID = /^KR\d{4}$/;

/** One code point, or an IDS description in square brackets - never markup. */
export const isValidGaijiCharacter = (value: string): boolean => {
  const trimmed = value.trim();
  if (/[<>&]/.test(trimmed)) return false;
  if ([...trimmed].length === 1) return true;
  return trimmed.startsWith('[') && trimmed.endsWith(']') && trimmed.length > 2;
};

export const parseGaijiOverrides = (text: string): GaijiOverrides => {
  try {
    const raw = JSON.parse(text) as unknown;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const overrides: GaijiOverrides = {};
    for (const [id, value] of Object.entries(raw)) {
      if (KR_ID.test(id) && typeof value === 'string' && isValidGaijiCharacter(value)) {
        overrides[id] = value.trim();
      }
    }
    return overrides;
  } catch {
    return {};
  }
};

export const serializeGaijiOverrides = (overrides: GaijiOverrides): string => {
  const sorted = Object.fromEntries(
    Object.entries(overrides).sort(([a], [b]) => a.localeCompare(b)),
  );
  return `${JSON.stringify(sorted, null, 2)}\n`;
};

export const gaijiOverridesPath = (rootPath: string): string =>
  joinPath(rootPath, GAIJI_OVERRIDES_FILE);

export const loadGaijiOverrides = async (
  rootPath: string | undefined | null,
): Promise<GaijiOverrides> => {
  const api = window.electronAPI;
  if (!rootPath || !api?.readFile) return {};
  try {
    return parseGaijiOverrides(await api.readFile(gaijiOverridesPath(rootPath)));
  } catch {
    // No table yet.
    return {};
  }
};

export const saveGaijiOverride = async (
  rootPath: string | undefined | null,
  id: string,
  character: string,
): Promise<boolean> => {
  const api = window.electronAPI;
  if (!rootPath || !api?.writeFile || !KR_ID.test(id) || !isValidGaijiCharacter(character)) {
    return false;
  }
  const overrides = await loadGaijiOverrides(rootPath);
  overrides[id] = character.trim();
  try {
    await api.writeFile(gaijiOverridesPath(rootPath), serializeGaijiOverrides(overrides));
    return true;
  } catch {
    return false;
  }
};

/**
 * Replaces every Kanripo gaiji `<g type="kanripo" n="id">` under `root` with `character` as
 * plain text. Returns how many were replaced.
 */
export const replaceKanripoGaijiWithCharacter = (
  root: ParentNode,
  id: string,
  character: string,
): number => {
  const matches = Array.from(root.querySelectorAll('[_tag="g"]')).filter(
    (el) => el.getAttribute('type') === 'kanripo' && el.getAttribute('n') === id,
  );
  for (const el of matches) {
    el.replaceWith(el.ownerDocument.createTextNode(character.trim()));
  }
  return matches.length;
};

/** Same, for vectorised glyphs: every `<g type="glyph" n="glyphId">` under `root` becomes text. */
export const replaceGlyphWithCharacter = (
  root: ParentNode,
  glyphId: string,
  character: string,
): number => {
  const matches = Array.from(root.querySelectorAll('[_tag="g"]')).filter(
    (el) => el.getAttribute('type') === 'glyph' && el.getAttribute('n') === glyphId,
  );
  for (const el of matches) {
    el.replaceWith(el.ownerDocument.createTextNode(character.trim()));
  }
  return matches.length;
};
