import type Writer from '../js/Writer';
import { insertGlyph } from './glyphEditor';
import { findGlyphwikiCandidates, type GlyphwikiCandidate } from './glyphwikiIndex';
import { findEncodedCharacterForIds } from './idsUnicodeIndex';
import {
  composeIds,
  composeKageData,
  guessOperatorFromKageData,
  type IdsOperator,
} from './kageCompose';
import { isKnownComponent, renderKageToSvg } from './kageRenderer';
import {
  addProjectGlyph,
  emptyProjectGlyphRegistry,
  getProjectGlyph,
  nextProjectGlyphId,
  parseProjectGlyphRegistry,
  projectGlyphKageComponentMap,
  serializeProjectGlyphRegistry,
  type ProjectGlyph,
  type ProjectGlyphRegistry,
} from './projectGlyphRegistry';

/**
 * Orchestration + file I/O for the project-level glyph registry (see
 * plugins/glyph_maker.md §4-5 and projectGlyphRegistry.ts's own doc comment
 * for why this is project-level, not per-document). Lives in
 * `<projectRoot>/project-glyphs.json`, alongside `grognard.project.json` -
 * the same tier of shared-but-not-entity-database project state as
 * `achievements.json`. Rendered SVGs are cached as separate files under
 * `<projectRoot>/_glyphs/`.
 */

const REGISTRY_FILENAME = 'project-glyphs.json';
const SVG_DIR = '_glyphs';

export const getProjectRootPath = (): string | null =>
  window.__leafWriterProject?.getProjectRootPath?.() ?? null;

const registryPath = (projectRoot: string): string => `${projectRoot}/${REGISTRY_FILENAME}`;
const svgPath = (projectRoot: string, glyphId: string): string =>
  `${projectRoot}/${SVG_DIR}/${glyphId}.svg`;
const svgRelativeUrl = (glyphId: string): string => `${SVG_DIR}/${glyphId}.svg`;

export const loadProjectGlyphRegistryFromDisk = async (
  projectRoot: string,
): Promise<ProjectGlyphRegistry> => {
  const api = window.electronAPI;
  if (!api?.pathExists || !api.readFile) return emptyProjectGlyphRegistry();
  const path = registryPath(projectRoot);
  const exists = await api.pathExists(path);
  if (!exists) return emptyProjectGlyphRegistry();
  try {
    const text = await api.readFile(path);
    return parseProjectGlyphRegistry(text);
  } catch {
    return emptyProjectGlyphRegistry();
  }
};

export const saveProjectGlyphRegistryToDisk = async (
  projectRoot: string,
  registry: ProjectGlyphRegistry,
): Promise<boolean> => {
  const api = window.electronAPI;
  if (!api?.writeFile) return false;
  await api.writeFile(registryPath(projectRoot), serializeProjectGlyphRegistry(registry));
  return true;
};

const BARE_UNICODE_CHAR_RE = /^.$/u; // exactly one Unicode code point (handles astral chars via the `u` flag)

/** Resolves a composer text-field's raw input to a KAGE lookup name: a
 * literal single character typed/pasted in (e.g. "言") becomes its bundled
 * "u<hex>" name; anything else is treated as an existing project glyph id
 * (e.g. "chhiv-0003") and left as-is. Does not itself check that the name
 * resolves to real geometry - `renderKageToSvg`'s `unresolvedComponents`
 * is the authority on that, matching the lesson from the extraction
 * decision gate (a name can "resolve" as a token without resolving to
 * geometry). */
export const resolveComponentInput = (
  input: string,
  registry: ProjectGlyphRegistry,
): { name: string; kind: 'unicode' | 'project-glyph' | 'unknown' } => {
  const trimmed = input.trim();
  if (BARE_UNICODE_CHAR_RE.test(trimmed)) {
    const codePoint = trimmed.codePointAt(0);
    if (codePoint !== undefined) {
      // GlyphWiki zero-pads to at least 4 hex digits (e.g. "u0035", not
      // "u35") - irrelevant for ordinary CJK ideographs, whose codepoints
      // are always >= 0x1000 and so already produce 4+ digits naturally, but
      // a real mismatch for anything below that (digits, Latin letters,
      // basic punctuation used as GlyphWiki components - confirmed against
      // the bundled data: "u0035" exists, "u35" does not).
      return { name: `u${codePoint.toString(16).padStart(4, '0')}`, kind: 'unicode' };
    }
  }
  if (getProjectGlyph(registry, trimmed)) return { name: trimmed, kind: 'project-glyph' };
  return { name: trimmed, kind: 'unknown' };
};

