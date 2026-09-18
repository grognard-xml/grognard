import Autocomplete from '@mui/material/Autocomplete';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Divider from '@mui/material/Divider';
import HubOutlinedIcon from '@mui/icons-material/HubOutlined';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Typography from '@mui/material/Typography';
import { memo, useCallback, useEffect, useMemo, useRef, useState, startTransition } from 'react';
import { useTranslation } from 'react-i18next';
import { List as VirtualList } from 'react-window';
import type { RowComponentProps } from 'react-window';
import { foldForSearch } from '../../../../../packages/cwrc-leafwriter/src/utilities/romanize';
import type { EntityKind } from '../../../../../packages/cwrc-leafwriter/src/autoTagging/entities';
import { readPersistedAuthoritySettings } from '../../../../../packages/cwrc-leafwriter/src/autoTagging/authoritySettings';
import type { EntitySummary } from '../../../../../packages/cwrc-leafwriter/src/autoTagging/entityOps';
import type { EntityStore } from '../../../../../packages/cwrc-leafwriter/src/autoTagging/entityStore';
import {
  pickDefaultEntityId,
  readStoredKindFilter,
  writeLastEntityId,
  writeStoredKindFilter,
} from '../databaseViewPrefs';
import { getActiveProjectBundle } from '../activeProjectBundle';
import { readTranslationSettings } from '../translationSettings';
import {
  applyHygieneFinding,
  autoCleanEntities,
  authorityPeerToCompareCard,
  entityToCompareCard,
  harvestProposalToCompareCard,
  findingsFromAuthorityDuplicates,
  findingsFromHarvest,
  collectHarvestedWrappers,
  buildPersonPackLookupIndex,
  descriptionFromPackIndex,
  lookupPackPeers,
  scanBadPrimary,
  scanEmptyDescription,
  scanMissingFamilyOrGiven,
  scanNearDuplicates,
  scanRejectedBlockingGoodName,
  scanUnlinkedAuthorityHits,
  corroboratePackPeer,
  type HygieneFinding,
  type HygienePeer,
} from '../../../../../packages/cwrc-leafwriter/src/autoTagging/hygiene';
import { extractRegisteredEntityData } from '../../../../../packages/cwrc-leafwriter/src/plugins/entityDataExtractors';
import { backfillEntitiesSqlite } from '../../../../../packages/cwrc-leafwriter/src/autoTagging/sqliteAuthorityBackfill';
import { refreshCbdbConcordanceSqlite } from '../../../../../packages/cwrc-leafwriter/src/autoTagging/cbdbConcordance';
import { AUTHORITY_PACKS } from '../../../../../packages/cwrc-leafwriter/src/autoTagging/packPaths';
import { packRowsByIdsReader } from '../../../../../packages/cwrc-leafwriter/src/services/authority-pack-lookup';
import {
  PlaceComparisonMap,
  type MapPin,
} from '../../../../../packages/cwrc-leafwriter/src/autoTagging/mapView/PlaceComparisonMap';
import { useActions, useAppState } from '@src/overmind';
import { BackgroundJobBanner, useBackgroundJob, yieldToUi } from './BackgroundJobBanner';
import { EntityCompareCard } from './EntityCompareCard';
import { EntityNoteEditor } from './EntityNoteEditor';
import { databaseEntityLabel } from './databaseEntityLabel';
import { loadDatabaseWindowEntities } from './loadEntities';

type DatabaseView = 'project' | 'central';
type MainPane = 'detail' | 'issues';

/** Cheap yield for CPU-bound loops (no forced double paint). */
const yieldCpu = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const hasCbdbOrDila = (entity: EntitySummary): boolean =>
  entity.authorities.some((auth) => {
    const type = auth.type.toLowerCase();
    return type === 'cbdb' || type === 'dila';
  });

/** Dense two-line entity row height (name + romanization/id). */
const DATABASE_ENTITY_ROW_HEIGHT = 56;

interface DatabaseEntityRowData {
  entities: EntitySummary[];
  selectedIdSet: Set<string>;
  onSelect: (id: string, event: React.MouseEvent) => void;
}

/** Stable row component for react-window (must not be recreated each render). */
function DatabaseEntityRow({
  index,
  style,
  entities,
  selectedIdSet,
  onSelect,
}: RowComponentProps<DatabaseEntityRowData>) {
  const entity = entities[index];
  if (!entity) return null;
  return (
    <ListItemButton
      style={style}
      dense
      selected={selectedIdSet.has(entity.id)}
      onClick={(event) => onSelect(entity.id, event)}
      sx={{
        alignItems: 'flex-start',
        borderBottom: 1,
        borderColor: 'divider',
        py: 0.75,
      }}
    >
      <ListItemText
        primary={databaseEntityLabel(entity)}
        primaryTypographyProps={{ noWrap: true }}
      />
    </ListItemButton>
  );
}

/**
 * Virtualized sidebar list — only ~20–40 DOM rows exist at once.
 * Mounting tens of thousands of ListItemButtons made every click a multi-second
 * hit-test / React reconcile (see Performance panel “Hit test” ~1s).
 */
const DatabaseEntityList = memo(function DatabaseEntityList({
  entities,
  filtered,
  selectedIds,
  loading,
  onSelect,
  onSelectAllFiltered,
  onClearSelection,
}: {
  entities: EntitySummary[];
  filtered: EntitySummary[];
  selectedIds: string[];
  loading: boolean;
  onSelect: (id: string, event: React.MouseEvent) => void;
  onSelectAllFiltered: () => void;
  onClearSelection: () => void;
}) {
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const rowProps = useMemo(
    () => ({ entities: filtered, selectedIdSet, onSelect }),
    [filtered, selectedIdSet, onSelect],
  );
  const selectedInFilter = useMemo(
    () => filtered.filter((entity) => selectedIdSet.has(entity.id)).length,
    [filtered, selectedIdSet],
  );

  if (entities.length === 0 && loading) {
    return (
      <Box sx={{ p: 2, display: 'flex', justifyContent: 'center' }}>
        <CircularProgress size={24} />
      </Box>
    );
  }
  if (filtered.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
        No entities
      </Typography>
    );
  }
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <Stack
        direction="row"
        spacing={0.5}
        alignItems="center"
        sx={{ px: 1, py: 0.5, borderBottom: 1, borderColor: 'divider', flexShrink: 0 }}
      >
        <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>
          {selectedInFilter > 0 ? `${selectedInFilter} selected` : `${filtered.length} shown`}
        </Typography>
        <Button size="small" onClick={onSelectAllFiltered} sx={{ minWidth: 0, px: 0.75 }}>
          All
        </Button>
        <Button
          size="small"
          onClick={onClearSelection}
          disabled={selectedIds.length === 0}
          sx={{ minWidth: 0, px: 0.75 }}
        >
          Clear
        </Button>
      </Stack>
      <Box sx={{ flex: 1, minHeight: 0 }}>
        <VirtualList
          rowComponent={DatabaseEntityRow}
          rowCount={filtered.length}
          rowHeight={DATABASE_ENTITY_ROW_HEIGHT}
          rowProps={rowProps}
          style={{ height: '100%', width: '100%' }}
        />
      </Box>
    </Box>
  );
});

