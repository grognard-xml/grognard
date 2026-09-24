import { Kage, Polygons } from '@kurgm/kage-engine';
import kageCore from '../resources/glyphwiki/kageCore.json';

/**
 * Thin adapter around `@kurgm/kage-engine`, isolated behind this module so
 * the rest of CHHIV's glyph composer doesn't depend on that library's
 * internals directly (per plugins/glyph_maker.md §16 - "do not let the rest
 * of CHHIV depend on the implementation details of one third-party
 * library").
 *
 * `kageCore.json` is the bundled, dependency-closed subset of GlyphWiki's
 * dump (see scripts/extract-glyphwiki-kage-core.mjs) - it supplies KAGE
 * stroke geometry for ordinary Unicode characters used as composer
 * components. A composed glyph may also reference another project-local
 * glyph's own KAGE data as a component (recursive composition), which is why
 * `extraComponents` exists below: the bundle alone doesn't know about
 * glyphs a scholar composed locally.
 */

const KAGE_CORE: Record<string, string> = kageCore as unknown as Record<string, string>;

export const isKnownComponent = (name: string, extraComponents?: Record<string, string>): boolean =>
  name in KAGE_CORE || Boolean(extraComponents && name in extraComponents);

const buildEngine = (extraComponents?: Record<string, string>): Kage => {
  const kage = new Kage();
  for (const [name, data] of Object.entries(KAGE_CORE)) {
    kage.kBuhin.push(name, data);
  }
  if (extraComponents) {
    for (const [name, data] of Object.entries(extraComponents)) {
      kage.kBuhin.push(name, data);
    }
  }
  return kage;
};

export interface RenderResult {
  svg: string;
  /** Component names referenced by `kageData` that resolved to nothing -
   * kage-engine renders the rest of the glyph anyway rather than throwing
   * (confirmed during the extraction decision gate), so a clean SVG string
   * alone is not proof every component was found; check this list too. */
  unresolvedComponents: string[];
}

const findUnresolved = (
  kageData: string,
  extraComponents: Record<string, string> | undefined,
): string[] => {
  const unresolved: string[] = [];
  for (const record of kageData.split('$')) {
    const fields = record.split(':');
    if (fields[0] !== '99' || fields.length < 8) continue;
    const ref = fields[7];
    if (!ref) continue;
    const atIndex = ref.indexOf('@');
    const baseName = atIndex === -1 ? ref : ref.slice(0, atIndex);
    if (baseName && !isKnownComponent(baseName, extraComponents)) unresolved.push(baseName);
  }
  return unresolved;
};

/**
 * Renders one glyph's own KAGE data (e.g. what `composeKageData` produced,
 * or an existing project glyph's stored `kage` field) to an SVG string.
 * `extraComponents` supplies any project-local component glyphs referenced
 * by name that aren't in the bundled core.
 */
export const renderKageToSvg = (
  kageData: string,
  extraComponents?: Record<string, string>,
): RenderResult => {
  const kage = buildEngine(extraComponents);
  const name = '__preview__';
  kage.kBuhin.push(name, kageData);
  const polygons = new Polygons();
  kage.makeGlyph(polygons, name);
  return {
    svg: polygons.generateSVG(),
    unresolvedComponents: findUnresolved(kageData, extraComponents),
  };
};
