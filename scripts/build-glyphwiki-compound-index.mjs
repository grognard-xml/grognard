// Builds the Phase 2 "find before compose" index (see plugins/glyph_maker.md,
// utilities/glyphwikiIndex.ts): a "does a compound of these two already-known
// components exist" reverse index, restricted to compounds whose two direct
// components are both already in kageCore.json (the composer's own component
// vocabulary) - so every candidate this index could ever surface is
// guaranteed renderable with data already bundled, no additional geometry
// needed beyond the compound entry's own tiny "99:...$99:..." record.
//
// Standalone investigation/build tool, same status as
// extract-glyphwiki-kage-core.mjs - not run automatically, no app dependency
// on being re-run; `packages/cwrc-leafwriter/src/resources/glyphwiki/
// glyphwikiCompoundIndex.json` is committed as a built artifact, regenerate
// it by re-running this script against a fresh dump if GlyphWiki's data (or
// kageCore.json) changes materially.
//
// Usage: node build-glyphwiki-compound-index.mjs <dump_newest_only.txt> <kageCore.json> <output.json>
//
// Input dump format: see extract-glyphwiki-kage-core.mjs's header comment
// (fixed-width, space-padded `name | related-char | kage-data` fields).
import fs from 'node:fs';
import readline from 'node:readline';

const dumpPath = process.argv[2];
const kageCorePath = process.argv[3];
const outputPath = process.argv[4] ?? 'glyphwikiCompoundIndex.json';
if (!dumpPath || !kageCorePath) {
  console.error(
    'Usage: node build-glyphwiki-compound-index.mjs <dump_newest_only.txt> <kageCore.json> [output.json]',
  );
  process.exit(1);
}

const kageCore = JSON.parse(fs.readFileSync(kageCorePath, 'utf-8'));
const knownComponents = new Set(Object.keys(kageCore));
console.log(`Known (bundled) component names: ${knownComponents.size}`);

const stripAt = (ref) => {
  const at = ref.indexOf('@');
  return at === -1 ? ref : ref.slice(0, at);
};

let totalLines = 0;
let twoComponentEntries = 0;
const index = []; // { name, componentA, componentB, kageData }
const componentUsageCount = new Map();

const rl = readline.createInterface({
  input: fs.createReadStream(dumpPath, { encoding: 'utf-8' }),
  crlfDelay: Infinity,
});

for await (const line of rl) {
  if (!line) continue;
  totalLines++;
  const firstBar = line.indexOf('|');
  const secondBar = line.indexOf('|', firstBar + 1);
  if (firstBar === -1 || secondBar === -1) continue;
  const name = line.slice(0, firstBar).trim();
  const kageData = line.slice(secondBar + 1).trim();
  if (!name || !kageData) continue;

  const records = kageData.split('$');
  // Restrict to exactly two records, both "99:" component references - the
  // same two-part shape the composer itself produces (see kageCompose.ts).
  if (records.length !== 2) continue;
  const fields = records.map((r) => r.split(':'));
  if (fields[0][0] !== '99' || fields[1][0] !== '99') continue;
  if (fields[0].length < 8 || fields[1].length < 8) continue;

  twoComponentEntries++;
  const componentA = stripAt(fields[0][7]);
  const componentB = stripAt(fields[1][7]);
  if (!knownComponents.has(componentA) || !knownComponents.has(componentB)) continue;

  index.push({ name, componentA, componentB, kageData });
  componentUsageCount.set(componentA, (componentUsageCount.get(componentA) ?? 0) + 1);
  componentUsageCount.set(componentB, (componentUsageCount.get(componentB) ?? 0) + 1);
}

console.log(`Total dump lines: ${totalLines}`);
console.log(`Entries with exactly two "99:" component records: ${twoComponentEntries}`);
console.log(`...of those, both components already in kageCore.json: ${index.length}`);

// Compact tuple form [name, kageData, componentA, componentB] instead of
// named objects - at 280k+ entries, repeating four JSON key names per entry
// is real overhead for no benefit (this is machine-read only; see
// utilities/glyphwikiIndex.ts's RawEntry type for the reader side).
const compact = index.map((e) => [e.name, e.kageData, e.componentA, e.componentB]);
const outText = JSON.stringify(compact);
fs.writeFileSync(outputPath, outText);
const zlib = await import('node:zlib');
const gz = zlib.gzipSync(Buffer.from(outText, 'utf-8'));
fs.writeFileSync(`${outputPath}.gz`, gz);

console.log('--- Report ---');
console.log(`Index entries: ${index.length}`);
console.log(`Uncompressed size: ${(outText.length / 1024 / 1024).toFixed(2)} MB`);
console.log(`Compressed size: ${(gz.length / 1024 / 1024).toFixed(2)} MB`);

const mostUsed = [...componentUsageCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
console.log('Most-reused components (component, count of compounds using it):', mostUsed);

const pairCounts = new Map();
for (const entry of index) {
  const key = [entry.componentA, entry.componentB].sort().join('+');
  pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
}
const multi = [...pairCounts.values()].filter((c) => c > 1).length;
console.log(`Distinct component pairs indexed: ${pairCounts.size}, with >1 candidate: ${multi}`);
