/**
 * Pure construction of a composed glyph's own KAGE data string from two
 * existing component names and an Ideographic Description Character layout
 * - the "basic component-based KAGE composition" step of the CHHIV glyph
 * composer (see plugins/glyph_maker.md). Deliberately does not do automatic
 * stroke-aware resizing/deformation (that's KAGE/GlyphWiki's own advanced
 * editing territory, explicitly deferred): each operator just places the two
 * components into a fixed, reasonable bounding box within the standard
 * 0-200 KAGE coordinate space, the same space every entry in kageCore.json
 * already uses. No manual drag/resize UI in this first pass either - see the
 * "Geometry editing" section of glyph_maker.md for that later phase.
 *
 * A KAGE "99:" record (component reference) has the shape
 *   99:stretch-h:stretch-v:left:top:right:bottom:name:0:0:0
 * per the format confirmed by direct inspection of the GlyphWiki dump and
 * kage-engine's own README example. `stretch-h`/`stretch-v` of `0` (no
 * stretch) and a plain bounding box is enough for a first, un-deformed
 * placement - kage-engine fits the referenced component's own geometry into
 * that box.
 */

export type IdsOperator = '⿰' | '⿱' | '⿴' | '⿸' | '⿹' | '⿺' | '⿻';

export const IDS_OPERATORS: { operator: IdsOperator; label: string }[] = [
  { operator: '⿰', label: 'Left / right' },
  { operator: '⿱', label: 'Above / below' },
  { operator: '⿴', label: 'Full enclosure' },
  { operator: '⿸', label: 'Upper-left enclosure' },
  { operator: '⿹', label: 'Upper-right enclosure' },
  { operator: '⿺', label: 'Lower-left enclosure' },
  { operator: '⿻', label: 'Overlap' },
];

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const FULL: Box = { left: 0, top: 0, right: 200, bottom: 200 };

/** Default bounding boxes for the first (outer/left/above) and second
 * (inner/right/below) component, per operator. Not palaeographically tuned -
 * a reasonable starting point the scholar can compose from, matching the
 * "initial placement can be automatic" MVP scope. */
const boxesFor = (operator: IdsOperator): [Box, Box] => {
  switch (operator) {
    case '⿰':
      return [
        { left: 0, top: 0, right: 100, bottom: 200 },
        { left: 100, top: 0, right: 200, bottom: 200 },
      ];
    case '⿱':
      return [
        { left: 0, top: 0, right: 200, bottom: 100 },
        { left: 0, top: 100, right: 200, bottom: 200 },
      ];
    case '⿴':
      return [FULL, { left: 40, top: 40, right: 160, bottom: 160 }];
    case '⿸':
      return [FULL, { left: 60, top: 60, right: 200, bottom: 200 }];
    case '⿹':
      return [FULL, { left: 0, top: 60, right: 140, bottom: 200 }];
    case '⿺':
      return [FULL, { left: 60, top: 0, right: 200, bottom: 140 }];
    case '⿻':
      return [FULL, FULL];
    default:
      return [
        { left: 0, top: 0, right: 100, bottom: 200 },
        { left: 100, top: 0, right: 200, bottom: 200 },
      ];
  }
};

const componentRecord = (box: Box, name: string): string =>
  `99:0:0:${box.left}:${box.top}:${box.right}:${box.bottom}:${name}:0:0:0`;

/** Builds the new glyph's own KAGE data - a `$`-joined pair of "99:" records
 * referencing `firstName`/`secondName`, which must already be resolvable
 * (either in the bundled kageCore.json or in an already-composed project
 * glyph's own KAGE data) for kage-engine to render the result. */
export const composeKageData = (
  operator: IdsOperator,
  firstName: string,
  secondName: string,
): string => {
  const [firstBox, secondBox] = boxesFor(operator);
  return `${componentRecord(firstBox, firstName)}$${componentRecord(secondBox, secondName)}`;
};

const BARE_UNICODE_NAME_RE = /^u([0-9a-f]{4,6})$/i;

/** A KAGE lookup name's display form for the IDS string: the literal
 * character for a bare "u<hex>" name (e.g. "u8a00" -> "言"), or the name
 * itself for anything else (a project glyph id, a suffixed GlyphWiki
 * variant name, ...), since those have no single character to show. */
export const displayNameFor = (name: string): string => {
  const match = BARE_UNICODE_NAME_RE.exec(name);
  return match ? String.fromCodePoint(parseInt(match[1], 16)) : name;
};

/** The IDS string for the composition, e.g. "⿰言某" - stored as the
 * `<mapping type="ids">` value per the agreed `<charDecl><glyph>` schema. */
export const composeIds = (operator: IdsOperator, firstName: string, secondName: string): string =>
  `${operator}${displayNameFor(firstName)}${displayNameFor(secondName)}`;
