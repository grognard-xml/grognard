import radicalFormsData from '../resources/ids/radicalForms.json';
import type { IdsOperator } from './kageCompose';

/**
 * A radical changes shape with its position: 言 on the left of 謀 is 訁, 金 on
 * the left is 釒, 竹 on top is 𥫗. The table is generated from GlyphWiki's own
 * glyphs and the CHISE IDS data by scripts/build-radical-forms.mjs (see its
 * header for how a rule earns its place):
 * - `auto`: the character typed -> position ("⿰0" = left of a left/right
 *   pair, "⿱1" = bottom of a top/bottom pair) -> the form to draw there.
 * - `families`: every form of one radical, for cycling by hand. The first
 *   entries are the base characters, then the positional forms, then
 *   simplified or otherwise unusual ones that are never chosen automatically.
 */
interface RadicalFormsData {
  auto: Record<string, Record<string, string>>;
  families: string[][];
}

const DATA = radicalFormsData as RadicalFormsData;

export const positionKey = (operator: IdsOperator, partIndex: number): string =>
  `${operator}${partIndex}`;

/** The form to draw for `char` in this position, or null when its own shape is
 * the right one (or nothing is known about it). */
export const automaticFormFor = (
  char: string,
  operator: IdsOperator,
  partIndex: number,
): string | null => DATA.auto[char]?.[positionKey(operator, partIndex)] ?? null;

/** Every form of the radical `char` belongs to, `char` included, in cycling
 * order. 阝 belongs to two radicals (阜 and 邑), so it gets both. Empty when
 * `char` is not a known radical form. */
export const formsOf = (char: string): string[] => {
  const forms: string[] = [];
  for (const family of DATA.families) {
    if (!family.includes(char)) continue;
    for (const form of family) if (!forms.includes(form)) forms.push(form);
  }
  return forms;
};

/** The next form after `char` in its family, wrapping round, or null when
 * `char` has no other form. */
export const nextFormOf = (char: string): string | null => {
  const forms = formsOf(char);
  if (forms.length < 2) return null;
  return forms[(forms.indexOf(char) + 1) % forms.length] ?? null;
};