const KIND_LABEL: Record<EntityKind, string> = {
  person: 'Person',
  place: 'Place',
  org: 'Organization',
  work: 'Work',
  office: 'Office',
  thing: 'Thing',
};

const findingKindLabel = (kind: HygieneFinding['kind']): string => {
  switch (kind) {
    case 'familyPrefixedAltName':
      return '姓 on 字/號/法號';
    case 'missingFamilyOrGiven':
      return 'Missing 姓/名';
    case 'badRomanization':
      return 'Romanization';
    case 'badPrimary':
      return 'Primary name';
    case 'emptyDescription':
      return 'Empty description';
    case 'rejectedBlockingGoodName':
      return 'Rejected name';
    case 'authorityIdDuplicate':
      return 'Authority duplicate';
    case 'nearDuplicate':
      return 'Near duplicate';
    case 'unlinkedAuthorityHit':
      return 'Unlinked authority';
    case 'harvestWrapper':
      return 'Harvest';
    default:
      return kind;
  }
};

const highlightForFinding = (finding: HygieneFinding): string[] => {
  switch (finding.kind) {
    case 'familyPrefixedAltName':
      return ['otherNames'];
    case 'missingFamilyOrGiven':
      return ['familyName', 'givenName'];
    case 'badRomanization':
      return ['romanized'];
    case 'badPrimary':
      return ['primary'];
    case 'emptyDescription':
      return ['description'];
    case 'rejectedBlockingGoodName':
      return ['otherNames'];
    case 'unlinkedAuthorityHit':
      return ['authorities'];
    case 'harvestWrapper':
      return ['nationalities', 'origins', 'roles', 'nobleTitles'];
    default:
      return [];
  }
};

interface PendingApply {
  finding: HygieneFinding;
  keepId?: string;
}

/**
 * Issue kinds safe to accept en masse without per-item judgment.
 * 姓 on 字/號/法號 is mechanical once the scanner has identified the prefix.
 */
const BULK_ACCEPT_KINDS = new Set<HygieneFinding['kind']>(['familyPrefixedAltName']);

/** Optimistic in-memory update so the review cards stay accurate before Save. */
function applyFindingLocally(entity: EntitySummary, finding: HygieneFinding): EntitySummary {
  const p = finding.proposal;
  if (p.action === 'stripAltName') {
    return {
      ...entity,
      names: entity.names.map((name) => (name === p.fromText ? p.toText : name)),
      nameEntries: entity.nameEntries.map((entry) =>
        entry.text === p.fromText ? { ...entry, text: p.toText } : entry,
      ),
    };
  }
  if (p.action === 'setRomanized') {
    return { ...entity, romanized: p.text };
  }
  if (p.action === 'renamePrimary') {
    return {
      ...entity,
      names: [p.text, ...entity.names.slice(1)],
      nameEntries:
        entity.nameEntries.length > 0
          ? [{ ...entity.nameEntries[0]!, text: p.text }, ...entity.nameEntries.slice(1)]
          : entity.nameEntries,
    };
  }
  if (p.action === 'setDescription') {
    return { ...entity, description: p.text };
  }
  if (p.action === 'setFamilyGiven') {
    return {
      ...entity,
      familyName: p.familyName,
      givenName: p.givenName,
      romanized: p.romanizedName ?? entity.romanized,
    };
  }
  if (p.action === 'attachAuthority') {
    if (
      entity.authorities.some(
        (auth) =>
          auth.type.toLowerCase() === p.authorityType.toLowerCase() &&
          auth.value === p.authorityValue,
      )
    ) {
      return entity;
    }
    return {
      ...entity,
      authorities: [...entity.authorities, { type: p.authorityType, value: p.authorityValue }],
    };
  }
  return entity;
}

function idsRemovedByMerge(finding: HygieneFinding, keepId: string): string[] {
  const related =
    finding.relatedEntityIds ??
    (finding.peer?.kind === 'entity'
      ? [finding.entityId, finding.peer.entityId]
      : [finding.entityId]);
  return related.filter((id) => id !== keepId);
}

