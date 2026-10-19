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
// Usage: node build-ids-unicode-index.mjs <ids.txt> [more-ids-files.txt ...] [output.json]
//
// cjkvi-ids stopped updating in 2019 and has nothing above U+2FA1D (no Ext G,
// H or I). CHISE's own repository (https://github.com/chise/ids) carries them
// as IDS-UCS-Ext-G.txt, -H.txt and -I.txt in the same tab-separated layout;
// pass those after ids.txt. Two differences from cjkvi's files are handled:
//   - a column starting with "@" (e.g. "@apparent=...") is an annotation, not
//     an alternative IDS;
//   - an IDS containing an "&CDP-xxxx;"-style reference to a component that has
//     no Unicode character is skipped. cjkvi writes those as circled numbers
//     (the stroke count), which cannot be reconstructed here, and a placeholder
//     would make unrelated characters collide on one key.
//
// Input format (confirmed by direct inspection): tab-separated
//   U+XXXX<TAB>字<TAB>IDS[<TAB>altIDS...]
// where an IDS field may carry a trailing "[GTKV]"-style regional-variant
// tag that isn't part of the IDS itself. Some characters list more than one
// alternate IDS (regional standard variants); every listed variant is a
// distinct, valid lookup key mapping to that same character.
import fs from 'node:fs';

const args = process.argv.slice(2);
const outputPath = args.at(-1)?.endsWith('.json') ? args.pop() : 'idsUnicodeIndex.json';
const idsPaths = args;
if (idsPaths.length === 0) {
  console.error(
    'Usage: node build-ids-unicode-index.mjs <ids.txt> [more-ids-files.txt ...] [output.json]',
  );
  process.exit(1);
}

const stripRegionalTag = (ids) => ids.replace(/\[[A-Z,]+\]"?$/, '');

const lines = idsPaths.flatMap((idsPath) =>
  fs
    .readFileSync(idsPath, 'utf-8')
    .split('\n')
    .filter((line) => line && !line.startsWith('#') && !line.startsWith(';')),
);

const entries = [];
const seen = new Set();
let variantCount = 0;
let skippedUnencoded = 0;

for (const line of lines) {
  const cols = line.split('\t');
  if (cols.length < 3) continue;
  const char = cols[1];
  for (let i = 2; i < cols.length; i++) {
    if (cols[i].startsWith('@')) continue;
    const ids = stripRegionalTag(cols[i]);
    if (/&[^;]*;/.test(ids)) {
      skippedUnencoded++;
      continue;
    }
    if (i > 2) variantCount++;
    if (seen.has(ids)) continue; // first-listed form wins, matching ids.txt's own ordering (primary form first)
    seen.add(ids);
    entries.push([ids, char]);
  }
}

console.log(`Source lines: ${lines.length}`);
console.log(`Entries with 2+ alternate IDS forms: ${variantCount}`);
console.log(`Skipped (component with no Unicode character): ${skippedUnencoded}`);
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