export interface ComposePreview {
  svg: string;
  kageData: string;
  ids: string;
  unresolvedComponents: string[];
  /** Set when this exact IDS composition already has a standard Unicode
   * decomposition on record - Phase A of composer-visual-redesign.md, the
   * check zi.tools performs first, before anything else. Stronger and
   * checked ahead of `glyphwikiCandidates`: this means the structure itself
   * is already an ordinary encoded character, not merely that some
   * non-standard glyph happens to combine the same two parts. */
  existingUnicodeChar: string | null;
  /** GlyphWiki entries already combining these two components directly, per
   * glyph_maker.md Phase 2 ("find before compose") - independent of which
   * operator is selected, since GlyphWiki's real geometry for the pair may
   * not match the composer's own default layout for that operator. Each
   * candidate can be adopted instead of saving the fresh composition. */
  glyphwikiCandidates: GlyphwikiCandidate[];
}

/** Renders a live preview without saving anything - used by the composer
 * dialog on every operator/component change. */
export const previewComposition = (
  operator: IdsOperator,
  firstInput: string,
  secondInput: string,
  registry: ProjectGlyphRegistry,
): ComposePreview => {
  const first = resolveComponentInput(firstInput, registry);
  const second = resolveComponentInput(secondInput, registry);
  const kageData = composeKageData(operator, first.name, second.name);
  const ids = composeIds(operator, first.name, second.name);
  const extraComponents = projectGlyphKageComponentMap(registry);
  const { svg, unresolvedComponents } = renderKageToSvg(kageData, extraComponents);
  return {
    svg,
    kageData,
    ids,
    unresolvedComponents,
    existingUnicodeChar: findEncodedCharacterForIds(ids),
    glyphwikiCandidates: findGlyphwikiCandidates(first.name, second.name),
  };
};

export type ComposeResult = { ok: true; glyph: ProjectGlyph } | { ok: false; error: string };

/**
 * Shared tail for both "compose a new glyph" and "adopt a GlyphWiki
 * candidate": write the cached SVG file, persist the registry, and insert
 * `<g ref="#id">` at the cursor (which also writes this document's own
 * `<charDecl>` cache entry - see glyphEditor.ts's insertGlyph). Neither
 * caller should reach here with an unresolved component - each checks that
 * itself first, since the right error message differs (see the extraction
 * decision gate's lesson: a clean render is not proof of resolution).
 */
const persistAndInsertProjectGlyph = async (
  writer: Writer,
  projectRoot: string,
  registry: ProjectGlyphRegistry,
  glyphWithoutSvgUrl: Omit<ProjectGlyph, 'svgRelativeUrl'>,
  svg: string,
): Promise<ComposeResult> => {
  const api = window.electronAPI;
  if (!api?.ensureDirectory || !api.writeFile) {
    return { ok: false, error: 'File access is unavailable.' };
  }

  await api.ensureDirectory(`${projectRoot}/${SVG_DIR}`);
  await api.writeFile(svgPath(projectRoot, glyphWithoutSvgUrl.id), svg);

  const glyph: ProjectGlyph = {
    ...glyphWithoutSvgUrl,
    svgRelativeUrl: svgRelativeUrl(glyphWithoutSvgUrl.id),
  };

  const updatedRegistry = addProjectGlyph(registry, glyph);
  const saved = await saveProjectGlyphRegistryToDisk(projectRoot, updatedRegistry);
  if (!saved) return { ok: false, error: 'Could not save the project glyph registry.' };

  const inserted = await insertGlyph(writer, {
    glyphId: glyph.id,
    // No separate source image for a composed/adopted glyph - the rendered
    // SVG is both the "source" and "normalized" graphic (see
    // glyphCharDecl.ts's GlyphGraphicSpec; findGlyphCharDeclEntry requires
    // both to be present).
    sourceUrl: glyph.svgRelativeUrl,
    svgUrl: glyph.svgRelativeUrl,
    svgWidth: 200,
    svgHeight: 200,
    mappings: [
      { type: 'ids', value: glyph.ids ?? '' },
      { type: 'kage', value: glyph.kage ?? '' },
      ...(glyph.glyphwikiId ? [{ type: 'glyphwiki', value: glyph.glyphwikiId }] : []),
    ],
  });
  if (!inserted) return { ok: false, error: 'Could not insert the glyph into the document.' };

  return { ok: true, glyph };
};

