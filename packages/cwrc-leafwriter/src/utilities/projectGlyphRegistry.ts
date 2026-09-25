/**
 * Pure data model + operations for the project-level glyph registry (see
 * plugins/glyph_maker.md §4-5): the source-of-truth record of every
 * non-standard character a project has composed or imported, shared across
 * every document in the project - unlike the per-document `<charDecl>` entry
 * `glyphCharDecl.ts` writes into a specific XML file, which is only ever a
 * portable cached copy of one glyph's data.
 *
 * No file I/O here - see projectGlyphStore.ts for reading/writing this
 * through `window.electronAPI`. Kept separate so the registry's own logic
 * (id allocation, lookup, component-map building) is plain, synchronous, and
 * unit-testable without an Electron renderer.
 */

export interface ProjectGlyph {
  id: string;
  /** Present if this glyph also corresponds to an ordinary Unicode codepoint (rare for CHHIV's use case, but future-proofs adoption). */
  unicode?: string;
  /** Ideographic Description Sequence, e.g. "⿰言某" - semantic/search metadata, not a rendering instruction. */
  ids?: string;
  /** This glyph's own KAGE data (its "99:" component records), present for source_type "composed". */
  kage?: string;
  /** Project-relative path to the cached rendered SVG, e.g. "_glyphs/chhiv-0017.svg". */
  svgRelativeUrl: string;
  sourceType: 'composed' | 'image' | 'glyphwiki';
  /** The two component names used to compose this glyph, for source_type "composed" or "glyphwiki". */
  componentIds?: [string, string];
  /** The GlyphWiki entry name this was adopted from (e.g. "abyterus_g0000"), for source_type "glyphwiki" - kept so the glyph never falsely presents as a purely local composition (see glyph_maker.md §19, provenance). */
  glyphwikiId?: string;
  notes?: string;
  createdAt: string;
}

export interface ProjectGlyphRegistry {
  version: 1;
  glyphs: ProjectGlyph[];
}

export const emptyProjectGlyphRegistry = (): ProjectGlyphRegistry => ({ version: 1, glyphs: [] });

/** Defensive parse - a hand-edited or partially-written file should degrade
 * to an empty registry rather than crash the composer. */
export const parseProjectGlyphRegistry = (json: string): ProjectGlyphRegistry => {
  try {
    const parsed = JSON.parse(json);
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.glyphs)) {
      return emptyProjectGlyphRegistry();
    }
    const glyphs = parsed.glyphs.filter(
      (g: unknown): g is ProjectGlyph =>
        Boolean(g) &&
        typeof g === 'object' &&
        typeof (g as ProjectGlyph).id === 'string' &&
        typeof (g as ProjectGlyph).svgRelativeUrl === 'string' &&
        ((g as ProjectGlyph).sourceType === 'composed' ||
          (g as ProjectGlyph).sourceType === 'image' ||
          (g as ProjectGlyph).sourceType === 'glyphwiki'),
    );
    return { version: 1, glyphs };
  } catch {
    return emptyProjectGlyphRegistry();
  }
};

export const serializeProjectGlyphRegistry = (registry: ProjectGlyphRegistry): string =>
  JSON.stringify(registry, null, 2);

const ID_PREFIX = 'chhiv-';

/** Next unused sequential id, e.g. "chhiv-0017" - stable, human-scannable,
 * matching the ids used throughout plugins/glyph_maker.md's own examples. */
export const nextProjectGlyphId = (registry: ProjectGlyphRegistry): string => {
  let max = 0;
  for (const glyph of registry.glyphs) {
    const match = /^chhiv-(\d+)$/.exec(glyph.id);
    if (match) max = Math.max(max, parseInt(match[1], 10));
  }
  return `${ID_PREFIX}${String(max + 1).padStart(4, '0')}`;
};

export const getProjectGlyph = (
  registry: ProjectGlyphRegistry,
  id: string,
): ProjectGlyph | undefined => registry.glyphs.find((g) => g.id === id);

export const listProjectGlyphs = (registry: ProjectGlyphRegistry): ProjectGlyph[] =>
  registry.glyphs;

export const addProjectGlyph = (
  registry: ProjectGlyphRegistry,
  glyph: ProjectGlyph,
): ProjectGlyphRegistry => ({
  ...registry,
  glyphs: [...registry.glyphs.filter((g) => g.id !== glyph.id), glyph],
});

/**
 * Every project glyph's own KAGE data that has one, keyed by id - fed to
 * `renderKageToSvg` as `extraComponents` so a new composition can use a
 * previously-composed or GlyphWiki-adopted project glyph as one of its two
 * components (recursive composition, per the "known Unicode character /
 * known components / composed" continuum in glyph_maker.md §31). An
 * image-derived glyph has no `kage` field and is naturally excluded.
 */
export const projectGlyphKageComponentMap = (
  registry: ProjectGlyphRegistry,
): Record<string, string> => {
  const map: Record<string, string> = {};
  for (const glyph of registry.glyphs) {
    if (glyph.kage) map[glyph.id] = glyph.kage;
  }
  return map;
};
