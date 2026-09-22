# Huckbot5000: independent English glosses for Chinese office titles

**Status (2026-08-06, afternoon):** Feasibility study complete. Production pipeline built
(period-aware targets, CBDB/Norbert concordance, procedural place+suffix + parentOf, dual
Hucker skip, collision + transliteration audit). Ready for full LLM generation (~11.7k calls).
This doc records what the experiments actually showed, including two results that argue against
the original plan, plus the CBDB finding that was more urgent than Huckbot5000 itself. Feeds
Phase 4 of [entity-display-translations-planning.md](entity-display-translations-planning.md).

**For current status, queue sizes, and next actions, see
[huckbot5000-integration-plan.md](huckbot5000-integration-plan.md) — that's the doc to read
first.** This one is the detailed experimental log/evidence behind it. Pipeline mechanics:
[`authoritypacks/huckbot5000/README.md`](../../authoritypacks/huckbot5000/README.md).

**Resume here.** See [Next up](#next-up) at the bottom for the current punch list.

## The question

Chinese office titles in leaf-writer need English glosses. Hucker's _Dictionary of Official
Titles_ is the standard reference, but we can't redistribute his dictionary prose (copyright;
see decision 3 in the entity-display doc). So the project asks a narrower engineering question:
can we generate _independent_ scholarly glosses for offices that still lack a publishable
translation — using learned patterns and review — without copying his wording into packs we
ship? Gap-fill for blanks; collision filter for anything that matches known Hucker text.

## Source data

`~/Code/leJeanBaptiste/authoritypacks/skunkworks/scripts/out/hucker_entries.ndjson` —
9,619 OCR-extracted entries, fields `chinese / dynasty / translation_title / translation_full`.

After filtering to CJK headwords with a real title (dropping `variant of`, `abbreviation of`,
`lit.`, cross-references, etc.): **5,915 usable pairs, 5,424 unique headwords.**

### Data-quality: cleaned (2026-08-06)

Original known problems, root-caused and fixed in `skunkworks/scripts/parse_entries.py` —
**Stage 2 (parsing) only, Stage 1 (PDF→text extraction) untouched**:

- **Dynasty OCR truncation** — 207 `AN`, 65 `ING`, 35 `ANG`, 35 `NG` (mangled T'ANG / CH'ING /
  YÜAN / MING). Root cause: the source PDF's small-caps styling makes OCR misread the
  apostrophe in `T'ANG`/`CH'ING`, or the umlaut in `YÜAN`, as stray punctuation or a wrongly-cased
  accented letter — that breaks `TAG_RE`'s all-caps-run match, which backtracks and captures only
  the tail (`T,ANG:` → `ANG`; `YŭAN:` → `AN`). Fixed with `fix_dynasty_ocr_glyphs()`: four regexes
  anchored to each dynasty's exact consonant skeleton (`\bT..NG\b` etc.), matching any single
  non-ASCII glyph in the vowel slot rather than enumerating every diacritic. **342 → 14 rows**
  (96% reduction); `YUAN` count corrected from 284 to 434 (previously hiding in the `AN` bucket).
- **Row misalignment** (`translation_title` holding a bare dynasty string instead of a real
  translation, e.g. `司天監` → `T'ANG`) — root cause: when a definition spans multiple
  non-contiguous dynasties (`CHOU, N-S DIV (Chou):`), the old `TAG_RE` only matched the _last_
  item in the comma-joined list; earlier dynasty names were left as unparsed leftover text in
  `general_gloss`, which `extract_title()` then mistook for the actual title. Fixed by widening
  `TAG_RE` to capture the whole comma-joined list as one tag (also more correct: the dynasty
  scope is no longer silently dropped). **16 → 3 rows** (81% reduction).

Still open, not regex-fixable:

- **3,222 rows have no parsed `translation_title`** (was 3,197 pre-fix; the two bugs above didn't
  touch this population). This isn't a bug — Hucker's prose for these entries doesn't start with
  a short title-case phrase — so it's a real coverage ceiling on the `translation_title` field,
  not something to chase further with regex.