/**
 * Full save path for a fresh composition: validate both components actually
 * resolve to geometry, render, allocate an id, then hand off to
 * `persistAndInsertProjectGlyph`. Refuses to save a composition with any
 * unresolved component: a silently-incomplete glyph is worse than an
 * explicit error, per the lesson from the extraction decision gate.
 */
export const composeAndInsertProjectGlyph = async (
  writer: Writer,
  operator: IdsOperator,
  firstInput: string,
  secondInput: string,
): Promise<ComposeResult> => {
  const projectRoot = getProjectRootPath();
  if (!projectRoot) return { ok: false, error: 'No project is open.' };

  const registry = await loadProjectGlyphRegistryFromDisk(projectRoot);
  const first = resolveComponentInput(firstInput, registry);
  const second = resolveComponentInput(secondInput, registry);

  const extraComponents = projectGlyphKageComponentMap(registry);
  if (!isKnownComponent(first.name, extraComponents)) {
    return { ok: false, error: `"${firstInput}" isn't a known component.` };
  }
  if (!isKnownComponent(second.name, extraComponents)) {
    return { ok: false, error: `"${secondInput}" isn't a known component.` };
  }

  const kageData = composeKageData(operator, first.name, second.name);
  const { svg, unresolvedComponents } = renderKageToSvg(kageData, extraComponents);
  if (unresolvedComponents.length > 0) {
    return {
      ok: false,
      error: `Composition references components with no geometry: ${unresolvedComponents.join(', ')}.`,
    };
  }

  return persistAndInsertProjectGlyph(
    writer,
    projectRoot,
    registry,
    {
      id: nextProjectGlyphId(registry),
      ids: composeIds(operator, first.name, second.name),
      kage: kageData,
      sourceType: 'composed',
      componentIds: [first.name, second.name],
      createdAt: new Date().toISOString(),
    },
    svg,
  );
};

/**
 * Adopts a GlyphWiki candidate (from `findGlyphwikiCandidates`/
 * `previewComposition`'s `glyphwikiCandidates`) as a project glyph instead
 * of composing a fresh one - "find before compose" (glyph_maker.md §7). The
 * candidate's own components are already guaranteed known (that's how the
 * index was built - see build-glyphwiki-compound-index.mjs), so this never
 * hits the "unresolved component" path a fresh composition can.
 */
export const adoptGlyphwikiCandidateAndInsert = async (
  writer: Writer,
  candidate: GlyphwikiCandidate,
): Promise<ComposeResult> => {
  const projectRoot = getProjectRootPath();
  if (!projectRoot) return { ok: false, error: 'No project is open.' };

  const registry = await loadProjectGlyphRegistryFromDisk(projectRoot);
  const extraComponents = projectGlyphKageComponentMap(registry);
  const { svg, unresolvedComponents } = renderKageToSvg(candidate.kageData, extraComponents);
  if (unresolvedComponents.length > 0) {
    return {
      ok: false,
      error: `This GlyphWiki entry references components with no geometry: ${unresolvedComponents.join(', ')}.`,
    };
  }

  const operator = guessOperatorFromKageData(candidate.kageData);

  return persistAndInsertProjectGlyph(
    writer,
    projectRoot,
    registry,
    {
      id: nextProjectGlyphId(registry),
      ids: composeIds(operator, candidate.componentA, candidate.componentB),
      kage: candidate.kageData,
      sourceType: 'glyphwiki',
      glyphwikiId: candidate.name,
      componentIds: [candidate.componentA, candidate.componentB],
      createdAt: new Date().toISOString(),
    },
    svg,
  );
};
