# Entity database cross-device sync — planning

**Status (2026-09-01):** **Phases 0–4 built and run end-to-end**, plus
provider-independence groundwork. Cloud backup shipped; D1 sync Worker
deployable from `workers/entity-sync/` and the wire contract frozen as
[`entity-sync-protocol.md`](entity-sync-protocol.md) with an implementation-
independent conformance suite; the client engine is wired to IPC, an auto-sync
timer, a **Settings › Profil › Cross-device sync** panel with inline conflict
resolution, and a pluggable auth mode (`github` / `bearer` work; `oidc`
stubbed). End-user setup:
[entity-db-multi-machine-setup.md](entity-db-multi-machine-setup.md). Remaining:
sync-coverage gaps (relations, cross-refs, merges), content-hash fidelity, a
second-device soak, the OIDC flow, and a non-Cloudflare server. **Achievements
blob sync** (`GET/PUT /sync/achievements`) ships with entity sync.

Context: the live `entities.sqlite` cannot live in a file-sync folder
(Nextcloud/Dropbox/iCloud) — the sync client races SQLite's `-wal`/`-shm` and
corrupts the file (observed 2026-09-01: `database disk image is malformed`,
recovered from a clean Nextcloud conflicted-copy). This plan replaces
file-level sync with (0) an off-machine backup and (1+) row-level logical sync.

Decisions locked:

- **Central store:** Cloudflare D1 + a Worker (matches the existing R2 usage,
  the `grognard-leaderboard` Worker, and the GitHub OAuth device-flow identity in
  `leaderboardAuth.ts`).
- **Collaboration model:** one owner, several devices. No per-user roles.
- **Conflict unit:** whole entity, manual resolution (matches the unused
  `sync_conflicts` table shape in `entityDbSqlite/schema.ts`).

## Reuse inventory (already in `apps/desktop/src/entityDbSqlite`)

| Piece                                   | Location                     | Role in sync                               |
| --------------------------------------- | ---------------------------- | ------------------------------------------ |
| `entities.revision` + `bumpEntity()`    | `schema.ts`, `repository.ts` | per-entity dirty counter (no new column)   |
| `computeEntityContentHash()`            | `xmlCodec.ts`                | per-entity fingerprint for change/conflict |
| `exportEntityElementXml()`              | `xmlCodec.ts`                | deterministic single-entity TEI payload    |
| `replaceEntityContentFrom()`            | `repository.ts`              | apply a snapshot onto a local row          |
| `transaction()`                         | `repository.ts`              | nestable `BEGIN IMMEDIATE`                 |
| `central_mappings` (in use)             | `schema.ts`                  | local id ↔ central id ↔ `user_stable_id`   |
| `sync_state`, `sync_conflicts` (unused) | `schema.ts`                  | cursor/hash bookkeeping + conflict queue   |

## Phases

| #   | Scope                                                                                              | Status      |
| --- | -------------------------------------------------------------------------------------------------- | ----------- |
| 0   | Cloud backup: `VACUUM INTO` snapshot → gzip → R2, on a timer + on quit; restore                    | **shipped** |
| 1   | D1 schema + Worker (`/sync/pull`, `/sync/push`) + single-owner auth                                | **built**   |
| 2   | Client sync engine: dirty set, pull/apply, push, `sync_state` + conflict bookkeeping               | **built**   |
| 2b  | Wire it up: sync config, GitHub token from `leaderboardAuth`, IPC, auto-sync timer                 | **built**   |
| 3   | (folded into 2) conflict detection → `sync_conflicts`, entity held back from push while open       | **built**   |
| 4   | Renderer UI: sync status affordance + inline conflict resolution                                   | **built**   |
| 5   | Hardening: large-batch cold sync, interrupted-sync recovery, backfill hash-guard, two-machine soak | **in progress** — interrupted-sync recovery (mid-push race) and the hash-guard shipped; large-batch cold sync unaudited and the soak itself not started |

