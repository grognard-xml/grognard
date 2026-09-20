# Grognard changelog

## 0.0.1–0.0.4-rc.7

- Production and testing of alpha version, distribution chanels, automatic updates, and sibling repos until infrastructure stabilised.

## 0.1.0-beta.1

### Performance and stability

- Established performance baseline on slow Windows test machine
- Virtualised the auto-tagging review list
- App.tsx now keeps Monaco alive after its first Source-mode use, so subsequent Visual ↔ Source switches do not recreate it. Tested, big improvement.
- ui/actions.ts now returns directly to Visual mode when the source buffer is unchanged—skipping both validation and the expensive TinyMCE reload. Tested, big improvement.
- Tree panel work: Tried to improve performance, but with minimal gains. Added a switch to turn off live tracking for older hardware.
- Cut out intentional 1.5-second wait before loading the editor while at once racing with the XML it is trying to load.
- In Windows, command to quit is now carried out with but a slight delay.
- Lazy load panels to keep memory usage down.
- Share desktop schema/document preparation between initial editor setup and the first actual document load.
- Added manifest-driven, range-aware loading for large authority tag packs, with two-century chunks, two-block guard bands, and legacy-pack compatibility.
- Tag-bomb pack reads now bypass the reusable lookup cache, and chunk reads avoid temporary flattened copies. On the slow-machine cutoff test, peak memory fell from about 1.1 GB to 236 MB and the run became visibly faster.
- Cache Norbert wrapper/noble-title expansion across review sessions, invalidate it with authority-pack refreshes, and warm it only after the review pane is idle.
- Norbert review now requires noble titles first and person wrappers second; each stage refreshes against the edited document before ordinary category review is unlocked. Wrapper reconciliation now checks that both sides point to one live PEDB person key and leaves missing, conflicting, or ambiguous cases unresolved.
- Asset and plugin packs no longer overwrite one another for no reason 🤦‍♂️

### Functionality

- Rebuilt Sanmiao date validation panel to work _with_ the script, setting fixed waypoints to calculate around and allowing the user to enter missing date data (needs testing.)
- Disambiguate date filter now falls back to Norbert `dynasties[]` years when `nationality` has labels but no dates — excluding after −78 no longer leaves Northern Zhou / Southern Qi people in as “undated.”
- Disambiguate AI curation defaults off and stays disabled until a verified AI API is configured (same idea as tag-bomb).

### Data

- New items in shared, synchronised project now hydrade an older central database by default rather than insisting that tags be stripped 🤦‍♂️
- Consolidated the database viewer, added note taking.
- Worked out merge conflict mechanics and wiring.
- Added notes to database elements
- Wired fork-merge menu entry
- Bridge conflict “pick a value” UI
- i18n for new sync/dialog strings
- SQLite is now required for live entity indexing, lifecycle checks, and entity counts; XML remains explicit interchange/import-export material
- Avoid full panel reloads on single-field edits
- Finished wordprocessor write paths against SQLite
- Automatically keep ordinary entity-name writes clean: deduplicate same text/type rows, discard literal `nan` placeholders, and remove the malformed `n` + `an` family/given pair. The Clean command still catches older data too.
- Isolated and parsed 3,142 names in authority packs constituting noble titles.
- Rewired database intake process to distinguish between 'display' and 'primary name' and to treat noble titles as distinct from 姓名.
- Ran entity sync test to ensure data integrity under different synchronisation scenarios.
- Compiled full CBDB, Wikidata, VIAF, NDL concordance for authority packs.

### UI

- Monaco now opens with the panels collapsed, cannot scroll down to infinity.
- Made plugin enablement project-specific, filtered the Plugins panel by the project's source
  language, and removed plugin-specific entries from the native Tools menu.
- Removed the tag-boundary undo/redo debug logs.
- Ranked tag-command prefix matches ahead of partial tag-name matches.
- Propagate now matches across visible inline markup, reproduces nested visible tag structure, preserves existing hidden/correction markup, and skips partially pre-tagged occurrences.
- Added a Norbert-branded noble-title action to the selection tag popup when the Norbert plugin is enabled.
- Added a matching Norbert-branded person-wrapper action; filtering for “person” or “wrapper” finds it.
- Database viewer now shows authority badges
- Blocked disambiguation map from zooming outside of tile range
- Cleaned up entities viewer UI a little.
- East Asian date attributes (`LW.dateAuthority`) no longer show raw i18n keys in the attributes panel: synced full strings into commons and package locales, localised the gz helper text, and stopped a hardcoded English Sanmiao error from overriding the translated unavailable message.

### Rewards system

- Lowered bar on two items. Rules should be fixed moving forward.

### Documentation

- Cleaned and provided public-facing documentation, including beta tester guide.

### Patch Changes

[924a08a]

- **Update to Reac 18**
  - Update dependencies

[924a08a]

- Updated dependencies
  - @cwrc/leafwriter@1.2.0
  - @cwrc/leafwriter-storage-service@1.1.0

## 0.1.0-beta.2

### First-run and setup

- Welcome splash now includes a toggle for advanced features (direct XML editing).
- First-run no longer requires choosing an entity-database folder before you can continue: a working default is created deep in app data, and cloud-synced folders are suggested as an optional upgrade. Blank folders are accepted and scaffolded — install must never depend on already having installed, and creating a database must never depend on already having one.
- Simplified the slideshow of loading screens on startup.

### Auto-tagging

