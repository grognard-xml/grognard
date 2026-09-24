// Dependency-closure extraction of a small "KAGE core" from the GlyphWiki
// dump: canonical bare-Unicode entries (u<hex>, no suffix) plus every
// component they transitively reference via `99:` records, so kage-engine
// can render each seed glyph standalone from the bundle alone.
//
// Standalone investigation tool for the CHHIV glyph-composer decision gate
// (see plugins/glyph_maker.md) - not yet wired into the app or package.json.
// `@kurgm/kage-engine` is not an app dependency yet; install it in a scratch
// directory to run this (`npm install @kurgm/kage-engine`).
//
// Usage: node extract-glyphwiki-kage-core.mjs <path-to-dump_newest_only.txt>
//
// Input dump format (confirmed by direct inspection of the 2026-09-23
// GlyphWiki dump): fixed-width, space-padded fields -
//   " u0000                          | u3013   | 99:0:0:0:0:200:200:u2b1a$..."
// i.e. `name | related-char | kage-data`, so both `name` and `kage-data` must
// be trimmed after splitting on `|`.

import fs from 'node:fs';
import readline from 'node:readline';
import { Kage, Polygons } from '@kurgm/kage-engine';

const dumpPath = process.argv[2];
if (!dumpPath) {
  console.error('Usage: node extract.mjs <dump_newest_only.txt>');
  process.exit(1);
}

// GlyphWiki dump line format (confirmed by direct inspection):
//   name|related-char|kage-data
// kage-data is a `$`-joined list of records; a record starting with
// "99:" is a component reference whose 8th colon-delimited field is the
// referenced glyph's name (may itself carry a "-xx" variant suffix).
const CANONICAL_NAME_RE = /^u([0-9a-f]{4,6})$/i;

function extractComponentRefs(kageData) {
  const refs = [];
  for (const record of kageData.split('$')) {
    const fields = record.split(':');
    if (fields[0] === '99' && fields.length >= 8) {
      const ref = fields[7];
      if (ref) {
        // A "99:" reference field can carry a trailing "@N" render-parameter
        // suffix on the same token (confirmed empirically: "u5927-04@2" -
        // the component actually registered in the dump is "u5927-04"; kage-
        // engine strips "@N" itself at lookup time, so our dependency-closure
        // lookup must strip it too, or we misreport a resolved component as
        // "unresolved" and silently ship a bundle missing that geometry).
        const atIndex = ref.indexOf('@');
        const baseName = atIndex === -1 ? ref : ref.slice(0, atIndex);
        if (baseName) refs.push(baseName);
      }
    }
  }
  return refs;
}

async function main() {
  console.log(`Reading ${dumpPath} ...`);
  const all = new Map(); // name -> kageData
  let totalLines = 0;

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
    // Fields in this dump are fixed-width, space-padded (confirmed by direct
    // inspection: " u0000                          | u3013   | 99:0:0:...").
    const name = line.slice(0, firstBar).trim();
    const kageData = line.slice(secondBar + 1).trim();
    if (!name) continue;
    all.set(name, kageData);
  }
  console.log(`Total lines: ${totalLines}, parsed entries: ${all.size}`);

  // Step 2: select canonical seed glyphs.
  const seeds = [];
  for (const name of all.keys()) {
    if (CANONICAL_NAME_RE.test(name)) seeds.push(name);
  }
  console.log(`Canonical bare u<hex> seed candidates: ${seeds.length}`);

  // Steps 3-5: recursive dependency closure over `99:` component refs.
  const bundle = new Map(); // name -> kageData, includes seeds + deps
  const missing = new Set(); // referenced names not found anywhere in the dump
  const queue = [...seeds];
  const seen = new Set(seeds);

  while (queue.length > 0) {
    const name = queue.pop();
    const kageData = all.get(name);
    if (kageData === undefined) {
      missing.add(name);
      continue;
    }
    bundle.set(name, kageData);
    for (const ref of extractComponentRefs(kageData)) {
      if (!seen.has(ref)) {
        seen.add(ref);
        queue.push(ref);
      }
    }
  }

  const dependencyOnlyCount = bundle.size - seeds.filter((s) => bundle.has(s)).length;

  console.log(
    `Seed glyphs resolved: ${seeds.filter((s) => bundle.has(s)).length} / ${seeds.length}`,
  );
  console.log(`Additional dependency glyphs pulled in: ${dependencyOnlyCount}`);
  console.log(`Total records in bundle: ${bundle.size}`);
  console.log(`Unresolved component references: ${missing.size}`);
  if (missing.size > 0) {
    console.log('Sample unresolved refs:', [...missing].slice(0, 20));
  }

  // Step 6: validate by rendering every seed glyph.
  console.log('Loading bundle into kage-engine and rendering every seed...');
  const kage = new Kage();
  for (const [name, kageData] of bundle) {
    kage.kBuhin.push(name, kageData);
  }

  let renderFailures = 0;
  const failureSamples = [];
  let rendered = 0;
  for (const name of seeds) {
    if (!bundle.has(name)) continue; // already counted as unresolved
    try {
      const polygons = new Polygons();
      kage.makeGlyph(polygons, name);
      const svg = polygons.generateSVG();
      if (!svg || !svg.includes('<svg')) throw new Error('no SVG produced');
      rendered++;
    } catch (err) {
      renderFailures++;
      if (failureSamples.length < 20) failureSamples.push({ name, error: String(err) });
    }
  }
  console.log(`Rendered successfully: ${rendered}`);
  console.log(`Render failures: ${renderFailures}`);
  if (failureSamples.length > 0) {
    console.log('Sample render failures:', JSON.stringify(failureSamples, null, 2));
  }

  // Write the bundle out (uncompressed + gzip) and report sizes.
  const outLines = [...bundle.entries()].map(([name, data]) => `${name}|${data}`);
  const outText = outLines.join('\n') + '\n';
  fs.writeFileSync('kage-core.txt', outText, 'utf-8');
  const zlib = await import('node:zlib');
  const gz = zlib.gzipSync(Buffer.from(outText, 'utf-8'));
  fs.writeFileSync('kage-core.txt.gz', gz);

  console.log('--- Report ---');
  console.log(
    `Seed glyphs (canonical u<hex> found in dump): ${seeds.filter((s) => bundle.has(s)).length}`,
  );
  console.log(`Additional dependency glyphs: ${dependencyOnlyCount}`);
  console.log(`Total records: ${bundle.size}`);
  console.log(
    `Uncompressed size: ${outText.length} bytes (${(outText.length / 1024 / 1024).toFixed(2)} MB)`,
  );
  console.log(`Compressed size: ${gz.length} bytes (${(gz.length / 1024 / 1024).toFixed(2)} MB)`);
  console.log(`Unresolved references: ${missing.size}`);
  console.log(`Render failures: ${renderFailures} / ${seeds.filter((s) => bundle.has(s)).length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