Full phase detail, endpoints, and the D1 data model: see the working plan
(shared as a Claude artifact 2026-09-01).

---

## Phase 1 — the sync Worker (built)

Lives in [`workers/entity-sync/`](../workers/entity-sync/) — a standalone
Cloudflare Worker + D1, not an npm workspace (own `package.json`, `tsconfig`,
`node_modules`). Its [README](../workers/entity-sync/README.md) has deploy
steps; below is the design.

### Data model (`migrations/0001_initial.sql`)

```sql
central_entities(
  central_id, owner_id, kind, revision, content_xml, content_hash,
  deleted, seq, updated_at,
  PRIMARY KEY (owner_id, central_id)
)                                   -- INDEX central_entities_pull (owner_id, seq)
sync_counter(owner_id PRIMARY KEY, last_seq)
```

`content_xml` is the client's `exportEntityElementXml()`; `content_hash` its
`computeEntityContentHash()`. The server stores both verbatim and never
reparses. `seq` is a per-owner monotonic counter bumped once per push by
compare-and-swap on `sync_counter` — it is the pull cursor.

### Endpoints

Every non-health request: `Authorization: Bearer <github-token>` → the Worker
calls `GET https://api.github.com/user` → rejects any id ≠ `OWNER_GITHUB_ID`
(401 missing/invalid, 403 wrong account). Scope is irrelevant.

