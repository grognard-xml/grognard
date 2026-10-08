# Documentation

Working notes and specs for **Grognard** (desktop LEAF-Writer).  
User install / build instructions live in the [root readme](../readme.md) and [apps/desktop/README.md](../apps/desktop/README.md).

Active product TODOs live in the root [`readme.md`](../readme.md) (`## Waiting` / `## Future`). Plan/phases docs below carry a **Status** line at the top — start there before reading the body. Keep plan status lines current when behaviour ships.

---

## User reference

| Doc                                                                                                                       | Topic                                                            |
| ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| [beta-tester-guide.md](beta-tester-guide.md)                                                                              | Packaged beta testing checklist                                  |
| [keyboard-shortcuts.md](keyboard-shortcuts.md)                                                                            | Markup and app shortcuts                                         |
| [smoke_test.md](smoke_test.md)                                                                                            | Manual smoke checklist                                           |
| [entity-sync-manual-test-plan.md](entity-sync-manual-test-plan.md)                                                        | Manual QA for entity sync (until SQLite migration is signed off) |
| [entity-db-cloud-backup-setup.md](entity-db-cloud-backup-setup.md)                                                        | Set up the R2 bucket + token for entity database cloud backup    |
| [entity-db-multi-machine-setup.md](entity-db-multi-machine-setup.md)                                                      | Type C: R2 + D1 sync, second machine, achievements               |
| [entity-sync-protocol.md](entity-sync-protocol.md)                                                                        | Wire contract for a sync server (any implementation)             |
| [translation-smoke-tests.md](translation-smoke-tests.md) / [smoke-test-translation-ids.md](smoke-test-translation-ids.md) | Translation pane checks                                          |

---

## Architecture & implemented reference

| Doc                                                                          | Topic                                          |
| ---------------------------------------------------------------------------- | ---------------------------------------------- |
| [Auto-tagging.md](Auto-tagging.md)                                           | Auto-tagging / disambiguation architecture     |
| [Auto-tagging-phases.md](Auto-tagging-phases.md)                             | Phase checklist (companion to above)           |
| [schema_handling.md](schema_handling.md)                                     | Project schema behaviour (phases 1–6)          |
| [grognard-tei-extensions.md](grognard-tei-extensions.md)                     | TEI extensions used by the app                 |
| [sanmiao-dates-schema.md](sanmiao-dates-schema.md)                           | East Asian date schema                         |
| [entity-data-provenance.md](entity-data-provenance.md)                       | Entity `origin` / `source` / `status`          |
| [entity-registry-merges-and-splits.md](entity-registry-merges-and-splits.md) | Merge / split behaviour                        |
| [authority-extraction.md](authority-extraction.md)                           | Pointer to the sibling **authoritypacks** repo |

---

## Authority packs & entity database

Read in roughly this order:

1. [authority-data-lifecycle.md](authority-data-lifecycle.md) — current product model (tiers, download, enable)
2. [authority-databases-phases.md](authority-databases-phases.md) — A0–A6 tracker
3. [authority-packs-planning.md](authority-packs-planning.md) — pack strategy and sources
4. [sqlite-entity-database-migration-plan.md](sqlite-entity-database-migration-plan.md) — SQLite migration (current)
5. [date-chunked-authority-packs-plan.md](date-chunked-authority-packs-plan.md) — range-aware loading for large packs

Supporting / deeper:

| Doc                                                                      | Notes                                                                                  |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| [authority-databases-planning.md](authority-databases-planning.md)       | CBDB/DILA field detail (partially superseded by packs plan — keep for field reference) |
| [wikidata-tag-packs-planning.md](wikidata-tag-packs-planning.md)         | Wikidata pack deep dive                                                                |
| [dual-entity-database-planning.md](dual-entity-database-planning.md)     | Historical dual-DB / bridge design; SQLite plan supersedes parts of this               |
| [entity-database-viewer-planning.md](entity-database-viewer-planning.md) | Database window / viewer (**shipped** — historical)                                    |

---

## Feature plans (active or recent)

| Doc                                                                                                                     | Topic                                                                                       |
| ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| [person-shortform-autotag-planning.md](person-shortform-autotag-planning.md)                                            | Short-form person names (phase 2)                                                           |
| [norbert-noble-title-autotagging-plan.md](norbert-noble-title-autotagging-plan.md)                                      | Norbert noble titles                                                                        |
| [placename-geo-disambiguation-planning.md](placename-geo-disambiguation-planning.md)                                    | Place geo disambiguation + map (authoritative for maps)                                     |
| [map-tiles-planning.md](map-tiles-planning.md)                                                                          | Regional PMTiles download / cache                                                           |
| [import-planning.md](import-planning.md)                                                                                | Document import (blind + profiled)                                                          |
| [kanripo-import-plugin-planning.md](kanripo-import-plugin-planning.md)                                                  | Kanripo clone → TEI plugin (coverage-bar punctuation)                                       |
| [kanripo-commentary-principles.md](kanripo-commentary-principles.md)                                                    | KRP's interlinear commentary is final; what transfer may add (never undo)                   |
| [find-replace-planning.md](find-replace-planning.md)                                                                    | Find / replace                                                                              |
| [xpath-sidebar-planning.md](xpath-sidebar-planning.md)                                                                  | XPath sidebar                                                                               |
| [translation-planning.md](translation-planning.md)                                                                      | Translation pane (phases A–E + card reader — reference)                                     |
| [live-passage-citation-planning.md](live-passage-citation-planning.md)                                                  | Future Word/LO live passage citations (dream)                                               |
| [tagging-planning.md](tagging-planning.md)                                                                              | Keyboard tagging (mostly shipped — historical plan)                                         |
| [project-schema-planning.md](project-schema-planning.md)                                                                | Schema onboarding plan (mostly shipped — see schema_handling)                               |
| [sanmiao-grognard-integration.md](sanmiao-grognard-integration.md)                                                      | Sanmiao bridge design notes                                                                 |
| [versioning-planning.md](versioning-planning.md)                                                                        | Local history / time machine                                                                |
| [performance-planning.md](performance-planning.md) / [bundle-size-warning-planning.md](bundle-size-warning-planning.md) | Perf / first-load size                                                                      |
| [wikisource-import.md](wikisource-import.md)                                                                            | Wikisource browser extension + built-in TEI import                                          |
| [corpus-extraction-planning.md](corpus-extraction-planning.md)                                                          | Broader browser / corpus extract (Wikisource MVP started)                                   |
| [cbeta-import-planning.md](cbeta-import-planning.md)                                                                    | CBETA P5 plugin (bundled corpus, by juan, schema translation)                               |
| [autotagging-milestone-projection-planning.md](autotagging-milestone-projection-planning.md)                            | Match/tag across `<lb>`, `<pb>`, and `<choice>`; Phases A–E (setting in Settings → Project) |
| [bdrc-import-planning.md](bdrc-import-planning.md)                                                                      | BDRC plugin (extension, live PDI fetch, whole-volume Tibetan)                               |
| [bdrc-import-testing.md](bdrc-import-testing.md)                                                                        | BDRC import smoke-test checklist                                                            |
| [beta-plan.md](beta-plan.md)                                                                                            | Ship criteria                                                                               |

Related script notes: [scripts/extract-map-tile-bundles.md](../scripts/extract-map-tile-bundles.md).

Pack index JSON (schema + example): `authoritypacks-packs-index.schema.json`, `authoritypacks-packs-index.example.json`.

---

## Archive

Session logs, scratch notes, and superseded drafts: **[archive/](archive/)**.