- **Headword-level OCR corruption** (`广如容漢軍堂`, `炻`, `提辩` for what should be 提點) —
  pure-CJK strings that are simply the _wrong_ hanzi (visually-similar glyph misread), which no
  regex can tell apart from a genuine word. `extract_lines.py`'s existing `MANUAL_CORRECTIONS`
  block already holds itself to the right standard here (only fix what's cross-verified against
  another correctly-OCR'd occurrence of the same character elsewhere in the book) — 15 rows with
  no headword at all, plus an unknown number of wrong-but-plausible-looking ones, are flagged for
  that same manual, cross-checked process rather than guessed at automatically.

Everything downstream (lexicon, benchmark) should be re-run against the cleaned extraction before
any numbers from this doc are treated as final — the Experiment 1–3 numbers above predate this fix.

## Experiment 1 — is the lexicon regular? **Yes, strongly.**

Of 5,424 unique Chinese headwords, only **352 (6.5%) have more than one distinct English
rendering.** Hucker is 93.5% one-to-one. The period-dependence assumed in the entity-display
doc is real but far rarer at whole-title level than the design anticipated.

Mining character n-grams (1–4) against content words in the translations, with
p(gloss | morpheme) and lift over corpus base rate:

| morpheme | gloss         | p           | lift       |
| -------- | ------------- | ----------- | ---------- |
| 博士     | Erudite       | 0.89        | ×137       |
| 鹽       | Salt          | 0.90        | ×135       |
| 左 / 右  | Left / Right  | 0.80 / 0.72 | ×102 / ×94 |
| 御史     | Censor        | 0.68        | ×114       |
| 大夫     | Grand Master  | 0.97        | ×33        |
| 提擧     | Supervisorate | 0.55        | ×113       |
| 局       | Service       | 0.80        | ×27        |
| 郡       | Commandery    | 0.89        | —          |

**617 morphemes** clear support ≥5 / p ≥ 0.30 / lift ≥ 8 (271 at p ≥ 0.6), covering **92% of
held-out titles**. Emitted as `hucker_morpheme_lexicon.json` (scratchpad; not yet in-repo).

This part of the hypothesis holds. The lexicon is real, compact, and extractable.

## Experiment 2 — is it _generatively_ compositional? **No.**

Built the full pipeline: IBM-Model-1 EM alignment → DP segmentation over the phrase table →
head-final reordering with "of"-insertion. Trained on 85%, tested on the held-out 15% (n=819).

| metric                   | result   |
| ------------------------ | -------- |
| exact content-word match | **4.8%** |
| correct head noun        | 20.0%    |
| mean content-word F1     | 0.314    |

Nearest-neighbour analogy (retrieve the most character-similar Hucker entry, reuse its
translation) does no better: F1 0.219, only 23% of items get a usable analogy.

Three distinct failure modes, all structural rather than fixable by more data:

1. **Segmentation ambiguity.** 司天監 is 司天(astronomy) + 監, not 司 + 天 + 監. The generator
   produced "Directorate of Office Astronomy" against gold "Directorate of Astronomy".
2. **Bound ≠ free forms.** 尚書 standing alone is "Minister"; inside 尚書省 the same characters
   are "Department of State Affairs". A headword lexicon cannot express this.
3. **Head-marking is soft, not rule-governed.** Whether Hucker writes "Directorate of X" or
   "X Directorate" correlates with the final character only probabilistically — 寺 takes _of_
   74% of the time, 案 9%, 官 16%. Eight English templates are in play and none dominates
   (Modifier+Head 33%, HEAD of X 26%, bare head 10%).

## Experiment 3 — does retrieval-augmented LLM composition help? **No measurable lift.**

No API key in this environment, so the composition model was Claude itself, in-context.
Two **disjoint** 50-item arms from the same held-out split (disjoint to avoid carry-over
priming), lexicon built from train only:

- **Arm A (control):** bare Chinese title + dynasty, no retrieval.
- **Arm B (treatment):** + mined morpheme lexicon + 6 nearest Hucker exemplars.

| arm                                | exact     | head noun | F1    |
| ---------------------------------- | --------- | --------- | ----- |
| rule-based baseline (n=819)        | 4.8%      | 20.0%     | 0.314 |
| **A — no retrieval** (n=50)        | **28.0%** | 50.0%     | 0.541 |
| **B — +lexicon +exemplars** (n=50) | **28.0%** | 46.0%     | 0.484 |

Exact-match 95% Wilson CI for both arms: 17–42%. The arms are statistically indistinguishable,
and B is _slightly worse_ on F1 and head noun.

Hand-rating every non-exact output for scholarly adequacy (would a sinologist accept this
gloss, even though it isn't Hucker's wording?), excluding items where gold is OCR-corrupt:

| arm | exact | +adequate | = usable        | partial | wrong |
| --- | ----- | --------- | --------------- | ------- | ----- |
| A   | 14    | 24        | **38/48 (79%)** | 4       | 6     |
| B   | 14    | 20        | **34/48 (71%)** | 9       | 5     |

### Why retrieval failed

Retrieval actively misled on several items. The clearest case is 內大 [CH'ING]: the retrieved
exemplar set contained _the identical headword_ glossed "Grand Minister of the Imperial
Household Department", which I copied — gold for this entry is "Grand Minister Assistant
Commander of the Imperial Guard". That is the 6.5% polysemy from Experiment 1, and retrieval
walks straight into it with full confidence. Similarly 春官: exemplar said "Spring Office",
gold for T'ANG is "Ministry of Rites".

Noisy exemplars are worse than no exemplars when the corpus itself is inconsistent and OCR-dirty.

## The result that matters most: pretraining contamination

**Arm A had no retrieval at all and still reproduced 28% of Hucker's translations exactly.**
Including distinctively Huckerian renderings — 郞中令 → "Chamberlain for Attendants" is his
signature construction, not a phrase derivable from the characters.

This is not a good sign for an _originality_ claim. The plan assumed Huckbot5000 output would be
clearly distinct from the dictionary. But Hucker's dictionary is foundational in sinology and is
plainly in the training data of any frontier model. An LLM asked to translate an office title in
a scholarly English register may be **recalling** Hucker's text, not deriving an independent
gloss. That is why publishable output must be checked against known Hucker wording.

This does not sink the project, but it changes what has to be true before publishing gap-fill
output: candidates must be **checked against** the extracted corpus and near-verbatim matches
excluded from publishable packs (or held only in a local collision archive) — the opposite of
the original design, where matching Hucker was the success metric.

### And exact-match is the wrong metric anyway

If the goal is _not_ to redistribute Hucker's dictionary text, then "Wine Workshop" where Hucker
wrote "Imperial Winery", or "Provisioner" where he wrote "Almoner", is a **success**, not an
error — a serviceable scholarly gloss that is demonstrably not his wording. The 79% adequacy
number is the product-relevant one; the 28% exact number is the _redistribution-risk_ one. They
should be optimized in opposite directions.

## Recommendation

Do not build the rule-based generator (4.8% — dead end). Do not build the retrieval-augmented
pipeline as specified in the entity-display doc either; the retrieval arm showed no lift and
introduced polysemy errors.

Proposed shape, in dependency order:

- ~~**Step 1 — Clean the extraction.**~~ **Done (2026-08-06).** See
  [Data-quality: cleaned](#data-quality-cleaned-2026-08-06) above. Two systematic Stage-2 parser
  bugs fixed and validated; residual issues (title coverage ceiling, headword OCR corruption)
  flagged for manual review, not auto-fixed.
- **Step 2 — Ship the morpheme lexicon, not the entries.** 617 morpheme→gloss pairs is a
  derived, compact, factual artifact — a far better position than the 9,619-entry extraction
  currently sitting in skunkworks. Useful on its own for romanization display and autocomplete
  even if no generation ever ships. **Should be re-mined against the cleaned extraction** before
  compiling (the 617-count above predates the OCR fix).
- **Step 3 — Re-run Experiment 3 against a real API** at n≈300 with an actual model rather than
  in-context self-play, on cleaned data. The n=50 CIs (17–42%) are too wide to decide anything.
  This is the go/no-go number.
- **Step 4 — Add a verbatim-collision filter** as a hard gate on _publishable_ output: any
  generated gloss whose content words match a Hucker entry for the same headword is tagged
  `source: 'Hucker'` and kept only in a local collision archive (not redistributed), never as
  `source: 'Huckbot5000'`. This inverts the original success metric and is the concrete
  mitigation for the contamination finding. **Must also check against CBDB's own
  `translation` field** (see [CBDB finding](#cbdb-finding-2026-08-06-bigger-and-more-urgent) below)
  — a generated gloss that collides with CBDB's `(Hucker)`-cited field is treated the same as
  one that matches the OCR corpus.
- **Step 5 — Period variants.** Only 6.5% of headwords are polysemous, so the
  `EntityDates`-ranged translation-variant model (decision 4 in the entity-display doc) is
  sound but low-yield. Worth doing after the above, not before. Note the "whose date?" question
  there is still unanswered and still blocks it.

## Repo & architecture (decided 2026-08-06)

**Lives in `authoritypacks`** (git remote `authoritypacks`), not `leaf-writer` or
`plugins` directly — every other China-specific source (CBDB, DILA, Norbert, CHGIS) is a build
track in that repo, compiled to `packs/*`, published as GitHub release assets, consumed
downstream. Huckbot5000 is another track of the same kind, alongside `packs/norbert/`.

- **`skunkworks/` is already gitignored** — the raw OCR extraction and source PDF never need to
  move; they're already excluded from git in the repo where the build step needs to run.
- **`noble-titles/` is the pattern to copy.** Reviewed-boundary shape: audit script → decision
  table (`accepted`/`deferred`/`rejected`) → compile only accepted rows into
  `approved-include.ndjson` → build reads only that file, never the raw source. Huckbot5000
  should follow the same shape, with the verbatim-collision filter (Step 4) as an automatic
  `rejected` in that same table rather than a separate mechanism.
- **Consumer:** `plugin-norbert` in the `plugins` repo — already references `authoritypacks`
  releases, no new plugin needed.
- **Output schema** is fixed by `entity-display-translations-planning.md` Phase 3: a `roleName`
  entity is string + translation + date range, one entity per period-specific office, matching
  CBDB's own granularity — `packs/cbdb/offices.ndjson` already has this shape (`dynasty`,
  `startYear`, `endYear`, `authorityId`). Huckbot5000's output is a translation keyed to a
  specific `cbdb:office:<id>` / `norbert:office:<id>`, not a bare string.

### CBDB reference-tier-first (decided 2026-08-06)

Agreed architecture: **do not re-package CBDB office translations into our GitHub pack assets.**
Users install CBDB's official database locally; Grognard reads office glosses from that install at
lookup time. Huckbot5000 only generates candidates for offices that still lack a gloss in our
publishable packs (true gaps).

This fits architecture already in place, with one gap to close:

- `cbdb/stripReferenceDb.mjs` already keeps `OFFICE_CODES` and the posting tables in the
  person-reference sqlite (`cbdb-person.sqlite3`), built separately from the tagging-pack NDJSON
  by `build-reference-bundle.mjs` — office translations are already positioned as reference-tier
  data, not tagging-pack data, in the existing two-tier model
  ([authority-data-lifecycle.md](authority-data-lifecycle.md)).
- **Gap (as of morning 2026-08-06):** that reference zip was also mirrored through our own
  GitHub release (`build-reference-bundle.mjs` → GitHub), same as the tagging packs — so we were
  still redistributing CBDB's `translation` field via a different tier. Closing the gap meant
  fetching CBDB's official release on the user's machine (`downloadCbdbDirect`) rather than
  shipping a CBDB person zip from our releases — the same pattern already used for DILA
  reference data. (Done later the same day; see Next up item 2.)
- **Lookup precedence**, once built: `authorityRef:lookup(source, id)` (the existing A6
  mechanism) already implements "prefer reference over pack" for names/nationality/appointments —
  office translations should be one more field on that same path. CBDB reference (user-downloaded)
  takes priority; Huckbot5000 pack (the one this project ships) fills only what CBDB has no
  translation for.

### CBDB finding — CONFIRMED (audit `task_7d697bb9` complete, 2026-08-06)

While locating the office-entity schema, found that `packs/cbdb/offices.ndjson` (33,767 office
entries, compiled from CBDB's own SQL dump) has a `translation` field, and **2,360–2,367 of
those entries end in the literal string "(Hucker)"**. Audit result: **this is
verbatim/near-verbatim copying, and the currently-shipped pack needs remediation.**

- **Source confirmed:** [cbdb/compileRecords.mjs:377](../../authoritypacks/cbdb/compileRecords.mjs:377)
  pipes CBDB's `OFFICE_CODES.c_office_trans` straight through, untransformed. The `(Hucker)`
  suffix is CBDB's own citation marker in their upstream data, not something our compile step adds.
- **Similarity, sampled (n=30, seeded):** 80% verbatim substring match against Hucker's full
  entry text; ~0.95 average Levenshtein similarity where a short title could be compared. This is
  CBDB lifting Hucker's gloss as its canonical English translation, not paraphrasing him.
- **No rights basis found:** CBDB's own sources documentation doesn't list Hucker or Stanford
  University Press as a licensed data source for `OFFICE_CODES`. CBDB's site-wide CC-BY-NC-SA-4.0
  claim covers CBDB's own compiled content — it cannot sublicense a third party's copyrighted
  prose just by tagging it with a citation.
- **Correction to earlier assumption in this doc:** Hucker's _A Dictionary of Official Titles in
  Imperial China_ was published by **Stanford University Press (1985)**, not Michigan. Hucker
  died in 1994; under US copyright (life + 70) the work is protected through **2064** — not
  public domain, not close.
- **Already live:** GitHub release **v0.1.13** (current, consumed by leaf-writer) ships 2,360 of
  these strings under a manifest crediting only CBDB, CC-BY-NC-SA-4.0, no mention of Hucker.

**This is a pre-existing redistribution issue in our published packs, independent of whether
Huckbot5000 ever ships**, and it was already in a live release, not just staged locally.
Recommended remediation (from the audit): omit `metadata.translation` /
`alternateTranslation` / `description` for `(Hucker)`-cited rows in `compileRecords.mjs`
(CBDB's own Chinese/pinyin/dynasty/office-type data is unaffected), then cut a follow-up release.
This is a publish action on an already-public artifact — tracked as its own to-do item below,
not executed inline. Blocks Step 4's matcher either way (need to know what "the untranslated
remainder" excludes once this field is gone).

## Legal note (not advice)

**Decision (2026-09-01): the reviewed gap-fill translations pack ships publicly.**
`packs/huckbot5000/translations.ndjson` (reviewed `approved-include` rows only; every
candidate matching known Hucker wording or a stock Hucker hedge phrase hard-gated out
_before_ review; each row tagged `source: 'Huckbot5000'`, never `'Hucker'`) is treated as
redistributable project output. It has shipped in `authority-packs-chinese` since **v0.1.14**;
its manifest now carries `license: 'internal'` + `policy.redistribute: true` (emitted by
`huckbot5000/compileTranslations.mjs`). Scope of the clearance: this pack only. Unchanged —
`huckbot5000-insiders` (collision archive, `source: 'Hucker'`) stays local-only and out of
every public release, and the morpheme-lexicon manifest (`compile.mjs`) keeps
`internal-pending-review`. The reasoning below is the record of what was weighed.

Daniel is at Collège de France, so the EU _sui generis_ database right (Directive 96/9/EC)
applies and has no US equivalent. It protects substantial extraction from a database
independently of whether the individual contents are copyrightable — a different question from
the copyright analysis in the entity-display doc, which is the one that's been reasoned about
so far. A 617-entry derived morpheme lexicon is a materially better position than the full
9,619-entry extraction. Worth a real opinion before anything ships publicly.

CBDB's terms restricting redistribution of their Hucker-derived field: **confirmed, not just
flagged** — see [CBDB finding](#cbdb-finding--confirmed-audit-task_7d697bb9-complete-2026-08-06)
above. Audit complete.

## Reproducing

Fix location: `authoritypacks/skunkworks/scripts/parse_entries.py`
(`fix_dynasty_ocr_glyphs`, widened `TAG_RE`) — run `python3 parse_entries.py` from
`skunkworks/scripts/` to regenerate `out/hucker_entries.ndjson` against the current PDF
extraction (`extract_lines.py` output, unchanged).

Analysis scripts in the session scratchpad (`mine.py`, `compose.py`, `structure.py`, `gen.py`,
`harness.py`, `score.py`, `lexicon.py`) — throwaway, not productionized, and **all predate the
OCR fix above** (re-run against the regenerated `hucker_entries.ndjson` before trusting their
numbers again). If Step 3 proceeds, `harness.py` (train-only lexicon build, disjoint-arm prompt
generation) and `score.py` (exact / head / F1 + Wilson CI) are the two worth keeping.

## Next up

**Current orientation (2026-08-06 afternoon):** scaffolding is complete; next action is
commit → full LLM generate → audit → review. See
[huckbot5000-integration-plan.md](huckbot5000-integration-plan.md) for queue sizes and
commands. The punch list below is the historical log for the same day (many items now done).

Resumable punch list.

**Tracked, deliberately not done this version (2026-08-06):** cut one combined `authoritypacks`
release superseding v0.1.13 that both (a) ships the Hucker-stripped `offices.ndjson` (item 1)
and (b) supersedes/yanks the three live `authority-reference-person-*.zip` assets on
v0.1.13/v0.1.12/v0.1.10 that still carry the old unfiltered `cbdb-person.sqlite3` (0 downloads
so far). Daniel: "we're not done with this version yet" — do this as one release when ready, not
piecemeal, and not automatically (publish action on shared state).

1. ~~Wait on `task_7d697bb9`~~ / ~~Remediate the CBDB office pack~~ **Code done (2026-08-06).**
   `cbdb/compileRecords.mjs` now strips `translation`/`description` for any row whose upstream
   `c_office_trans` carries the `(Hucker)` citation (surgical — `alternateTranslation` never had
   the tag, and 18,452 of 20,819 non-Hucker translations are untouched). Re-ran `compile:cbdb`;
   verified `(Hucker)` count in `packs/cbdb/offices.ndjson` is 0, translation-field count dropped
   by exactly 2,367. **Still open: cutting the follow-up `authoritypacks` release superseding
   v0.1.13** — that's a publish action on an already-public artifact, needs Daniel's go-ahead,
   not done yet. Minor unrelated side-effect noted: `cbdbOfficeClue` (`shared/clue.mjs`, pre-existing)
   emits a dangling paren when translation is absent but dynasty is present, now visible on
   ~2,367 more rows — flagged, not fixed.
2. ~~Remove CBDB from our repo for office translations; fetch reference data from Harvard
   directly~~ **Done (2026-08-06).** Turned out build-time sourcing was already clean
   (`fetch-upstream.mjs` already pulls CBDB's official HuggingFace release, sha256-pinned) — the
   actual gap was `build-reference-bundle.mjs` repackaging that into our own GitHub release.
   Fixed in `leaf-writer`: new `downloadCbdbDirect()` in `apps/desktop/src/authorityDatabases.ts`
   fetches CBDB's official release directly (same HuggingFace URL/pin) and strips it locally via
   the bundled `authoritypacks` CLI (`cbdb/stripReferenceDb.mjs` — reused as-is, the exact
   script the build pipeline itself runs, not a reimplementation) using the existing
   `resolveAuthorityExtractionRoot`/`runNodeScript` pattern already used for on-device compiling.
   Split out into a new `nodeScriptRunner.ts` module to avoid a circular import with
   `authorityCompile.ts`. Norbert still downloads via the old reference-zip path
   (`downloadNorbertReferenceBundle`, renamed but otherwise unchanged — no redistribution concern
   there, it's our own reduced-authority export, not third-party copyrighted content); CBDB and
   Norbert are no longer treated as one shared download group in `authorityLifecycle.ts`.
   Decision made 2026-08-06: user chose "strip locally in Grognard" over "keep the full 550MB file" —
   full official CBDB sqlite is 550MB vs. the 231MB stripped result; each install downloads the
   full file once, strips it, discards the original. Typecheck clean, existing test suites
   (`authorityDatabases.test.ts`, `authorityLifecycle.test.ts`, 11 tests) pass unmodified.
   **Follow-up now also done (2026-08-06):** `build-reference-bundle.mjs` no longer builds or
   bundles `cbdb-person.sqlite3` at all — rewritten to ship Norbert only, renamed
   `authority-reference-norbert-{version}.zip`. Publishable CBDB tagging packs omit
   `(Hucker)`-cited `OFFICE_CODES` translations via `compileRecords.mjs`. The local install path
   (`stripReferenceDb.mjs` / `downloadCbdbDirect`) keeps CBDB's official office translations as
   published — Grognard displays what the user's CBDB install contains; we do not re-package those
   strings into GitHub pack assets. Deleted two stale local artifacts that predated the pack-side
   omit (`dist/reference/cbdb-person.sqlite3`, `release/authority-reference-person-*.zip`) —
   both gitignored, never committed.
   **Correction (same day, afternoon):** an earlier note said `stripReferenceDb.mjs` also nulled
   `(Hucker)` citations in the local reference sqlite; that was reversed. Local CBDB = official
   content; publishable packs = omit cited third-party prose.
   **Still open, needs a decision:** the _live_ GitHub release assets
   `authority-reference-person-20260627+2026-07-25-reduced-authority.zip` on **v0.1.13, v0.1.12,
   and v0.1.10** still contain the old unfiltered `cbdb-person.sqlite3` (built before today's
   pack-side omit). **0 downloads on all three** as of 2026-08-06, so nothing has actually gone
   out yet, but they're publicly downloadable right now. This is a publish/destructive action on
   shared state (yanking or superseding a release asset) — bundle with item 1's pending release
   cut rather than act on it separately.
3. ~~Re-mine the morpheme lexicon against the cleaned extraction~~ **Done (2026-08-06).**
   `authoritypacks/huckbot5000/compile.mjs` (new, matches the `compile:norbert`/`compile:cbdb`
   convention) → `npm run compile:huckbot5000` → 615 morphemes (272 high-confidence) from 5,894
   source pairs, written to `packs/huckbot5000/lexicon.ndjson` + manifest (gitignored, matching
   other compiled packs; `license: 'internal-pending-review'` — not marked shippable, see Legal note).
4. ~~Re-run Experiment 3 at n≈300 against a real API~~ **Done (2026-08-06) — negative result,
   confirms the composition step isn't ready.** Ran n=300 (150/arm) against **Ministral 8B
   (`ministral-3:latest`) via local Ollama**, same disjoint-arm design as the self-play study.
   Script: `ollama_harness.py` (scratchpad) — real HTTP calls to `localhost:11434/api/generate`,
   ~9s/call, ~35 min total.

   | arm                                     | n   | exact              | head noun       | F1              |
   | --------------------------------------- | --- | ------------------ | --------------- | --------------- |
   | A: no retrieval                         | 150 | 0.7% (CI 0.1–3.7%) | 12.7%           | 0.147           |
   | B: +lexicon+exemplars                   | 150 | 2.7% (CI 1.0–6.7%) | 20.7%           | 0.237           |
   | _cf. Claude self-play A/B (n=50)_       |     | _28.0% / 28.0%_    | _50.0% / 46.0%_ | _0.541 / 0.484_ |
   | _cf. rule-based lexicon lookup (n=819)_ |     | _4.8%_             | _20.0%_         | _0.314_         |

   **Ministral doesn't clear the naive rule-based bar even with retrieval.** Two findings worth
   keeping: (1) **retrieval helps Ministral a lot** (exact match ~4×, head noun ~1.6×) — the
   opposite of Claude, where it gave zero lift — a smaller model leans on structured context
   more because it has less to draw on unprompted. (2) Hand-rated adequacy on a 25-item spread:
   ~44–48% adequate, ~28% partial, ~28% wrong — well below Claude's 79%, with a diagnostic
   failure mode of **false-cognate errors on obscure classical vocabulary** (黨 "ward" →
   "Party Chief"; 水衡 a Han fiscal office → "Waterworks"). Not a scoring artifact — checked
   for truncation/markdown-parsing issues first (none found; asterisks don't affect
   word-tokenized scoring).

   **Conclusion at the time:** don't ship Ministral-generated translations unsupervised. See
   below — the follow-up GPT-4o test changes some of what this implied about Claude's numbers,
   not the Ministral numbers themselves.

   **Follow-up (2026-08-06, same day): real GPT-4o test, n=300, via Daniel's own OpenAI API
   credits.** Script: `openai_harness.py` (scratchpad), same disjoint-arm design, real HTTP calls
   to the Chat Completions API, ~1/s, ~5 min total, cost a few cents.

   | arm                                     | n   | exact           | 95% CI          | head noun       | F1              |
   | --------------------------------------- | --- | --------------- | --------------- | --------------- | --------------- |
   | A: no retrieval                         | 150 | **6.0%**        | 3.2–11.0%       | 16.7%           | 0.237           |
   | B: +lexicon+exemplars                   | 150 | **14.0%**       | 9.3–20.5%       | 30.7%           | 0.386           |
   | _cf. Claude self-play A/B (n=50)_       |     | _28.0% / 28.0%_ | _50.0% / 46.0%_ | _0.541 / 0.484_ |
   | _cf. Ministral 8B A/B (n=300)_          |     | _0.7% / 2.7%_   |                 | _12.7% / 20.7%_ | _0.147 / 0.237_ |
   | _cf. rule-based lexicon lookup (n=819)_ |     | _4.8%_          |                 | _20.0%_         | _0.314_         |

   Two things this changes:

   1. **The Claude self-play numbers (28%) are almost certainly inflated** — real, independently
      run exact match for a comparable frontier model (GPT-4o) is 6.0% with no retrieval. This
      isn't a self-grading artifact (exact/F1/head are mechanical string comparisons, not
      subjective ratings) — more likely, generating _inside a conversation where the model knows
      exactly what's being tested_ behaves differently than a cold, stateless API call. **Treat
      the self-play numbers as unreliable going forward; this GPT-4o result is the better
      reference point.**
   2. **Retrieval genuinely helps real models — the self-play "zero lift" finding doesn't
      replicate.** GPT-4o with retrieval more than doubled exact match (6.0%→14.0%) and lifted F1
      63% (0.237→0.386). Combined with Ministral (where retrieval also helped, ~4×), that's two
      independent real tests agreeing against the one self-play test. Retrieval-augmented
      generation should be the default going forward, not something to reconsider dropping.

   **GPT-4o + retrieval is the first approach tested that actually clears the rule-based floor**
   for real (14.0%/0.386 vs. 4.8%/0.314) — modest, but genuine, and the misses mostly read as
   reasonable paraphrases rather than garbage (職方氏 gold "Overseer of Feudatories" → "Regional
   Operations Official"; 詳斷案 gold "Sentence Evaluators Section" → "Case Evaluator").

   **One contamination flag beyond lexical exact-match:** 脫脫禾孫 came back as _"Meaning and
   derivation not clear"_ — not a translation, but Hucker's own stock hedge phrase for
   etymologically obscure entries (encountered repeatedly while cleaning the OCR extraction
   earlier in this doc). Word-overlap scoring doesn't flag this as a hit since it doesn't match
   the gold gloss, but it's evidence the model can recall Hucker's _editorial voice_, not just
   vocabulary. **The verbatim-collision filter (Step 4) needs to catch stylistic tells like this,
   not just check the final phrase against Hucker's headword gloss.**

   **Revised conclusion:** GPT-4o+retrieval is more promising than any approach tested so far —
   worth pursuing the collision-filter-plus-human-review path over the Ministral-drafter idea.
   6% baseline contamination (no retrieval) is real but lower than the self-play estimate
   suggested, and the filter is buildable; it just needs to check for stylistic patterns
   (hedging phrases, characteristic Hucker constructions) in addition to headword-gloss matches.

5. ~~leaf-writer Phase 3~~ **Done (uncommitted).** Verified directly: `DisambiguationPanel.tsx`
   has `formatCandidatePeriod()`, surfacing startYear/endYear/dynasty as a caption on candidate
   rows during entity tagging — exactly Phase 3's requirement. Correction to earlier text in this
   doc, which wrongly said "not started."
6. **Collision-filter + human-review pipeline — built (2026-08-06).** Five scripts in
   `authoritypacks/huckbot5000/`, mirroring the `noble-titles/` reviewed-boundary pattern:
   `generate.mjs` (GPT-4o + retrieval, production port of `openai_harness.py`, targets CBDB's
   12,704 untranslated office headwords by default, `--sample`/`--limit`/`--dry-run`/`--resume`),
   `audit.mjs` (collision filter → `reports/huckbot5000-candidate-review.csv`),
   `scripts/compile-huckbot5000-include.mjs` (reviewed CSV → `approved-include.ndjson`, hard-gates
   on `collisionFlag` even if a reviewer marks a row accepted), `compileTranslations.mjs`
   (approved-include → shippable `packs/huckbot5000/translations.ndjson`, tagged
   `source: 'Huckbot5000'`). Collision logic (`lib.mjs`'s `detectCollision`) checks exact match,
   ≥85% string similarity, full and subset content-word overlap, and Hucker's own stock hedge
   phrases ("meaning and derivation not clear" etc.) — 13 passing unit tests. Full pipeline
   dry-run tested end-to-end on synthetic data; full repo test suite (221 tests) green. **Not yet
   run against live CBDB targets** — needs a scoping decision (pilot sample vs. full run) before
   spending real API credits on ~12.7k headwords (~3.5hrs at ~1/s). Not committed to git yet.
   Full detail in [[project_huckbot5000_feasibility]].

   **Two things checked independently while that run was pending (2026-08-06, this session,
   no new API spend — reused data already in hand):**
   - **Adequacy re-check, real GPT-4o data, n=76 hand-rated (both arms, stratified sample of the
     n=300 run above):** **~57% adequate, ~24% partial, ~19% wrong** — well below the 79%
     self-play figure this doc cites elsewhere. Recurring failure modes: category errors
     (place↔person — 里 "Community" → "Village Chief"; 寨 "Stockade" → "Fort Commander"),
     modern-Chinese anachronisms (中將 read with its _modern_ sense "Lieutenant General" instead
     of the classical one), punting to transliteration instead of translating (平隼案 →
     "Pingshun Office" — mechanically detectable, worth its own filter check), and the same
     false-cognate trap seen with Ministral (材官挽强 → "Construction Supervisor of Archery").
     **~1-in-5 wrong means the human review step should expect a real rejection rate, not a
     light pass** — worth knowing before scoping the review workflow's time budget.
   - **CBDB-collision-check gap — confirmed real, not just a reasoning gap.** The filter checks
     candidates against the local Hucker OCR corpus by headword. Checked directly against the
     real 550MB CBDB file whether that actually covers CBDB's own 2,381 `(Hucker)`-tagged
     `OFFICE_CODES.c_office_trans` entries: **only 22% overlap.** 1,856 of CBDB's Hucker-tagged
     headwords — mostly longer compound institutional titles (尚書省工部尚書, 戶部憑由司,
     三司都勾院) — aren't in the local OCR corpus at all, so a generated candidate matching one
     of those wouldn't be caught. **Fixed (2026-08-06), before the real run's audit step.**
     `lib.mjs` now has `readCbdbHuckerPairs()`, wired into `audit.mjs`, merged into the collision
     index alongside the OCR corpus; falls back gracefully (warns, doesn't crash) if
     `.upstream/cbdb.sqlite3` isn't present. Verified directly: the 550MB sqlite **is** present
     locally, so this is genuinely active, not just present-in-theory. 14/14 tests passing,
     including a dedicated `readCbdbHuckerPairs` test. **Full 12,704-headword generation run
     launched (~3.5hrs) with this fix in place before `audit.mjs` ever touches the results.**

## CBDB↔Norbert bridge — office date derivation (2026-08-06)

The generation run in progress only targets CBDB office headwords, not Norbert's. Daniel raised
building a bridge between the two, prompted by noticing apparent duplicate offices in CBDB's
pre-Song data (前漢/漢前-style labels). Investigated and built the first real piece.

**Why CBDB's pre-Song offices look duplicated — not an error, two disjoint sources.** All 1,675
CBDB rows tagged dynasty `Pre-Han` trace to exactly one `c_source`: 左言東《先秦職官表》("Table
of Pre-Qin Official Titles," Zuo Yandong, 1994), bulk-imported Feb 2024 and flattened onto
CBDB's single coarsest dynasty code (`Pre-Han`, −1100 to −206) even though the source itself
distinguishes individual Warring-States-era feudal states (Zheng, Qin, Zeng, Cao...) — that
specificity survives only in free-text `c_notes`, not structured metadata (1,037 distinct
title-strings across the 1,675 rows). Generic titles like 伯/大將軍/給事中/公主 also appear in
CBDB's separately-curated main-line office table, which for many of these only starts at Tang —
leaving Han-through-Sui genuinely uncovered by _either_ CBDB source for these specific titles.
Confirmed: Norbert already has 5 of 6 sampled generic titles, and Norbert's own scope (Han/Six
Dynasties) sits right in that gap.

**Considered and rejected: blanket-tagging Norbert offices "Han-Six Dynasties."** Norbert offices
carry zero period metadata today (0/16,804 have `metadata.dynasty`). Before recommending a
blanket tag, checked whether real per-office dates were derivable instead — they were, and the
blanket tag would have been factually wrong for some offices, not just coarse: 侍中 and 御史大夫
are attested in Norbert's own appointment data well past "Six Dynasties" (through Northern Song
and Sui respectively).

**Built instead: `norbert/deriveOfficeDates.mjs`** (`npm run derive:norbert-office-dates`).
Derives real office date ranges from the dynasties of people actually attested holding each
office (`appointments.ndjson` → person → `metadata.nationality[]`), in the same
`metadata.dynasty`/`startYear`/`endYear` shape CBDB's offices already use — so
`officeConcordance.mjs`'s existing `rangesOverlap()` period-filtering, which was previously a
no-op for Norbert offices (always trivially passing since Norbert had no range to check), starts
actually working with zero changes to that script. Offices with a single attested dynasty get a
clean tag; offices attested across several get the honest min/max span plus a
`dynastiesAttested` breakdown (evidence count per dynasty) rather than an invented single label.
Offices with no dated appointment evidence are left untouched — no fabricated dates.

Caught and fixed one real bug before trusting the output: `nationality[]` can hold multiple
entries per person, and the one with usable `startYear`/`endYear` isn't always first (some
entries carry only a label, with dates on a later entry) — was only checking index `[0]`,
recovered via a real test case built from the actual data shape, not a synthetic guess.

**Real run, 2026-08-06:** 1,375 of 16,804 Norbert offices updated (1,109 single-dynasty, 266
multi-dynasty spread) from 3,745 usable dated appointments (2,629 skipped — person had no
dynasty with actual years, a genuine gap in Norbert's own source data, not fixable from this
side). Spot-checked 侍中's derived span (−206 to 1127) against the investigation's manual
finding — matches exactly. Full repo test suite: 230 tests, 229 pass, 1 pre-existing skip, 0
failures, 8/8 new unit tests for the derivation logic itself. Not committed to git yet.

**Not yet done (superseded same day — see below):** this only derives dates — it doesn't yet feed into `concordance:offices` (should
just work once run in sequence, not verified end-to-end with a real concordance re-run), doesn't
extend the Huckbot5000 generation run to Norbert headwords (still CBDB-only, per Daniel's
"we can improve later" call), and doesn't touch the ~15,000 Norbert offices with no appointment
evidence at all (left honestly dateless).

## Integration complete — ready for full LLM run (2026-08-06, afternoon)

Same-day continuation after the killed run. Full detail and current queue:
[huckbot5000-integration-plan.md](huckbot5000-integration-plan.md).

**Built and verified:**

- Period-aware `(headword, dynasty)` target keys (`resolveTargets.mjs`); `--resume` keys on the same.
- Old headword-only candidates archived as `candidates.pre-reconcile.ndjson`.
- `reconcile:norbert-offices` — dates → concordance (Hucker continuity gate for undated) → crosswalks; **178** links.
- Generation skips: Hucker OCR **period** coverage + CBDB `(Hucker)` **headword** coverage
  (those titles are available from the user's CBDB install; Huckbot fills remaining blanks).
- Local CBDB reference sqlite **keeps** official CBDB office translations as published; only
  packs _we_ publish omit `(Hucker)`-cited fields.
- Collision matches go to a local collision archive (`huckbot5000-insiders`), not the
  publishable Huckbot5000 pack.
- Procedural place+suffix (pinyin place stems; reviewed OK) and allowlisted parentOf (`太子`/`公主`/`親王`).
- Transliteration-punt filter in `audit.mjs` (adequacy study failure mode now mechanical).
- Compile-include dedupe fixed to `(zh, dynasty)`.

**Current queue:** ~11,850 targets after skips → ~192 procedural + ~11,658 LLM.  
**Next:** commit pipeline → `npm run generate:huckbot5000 -- --resume` → audit → human review.  
**Still open / not blocking generate:** `authoritypacks` release cut; remaining undated Norbert offices; expanding parentOf beyond the allowlist.

## Norbert procedural first cut — issue #57 (2026-09-20)

Tracked as [grognard#57](https://github.com/grognard-xml/grognard/issues/57). Goal: apply the existing place+suffix and parentOf procedural templates to **Norbert** headwords (not only CBDB), measure leftovers, knock out easy blocks — before any new LLM spend on the ~26k untranslated Norbert offices in the CEDB.

**What changed in the pipeline:**

- `resolveTargets.mjs` gains `includeUndatedNorbert`. Undated Norbert-only offices (~15.4k) enter the queue with `dynasty: null`. Wired as `--include-undated-norbert` on `generate.mjs`; **default on when `--procedural-only`**, off for full LLM runs (so dynasty-unspecified prompts stay out of the API path). Override with `--no-include-undated-norbert`.
- Place+suffix now treats compound suffixes **`縣令`** and **`郡太守`**
  (`豫章縣令` → District Magistrate of Yuzhang; `陳郡太守` → Commandery Governor of Chen).
  Bare `縣令` / `郡太守` still rejected. One-character place stems are allowed
  for both (`上縣令`, `陳郡太守`).
- Same generate pass folds place+suffix glosses into the parentOf remainder index (`mergeProceduralGlossesIntoOfficeIndex`) so chaining can happen in one `--procedural-only` run.
- `npm run report:huckbot5000-leftover` prints leftover ending/category frequencies among Norbert-only targets that still lack a procedural gloss.

**Measured after this cut** (`--procedural-only`, Hucker skips active):

| Bucket                         | Count                                                                              |
| ------------------------------ | ---------------------------------------------------------------------------------- |
| Targets resolved               | 27,312 (10,682 CBDB groups + 16,630 Norbert-only; 15,415 undated Norbert included) |
| place+suffix procedural        | **9,840**                                                                          |
| parentOf procedural            | **1** (太子學士)                                                                   |
| Written to candidates.ndjson   | 9,841 procedural (+ existing LLM rows kept)                                        |
| Norbert-only leftover (report) | **~7,114**                                                                         |

ParentOf stays near floor under Hucker filtering: 53 allowlisted edges → 16 skipped as Hucker/CBDB-Hucker covered → 37 in queue → only 1 has a known remainder gloss. Place+suffix rarely supplies those remainders (右庶子, 太師, …). Do **not** widen the 太子/公主/親王 allowlist in this pass.

### Follow-up: enable X郡太守 + short-stem X縣令 (same day)

They were **blocked by design**, not overlooked:

| Pattern                                         | Why it was rejected                                                              | Fix                                                                           |
| ----------------------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `X郡太守`                                       | Stem ending in 郡 banned (same rule as short `太守`) so `陳郡太守` never matched | Dedicated suffix `郡太守`; stem is the place without 郡 (`陳`)                |
| Short `X縣令` (`上縣令`)                        | `縣令` stem min length was 2                                                     | Min stem length 1 for `縣令` / `郡太守`                                       |
| Place stems with 門/臺 (`三門縣令`, `五臺縣令`) | `INSTITUTIONAL_IN_STEM` treated 門/臺 as non-geographic                          | Skip that filter for compound `縣令` / `郡太守`                               |
| Counties ending in 國 (`安國縣令`)              | Stem-final 國/州/郡 banned even under `縣令`                                     | For `縣令` / `郡太守`, only reject a _doubled_ unit (`…縣縣令` / `…郡郡太守`) |
| `呂縣令` etc.                                   | Romanizer rejected stems with `ü` (ASCII-only check)                             | Allow `ü` in romanization (`呂` → `Lü`)                                       |

**Re-measured after that enablement:**

| Bucket                                  | Count                                           |
| --------------------------------------- | ----------------------------------------------- |
| place+suffix procedural                 | **~11,623** (Norbert leftover report)           |
| Norbert-only leftover                   | **~5,283**                                      |
| Residual `縣令` in leftover top endings | **gone**                                        |
| Residual `太守` in leftover top endings | **gone** (after xx太守 enable + x太守 excision) |

### Follow-up: xx太守 enabled; x太守 excised (same day)

| Change                       | Detail                                                                                                                                                                                                                                                     |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Enable `xx太守` / `xx郡太守` | Skip institutional-char filter for `太守`; allow 州/國 stems (`冀州太守`, `襄國太守`, `雁門太守`, `樂浪太守`)                                                                                                                                              |
| Excise `x太守`               | One CJK char + `太守` (`豐太守` …) — truncated/corrupt. `oneCharTaishouOffice.mjs`; removed from pack (16,788 → 16,772), both SQL dumps, compile filter. CEDB install script: `authoritypacks/.cedb-purge-work-one-char-taishou/INSTALL-INTO-LIVE-CEDB.sh` |
| Not excised                  | Bare `太守`, bare `郡太守`, left/right compounds (`安蠻左太守`), prefix modifiers (`領方太守`), multi-place (`二郡太守`) — still leftovers / LLM                                                                                                           |

**Next easy leftover blocks** (from `report:huckbot5000-leftover`, Norbert-only):

| Block                                          | ~size                        | Path                                                                               |
| ---------------------------------------------- | ---------------------------- | ---------------------------------------------------------------------------------- |
| `將軍` / `參軍` / `長史` / `司馬` / `大夫` / … | ~450+ / ~180 / ~93 / ~70 / … | **Huckbot5000 LLM → review → MaxiRicci7000 FR** — not further procedural templates |
| Rank/fief (`郡公`, `國公`, `侯`, `王`)         | hundreds                     | **Leave alone** until a noble-title translation system exists                      |
| Residual hard `太守` / `郡太守`                | ~45                          | LLM (左郡, 領…, 二郡, rare glyphs) or case-by-case                                 |
| Other leftover                                 | remainder of ~5.3k           | Same LLM queue as above                                                            |

**Still out of scope for #57 close:** inventing noble-title gloss rules; MaxiRicci before Huckbot EN exists for a row; shipping via approved-include / pack bump (candidates only so far). Live app port: `proceduralOfficeGloss.ts` mirrors the place+suffix rules (EN+FR).

**LLM next (when ready):** `OPENAI_API_KEY=… npm run generate:huckbot5000 -- --resume` (or `--sample N` pilot). Undated Norbert is **off** by default for LLM spend — pass `--include-undated-norbert` if that full leftover set should be included. Then audit → review CSV → approved-include → `collect:maxiricci7000` / generate FR batches.

## Dynasty-glued bogus Norbert offices excised (2026-09-20)

Sixteen Norbert office headwords that glued a regime label onto the title
(e.g. `北魏華山太守`, `東魏縣令`, `西涼州刺史`) were incorrect — not real
offices. Removed from:

- `packs/norbert/offices.ndjson` (16,804 → 16,788) and manifest counts
- `norbert_public/norbert-authority.sql` and `norbert_secret/norbert-authority.sql`

Compile now drops any office whose `full_string` matches
`norbert/dynastyGluedOffice.mjs` (`isDynastyGluedOfficeName`), so a recompile
from the dump cannot resurrect them. Procedural place+suffix uses the same
helper.

Older TEI exports under `outputs/norbert/entities.xml` (and
`outputs/import_test_DONE/entities.xml`) still need a local pass if present —
Cursor cannot write that directory from this environment:

```bash
npm run excise:dynasty-glued-offices-entities -- ../outputs/norbert/entities.xml
npm run excise:dynasty-glued-offices-entities -- ../outputs/import_test_DONE/entities.xml
```

List of excised ids/names: `reports/huckbot5000-dynasty-prefixed-offices.csv`
(status `excised-2026-09-20`). Note: titles like `益州東晉壽太守` are **kept** —
`東晉壽` is a place name there, not a leading dynasty prefix.

Remaining open items from earlier in this doc that are _not_ the next coding step: the release cut in item 1.
