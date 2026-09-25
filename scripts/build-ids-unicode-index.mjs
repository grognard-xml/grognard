// Builds the Phase A "is this composition already an assigned Unicode
// character" index (see plugins/composer-visual-redesign.md §3): an
// exact-match IDS-string -> character lookup, from the CHISE IDS project's
// `ids.txt` (distributed via https://github.com/cjkvi/cjkvi-ids).
//
// Standalone build tool, same status as extract-glyphwiki-kage-core.mjs and
// build-glyphwiki-compound-index.mjs - not run automatically;
// `packages/cwrc-leafwriter/src/resources/ids/idsUnicodeIndex.json` is a
// committed build artifact. Regenerate by re-running this against a fresh
// clone of cjkvi-ids if that data changes materially.
//
// Usage: node build-ids-unicode-index.mjs <path-to-cjkvi-ids/ids.txt> [output.json]
//
// Input format (confirmed by direct inspection): tab-separated
//   U+XXXX<TAB>字<TAB>IDS[<TAB>altIDS...]
// where an IDS field may carry a trailing "[GTKV]"-style regional-variant
// tag that isn't part of the IDS itself. Some characters list more than one
// alternate IDS (regional standard variants); every listed variant is a
// distinct, valid lookup key mapping to that same character.
import fs from 'node:fs';

const idsPath = process.argv[2];
const outputPath = process.argv[3] ?? 'idsUnicodeIndex.json';
if (!idsPath) {
  console.error(
    'Usage: node build-ids-unicode-index.mjs <path-to-cjkvi-ids/ids.txt> [output.json]',
  );
  process.exit(1);
}

const stripRegionalTag = (ids) => ids.replace(/\[[A-Z,]+\]$/, '');

const lines = fs
  .readFileSync(idsPath, 'utf-8')
  .split('\n')
  .filter((line) => line && !line.startsWith('#'));

const entries = [];
const seen = new Set();
let variantCount = 0;

for (const line of lines) {
  const cols = line.split('\t');
  if (cols.length < 3) continue;
  const char = cols[1];
  for (let i = 2; i < cols.length; i++) {
    const ids = stripRegionalTag(cols[i]);
    if (i > 2) variantCount++;
    if (seen.has(ids)) continue; // first-listed form wins, matching ids.txt's own ordering (primary form first)
    seen.add(ids);
    entries.push([ids, char]);
  }
}

console.log(`Source lines: ${lines.length}`);
console.log(`Entries with 2+ alternate IDS forms: ${variantCount}`);
console.log(`Unique IDS keys: ${entries.length}`);

const outText = JSON.stringify(entries);
fs.writeFileSync(outputPath, outText);
const zlib = await import('node:zlib');
const gz = zlib.gzipSync(Buffer.from(outText, 'utf-8'));
fs.writeFileSync(`${outputPath}.gz`, gz);

console.log('--- Report ---');
console.log(`Entries: ${entries.length}`);
console.log(
  `Uncompressed size: ${(Buffer.byteLength(outText, 'utf-8') / 1024 / 1024).toFixed(2)} MB`,
);
console.log(`Compressed size: ${(gz.length / 1024 / 1024).toFixed(2)} MB`);
