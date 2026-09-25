import type Writer from '../js/Writer';
import { type ComposerSlot } from './composerTree';
import { insertGlyph } from './glyphEditor';
import { findGlyphwikiCandidates, type GlyphwikiCandidate } from './glyphwikiIndex';
import { findEncodedCharacterForIds } from './idsUnicodeIndex';
import {
  composeIds,
  composeKageData,
  displayNameFor,
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

interface SlotPreviewResolution {
  /** A real name (leaf) or a synthetic temporary one (nested), usable in a
   * "99:" record - never written anywhere, only used within one preview
   * computation. */
  name: string;
  /** This node's own IDS string, e.g. "⿱攴女" for a nested slot - embedded
   * directly into the parent's IDS string (real IDS notation nests IDCs
   * inline; no name reference is needed at the notation level, only at the
   * KAGE-data level). */
  ids: string;
  /** Every nested descendant's own KAGE data needed to render this node,
   * keyed by its synthetic name - merged upward through the tree. */
  components: Record<string, string>;
}

let previewSyntheticCounter = 0;

const resolveSlotForPreview = (
  slot: ComposerSlot,
  registry: ProjectGlyphRegistry,
): SlotPreviewResolution => {
  if (slot.kind === 'leaf') {
    const resolved = resolveComponentInput(slot.input, registry);
    return { name: resolved.name, ids: displayNameFor(resolved.name), components: {} };
  }
  const parts = slot.parts.map((part) => resolveSlotForPreview(part, registry));
  const name = `__nested_${previewSyntheticCounter++}__`;
  const kageData = composeKageData(
    slot.operator,
    parts.map((p) => p.name),
  );
  return {
    name,
    ids: `${slot.operator}${parts.map((p) => p.ids).join('')}`,
    components: Object.assign({}, ...parts.map((p) => p.components), {
      [name]: kageData,
    }) as Record<string, string>,
  };
};

/**
 * Renders a live preview without saving anything - used by the composer
 * dialog on every operator/slot change. Phase D (composer-visual-redesign.md
 * §4): each of `parts` may itself be a `nested` composition, to arbitrary
 * depth - resolving one needs no changes to `kageCompose.ts` or
 * `kageRenderer.ts` at all, it just synthesizes a temporary name for each
 * nested node and feeds its KAGE data through the same `extraComponents`
 * mechanism already used for reusing a saved project glyph as a component.
 * `parts.length` must equal `partCountFor(operator)` (2, or 3 for ⿲/⿳) -
 * see `resizePartsForOperator`.
 */
export const previewComposerTree = (
  operator: IdsOperator,
  parts: ComposerSlot[],
  registry: ProjectGlyphRegistry,
): ComposePreview => {
  previewSyntheticCounter = 0;
  const resolvedParts = parts.map((part) => resolveSlotForPreview(part, registry));
  const kageData = composeKageData(
    operator,
    resolvedParts.map((p) => p.name),
  );
  const ids = `${operator}${resolvedParts.map((p) => p.ids).join('')}`;
  const extraComponents = Object.assign(
    {},
    projectGlyphKageComponentMap(registry),
    ...resolvedParts.map((p) => p.components),
  ) as Record<string, string>;
  const { svg, unresolvedComponents } = renderKageToSvg(kageData, extraComponents);
  return {
    svg,
    kageData,
    ids,
    unresolvedComponents,
    existingUnicodeChar: findEncodedCharacterForIds(ids),
    // A direct component-pair search only makes sense for a plain two-leaf
    // binary composition - the bundled GlyphWiki compound index is strictly
    // pairs (see build-glyphwiki-compound-index.mjs), so a three-part (⿲/⿳)
    // or nested composition has no matching shape to look up at all.
    glyphwikiCandidates:
      parts.length === 2 && parts.every((p) => p.kind === 'leaf')
        ? findGlyphwikiCandidates(resolvedParts[0].name, resolvedParts[1].name)
        : [],
  };
};

/** Flat two-string convenience wrapper over `previewComposerTree`, for
 * callers that don't need nesting - kept so existing call sites/tests don't
 * need to construct leaf slots by hand. */
export const previewComposition = (
  operator: IdsOperator,
  firstInput: string,
  secondInput: string,
  registry: ProjectGlyphRegistry,
): ComposePreview =>
  previewComposerTree(
    operator,
    [
      { kind: 'leaf', input: firstInput },
      { kind: 'leaf', input: secondInput },
    ],
    registry,
  );

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

type PersistSlotResult = { ok: true; name: string } | { ok: false; error: string };

/**
 * Recursively resolves a slot to a *real* name usable in a "99:" record - a
 * leaf's existing name, or (for a `nested` slot) a freshly allocated,
 * validated, and persisted project glyph id for that sub-composition.
 * `registry` is captured by reference and reassigned as nodes are added, so
 * later siblings and the id allocator see everything persisted so far -
 * matching how one id is never reused twice in the same save.
 *
 * Persists bottom-up: every intermediate node becomes its own real,
 * independently reusable `ProjectGlyph`, per glyph_maker.md's own principle
 * ("never throw away structure once the scholar supplies it") - not just
 * the root. Only the root gets `<g ref>`-inserted into the document; this
 * function only persists to the registry, the caller inserts once at the end.
 */
const persistSlot = async (
  slot: ComposerSlot,
  projectRoot: string,
  registry: { current: ProjectGlyphRegistry },
  writeSvg: (id: string, svg: string) => Promise<void>,
): Promise<PersistSlotResult> => {
  if (slot.kind === 'leaf') {
    const resolved = resolveComponentInput(slot.input, registry.current);
    return { ok: true, name: resolved.name };
  }

  const partNames: string[] = [];
  for (const part of slot.parts) {
    const result = await persistSlot(part, projectRoot, registry, writeSvg);
    if (!result.ok) return result;
    partNames.push(result.name);
  }

  const extraComponents = projectGlyphKageComponentMap(registry.current);
  for (const name of partNames) {
    if (!isKnownComponent(name, extraComponents)) {
      return { ok: false, error: `"${name}" isn't a known component.` };
    }
  }

  const kageData = composeKageData(slot.operator, partNames);
  const { svg, unresolvedComponents } = renderKageToSvg(kageData, extraComponents);
  if (unresolvedComponents.length > 0) {
    return {
      ok: false,
      error: `Composition references components with no geometry: ${unresolvedComponents.join(', ')}.`,
    };
  }

  const id = nextProjectGlyphId(registry.current);
  await writeSvg(id, svg);
  const glyph: ProjectGlyph = {
    id,
    ids: composeIds(slot.operator, partNames),
    kage: kageData,
    svgRelativeUrl: svgRelativeUrl(id),
    sourceType: 'composed',
    componentIds: partNames,
    createdAt: new Date().toISOString(),
  };
  registry.current = addProjectGlyph(registry.current, glyph);
  return { ok: true, name: id };
};

/**
 * Full save path for a composition that may itself be a tree (Phase D):
 * persists every nested sub-part bottom-up (see `persistSlot`), then
 * validates and hands the fully-resolved root off to
 * `persistAndInsertProjectGlyph` - which does one final registry save
 * covering the root *and* every intermediate node accumulated along the way.
 * Refuses to save if any leaf fails to resolve: a silently-incomplete glyph
 * is worse than an explicit error, per the lesson from the extraction
 * decision gate.
 */
export const composeTreeAndInsertProjectGlyph = async (
  writer: Writer,
  operator: IdsOperator,
  parts: ComposerSlot[],
): Promise<ComposeResult> => {
  const projectRoot = getProjectRootPath();
  if (!projectRoot) return { ok: false, error: 'No project is open.' };

  const api = window.electronAPI;
  if (!api?.ensureDirectory || !api.writeFile) {
    return { ok: false, error: 'File access is unavailable.' };
  }
  const writeSvg = async (id: string, svg: string) => {
    await api.ensureDirectory!(`${projectRoot}/${SVG_DIR}`);
    await api.writeFile!(svgPath(projectRoot, id), svg);
  };

  const registry = { current: await loadProjectGlyphRegistryFromDisk(projectRoot) };

  const partNames: string[] = [];
  for (const part of parts) {
    const result = await persistSlot(part, projectRoot, registry, writeSvg);
    if (!result.ok) return { ok: false, error: result.error };
    partNames.push(result.name);
  }

  const extraComponents = projectGlyphKageComponentMap(registry.current);
  for (const name of partNames) {
    if (!isKnownComponent(name, extraComponents)) {
      return { ok: false, error: `"${name}" isn't a known component.` };
    }
  }

  const kageData = composeKageData(operator, partNames);
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
    registry.current,
    {
      id: nextProjectGlyphId(registry.current),
      ids: composeIds(operator, partNames),
      kage: kageData,
      sourceType: 'composed',
      componentIds: partNames,
      createdAt: new Date().toISOString(),
    },
    svg,
  );
};

/** Flat two-string convenience wrapper over `composeTreeAndInsertProjectGlyph`,
 * for callers that don't need nesting. */
export const composeAndInsertProjectGlyph = (
  writer: Writer,
  operator: IdsOperator,
  firstInput: string,
  secondInput: string,
): Promise<ComposeResult> =>
  composeTreeAndInsertProjectGlyph(writer, operator, [
    { kind: 'leaf', input: firstInput },
    { kind: 'leaf', input: secondInput },
  ]);

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
      ids: composeIds(operator, [candidate.componentA, candidate.componentB]),
      kage: candidate.kageData,
      sourceType: 'glyphwiki',
      glyphwikiId: candidate.name,
      componentIds: [candidate.componentA, candidate.componentB],
      createdAt: new Date().toISOString(),
    },
    svg,
  );
};
