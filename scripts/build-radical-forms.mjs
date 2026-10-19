// Builds the composer's radical-form table (packages/cwrc-leafwriter/src/resources/ids/radicalForms.json).
//
// A radical changes shape with its position: 言 on the left of 謀 is 訁, 金 on the left is 釒, 竹 on
// top is ⺮. GlyphWiki records which form it actually draws, so the rules are read from it, not
// written by hand: for each family in radical-families.json (the same radical's alternative forms,
// as real Unicode characters), look at every character whose IDS has a family member in a given
// position (operator + part index, e.g. "⿰0" = left of a left/right pair) and count which
// character GlyphWiki's own glyph for it references there.
//
// Two kinds of evidence are counted per character. If the IDS itself uses a positional variant
// (CHISE writes ⿰亻也 and ⿰礻申), that variant is the form. If the IDS uses the base (⿰言某) the
// form is whatever GlyphWiki's glyph actually references (訁). Simplified forms (讠 钅 饣 ...) are
// listed under "alt": they are never counted and never chosen automatically, only offered when
// cycling.
//
// A rule "base X in position P -> form F" is written only when F is a non-base member of the
// family's "forms", it accounts for at least 90% of at least 10 such characters (or 80% of at
// least 30), and it is not a CJK Compatibility Ideograph. A variant is never replaced by the base form. Everything else stays
// a manual choice (the composer's "Next form" button cycles through the whole family).
//
// RADICAL_DEBUG=<base character> prints the tallies for that family.
// Usage: node build-radical-forms.mjs <kageCore.json> <idsUnicodeIndex.json> [output.json]
import fs from 'node:fs';

const [kagePath, idsPath, outputPath = 'radicalForms.json'] = process.argv.slice(2);
if (!kagePath || !idsPath) {
  console.error(
    'Usage: node build-radical-forms.mjs <kageCore.json> <idsUnicodeIndex.json> [output.json]',
  );
  process.exit(1);
}

const kage = JSON.parse(fs.readFileSync(kagePath, 'utf-8'));
const idsIndex = JSON.parse(fs.readFileSync(idsPath, 'utf-8'));
const families = JSON.parse(
  fs.readFileSync(new URL('./radical-families.json', import.meta.url), 'utf-8'),
);

// A rule needs either strong evidence from a few characters or solid evidence from many.
const THRESHOLDS = [
  { minCount: 10, minShare: 0.9 },
  { minCount: 30, minShare: 0.8 },
];
const OPERATORS = {
  '⿰': 2,
  '⿱': 2,
  '⿲': 3,
  '⿳': 3,
  '⿴': 2,
  '⿵': 2,
  '⿶': 2,
  '⿷': 2,
  '⿸': 2,
  '⿹': 2,
  '⿺': 2,
  '⿻': 2,
};

const glyphName = (char) => `u${char.codePointAt(0).toString(16).padStart(4, '0')}`;
const isCompatibility = (char) => {
  const cp = char.codePointAt(0);
  return (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0x2f800 && cp <= 0x2fa1f);
};

// A form is a group of characters that are the same positional shape: the first is the one
// offered (a Unified Ideograph where there is one), the rest are the CJK Radicals Supplement
// characters CHISE sometimes writes in the IDS for the same shape.
// Drop family members GlyphWiki cannot draw.
const members = new Map();
const dropped = [];
for (const family of families) {
  const keep = (chars) =>
    chars.filter((char) => {
      if (glyphName(char) in kage) return true;
      dropped.push(char);
      return false;
    });
  family.bases = keep(family.bases);
  family.alt = keep(family.alt ?? []);
  family.canonical = new Map(); // any member of a form group -> the group's first character
  family.formGroups = family.forms.map(keep).filter((group) => group.length > 0);
  for (const group of family.formGroups)
    for (const char of group) family.canonical.set(char, group[0]);
  family.forms = family.formGroups.map((group) => group[0]);
  for (const char of [...family.bases, ...family.canonical.keys()]) {
    if (!members.has(char)) members.set(char, []);
    members.get(char).push(family);
  }
}