- Tag-bomb date filter now follows the same priority as disambiguation: (1) last user choice, (2) active file work year from TEI metadata, (3) no filter. It no longer defaults to the Eastern Han dynasty range.
- Date filters on tag bomb and Disambiguate now cast a slightly wider net than the slider shows: lookup quietly adds 100 years (exclude starts later; limit expands both ends). The UI still shows the nominal cutoff — e.g. exclude-from-500 behaves as 600 under the hood — so near-contemporaries are less likely to vanish now that pack floruit/index years no longer count as birth/death.
- Group & Clean no longer rolls a fief `placeName` into the rank `roleName` inside `<nobleTitle>`; fief and rank stay siblings so ranks do not pollute the offices table.
- Inside `<nobleTitle>`, Disambiguate only queues `placeName`s. Bare ranks auto-resolve (unique PEDB office key, else a Norbert office `ref`); place + role + posthumous can auto-resolve a person when the title maps uniquely. A posthumous name alone does not enter the person queue.
- Chinese projects now treat both Norbert and East Asian dates (`cjk-dates`) as required language plugins: Norbert alone no longer counts as “plugins installed”, so a fresh Chinese project re-prompts / retries until calendars are present too. Enabling also merges the Sanmiao schema contribution (as Japan already did).
- Removed the Disambiguate launcher popup — clicking Disambiguate now starts the review directly (AI curation and caching settings moved to where the rest of the app's settings live, see below).
- Added a small persistent **AI** toggle to the Disambiguate panel itself, between the tag filter and the refresh button, replacing the launcher's one-time checkbox. Persists across sessions (default off); forced on and non-interactive when **Always on** is set in AI API settings.
- New **Always on** option in Settings → AI API: when set, AI curation runs unconditionally wherever it's offered (currently Disambiguate) without a per-run opt-in toggle.
- When **Stream AI results** is off and AI curation is enabled, opening Disambiguate now also warms the AI ranking cache for every pending mention in the background (progress in the bottom bar) — the panel is usable immediately, this just makes navigating mention-to-mention feel instant once it catches up.
- Moved "Disable caching" for disambiguation out of the (now-removed) launcher popup into Settings → Garde-fous.

### Performance and stability

- Serialised boots to avoid a TinyMCE load race that leaves Grognard without an editor pane.

### Editor

- Lock Text no longer undoes autotag apply: removed the IME composition snapshot→`setContent` revert (it raced with `loadDocumentXML` — tags flashed then the pre-apply body came back). Locked typing is still blocked via beforeinput / composition abort without rewriting the document. Also stop re-applying a stale init-time `document.xml` on every `documentLoaded`, always refresh the desktop stored XML snapshot after apply, and treat the tag-bomb `current` path sentinel as the live editor.
- Editor pane now follows the programme's light/dark choice, rather than independently following the OS.
- Fixed: save timestamp was not putting `@version` on `<application>`, causing a validation error in Source mode.
- Monaco now auto-inserts the appropriate closing tag on `</`.
- Fixed entity mentions inserted via the toolbar button landing at the start of the unit instead of at the cursor (including a follow-up where focusing the editor after the entity fetch overwrote the saved caret).
- Lock Text no longer blocks the cursor: it keeps the primary source `contenteditable` instead of pulling it, so caret placement and arrow-key navigation work again while locked. Edits are still blocked via the same input/paste/composition/drop guards TinyMCE's own readonly mode uses; tagging and translation editing are unaffected, as neither relied on `contenteditable=false`.

### Translation panel

- Added LanguageTool spelling and grammar correction.
- Added card flow.
- Fixed buggy footnotes changing place and eating body text.
- Added entity insertion and automatic formatting.
- Translation pane UI overhaul.
- AI translation now blinds tagged entities and Sanmiao dates in the source unit before the model sees them (`{{entity:KEY}}`, `{{date:N}}`, plus Norbert-aware `{{holding:…}}` / `{{as:…}}` for “title held + person appointed as office”). The model is sent only id/kind (and date indices)—never display names—so it cannot expand placeholders into invented wording. After the reply, placeholders become atomic LJBtero entity/date fields.
- Offices with a vernacular gloss default to that gloss alone (no pinyin or characters); other kinds keep their existing recipes. Central-card glosses merge into project entities for display.
- Unkeyed leftover spans (e.g. `<roleName>益州刺史</roleName>`) become `{{opaque:N}}` / `{{as:opaque:N}}`; `nobleTitle` (including nested place/role) is left as plain text for the model to translate until noble titles are wired as entities.
- Adjacent placeholders are spaced (`}} {{`) and double spaces collapsed. Smart-quoted mangled placeholders are repaired before substitute.
- If the model drops required placeholders, the pane resends up to a configurable **Placeholder retry limit** (Settings → AI API, 0–5; default 1). The first attempt always runs; the loop stops early when a retry does not improve the inventory.
- Strips leading temporal prepositions (In/On/…) before date fields and leading office paraphrases (Governor of/…) before entity placeholders when the model adds them anyway.
- Added a toolbar refresh button that re-resolves every LJBtero entity anchor (romanization, characters, translation, dates) against the database and clears cached office glosses, so edits made in the Database Window show up without reopening the pane. Also wired to F5.
- The IME-style autocomplete popup (type to insert an entity anchor) now also suggests Sanmiao date spans from the source unit. Since dates aren't in the entity database, the match keyword is a mechanical, on-the-fly pinyin romanization of the Chinese date text — never stored, purely a typing aid.
- Fixed a save error ("provided markup is invalid XML") that could hit when persisting translation-pane edits — swapped a fragile HTML-string round-trip for a direct DOM import.
- Fixed the translation pane opening blank after leaving the tab (e.g. to edit the entity database) and coming back — re-enter translation mode when the tab is selected again.
- AI translation now splits source `<note>` footnotes out of the main text before translating: each note is stripped to a `{{note:N}}` placeholder, translated independently (its own entities/dates blinded the same way as the main text), and re-inserted as a real `<note place="foot">` footnote — no code changes needed to the existing footnote numbering, it just picks these up like a manually inserted one. A note that fails to translate falls back to its original text rather than failing the whole run.
- **Stream AI results into review as each block finishes** now defaults on.
- New **Translate document** action alongside Generate translation: translates every still-blank unit in the document, one at a time, skipping any unit that already has real text. Progress shows in the bottom bar (same indicator used by background auto-tagging runs), with a cancel button.

### Entity display and data

- Fixed dynasty / floruit / index pack years being imported as if they were birth and death (again). Only `dateSource: 'fine'` biographical years become person vitals; year `0` (CBDB’s unknown sentinel) is rejected; backfill prefers Wikidata/CBDB lifespan over polluted Central/user dates; the sidebar and entity summaries skip year `0`.
- Lookup and backfill now attach Norbert↔CBDB/DILA/Wikidata bridge links from the shipped `norbert/concordance.ndjson` sidecar (and from pack `metadata.crosswalk` when present). This repairs Central entities that were imported with only a NORBERT id, and Lookup no longer skips concordance expansion when adopting a Central hit.
- When a bridge target is already on another Central person with the **same primary name** (typical after importing all of Norbert alongside CBDB/Wikidata), backfill merges the Norbert-only duplicate into that card so badges appear on one entity. Differently-named conflicts are counted in the backfill snackbar for review.
- Card “backfill from authorities” no longer skips the CBDB pack when the A6 reference sqlite is missing: family/given (姓/名) are restored even if they were withdrawn by Central mirror sync, non-fine CBDB birth/death rows (e.g. Southern Qi 479–502 on 陳顯達) are cleared, and the primary lifespan prefers Wikidata then DILA before CBDB so real TEI vitals surface over dynasty-span leftovers.
- Database Window / sidebar bulk backfill no longer tries to ship the full CBDB persons pack (~570MB) into the renderer. It looks up only the linked authority ids in the main process, so select-all no longer hangs forever on “Reading packs…” and then does nothing.
- Long Database Window jobs (backfill, hygiene scan, …) keep running if you switch back to the editor: progress and cancel appear in the bottom bar, same pattern as AI runs and bulk sync.
- Offices are no longer minted with person 姓/名 splits or person-style pinyin (e.g. 平北將軍 → Ping Beijiangjun). The card hides those name types, offers a refresh button, and refresh scrubs leftover family/given rows while repairing the romanization to a concatenated office form.
- Office English/French roleName glosses (CBDB, Huckbot5000, MaxiRicci7000) are written onto entity cards on mint and on refresh. CBDB’s `[Not Yet Translated]` placeholder no longer blocks Huckbot fill, and is never stored as a translation.
- Place+suffix office titles (太守/刺史/令, e.g. 豫章太守 → "Commandery Governor of Yuzhang") that neither pack covers now get a live procedural gloss in-app — same template Huckbot5000 uses offline, applied on tag, disambiguate, lookup, and bulk backfill. French gets a matching naive template (no offline precedent for this pattern yet). Tagged `Huckbot5000 (procedural)` / `MaxiRicci7000 (procedural)` in `entity_translations` so it's distinguishable from pack-sourced glosses; still declines institutional/prefixed/dynasty-glued names rather than inventing a place.
- Attributes panel Lookup is available for `roleName` (office) as well as `placeName`, `orgName`/`org`, and `title` — it no longer depends on the schema mapper recognising the tag.
- Entity display formatting is now kind-aware: places, organisations, offices, and works no longer get the person-only family/given name split. Dates are shown only for people and works (births/deaths and publication dates respectively); places, organisations, and offices never display a dates part.
- Wired up two entity fields that were being silently dropped: generic (non birth/death) existence dates now reach works' entity records instead of being lost, and office classification labels are now surfaced on office entities.
- Added a `work_type` field (book, chapter, poem, painting, object) to entity records, with citation styling to match: books and paintings render in italics, chapters and poems in curly quotes.
- Work entities now default to type `book` (italics) when unset; existing nulls are backfilled on schema migration 7.
- Work-title italics apply only to the romanization: Chinese characters and an English possessive ’s stay upright.
- Work (and other) mentions now append a matching-language translation gloss in parentheses after the Chinese characters, e.g. _Jinshu_ 晉書 (Livre des Jin), from the `entity_translations` table (with a dual-read fallback for legacy `translation` name rows).
- Place (and other) romanizations still lead the display when stored as `translation` + `*-Latn`, and when Latin text was mis-tagged under `zh-Hant`; those rows are no longer mistaken for the parenthetical gloss.
- Romanizations are now stored as name type `romanization` with a `*-Latn` language (schema migration 8 retags legacy `translation`/mis-tagged rows). Vernacular glosses stay `translation`.
- Automatic romanization is kind-aware: persons stay syllable Title Case (`Zhang Heng`); works/orgs/offices concatenate (`Jinshu`); places use a concatenated stem plus a lowercase admin suffix when recognized (`Jiankang jun`).
- Vernacular glosses (fr/en/…) now live in a dedicated `entity_translations` table (schema migration 9), so they no longer pollute name search/autocomplete. The entity editor still shows them as Translation rows; display prefers this table and still accepts legacy `nameType=translation` name rows.
- Vernacular glosses automatically generated upon creation of new entities matching governer/commandant/district chief pattern.
- First-occurrence titles can lead with the vernacular gloss instead of the romanization (`Livre des Jin (Jinshu 晉書)`): per-mention toggle on the entity-display popup, plus a personal per-language default in Translation policy settings. Work italics follow the leading title.
- Missing translations get a dashed “add translation…” nudge in the entity editor (one chip per configured project language) and in the entity-display popup (for the active pane language). Neither inserts placeholder text into the document.
- On those nudge surfaces, “Suggest with AI” can fill the draft gloss for review; the user still saves or adds it. Never auto-writes to the entity store.
- The Database Window's bulk Wikidata refresh now pulls work titles for every language configured in Translation policy settings, not just English plus the desktop UI language. Also fixed: that refresh wasn't passing the desktop UI language at all, so in practice it only ever fetched English titles.
- Office entities can now carry a date range (same date form as works, now offered for offices too), and the auto-tagging disambiguation panel shows each candidate's date range or dynasty when picking between period-specific offices — e.g. distinguishing two entities sharing a title but from different eras. Nothing to render or configure otherwise: which office you tag is which translation you get.
- Offices with a vernacular gloss now default to that gloss alone in the translation pane (no pinyin or characters); the display popup can still re-enable extras. Office gloss lookup falls back between en and fr when one language is missing.
- CBDB (and similar) person dates are no longer lumped together: real floruit earliest/latest (`dateSource: floruit`) is kept as floruit — stored on a `dates` row with precision `fl.`, shown as `fl. A–B` in Disambiguate, entity display, and the sidebar; the person date editor’s `fl.` mode takes a From/To range and writes that row (clearing birth/death so the two do not fight). CBDB index/mean years stay filter-only for the Disambiguate date slider (±30) and are never shown or minted as `fl.`; old pack clues that mislabeled an index year as `fl. YEAR` are scrubbed on load. Pack clue generation restores real floruit and omits index years (recompile packs when convenient for clean NDJSON at source).

### UI and settings

- Fixed a ghost **Delete entity (1)** state in the database panel when jumping to an entity that is not yet linked to the central database: the panel no longer selects the corpus `@key` while browsing central rows (which use different ids), so the delete button no longer lights up with nothing visibly checked.
- Find: active hit now also marks the containing editor line with thick red vertical bars (in addition to orange inline highlight), so matches stay visible when entity/tag highlighting competes on the same row.
- Settings → AI API: **Placeholder retry limit** (0–5, default 1) for AI translation when the model drops required entity/date placeholders.
- Settings panel overhaul.
- Removed legacy popups ('Hey, looks like you're copying... Do you want to learn about copying?').
- Removed legacy help pop-ups.
- F5 now refreshes whichever panel(s) support it — translation pane entity anchors, file explorer tree, and database viewer entities — instead of only being wired one place at a time. File explorer also got a standalone refresh button.
- CSS panel now uses the updated highlighter tab icon instead of the placeholder marker-pen SVG.
- Fixed the Database Window pill reading "Fenêtre base de données" (window base de données) in French — now just "Base de données".
- Fixed the AI API "Connected. Found N model(s)" message (and a few tag-bomb queue messages) rendering literal `{{...}}` template syntax instead of a proper plural — was using an inline ICU plural pattern this app's i18next setup doesn't support; converted to standard singular/plural translation keys.

### Rewards system

- Merit of Persistence (**File saves**) now counts every successful save (`saveCount`), not only distinct file paths — re-saving the same document advances the ladder. Rapid saves are serialised so concurrent Ctrl+S cannot drop counts, and a tag-stats failure no longer skips the achievements pass.
- Ribbon (per-metric class) unlock snackbars now say the classe (e.g. Vème classe, Ordre du Chevron) instead of the overall rank name (e.g. Sergent) — ranks stay for commission; classes are what each ladder awards.
- Medal unlock toasts are held until you save a portrait in Service Record; medals still unlock and persist in the background, and waiting notifications are delivered after the first portrait save.

## 0.1.0-beta.3

### Tooling

- Migrated ESLint 8 → 10 across the monorepo (`.eslintrc.js` → flat `eslint.config.mjs`), which also cleared four of the deprecation warnings `npm install` was printing (`eslint@8`, `@humanwhocodes/config-array`, `@humanwhocodes/object-schema`, `eslint-plugin-markdown`).
- The root lint script (the one CI runs) had excluded `apps/**` and `packages/**` since the config was centralised — CI's `npm run lint` was passing by never looking at any application source. Root lint now actually reaches `scripts/`, `.github/workflows/`, and the other top-level files, and each workspace's own `eslint.config.mjs` now covers its source, including `.tsx`, which no `.eslintrc.js` had ever listed (402 component files had never been linted).
- Ran `eslint --fix` across all five workspaces (178 files): reversed style-only findings — `Array<T>` → `T[]`, `type` → `interface`, `let` → `const`, and 77 stale `eslint-disable` comments that no longer suppressed anything. No behavior change; verified against a captured Prettier baseline and the full test suite before and after.
- Fixed three bugs the newly-enabled linting surfaced:
  - `isEntityType` (`packages/cwrc-leafwriter/src/types/assert.ts`) called the `useTheme()` hook from inside a plain predicate invoked conditionally by two callers — a rules-of-hooks violation that risked "Rendered fewer hooks than expected." Now a pure function taking the theme's entity map as a parameter.
  - `addToRecentDocument` (`apps/commons/src/overmind/storage/actions.tsx`) had `!resource.provider === undefined` instead of `resource.provider === undefined` in its validation guard — a boolean can never equal `undefined`, so a document missing its `provider` was never being rejected.
  - `checkWellFormedness`'s error-position parser (`packages/cwrc-leafwriter/src/utilities/checkWellFormedness.ts`) computed a fallback column with `Number(column[index]?.[1]) ?? 1` — `Number(undefined)` is `NaN`, not `undefined`, so `?? 1` never caught the missing-match case and the fallback silently never applied.
- Continued the `react-hooks/exhaustive-deps` triage across the rest of the monorepo and fixed 5 more real staleness bugs in `cwrc-leafwriter-storage-service`: infinite-scroll pagination that stalled once a user stayed scrolled to the bottom across two loads (`cloud/main/collection/index.tsx`), a sidebar tab selector that didn't react to `owner`/`user` changes (`cloud/sidebar/index.tsx`, and downstream in `mobile-menu.tsx`), and an active-provider indicator that didn't update on provider change (`source-panel/index.tsx`).
- Removed `apps/commons/src/pages/edit/` (`EditPage`/`Editor.tsx`, its `topbar/MainMenu` and `topbar/Meta` subtrees), the `/edit` and `/view` routes, and `EditorModeSelector` — confirmed unreachable: nothing in the app ever navigated to those routes, and `EditorModeSelector` only rendered inside `TopBar`, which only `HomePage` mounts, which always hides it (`page !== 'home'`). `ProjectEditor.tsx` (the `/project` route the desktop app actually uses) is the maintained equivalent.
- Took every workspace's `tsc` from a mix of real and cross-package-noise errors down to genuinely zero real errors:
  - `cwrc-leafwriter-authority-service-custom` had 2012 `tsc` errors from one bad import: `src/index.ts` pulled `AuthorityServiceConfig` from `cwrc-leafwriter`'s types **barrel**, which drags in `Writer`/TinyMCE and needs the `DOM` lib this package's tsconfig doesn't have. Pointed it at the actual `types/authority.ts` file instead, which only depends on `zod`.
  - `authority-pack-lookup.ts` (`cwrc-leafwriter/src/services`) lost a guaranteed-non-empty `row.primaryName` across a reassignment through two gloss-applying functions whose generic signature re-widens the field to optional, even though neither function touches it. Captured the narrowed value once, right after the guard, instead of re-reading `row.primaryName` afterward.
  - `romanize.ts`'s `autoRomanizeForKind`/`romanizeFromAuthorityMetadata` only special-case `'person'`/`'place'`; every other kind already falls through to the same documented default, so the parameter type was needlessly narrower than what callers legitimately pass (`NamedEntityType`, not just the five `RomanizeEntityKind` values). Widened it while keeping autocomplete for the known kinds.
  - `AutoCleanReport` (`cwrc-leafwriter/src/autoTagging/hygiene/autoClean.ts`) is passed straight to i18next's `t()` as the interpolation-values object but had no index signature. Added one — every field was already `number`, so nothing else changed.
  - `ProjectMetadataSaveDeps` (`apps/commons/src/desktop/projectMetadataSave.ts`) hand-declared `reloadTabFromDisk: (...) => Promise<void>` and a loose `notifyViaSnackbar` shape that had drifted from the real functions (`reloadTabFromDisk` genuinely returns a meaningful `boolean`; a proper `NotificationProps` type already existed elsewhere). Pointed both at the real types instead of the stale hand-rolled duplicates.
  - `LeafWriterElectronApi` (`cwrc-leafwriter/src/types/globals.d.ts`) was missing 6 real, implemented, actually-called preload API methods (`listProjectXmlFiles`, `getEncoderName`, `createEntityDatabase`, `createDirectory`, `nativeDialogInvoke`, `onNativeDialogClosed`) — every call site had zero type checking on them. Added them, matching `apps/desktop/src/preload.ts`'s real signatures.
  - `SidebarDatabaseTab.tsx` had two dead comparisons (`type !== 'familyName' && type !== 'givenName'`) that could never be true — that field's real value space only ever has `'family'`/`'given'`; `'familyName'`/`'givenName'` are unrelated field names used elsewhere in the same file for a person model. Removed as no-ops.
  - The remaining 28 `tsc` "errors" reported when checking `cwrc-leafwriter` in isolation are confirmed non-issues: `@src/*` is defined by both `cwrc-leafwriter`'s and `commons`'s tsconfig, pointing at each package's own `src/`, so when `cwrc-leafwriter`'s isolated compile incidentally pulls in a handful of `commons` files (legitimate small cross-package imports), the alias resolves to the wrong package's directory. `cwrc-leafwriter`'s real `build` script is `webpack`, which never runs bare `tsc -p tsconfig.json`, so nothing in the actual pipeline hits this.
- Added `argsIgnorePattern`/`varsIgnorePattern`/`caughtErrorsIgnorePattern: '^_'` to `no-unused-vars` (both the base JS rule and `@typescript-eslint/no-unused-vars`) in `eslint-config-custom` — this codebase's convention for "intentionally unused" (a destructured param kept for documentation, an unused catch binding) is a leading underscore, but the lint config never recognized it, so all 116 such cases across the monorepo were flagged as real unused-variable errors. Real unused vars (non-underscore) are unaffected — confirmed by an unchanged count in the one workspace with none of this pattern.
- Fixed the small, high-signal correctness rules the migration surfaced, several of which were real bugs:
  - `Github.ts`'s `getOrganization` (`cwrc-leafwriter-storage-service/src/providers`) never `await`ed its own API call; `organization.username = organization.login` mutated the still-pending `Promise` object, and that mutation silently vanished when the async function's return value got flattened for the caller. GitHub organizations' `username` field was always `undefined`. Fixed by awaiting and building the result from `response.data`, matching the pattern used everywhere else in the file.
  - `ContextMenu`'s init effect (`cwrc-leafwriter/src/components/contextmenu/index.tsx`) called `initialize()` — an `async` function — without `await`; `if (!initialzed) return` never gated anything, since a `Promise` is always truthy. The context menu could show even when `initialize()` determined there was nothing valid to show it for. Restructured with a cancelable async IIFE inside the effect.
  - `addToRecentDocument`'s cleanup pass (`apps/commons/src/overmind/storage/actions.tsx`) failed completely silently on any error (`catch {}`); now logs via `log.warn`.
  - `openFile` (`apps/commons/src/overmind/project/actions.ts`) had a `try/catch` that only rethrew — dead wrapper, removed.
  - Two rethrows (`textSearchUtils.ts`, `custom-authority-dialog/index.tsx`) dropped the original error's `cause`, losing stack/context for debugging; both now attach `{ cause: error }`.
  - `Entity.ts`'s `setProperty` called `this.hasOwnProperty(...)` directly — a data field literally named `hasOwnProperty` would have shadowed the prototype method and crashed the next call. Switched to `Object.prototype.hasOwnProperty.call(this, ...)`.
  - `SidebarDatabaseTab.tsx`'s async catch-up sync used `new Promise<void>(async (resolve, reject) => {...})` — a synchronous throw before the first `await` (e.g. `onProgress` itself throwing) would have become an unhandled rejection bypassing the outer `catch`. Restructured to a synchronous executor with the async work in an inner IIFE.
- Converted `for (let i = 0; i < arr.length; i++)` to `for...of` in 29 of 30 flagged loops across `cwrc-leafwriter` and `apps/commons` — all were the same shape (index used only to read `arr[i]` once). The 30th (`nobleTitleSpanParser.ts`) was deliberately left as a counting loop: it iterates a string's `.length` purely to push a repeat count, and `for...of` on a string iterates by Unicode code point rather than UTF-16 code unit, so a surrogate-pair character (plausible in this CJK-historical-text tool) would have undercounted and broken the `owner.length === text.length` invariant the function builds. Left with a comment explaining why.
- Converted 321 `@ts-ignore` comments to `@ts-expect-error` across every workspace — not a blind rename, since `@ts-expect-error` errors if the line it suppresses stops having a type error. That immediately exposed 124 unique locations where the original `@ts-ignore` was suppressing nothing at all (stale leftovers from old refactors); deleted those outright instead of converting them. Removing the stale suppressions surfaced two more real bugs:
  - `panels/validation/index.ts`'s error-list builder did `error.target.xpath ?? error.element.xpath`, which crashed with `Cannot read properties of undefined` for any validation error without an `element` (target-only errors, a real case per the type). Fixed with `error.element?.xpath ?? ''`.
  - `cwrc-leafwriter-validator`'s vendored `jsdom-browserified.js` bundle had no type declaration at all; the stale suppression had been masking the gap. Added a `.d.ts` shim reusing `@types/jsdom`'s real `JSDOM` type (already a devDependency).
  - Left `prevent_delete.ts`'s file-level `@ts-nocheck` in place — removing it surfaces ~30 issues (a real but undeclared `editor.writer` runtime augmentation, several genuine null-safety gaps) in delete-key interception logic that's correctness-sensitive, not mechanical. Flagged in the root `readme.md` TODO for its own pass.
- Cleared 56 `no-explicit-any` findings in `cwrc-leafwriter/src/js/schema/mappings/{empty,orlando,tei,teiLite}.ts` for free: these files are literal implementations of the already-defined `SchemaMappingProps`/`EntityMappingProps` interfaces, so TypeScript's contextual typing already knows the real callback signatures (`Element`, `boolean`, `HTMLElement`, `Entity`, `AnnotationsManager`, ...) without any annotation at all — deleting the redundant `: any` made these files strictly more type-checked, not less. The remaining ~342 `no-explicit-any` findings are genuinely dynamic data (a RelaxNG-schema-as-JSON tree, raw GitLab/GitHub API responses, jQuery/DOM interop) that would need real type design per file rather than a mechanical pass — left for a deliberate follow-up rather than rushed.
- Cleared 33 stale `eslint-disable` comments (`(unused-disable directive)` findings) — direct fallout from the `argsIgnorePattern` and `@ts-ignore` sweeps above making the suppressions they carried redundant. Confirmed each was a pure directive-comment line before deleting.
- Fixed 29 of 30 `no-useless-assignment` findings — all the same dead-initializer shape (`let x = default`, unconditionally overwritten in a try/catch, if/else, or switch before ever being read) — by dropping the redundant initial value. Two turned out to be more than style:
  - `tagger.ts`'s `doFind`/`shiftRangeForward`/`shiftRangeBackward` recursion-depth guards ("prevent infinite recursion", `reps > 20`/`reps < 20`) passed `reps++` to the recursive call. Post-increment evaluates to the pre-increment value, and the increment only affects a local about to go out of scope, so the depth counter never actually advanced across recursion levels — the safety cutoffs never fired. Fixed to `reps + 1` in all 3 call sites.
  - `anchor.ts:248`'s `localEnd` isn't a dead initializer at all — it's computed and never used anywhere, while the sibling `createAnchor` function's `rawRange` helper (same file) suggests it was meant to feed into `endOffset` the same way `localStart` feeds `offset`, but that step is missing. Correctness-sensitive (person-wrapper auto-tagging) and unverifiable without live testing, so left as-is and written up in the root `readme.md` TODO rather than guessed at.
- Cleared `no-empty-function` (22) and `no-this-alias` (12) with two targeted `eslint-config-custom` rule options rather than per-instance suppressions, after confirming every remaining instance was a deliberate, consistently-named pattern already used throughout the codebase: `allow: ['arrowFunctions']` for empty callbacks (lazily-assigned `useRef` placeholders, stub fallbacks for unavailable APIs, the `mappings/empty.ts` null-object handlers) and `allowedNames: ['_this', 'self']` for the pre-ES6 `this`-alias idiom, still genuinely needed wherever a jQuery event handler's plain `function` relies on its own `this` (the triggering DOM element) while the callback body also needs the outer class instance. One real dead-code case surfaced in the process: `PublicRepositories` (`cwrc-leafwriter-storage-service`) had a `useEffect(() => {}, [owner])` with no body and no explanation — genuinely inert, removed along with the now-unused `owner` destructure.
- Fixed `no-unsafe-function-type` (13) by replacing the bare `Function` type with real call signatures, mostly by reading what each callback was actually invoked with (`Writer.ts`, `converter.ts`, `message.ts`, `eventManager.ts`, `schemaNavigator.ts`, `utilities.ts`). One of these forced a genuine correctness fix in the process: `Converter.getDocument`'s single loose `Function` callback type had been masking that it's called with a `string` in one branch and a `Document | null` in the other depending on its `asString` argument — `Writer.getDocumentXML` (hardcoded `asString: false`) was consequently typed as if its callback received a string, when it always actually receives a parsed `Document`. Gave `getDocument` proper overloads so each caller gets the precise type for the mode it uses.
- Added `actions/cache` (keyed on the game-assets manifest's sha256) to all four CI jobs that fetch `assets.bin` from R2, and taught `scripts/fetch-game-assets.mjs` to skip the R2 round-trip — and skip requiring the `R2_*` secrets at all — when a cache-restored file already matches the manifest's hash. Previously every one of the 6 matrix-job invocations (`desktop-linux` ×2, `desktop-flatpak`, `desktop-macos`, `desktop-windows` ×2) re-downloaded the same ~63MB+ binary unconditionally. R2 egress is free, so this is purely a wall-clock optimization, and it's cross-run rather than intra-run (parallel jobs within one run can't see each other's not-yet-saved cache entry) — the first run after an asset change still pays for one real download per job, every run after that is a hit until the hash changes again.
- Added a typecheck gate to CI: every workspace now has a `typecheck` script (`tsc --noEmit -p tsconfig.json`), run from the root via `npm run typecheck --workspaces --if-present` in the same job as `lint`. Verified the gate both passes cleanly on the current baseline and actually fails (confirmed exit code + real error surfaced) when a genuine type error is introduced.
- Fixed `cwrc-leafwriter`'s `@src/*` cross-package-alias drift at the root instead of filtering it in CI. `dialogs/settings/project-settings-panel.tsx` imported commons' `ProjectMetadataForm`/`createEmbeddedProjectMetadataIO` by relative path — a published package reaching up into the app — which dragged commons' whole project-metadata subtree, and its `@src/*` alias (which resolves against commons' `src/`, not this package's), into `cwrc-leafwriter`'s isolated `tsc` program. Replaced the direct import with a host-panel registration slot (`dialogs/settings/hostPanels.ts`, mirroring the existing `plugins/pluginExtensions.ts` pattern): commons now registers its `ProjectSettingsPanel` from its own entry point (`registerHostSettingsPanels`, called at module init, with a test guarding that the call isn't accidentally dropped), and the package only renders whatever's registered, never importing the app directly. `globals.d.ts`'s ambient `ProjectMetadataDialogState` type reference — needed for the Electron bridge signature — now points at a new pure-type leaf module (`projectMetadataDialogTypes.ts`, free of runtime imports) instead of `projectMetadataDialogState.ts`'s implementation, so referencing the type no longer pulls the implementation (and its `@src/*` imports) in either. Also closed two real gaps the isolated compile surfaced along the way: `applyMetadataToProjectFiles` didn't guard `window.electronAPI.writeFile` before use (only `listProjectXmlFiles`/`readFile`), and `saveProjectMetadataChanges`'s dirty-tabs warning path called `electronAPI.showNativeMessageBox` without checking it existed. `cwrc-leafwriter`'s isolated `tsc` run is now genuinely 0 errors, not 0-after-filtering — the wrapper script from the typecheck-gate work above was deleted and every workspace's `typecheck` script is the same bare `tsc --noEmit -p tsconfig.json`.
- Removed `prevent_delete.ts`'s file-level `@ts-nocheck` (left in place during the earlier `@ts-ignore`→`@ts-expect-error` sweep as correctness-sensitive delete-key interception logic warranting its own pass). Typed `editor` as `LeafWriterEditor` instead of leaving `editor.writer` unchecked, and closed several genuine null-safety gaps the removal surfaced: `previousElementSibling`/`nextElementSibling` used on a `commonAncestorContainer` narrowed to `Element | CharacterData` (neither exists on generic `Node`); a missing guard for `parentElement` being `null` even when `parentNode` isn't (the non-`Element`-parent case, e.g. after `removeStructureTag` normalizes text); and a `.length` access on a text container narrowed to `Text` only after confirming `nodeType === Node.TEXT_NODE`. Verified clean via `tsc`, `eslint`, `prettier`, and the full test suite (unchanged pass count), then live-tested in the running desktop app against a real tagged document: deleting a tag's full text content is safely absorbed without corrupting the document or crashing, partial in-tag deletion behaves normally, and deleting a tag's last remaining character cleanly removes the now-empty structure tag. No regressions observed.

### Entity display and data

- Dynasty spans can no longer become a person's birth and death dates, from any authority. Nationality-derived years remain what they always were — useful anchors for the Disambiguate date filter — but they are never stored as vitals, never shown as a lifespan on the disambiguation panel, and never minted. The guards that enforce this all key on `metadata.dateSource`, which the Norbert person pack set on none of its 16,050 rows, so every one of them failed open. `filterYearsFromMetadata` now reports `derivedFromDynasty` when the years it returns were computed from a dynasty/nationality span rather than read from the record, and the candidate builder, the mint path, and the backfill cleanup all consult that instead of trusting a label that may be absent. Fixed at source too (see the authority-extraction changelog): Norbert person compile now emits `dateSource: 'nationality'`, so a rebuilt pack is labelled correctly and an unlabelled older pack is still handled. Regression cases are written per source — Norbert unlabelled, CBDB/DILA labelled — rather than only for the one that happened to fail.
- Authority backfill now clears birth/death rows that earlier mints wrote from `index`, `nationality`, or dynasty-derived years, not only the ones a real floruit supersedes. In the test corpus this took Norbert-sourced authority vitals from 10,676 rows / 5,342 entities down to zero on every live person; the rows that remain sit on soft-deleted entities, which the backfill target set excludes by design and which never display. Every distinct year pair cleared was a dynasty span (先秦 −5999/−220, 唐 618–907, 東晉, 西晉, 東漢, 三國, 南齊, 劉宋, 北魏, 梁, 吳, 北周, 北齊) — Norbert's `person` table has no year columns at all, so a Norbert-sourced lifespan is bogus by construction.
- Note when running the headless `apps/desktop/scripts/backfill-entity-sqlite.ts`: pass `--packs` explicitly. It defaults to `~/Library/Application Support/Grognard/authority-assets`, which is the _installed_ pack and can lag the project's own `authority-packs/` — in the test corpus the two diverged (16,050 vs 16,570 rows) and the stale copy resolved only 39 of 250 authority ids. An id the pack cannot resolve yields no enrichment, so the entity is skipped silently and keeps whatever it already had; "the pack does not have this record" currently looks identical to "the pack says nothing is wrong."

## 0.1.0-beta.4

### Tooling

- Fixed two CI breaks on `main`. The typecheck gate failed on one error: `useProjectMenu`'s `kanripo://` deep-link handler passes `initialKrId`/`initialImportScope`/`initialJuan` to `openDialog`, but only the package-side `KanripoImportDialogProps` (`packages/cwrc-leafwriter`) declared them — commons' own `DialogProps`, which is what actually types `openDialog`'s argument, never got the matching interface, so the props the handler had always been sending were unknown to the compiler. Added `KanripoImportDialogProps` to `apps/commons/src/dialogs/type.ts` mirroring the existing `ChineseAssetsDialogProps` pattern. The format-check step was failing separately on 17 files from the Wikisource/Kanripo/Daozang import work; ran the repo's own `prettier . --write`.
- Root-caused `PlaceComparisonMap.test.tsx`, which had been failing as a whole suite in roughly 45% of full runs while passing every time on its own. `jest.config.ts` maps `^maplibre-gl$` to `test/mocks/maplibreGl.ts` (the real package is ESM-only and jest's CJS resolver can't reach it), but the test registered its own instrumented mock with `{ virtual: true }` — and a virtual mock is keyed by the raw request string, bypassing that `moduleNameMapper` resolution. The component's mapped import could therefore bind to the silent stub instead of the test's factory, with which one won depending on module-registry state, so it only misbehaved inside a large run. The stub's `MapLibreMap` constructs perfectly and records nothing, so the symptom was every spy in the test sitting untouched with no error, no warning and nothing pending anywhere — which is why waiting longer could never have fixed it. Dropping `{ virtual: true }` mocks the mapped module and always wins: 12/12 clean Core runs. The stub's own doc comment asserted the assumption that fails here ("an explicit factory takes precedence over this mapping" — true for a normal `jest.mock`, not a virtual one); corrected in place.
- While chasing the above, fixed three assertions in the same suite that were passing vacuously: `expect(mockSetStyle).not.toHaveBeenCalled()` and two `queryByText(...)` null checks ran before the effect's tile-status promise chain had resolved, so they were satisfied by nothing having happened yet rather than by the behaviour under test. Each now waits for that chain's positive outcome first.

### Kanripo import and gaiji

- Added a self-contained Kanripo import plugin (`plugin-kanripo-import`) that no longer depends on a sibling `normalization_zh` checkout on the machine. Mandoku → TEI conversion, DPM variant normalization, and commentary validation all run from vendored Python inside the plugin; the host only sets `GROGNARD_PLUGIN_INSTALL_PATH` when invoking the bridge.
- Bundled Kanripo gaiji data from [kanripo/KR-Gaiji](https://github.com/kanripo/KR-Gaiji): `charlist.org.txt` plus ~5,200 PNGs under `data/gaiji/`, with `npm run download:gaiji` to refresh them. Import resolves `&KRnnnn;` to Unicode or IDS where the charlist allows, and otherwise emits TEI `<g type="kanripo">` / `<graphic url="_gaiji/…">` markup, copying referenced PNGs into `<project>/imported/kanripo/<KR_ID>/_gaiji/`.
- Editor inline display for imported gaiji: document-relative `_gaiji/…` URLs resolve through the open file path to `grognard://local/…`, graphics sized in `em` to sit flush with surrounding text, and CSS for `.lw-kanripo-gaiji` in the visual editor. Graphics refresh when a document loads or re-imports.
- Paste an image from the clipboard (with no accompanying plain text) into an on-disk TEI file to insert a Kanripo-style gaiji: the PNG is saved beside the document in `_gaiji/`, and a `<g type="kanripo">` wrapper is inserted at the caret. Right-click a gaiji graphic to change its height in `em` or replace its PNG.
- Bulk Kanripo import now reloads any already-open tabs for written juan files from disk, not only when a single juan was imported.
- Fixed CI typecheck failures in `utitlities.ts` (correct `fetchResource` import path; `HTMLImageElement` typing for image load callbacks). Added `writeBinaryFile` to the Electron bridge for saving pasted or replaced gaiji PNGs.
- TEI schema merge (v12) now allows `<graphic>` inside `<g type="kanripo">` for Kanripo gaiji (fixes duplicate `@n` in RelaxNG that broke schema compilation in v11), and moves imported Kanripo `<idno>` from `titleStmt` into `sourceDesc/bibl` where TEI permits it. Fixed gaiji height changes in the context menu (inline styles were not clearing on update).
- TEI schema merge (v13) fixes duplicate `@type` on Kanripo `<g type="kanripo">` (v12 still failed RelaxNG compile).
- TEI schema merge (v14) detects and regenerates broken Kanripo `<g>` overrides even when the version marker already matched; File-menu import actions now work during project load, not only after the editor finishes mounting. Fixed Daozang import dialog not opening (commons `useDialog` was missing the `daozangImport` route).
- **Parallel punctuation — tape mode (Wikisource, paste, file):** improved Han overlap for variant-heavy texts; per-character opcode alignment from parallel tape onto the Kanripo body (fixes misplaced punctuation); paragraph reflow inside matched zones — merges spurious Kanripo line `<p>` wraps, splits at `。`/`！`/`？` and blank lines, and skips splits inside `<note type="comm">`; relocates commentary notes stranded at paragraph starts back onto the preceding sentence. Verified on 荀子/勸學篇 (`KR3a0002`).
- **Parallel punctuation — segmented mode (ctext wiki):** `fetch-ctext-parallel.mjs` pulls punctuated ctext wiki chapters; segmented mode merges split commentary notes then matches basetext and `<note type="comm">` separately (李善-style inline commentary). Tape mode remains default for Wikisource and plain sources.
- **Wikisource fetch:** work-index URLs now prefer **chapter pages** (e.g. `荀子/勸學篇`, punctuated) over scanned 四庫全書本 **卷** pages (often unpunctuated); falls back to 卷 listing when no chapter pages exist. Import wizard placeholders and help text updated for chapter-based URLs.
- Headless batch tools: `npm run test:parallel-batch` (coverage + well-formed XML per juan) and `npm run test:wikisource` (MediaWiki fetch unit tests). See `plugin-kanripo-import` README for CLI workflows.
- **Kanripo ↔ Daozang concordance** bundled under `data/concordance/`: … Bridge op `concordance_lookup`.
- **Kanripo import:** when parallel punctuation is selected and the Daozang plugin is enabled, a concordance hit auto-loads the matching bundled 方瞳子 `.txt` as a parallel source (tape mode). New IPC `daozang:readText`; helper `kanripoDaozangParallel.ts`.
- **Kanripo import quality warnings:** after parallel import, per-juan warnings for low overlap, no alignment, high overlap with few punctuation marks copied, and Daozang-specific mismatch (`assess_parallel_quality` in `parallel_punct.py`).
- **Kanripo AI punctuation (v3):** model returns plain punctuated text per segment; scoped fuzzy align + parallel tape transfer (`apply_ai_parallel_segments`); auto paragraph reflow with Kanripo line-length heuristic; prompt `ai-punct-v3`. Import wizard and Tools → AI punctuate use the v3 path; editor selection scoping and bottom-bar progress indicator.
- **Kanripo scoped purge:** purge by Han index range (`han_start`/`han_end`) when a selection is active — AI re-punctuate and Purge punctuation remove marks only in the selected stretch, not whole segments.

### Daozang import

- Added a Daozang import plugin (`plugin-daozang-import`) with a bundled **方瞳子** punctuated UTF-8 corpus (~1,513 texts, ~77 MB): local search index, **File → Import from Daozang…**, and optional install/replace from a local RAR or extracted `道藏_txt` folder.
- Fixed bundled-corpus import when `.txt` files are still GB-family encoded (the converter now decodes legacy bytes the same way as RAR install).
- Daozang search index ids are now unique for Chinese filenames (fixes duplicate React list keys in the import dialog).
- Kanripo import ships a **bundled concordance** to those files (`kanripo_daozang_map.json` in `plugin-kanripo-import`). Import wizard auto-loads a matched Daozang parallel when both plugins are enabled and parallel punctuation is selected.

### Wikisource import

- Built-in **File → Import from Wikisource…** (not a language plugin): inspect a URL, choose among edition trees when more than one exists, fetch wikitext via the MediaWiki API, map zh templates (`header`, `pb`, `〈…〉` notes) to TEI, and write one file per chapter/juan under `imported/wikisource/{workTitle}/`. Wikidata sitelink metadata (Q-id, P50 authors, P4517 Ctext) fills the header; Wikisource `{{header}}` credit is kept as a note.
- Brave/Chromium unpacked extension (`apps/browser-extension`) sends a small native-messaging order; Grognard must be running with a project open. See `docs/wikisource-import.md`.
- Kanripo parallel punctuation now loads the shared Wikisource fetch module from the desktop app (plugin `scripts/wikisource-parallel.mjs` re-exports it).
- Fixed imports from 四庫全書本 and similar zh pages that opened with “not well-formed XML”: strip HTML comments and wrapper tags (`onlyinclude`, `poem`), XML-escape angle brackets in plain text (e.g. `<子部,…>` catalog lines), map `{{SK notes|…}}` to `<note type="comm">`, and validate the wrapped TEI before writing the file.

### Import metadata and authority wiring

- Kanripo, Daozang, and Wikisource TEI headers now put work identifiers in `sourceDesc/biblStruct/monogr` (schema-valid) instead of bare `<idno>` elements directly in `sourceDesc`.
- Work `<title>` and `<author>` elements now carry Wikidata `ref="https://www.wikidata.org/entity/Q…"` when a Q-id is known, so the metadata panel can link authorities instead of showing orphan `n="Q…"` or internal database ids.
- Daozang authors can be enriched with Wikidata, CBDB, and Norbert ids from the SKQS author concordance (when the Kanripo plugin data is installed).
- Kanripo headers now record edition profile, imprint date, and source locator when the catalog provides them; `extent` and work dates sit in `fileDesc`/`profileDesc` where TEI expects them.
- Browser extension on [kanripo.org](https://www.kanripo.org): a URL hash (`#KR…` / `#KR…_NNN`) opens **Import from Kanripo** with the work pre-selected and single-juan vs full-work scope inferred.
- Norbert and Kanripo menu icons for the plugin UI; corpus-work browser rows in the import dialogs.
- Metadata panel reads legacy `author @n="1421"` on older imports as `NORBERT:person-1421`.

### Rewards system

- The first-run portrait picker's head preview now shows a tight, neck-free close-up instead of a small head adrift in mostly-empty space with a neck it didn't need — added a `closeUp` mode to the avatar compositor (`avatarAssets.ts`) that strips the base SVG's `id="neck"` rect and swaps to the unpadded content canvas. The Service Record header and printed certificate, which both need the neck and the overflow-safe padding to line up with the uniform collar, are unaffected — they don't pass `closeUp` and keep the original framing.
- Fixed a race in `AchievementsDialog`'s portrait refresh that could composite a lower-rank weapon into a higher-rank Service Record scene (e.g. a rank-1 rifle showing up in a rank-5 portrait). Every refresh both re-rolls pose/weapon/background off a fast local state read and kicks off a background GitHub-contributions check that can, on its own, cross one or more rank thresholds; if that check resolved after the local pick had already committed, the render used the fresh (higher) rank for the uniform and background but the stale (lower) rank's weapon, since the two are toggled independently in the body compositor. The portrait now tracks which rank its current pose/weapon were rolled for and re-rolls them whenever the GitHub-refresh branch resolves with a different rank.
- Rank 5+ backdrops now actually pair with modern-era weapons. The rule had been written but never took effect: the backdrop key was computed inside a `setBackgroundKey` updater and read on the very next line, and React doesn't run an updater until the following render — so the key was still `null` when the weapon pick needed its rank, `requireRank` came out `undefined` on every single portrait, and the weapon pool was never restricted at all. Pose, backdrop and weapon are now resolved synchronously in `pickPortraitFor`, with the "don't repeat the last one" values tracked in refs instead of read back through updaters.
- Even once that was passing the floor through, it was the backdrop's own rank — and backdrops run to Rank 7 while weapon art stops at tier 5. A tier-6 floor empties `pickWeapon`'s pool, which then silently falls back to the _unrestricted_ one, which is how a Rank 6 desert backdrop ended up holding a flintlock. The rule now lives in one named function (`weaponFloorForBackground`) clamped to `MODERN_ERA_RANK`, so backdrop ranks 5, 6 and 7 all share tier-5 weapons. Earlier-rank backdrops stay unrestricted on purpose: at Rank 6 the pick is 80% current-world / 20% historical, and an officer drawing a Napoleonic scene should still be holding a Napoleonic weapon. A guard test fails the moment tier-6 weapon art is added, as a reminder to raise the constant.

## 0.1.0-beta.5

### CBETA import

- Wired end-to-end **CBETA import** (File → Import from CBETA…): host UI, `cbetaImportXml.ts` TEI wrapper, CBETA P5 schema bundle (`cbeta_p5.rng` / `.sch` + `cbeta.css`), and project bootstrap for CBETA-family targets. Requires the `cbeta-import` plugin from the [plugins](https://github.com/grognard-xml/plugins) repo (Tools → Plugins).
- CBETA import dialog: fixed 720×700 layout (no resize while searching), **Split by section (mulu)** default for TEI-ALL projects (juan for CBETA-schema), plus **Clean import** and **Strip Taishō line breaks** checkboxes. Cross-family import now consumes nested `cb:mulu` into `<head>` (fixes TEI-ALL validation) and maps invalid `@place` on `<p>` to `@rend`. Dialog compacted: split-by dropdown, merged clean-import label, progress while importing/syncing.
- Plugin-side mulu split fixes: omit the split-marker `cb:mulu` from slice bodies (no duplicate `<head>` with the host's section wrapper), fold content-less headings into the next slice, and strip redundant leading `<head>` when it repeats the slice title.

### BDRC import

- Wired **BDRC import** (File → Import from BDRC… and browser extension): host UI, `bdrcImportXml.ts`, and plugin bridge. Requires the `bdrc-import` plugin from the [plugins](https://github.com/grognard-xml/plugins) repo.

### Browser extension (corpus import)

- **Chrome / Brave / Edge / Firefox** extension for one-click import from Wikisource, Kanripo, and BDRC. Native-messaging host registration on **macOS, Linux, and Windows** (registry + batch launcher on Windows; Firefox gecko id supported).
- Release zips (`grognard-browser-extension-chromium-*`, `grognard-browser-extension-firefox-*`) built by `npm run package:browser-extension` and attached to the same GitHub release as the desktop installers. Step-by-step install instructions in [readme.md](readme.md#browser-extension-corpus-import).

### Import metadata and source description

- Expanded `sourceDescription` for the metadata panel: structured work title, authors with `ref`/`key`, work dates (`when` / `notBefore`–`notAfter`), edition, edition-year ranges, and transcription source; legacy `sourceDesc/p` free text migrates on apply.
- Import headers (Kanripo, Daozang, Wikisource, BDRC, CBETA) aligned with the same `sourceDesc/biblStruct` patterns; CBETA canon labels via `cbetaCanons.ts`.

### Project and UI

- **Recent projects** menu (File → Recent Projects), capped at 10 entries with LRU eviction and cleanup of missing paths on failed open.
- **Date ranges for edition year** in the metadata panel (edition `imprint/date` with `notBefore`/`notAfter`).
- Created `<ab>` for Tibetan texts without paragraphs as the basic unit of translation. It is still unclear how this should be articulated with paragraphs.

### Fixed

- The translation tab only loaded configured languages when a project was first opened, so saving English (or any target language) in Project settings left the Translation panel showing “no languages configured” until the project was closed and reopened. It now listens for the `grognard-project-config-saved` event and reloads `schema/translation-settings.json` immediately after a successful save.
- Project settings had no guard against navigating away with unsaved edits — easy to miss because Save is separate from Add. The form now tracks a dirty snapshot and warns before leaving the Project tab, closing the settings dialog, or cancelling the native project-settings window.
- Project settings save path fixed so schema and translation configuration persist reliably across sessions.

## 0.1.0-beta.6

### Fixed

- **Entity database boot order on a new machine** — the app created the database _folder_ early but not `entities.sqlite`, so cross-device sync, cloud backup, and the database viewer all failed until a project was opened. The main process now scaffolds the default central database at startup; sync and backup resolve the live file before running.
- **Central database viewer without a project** — browsing your personal (central) entity database no longer requires an open project.
- **After R2 restore** — restored data appears in the database viewer immediately (main notifies renderers; no restart required for the viewer).
- **R2 backup includes achievements** — each entity snapshot now uploads a paired `achievements-…json.gz` sidecar when `achievements.json` exists locally; restore swaps both in (older snapshots without a sidecar still restore the database only).
- **Sync / backup settings** — clearer messages when sync is skipped (`no-database`, `disabled`, etc.); “Sync now” requires automatic sync to be enabled and saved.
- **AI API “Always on”** (`Settings → AI API → Toujours actif`) only updated local form state and was not written to disk until **Establish connection** — unchecking it snapped back to checked on return, and Disambiguate kept the per-run AI toggle disabled. The checkbox now persists immediately via `setAiApiSettings`; `projectPrefs.setAiApiSettings` merges partial updates instead of replacing the whole record.
- **Disambiguate with AI curation** blocked the candidate list until the LLM pass finished. Authority candidates now appear as soon as lookup completes (including instant replay from the per-surface pending cache); AI ranking runs in the background and updates selections/rationales when done, with cached AI ranks applied without a spinner.

## 0.1.0-beta.8

### Entity database cloud backup

- **Cloud backup** (Settings → Profil → Cloud backup): the entity database is snapshotted to a private Cloudflare R2 bucket on a timer and once more on quit — a consistent, gzipped, integrity-checked copy each time (`VACUUM INTO` over a read-only connection, safe while the app holds the file open). Snapshots are pruned on a keep-recent + keep-daily schedule. Restore downloads the newest (or a chosen) snapshot, verifies its checksum and integrity, moves the current database aside, and swaps it in. Credentials are held encrypted via Electron `safeStorage`; a startup integrity check surfaces a corrupt database. Setup: [docs/entity-db-cloud-backup-setup.md](docs/entity-db-cloud-backup-setup.md).
- Keep the live `entities.sqlite` on a local disk, not in a synced folder — file-sync clients race SQLite's `-wal`/`-shm` and corrupt it. The backup (and cross-device sync, below) are the durable answer to moving data between machines.

### Cross-device entity sync

- **Cross-device sync** (Settings → Profil → Cross-device sync): the entity database can stay in step across machines through a Cloudflare Worker over D1 (`workers/entity-sync/`). Server-authoritative per-entity revisions; the client tracks a dirty set, pulls changes past a cursor, applies the clean ones, and queues genuine conflicts — populating `sync_state` / `sync_conflicts`, which the schema had reserved from the start. Auto-sync runs on launch and on a timer, single-flight, with a per-request timeout and a run watchdog so a stalled network cannot wedge it. First full sync of the ~57k-entity authority file verified end-to-end.
- **Inline conflict resolution** in the sync panel: per entity, Keep mine / Keep theirs with both TEI snapshots shown. Keeping local re-pushes against the server's revision; keeping remote applies the server snapshot.
- The sync **wire contract is a versioned spec** ([docs/entity-sync-protocol.md](docs/entity-sync-protocol.md)) with an implementation-independent conformance suite, so the server is not tied to Cloudflare — a Node/Postgres service on other infrastructure can implement the same contract.
- **Pluggable authentication** for sync: GitHub (default, reuses the leaderboard sign-in) or a pasted bearer token (encrypted at rest). An OpenID Connect device flow is stubbed for a future non-Cloudflare / huma-num server.
- **Free-tier write limits.** A first full sync of a large authority file exceeds D1's free plan (100k row-writes/day, and each stored entity costs ~2 index rows). Handled three ways: (1) the Worker returns `429 { quota: true }` when D1 refuses a write for quota, and the client stops the push cleanly — keeping whatever landed, holding the rest as still-dirty, and skipping automatic runs for ~1 h (a manual **Sync now** still tries); (2) migration `0003` rebuilds `central_entities` `WITHOUT ROWID`, one fewer index write per row; (3) `apps/desktop/scripts/generate-entity-sync-seed.mjs` emits `seed-NNN.sql` from a local `entities.sqlite` to bulk-import into D1 with `wrangler d1 import --file` (spread over days if needed), after which **Sync now** reconciles every row locally with no further writes.
- **Pull fast-path.** When a pulled change's content hash already matches the local entity, the client records the mapping and skips the import/replace round-trip — makes the post-seed adoption cheap and speeds every routine drain-pull.

### Functionality

- **Apply source profile to folder** — File metadata → Source profile now has an **Apply to folder** button next to **Apply**, stamping the selected profile onto every TEI file in the same folder (each file keeps its own transcription source note). Warns when open files in that folder have unsaved edits.

### Schema

- **`<dynasty>` inside `<nobleTitle>`.** The merged TEI grammar now permits a `<dynasty>` child in `<nobleTitle>`, alongside `<placeName>`, `<roleName>` and `<persName>`. `dynasty` is not a TEI element, so it is defined as an Grognard extension (`grognard.dynasty`, text plus `model.global`) in the same place as `nobleTitle` and `personWrapper`. `SANMIAO_MERGE_VERSION` is bumped to 15, so projects carrying an older generated wrapper regenerate it on open.
- **`<nobleTitle>` accepts the attributes the tagger writes.** `nobleTitle` is an Grognard element too — TEI defines no such element — so it carried no attribute declarations at all, while auto-tagging writes `@dynasty`, `@ref`, `@resp`, `@source` and `@when` onto it. Every auto-tagged noble title carrying one of those failed validation. The define now pulls in `att.global.attributes` (`@resp`, `@source`), `att.personal.attributes` (`@ref`, `@key`) and `att.datable.attributes` (`@when`), and declares `@dynasty` itself; unknown attributes are still rejected. `<dynasty>` gets `att.global.attributes` for the same reason.

### Fixed

- **File metadata authority links** — linking a book title (or author) to an authority in the File metadata panel did not stay visibly linked the way KRP, CBETA, and BDRC imports do. The panel re-read the XML on every editor buffer update and wiped in-progress `ref`/`key` state before the debounced save; `EntityLookupField` also omitted the minted entity `key` after linking. Reload from XML now happens only when opening a different file, and title/author fields receive the full persisted link (`ref` + `key`) once authority lookup finishes.
- Localised dates in the desktop settings panels rendered `&#x2F;` instead of `/` — i18next was HTML-escaping interpolated values that React then rendered as literal entities. Turned off i18next's redundant `escapeValue` for the editor package's instance (React already escapes every rendered node).
- **A keychain prompt could hang the whole app at startup, and it was reported as a server failure.** The backup and sync timers ran from `app.whenReady()`, and both read credentials through Electron `safeStorage` — a synchronous call that blocks the main process while the OS shows its keychain dialog. If that dialog could not be answered (a macOS login keychain out of step with the account password, for one), the bundled Commons server was never even forked, and the app announced "Could not start the bundled LEAF-Writer server." Those timers now start from the main window's `did-finish-load`, so a keychain prompt can at worst block a window that is already on screen.
- **The packaged app assumed its bundled server had started.** `startCommonsServer` resolved on a fixed 2-second timer, or on the substring `listening` appearing in the child's stdout. Neither is a readiness check: Node emits `listening` and _then_ `EADDRINUSE` when a dual-stack bind half-fails, so a server that was already dying reported success and the app loaded a URL into a corpse. Startup now polls the server's own URL, races that against the child exiting, and puts the child's stderr into the failure dialog instead of a generic message.
- **A busy plugin-API port took the entire server down.** The HTTPS listener for the Word add-in (port 3848) had no `error` handler, so an `EADDRINUSE` there was thrown and killed the process serving the whole application — a dev server or a second instance was enough. It now logs that the add-in API is unavailable and leaves the app running. The main listener keeps failing hard, as it should, but reports the reason in one readable line.
- **Cloud backup no longer fails silently when its credentials cannot be unlocked.** A dismissed keychain prompt made `readBackupConfig()` throw, which was swallowed, leaving automatic backups switched off behind a settings panel that looked simply unconfigured. The status view now distinguishes "never configured" from "stored but locked", and the panel shows an error with a **Retry** that re-runs the decrypt — which is what asks the OS again.

## 0.1.0-beta.9

### Translation pane

- **Mention-faithful entity rendering (LJBtero).** Each keyed source span now gets its own manifest row (duplicate entity keys allowed). AI blinding uses `{{mention:N}}` (+ `{{holding:N}}` / `{{as:N}}` for offices); the model receives only `{ index, kind }`. After translation, `substituteMentionPlaceholders` renders atomic chips from the as-written surface and resolved role — courtesy names (e.g. 景撝), partial given names (e.g. 廓), and places/offices as written — not the canonical DB short form. Western targets show romanization + Chinese + dates on first **file-wide** mention; later mentions shorten. CJK targets (`zh`, `ja`, `ko`, `lzh`) show characters only (no romanization), with CJK life-date typography on first mention.
- **Brackets policy** for partial kinship names (`never` / `first-mention-only` / `always`) in Translation policy settings — Western `[Cai] Kuo` vs `Kuo`; CJK `（蔡）廓` when allowed.
- Same mention renderer for **AI substitute**, **toolbar insert**, and **autocomplete** (one manifest row per source span in the insert menu and autocomplete popup).
- AI system prompt and payload migrated from `{{entity:KEY}}` to `{{mention:N}}`.
- **OpenCC script conversion** (lazy-loaded `opencc-js`): Traditional → Simplified for `zh-Hans` (`t2s`) and Traditional → shinjitai for `ja` (`t2jp`) on entity chip surfaces. Offered in the Chinese project resources dialog; installed automatically with the Japan authority pack. Not loaded for users who skip those assets.
- **Generate translation** status message now clears when switching source/translation files (and auto-dismisses after success).
- While AI translation runs, the active card shows a grey overlay with spinner and is non-editable until the run finishes.

### Document import (2026-09-02)

- **Import report and schema validation.** After File → Import documents, a per-file report dialog lists source → output, paragraph block count, RelaxNG validation status, and foreign `@key` demotions. Schema validation runs in the existing validator worker against the project RNG (when available); well-formedness-only checks remain a fallback when the worker or schema is unavailable.

### Mention rendering fixes (2026-09-02)

- **Romanization source language.** Project source language (`zh`, etc.) is exposed on the translation tab and passed into mention romanization; when missing, pinyin falls back via `zh` and stored DB Latin names. Fixes duplicated Chinese (`濟陽 濟陽`) when the target language was mistaken for the source language.
- **Person name parts.** All person-name surfaces (family, given, zi, hao, dharma, posthumous, partial given) romanize as **one concatenated word, one capital** — e.g. 興宗 → `Xingzong`, 景撝 → `Jinghui` (not `Xing Zong` / `Jing Hui`).
- **Alternate name forms keep Chinese.** Courtesy, dharma, and partial-given mentions always append source characters even when they are the second chip for the same person key in a unit (e.g. `Jinghui 景撝` after `Cai Yue 蔡約`).
- **Offices with a gloss.** Keyed `{{as:N}}` / `{{holding:N}}` / `{{mention:N}}` office chips default to **translation only** when a vernacular gloss exists (e.g. `Minister of Sacrifices`); romanization + Chinese only when there is no gloss or the mention forces romanization-first.
- **Office placeholder substitution.** Fixed regex so `{{as:N}}` and `{{holding:N}}` tokens from the AI are replaced with entity chips (previously only `{{mention:N}}` matched, leaving raw `{{as:15}}` in output).

### Auto-tagging — milestone projection (Phases A–E)

CBETA and similar texts often split a running string across milestones, e.g. `《般舟三<lb/>昧》` — two text nodes, neither containing the full title. The old tag bomb scanned each text node separately and missed these spans unless you stripped `<lb>` on import.

- **Phase A — projection index** (`projectionIndex.ts`): builds a flat search string from body text, bridging empty `<lb>`, `<pb>`, `<anchor>`, and `<gap>`; excludes `<sic>` / `<surplus>` (corr-only reading, shared with `hiddenChoiceText.ts`); maps every projection character back to a DOM text node + raw offset.
- **Phase B — projection matcher** (`dictionaryTagProjection`): one `MultiStringMatcher` scan of projection text instead of per-node loops; cross-node spans set `anchor.endXpath` / `anchor.endOffset` for apply. Parity with the legacy matcher on plain TEI without milestones.
- **Phase C — projection apply** (`projectionApply.ts`, `wrapProjectionRange`): wraps a contiguous sibling run from start through end text boundaries, preserving infrastructure nodes inside the tag — e.g. `<title>般舟三<lb/>昧</title>`. Inside `<choice>`, wraps the `<corr>` branch only and leaves `<sic>` untouched. Schema and user-rule checks run on the parent of the wrapped run.
- **Phase E — settings & UX:** project setting **Match across line and page breaks** (Settings → Project). CBETA import dialog: when **Strip Taishō line breaks** is unchecked, a note explains the choice between enabling that setting or stripping `<lb>` at import (link opens Settings → Project).
- **Visual-mode tag bomb** now reads the stored file snapshot (not the WYSIWYG export) when matching, so empty `<pb>` / `<lb>` milestones survive between characters — e.g. `丹<pb n="663"/>陽` can match authority entry `丹陽` even though the visual editor export often omits the milestone between text nodes.
- **Review filter** for cross-node projection hits (`endXpath` set) resolves document spans by xpath instead of occurrence counting on the full-document index, so a header mention of the same surface no longer mis-locates body matches split by milestones.
- **Deferred:** Phase D (AI suggest + Sanmiao date apply on the same projection locators) — intentionally not wired yet.
- Planning: [`docs/autotagging-milestone-projection-planning.md`](docs/autotagging-milestone-projection-planning.md).

### Entity display and data

- Entity fields persist `data-mention-surface` and `data-mention-role` alongside the display recipe.
- `nameRole` from SQLite is threaded through entity summaries for mention role resolution.

### UI and settings

- **LanguageTool: managed Java on macOS and Windows.** When Java 17+ is missing or too old, Settings → AI → LanguageTool offers **Download Java for LanguageTool** — a pinned Temurin 17 JRE (~40 MB) into app user data, checksum-verified like the managed LanguageTool install. `probeJava` checks the Grognard-managed runtime before system `JAVA_HOME` / PATH; a **Refresh** button re-probes after a manual Temurin or Homebrew install. Linux still requires Java installed separately.
- **Match across line and page breaks** (Settings → Project): per-project toggle for the milestone-aware tag bomb. When enabled, authority packs, project crawl tags, and imported lists match on a flat projection of body text that bridges empty `<lb>`, `<pb>`, empty `<anchor>`, and `<gap>` — and apply wraps the DOM run with those milestones preserved inside the tag. Default **off**. Stored in `jean-baptiste.project.json` as `autoTaggingAuthority.matchAcrossLineBreaks`. Also available under Settings → Interface → Behaviour.
- **Project settings now persist reliably.** Toggles that patch `jean-baptiste.project.json` (match across line/page breaks, show pack string counts, authority/disambiguation/validation prefs, name-type policy, sync-to-central) wrote to disk but the in-memory project config and settings caches were not refreshed; the cache was also cleared on every tab switch, so values appeared to revert immediately. A shared `persistProjectConfigPatch` helper now applies the returned bundle to Overmind and the desktop bridge; caches reset only when switching projects.
- **Disambiguation place-proximity radius** (`disambiguation.placeProximityKm`) is no longer stripped when the project file is reloaded — the normalizer now keeps it.
- Translation policy panel: **brackets policy** control; language buckets extended with **zh** / **ja** / **ko** (CJK date typography defaults). Per-mention overrides (brackets, title order, show/hide parts) via the entity format popup on a chip in the translation pane.
- Chinese project resources dialog: new **Script conversion (OpenCC)** checkbox.

### Known gaps

- **Noble titles (`<nobleTitle>`).** Still flattened to plain text for the AI to translate freely — no entity chips, pinyin, or character suffix on restore (e.g. “Zhenyang Princess” stays plain prose). Composite fief + rank rendering is not yet wired into the mention pipeline.
- **Milestone projection (Phase D).** AI suggest and Sanmiao date apply still use single-node locators; spans split by `<lb>` / `<pb>` are not yet handled there.

### Documentation

- Design note [`docs/mention-entity-rendering-planning.md`](docs/mention-entity-rendering-planning.md); smoke-test checklist §10d for mention manifest + CJK cases.
- Milestone-aware auto-tagging planning and acceptance cases: [`docs/autotagging-milestone-projection-planning.md`](docs/autotagging-milestone-projection-planning.md).

## 0.1.0-beta.10

### BDRC import (2026-09-03)

- Fixed OpenPecha-batch volumes reporting "no downloadable transcription" when they in fact have real `Etext_base` metadata — just under the bare `UT<n>_I<ig>` id, not the `_0000`-suffixed paginated id `veToUt` always derives. `fetchEtextBase` now retries the bare id before giving up, and the subsequent chunk fetch follows whichever id actually resolved. Known gap: the OpenPecha batch this was found on (`bdr:IE0OPIAC23BB41`) still has no queryable text in PDI's `chunkContext` even once the metadata resolves — its content lives only in the linked GitHub repo (Openpecha-Data), which this importer does not fetch.

### Wikisource import (2026-09-03)

- `{{header}}` extraction now runs for every wiki locale, not just `zh` — non-`zh` imports previously only stripped it with a naive `{{[^}]*}}` regex that couldn't handle a nested template inside a field (e.g. `title={{xx-larger|…}}`), leaking the rest of the header's arguments into the body as literal text. Header field values are now resolved to plain text (templates unwrapped, link display text taken) before being embedded as a citation string, rather than carrying raw wikitext markup.
- New: expand ProofreadPage `<pages index=… from=… to=… fromsection=… tosection=…/>` transclusion tags by fetching the named `Page:` range and stitching it back together with `<pb>` milestones. Some Wikisources — including bo-language works hosted on the shared `wikisource.org` — hold no prose on the work page itself, only this tag; importing such a page previously produced nothing but header scaffolding.
- Presentational HTML tags (`<big>`, `<small>`, `<center>`, `<b>`, etc.) are unwrapped instead of showing up as escaped literal text in the body.
- `[[Category:…]]` links are dropped instead of rendering as a stray paragraph.
- Non-CBETA `sourceDesc` now wraps bibliographic facts in a single `<bibl>`, matching the CBETA branch and every other importer, instead of mixing `<p>` prose with bare `<idno>`/`<note>` siblings directly under `<sourceDesc>` — invalid there, and silently orphaned by the Source Description panel's `biblStruct` rewrite, which only recognizes notes nested inside `<bibl>`/`<biblStruct>`.

### Auto-tagging — Tibetan (2026-09-04)

- **String matcher no longer misses names before a shad.** Authority / dictionary / imported-list patterns are run through the same normalization the document search text gets (NFC everywhere; for Tibetan also fold the non-breaking tsheg U+0F0C → U+0F0B and drop a terminal tsheg / shad). A pack headword stored as `བཀྲ་ཤིས།` now matches the running-text form `བཀྲ་ཤིས`. Applied in `dictionary.ts` `buildTagsByString` and `seed.ts` `addCandidateToSeedIndex` (pattern and lookup key kept in sync), so it covers already-installed packs and user-imported CSV dictionaries as well as freshly compiled packs.
- **Mid-syllable false positives dropped.** Because Tibetan is written with no word spacing, a bare substring matcher would tag `རྒྱ` inside `རྒྱལ`. `dictionaryTag` / `dictionaryTagProjection` now reject a Tibetan match unless each end abuts a tsheg, a shad, whitespace, a string edge, or the a-chung `འ` that begins a fused genitive/agentive particle. Non-Tibetan patterns are unaffected.
- **LLM surface matching tolerates an edge tsheg.** When an AI-suggested surface fails an exact match in a Tibetan project, `findOccurrenceMatch` retries with U+0F0C folded and a leading/trailing tsheg / shad trimmed, and anchors the trimmed span. The model routinely returns a mention with or without its boundary tsheg while the source follows the "drop the tsheg before a shad, keep it after ང" rule. Off for CJK.
- **`buildSearchText`: Tibetan whitespace is collapsed, never deleted** — even under the `'ignore'` policy every project currently uses. A real space in Tibetan source (after a shad, in modern prose, from OCR) is a separator; deleting it fused two syllables into a non-word that could mis-match. The non-breaking tsheg U+0F0C is also folded to U+0F0B in the search text. A Tibetan node with no whitespace and no U+0F0C is byte-identical to before, so its hash — and existing anchors — are unaffected; other Tibetan nodes re-resolve once via the normal edited-document path (Tier 2/3), no data loss. Mapping such a space to a tsheg so the matcher can cross it is deliberately **not** done yet.
- **Prompt guidance for Tibetan.** `preamble.txt` tells the model that the tsheg separates syllables, not words: keep interior tshegs in the surface, never split a mention on one, and never include a leading/trailing tsheg or a shad. Bumps `suggest.v3 → v4`, `audit-clean.v2 → v3`, `audit-add.v1 → v2` (invalidates the LLM response cache).
- **Name-type policy** (`nameTypeTaggingPolicy.ts`): the `art` phase-1 length gate rises to 4 code points for `bo` projects, since one Tibetan syllable is 2–3 letters plus its tsheg and the default of 3 waved every single syllable through.
- Authority-pack data side (terminal shad stripped from `searchStrings`, bundle rebuilt) is in the authority-extraction changelog.

## v0.1.0-beta.11

### BDRC as an authority (2026-09-03)

- **Disambiguation badges and links.** Candidates that already carry a BDRC id — typically Wikidata P2477 on the Tibetan Wikidata packs — show a BDRC badge (BUDA's own favicon) and open the stable record page `https://library.bdrc.io/show/bdr:{ID}`. The `?s=` query on copied BUDA URLs is search-session state and is stripped. Linked-data form is `https://purl.bdrc.io/resource/{ID}`. This does not depend on the internal BDRC person/place dump.
- **Lookup settings.** BDRC is now its own activatable authority (person / place / org). Search by BDRC id (`P…`, `G…`, `bdr:…`, or a BUDA/PDI URL) against the Wikidata `*-bo` packs' `crosswalk.bdrc`. Name search only returns rows Wikidata already links to BDRC. No scrape of library.bdrc.io; the private BDRC CSVs remain an optional extra name list, not a requirement for these ids. Settings → Authorities warns that BDRC is closed and forbids scraping, so access is via Wikidata. Badges come from Wikidata P2477 on the Q-ids already on screen (and from the small `wikidata-bdrc-concordance` sidecar when it is installed), not from scanning the full Tibetan Wikidata packs.
- **Chinese texts on BUDA** overlap the Chinese Buddhist canon with CBETA/SAT at the _work_ level (especially Taishō) but are not a substitute for CBETA XML — not pursued further for import.
- **Native-script labels.** Lookup and Disambiguate prefer the project's script as the primary name when Wikidata (or a pack) has it: Tibetan uchen with Wylie as romanization (not the English transcription); Chinese, Japanese, and Korean Han/kana/Hangul the same way. Transliteration appears on the line below only when the row has no description or dates. VIAF-only hits now also take the vernacular heading from the VIAF cluster JSON (`bo`, `zh`, `ja`, …) instead of the Latin form LINCS reconcile returns.
- **VIAF native language (fix).** Cluster JSON is fetched in the desktop main process (the renderer was blocked by CORS/Cloudflare), and only _name_ fields (`mainHeadings` / `x400`) are used — not book titles. When several Tibetan/Chinese forms exist, we pick the one that matches the Latin preferred heading (e.g. `སྨོན་ལམ་དཔལ` for VIAF 156162422732732460008, `ཀརྨ༌སྨོན༌ལམ` for 50659832).

### Find and Replace (2026-09-04)

- **Find query now persists across sessions.** The match-case and regex toggles already stuck around; the typed query itself reset to empty every time the panel remounted. It's now saved to local storage on every change and restored on mount, like the other sticky sidebar prefs. (Closes #42.)

## v0.1.0-beta.13

- **Disambiguate: DILA place dates (備註/朝代) now actually load.** The background scrape that fills in a DILA place candidate's date range and dynasty was fetching `place/?fromInner=<id>` — an empty frameset shell — instead of `place/search.php?code=<id>`, the frame that actually holds the `wiki_Class_id`/`wiki_Dynasty` fields. Every scrape silently came back empty, and because an empty result was still cached for 180 days, no amount of clicking refresh in the disambiguation panel would recover it. Fixed the URL, and an empty scrape (no 備註, no 朝代) is no longer cached, so a lookup that starts failing again won't stay poisoned. Purged the stale empty cache entries already on disk for the two live test projects.
- **Database viewer: dropped the redundant "(central)" label in synced projects.** The sidebar database list showed `(central)` on every single row once a project synced to a central database, since the per-row project key it falls back on only ever exists for entities that also carry a local, non-synced identity. The label (and its copy-id button) is now hidden for a row when the project is synced and that row has no project-local key, instead of printing the same word on every entity in the list.
- **Disambiguate: Central badge instead of no badge in synced projects.** Candidates from the user's own entity database used to lose their Local/Central provenance badge entirely once a project synced to central (same rationale as the database-viewer fix above — no Local/Central split to show). That collapsed to nothing, rather than to the one label that's still true: the candidate is from the user's own database. Own-database provenance now always shows as a single "Central" badge when synced; unsynced projects keep the existing Local/Central split unchanged.
- **Norbert: generalized person-wrapper markup beyond noble titles alone.** `<name type="personWrapper">` now recognizes a canonical child order — `nationality → roleName → nobleTitle → placeName → persName`, all optional except `persName`, same-slot repeats allowed, at least one non-`persName` component required — instead of being noble-title-specific. Applies to both the manual "Group and Clean" cleanup pass and the suggestion-level auto-tagging pipeline.
- **Norbert: front-loaded, atomic person-wrapper review during auto-tagging.** Fully contiguous, canonically-ordered pending tag suggestions (e.g. a role + a noble title + a name in a row, with no gaps) are now grouped into a single wrapper-candidate suggestion the user reviews and applies as one atomic unit, ahead of ordinary tag-category review — accepting or rejecting the whole wrapper accepts or returns all its member tags together, with a single undo step.
- **Norbert: enriched compiled asset-pack data for person wrappers**, generating given-name-only and surname+given-name forms as separate lookup records, plus 太子/皇太子 bare-rank forms and 太后/太妃 consort surname+氏 forms, matching the richness of the original Python prototype's combination lookups (real compiled data: 1,165 → 3,813 wrapper records).
- **Norbert: automatic disambiguation from harvested project data.** Person wrappers accepted in a project are now harvested into a per-project fact log (`.grognard/wrapper-facts.jsonl`) of confirmed dynasty/title/place/name combinations, consulted before falling back to the compiled Norbert pack — a combination that's uniquely resolved once in a project auto-resolves everywhere else it recurs, without waiting for a global pack rebuild. Auto-keyed wrappers now also get their structured facts written into the resolved entity's own SQLite record immediately, matching what manually accepting a Disambiguate candidate already did.
- **Norbert: bare noble-title disambiguation.** A title mentioned with no name attached at all (e.g. 建安王薨, or a `<nobleTitle>` produced directly by tag-bombing with no adjacent `<persName>`) is now wrapped with an empty, keyless identity `persName` and fed into Disambiguate as a relaxed fief+role candidate list — instead of being left as raw, unreviewable markup. This runs automatically as part of the normal document scan whenever Disambiguate opens or refreshes; it no longer depends on manually running "Group and Clean" from the toolbar.
- **Fixed a live crash** (`NOT NULL constraint failed: person_titles.role_name`) when a wrapper's noble-title data — including the new bare-title case — reconciled into SQLite with a fief or role left empty; the desktop repository was coercing the empty side to `NULL` against a `NOT NULL` column instead of storing the empty string.
- **Disambiguate: fixed a false "disambiguate the inner person name first" warning** on a bare-title wrapper. That warning is meant for a wrapper whose inner `persName` has a real, unresolved name; a bare title's identity `persName` is deliberately empty by design, so the wrapper should resolve directly against its fief+role candidate list instead of being blocked.
- **Fixed the toolbar's Disambiguate button locking up the review panel.** Clicking it while disambiguate mode was already active unconditionally dismissed and immediately restarted the review pane, leaving the panel gone and the flanking dock panels stuck unable to expand. The button now does nothing if disambiguate mode is already active.
- **New generic entity kind: `thing`.** Alongside person/place/org/work/office, anything else — a philosophical concept, a medicinal plant, a bibliographic category — can now be tagged as `<rs type="...">`, the schema's one remaining general-purpose tag. Enter-key tagging, mint-time authority lookup, the database viewer, and Wikidata disambiguation (via a new exclusion filter, since `thing` has no positive Wikidata root set to query against) all support it exactly like the other five kinds.
- **User-defined thing sub-types.** A per-project "custom thing types" panel (Project Settings) lets a user define their own sub-categories — e.g. `philosophical_concept` → "Philosophical concept" — each with a validated slug id. Sub-types show as distinct, individually labeled options in the Enter-key tag popup, are captured at mint time into the entity's SQLite record, and can be filtered on in both the sidebar Database tab and the Database Window — both of which now also show the sub-type on the entity card itself.
- **Tag-bomb (bulk auto-tagging) now covers thing sub-types.** Four new packs — PEDB things, CEDB things, Project tags: things, Imported list: things — join the existing person/place/work/office/org quintets. A `thing` candidate's sub-type carries through to the applied `<rs type="...">` attribute; the review panel shows a human-readable `<rs type="Philosophical concept">` chip instead of a bare `<rs>`, and its tag filter offers each sub-type as its own option so same-surface, different-subtype collisions stay distinguishable. Project-crawl (`project-things`) deliberately ships with a generic, untyped `<rs>` fallback rather than trying to recover sub-type identity from already-tagged mentions — fix those up via Lookup afterward.
- **Central sync (D1) now carries `thing` entities.** Previously `thing` entities were pushed nowhere — `entitySync.ts` explicitly skipped them, and the Worker/D1 schema would have rejected them regardless. The client's sync type, the Worker's protocol validator, and the D1 `central_entities.kind` CHECK constraint are all updated; the live migration ran without touching any of the existing synced rows.
- **Fixed a latent cross-device sync bug for `office` entities.** Pulling a remote `office` entity onto another device silently failed to apply: the wrapper used to re-import a pulled entity locally shares its element (`<listOrg>`) with `org`, distinguished only by a `type="offices"` attribute the wrapper was never setting, so the entity came back in as `org` and was dropped by the kind-mismatch guard on the write side. Fixed alongside the `thing` sync wiring, since it's the same three-line map.

## v0.1.1-beta.1

### Complete refactor

- Product name changed to Grognard. All branding and URLs updated.

### Plugins

- **Installed plugins now update themselves in the background.** The 4-hour
  companion-update poll (same cadence as the app and authority-pack updaters)
  previously only _counted_ outdated plugins and raised a "Plugin updates
  available" notification; the user then had to open the Plugins panel and
  reinstall each one by hand. It now downloads and installs the newer version
  in place — sha256-verified against the registry, same path the manual
  install used — for every plugin the user already has installed, and shows a
  "Plugins updated" notification afterward. Per-project enable state is keyed
  by plugin id, so a plugin stays enabled wherever it was enabled. Bundled
  contributions (authority packs, Python runtime) and manifest-derived UI
  (tools menu, auto-tagging producers) refresh immediately; an already-running
  plugin's JavaScript entry module picks up the new code on the next app
  start. Auto-update never _adds_ a plugin the user has not chosen to install.
  The manual "Look for Updates" path still works as a fallback.
- **Kanripo import: punctuate from a whole folder of reference-source files,
  not just one hand-picked file per juan.** Parallel punctuation previously
  required either a preset crosswalk source or manually adding one file/paste
  per juan; a folder of reference files (e.g. a ctext.org download) whose
  file boundaries don't line up with juan boundaries had no way in. A new
  "Add reference folder (auto-align)" option splits both sides into
  paragraphs, matches them by content (bigram-indexed containment scoring,
  not filename), and shows a summary — paragraphs matched, juan with no
  matching source content at all — before you confirm and import. Punctuation
  is then inserted per matched paragraph at its own known position rather
  than via a single reassembled excerpt per juan, which also required
  splitting Kanripo `<p>` paragraphs at internal citation boundaries (an
  ideographic space separating several citations glued into one page-line
  paragraph) so each citation gets matched and punctuated independently.

### Packaging

- **The standalone Linux `.deb` now onboards the apt repository.** Installing
  the `.deb` previously left the machine with no update channel at all — the
  in-app updater is macOS/Windows only, and nothing pointed apt at the signed
  repo published to GitHub Pages. The package now ships the repository signing
  key and runs a `postinst` (`deb.afterInstall`) that, on first install,
  installs the key to `/usr/share/keyrings/grognard.asc` and writes an
  arch-pinned `signed-by` entry to `/etc/apt/sources.list.d/grognard.list`, so
  `apt upgrade` keeps Grognard current. It never overwrites an existing
  sources entry and honours `repo_add_once="false"` in `/etc/default/grognard`;
  a matching `postrm` removes both files on `apt purge` (a plain `apt remove`
  leaves the repo in place). The Flatpak, macOS, and Windows builds are
  unaffected.
- **Updated privacy policy page**

### Fixed

- **A fresh, unconfigured install no longer touches the OS keychain at
  startup.** The cloud-backup status check (`entityDbBackup:getStatus`) runs
  on every app launch regardless of whether backup has ever been set up, and
  it called Electron `safeStorage.isEncryptionAvailable()` unconditionally
  before even checking whether a backup config had been saved. `safeStorage`
  now stays untouched until a backup config file actually exists on disk —
  cross-device sync and the Turso PEDB token store were already gated this
  way, only the backup status read was not.
- **Punctuation coverage bars were silently under-reporting almost
  everywhere.** `segment_is_adequately_punctuated` (Python) and
  `punctPer100Han` (TS) computed punctuation density from a segment's
  Han-only text, which by construction never contains a punctuation mark —
  so the density check could never pass for any run of 20+ characters,
  regardless of how well it was actually punctuated. This affected every
  coverage bar in the Kanripo import/punctuate dialogs and the AI gap-fill
  feature's "needs more punctuation" detection, not just the new
  folder-alignment path. Both now count density from the segment's
  punctuated text instead.
- **A whole-work Kanripo import (100+ juan) could sit at "Finalising" for a
  very long time.** `ensureImportHeaderEntitiesForPaths` synced each file's
  linked work/author entities to the central store individually, inside the
  per-file loop — up to one round trip per file, even though every juan of
  the same work shares the same work and author entities. It now collects
  the entities linked across all files and makes one batched sync call after
  the loop instead.

## v0.1.1-beta.2

### Data

- Added a Turso (libSQL) network backend as an alternative to the local `entities.sqlite` file, so a project's entity database can be shared with genuine, simultaneous concurrent edits from multiple collaborators instead of one file everyone takes turns editing. Opt-in per project; local single-user projects are unaffected.
- Added a one-time migration to copy an existing local project's entities into a fresh Turso database, so switching an in-progress project over doesn't lose what's already tagged.
- Renamed the project file from `jean-baptiste.project.json` to `grognard.project.json` (a rebrand leftover — the app was called "Le Jean-Baptiste" before Grognard). Existing projects keep working under their old filename indefinitely; only newly created projects get the new name.

### UI

- Settings → Project now has a "Shared project database" section: switch a project between local and Turso, paste a database URL and your own scoped auth token, test the connection, and migrate existing local data over.

### Bug fixes

- Fixed the database viewer's authority-duplicates panel throwing "Invalid entity SQLite database path" for Turso-backed projects (found via live two-machine testing).
- Fixed the Turso settings section silently not appearing at all when creating a brand-new project — that dialog runs in a separate window with no access to the bridge the section was reading from.
- Fixed a few raw, untranslated i18n keys showing in that same new-project dialog's authority-matching section.
- Fixed the R2 entity-database cloud backup silently redirecting to whichever project's Turso PEDB happened to be open, instead of always backing up the central entity database (CEDB). It could overwrite the CEDB's backup history with a near-empty per-project logical export the moment a Turso-backed project was opened, and separately suppressed the CEDB's own startup integrity check while such a project was active.

## v0.1.1-beta.3

Grognard is a desktop fork of [LEAF-Writer](https://leaf-writer.leaf-vre.org/), part of [The Linked Editing Academic Framework](https://www.leaf-vre.org/) (LEAF) tool suite; LEAF-Writer is itself an enhancement of CWRC-Writer, developed by the [Canadian Writing Research Collaboratory (CWRC)](https://cwrc.ca). Grognard wraps that web app in Electron for offline, single-user desktop use and adds workflow changes aimed at local editing and East Asian documents — the entity-sync/backup, authority-pack, translation-pane, rewards, and import (Kanripo/Daozang/CBETA/BDRC/Wikisource) work logged above is all downstream of that shared core. Upstream-inherited functionality (tag editing, schema validation, XML tree navigation, table of contents, entity tools, and the VIAF/Wikidata/Getty/DBpedia/GeoNames authority connections) is not re-logged here except where Grognard changes it. See [readme.md](readme.md) for the full upstream lineage and licensing (`AGPL-3.0-only`, inherited from LEAF-Writer).

### Cross-device sync hardening

Continued hardening of the Cloudflare D1 entity-sync Worker/client (Phase 5 of [entity-sync-planning.md](docs/entity-sync-planning.md), [issue #29](https://github.com/grognard-xml/grognard/issues/29)):

- Fixed an entity edited again while its previous version was still mid-push getting silently marked "synced" without the interim edit ever having been sent — the sync engine recorded the entity's live revision instead of the one it actually pushed, so the newer content was lost from sync until the entity happened to be edited again. Now the pushed revision is recorded, keeping the entity dirty for the next run when this happens.
- Added a version tag to the entity content hash (`CONTENT_HASH_VERSION`) with automatic re-baselining: a future change to the hashing/normalization algorithm no longer risks spurious conflicts or false "nothing changed" reads against hashes cached before the change — cached hashes are cleared (not the underlying revisions) and recomputed cleanly on the next sync.

### Cloud backup hardening

Phase 0 of the same plan:

- Added an on-launch prompt for a corrupted entity database: if `checkEntityDbIntegrity` fails at startup, a dialog now offers to restore on the spot (closing cached handles, restoring, and relaunching) instead of only showing a red alert if the user happens to open Settings first.
- That prompt offers whichever backup this device actually has, not just R2: a local Time Machine snapshot of the central database now works too — most users never configure cloud backup and rely on Time Machine instead. Restoring from it preserves merge/delete orders recorded since the snapshot, same as the interactive Time Machine dialog's central tab.
- Fixed the Flatpak build's sandbox permissions silently blocking `safeStorage` (the encryption backing cloud-backup credentials, sync bearer tokens, and Turso auth tokens): electron-builder's own default Flatpak sandbox permissions never include Secret Service (D-Bus keyring) access, so a Flatpak install of Grognard could report no keychain available even with a perfectly good one on the desktop. Added `--talk-name=org.freedesktop.secrets` (alongside the rest of those defaults, explicitly, since setting `finishArgs` at all replaces the defaults rather than extending them).

### Large-batch cold sync

Audit of Phase 5's cold-sync path, same plan:

- Fixed a `seq` collision the out-of-band D1 seed script (`generate-entity-sync-seed.mjs`) could hand out during its own documented usage: seeding a large authority file is meant to be spread across several `wrangler d1 import` runs against D1's free-tier write cap, one file per day if needed, and a real device can push a genuine edit at any point in that multi-day window. The script only wrote the `sync_counter` row (the pull-cursor high-water mark new pushes are reserved against) in its _last_ file — so a push landing after only the first file or two had been imported would be reserved a low `seq` the script had already hardcoded into a not-yet-imported later file. `seq` carries no uniqueness constraint server-side, so the collision wouldn't error; it would silently strand whichever of the two rows a client's cursor doesn't land on, violating the sync protocol's own "seq monotonic and unique per owner" invariant. The counter now reserves the whole range in the first file, before any row lands.

### Worker deploy

- Deployed the two entity-sync contract fixes that had been sitting unshipped since Phase 1 (`localId` adopted as `centralId` on a first push; `contentHash` may be empty on delete) — `grognard-entity-sync`, version `f2ab8784-bf1c-43d8-8e82-d17d5aa8def8`, source pinned to commit `3325d8df2`. Pure code deploy: every D1 migration was already applied remotely, so nothing in the database changed. A D1 Time Travel bookmark was taken immediately beforehand as a precaution.

### Disambiguation panel

- Fixed the disambiguation panel offering unrelated place candidates (e.g. European cities) for a correctly-recognized Tibetan-script mention. Root cause: `fetchLiveCandidates` queries VIAF (via the upstream LINCS reconciliation service) alongside Wikidata for every mention, and VIAF's search has no real Tibetan coverage — for a Tibetan-script query it fails open, returning an arbitrary slice of its geographic authority file instead of no results, and those rows carry no exact-surface filter the way Wikidata's do (VIAF headings are legitimately romanized for CJK, so the same filter can't apply there without dropping real hits). Verified live: querying VIAF-Geographic with the Tibetan word for Lhasa returned Australia, Slovenia, Slovakia, Belarus, Somalia, Sierra Leone, Lesotho, Lisbon, Oslo, and the Solomon Islands — none related to Tibet — while the same query to Wikidata returned Lhasa correctly. `fetchLiveCandidates` now skips VIAF/Getty/GND/DBpedia entirely for Tibetan-script surface text and queries Wikidata only, which already handles Tibetan script correctly and applies its own exact-match filter.

### Entity name integrity

Investigated [issue #53](https://github.com/grognard-xml/grognard/issues/53) (a manually-created toponym that stayed invisible to name search despite carrying a valid authority id) by diffing a reporter's central `entities.sqlite` against a clean one. Found two independent bugs, both reproducing with the same symptom — a resolved/tagged place or person that quietly drops out of every name-based view:

- Fixed `EntitySqliteRepository`'s "classify-from-mention" name insert (used when the Attributes panel types an existing mention as an entity's primary name) hardcoding `is_primary = 0` in its `INSERT` regardless of the computed `name_role`. An entity with no prior name row got its only name stored with `name_role = 'primary'` but `is_primary = 0` — invisible to every label query in the app, all of which resolve the displayed name via `ORDER BY is_primary DESC, id LIMIT 1`. An entity that already had a name (e.g. an authority-pack import) kept showing that old name forever, since the newly "primary" one could never outrank it. The insert now demotes the entity's other names and sets `is_primary = 1` when `name_role` is `'primary'`, matching every other write path in the file.
- Fixed `planLookupResolution`'s mint path using `candidateMeta?.primaryName ?? input.label`, which only falls back to the search label when `primaryName` is `null`/`undefined` — an authority record with `primaryName: ""` (a blank but present field) passed straight through. `mintEntitySqlite` → `createPopulatedEntity` then silently drops the empty name (`if (!text) continue`) while still writing the authority link unconditionally, minting a structurally valid but completely nameless entity — undiscoverable by name search, matching by authority id only. Confirmed the currently-bundled BDRC pack itself has no blank `primaryName` records, so this is a latent gap rather than the confirmed trigger for the reported case; fixed defensively regardless, since any future or third-party authority source could hit it.

Added regression tests for both (`repository.test.ts`, `lookupResolve.test.ts`).

### Place entity database UI

The entity database viewer treated every entity kind the same regardless of whether the fields made sense for it, and place entities had no coordinate data at all despite the disambiguation panel already computing geo clusters for them (`docs/placename-geo-disambiguation-planning.md`'s Phase 5):

- "Noble titles" and "Roles" no longer show for place entities in Database mode's compare/detail card (`EntityCompareCard`) — they were already correctly person-only in the Editor-mode sidebar, but the standalone Database window's card had no kind check at all.
- Removed the "Relations" panel (`EntityRelationsEditor`) from the Editor mode's Database Viewer entirely. It had been unconditional for every entity kind since it was introduced; there was no prior scrub to restore.
- Place entities can now carry a persisted latitude/longitude, following the exact same multi-source, accept/reject pattern already used for a person's birth/death dates: a new `place_locations` sqlite table (schema migration 12) records one row per authority source with `origin`/`source`/`status` provenance, one accepted row wins per entity, and the winning coordinate is mirrored onto the (previously unused) `places.latitude`/`places.longitude` columns. Coordinates round-trip through `entities.xml` as `<geo>` elements, same provenance-attribute convention as `<birth>`/`<death>`. Accepting a geo-bearing CBDB/CHGIS/Wikidata place candidate in the disambiguation panel now persists a coordinate assertion the same way accepting a birth/death year already does.
- Both the Editor-mode sidebar and the Database mode card show the accepted coordinate with its source badge; the sidebar additionally lists pending authority-sourced coordinates with accept/reject controls, and rejected ones with restore, mirroring the existing dates UI exactly.
- Added a map icon next to the coordinates in both views, reusing the disambiguation panel's `PlaceComparisonMap` (confirmed to render correctly with a single pin) to open a map centered on the entity's location.

### Kanripo import normalisation

- Fixed the Kanripo import wizard's "Hard replacements" character-normalisation option (`plugin-kanripo-import`), which applied a simp/trad collapsing table (乎/於→于, 炁→氣, plus a broader simplified→traditional table) directly to the transcription text being written into the document. That table was only ever meant to say two characters read as _the same thing_ for the purposes of finding textual parallels (n-gram/paragraph matching against a reference source) — not to actually rewrite one character into another in the transcription itself, which silently altered the source text. Removed the option from the import wizard and the underlying `hard_replacements` normalise mode entirely; that table is now applied only to the comparison key used when matching a Kanripo paragraph against a parallel reference source (`normalize_para_key`), never to output text.

### Editor dark/light theme sync

- Fixed the TinyMCE editor pane not following the system theme back from dark to light (it would switch to dark instantly but get stuck on dark after switching back to light). The upstream editor only re-syncs its content skin CSS when it hears a `changeTheme` DOM event, and that event was only ever dispatched from the explicit Settings → Appearance toggle — the live OS `prefers-color-scheme` tracking path (`Providers.tsx`, active whenever Appearance is set to "System", the default) updated the app's dark-mode state directly without dispatching the event, so TinyMCE's iframe stylesheet was left stale on OS-driven theme changes. `Providers.tsx` now dispatches `changeTheme` alongside the state update on that path too.

### Pasted glyph images (vectorized inline characters)

Paste or drop a character image into an on-disk TEI file to insert a palaeographic glyph that behaves like surrounding text — distinct from Kanripo gaiji (which keeps the raster PNG as `background-image`):

- Vectorizes via the Electron main process (composite on white → threshold → despeckle → crop to ink → potrace) into a `currentColor`-filled SVG, saved beside the document under `_glyphs/` together with the raw source PNG. Markup is `<g type="glyph">` wrapping a hidden `<graphic type="source">` (provenance) and a visible `<graphic type="normalized">` (the SVG). Right-click can replace the image and re-trace.
- Renders with a CSS mask painted as `background-color: currentColor` (data-URI inlined so the app's `grognard://` asset scheme is not blocked as cross-origin). Earlier attempts that injected live `<svg>` into the TinyMCE DOM looked correct until save: the tagger's XML model does not keep unmarked foreign markup, so the glyph vanished on reload.
- Fixed the glyph rendering gray instead of following the font colour. Stock schema CSS (`tei.css`'s `graphic { color: gray; content: "{" attr(url) "}" }`) is rewritten by `schemaManager.loadSchemaCSS` onto `*[_tag="graphic"]` and injected into the Visual editor — so the gray was applying on the real editing surface, not only a raw-XML reading view. Glyph chrome now forces `color: inherit` (and kills the rewritten `content`) so the mask tracks surrounding text.
- Fixed the wrap sitting at roughly twice a CJK character's width: layout is a fixed 1em×1em cell with `mask-size: contain` (ink aspect no longer stretches the slot), and show-tags pills are suppressed for `g[type=glyph]` the same way Kanripo already suppresses them for `g[type=kanripo]`.
- Fixed freshly inserted glyphs hanging a full line below the baseline while looking correct after save-and-restart. The tagger seeds every new empty structure tag with `\uFEFF` so TinyMCE will not delete it; TEI `<graphic>` cannot contain text, so an XML reload builds those elements empty and they align. The sentinel text strut inside a `display:block` 1em box was what threw insert-time alignment off. Glyph styling now strips that sentinel and marks `_textallowed="false"`. Source → Visual without edits also re-runs graphic refresh (that path previously skipped the TinyMCE reload entirely when the buffer was unchanged, so a broken insert stayed broken).
- `vertical-align: baseline` aligns a glyph's masked em-cell to the font's alphabetic baseline, but CJK ink is conventionally drawn against a lower ideographic baseline, so the cell reads as sitting slightly high next to real CJK text by an amount that depends on the surrounding font - there is no API to query that gap, so it cannot be computed automatically. The downward nudge is now the `--lw-glyph-baseline-shift` custom property (declared on `body` in `editor.css`, default `0.22em`, tuned by eye against the actual editor font) instead of a value baked into the transform, so it can be corrected per project/font without a rebuild.
- Fixed every glyph insert being schema-invalid on every schema that defines `<g>` at all (TEI All, TEI Simple Print, jTEI, CBETA - confirmed by reading each RNG directly): `<g>`'s content model is text-only, so the `<graphic>` children `insertGlyph` wrote were never legal there, regardless of the mask/rendering work above. Glyphs now use the standard TEI mechanism instead: a bare `<g ref="#id">` in the running text, with the actual `<graphic>`s registered once in `<teiHeader><encodingDesc><charDecl><glyph xml:id="id">` (whose content model explicitly permits them) - valid without patching any schema. That header lives separately from the visual editor's DOM (stripped before load, merged back at save - see `stripTeiHeaderForVisualEditor`/`mergeEditorBodyWithStoredHeader`), so reading and writing it goes through `window.__desktopStoredDocumentXml`, the same global already used for this elsewhere in the app (`useTeiHeaderRepairPrompt.tsx`, `autoTagging/documentContent.ts`). TEI Lite is the one exception: it defines neither `<g>` nor `<charDecl>`/`<glyph>` at all, so glyphs there fall back to a bare `<graphic type="glyph">` directly in the running text (the only mechanism it actually offers), without the source-provenance sibling or a right-click replace option. Documents with the previous `<g type="glyph"><graphic>...` shape keep rendering correctly; only new inserts use the new shape.

### CHHIV plugin (Chinese palaeography)

New plugin, `plugin-chhiv` (Character Handling for Historical Inscription Variants). Off by default like every other plugin - enabled per project from Tools → Plugins, and the setting persists until turned off. Adds a "CHHIV" toolbar menu, alongside Norbert's, with two entries:

- A plain symbols palette (from `plugins/paleo-clever-idea.md`'s notation table) - illegible/damaged/lacuna marks, repetition and ink marks, and bracket pairs for supplied/corrected/superfluous text. Deliberately does no semantic TEI tagging (no `<unclear>`/`<supplied>`/`<choice>`): each entry inserts plain text at the cursor, or wraps the current selection for bracket pairs (inserting both halves with the cursor left between them when nothing is selected).
- A glyph-reuse palette: every `<g>`/`<graphic>` glyph already inserted somewhere in the document (via the pasted-glyph feature above, in any of its three markup shapes) is deduped by its resolved image and offered as a clickable thumbnail grid; clicking one inserts that same glyph again at the cursor without re-vectorizing or writing a new asset, and the dialog stays open for repeated reuse.

Also adds a manuscript "format" field (書/簡/牘 - book/slips/boards) to file metadata, gated the same way as the rest of CHHIV's UI (`isPluginEnabled`). TEI All is CHHIV's actual target schema, so on TEI All the field round-trips through proper TEI (`msDesc/physDesc/objectDesc/@form`); every other schema (including CBETA, which CHHIV is not expected to be used with) gets a simpler `<note type="format">` fallback instead of forcing `msDesc` scaffolding onto documents that don't already use it. A document that already stores the field one way keeps being read/written that way regardless of which schema is active, so opening an unrelated schema can't silently flip or destroy an existing value.

- Fixed inserting a second glyph right after a first one piling it inside the first instead of placing it beside it (visually, two masked characters stacked on top of each other), and fixed glyphs being un-deletable with Backspace/Delete once inserted - both traced to the same cause. `addStructureTag`'s default insert path deliberately leaves the selection _inside_ the new tag's `﻿` sentinel content, so typing over it can fill the tag in - correct for an ordinary text tag, but a glyph never gets real text content (`_textallowed="false"`, `contenteditable="false"` once styled), so leaving the caret inside it was actively wrong: a second glyph's insertion bookmark captured that stale "inside the previous glyph" selection and landed nested inside it, and TinyMCE's normal click-to-select/Backspace-to-delete handling for `contenteditable=false` widgets never worked because the caret wasn't sitting beside the element the way it expects. `insertGlyph` and the CHHIV glyph-reuse palette's `insertExistingGlyph` now explicitly move the caret to just after the inserted element once it's in the DOM.
- Fixed the legacy dual-graphic glyph shape (`<g type="glyph"><graphic type="source"/><graphic type="normalized"/></g>`, still rendered for documents inserted before this feature moved to the schema-clean `<g ref="#id">` shape) letting Backspace delete just the `<g>` wrapper while leaving its two `contenteditable="false"` `<graphic>` children behind as orphaned siblings in the running text - "deletes the container, but not the image." Every other glyph shape is a single element that's itself `contenteditable="false"`, so TinyMCE treats it as one atomic click-to-select, Backspace-to-remove widget; this legacy shape split the glyph across a wrapper and children and only ever marked the children non-editable, leaving the wrapper a normal editable element. The wrapper itself is now `contenteditable="false"` too, so the whole glyph deletes as one unit like every other shape. A document with glyphs already split apart this way by the bug (orphaned bare `<graphic>` elements, no `<g>` wrapper) needs those cleaned up by hand; this only stops it from happening going forward.

### Structure toolbar menu

New built-in "Structure" toolbar menu (icon next to Auto-tagging), available on every schema and every UI language - not a plugin, not gated behind any settings toggle. Offers Heading, Page break, Line break, and Split paragraph, and unlike a plain insert-at-cursor, each one places its element wherever the active schema's actual content model allows it, splitting structure around the cursor if needed rather than producing an invalid document:

- `insertStructuralElementAtCursor` (`structuralInsert.ts`) walks outward from the cursor's innermost tagged ancestor and asks the live schema (`schemaManager.isTagValidChildOfParent`, the same RNG-derived check auto-tagging's containment logic uses) which level actually accepts the new element. Inserting a heading inside a `<p>` - not a valid `<head>` parent on any registered schema - splits that `<p>` into two and inserts `<head>` between them as a child of its `<div>`, instead of nesting it somewhere invalid or refusing outright. A page/line break, valid directly inside `<p>` on every schema checked, needs no splitting and just inserts at the cursor.
- Page/line breaks get the same textless-widget treatment this session's glyph fixes settled on (`schemaManager.canTagContainText` decides which): non-editable, caret moved just past the inserted element, so they're click-to-select and Backspace-to-delete like a glyph, and don't inherit the same piling/undeletable bugs that motivated those fixes. A heading keeps the normal "caret left inside, ready to type" behaviour, since it does hold text.
- Splitting an element that's only partially inside the browser's split range (e.g. the cursor sitting in the middle of an entity span) can leave a real, cloned duplicate of that entity with the same tagger id in both halves; `structuralInsert.ts` detects and rekeys these before they land in the DOM, and strips a duplicated `xml:id` off the split-off half the same way, since both are document-uniqueness violations that would otherwise corrupt the document silently.
- Page break, line break, and heading now open a small prompt (built on the existing `'simple'` dialog type, not a new one) asking for a page/line number or the heading's text before inserting - cancelling inserts nothing. A blank page/line number inserts a bare `<pb/>`/`<lb/>` with no `n` attribute; a heading's text is written directly into the new `<head>`, and the cursor moves on to the paragraph after it rather than landing inside the heading itself, so it doesn't feel like editing continues there.
- A heading inserted with nothing after it (typically because it landed at the very end of a document or section, where there was no following `<p>` to split) now gets an empty paragraph appended after it automatically, the same as splitting mid-paragraph would have produced - a section that's just a bare title with no body reads as broken.
- These single-field prompts have no visible buttons at all: Enter confirms, Escape or a backdrop click cancels. `SimpleDialog` (the shared `'simple'` dialog type every one-off dialog in the app is built on) now passes its `Body` an `onSubmit` callback that confirms exactly as if the primary button had been clicked, and skips rendering the button row entirely when a dialog declares no `actions` - a general capability for any current or future minimal one-field popup, not something specific to this feature.

### Palaeographic glyphs in the translation pane and footnotes

Paste/drop a character image now works in the translation pane and its footnotes too, not only the main Visual editor - a plain-DOM, plain-`Range` counterpart to the main editor's `writer.tagger`-based glyph pipeline (`translationGlyphs.ts`), since this pane holds real element names directly (`<note>`, `<bibl>`, `<ref>`...) rather than the main editor's `_tag`-attribute-on-a-generic-span convention that glyph rendering/insertion there is built on:

- Reuses the vectorization pipeline as-is (it was always UI-framework-agnostic Electron IPC) and the clipboard/drag helpers already used by the main editor's own paste/drop handling. Adds drag-and-drop to the translation pane and footnotes for the first time - previously only paste existed there at all.
- Deliberately the bare `<graphic type="glyph">` shape only (no `<g>` wrapper, no source-provenance sibling, no `<teiHeader><charDecl>` registration): translation files aren't schema-validated at all, so there's no conformance reason to use the heavier mechanism the main editor needs for schema-validating documents. Assets live under `_glyphs/` next to the translation file itself, not the main document.
- `sanitizeTranslationFragment` (runs after every paste, main-body and footnote alike) strips any element not on an explicit allowlist, and separately strips `contenteditable`/`style` as "editing-only" from *every* surviving element on *every* paste, not just newly-pasted content - both would have silently deleted a pasted glyph, or at minimum wiped its non-editable/masked-CSS styling the next time anything else nearby was pasted. `graphic` is now in that allowlist, and glyph styling is unconditionally reapplied after every sanitize pass, the same "reassert after every paste" pattern this pane already uses for footnote/citation/entity/date fields for the identical reason.
- Fixed dropping an image inserting the browser's own raw, full-size, unvectorized `<img>` instead of a glyph. A drag can carry an image three different ways depending on its source - a real OS file, a self-contained `data:` URI (dragging an already-rendered image from elsewhere in the app or a web page), or a remote URL (dragged off a live page) - and the drop handler only recognized the first and the last of those, and only the last when the URL happened to be `http(s)://`. A `data:`-sourced drag (the likely case for an in-app source) matched none of them, so detection failed, nothing called `preventDefault()`, and the browser's own default image-drop behaviour ran unopposed. Drop detection now also reads a `data:` URI directly out of the dragged HTML (no network/IPC fetch needed - the bytes are already in the string) and, as a last resort, recognizes an `<img>` tag with a src none of the three paths can actually read (e.g. a local `file://` src, unreachable without a dedicated IPC channel this doesn't have) - blocking the browser's fallback and reporting a clear failure instead of ever letting a raw image insert itself.
- Fixed a glyph paste/drop failure surfacing as nothing happening at all: the async insert pipeline had no error handling, so an exception thrown anywhere in it (vectorization, disk write) became a silently swallowed unhandled rejection. It's now wrapped in a try/catch that reports the failure via the same snackbar already used for a recognized-but-unavailable insert.

### Upstream

- Updated Structure, CHHIV, and Advanced Tag Transform icons
