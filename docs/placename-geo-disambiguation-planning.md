# Placename geo-disambiguation — Planning

**Status (2026-09-20):** **Mostly shipped** — geo clustering + map comparison live; Wikidata `place-zh-hant` compiled; Phase 4 (merged-period description fallback on link/mint) and Phase 5 (persisted place-cluster schema, full stack including UI) implemented. Still open: CHGIS recompile smoke on real shapefiles.

## Problem

Placename identity is worse-behaved than person identity. A person keeps a name (mostly) and a lifespan; a place keeps neither reliably:

- **Names move.** The same string (臨川) can denote a county seat, a river, or a temple depending on dynasty; conversely a single settlement carries different names across DILA, CBDB, and CHGIS because each project transliterates, periodizes, or splits administrative levels differently.
- **Referents move.** A prefecture's seat can relocate while keeping its name; a name can be reassigned to a new site after the old one is abandoned.
- **Authority string-matching is context-dependent.** Today's flow (`autoTagging/lookupResolve.ts`) links an external authority hit to a project entity by direct idno or by crosswalk (`crosswalkForRef` in [lookupResolve.ts](../packages/cwrc-leafwriter/src/autoTagging/lookupResolve.ts)). That works for persons, where an authority id is durable. For places, a name match found valid in one text (one period, one region) does not transfer to another occurrence of the same string elsewhere in the corpus — there is no per-context check today, so a wrong link silently propagates.

## Core idea

Add geography as a second, independent signal alongside the string match, and use it for **clustering candidates, not for authority linking per se**:

1. Every place authority already carries (or can be made to carry) coordinates — CBDB's `ADDR_CODES` has `x_coord`/`y_coord` and a `CHGIS_PT_ID`; DILA's place authority has `<location><place><geo>`; CHGIS is coordinates by definition (see the source notes in [authority-databases-planning.md](authority-databases-planning.md) §"Places — `ADDR_CODES`" and §"Place authority (TEI `<place>`...)").
2. When a name string turns up hits across multiple authorities/packs, compute pairwise great-circle distance between their coordinates.
3. A user-configurable **proximity radius** (km, in Settings) decides whether two hits are "close enough" to be considered the same physical place for linking purposes. Hits within the radius are grouped; hits outside it are treated as distinct candidates (this is exactly the "same name, different place" collision that string-only matching cannot resolve).
4. Grouped hits get **their time-period metadata merged for display**, not silently unioned into one fact: `DILA: 漢, 孫吳, 南齊, 唐; CBDB: 0–260, 501–504, 704–`. Each authority's own period string is kept verbatim and tagged by source; the merged line is a derived display, never a new stored fact, so contradictions/overlaps stay visible instead of being averaged away.

This turns "does this authority id apply here" into "is this authority's _point_ within N km of that authority's _point_," which is a much better-conditioned question than string identity for a domain where places are only fuzzily equivalent to begin with.

## What this is / is not

- **Is:** an additional signal for the existing disambiguation and crosswalk-conflict UI (`viaCrosswalk.length > 1` path in `planLookupResolution`) — when a name string resolves to multiple project entities or multiple pack rows, geo proximity turns "N candidates, pick one" into "N candidates in M geographic clusters, pick a cluster (or a specific point within it)."
- **Is not:** a general place-identity oracle. Missing coordinates, a name with no authority hit, or a genuinely displaced-then-renamed site still need a human call. This is scoring, not solving.

## Design

### 1. Coordinate normalization

Add a shared `GeoPoint { lat: number; lon: number }` to the pack compile step (`authorityCompile.ts` family) so every place row in every NDJSON pack carries `metadata.geo?: GeoPoint` when the source has it. Sources without coordinates (e.g. a Markus-style flat CSV) simply omit it — treated as "no geo signal," never as "0,0."

### 2. Distance + clustering