| Route        | Method | Notes                                                                                                                                            |
| ------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/`          | GET    | Unauthenticated health check.                                                                                                                    |
| `/sync/pull` | GET    | `?since=<seq>&limit=<n>` (default 500, max 1000) → `{ changes[], highSeq, hasMore }`, `seq`-ordered.                                             |
| `/sync/push` | POST   | `{ entities: [...] }`, ≤ 200 (413 over) → `{ applied[], reconciled[], conflicts[], highSeq }`. Writes for one push commit together (`D1.batch`). |

### Push classification

`centralId` is omitted on an entity's first push; the server then uses
`localId` as the central id. So `id = centralId ?? localId`, and `baseRevision`
is the last central revision the client held for it.

| Case                                          | Result                                                                                                                |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `id` not on the server                        | insert; `revision = max(baseRevision, 0) + 1` (1 for a true first push; higher for a re-seed against a rebuilt store) |
| `baseRevision` == stored revision             | fast-forward, `revision = baseRevision + 1`                                                                           |
| stale `baseRevision`, `contentHash` == stored | `reconciled` — no write, client adopts server revision as baseline (absorbs bulk re-hash churn)                       |
| stale `baseRevision`, content differs         | `conflict` — no write; response carries server `revision`/`hash`/`xml` for the client's queue                         |

`contentXml` and `contentHash` may be empty only when `deleted` is true.

### Testing

`npm test` in `workers/entity-sync/` — `@cloudflare/vitest-pool-workers` runs
against a real local D1 with migrations auto-applied (20 tests: protocol
validation, every push case, `localId`-adoption, re-seed, delete propagation,
seq pagination, the three auth outcomes, the 413 cap). The GitHub lookup is
injected via `createWorker({ verifyGitHubUser })` — no network, no module
mocking.

### Still open for Phase 1

- **Redeploy** (`wrangler deploy` in `workers/entity-sync/`) — the deployed
  version predates two contract tweaks: a push without `centralId` now adopts
  `localId` as the central id (so local id == central id everywhere), and
  `contentHash` may be empty when `deleted`.
- Decide whether to cache the GitHub `/user` verification (KV, short TTL) or
  keep re-verifying every request as now.

---

## Phase 2 — the client sync engine (built)

All in `apps/desktop/src/`. Main-process, no UI. 27 tests
(`entitySync.test.ts`, `entitySyncClient.test.ts`,
`entityDbSqlite/entitySyncRepo.test.ts`).

| File                               | Role                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `entitySyncClient.ts`              | `EntitySyncClient` — `pull(since)` / `push(entities)` against the Worker. Bearer token from an injected `getToken`. Retries network / 5xx / 429 with backoff; 401/403 → `EntitySyncAuthError`, not retried. Injectable `fetchImpl`.                                                                                                                                                                                                                                                                                                                      |
| `entityDbSqlite/entitySyncRepo.ts` | The SQLite ops the schema was missing: cursor + device id in `database_metadata`; `listDirtyForSync` (no `sync_state` row, or `project_revision` ≠ `entities.revision`; excludes entities with an open conflict); `getSyncState` / `upsertSyncState`; `openConflict` (one open row per entity pair) / `listOpenConflicts` / `resolveConflict`; `applyRemoteEntity` — imports the remote TEI element into an in-memory repo and copies it over via `replaceEntityContentFrom`, creating the local row if absent, un-tombstoning if central un-deleted it. |
| `entitySync.ts`                    | `runSync({ repo, client })` — pull, apply/queue, push, then a drain-pull; `resolveConflictKeepLocal` / `resolveConflictKeepRemote`.                                                                                                                                                                                                                                                                                                                                                                                                                      |

**`runSync` flow**

1. **Pull** from the local cursor, page by page. Per change: if `sync_state`
   already records this exact `(revision, hash)` → skip (it's usually our own
   just-pushed write coming back). Else if the local entity is dirty and its
   hash differs from the incoming one → `openConflict('pull-collision')`, leave
   local untouched. Else → `applyRemoteEntity` + `upsertSyncState`. Cursor
   advances per page inside one `repo.transaction()`.
2. **Push** the dirty set in ≤200-entity chunks. `baseRevision` =
   `sync_state.central_revision` (0 if never synced); `centralId` omitted on a
   first push. Per outcome: `applied` / `reconciled` → `upsertSyncState` with
   the server's revision and our hash (they now match); `conflict` →
   `openConflict('push-rejected')`.
3. **Drain-pull** again so a concurrent device's writes that landed mid-push
   are picked up before `runSync` returns.

**Since local id == central id** (Worker change), `sync_state.central_entity_id`
carries the mapping and `central_mappings` is left entirely to the existing
local-file bridge.

**Conflict resolution logic** (Phase 4 wires buttons to these):
`resolveConflictKeepRemote` applies the stored central snapshot and clears the
row; `resolveConflictKeepLocal` sets `sync_state.project_revision` to a
sentinel so the entity stays dirty and re-pushes against the server's current
revision (a clean fast-forward), then clears the row.

## Phase 2b — wiring (built)

- **`entitySyncConfig.ts`** — `{ enabled, endpoint, intervalMinutes }` as plain
  JSON in `userData/entity-sync-config.json` (endpoint isn't secret; the token
  lives in `leaderboard-auth.json`).
- **`entitySyncService.ts`** — resolves the live `entities.sqlite`, reuses the
  shared `repositoryFor(path)` (exported from `readService.ts`), builds an
  `EntitySyncClient` with `getToken = getCachedLeaderboardToken`, runs
  `runSync` single-flight, writes an `entity-sync-last-run.json` marker.
  `startSyncTimer` (interval from config) and `scheduleLaunchSync` (~8 s after
  ready) both fire from `main.ts` `whenReady`.
- **IPC** (`main.ts` → `preload.ts` `electronAPI`): `entitySync:getStatus` →
  `entitySyncGetStatus`, `:setConfig` → `entitySyncSetConfig` (restarts the
  timer), `:runNow` → `entitySyncRunNow`, `:listConflicts` →
  `entitySyncListConflicts`, `:resolveConflict` → `entitySyncResolveConflict`
  (`{ id, keep: 'local' | 'remote' }`).

Drive it from the DevTools console until the panel lands:

```js
await window.electronAPI.entitySyncSetConfig({
  enabled: true,
  endpoint: 'https://grognard-entity-sync.<your-subdomain>.workers.dev',
});
await window.electronAPI.entitySyncRunNow();
await window.electronAPI.entitySyncGetStatus();
```

Needs a signed-in GitHub identity (the leaderboard sign-in) and the entity
database on local disk (not the old ShareDocs path).

**Hardening (built):** each request has a 30 s `AbortController` timeout
(`EntitySyncClient.requestTimeoutMs`, retried); `runSync` takes a `signal` and
aborts between pages/chunks; the service wraps a run in a 15 min watchdog and
force-clears its single-flight guard if a run outlives it, so a black-holed
`fetch` can never lock sync out permanently. `onProgress` logs
`[entitySync] push chunk N/M …` to the main-process console.

**Write-quota resilience & first-load seeding.** A large first sync exceeds
D1's free-tier write cap (100k rows/day, and each `central_entities` insert is
~2 index rows). Handling:

- Migration `0003` rebuilds `central_entities` `WITHOUT ROWID` — one fewer
  index write per row.
- The Worker returns `429 { quota: true }` when D1 refuses a write for quota;
  `EntitySyncClient` raises `EntitySyncQuotaError` (no retry), `runSync`
  returns `stoppedEarly: 'write-quota'` with partial progress, and the service
  writes a `write-quota` marker and skips automatic runs for ~1h (manual "Sync
  now" still tries).
- `apps/desktop/scripts/generate-entity-sync-seed.mjs` emits `seed-NNN.sql`
  files (INSERTs at `revision = 1` + the `sync_counter` row) from a local
  `entities.sqlite`. Bulk-import with `wrangler d1 import … --file` (batches and retries), one per day if
  needed. The next in-app **Sync now** then reconciles everything locally
  (reads only) via the pull fast-path below — no D1 writes.
- Pull fast-path: when a pulled change's `contentHash` already equals the local
  entity's, `applyPulledChange` records `sync_state` and skips the
  import/replace round-trip. Speeds every drain-pull and makes post-seed
  adoption cheap.

### Still open

- ~~**Content-hash fidelity**~~ — `computeEntityContentHash` is now versioned
  (`CONTENT_HASH_VERSION`) with automatic re-baselining on a version bump (see
  Phase 5 below). Still unverified: whether `applyRemoteEntity` and the seed
  script reproduce the pusher's hash byte-for-byte *within* one version across
  app builds — a spike showed the transfer is faithful, but this hasn't been
  re-checked since.
- **Second-device soak** — two project folders against one central store for a
  week; watch conflict rate and D1 usage.

---

## Phase 4 — the UI (built)

**Settings › Profil › _Cross-device sync_**
(`packages/cwrc-leafwriter/src/dialogs/settings/sections/profile/desktop-entity-sync.tsx`,
via the `__ljbCommonsUi` bridge — `entitySyncStatus` +
`setEntitySyncConfig` / `runEntitySyncNow` / `listEntitySyncConflicts` /
`resolveEntitySyncConflict`):

- enable toggle, endpoint, interval; **Save** and **Sync now**
- "sign in to GitHub first" warning when `signedIn` is false
- a status line: `Synced through change #<cursor>` + last-run summary
  (`pulled N, pushed M` or the error / skip reason)