const parseIds = (ids) => {
  const chars = Array.from(ids);
  let index = 0;
  const parse = () => {
    const char = chars[index++];
    if (char === undefined) throw new Error('short');
    if (char in OPERATORS)
      return { op: char, parts: Array.from({ length: OPERATORS[char] }, parse) };
    return char;
  };
  try {
    const tree = parse();
    return index === chars.length && typeof tree !== 'string' ? tree : null;
  } catch {
    return null;
  }
};

// A character's glyph is often an alias of one real drawing: follow it.
const resolve = (name, depth = 0) => {
  const data = kage[name];
  if (data === undefined) return null;
  const records = data.split('$');
  if (records.length === 1 && records[0].startsWith('99:') && depth < 4) {
    const target = records[0].split(':')[7];
    if (target !== name && target in kage) return resolve(target, depth + 1) ?? data;
  }
  return data;
};

const referencedNames = (data) => {
  const names = [];
  for (const record of data.split('$')) {
    const fields = record.split(':');
    if (fields[0] !== '99') return null;
    names.push(fields[7]);
  }
  return names;
};

// family -> position -> Counter(outcome character | '?')
const tallies = new Map(families.map((family) => [family, new Map()]));
const seen = new Set();
for (const [ids, char] of idsIndex) {
  if (ids === char || seen.has(char)) continue;
  const tree = parseIds(ids);
  if (!tree || tree.parts.some((part) => typeof part !== 'string')) continue;
  const data = resolve(glyphName(char));
  const names = data && referencedNames(data);
  if (!names || names.length !== tree.parts.length) continue;
  seen.add(char);
  tree.parts.forEach((component, position) => {
    for (const family of members.get(component) ?? []) {
      const base = names[position].split('-')[0];
      const drawn = /^u[0-9a-f]{4,5}$/.test(base)
        ? String.fromCodePoint(parseInt(base.slice(1), 16))
        : '?';
      // A variant written in the IDS is the form; for a base, trust what GlyphWiki draws.
      const outcome = family.canonical.get(component) ?? family.canonical.get(drawn) ?? drawn;
      const key = `${tree.op}${position}`;
      if (family.only && !family.only.includes(key)) continue;
      const byPosition = tallies.get(family);
      if (!byPosition.has(key)) byPosition.set(key, new Map());
      const counter = byPosition.get(key);
      counter.set(outcome, (counter.get(outcome) ?? 0) + 1);
    }
  });
}

if (process.env.RADICAL_DEBUG) {
  for (const family of families) {
    for (const [position, counter] of tallies.get(family)) {
      if (family.bases.includes(process.env.RADICAL_DEBUG))
        console.log(family.bases.join('/'), position, JSON.stringify([...counter]));
    }
  }
}
const auto = {};
const report = [];
for (const family of families) {
  for (const [position, counter] of tallies.get(family)) {
    const total = [...counter.values()].reduce((a, b) => a + b, 0);
    const [form, count] = [...counter].sort((a, b) => b[1] - a[1])[0];
    if (!family.forms.includes(form) || isCompatibility(form)) continue;
    if (!THRESHOLDS.some((t) => total >= t.minCount && count / total >= t.minShare)) continue;
    for (const base of family.bases) {
      auto[base] ??= {};
      auto[base][position] = form;
    }
    report.push(`${family.bases.join('/')} ${position} -> ${form}  (${count}/${total})`);
  }
}

const output = {
  auto,
  families: families.map((family) => [...family.bases, ...family.formGroups.flat(), ...family.alt]),
};
fs.writeFileSync(outputPath, `${JSON.stringify(output)}\n`);

console.log(`Characters analysed: ${seen.size}`);
if (dropped.length)
  console.log(`Family members with no GlyphWiki glyph, dropped: ${dropped.join(' ')}`);
console.log(`Rules: ${report.length}`);
for (const line of report.sort()) console.log(`  ${line}`);