export const DatabaseWindow = () => {
  const { t, i18n } = useTranslation();
  const { config, rootPath } = useAppState().project;
  const { notifyViaSnackbar } = useActions().ui;
  const syncToCentral = config?.syncToCentral === true;

  const [databaseView, setDatabaseView] = useState<DatabaseView>(
    syncToCentral || !rootPath ? 'central' : 'project',
  );
  const [entities, setEntities] = useState<EntitySummary[]>([]);
  const [activeStore, setActiveStore] = useState<EntityStore | null>(null);
  const [projectStore, setProjectStore] = useState<EntityStore | null>(null);
  const [applyBusy, setApplyBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [kindFilter, setKindFilterState] = useState<EntityKind>(() => readStoredKindFilter());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const selectionAnchorRef = useRef<string | null>(null);

  const setKindFilter = useCallback((kind: EntityKind) => {
    setKindFilterState(kind);
    writeStoredKindFilter(kind);
  }, []);
  const [subtypeFilter, setSubtypeFilter] = useState<string>('');
  const thingTypeOptions = readPersistedAuthoritySettings()?.customThingTypes ?? [];
  useEffect(() => {
    if (kindFilter !== 'thing') setSubtypeFilter('');
  }, [kindFilter]);

  const [mainPane, setMainPane] = useState<MainPane>('detail');
  const [geoMapPin, setGeoMapPin] = useState<MapPin | null>(null);
  const [rightTab, setRightTab] = useState('cleaning');
  const [findings, setFindings] = useState<HygieneFinding[]>([]);
  const [findingIndex, setFindingIndex] = useState(0);
  const [projectLang, setProjectLang] = useState<string | null>(null);
  const [translationLanguages, setTranslationLanguages] = useState<string[]>([]);
  const [mergeKeepId, setMergeKeepId] = useState<string | null>(null);
  const [reloadBusy, setReloadBusy] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const pendingAppliesRef = useRef<PendingApply[]>([]);

  const { jobRunning, beginJob, updateJob, endJob, cancelJob } = useBackgroundJob();

  useEffect(() => {
    if (syncToCentral) setDatabaseView('central');
  }, [syncToCentral]);

  useEffect(() => {
    void (async () => {
      const globals = window as Window & {
        __leafWriterProject?: { getProjectSourceLanguage?: () => Promise<string | null> };
      };
      setProjectLang((await globals.__leafWriterProject?.getProjectSourceLanguage?.()) ?? null);
    })();
  }, []);

  // Project translation languages — widens the Wikidata backfill's title-label fetch
  // beyond en + the desktop UI language, same source as the entity editor's nudge chips.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const bundle = getActiveProjectBundle();
      if (!bundle) {
        if (!cancelled) setTranslationLanguages([]);
        return;
      }
      const settings = await readTranslationSettings(bundle);
      if (cancelled) return;
      setTranslationLanguages((settings?.languages ?? []).map((lang) => lang.code));
    })();
    return () => {
      cancelled = true;
    };
  }, [rootPath]);

  const reload = useCallback(async () => {
    const controller = beginJob('Reloading entities');
    setReloadBusy(true);
    setLoadError(null);
    try {
      const result = await loadDatabaseWindowEntities(databaseView, syncToCentral);
      if (controller.signal.aborted) return;
      setEntities(result.entities);
      setActiveStore(result.activeStore);
      setProjectStore(result.projectStore);
      setLoadError(result.error);
    } catch (error) {
      if (!controller.signal.aborted) {
        setLoadError(error instanceof Error ? error.message : String(error));
      }
    } finally {
      setReloadBusy(false);
      endJob();
    }
  }, [beginJob, databaseView, endJob, syncToCentral]);

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload on view change only
  }, [databaseView, syncToCentral]);

  useEffect(() => {
    // Fired by the Electron menu bridge when the user presses F5.
    const handleRefresh = () => {
      if (jobRunning) return;
      void reload();
    };
    window.addEventListener('desktop:refresh', handleRefresh);
    return () => window.removeEventListener('desktop:refresh', handleRefresh);
  }, [jobRunning, reload]);

  useEffect(() => {
    const unsubscribe = window.electronAPI?.onEntityDatabaseChanged?.(() => {
      void reload();
    });
    return () => unsubscribe?.();
  }, [reload]);

  const entityById = useMemo(() => {
    const map = new Map<string, EntitySummary>();
    for (const entity of entities) map.set(entity.id, entity);
    return map;
  }, [entities]);

  // Keep the detail pane on an entity in the active Type filter (last opened, else first).
  // Depends on entities/kindFilter only so an intentional empty selection can stick.
  useEffect(() => {
    if (entities.length === 0) {
      setSelectedId(null);
      setSelectedIds([]);
      selectionAnchorRef.current = null;
      return;
    }
    setSelectedId((prev) => {
      const current = prev ? entityById.get(prev) : undefined;
      if (current && current.kind === kindFilter) return prev;
      const next = pickDefaultEntityId(entities, kindFilter);
      setSelectedIds(next ? [next] : []);
      selectionAnchorRef.current = next;
      return next;
    });
  }, [entities, entityById, kindFilter]);

  const filtered = useMemo(() => {
    let list = entities.filter((entity) => entity.kind === kindFilter);
    if (kindFilter === 'thing' && subtypeFilter) {
      list = list.filter((entity) => entity.subtype === subtypeFilter);
    }
    const trimmed = search.trim();
    if (!trimmed) return list;
    const foldedQuery = foldForSearch(trimmed);
    if (foldedQuery) {
      list = list.filter((entity) =>
        [...entity.names, entity.romanized ?? '', entity.projectKey ?? '', entity.id].some(
          (value) => foldForSearch(value).includes(foldedQuery),
        ),
      );
      if (list.length > 0) return list;
    }
    try {
      const regex = new RegExp(trimmed, 'iu');
      list = list.filter(
        (entity) =>
          entity.names.some((name) => regex.test(name)) ||
          (entity.romanized && regex.test(entity.romanized)) ||
          (entity.projectKey && regex.test(entity.projectKey)) ||
          regex.test(entity.id),
      );
    } catch {
      // invalid regex — show unfiltered kind list
    }
    return list;
  }, [entities, kindFilter, subtypeFilter, search]);

  const selectedEntity = selectedId ? (entityById.get(selectedId) ?? null) : null;
  const currentFinding = findings[findingIndex] ?? null;

  const leftCard = useMemo(() => {
    if (mainPane === 'issues' && currentFinding) {
      const entity = entityById.get(currentFinding.entityId);
      if (!entity) return null;
      return entityToCompareCard(entity, {
        title: syncToCentral || databaseView === 'central' ? 'Central' : 'Project',
        highlightFields: highlightForFinding(currentFinding),
      });
    }
    if (selectedEntity) {
      return entityToCompareCard(selectedEntity, {
        title: syncToCentral || databaseView === 'central' ? 'Central' : 'Project',
      });
    }
    return null;
  }, [currentFinding, databaseView, entityById, mainPane, selectedEntity, syncToCentral]);

  const rightCard = useMemo(() => {
    if (mainPane !== 'issues' || !currentFinding) return null;
    if (currentFinding.kind === 'harvestWrapper') {
      const entity = entityById.get(currentFinding.entityId);
      return harvestProposalToCompareCard(currentFinding, entity?.names[0]);
    }
    if (currentFinding.peer?.kind === 'authority') {
      return authorityPeerToCompareCard(currentFinding.peer);
    }
    if (currentFinding.proposal.action === 'merge' || currentFinding.peer?.kind === 'entity') {
      const peerId =
        currentFinding.peer?.kind === 'entity'
          ? currentFinding.peer.entityId
          : currentFinding.relatedEntityIds?.find((id) => id !== currentFinding.entityId);
      const peer = peerId ? entityById.get(peerId) : null;
      if (!peer) return null;
      return entityToCompareCard(peer, { title: 'Compare' });
    }
    // Proposed fix preview as a synthetic right card for single-entity fixes
    const entity = entityById.get(currentFinding.entityId);
    if (!entity) return null;
    const proposed = { ...entity };
    const p = currentFinding.proposal;
    if (p.action === 'setRomanized') proposed.romanized = p.text;
    if (p.action === 'renamePrimary') proposed.names = [p.text, ...entity.names.slice(1)];
    if (p.action === 'setDescription') proposed.description = p.text;
    if (p.action === 'setFamilyGiven') {
      proposed.familyName = p.familyName;
      proposed.givenName = p.givenName;
      if (p.romanizedName) proposed.romanized = p.romanizedName;
    }
    if (p.action === 'stripAltName') {
      proposed.nameEntries = entity.nameEntries.map((entry) =>
        entry.text === p.fromText ? { ...entry, text: p.toText } : entry,
      );
    }
    return entityToCompareCard(proposed, {
      title: 'Proposed',
      highlightFields: highlightForFinding(currentFinding),
    });
  }, [currentFinding, entityById, mainPane]);

  const runScans = useCallback(async () => {
    if (!activeStore || jobRunning) return;
    // Starting a new scan abandons unsaved accepts from the previous review.
    pendingAppliesRef.current = [];
    setPendingCount(0);
    // Phases: name hygiene → near-dupes → authority dupes → pack index → pack match
    const controller = beginJob('Scanning entities', 6);
    try {
      updateJob({ done: 0, detail: 'Name hygiene…' });
      await yieldToUi();
      // Mechanical rules (姓+字 strip, orphan short parse, joinable pinyin,
      // dedupe, untyped) run via Auto-clean — not this review queue.
      const nameHygiene: HygieneFinding[] = [
        ...scanMissingFamilyOrGiven(entities, projectLang),
        ...scanBadPrimary(entities),
        ...scanEmptyDescription(entities),
      ];
      if (controller.signal.aborted) return;

      updateJob({ done: 1, detail: 'Near-duplicates…' });
      await yieldToUi();
      const nearDupes = scanNearDuplicates(entities);
      if (controller.signal.aborted) return;
      const deterministic = [...nameHygiene, ...nearDupes];

      let authorityDupes: HygieneFinding[] = [];
      try {
        updateJob({ done: 2, detail: 'Authority duplicates…' });
        await yieldToUi();
        const groups = await activeStore.sqliteAuthorityDuplicates();
        if (controller.signal.aborted) return;
        authorityDupes = findingsFromAuthorityDuplicates(
          (groups ?? []) as { type: string; value: string; entityIds: string[] }[],
        );
      } catch {
        // optional
      }

      const readPack = window.electronAPI?.authorityPackRead;
      const preferredByEntity = new Map<string, string[]>();
      const unlinkedInputs: {
        entity: EntitySummary;
        peers: Extract<HygienePeer, { kind: 'authority' }>[];
      }[] = [];
      const emptyDescEnriched: HygieneFinding[] = [];

      if (readPack) {
        updateJob({ done: 3, detail: 'Loading authority packs…' });
        await yieldToUi();
        const personPacks = AUTHORITY_PACKS.filter(
          (pack) => pack.id === 'cbdb-persons' || pack.id === 'dila-persons',
        );
        const packContents = await Promise.all(
          personPacks.map(async (pack) => {
            try {
              const content = await readPack(pack.id);
              const source = pack.id.startsWith('cbdb')
                ? 'cbdb'
                : pack.id.startsWith('dila')
                  ? 'dila'
                  : null;
              return source && content ? { source, content } : null;
            } catch {
              return null;
            }
          }),
        );
        if (controller.signal.aborted) return;
        const usable = packContents.filter(Boolean) as {
          source: 'cbdb' | 'dila';
          content: string | string[];
        }[];

        updateJob({ done: 4, detail: 'Indexing packs…' });
        await yieldToUi();
        const packIndex = await buildPersonPackLookupIndex(usable, {
          yieldEvery: 8_000,
          yieldFn: yieldCpu,
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;

        const people = entities.filter((entity) => entity.kind === 'person');
        const emptyById = new Map(
          deterministic
            .filter((f) => f.kind === 'emptyDescription')
            .map((f) => [f.entityId, f] as const),
        );

        // Preferred alt names for rejected-name scan — no pack I/O needed.
        for (const entity of people) {
          if (!hasCbdbOrDila(entity)) continue;
          const preferred: string[] = [];
          for (const entry of entity.nameEntries) {
            if (entry.type === 'courtesy' || entry.type === 'art' || entry.type === 'dharma') {
              preferred.push(entry.text);
            }
          }
          if (entity.givenName) preferred.push(entity.givenName);
          if (preferred.length) preferredByEntity.set(entity.id, preferred);
        }

        // Empty-description enrichment: only entities already flagged.
        for (const [entityId, emptyFinding] of emptyById) {
          const entity = entityById.get(entityId);
          if (!entity || entity.description?.trim()) continue;
          let description: string | undefined;
          for (const auth of entity.authorities) {
            description = descriptionFromPackIndex(packIndex, auth.type, auth.value);
            if (description) break;
          }
          if (description) {
            emptyDescEnriched.push({
              ...emptyFinding,
              peer: undefined,
              evidence: 'Empty description; authority text available',
              proposal: { action: 'setDescription', text: description },
            });
          }
        }

        // Pack matching: only unlinked people (the expensive-looking counter).
        const unlinkedPeople = people.filter((entity) => !hasCbdbOrDila(entity));
        updateJob({
          total: Math.max(unlinkedPeople.length, 1),
          done: 0,
          detail: 'Matching packs…',
        });
        await yieldToUi();

        let lastPaint = 0;
        for (let index = 0; index < unlinkedPeople.length; index += 1) {
          if (controller.signal.aborted) return;
          const entity = unlinkedPeople[index]!;
          const now = performance.now();
          if (now - lastPaint >= 250) {
            lastPaint = now;
            updateJob({
              done: index,
              detail: entity.names[0] ?? entity.id,
            });
            await yieldToUi();
          } else if (index > 0 && index % 500 === 0) {
            await yieldCpu();
          }

          const queryNames: string[] = [];
          const seenNames = new Set<string>();
          for (const name of entity.names) {
            if (!/\p{Script=Han}/u.test(name)) continue;
            const key = name.normalize('NFC').trim();
            if (!key || seenNames.has(key)) continue;
            seenNames.add(key);
            queryNames.push(key);
            if (queryNames.length >= 3) break;
          }
          if (queryNames.length === 0) continue;
          const peers = lookupPackPeers(packIndex, queryNames).filter((peer) =>
            corroboratePackPeer(entity, peer),
          );
          if (peers.length > 0) unlinkedInputs.push({ entity, peers });
        }
        updateJob({ done: unlinkedPeople.length, detail: 'Finishing…' });
      } else {
        // Still collect preferred names when packs are unavailable.
        for (const entity of entities) {
          if (entity.kind !== 'person' || !hasCbdbOrDila(entity)) continue;
          const preferred: string[] = [];
          for (const entry of entity.nameEntries) {
            if (entry.type === 'courtesy' || entry.type === 'art' || entry.type === 'dharma') {
              preferred.push(entry.text);
            }
          }
          if (entity.givenName) preferred.push(entity.givenName);
          if (preferred.length) preferredByEntity.set(entity.id, preferred);
        }
        updateJob({ done: 5, detail: 'Finishing…' });
      }

      if (controller.signal.aborted) return;
      const rejected = scanRejectedBlockingGoodName(entities, preferredByEntity);
      const unlinked = scanUnlinkedAuthorityHits(unlinkedInputs);

      const withoutEmpty = deterministic.filter((f) => f.kind !== 'emptyDescription');
      const next = [
        ...authorityDupes,
        ...withoutEmpty,
        ...emptyDescEnriched,
        ...rejected,
        ...unlinked,
      ];
      startTransition(() => {
        setFindings(next);
        setFindingIndex(0);
        setMainPane('issues');
        if (next[0]?.proposal.action === 'merge') {
          setMergeKeepId(next[0].proposal.keepId);
        }
      });
      notifyViaSnackbar({
        message: t('LWC.desktop.database_window.scan_found_issues', { count: next.length }),
        options: { variant: next.length ? 'info' : 'success' },
      });
    } catch (error) {
      if (!controller.signal.aborted) {
        notifyViaSnackbar({
          message: error instanceof Error ? error.message : String(error),
          options: { variant: 'error' },
        });
      }
    } finally {
      endJob();
    }
  }, [
    activeStore,
    beginJob,
    endJob,
    entities,
    entityById,
    jobRunning,
    notifyViaSnackbar,
    projectLang,
    t,
    updateJob,
  ]);

  const runHarvest = useCallback(async () => {
    if (!activeStore || !rootPath || jobRunning) {
      if (!rootPath) {
        notifyViaSnackbar({
          message: t('LWC.desktop.database_window.harvest_needs_project'),
          options: { variant: 'warning' },
        });
      }
      return;
    }
    const listFiles = window.electronAPI?.listProjectXmlFiles;
    const readFile = window.electronAPI?.readFile;
    if (!listFiles || !readFile) {
      notifyViaSnackbar({
        message: t('LWC.desktop.database_window.harvest_apis_unavailable'),
        options: { variant: 'error' },
      });
      return;
    }
    const controller = beginJob('Harvesting wrappers');
    try {
      updateJob({ detail: 'Listing project files…' });
      await yieldToUi();
      const files = await listFiles(rootPath);
      if (controller.signal.aborted) return;
      updateJob({ total: Math.max(files.length, 1), done: 0 });
      const wrappers = [];
      for (let index = 0; index < files.length; index += 1) {
        if (controller.signal.aborted) return;
        const file = files[index]!;
        updateJob({ done: index, detail: file.name });
        if (index % 5 === 0) await yieldToUi();
        try {
          const xml = await readFile(file.path);
          const doc = new DOMParser().parseFromString(xml, 'application/xml');
          if (doc.getElementsByTagName('parsererror').length > 0) continue;
          const relative = file.path.startsWith(rootPath)
            ? file.path.slice(rootPath.length).replace(/^[/\\]/, '')
            : file.name;
          const documentKey = relative.replace(/\\/g, '/');
          wrappers.push(
            ...collectHarvestedWrappers(doc, documentKey, (wrapper, key) =>
              extractRegisteredEntityData({ wrapper, documentKey: key }),
            ),
          );
        } catch {
          // skip unreadable / unparseable files
        }
      }
      if (controller.signal.aborted) return;
      updateJob({ done: files.length, detail: 'Building review queue…' });
      await yieldToUi();
      const next = findingsFromHarvest(wrappers, entityById);
      startTransition(() => {
        setFindings(next);
        setFindingIndex(0);
        setMainPane('issues');
      });
      notifyViaSnackbar({
        message: t('LWC.desktop.database_window.harvest_found_wrappers', { count: next.length }),
        options: { variant: next.length ? 'info' : 'success' },
      });
    } catch (error) {
      if (!controller.signal.aborted) {
        notifyViaSnackbar({
          message: error instanceof Error ? error.message : String(error),
          options: { variant: 'error' },
        });
      }
    } finally {
      endJob();
    }
  }, [
    activeStore,
    beginJob,
    endJob,
    entityById,
    jobRunning,
    notifyViaSnackbar,
    rootPath,
    t,
    updateJob,
  ]);

  const acceptFinding = useCallback(() => {
    if (!currentFinding) return;
    const keepId =
      currentFinding.proposal.action === 'merge'
        ? (mergeKeepId ?? currentFinding.proposal.keepId)
        : undefined;
    pendingAppliesRef.current.push({ finding: currentFinding, keepId });
    setPendingCount(pendingAppliesRef.current.length);

    // Optimistic local update for the review cards (DB write waits for Save).
    if (
      currentFinding.proposal.action !== 'merge' &&
      currentFinding.proposal.action !== 'markDuplicateIntentional' &&
      currentFinding.proposal.action !== 'ingestHarvest'
    ) {
      setEntities((prev) =>
        prev.map((entity) =>
          entity.id === currentFinding.entityId
            ? applyFindingLocally(entity, currentFinding)
            : entity,
        ),
      );
    }

    const dropIds =
      currentFinding.proposal.action === 'merge' && keepId
        ? new Set(idsRemovedByMerge(currentFinding, keepId))
        : null;

    setFindings((prev) => {
      const withoutCurrent = prev.filter((_, i) => i !== findingIndex);
      if (!dropIds || dropIds.size === 0) return withoutCurrent;
      return withoutCurrent.filter((finding) => {
        if (dropIds.has(finding.entityId)) return false;
        if (finding.relatedEntityIds?.some((id) => dropIds.has(id))) return false;
        if (finding.peer?.kind === 'entity' && dropIds.has(finding.peer.entityId)) return false;
        return true;
      });
    });
    setFindingIndex((i) => Math.max(0, Math.min(i, findings.length - 2)));
  }, [currentFinding, findingIndex, findings.length, mergeKeepId]);

  const bulkAcceptCounts = useMemo(() => {
    const counts = new Map<HygieneFinding['kind'], number>();
    for (const finding of findings) {
      if (!BULK_ACCEPT_KINDS.has(finding.kind)) continue;
      counts.set(finding.kind, (counts.get(finding.kind) ?? 0) + 1);
    }
    return [...counts.entries()].filter(([, count]) => count > 0);
  }, [findings]);

  const acceptAllOfKind = useCallback(
    (kind: HygieneFinding['kind']) => {
      if (!BULK_ACCEPT_KINDS.has(kind)) return;
      const batch = findings.filter((finding) => finding.kind === kind);
      if (batch.length === 0) return;

      for (const finding of batch) {
        pendingAppliesRef.current.push({ finding });
      }
      setPendingCount(pendingAppliesRef.current.length);

      const byEntity = new Map<string, HygieneFinding[]>();
      for (const finding of batch) {
        const list = byEntity.get(finding.entityId);
        if (list) list.push(finding);
        else byEntity.set(finding.entityId, [finding]);
      }
      setEntities((prev) =>
        prev.map((entity) => {
          const fixes = byEntity.get(entity.id);
          if (!fixes) return entity;
          return fixes.reduce((next, finding) => applyFindingLocally(next, finding), entity);
        }),
      );

      startTransition(() => {
        setFindings((prev) => prev.filter((finding) => finding.kind !== kind));
        setFindingIndex(0);
      });
      notifyViaSnackbar({
        message: t('LWC.desktop.database_window.queued_fixes', {
          count: batch.length,
          kind: findingKindLabel(kind),
        }),
        options: { variant: 'success' },
      });
    },
    [findings, notifyViaSnackbar, t],
  );

  const skipFinding = useCallback(() => {
    setFindings((prev) => prev.filter((_, i) => i !== findingIndex));
    setFindingIndex((i) => Math.max(0, Math.min(i, findings.length - 2)));
  }, [findingIndex, findings.length]);

  const markIntentional = useCallback(() => {
    if (!currentFinding?.relatedEntityIds) return;
    pendingAppliesRef.current.push({
      finding: {
        ...currentFinding,
        proposal: {
          action: 'markDuplicateIntentional',
          entityIds: currentFinding.relatedEntityIds,
        },
      },
    });
    setPendingCount(pendingAppliesRef.current.length);
    skipFinding();
  }, [currentFinding, skipFinding]);

  const flushPendingApplies = useCallback(async () => {
    if (!activeStore) return 0;
    const queued = pendingAppliesRef.current;
    if (queued.length === 0) return 0;
    const controller = beginJob('Saving accepted fixes', queued.length);
    let saved = 0;
    try {
      for (let index = 0; index < queued.length; index += 1) {
        if (controller.signal.aborted) break;
        const item = queued[index]!;
        updateJob({
          done: index,
          detail: item.finding.evidence.slice(0, 80),
        });
        if (index % 25 === 0) await yieldToUi();
        await applyHygieneFinding(activeStore, item.finding, { keepId: item.keepId });
        saved += 1;
      }
    } finally {
      pendingAppliesRef.current = queued.slice(saved);
      setPendingCount(pendingAppliesRef.current.length);
      endJob();
    }
    return saved;
  }, [activeStore, beginJob, endJob, updateJob]);

  const saveAndExitReview = useCallback(async () => {
    setApplyBusy(true);
    try {
      const saved = await flushPendingApplies();
      setFindings([]);
      setFindingIndex(0);
      setMainPane('detail');
      if (saved > 0) {
        notifyViaSnackbar({
          message: t('LWC.desktop.database_window.saved_fixes', { count: saved }),
          options: { variant: 'success' },
        });
        await reload();
      }
    } catch (error) {
      notifyViaSnackbar({
        message: error instanceof Error ? error.message : String(error),
        options: { variant: 'error' },
      });
    } finally {
      setApplyBusy(false);
    }
  }, [flushPendingApplies, notifyViaSnackbar, reload, t]);

  const leaveReview = useCallback(() => {
    const abandoned = pendingAppliesRef.current.length;
    pendingAppliesRef.current = [];
    setPendingCount(0);
    setFindings([]);
    setFindingIndex(0);
    setMainPane('detail');
    if (abandoned > 0) {
      notifyViaSnackbar({
        message: t('LWC.desktop.database_window.left_review_discarded', { count: abandoned }),
        options: { variant: 'warning' },
      });
    }
  }, [notifyViaSnackbar, t]);

  const runBackfill = useCallback(async () => {
    if (!activeStore || jobRunning) return;
    const scopedIds = selectedIds.length > 0 ? selectedIds : undefined;
    const controller = beginJob(
      scopedIds
        ? t('LWC.desktop.database_window.job_backfilling_selected', { count: scopedIds.length })
        : t('LWC.desktop.database_window.job_backfilling_all'),
    );
    try {
      const readPack = window.electronAPI?.authorityPackRead;
      if (!readPack) throw new Error(t('LWC.desktop.database_window.authority_packs_unavailable'));
      updateJob({
        detail: scopedIds
          ? t('LWC.desktop.database_window.job_reading_entity')
          : t('LWC.desktop.database_window.job_concordance'),
      });
      await yieldToUi();
      // Concordance is a whole-database apply — skip for selected-entity refresh.
      if (!scopedIds && projectStore && databaseView !== 'central') {
        try {
          await refreshCbdbConcordanceSqlite(projectStore, readPack);
        } catch {
          // non-fatal
        }
      }
      if (controller.signal.aborted) return;
      updateJob({ detail: t('LWC.desktop.database_window.job_reading_packs') });
      const lookupPackRowsByIds = packRowsByIdsReader();
      const result = await backfillEntitiesSqlite(activeStore, {
        entityIds: scopedIds,
        // Person enrichment uses id lookup in main (full CBDB pack hangs the UI).
        // Keep readPackFile for smaller office-name attach scans when needed.
        readPackFile: readPack,
        lookupPackRowsByIds,
        projectLang,
        desktopLanguage: i18n.language,
        translationLanguages,
        signal: controller.signal,
        expandWikidataWorks: false,
        lookupAuthorityRef: window.electronAPI?.authorityRefLookup,
        yieldFn: yieldToUi,
        onProgress: (progress) => {
          updateJob({
            done: progress.done,
            total: Math.max(progress.total, 1),
            detail: progress.entityLabel ?? undefined,
          });
        },
      });
      if (controller.signal.aborted) return;
      if (!scopedIds && projectStore && databaseView !== 'central') {
        try {
          updateJob({ detail: t('LWC.desktop.database_window.job_reapplying_concordance') });
          await refreshCbdbConcordanceSqlite(projectStore, readPack);
        } catch {
          // non-fatal
        }
      }
      notifyViaSnackbar({
        message: t('LWC.desktop.database_window.backfill_result', {
          names: result.namesAdded,
          entities: result.entitiesUpdated,
        }),
        options: { variant: 'success' },
      });
      await reload();
    } catch (error) {
      if (!controller.signal.aborted) {
        notifyViaSnackbar({
          message: error instanceof Error ? error.message : String(error),
          options: { variant: 'error' },
        });
      }
    } finally {
      endJob();
    }
  }, [
    activeStore,
    beginJob,
    databaseView,
    endJob,
    i18n.language,
    jobRunning,
    notifyViaSnackbar,
    projectLang,
    projectStore,
    reload,
    selectedIds,
    t,
    translationLanguages,
    updateJob,
  ]);

  const runAutoClean = useCallback(async () => {
    if (!activeStore || jobRunning) return;
    const controller = beginJob(t('LWC.desktop.database_window.job_auto_cleaning'));
    try {
      const report = await autoCleanEntities(activeStore, entities, projectLang, {
        signal: controller.signal,
        onProgress: (done, total, detail) => {
          updateJob({ done, total: Math.max(total, 1), detail });
        },
      });
      if (controller.signal.aborted) return;
      const total =
        report.strippedFamilyPrefixed +
        report.parsedFamilyGiven +
        report.dedupedNames +
        report.removedNan +
        report.removedInvalidFamilyGiven +
        report.removedUntyped +
        report.promotedRomanizations +
        report.fixedRomanization;
      notifyViaSnackbar({
        message:
          total === 0
            ? t('LWC.desktop.database_window.auto_clean_nothing')
            : t('LWC.desktop.database_window.auto_clean_result', report),
        options: { variant: 'success' },
      });
      await reload();
    } catch (error) {
      if (!controller.signal.aborted) {
        notifyViaSnackbar({
          message: error instanceof Error ? error.message : String(error),
          options: { variant: 'error' },
        });
      }
    } finally {
      endJob();
    }
  }, [
    activeStore,
    beginJob,
    endJob,
    entities,
    jobRunning,
    notifyViaSnackbar,
    projectLang,
    reload,
    t,
    updateJob,
  ]);

  const selectEntity = useCallback(
    (id: string, event?: React.MouseEvent) => {
      const additive = Boolean(event?.metaKey || event?.ctrlKey);
      const range = Boolean(event?.shiftKey);
      const selected = entityById.get(id);

      if (range && selectionAnchorRef.current) {
        const anchorIdx = filtered.findIndex((entity) => entity.id === selectionAnchorRef.current);
        const targetIdx = filtered.findIndex((entity) => entity.id === id);
        if (anchorIdx >= 0 && targetIdx >= 0) {
          const [lo, hi] = anchorIdx < targetIdx ? [anchorIdx, targetIdx] : [targetIdx, anchorIdx];
          const rangeIds = filtered.slice(lo, hi + 1).map((entity) => entity.id);
          setSelectedIds((prev) => (additive ? [...new Set([...prev, ...rangeIds])] : rangeIds));
          setSelectedId(id);
          if (selected) writeLastEntityId(selected.kind, id);
          setMainPane('detail');
          return;
        }
      }

      if (additive) {
        setSelectedIds((prev) => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return [...next];
        });
      } else {
        setSelectedIds([id]);
      }
      setSelectedId(id);
      selectionAnchorRef.current = id;
      if (selected) writeLastEntityId(selected.kind, id);
      setMainPane('detail');
    },
    [entityById, filtered],
  );

  const selectAllFiltered = useCallback(() => {
    const ids = filtered.map((entity) => entity.id);
    setSelectedIds(ids);
    if (ids[0]) {
      setSelectedId(ids[0]);
      selectionAnchorRef.current = ids[0];
    }
  }, [filtered]);

  const clearSelection = useCallback(() => {
    setSelectedIds([]);
    setSelectedId(null);
    selectionAnchorRef.current = null;
  }, []);

  useEffect(() => {
    if (currentFinding?.proposal.action === 'merge') {
      setMergeKeepId(currentFinding.proposal.keepId);
    } else {
      setMergeKeepId(null);
    }
  }, [currentFinding]);

  const listLoading = reloadBusy;

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        minHeight: 0,
        bgcolor: 'background.default',
        position: 'relative',
      }}
    >
      <BackgroundJobBanner onCancel={jobRunning ? cancelJob : undefined} />
      <Stack
        direction="row"
        spacing={1}
        alignItems="center"
        sx={{
          px: 1.5,
          py: 1,
          borderBottom: 1,
          borderColor: 'divider',
          bgcolor: 'background.paper',
          flexShrink: 0,
          flexWrap: 'wrap',
          gap: 1,
        }}
      >
        <Typography variant="subtitle2" sx={{ mr: 1 }}>
          {t('LWC.desktop.database_window.title', { defaultValue: 'Database' })}
        </Typography>
        {!syncToCentral && (
          <Button
            size="small"
            variant="contained"
            color={databaseView === 'central' ? 'error' : 'success'}
            onClick={() => setDatabaseView((prev) => (prev === 'central' ? 'project' : 'central'))}
            startIcon={<HubOutlinedIcon fontSize="small" />}
            disabled={jobRunning}
          >
            {databaseView === 'central' ? 'Central' : 'Project'}
          </Button>
        )}
        <Autocomplete
          size="small"
          options={(Object.keys(KIND_LABEL) as EntityKind[]).map((value) => ({
            value,
            label: KIND_LABEL[value],
          }))}
          value={{ value: kindFilter, label: KIND_LABEL[kindFilter] }}
          onChange={(_e, option) => option && setKindFilter(option.value)}
          getOptionLabel={(option) => option.label}
          isOptionEqualToValue={(a, b) => a.value === b.value}
          sx={{ width: 140 }}
          renderInput={(params) => <TextField {...params} label="Type" />}
        />
        {kindFilter === 'thing' && thingTypeOptions.length > 0 && (
          <Autocomplete
            size="small"
            options={thingTypeOptions}
            value={thingTypeOptions.find((option) => option.id === subtypeFilter) ?? null}
            onChange={(_e, option) => setSubtypeFilter(option?.id ?? '')}
            getOptionLabel={(option) => option.label}
            isOptionEqualToValue={(a, b) => a.id === b.id}
            sx={{ width: 160 }}
            renderInput={(params) => (
              <TextField {...params} label={t('LWC.desktop.sidebar.database.subtype_filter')} />
            )}
          />
        )}
        <TextField
          size="small"
          placeholder={t('LWC.desktop.sidebar.database.search_placeholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          sx={{ minWidth: 220, flex: 1 }}
        />
        <Button size="small" variant="outlined" onClick={() => void reload()} disabled={jobRunning}>
          Reload
        </Button>
        <Chip
          size="small"
          label={
            pendingCount > 0
              ? `Issues ${findings.length} · ${pendingCount} to save`
              : `Issues ${findings.length}`
          }
          color={findings.length || pendingCount ? 'warning' : 'default'}
          onClick={() => setMainPane('issues')}
          variant={mainPane === 'issues' ? 'filled' : 'outlined'}
        />
        <Chip
          size="small"
          label="Detail"
          onClick={() => setMainPane('detail')}
          variant={mainPane === 'detail' ? 'filled' : 'outlined'}
        />
        {(mainPane === 'issues' || findings.length > 0 || pendingCount > 0) && (
          <>
            <Button
              size="small"
              variant="contained"
              onClick={() => void saveAndExitReview()}
              disabled={applyBusy || jobRunning || (findings.length === 0 && pendingCount === 0)}
            >
              {pendingCount > 0 ? `Save ${pendingCount} & exit` : 'Exit review'}
            </Button>
            <Button
              size="small"
              variant="outlined"
              color="inherit"
              onClick={leaveReview}
              disabled={applyBusy || jobRunning}
            >
              Leave without saving
            </Button>
          </>
        )}
      </Stack>

      {loadError && (
        <Typography color="error" sx={{ px: 2, py: 1 }}>
          {loadError}
        </Typography>
      )}

      <Box sx={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <Box
          sx={{
            width: 300,
            flexShrink: 0,
            borderRight: 1,
            borderColor: 'divider',
            bgcolor: 'background.paper',
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
            overflow: 'hidden',
          }}
        >
          <DatabaseEntityList
            entities={entities}
            filtered={filtered}
            selectedIds={selectedIds}
            loading={listLoading}
            onSelect={selectEntity}
            onSelectAllFiltered={selectAllFiltered}
            onClearSelection={clearSelection}
          />
        </Box>

        <Box
          sx={{
            flex: 1,
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            p: 2,
            gap: 2,
            overflow: 'auto',
          }}
        >
          {mainPane === 'issues' && (
            <>
              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                <Typography variant="subtitle2">
                  {currentFinding
                    ? `${findingIndex + 1}/${findings.length}: ${findingKindLabel(currentFinding.kind)}`
                    : pendingCount > 0
                      ? `Queue empty — ${pendingCount} accepted, not saved yet`
                      : 'No issues'}
                </Typography>
                {currentFinding && (
                  <Typography variant="body2" color="text.secondary">
                    {currentFinding.evidence}
                  </Typography>
                )}
                <Box sx={{ flex: 1 }} />
                {bulkAcceptCounts.map(([kind, count]) => (
                  <Button
                    key={kind}
                    size="small"
                    variant="contained"
                    color="secondary"
                    onClick={() => acceptAllOfKind(kind)}
                    disabled={applyBusy}
                  >
                    {`Accept all ${count} ${findingKindLabel(kind)}`}
                  </Button>
                ))}
                {findings.length > 0 && (
                  <>
                    <Button
                      size="small"
                      onClick={() => setFindingIndex((i) => Math.max(0, i - 1))}
                      disabled={applyBusy || findingIndex <= 0}
                    >
                      Prev
                    </Button>
                    <Button
                      size="small"
                      onClick={() => setFindingIndex((i) => Math.min(findings.length - 1, i + 1))}
                      disabled={applyBusy || findingIndex >= findings.length - 1}
                    >
                      Next
                    </Button>
                  </>
                )}
                {currentFinding && (
                  <>
                    {(currentFinding.kind === 'authorityIdDuplicate' ||
                      currentFinding.kind === 'nearDuplicate') && (
                      <Button size="small" onClick={markIntentional} disabled={applyBusy}>
                        Mark intentional
                      </Button>
                    )}
                    <Button size="small" onClick={skipFinding} disabled={applyBusy}>
                      Skip
                    </Button>
                    <Button
                      size="small"
                      variant="contained"
                      onClick={acceptFinding}
                      disabled={applyBusy || !currentFinding}
                    >
                      {currentFinding.proposal.action === 'merge'
                        ? 'Merge'
                        : currentFinding.proposal.action === 'attachAuthority'
                          ? 'Link'
                          : currentFinding.proposal.action === 'restoreName'
                            ? 'Restore'
                            : currentFinding.proposal.action === 'ingestHarvest'
                              ? 'Insert'
                              : 'Accept'}
                    </Button>
                  </>
                )}
              </Stack>

              {currentFinding?.proposal.action === 'merge' && currentFinding.relatedEntityIds && (
                <Stack direction="row" spacing={1}>
                  {currentFinding.relatedEntityIds.map((id) => (
                    <Chip
                      key={id}
                      label={`Keep ${entityById.get(id)?.names[0] ?? id}`}
                      color={mergeKeepId === id ? 'primary' : 'default'}
                      onClick={() => setMergeKeepId(id)}
                      variant={mergeKeepId === id ? 'filled' : 'outlined'}
                    />
                  ))}
                </Stack>
              )}

              <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems="stretch">
                {leftCard && (
                  <EntityCompareCard
                    model={leftCard}
                    selected={
                      currentFinding?.proposal.action === 'merge' &&
                      mergeKeepId === currentFinding.entityId
                    }
                    onSelect={
                      currentFinding?.proposal.action === 'merge'
                        ? () => setMergeKeepId(currentFinding.entityId)
                        : undefined
                    }
                  />
                )}
                {rightCard && (
                  <EntityCompareCard
                    model={rightCard}
                    selected={
                      currentFinding?.proposal.action === 'merge' &&
                      Boolean(
                        mergeKeepId &&
                        mergeKeepId !== currentFinding.entityId &&
                        currentFinding.relatedEntityIds?.includes(mergeKeepId),
                      )
                    }
                    onSelect={
                      currentFinding?.proposal.action === 'merge' &&
                      currentFinding.peer?.kind === 'entity'
                        ? (() => {
                            const peerId =
                              currentFinding.peer?.kind === 'entity'
                                ? currentFinding.peer.entityId
                                : null;
                            return peerId ? () => setMergeKeepId(peerId) : undefined;
                          })()
                        : undefined
                    }
                  />
                )}
              </Stack>

              {pendingCount > 0 && (
                <Typography variant="caption" color="text.secondary">
                  Accepted fixes stay local until you click Save &amp; exit.
                </Typography>
              )}
            </>
          )}

          {mainPane === 'detail' && leftCard && (
            <EntityCompareCard
              model={leftCard}
              detail
              onOpenMap={
                leftCard.kind === 'place' && leftCard.location
                  ? () =>
                      setGeoMapPin({
                        id: selectedId ?? leftCard.subtitle ?? leftCard.title,
                        label: 'A',
                        color: '#d32f2f',
                        lat: leftCard.location!.lat,
                        lon: leftCard.location!.lon,
                        sources: leftCard.location!.source ? [leftCard.location!.source] : [],
                        description: leftCard.primaryName ?? leftCard.title,
                        memberIds: [selectedId ?? leftCard.subtitle ?? leftCard.title],
                      })
                  : undefined
              }
            />
          )}
          {mainPane === 'detail' && !leftCard && (
            <Typography color="text.secondary">Select an entity</Typography>
          )}
        </Box>

        <Box
          sx={{
            width: 300,
            flexShrink: 0,
            borderLeft: 1,
            borderColor: 'divider',
            bgcolor: 'background.paper',
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
          }}
        >
          <Tabs
            value={rightTab}
            onChange={(_event, value: string) => setRightTab(value)}
            variant="fullWidth"
            sx={{ minHeight: 42 }}
          >
            <Tab
              value="cleaning"
              label={t('LWC.desktop.database_window.tab_cleaning')}
              sx={{ minHeight: 42 }}
            />
            <Tab
              value="notes"
              label={t('LWC.desktop.database_window.tab_notes')}
              sx={{ minHeight: 42 }}
            />
          </Tabs>
          <Divider />
          {rightTab === 'cleaning' && (
            <Stack spacing={1.5} sx={{ p: 1.5, overflow: 'auto' }}>
              <Typography variant="subtitle2">
                {t('LWC.desktop.database_window.maintenance_title')}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {t('LWC.desktop.database_window.maintenance_intro')}
              </Typography>

              <Stack spacing={0.5}>
                <Button
                  fullWidth
                  size="small"
                  variant="outlined"
                  onClick={() => void runBackfill()}
                  disabled={jobRunning || !activeStore || selectedIds.length === 0}
                >
                  {selectedIds.length > 0
                    ? t('LWC.desktop.database_window.backfill_count', {
                        count: selectedIds.length,
                      })
                    : t('LWC.desktop.database_window.backfill')}
                </Button>
                <Typography variant="caption" color="text.secondary">
                  {selectedIds.length > 0
                    ? t('LWC.desktop.database_window.backfill_hint_selected', {
                        count: selectedIds.length,
                      })
                    : t('LWC.desktop.database_window.backfill_hint_none')}
                </Typography>
              </Stack>

              <Stack spacing={0.5}>
                <Button
                  fullWidth
                  size="small"
                  variant="outlined"
                  color="warning"
                  onClick={() => void runAutoClean()}
                  disabled={jobRunning || !activeStore}
                >
                  {t('LWC.desktop.database_window.auto_clean')}
                </Button>
                <Typography variant="caption" color="text.secondary">
                  {t('LWC.desktop.database_window.auto_clean_hint')}
                </Typography>
              </Stack>

              <Stack spacing={0.5}>
                <Button
                  fullWidth
                  size="small"
                  variant="contained"
                  onClick={() => void runScans()}
                  disabled={jobRunning || !activeStore}
                >
                  {t('LWC.desktop.database_window.run_scans')}
                </Button>
                <Typography variant="caption" color="text.secondary">
                  {t('LWC.desktop.database_window.run_scans_hint')}
                </Typography>
              </Stack>

              <Stack spacing={0.5}>
                <Button
                  fullWidth
                  size="small"
                  variant="contained"
                  color="secondary"
                  onClick={() => void runHarvest()}
                  disabled={jobRunning || !activeStore || !rootPath}
                >
                  {t('LWC.desktop.database_window.harvest')}
                </Button>
                <Typography variant="caption" color="text.secondary">
                  {t('LWC.desktop.database_window.harvest_hint')}
                </Typography>
              </Stack>
            </Stack>
          )}
          {rightTab === 'notes' && (
            <Box sx={{ flex: 1, minHeight: 0, p: 1.5 }}>
              <EntityNoteEditor store={activeStore} entityId={selectedId} />
            </Box>
          )}
        </Box>
      </Box>
      <PlaceComparisonMap
        open={geoMapPin != null}
        pins={geoMapPin ? [geoMapPin] : []}
        title={geoMapPin?.description ?? ''}
        onClose={() => setGeoMapPin(null)}
      />
    </Box>
  );
};