- when `openConflicts > 0`: a red banner and a **Review** button that expands an
  inline list — per entity: id, reason, `your rev ↔ server rev`, **Keep mine** /
  **Keep theirs** (→ `resolveConflictKeepLocal` / `…KeepRemote`), and a
  **Show both versions** toggle with the two TEI snapshots.

First full sync (large authority files) still has to be kicked off once — the
panel's **Sync now**, or it happens on the auto-timer.

Validated end-to-end 2026-09-01 on a single machine against a deployed Worker.
See [entity-db-multi-machine-setup.md](entity-db-multi-machine-setup.md) for
second-device onboarding.

The panel also carries an **Authentication** selector (below).

---

## Provider independence (built)

Groundwork so the sync isn't wedded to Cloudflare or GitHub. The **server**
stays Cloudflare-for-now; a second implementation is deferred (see
[`docs/entity-sync-protocol.md`](entity-sync-protocol.md) § "Left to the
server").

**The wire contract is now a spec.**
[`docs/entity-sync-protocol.md`](entity-sync-protocol.md) is normative;
`workers/entity-sync/test/conformance.ts` is its executable form — 12 scenarios
run by `test/sync.test.ts` against the Worker in-process, and by a future
server against its own HTTP client. The Worker README calls itself the
reference implementation.

**Client auth is pluggable.** `config.auth.mode` ∈ `github | bearer | oidc`;
`entitySyncTokenProvider.ts` maps it to a token source, and the rest of the
client only ever sees a `getToken` function.

| mode     | token source                                                      | status                                                                          |
| -------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `github` | `getCachedLeaderboardToken()`                                     | works (default)                                                                 |
| `bearer` | static token, `safeStorage`-encrypted in `entity-sync-bearer.enc` | works                                                                           |
| `oidc`   | device flow against `auth.issuer` / `clientId`                    | stub — `resolveTokenProvider` rejects with a clear message; config fields exist |

`isSignedInForSync(config)` drives the panel's status and the run's
`not-signed-in` skip, per mode. `setEntitySyncConfig` accepts a transient
`bearerToken` that is peeled off and encrypted, never stored in the plaintext
config or returned.

### Still open

- **OIDC device flow** — implement `resolveTokenProvider`'s `oidc` branch
  (reuse the `leaderboardAuth.ts` device-flow pattern against an arbitrary
  issuer). Pairs with a non-Cloudflare server.
- **A second server** (Node + Postgres on huma-num infra) implementing the
  protocol and passing `conformance.ts`.

---

## Phase 0 — cloud backup (implemented)

### What it does

- **Timer:** every `intervalMinutes` (default 15) while the app runs, if backup
  is enabled and configured.
- **On quit:** one best-effort snapshot, run in parallel with renderer teardown
  and capped at 12 s so it cannot hang shutdown (`runQuitBackup`).
- **Snapshot:** `VACUUM INTO` a temp file over a **read-only** connection (safe
  while the app holds its own handle), `PRAGMA integrity_check`, gzip level 6,
  sha256. Measured on the real DB: ~1 s VACUUM (124 MB) + ~3 s gzip → **~30 MB**
  uploaded per snapshot.
- **Upload:** `PUT <prefix>snapshots/entities-<UTC>-<reason>.sqlite.gz` to R2,
  with `x-amz-meta-{sha256,source-bytes,app-version,reason}`.
- **Retention** (`selectSnapshotsToPrune`): keep the newest 24, then the newest
  one per UTC day for 14 days, delete the rest. Steady state ≈ 38 objects ≈
  1.1 GB — inside the R2 free tier; egress is free.
- **Restore** (`restoreSnapshot`): download → sha256 check → gunzip → integrity
  check → move live `entities.sqlite`(+`-wal`/`-shm`) into a `pre-restore-<UTC>/`
  folder → swap the snapshot in. Caller must close SQLite handles first and
  reload/relaunch after.
- **Startup gate** (`checkEntityDbIntegrity`): cheap `integrity_check`; a
  failure is meant to drive a "restore from cloud" prompt (wired in Phase 0 UI).

### Files

| File                                                    | Purpose                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/desktop/src/r2Client.ts`                          | S3-compatible client for R2. SigV4 signed by hand (no AWS SDK), region `auto`. `putObject`/`getObject`/`headObjectMetadata`/`deleteObject`/`listObjects` (paginated). Signing verified against the canonical AWS SigV4 `get-vanilla` vector.                                                     |
| `apps/desktop/src/entityDbBackupConfig.ts`              | Config persisted **encrypted** via Electron `safeStorage` at `userData/entity-db-backup-config.enc` (the R2 secret is a write credential — not plaintext like the LLM key). `readBackupConfig` (full, main-only), `readBackupConfigView` (redacted, `hasSecret` boolean, safe for the renderer). |
| `apps/desktop/src/entityDbBackup.ts`                    | Orchestration: `createSnapshot`, `runBackup`, `runQuitBackup`, `startBackupTimer`/`stopBackupTimer`, `selectSnapshotsToPrune`, `probeBackupTarget`, `listCloudSnapshots`, `restoreSnapshot`, `checkEntityDbIntegrity`, last-backup marker at `userData/entity-db-last-backup.json`.              |
| `apps/desktop/src/*.test.ts` (r2Client, entityDbBackup) | SigV4 canonicalization + vector, retention logic, key parsing.                                                                                                                                                                                                                                   |

### IPC (`main.ts` → `preload.ts` `electronAPI`)

| Channel                         | Renderer method                | Notes                                                                            |
| ------------------------------- | ------------------------------ | -------------------------------------------------------------------------------- |
| `entityDbBackup:getStatus`      | `entityDbBackupGetStatus`      | `{ config (view), lastBackup, integrity }`                                       |
| `entityDbBackup:setConfig`      | `entityDbBackupSetConfig`      | merge-patch; blank `secretAccessKey` keeps the stored secret; restarts the timer |
| `entityDbBackup:clearConfig`    | `entityDbBackupClearConfig`    |                                                                                  |
| `entityDbBackup:testConnection` | `entityDbBackupTestConnection` | signed LIST against the prefix; merges form patch over stored secret             |
| `entityDbBackup:runNow`         | `entityDbBackupRunNow`         | `runBackup('manual')` — runs even when disabled                                  |
| `entityDbBackup:listSnapshots`  | `entityDbBackupListSnapshots`  |                                                                                  |
| `entityDbBackup:restore`        | `entityDbBackupRestore`        | closes cached read repos first; caller must reload after                         |

### Configuring (until the Settings panel exists)

End-user setup — creating the R2 bucket and a bucket-scoped API token, then the
DevTools-console `entityDbBackupSetConfig` / `…TestConnection` / `…RunNow`
calls, plus restore and troubleshooting:
[entity-db-cloud-backup-setup.md](entity-db-cloud-backup-setup.md).

### Done

- **Settings UI** — Settings › Profil › _Cloud backup_
  (`sections/profile/desktop-entity-backup.tsx`, via the `__ljbCommonsUi`
  bridge): enable toggle, credential form, Test connection, Save, Back up now,
  last-backup line, integrity-failure alert, `safeStorage`-unavailable warning,
  and a Restore… expander (snapshot dropdown + armed confirm).
- **Corrupt-DB startup prompt** — `maybePromptEntityDbIntegrityRestore()` in
  `main.ts` runs `checkEntityDbIntegrity()` once per launch (from
  `startBackgroundServices`, after the window is up) and, on failure, offers a
  native dialog to restore on the spot — closing cached read handles,
  restoring, and relaunching — or to continue anyway. Offers **both** backup
  sources when present, since not every user configures R2: the latest
  local-file (`.sqlite.gz`) cloud snapshot, and/or the latest local Time
  Machine snapshot of the central-database folder (the same rollback
  `TimeMachineDialog.tsx`'s central tab offers, reimplemented against the
  filesystem directly — including the order-log union that preserves
  merge/delete orders across the rollback — since that dialog needs a project
  already open and can't be relied on this early in startup). Falls back to a
  clear message when neither is available (a Turso logical export still needs
  the manual replay flow).

### Still open for Phase 0

- **Packaged-build check** that `safeStorage` encryption is available on the
  target OSes (Linux needs an unlocked keyring).