- Haversine distance, pure function, no new dependency.
- Given a set of candidate rows (from `crosswalkForRef` / the entity-lookup dialog's candidate list) that share a matched name string, greedily cluster by mutual distance ≤ threshold (single-link clustering is enough at this scale — tens of candidates, not thousands).
- Threshold default: something on the order of 5 km, exposed in Settings as `placeProximityKm` (see [project-schema-planning.md](project-schema-planning.md) / wherever project prefs already live in `apps/desktop/src/projectPrefs.ts`). A single global number is the v1 scope — see Open questions for per-admin-level scaling.

### 3. Disambiguation UI change

In the entity-lookup dialog (`packages/cwrc-leafwriter/src/dialogs/entity-lookups/`) and the auto-tagging suggestion path (`autoTagging/suggestionFilters.ts`), when a place-type candidate set has ≥2 geo-bearing hits:

- Hits inside one cluster render together with the merged period line.
- Hits in a different cluster (i.e. genuinely distant despite the name match) render as a visibly separate group — this is the "these are two different places" case surfacing automatically instead of silently picking the first hit.
- Rows with no coordinates fall back to today's plain string/crosswalk behavior and are labeled "no geo data" rather than folded into either cluster.

### 4. Merge-time period display

- Keep each source's period string (dynasty label for DILA, year range for CBDB, etc.) attached to its own idno, never rewritten.
- Derive a single display line by source, in a stable source order, joined with `;` — the format in the prompt (`DILA: 漢,孫吳,南齊,唐; CBDB: 0-260, 501-504, 704-`). This is purely presentational (entity panel, hover card, mint-time description field); the underlying `idnos` array and any per-authority metadata are untouched.
- When linking (not minting), this merged line can seed the entity's `description` note the way `candidateMeta.description` does today in `planLookupResolution` — but only if the entity has no description yet, matching the existing non-destructive enrichment behavior (`splitEnrichment`).

## Phasing

Dependencies: Admin vocabulary (Phase A) → Coordinate source data fixes (Phase 0) → Pack compilation (Phase 1) → Clustering/UI (Phases 2–4) → Persisted entities (Phase 5).

**Revised 2026-07-26:** Phase 6 (map view) no longer waits on Phase 5. It only needs geo-bearing merged candidates, which Phases 1–3 already provide — see "Decisions (2026-07-26)" below.

### Phase A — Admin-vocabulary mapping table

**Scope:** build a single controlled vocabulary for administrative levels across CHGIS, CBDB, and external authorities (Wikidata, others). This table drives two outputs:

1. **Normalized admin-level codes** (for display, single-admin constraint on clusters, cross-source unification)
2. **Suffix-character mapping** (for name-variant generation: Xian → 縣, Zhou → 州, Fu → 府, etc.)

**Inputs:**

- CHGIS `TYPE_CH` (Chinese single-character codes: 州, 縣, 郡, 道, etc.) — all ~20 distinct values across v6 layers.
- CBDB `c_admin_type` (romanized English: 239 raw values, real count ~200 after case-dedup) — includes Xian, Zhou, Prefecture, Pu, Jiedu, Du, Fu, Wei, Shi, County, Fengjun, Dao, Lu, etc.
- Wikidata/external authorities: equivalence links, alt names, hierarchy info if available.

**Outputs:** a TSV or structured file mapping `{chgis_type, cbdb_admin_type, wikidata_qid?, normalized_code, suffix_char}` with one row per known distinct level. Sample rows:

```
州      Zhou        Q[...]    prefecture  州
縣      Xian        Q[...]    county      縣
郡      Jun/Fengjun Q[...]    commandery  郡
```

**Acceptance:** all CBDB `c_admin_type` raw values can be mapped to exactly one normalized code and suffix character; mappings cross-checked against Wikidata where available.

**Note:** this is independent research + mapping work, not code changes; unblocks Phase 0.

**Status (2026-07-25): first-pass concordance built.** `/authoritypacks/admin_type_concordance.tsv` maps all distinct CBDB `c_admin_type` values against CHGIS `TYPE_CH`/`TYPE_PY`, with columns `cbdb_admin_type, chgis_type_ch, chgis_type_py, cbdb_count, chgis_count, confidence, suffix_char, notes`.

- 10 high-confidence 1:1 pairs (Xian↔縣, Zhou↔州, Fu↔府, Wei↔衛, Lu↔路, Ting↔廳, Zhangguansi↔長官司, Qianhusuo↔千戶所), case variants (Xian/xian etc.) listed as separate rows.
- Ambiguous cases resolved to a primary mapping: Jun→郡 (commandery, over the rarer 軍 military-district reading), Fengjun→郡, State→國, Shi→市, Du left low-confidence (CHGIS fragments it into rare compounds).
- ~23% of CBDB terms (Shi, Pu, Qi, Diqu, Shixiaqu, military/Qing-era compounds, modern autonomous-region terms) have no CHGIS equivalent — kept as rows with blank CHGIS columns and an inferred `suffix_char` so Phase 0c can still generate name variants for them.
- **Not yet done:** Wikidata QID cross-referencing (column reserved, not populated) and hierarchy validation. Sufficient as-is to unblock Phase 0 (CBDB coordinate/suffix work); Wikidata linkage can be layered in later without reshaping the table.

### Wikidata as a fourth authority — current state (2026-07-25, verified in code)

There's an existing, working Wikidata extraction pipeline at `/authoritypacks/wikidata/` (`sparqlClient.mjs`, `entityParse.mjs`, `compile.mjs`, `compileKind.mjs`), following the same dump-extract → compiled-NDJSON-pack pattern as CBDB/CHGIS. Two things confirmed by direct inspection, correcting an earlier assumption:

- **Chinese Wikidata person packs:** `person-zh-hant-{pre-ming,ming,qing}` (+ optional `tang`). Song/Yuan people are in **pre-ming**, not separate song/yuan packs. Also `org-zh-hant`, `work-zh-hant`, and **`place-zh-hant`** (~254k). Japanese Wikidata places: **`place-ja`** (~514k), wired in Grognard as opt-in `wikidata-places-ja` (NDL places remain default). Older notes that claimed “no place-zh-hant” are obsolete.
- **No crosswalk ids reach compiled place packs, even where a place pack exists.** `identifierProperties.json` and `identifierClaims.mjs` map Wikidata external-id properties (P497 → CBDB id, P4711 → CHGIS id, plus DILA/VIAF/BDRC) into `metadata.crosswalk` — but that machinery is wired only into the _person_ compile path (`compile.mjs`). The place/org/work compile path (`compileKind.mjs:19-45`, `kindCandidateFromRaw`) builds `metadata` from only `description`/`startYear`/`endYear` and never touches identifier claims. Confirmed empty in the one real sample: `place-bo/places.ndjson` records carry no `crosswalk` field at all.

**Decision (this session):** coordinates will not be extracted from Wikidata into the compiled pack — they'll be pulled live from the Wikidata API at disambiguation time instead, so Wikidata place-pack compilation does not need P625 handling. What's still needed to make Wikidata a usable fourth place-tagging source:

1. Extract zh-hant place raw data (currently missing entirely).
2. Compile it via the existing `place` kind path (`compileWikidataKindPack`).
3. ~~Wire crosswalk-id extraction into the place/org/work compile path~~ — **done, see below.**

#### Crosswalk wiring — implemented (2026-07-25)

Investigation found the gap was broader than just places: `compiledCrosswalkFromRaw()` (in `identifierClaims.mjs`, converts `raw.crosswalk` → `metadata.crosswalk`) was fully implemented and unit-tested but **never called from either compile path** — not `compile.mjs` (persons) nor `compileKind.mjs` (place/org/work). Raw extraction always captured crosswalk ids correctly (`P497`→cbdb, `P4711`→chgis, etc., per `identifierProperties.json`); they were silently dropped at compile time for every kind, not just places.

Fixed in `authoritypacks/wikidata/{compile.mjs,compileKind.mjs,identifierClaims.mjs}`:

- Both compile paths now call `compiledCrosswalkFromRaw()` and attach the result to `metadata.crosswalk`.
- Added a **disable-a-posteriori mechanism**, per your requirement: `compiledCrosswalkFromRaw(raw, { disableKeys: [...] })` drops named crosswalk keys (e.g. `chgis`) at compile time. This is a **recompile-time filter, not a re-extraction** — raw NDJSON always retains every crosswalk id captured during the (expensive, multi-hour) dump scan, so disabling or re-enabling a specific crosswalk source is just a cheap recompile with/without `--disable-crosswalk key1,key2`, never a re-scan of the dump.
- `compileKind.mjs` CLI takes `--disable-crosswalk key1,key2`; the choice is recorded in the pack's `manifest.json` as `disabledCrosswalkKeys` for traceability.
- Test coverage: `wikidata/compileKind.test.mjs` (new), `wikidata/identifierClaims.test.mjs`, `wikidata/extract.test.mjs` (updated — previously asserted the bug's behavior, i.e. `crosswalk === undefined`, now asserts the fix). Full `wikidata/*.test.mjs` suite passes (43/43).
- **Not yet threaded through:** `compile.mjs`'s CLI and the dynasty/pre-ming/country pack-builder functions don't expose `disableCrosswalkKeys` as a flag yet (only `compileKind.mjs`'s CLI does) — low priority, add when a person pack actually needs it.

#### Still blocked: actual zh-hant place extraction

Extracting real Chinese place data requires re-scanning the full Wikidata dump (~90–100 GB compressed, several hours per scan). The dump file is **not currently on disk** on this machine (previously used for the person extracts, then removed) — re-downloading and re-scanning is a real time/disk/CPU cost. **To be run on another machine** — full instructions below.

##### Instructions: extracting the zh-hant place pack

Run from `/authoritypacks`:

**1. Download the dump** (skip if you already have it from a prior extraction):

```bash
# ~90-100 GB compressed. Save wherever you have space, e.g. ~/Downloads/latest-all.json.bz2
curl -o ~/Downloads/latest-all.json.bz2 https://dumps.wikimedia.org/wikidatawiki/entities/latest-all.json.bz2
```

Verify the file is complete (should be ~90-100 GB) before proceeding — a truncated download will silently produce a partial pack.

**2. Extract zh-hant places from the dump** (single pass, several hours, high CPU, modest RAM — streams + checkpoints):

```bash
npm run wikidata:extract -- \
  --kinds place \
  --membership label-only \
  --language zh-hant \
  --out packs/wikidata/raw-zh-hant-place \
  --dump ~/Downloads/latest-all.json.bz2 \
  --progress 500000
```

If interrupted, resume with `--resume` appended (re-reads from the start but skips already-scanned entities — decompression time only, matched rows are kept):

```bash
npm run wikidata:extract -- \
  --kinds place --membership label-only --language zh-hant \
  --out packs/wikidata/raw-zh-hant-place \
  --dump ~/Downloads/latest-all.json.bz2 \
  --progress 500000 --resume
```

**3. Compile the pack** (fast — seconds to minutes, no dump needed, safe to rerun):

```bash
node wikidata/compileKind.mjs \
  --raw packs/wikidata/raw-zh-hant-place/places.raw.ndjson \
  --kind place \
  --language zh-hant \
  --out packs/wikidata/place-zh-hant
```

This now automatically attaches `metadata.crosswalk` (cbdb/chgis/dila/viaf/wikidata ids) per the fix above. To exclude a specific crosswalk source (e.g. if CHGIS ids prove unreliable and you want them out without re-extracting), add:

```bash
  --disable-crosswalk chgis
```

Recompiling with or without `--disable-crosswalk` only touches step 3 (seconds) — step 1–2 (the expensive dump download/scan) never need to be repeated to change this.

**4. Verify:**

```bash
wc -l packs/wikidata/place-zh-hant/places.ndjson
head -3 packs/wikidata/place-zh-hant/places.ndjson
cat packs/wikidata/place-zh-hant/manifest.json
```

Expect a nonzero `disabledCrosswalkKeys` entry in the manifest only if you passed `--disable-crosswalk`; otherwise `[]`.

### Phase 0 — Coordinate source data fixes

Fix the two CHGIS/CBDB coordinate issues before compilation. Both needed for valid Phase 1 pack output.

**0a. CHGIS county-layer CRS reprojection — implemented (2026-07-25)**

- **Problem:** county points (`v6_time_cnty_pts_utf`, 10,520 records) are in Xian_1980_Gauss_Kruger_zone_19 (projected CRS, meter-scale coordinates like `{lat: 4319886.6, lon: 19506884.1}`), but `pointLatLon()` read them raw without reprojection, mislabeling them as WGS84. Prefecture points (`v6_time_pref_pts_utf_wgs84`, 5,226 records) are already WGS84 and correct.
- **Fix, as built:** added `proj4` dependency (`authoritypacks/package.json`). New module `chgis/crs.mjs` holds a `LAYER_CRS` registry keyed by shapefile basename — currently only `v6_time_cnty_pts_utf` maps to the Gauss-Krüger proj4 string; any other layer (including the prefecture layer) passes through unchanged. `chgis/parseShapefile.mjs`'s `iterateShapefileRows()` now derives the layer name from the `.shp` path, reprojects only when `layerNeedsReprojection()` says so, and validates the result with `isValidWgs84()` before attaching `row.lat`/`row.lon` — out-of-bounds points are dropped (not silently kept) and logged with a count via `console.warn`, rather than crashing or shipping bad coordinates. `placeFromChgisRow` (`compileRecords.mjs`) needed no changes — it already only reads pre-extracted `row.lat`/`row.lon`.
- **Verified:** `chgis/crs.test.mjs` (new) reprojects the exact bad sample value from the audit (`{lat: 4319886.6, lon: 19506884.1}`) and confirms it now lands in valid China bounds (lon 73–135°E, lat 18–53°N). Full `chgis/*.test.mjs` suite passes (11 pass, 1 skipped — the real-shapefile integration test, which requires the actual `.shp` files that aren't on this machine).
- **Not yet verified against real data.** The `.shp`/`.prj` files live only on the machine where CHGIS gets downloaded/compiled (per the existing README workflow, `~/Downloads/chgis_layers/` → `npm run compile:chgis`) — **you'll need to recompile CHGIS yourself and confirm the county layer's coordinates land correctly**. Step-by-step smoke test: `authoritypacks/chgis/SMOKE_TEST.md` (compile-log warning check, bulk bounds check script, `PRES_LOC` spot-checks, cross-check against the already-correct prefecture layer). If it's still wrong, the Gauss-Krüger proj4 string in `crs.mjs` is the first thing to re-check against the real `.prj` sidecar.
- **Note:** Xian 1980 datum transformation is approximate (`+towgs84=0,0,0`, no real datum-shift parameters known/published), adequate for county-level clustering at ~5 km threshold, not survey-grade.

**0b. CBDB coordinate extraction — implemented (2026-07-25)**

- **Problem:** `ADDR_CODES` schema carries `x_coord REAL` / `y_coord REAL` / `CHGIS_PT_ID INTEGER`, but `compileCbdbPlaces()` only SELECTed `c_addr_id, c_name_chn, c_alt_names, c_firstyear, c_lastyear, c_admin_type` — coordinates were not extracted. Coverage was 0/30,100 rows.
- **Fix, as built:** `cbdb/compileRecords.mjs`'s `compileCbdbPlaces()` now selects `a.x_coord, a.y_coord` and sets `metadata.geo = { lat: y_coord, lon: x_coord }`, explicitly excluding the `{0,0}` missing-value sentinel (`!(x_coord === 0 && y_coord === 0)`). No reprojection needed — CBDB coordinates are already WGS84.
- **Verified against the real `.upstream/cbdb.sqlite3` dump (integration test, not a fixture):** `cbdb/compileRecordsPlaces.test.mjs` confirms 15,000–16,000 of 30,100 rows carry `metadata.geo` (matches the audited ~51.5%), zero `(0,0)` sentinels leak through, and at least one record lands in plausible China bounds with lat/lon in the correct (unswapped) axis order.

**0c. CBDB name-variant generation for admin-suffixed forms — implemented (2026-07-25)**

- **Problem:** CBDB stores bare place names (竟陵 for a Xian) in `c_name_chn`, and `c_admin_type` separately. Corpus texts often include the suffix (竟陵縣), but string-matching against bare names fails.
- **Fix, as built:** new module `cbdb/adminVocabulary.mjs` loads `admin_type_concordance.tsv` and exposes `suffixedNameVariant(name, adminType)`. `compileCbdbPlaces()` calls it per row and, when a suffix is known and the name doesn't already carry it, adds the suffixed form (e.g. 竟陵 → 竟陵縣) to `searchStrings` alongside the bare name.
- **Script bug caught and fixed while implementing this:** the concordance's `suffix_char` column was originally populated in **simplified** Chinese (县, 卫, 厅, 国 — matching CHGIS's `TYPE_CH`, which really is simplified, confirmed by inspecting the compiled pack). But CBDB's `c_name_chn` is **traditional** (confirmed: `賓縣`, `古縣`, `蓋縣` in the real data) — appending a simplified suffix to a traditional name would have produced a string (竟陵县) that can never match traditional-script corpus text. Fixed by re-deriving `suffix_char` in traditional script (縣, 衛, 廳, 國, 區, 門, 莊, etc.) while deliberately leaving `chgis_type_ch` simplified, since that column exists to match CHGIS's own script. Documented inline in the TSV's notes column so the two-script convention doesn't get "fixed" back to being consistent by mistake later.
- **Verified against real data:** `cbdb/compileRecordsPlaces.test.mjs` confirms a real bare-name Xian record gets its traditional-suffixed variant (e.g. `X` → `X縣`) in `searchStrings`. Unit tests for the suffix-lookup module itself: `cbdb/adminVocabulary.test.mjs`.
- **Full test suite after 0a–0c:** 75/76 pass across `cbdb/*.test.mjs`, `chgis/*.test.mjs`, `wikidata/*.test.mjs` (the 1 skip is the CHGIS real-shapefile integration test, expected — see Phase 0a).

### Phase 1 — Coordinates in packs

Depends on: Phase 0, Phase A (vocabulary table).

**Scope:** recompile CHGIS and CBDB packs with fixed/extracted coordinates. DILA is out of scope (0.3% coverage).

**Acceptance:**

- CHGIS pack: 15,746 records, 100% with `metadata.geo`, all valid WGS84 bounds (after CRS fix).
- CBDB pack: 30,100 records, ~51.5% with `metadata.geo`, no (0,0) sentinels.
- For a known ambiguous name (e.g. 竟陵), a merged candidate list shows two distinct coordinate pairs and name variants if they are, in fact, two different places (different c_addr_id + distinct geo clusters).

### Phase 2 — Distance + clustering utility — implemented (2026-07-25)

Depends on: Phase 1.

**Scope:** pure utility function `packages/cwrc-leafwriter/src/autoTagging/geoCluster.ts`: haversine distance, greedy single-link clustering by distance ≤ threshold (configurable, default ~5 km).

**As built:**

- `haversineDistanceKm(a, b)` — pure great-circle distance, no dependency.
- `clusterByDistance(points, thresholdKm)` — single-link clustering; a point joins any cluster where it's within threshold of _any_ current member (not just the centroid), and can bridge two previously separate clusters into one.
- `clusterCandidatesByGeo(candidates, thresholdKm)` — the actual entry point for disambiguation code: takes `AuthorityCandidate[]`, splits into geo-bearing candidates (clustered) and `noGeo` (candidates without `metadata.geo`, returned separately rather than dropped — for the "no geo data" fallback labeling per the Phase 3 UI design). Each cluster carries a derived `centroid` for display (never stored).
- Added `metadata.geo?: { lat, lon }` and `metadata.layer?: string` to the TS `AuthorityCandidate` type (`autoTagging/authority.ts`) — these fields were already flowing through compiled NDJSON packs (Phase 0/1) but weren't declared on the consuming side yet.

**Acceptance — met:** `geoCluster.test.ts` includes the exact fixture this phase specified: 3 authorities (CBDB/CHGIS/Wikidata) × 2 real geo-clusters (two same-named 竟陵 places ~2000 km apart, each authority's hit within a few km of the others) resolves to exactly 2 clusters of 3 members each at a 5 km threshold. Plus: cluster-bridging, centroid computation, and no-geo candidates preserved (not dropped). 7/7 tests pass; typecheck clean; no regressions in `authority`/`packLoader` test suites (60/61 pass, 1 pre-existing unrelated skip).

### Phase 3 — Settings + wiring into crosswalk conflict path

Depends on: Phase 2.

**Scope, as originally written:** add `placeProximityKm` to project prefs (Settings panel, default 5 km, range 0–50). Wire clustering into `planLookupResolution`'s conflict branch: when a name string resolves to multiple project entities or multiple pack rows, group candidates by cluster before presenting them to the user. Separate visual groups for distinct clusters; rows with no coordinates fall back to bare string/crosswalk behavior, labeled "no geo data."

#### Found a more precise wiring point, and fixed the actual bug — implemented (2026-07-25)

Investigation found `planLookupResolution`'s conflict branch operates on **project entities already in `entities.xml`** (`EntityRecord`, no geo — that only exists on raw pack rows, and only lands on entities.xml once Phase 5 is built). The real "same name, different place" collision lives one layer earlier: `shouldMergePlacePackCandidates` (`authorityOverlap.ts`), which decides whether two **raw pack rows** (a CBDB hit and a CHGIS hit, say) get merged into one candidate before ever reaching the disambiguation UI. Its existing fallback rule was: _same primary name across CBDB/DILA/CHGIS → merge_, with **no geo check at all** — this is the exact bug the whole plan set out to fix (e.g. two distinct places both named 臨川 would auto-merge into one candidate today).

**Fixed:**

- `shouldMergePlacePackCandidates(a, b, proximityKm)` now takes an optional proximity radius. Crosswalk-id matches still win unconditionally (an explicit cross-reference is never overridden by geography). For the name-only fallback: if either candidate lacks `metadata.geo`, behavior is unchanged (name-only merge — the "no geo data" fallback case). If both have geo, they only merge when within `proximityKm` (haversine, via `geoCluster.ts`) — otherwise they now correctly surface as **distinct** candidates.
- `DEFAULT_PLACE_PROXIMITY_KM = 5` (matches the design default) is exported from `authorityOverlap.ts` and used wherever a caller doesn't have settings context.
- `collapseLinkedCandidates()` and `mergeCandidateIntoLookupList()` both take an optional `proximityKm` parameter, threaded down to `shouldMergePlacePackCandidates`, defaulting to `DEFAULT_PLACE_PROXIMITY_KM` so every existing call site (including `seed.ts`'s pack-index building) gets the fix automatically without call-site changes.
- `placeProximityKm` added to `DisambiguationSettings` (`disambiguationSettings.ts`), following the exact existing pattern for `dateFilter`/`yearStart`/`yearEnd`: `placeProximityKmFromSettings()` reads it back clamped to 0–50 km (falls back to the default outside that range or if absent), `persistPlaceProximityKm()` does a read-modify-write persist matching `persistDisambiguationDateFilter`'s shape.

**Tests:** 5 new cases in `authorityOverlap.test.ts` covering: merge within threshold, correct split beyond threshold (the core fix, with a synthetic Hubei/Beijing same-name pair), no-geo fallback, custom-radius behavior, and crosswalk-wins-over-distance. 28/29 relevant tests pass across `authorityOverlap`/`seed`/`disambiguationSettings`/`geoCluster` (1 pre-existing unrelated skip); no regressions in the 92/93 downstream `disambiguationCandidates`/`lookupResolve`/`suggestionFilters`/`apply` suites. Typecheck clean (pre-existing unrelated errors only, in `dialogManager.ts`/`tinymceWrapper.ts`/`monacoEnvironment.ts`).

#### Geo threaded into the interactive disambiguation panel's data path — implemented (2026-07-25)

Investigation found the interactive disambiguation panel (`DisambiguationPanel.tsx`) does **not** go through `authorityOverlap.ts`'s merge at all — it builds one `DisambiguationCandidate` per matched pack row directly in `candidatesFromAuthorityPacks()`, then only merges via crosswalk keys or exact matching birth/death years (`collapseCrossAuthorityCandidates`), never by bare name. So the naive-name-merge bug fixed above only ever affected the auto-tagging seed/tag-bomb pipeline (`seed.ts`) — the interactive panel already showed distant same-named places as separate candidates. Confirmed, not assumed: traced the actual code path end to end.

What _was_ missing on this path: `metadata.geo` never reached `DisambiguationCandidate` at all — dropped at the `PackRow`/`DisambiguationCandidate` type boundary. Fixed:

- Added `geo?: { lat, lon }` to `PackRow['metadata']` (`services/authority-pack-lookup.ts`) and to `DisambiguationCandidate` (`disambiguationCandidates.ts`).
- `candidatesFromAuthorityPacks()` now copies `row?.metadata?.geo` onto each candidate.
- `mergeIntoExisting()` and `mergeSelectedCandidates()` (the two merge paths within `disambiguationCandidates.ts`) preserve `geo` from whichever input row carries it, matching the existing pattern for other optional fields.
- Tests: `buildDisambiguationCandidates` test confirms a CHGIS pack row's `metadata.geo` reaches the final candidate; `mergeSelectedCandidates` test confirms geo survives a merge. 113/114 relevant tests pass across `disambiguationCandidates`/`lookupResolve`/`suggestionFilters`/`authorityOverlap`/`seed`/`geoCluster`/`authority-pack-lookup` (1 pre-existing unrelated skip). Typecheck clean (same 5 pre-existing unrelated errors as before, in files this work never touched).

#### Visible clustering UI in the disambiguation panel — implemented (2026-07-25)

`clusterCandidatesByGeo` (AuthorityCandidate-shaped) turned out not to fit `DisambiguationCandidate` directly — that type carries `geo` at the top level, not under `metadata`. Rather than force one shape onto the other, generalized `geoCluster.ts`: added `clusterByGeoAccessor(items, thresholdKm, getGeo)`, taking an explicit accessor so any shape works; `clusterCandidatesByGeo` is now a thin wrapper of it for the `AuthorityCandidate`/`metadata.geo` case (unchanged API, existing callers/tests untouched).

**Built in `DisambiguationPanel.tsx`:**

- A proximity-radius `Slider` (0–50 km, matching the design range), shown only when the active group's tag is `placeName`, backed by the new `placeProximityKm` state, reading/writing via `placeProximityKmFromSettings`/`persistPlaceProximityKm` — this is the Settings-panel control that was the other missing piece of Phase 3, placed inline in the disambiguation panel itself (the natural place a user would want to adjust it) rather than in a separate global Settings screen.
- `placeClusterLabelById`: a memo computing `clusterByGeoAccessor(filteredCandidates, placeProximityKm, c => c.geo)` for place groups, but only producing labels when there are **≥2 real clusters** — a single cluster (nothing ambiguous) or a lone candidate renders no badges at all, so the UI stays quiet except when it's actually surfacing a decision.
- Each candidate row now shows a small lettered `Chip` (A, B, C…, with a 📍 icon) when it belongs to a real cluster, or a muted outlined "no geo data" chip when it has no coordinates and clustering is active for that group — letters are assigned in cluster-discovery order (stable per render, not a persisted identity).

**Tests:** 2 new `DisambiguationPanel.test.tsx` cases — one renders 3 place candidates (two ~1000km apart, one ungeo'd) and asserts the actual rendered DOM shows letters "A"/"B" and "no geo data" text; the other confirms a single geo-bearing candidate shows **no** badges (nothing to disambiguate). Both assert on real RTL-rendered output, not mocks. 92/93 relevant tests pass across `DisambiguationPanel`/`geoCluster`/`disambiguationCandidates`/`authorityOverlap`/`disambiguationSettings`/`seed`/`authority-pack-lookup` (1 pre-existing unrelated skip). Typecheck clean (same 5 pre-existing unrelated errors).

**Not independently browser-verified.** This panel lives inside the Electron desktop app and needs a loaded project (entities.xml + installed authority packs) to reach this UI state — the available preview tooling only runs `leafwriter-commons`, a different app, so this wasn't visually confirmed in a live browser/Electron session. Verification rests on the RTL component tests, which do render real DOM and assert on real text content, not mocked-away structure.

**Genuinely still not built:**

- `planLookupResolution`'s conflict branch (project-entity duplicates already in entities.xml) is unaffected by any of this — it stays name/crosswalk-only until Phase 5 puts geo data on entities.xml.
- Clicking a cluster letter to filter the candidate list to just that cluster (current UI shows all candidates with badges, doesn't yet let the user narrow to one cluster) — a possible follow-on if the letter labels alone prove insufficient in practice.

**Acceptance — met.** Both correctness (Phase 3 core fix) and the originally-scoped UI (proximity control + visible cluster grouping + "no geo data" labeling) are implemented and tested. Phase 6 (map-pin comparison view), originally deferred as a separate design task, has since been re-scoped and unblocked — see "Decisions (2026-07-26)" below.

### Phase 4 — Merged period display and entity linking — implemented (2026-09-20)

Depends on: Phase 3.

**Scope:** merge-time period display (existing design from §4) now feeds entity linking and minting. When a user links to or mints from a cluster, use the merged period strings as fallback description text (non-destructive enrichment, only if entity has no description yet). Authority source tags preserved in display.

**As built:** `mergedPeriodDisplay(assertions: AuthoritySourcedFields[])` (`entities.ts`) derives a `"SOURCE: period; SOURCE: period"` line from `planLookupResolution`'s existing `authorityAssertions` (already computed for every checked authority reference — this is the same list `entities.ts:280-327`-era code writes one `<idno>` per source from). Each source's own fragment (`420–478`, `704–`, `fl. 1120–`, or a bare year when start equals end) is kept separate and tagged by source, exactly as §4 specifies; it is never written back as `startYear`/`endYear`, only ever offered as a `description` fallback.

- **Mint:** `description: input.description ?? candidateMeta?.description ?? mergedPeriodLine` — the merged line is the last-resort fallback, after any user-typed description and the primary candidate's own authority description.
- **Link (the gap Phase 4 actually needed to fill):** investigation found the link path had _no_ description-writing code at all — `entity.description` was only echoed back into the plan for display, never enriched. `applyLookupResolution`'s link branch now calls `store.sqliteUpdateDescription(plan.key, plan.mergedPeriodDisplay)`, gated on `!plan.description` (i.e. only when the entity has no description yet) — the same non-destructive pattern `splitEnrichment` already uses for idnos, applied here to a scalar field.

**Known limitation, carried over from the current data model:** `AuthoritySourcedFields` holds one `startYear`/`endYear` pair per source, not DILA's multi-dynasty-row style (`漢, 孫吳, 南齊, 唐`). The merged line today is one fragment per source (`CBDB: 420–478; DILA: 704–`), not multiple fragments per source — extending to multi-fragment-per-source would need upstream aggregation in `candidatesFromAuthorityPacks`/`crosswalkForRef` and is deferred until a real case needs it.

**Tests:** `mergedPeriodDisplay` unit tests in `entities.test.ts` (fragment formatting, floruit, equal-year collapse, no-year-data skip); `lookupResolve.test.ts` gained a case confirming an empty-description link gets the merged line and a case confirming an existing description is never overwritten. Full `entities`/`lookupResolve` suites pass (59/59). Typecheck clean (pre-existing unrelated errors only, in `ChhivSymbolGridDialog.tsx`).

**Acceptance — met.** Linking a corpus mention to a multi-authority cluster creates/updates the project entity with merged period metadata as a non-destructive description fallback.

### Phase 5 — Persisted cluster entities in entities.xml — engine layer implemented (2026-09-20)

Depends on: all prior phases.

**Scope:** implement the cluster entity schema in the app's entities.xml handling. The schema actually shipped follows the **coordinates/id storage-mode** shape from "Decision (2026-07-26): origin-place import modes" (the acceptance criteria below always used this terminology) rather than the earlier `type="cluster"` sketch from "Decisions (2026-07-25)" — the two were never reconciled in this doc; the 2026-07-26 shape is the one actually built. `type="cluster"` was not implemented as a separate schema.

**As built — full stack, SQLite schema through entities.xml:**

- **Schema** (`apps/desktop/src/entityDbSqlite/schema.ts`, migrations 13–14): `place_admin_levels` (single-value-per-source candidates, exactly like the existing `place_locations` geo-candidate table — accept-one-as-active via the same origin/source/status provenance pattern); `place_authority_dates` (new structurally: the first one-to-many child table hung off an `entity_authorities` row, `ON DELETE CASCADE` so detaching an authority frees its date ranges for free — satisfies the delinking requirement without new deletion code); `place_storage_mode` (one row per entity — a direct importer decision, not an assertion to accept-among-many, so no per-source candidates needed).
- **Repository** (`apps/desktop/src/entityDbSqlite/repository.ts`): `applyAuthorityBackfillPatch` gained `adminLevels`/`sourceEntries`/`storageMode` fields; a new `acceptAdminLevelAssertion` mirrors `acceptGeoAssertion`; `getPanelSummary`/`listPanelSummaries` expose `adminLevel`/`storageMode`/`sourceEntries` (dates grouped by authority, verbatim per source — never unioned); `decoupleAuthority`/`replaceEntityContentFrom` (entity merge) both updated to include the three new tables, with authority-id remapping for `place_authority_dates`.
- **Bugfix found in the process:** `decoupleAuthority`'s `purgeBySource` only ever matched a `"TYPE:value"` source-string convention, but `place_locations`/`entity_dates` (and the new `place_admin_levels`) write a bare `"TYPE"` source — meaning authority-origin geo/date candidates were never actually purged on unlink before this. Fixed to match both conventions.
- **IPC/preload/entityStore.ts:** `entitySqliteAcceptAdminLevelAssertion` wired end-to-end (main.ts handler, preload.ts bridge, `EntityStore.sqliteAcceptAdminLevelAssertion`); `sqliteApplyAuthorityBackfillPatch`'s type surface extended for the three new patch fields.
- **XML codec** (`apps/desktop/src/entityDbSqlite/xmlCodec.ts`): a `<place>` item's `type="coordinates"|"id"` attribute round-trips to/from `place_storage_mode`; `<note type="adminLevel" source="…">` round-trips to/from `place_admin_levels`; an authority association that carries date ranges renders as `<sourceEntry source="…" authId="…"><date from="…" to="…">label</date>…</sourceEntry>` instead of a bare `<idno>` — never both for the same association, so existing crosswalk lookups aren't duplicated.
- **Pure origin-place importer** (`packages/cwrc-leafwriter/src/autoTagging/originPlaceImport.ts`): `importOriginPlace(candidates, proximityKm)` implements the exact three rules from the 2026-07-26 decision (coherent cluster → coordinates-mode with one representative point; geo-cluster split or admin-level mismatch → id-mode, provenance still preserved; no coordinates at all → id-mode, not a conflict) using the existing `clusterByDistance` from `geoCluster.ts`. Pure function, no store access — its output maps directly onto `sqliteApplyAuthorityBackfillPatch`'s new fields.

**Tests:** 4 new repository tests (apply/accept/delink/replace-content-merge), 1 new xmlCodec round-trip test (schema → XML → schema, including the sourceEntry/idno mutual-exclusion check), 7 new `importOriginPlace` unit tests covering all three rules plus the admin-level-compatibility helper. Full `entityDbSqlite` suite (104 tests, all three backends) and relevant `cwrc-leafwriter` suites pass; both packages typecheck clean.

**UI integration — implemented (2026-09-20):**

- **Entity editor** (`apps/commons/src/desktop/sidebar/SidebarDatabaseTab.tsx`): a place entity's admin-level candidates now have their own accept/reject row, mirroring the existing geo block exactly (`adminLevelGroups`, `PendingValidationMode: 'adminLevel'`, `sqliteAcceptAdminLevelAssertion` on save). A storage-mode chip (`Coordinates` / `ID only`) and a read-only "Authority sources" list (one row per `sourceEntry`, badge + authId + joined date ranges) render below it. `EntitySummary` (`entityOps.ts`) and `entitySummaryFromSqlite` (`sqliteSummary.ts`) were extended with `adminLevel`/`storageMode`/`sourceEntries` to carry this data from the SQLite panel summary into the component.
- **Origin-to-place resolution**: a "resolve to place entity" button (📍 icon) now appears on each accepted place-of-origin value in the person editor, gated on not already pointing at a project entity (`ref` doesn't start with `#`). Clicking it calls the new `resolveOriginToPlaceEntity(store, personId, candidates, proximityKm)` (`originPlaceResolve.ts`) — the side-effecting glue around the pure `importOriginPlace`: mints a place entity (`sqliteCreatePopulated`), patches in the decided storage mode/admin levels/source entries (`sqliteApplyAuthorityBackfillPatch`), then backlinks each origin assertion's `ref` to `#<new-place-id>` via a new repository method, `setOriginReference` (mirrors `acceptGeoAssertion`'s shape, wired end-to-end through IPC/preload/`entityStore.ts`).
- **Known limitation, by design:** an origin assertion carries only `{source, ref}` on the person entity — no geo/admin-level of its own. Without a pack-lookup step (out of scope here), `importOriginPlace` sees no coordinates and correctly applies Rule 3 (id-mode place, not a conflict). The resulting place entity is still a real, provenance-bearing entity — just not yet geo-enriched. A future pass could enrich it the same way person entities already get authority backfill.
- **Correctness note:** the hard "admin levels cannot mix" constraint is enforced only inside `importOriginPlace`'s decision (forces id-mode on mismatch) — nothing prevents directly calling `applyAuthorityBackfillPatch` with mismatched `adminLevels` outside that path; it would just store both candidates without complaint (matching "no duplicate-authority-reference warning" being an existing, deliberate non-error elsewhere in this schema).

**Tests:** repository test for `setOriginReference`; 3 new `resolveOriginToPlaceEntity` unit tests (coherent multi-authority mint + backlink, bare user-typed origin with no authority ref, empty-candidate no-op). All three touched packages (`apps/desktop`, `packages/cwrc-leafwriter`, `apps/commons`) typecheck clean; eslint clean on every touched file.

**Acceptance — met.** Users can now create place entities from confirmed origin assertions (storage mode decided automatically), accept/reject admin-level candidates, and see source-entry provenance, all from the entity editor — closing the gap the previous pass left open.

### Phase 6 — Map-pin comparison view

**Revised 2026-07-26 — depends only on Phase 3 (merge extension below), not Phase 5.** Originally scoped as TBD and gated on persisted cluster entities; re-scoped after review of `docs/archive/map-app.md` to be a pure visualization layer over data the panel already computes, so it does not need entities.xml changes to ship.

**Scope:**

- **No geocoding.** Coordinates come only from `DisambiguationCandidate.geo` (already populated from CHGIS/CBDB packs per Phase 1/2). Nominatim, or any other place-name → coordinates lookup, is out of scope — this map never geocodes a string, it only renders coordinates the candidates already carry. Candidates without `geo` are excluded from the map (consistent with the panel's existing "no geo data" fallback labeling); they are not approximated or geocoded as a substitute.
- **Merge extension (prerequisite):** today, `clusterByGeoAccessor` (`geoCluster.ts`) only _labels_ place candidates with a cluster letter — `collapseCrossAuthorityCandidates` (`disambiguationCandidates.ts:359-411`) does not currently fold candidates together by geo-cluster membership, only by shared authority key or (for persons) matching birth/death years. Extend the merge step so place-type groups also collapse when candidates share a geo cluster, producing one merged `DisambiguationCandidate` per cluster with a combined `sources` list — the same shape persons already get when merged across authorities (`entities.ts:280-327` writes one `<idno>` per merged source). This turns "10 date-filtered hits, 3 of them badged A, 4 badged B, 3 badged C" into "3 merged cluster rows," each carrying all its folded-in source badges.
- **Map pins = one per merged cluster row**, at the cluster centroid (already computed by `clusterCandidatesByGeo`/`clusterByGeoAccessor`). Not one pin per raw authority hit.
- **Entry point:** a small icon on the group header (next to the ambiguous string/`surface`, not per candidate row), shown only when the group has ≥2 real geo clusters — same gating `placeClusterLabelById` already uses. Clicking it opens a modal map with one pin per cluster, colored/lettered using the exact same palette as the row badges, so there's one visual vocabulary between the list and the map, not two.
- **Tiles: local MBTiles, downloaded on first map open, superseding the MapTiler decision below.** Since this is a desktop app (`apps/desktop`, Electron), the tile-hosting-policy problem (§"Decisions," point 2) can be sidestepped entirely rather than worked around with a keyed provider: on first opening the map, prompt the user to download a regional MBTiles bundle (street/satellite/relief, capped at ~500 MB) covering the historically-relevant area (East/Central Asia). MapLibre then points at a small local tile server (e.g. `tileserver-gl`, bundled with the app) reading from the downloaded MBTiles — no external tile requests at all after the initial download, no API key, no per-request tile-provider ToS to comply with, and it works offline. MapTiler remains a documented fallback only for regions/detail levels not covered by the bundled MBTiles (see updated "Decisions," point 2).
- **Dual-use note:** build the map component to take `{candidate, clusterLabel, color}[]` as input (pins to render), not `MentionGroup`/panel-specific types directly — so the same component can later serve the "map of disambiguated places in the current document" view (§1.1 of `docs/archive/map-app.md`) without rewriting it.

**Acceptance:**

- A place group with ≥2 geo-bearing clusters shows a group-header map icon; clicking it renders one pin per cluster at its centroid, matching row-badge colors/letters.
- Candidates without `geo` never appear on the map and don't block the icon from working for the candidates that do have coordinates.
- No network call to any geocoding service occurs as part of rendering the map.
- First-open flow: user is prompted to download the regional MBTiles bundle (size shown, capped ~500 MB) before the map renders tiles; declining still shows pins (e.g. on a blank/graticule background) rather than blocking disambiguation entirely.
- After download, opening the map again does not re-download or make any external request.

**Not in this phase:** persisted cluster entities (still Phase 5), Nominatim/geocoding fallback for geo-less candidates, doc-wide "all disambiguated places" map (future, per `docs/archive/map-app.md` §1.1), automatic MBTiles bundle updates (v2 concern).

### Deferred to v2

- Per-admin-level (or per-place-type) adaptive radius instead of one global number (Open Question 1).
- Historical relocation modeling (a place whose geographic point itself changes over time, which geo-clustering alone cannot distinguish from "renamed and never moved").
- ~~DILA coordinate integration~~ — done for the direct `<geo>` + modern-district-centroid fallback (see "DILA — direct `<geo>` out of scope; modern-district centroid fallback added" above). Deeper DILA-specific work (e.g. resolving multi-chain/ambiguous `<district>` values) remains deferred.

## Open questions

1. **Fixed global radius vs. scaled-by-type.** A temple and a circuit/province need very different "close enough" radii. V1 ships one global setting; do we want an early override per DILA/CBDB admin-type bucket, or wait until the flat radius proves wrong in practice?
2. **Confidence score vs. hard cutoff.** A hard km cutoff creates edge-of-threshold artifacts (4.9 km groups, 5.1 km doesn't). A distance-decay confidence score is more principled but adds UI complexity (how do you show "80% confident same place"?) — probably not worth it for v1.
3. **Missing-coordinate fallback rate.** Need to check what fraction of DILA/CBDB place rows actually carry coordinates before promising this covers "most" ambiguous cases — some rows may only have a district-chain reference and no lat/lon at all.
4. **Resolved:** a decided place cluster gets a durable project entity. Its
   storage mode is `coordinates` only when the origin-place import policy below
   is satisfied; otherwise it is `id`.

---

Some thoughts:

- There is no harm in building the infrastructure (settings pannel 'group by distance' toggle, which activates a distance field, 0-50 km ?), nor in extracting longitude and latitude from CBDB, DILA, and CHGIS.
- to be clear, we are not SEARCHING BY LONG AND LAT, or not at this point, but using it to group results from a string search.
- This is a distinct ontology from `placeName`. It is in fact a _place_ that may have multiple names. It should probably be treated differently, if not by separate tags then by separate items in our database. However, that make the question of what a `placeName` _is_ if not a word pointing to a concrete location... Instead, it is about administrative heirarchy at a given time?

We should probably store BOTH in entities.xml.

In addition to locating and extracting longitude and latitude from all our authorities, online and off, we really need to dig though them to see if we can't create some homogenous way to treat administrative units (e.g., 縣VS郡). I know these are present (in pinyin) in CHGIS, but I'm not sure if it's the case in all... This is more for the 'places as units within administrative geography' entity than 'places as coordinates' entitiy.

This makes sense to me: in disambiguate, we group either as we do now, or we group by name + long&lat and, presumably, extract the 'common coordinates'. To help disambiguation of PLACES, we should really have a link on each candidate cluser in this mode pointing to a map. CHGIS is clever: you search a string, and they produce a map with the different hits. Perhaps we could split into clusters, give each a number or letter, then shove the descriptions into a pin to drop in open street maps or Google (?). It doesn't make sense to do this individually for each identical cluster, because one needs to compare the clusters one to another if they point to four really distinct places... **(Originally deferred pending the persisted-cluster model, coordinate fixes, and vocabulary unification — re-scoped 2026-07-26 to not require those; see Phase 6 and "Decisions (2026-07-26)".)**

---

## Decisions (2026-07-25)

Resolves Open Question 4 (does a cluster get its own identity?) in the opposite direction from the original lean: **clusters are persisted**, not recomputed each time.

### Persisted cluster model

A decided cluster is modeled like a person entity — same shape, different fields:

- **Tag strings**: user-entered plus authority-pulled, deduped. Includes admin-suffixed variants (e.g. both 竟陵 and 竟陵縣) generated at compile time from the admin-type vocabulary — see below. Each tag carries an origin marker (`source` attribute) for delinking.
- **Coordinates**: exactly one `{lat, lon}` pair. Not a set to merge/average — the user (or the clustering step) picks the point that represents the decided place. Carries an origin marker.
- **Administrative level**: exactly one. The user cannot mix admin levels across the authority hits folded into a cluster (e.g. a district and a commandery cannot be the same cluster) — this is a hard constraint, not a warning. Carries an origin marker.
- **Date ranges**: multiple, expressed both in years and in dynasty labels, grouped by authority source (one entry per authority per period). This is the existing "merge-time period display" behavior from §4 above, now stored rather than only displayed. Delinking removes the entire authority's date entries.
- **Authority associations**: multiple idnos, one per source hit folded into the cluster, stored as `<sourceEntry source="..." authId="...">` wrappers around that authority's date entries.
- **User notes**: freetext, user-entered only (not imported from authorities — users follow the link if they want authority context). Stamped with who/when.
- **Audit metadata**: all entities carry `created` / `createdBy` / `modified` / `modifiedBy` (ISO 8601 timestamps, username only).
- **No duplicate-authority-reference warning.** Multiple clusters may legitimately reference the same authority id (e.g. a broad CHGIS commandery record split across several narrower user-decided clusters). The system does not warn on this — it is expected, not an error condition.

#### Schema for `<place type="cluster">` in entities.xml

```xml
<place xml:id="cluster_789" type="cluster"
       created="2026-07-25T10:00:00Z" createdBy="daniel"
       modified="2026-07-25T14:30:00Z" modifiedBy="daniel">

  <!-- user-entered freetext notes (no import from authorities) -->
  <note source="user" who="daniel" when="2026-07-25T10:30:00Z">
    Context or interpretation notes here
  </note>

  <!-- tag strings: user-entered and authority-sourced, marked by origin -->
  <placeName source="user">竟陵</placeName>
  <placeName source="cbdb">竟陵縣</placeName>

  <!-- coordinates with origin marking -->
  <location source="cbdb">
    <geo>32.0514 118.778</geo>
  </location>

  <!-- administrative level with origin marking -->
  <note type="adminLevel" source="cbdb">xian</note>

  <!-- authority associations + date ranges grouped by source
       When delinking an authority, delete the entire <sourceEntry> block -->
  <sourceEntry source="cbdb" authId="c_addr_123">
    <date from="260" to="504">0–260</date>
    <date from="704">704–</date>
  </sourceEntry>
  <sourceEntry source="chgis" authId="sys_456">
    <date from="1000" to="1400">Song</date>
  </sourceEntry>
</place>
```

This schema applies uniformly to all entity types (`<person>`, `<placeName>` mention-level, etc.): all carry `created`/`createdBy`/`modified`/`modifiedBy` and user notes, and all data sourced from authorities carry an origin marker for delinking.

### Decision (2026-07-26): origin-place import modes

Place-of-origin assertions always retain a string, but an entity must not claim
a coordinate when the authority evidence does not support one coherent place
identity. For one confirmed origin assertion, the importer applies this rule:

1. If every candidate with coordinates falls within the configured proximity
   radius, import the coherent result as a **place-as-coordinates** entity.
   Preserve all place strings and authority IDs, and select one representative
   coordinate for the entity. Source-level coordinates remain attached to their
   source entries; they are not averaged into a new fact. Candidates without
   coordinates remain separately represented as **place-as-id**, unless an
   explicit authority crosswalk proves they are the same record.
2. If there is a geographic conflict, such as coordinate clusters outside the
   radius, incompatible administrative identities, or unresolved authority
   disagreement, import every candidate as **place-as-id**. Preserve strings,
   IDs, coordinates, and provenance as source metadata, but do not promote any
   coordinate to the entity-level location.
3. If no candidate has coordinates, import the result as place-as-id. Missing
   coordinates are not `0,0` and are not a reason to discard the authority
   link.

The radius groups candidates returned by a string search; it is not a search by
latitude/longitude and is not an identity oracle. Administrative level remains
a hard compatibility check. A later user decision may promote an ID-mode
entity to coordinate mode without changing its authority provenance.

The intended entity shape is:

```xml
<place xml:id="place-123" type="coordinates">
  <placeName>鄱陽</placeName>
  <location><geo>28.21 116.68</geo></location>
  <sourceEntry source="cbdb" authId="c_addr_123"/>
</place>

<place xml:id="place-124" type="id">
  <placeName>鄱陽</placeName>
  <sourceEntry source="dila" authId="dila:PL456"/>
</place>
```

`coordinates` and `id` are entity storage modes, not corpus tag names.
Corpus `placeName` markup and a person's origin relationship point to the
selected project place with `@key`/`@ref` as appropriate.

### Admin-vocabulary unification — scope

Extends beyond the three internal sources: **unify CHGIS (`TYPE_CH`, Chinese single characters), CBDB (`c_admin_type`, romanized English, 239 raw values / <200 real after case-dedup), and external authorities (Wikidata, others) into one controlled admin-level vocabulary.** This mapping table is also the source for the suffix-character lookup used to generate admin-suffixed name variants (e.g. Xian → 縣) at compile time. Not yet built — needs a real mapping pass, not just the two internal sources.

### CHGIS coordinate audit (2026-07-25)

- Two source layers: county points (`v6_time_cnty_pts_utf`, 10,522 raw / 10,520 compiled) and prefecture points (`v6_time_pref_pts_utf_wgs84`, 5,226 raw/compiled).
- **Prefecture layer is clean**: confirmed WGS84 via `.prj`, zero (0,0) sentinels, zero out-of-bounds values across all 5,226 records.
- **County layer is 100% wrong, not missing**: every one of the 10,520 records carries a `metadata.geo` value (so naive coverage checks read as "100%"), but all of them are raw Xian_1980_Gauss_Kruger_zone_19 easting/northing values mislabeled as WGS84 lat/lon (e.g. `{lat: 4319886.6, lon: 19506884.1}`). This is **66.8% of the compiled CHGIS pack (10,520/15,746 records)** silently wrong until the reprojection fix (see Phase 1 below) lands.
- No precision/certainty field exists in the shapefile DBF schema (23 fields checked); `GEO_SRC` is a provenance code (`FROM_FD`/`FROM_AC`), not a confidence flag — can't be used to auto-flag approximate points.

### CBDB coordinate audit (2026-07-25)

- `ADDR_CODES.x_coord`/`y_coord` are NOT currently extracted by `compileCbdbPlaces` (`cbdb/compileRecords.mjs:96-101`) — this is the gap to close, not a bug to fix. Values are already plain WGS84 (confirmed via 20-row sample, all plausible China/Manchuria coordinates), no reprojection needed. Note the axis naming: `x_coord` = longitude, `y_coord` = latitude.
- Coverage: 15,487 / 30,100 rows (~51.5%) have usable coordinates after excluding the `0.0/0.0` sentinel (316 rows) used for missing values.
- `CHGIS_PT_ID` crosswalk (`chgis/cbdbCrosswalk.mjs`) covers fewer rows (10,996) than direct `x_coord`/`y_coord` — useful as a fallback/cross-check, not a primary source.

### DILA — direct `<geo>` out of scope; modern-district centroid fallback added (2026-09-20)

Only 382/59,294 DILA place records carry a direct `<geo>` point (~0.6%) — effectively unusable for clustering on its own. CHGIS + CBDB remain the two primary coordinate sources.

**Modern-district centroid fallback, implemented:** DILA's `<district>` field carries a modern administrative-equivalency chain (e.g. `中國-河南省-商丘市-民權縣` — country-province-city-county). Of the places with a non-empty `<district>` and no `<geo>`, 219 resolve unambiguously to a single "中國-..." chain; `dila/districtGeo.mjs` looks these up in a vendored gazetteer (`authoritypacks/china_admin_centroids.tsv`, ~3,200 province/city/county rows derived from [Vonng/adcode](https://github.com/Vonng/adcode), CC-BY 4.0, converted simplified→traditional) and attaches the matched county's (or city's/province's, as a fallback) present-day centroid as `metadata.geo`. This lifts DILA's place-geo coverage from ~0.6% to ~2% — still low overall, but real signal where CBDB/CHGIS have none.

**Precision caveat (kept as a single note here and in `dila/README.md`, not per-record metadata):** a district-centroid point is the modern county's centroid, not the historical site — it can be off by tens of kilometers, i.e. much coarser than the ~5 km clustering threshold used for CBDB/CHGIS points. `<district>` chains that are ambiguous (multiple `;`-separated candidates, e.g. a place spanning several provinces) or non-Chinese are deliberately left unresolved rather than guessing a point.

---

## Decisions (2026-07-26)

Follows review of `docs/archive/map-app.md` (the original standalone map planning doc, written before this document's Phase 6 existed). That doc is superseded by this section and by the revised Phase 6 above; kept under `docs/archive/` as a UI/UX reference (popup sizing, tooltip layout, resize behavior) but its architecture section (Nominatim geocoding, generic tile sourcing) is no longer authoritative.

1. **No Nominatim, no geocoding, period.** The map only ever renders coordinates already present on a candidate (`DisambiguationCandidate.geo`, sourced from compiled CHGIS/CBDB packs). A candidate with no coordinates is excluded from the map rather than geocoded as a fallback. This applies uniformly, not just to the common case — simpler to reason about and removes the Nominatim rate-limit/legal question `map-app.md` raised, since it no longer applies.
2. **Tile provider: local MBTiles, downloaded on first map open (revised from the MapTiler decision made earlier the same day).** Initially settled on MapTiler — rejected over Google Maps/Earth (requires a Google Cloud billing account despite a free credit, so it doesn't avoid the "API key" problem either; ToS restricts caching/offline use, awkward for a research tool; sends place-query traffic to Google, worse on data-sovereignty grounds than the Nominatim question it would replace) and over raw OSM raster tiles (`tile.openstreetmap.org`'s usage policy prohibits bulk/redistributed-app use). But since this ships inside a desktop Electron app (`apps/desktop`), the tile-hosting-policy problem doesn't need a keyed provider at all: prompt the user to download a regional MBTiles bundle (street/satellite/relief, capped ~500 MB, covering the historically-relevant East/Central Asia region) on first map open, then serve tiles from a local tile server (e.g. `tileserver-gl`) reading that file. No API key, no ongoing external requests, works offline, no third-party ToS to track. MapTiler is kept as a documented fallback only for areas/zoom levels outside the bundled region.
3. **Phase 6 no longer depends on Phase 5.** It was originally gated on persisted cluster entities in entities.xml. Since the map is a pure visualization layer over data the panel already computes (merged candidates + centroids), it doesn't need entities.xml changes to ship. Phase 5 remains a separate, later piece of work.
4. **Place-candidate merging must be extended to match how persons already merge.** Today `collapseCrossAuthorityCandidates` (`disambiguationCandidates.ts:359-411`) folds person candidates together on shared authority key or matching birth/death years, producing one row with a combined `sources` list — but for places, geo-cluster membership (`clusterByGeoAccessor` in `geoCluster.ts`) only _labels_ rows with a letter; it never merges them. Extending the merge step to also collapse on geo-cluster membership brings places to parity with persons (one row per real-world cluster, not one row per raw authority hit) and is what makes "one pin per cluster centroid" correct instead of "one pin per raw hit."
5. **Group-header icon reuses the existing cluster letter/color convention**, rather than inventing new pin colors or labels — the map and the row badges must read as one visual system, not two.
6. **Component lives in `packages/cwrc-leafwriter`**, alongside `autoTagging/` and `DisambiguationPanel.tsx`, since that's the only workspace currently consuming this code; not worth a new package for one component. Built to take pre-clustered `{candidate, clusterLabel, color}[]` as input (not panel-specific types), so the same component can later serve the document-wide "map of disambiguated places" view described in `docs/archive/map-app.md` §1.1 without a rewrite.
