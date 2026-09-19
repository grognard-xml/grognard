import AutorenewIcon from '@mui/icons-material/Autorenew';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import CheckIcon from '@mui/icons-material/Check';
import ClearIcon from '@mui/icons-material/Clear';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import HubOutlinedIcon from '@mui/icons-material/HubOutlined';
import FactCheckOutlinedIcon from '@mui/icons-material/FactCheckOutlined';
import MergeIcon from '@mui/icons-material/Merge';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import PlaylistAddIcon from '@mui/icons-material/PlaylistAdd';
import RefreshIcon from '@mui/icons-material/Refresh';
import RoomIcon from '@mui/icons-material/Room';
import SearchIcon from '@mui/icons-material/Search';
import UndoIcon from '@mui/icons-material/Undo';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Autocomplete,
  Badge,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  FormControlLabel,
  IconButton,
  InputAdornment,
  LinearProgress,
  MenuItem,
  Radio,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { List } from 'react-window';
import type { RowComponentProps } from 'react-window';
import type { NotificationProps } from '@src/types';
import {
  ENTITY_KINDS,
  type AuthorityId,
  type EntityKind,
} from '../../../../../packages/cwrc-leafwriter/src/autoTagging/entities';
import { readPersistedAuthoritySettings } from '../../../../../packages/cwrc-leafwriter/src/autoTagging/authoritySettings';
import {
  groupFieldAssertions,
  type CentralMergeConflict,
  type DuplicateGroup,
  type ConcordanceImportResult,
  type EntityAssertionSummary,
  type EntitySummary,
  type DatePrecision,
  type FieldAssertionGroups,
  normalizeAuthorityValue,
} from '../../../../../packages/cwrc-leafwriter/src/autoTagging/entityOps';
import { refreshCbdbConcordanceSqliteDebounced } from '../../../../../packages/cwrc-leafwriter/src/autoTagging/cbdbConcordance';
import {
  SQLITE_REQUIRED_PANEL_MESSAGE as SQLITE_REQUIRED_MESSAGE,
  SQLITE_REQUIRED_MESSAGE as SQLITE_REQUIRED_BRIDGE_MESSAGE,
} from '../../../../../packages/cwrc-leafwriter/src/autoTagging/sqliteRequired';
import {
  ALL_NAME_TYPES,
  type NameTypeId,
} from '../../../../../packages/cwrc-leafwriter/src/autoTagging/nameTypes';
import { parseAuthorityUri } from '../../../../../packages/cwrc-leafwriter/src/autoTagging/lookupResolve';
import { backfillEntitiesSqlite } from '../../../../../packages/cwrc-leafwriter/src/autoTagging/sqliteAuthorityBackfill';
import { entitySummaryFromSqlite } from '../../../../../packages/cwrc-leafwriter/src/autoTagging/sqliteSummary';
import { autoSyncEntitiesToCentral } from '../../../../../packages/cwrc-leafwriter/src/autoTagging/autoSync';
import {
  PlaceComparisonMap,
  type MapPin,
} from '../../../../../packages/cwrc-leafwriter/src/autoTagging/mapView/PlaceComparisonMap';
import {
  countUnlinkedPedbEntities,
  synchronizeMirroredProject,
} from '../../../../../packages/cwrc-leafwriter/src/autoTagging/synchronizedMirror';
import {
  setBulkSyncProgress,
  getBulkSyncProgress,
} from '../../../../../packages/cwrc-leafwriter/src/autoTagging/bulkSyncProgress';
import { suggestPersonRomanization } from '../../../../../packages/cwrc-leafwriter/src/plugins/personNameDefaults';
import { isAiUiFeatureEnabled } from '../../../../../packages/cwrc-leafwriter/src/autoTagging/aiUiFeatures';
import {
  cachedPackReader,
  packRowsByIdsReader,
} from '../../../../../packages/cwrc-leafwriter/src/services/authority-pack-lookup';
import {
  centralEntityStoreFromDesktop,
  desktopEntityFileApi,
  entityStoreFromDesktop,
  type EntityStore,
} from '../../../../../packages/cwrc-leafwriter/src/autoTagging/entityStore';
import { readOrMintUserStableId } from '../../../../../packages/cwrc-leafwriter/src/autoTagging/userStableId';
import {
  loadOpenWarnings,
  resolveWarning,
  warningKey,
  type LookupWarning,
} from '../../../../../packages/cwrc-leafwriter/src/autoTagging/lookupWarnings';
import {
  autoRomanizeForKind,
  canAutoRomanize,
  foldForSearch,
} from '../../../../../packages/cwrc-leafwriter/src/utilities/romanize';
import { openExternalUrl } from '../../../../../packages/cwrc-leafwriter/src/utilities/DOM';
import { useActions, useAppState } from '@src/overmind';
import { EntityLookupField, type EntityLookupValue } from '@src/desktop/EntityLookupField';
import { readStoredKindFilter, writeStoredKindFilter } from '../databaseViewPrefs';
import { EntityNamesAccordion, type NameRow } from './EntityNamesAccordion';
import { entityLookupDialogAtom } from '@cwrc/leafwriter';
import { getDefaultStore } from 'jotai';
import { RESET } from 'jotai/utils';
import { db } from '../../../../../packages/cwrc-leafwriter/src/db';
import { applyKeyRemapAcrossProjects, type KeyRemapSummary } from '../entityDb/applyKeyRemap';
import {
  computeMergeDocket,
  loadBridgeContext,
  promoteEntities,
  syncNonConflictingLinkedEntities,
} from '../entityDb/bridge';
import type { BulkBridgeProposal } from '../../../../../packages/cwrc-leafwriter/src/autoTagging/bulkBridgeImport';
import { authorityLookupUrl } from '../entityDb/authorityLinks';
import { BridgeInboxDialog } from './BridgeInboxDialog';
import { MergeDocketDialog } from './MergeDocketDialog';
import { SourceBadges } from '../../../../../packages/cwrc-leafwriter/src/autoTagging/SourceBadges';
import {
  entityKindSupportsVernacularGloss,
  entityLikeFromNameEntries,
  missingTranslationLangs,
} from '../../../../../packages/cwrc-leafwriter/src/layout/entityFields/entityDisplay';
import { languageLabelForCode } from '../../../../../packages/cwrc-leafwriter/src/utilities/languageCodes';
import { getActiveProjectBundle } from '../activeProjectBundle';
import { readTranslationSettings } from '../translationSettings';
import type { TranslationLanguage } from '../translationTypes';
import {
  DESKTOP_DATABASE_ENTITY_EVENT,
  DESKTOP_LEFT_PANEL_EVENT,
  DESKTOP_XPATH_SEARCH_EVENT,
  type DesktopDatabaseEntityDetail,
} from '../desktopLeftPanelBridge';
import { canonicalNationalityLabel } from '../../../../../packages/cwrc-leafwriter/src/autoTagging/dynastyCrosswalk';
import { extractWikidataId } from '../../../../../packages/cwrc-leafwriter/src/autoTagging/disambiguationCandidates';

/**
 * Ordinal of a legacy sequential id (`person-000042` → 42); UUID ids have none.
 * TODO(sync Phase 3): default the survivor to the oldest `changed` timestamp
 * instead of id order once Absorb is reworked — for UUID ids the id carries no
 * age. The merge dialog lets the user override this default either way.
 */
const idOrdinal = (id: string): number => {
  const match = id.match(/-(\d+)$/);
  return match ? parseInt(match[1]!, 10) : Number.MAX_SAFE_INTEGER;
};

/** Default merge survivor: lowest sequential ordinal, then lexby id for a stable UUID default. */
const oldestId = (ids: string[]): string =>
  [...ids].sort((a, b) => idOrdinal(a) - idOrdinal(b) || a.localeCompare(b))[0]!;

/** Drop ids that are not in the currently loaded list (e.g. leftover Project↔Central selections). */
const pruneToKnownEntityIds = (ids: Iterable<string>, known: EntitySummary[]): string[] => {
  const knownIds = new Set(known.map((entity) => entity.id));
  return [...ids].filter((id) => knownIds.has(id));
};

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Attach corpus (PEDB) and central (CEDB) keys to summaries for the database
 * viewer. Concordance lives on the project store; when browsing central we join
 * it so the list can show project keys (and search them) without exposing
 * central ids in the find field.
 */
const attachProjectCentralKeys = async (
  summaries: EntitySummary[],
  options: {
    viewingCentral: boolean;
    projectStore: EntityStore | null;
    centralFolder: string | null | undefined;
  },
): Promise<EntitySummary[]> => {
  if (summaries.length === 0) return summaries;

  if (!options.viewingCentral) {
    const api = desktopEntityFileApi();
    if (!options.projectStore || !api) {
      return summaries.map((summary) => ({
        ...summary,
        projectKey: summary.projectKey ?? summary.id,
        centralKey: summary.centralKey ?? null,
      }));
    }
    try {
      const { id: userStableId } = await readOrMintUserStableId(api, options.centralFolder ?? null);
      const mappings = await options.projectStore.sqliteListAllCentralMappings(userStableId);
      const byProject = new Map(mappings.map((row) => [row.projectEntityId, row.centralId]));
      return summaries.map((summary) => ({
        ...summary,
        projectKey: summary.id,
        centralKey: byProject.get(summary.id) ?? null,
      }));
    } catch {
      return summaries.map((summary) => ({
        ...summary,
        projectKey: summary.id,
        centralKey: summary.centralKey ?? null,
      }));
    }
  }

  const api = desktopEntityFileApi();
  if (!options.projectStore || !api) {
    return summaries.map((summary) => ({
      ...summary,
      projectKey: summary.projectKey ?? null,
      centralKey: summary.id,
    }));
  }
  try {
    const { id: userStableId } = await readOrMintUserStableId(api, options.centralFolder ?? null);
    const mappings = await options.projectStore.sqliteListAllCentralMappings(userStableId);
    const byCentral = new Map(mappings.map((row) => [row.centralId, row.projectEntityId]));
    return summaries.map((summary) => ({
      ...summary,
      projectKey: byCentral.get(summary.id) ?? null,
      centralKey: summary.id,
    }));
  } catch {
    return summaries.map((summary) => ({
      ...summary,
      projectKey: summary.projectKey ?? null,
      centralKey: summary.id,
    }));
  }
};

/** Project / corpus key shown in the list (null → "(central)" only). */
const listProjectKey = (entity: EntitySummary): string | null => entity.projectKey ?? null;

const normalizedAuthorityRefs = (refs: AuthorityId[]): AuthorityId[] =>
  refs
    .map((ref) => ({ ...ref, value: normalizeAuthorityValue(ref.type, ref.value) }))
    .filter(
      (ref, index, all) =>
        all.findIndex(
          (candidate) =>
            candidate.type.toLowerCase() === ref.type.toLowerCase() &&
            candidate.value === ref.value,
        ) === index,
    );

const authoritySourceFromLookupRef = (ref?: string): string | undefined => {
  if (!ref) return undefined;
  if (/wikidata\.org/i.test(ref)) return 'Wikidata';
  if (/dila\.edu\.tw/i.test(ref)) return 'DILA';
  if (/cbdb\.fas\.harvard\.edu/i.test(ref)) return 'CBDB';
  return undefined;
};

const authorityBadgeGroups = (refs: AuthorityId[]): { ref: AuthorityId; count: number }[] => {
  const groups: { ref: AuthorityId; count: number }[] = [];
  for (const ref of refs) {
    const existing = groups.find(
      (group) => group.ref.type.toLowerCase() === ref.type.toLowerCase(),
    );
    if (existing) existing.count += 1;
    else groups.push({ ref, count: 1 });
  }
  return groups;
};

const lookupEntityTypeForKind = (kind: EntityKind): string =>
  kind === 'org' ? 'organization' : kind;

const sortAuthoritiesByPreference = (
  refs: AuthorityId[],
  order: Record<string, string[]>,
  kind: EntityKind,
): AuthorityId[] => {
  const preferred = order[lookupEntityTypeForKind(kind)] ?? [];
  const rank = new Map(preferred.map((authority, index) => [authority.toLowerCase(), index]));
  return refs
    .map((ref, index) => ({ ref, index }))
    .sort(
      (a, b) =>
        (rank.get(a.ref.type.toLowerCase()) ?? Number.MAX_SAFE_INTEGER) -
          (rank.get(b.ref.type.toLowerCase()) ?? Number.MAX_SAFE_INTEGER) || a.index - b.index,
    )
    .map(({ ref }) => ref);
};

type TFn = (key: string, options?: Record<string, unknown>) => string;

/** Localization keys for each stored DatePrecision code — the stored XML value stays the English canonical code; only the display text is localized. */
const PRECISION_LABEL_KEYS: Partial<Record<DatePrecision, string>> = {
  'b.': 'precision_b',
  'b. ca.': 'precision_b_ca',
  active: 'precision_active',
  'active ca.': 'precision_active_ca',
  'fl.': 'precision_fl',
  'd.': 'precision_d',
  'd. ca.': 'precision_d_ca',
  'active to': 'precision_active_to',
  'active to ca.': 'precision_active_to_ca',
};

const WORK_TITLE_TYPES: NameTypeId[] = ['primary', 'romanization', 'translation', 'variant'];
/** Offices, places, orgs — never 姓/名 / courtesy / posthumous person types. */
const NON_PERSON_NAME_TYPES: NameTypeId[] = ['primary', 'romanization', 'translation', 'variant'];
type WorkDatePrecision = '' | 'not before' | 'ca.' | 'not after';

const WORK_DATE_START_PRECISION_OPTIONS: WorkDatePrecision[] = ['', 'not before', 'ca.'];
const WORK_DATE_END_PRECISION_OPTIONS: WorkDatePrecision[] = ['', 'not after', 'ca.'];

const WORK_TYPE_OPTIONS = ['book', 'chapter', 'poem', 'painting', 'object'] as const;

const neutralActionButtonSx = {
  color: 'text.secondary',
  p: 0.25,
};

const precisionLabel = (precision: string | null | undefined, t: TFn): string => {
  if (!precision) return '';
  const key = PRECISION_LABEL_KEYS[precision as DatePrecision];
  return key ? t(`LWC.desktop.sidebar.database.${key}`) : precision;
};

const scholarlyYear = (year: number, precision: string | null | undefined, t: TFn): string => {
  const label = precisionLabel(precision, t);
  const qualifier = label ? `${label} ` : '';
  const era = t(
    year < 0 ? 'LWC.desktop.sidebar.database.era_bce' : 'LWC.desktop.sidebar.database.era_ce',
  );
  return `${qualifier}${Math.abs(year)} ${era}`;
};

const scholarlyDateRange = (
  startYear: number | null,
  endYear: number | null,
  startPrecision: string | null | undefined,
  endPrecision: string | null | undefined,
  t: TFn,
): string => {
  if (startYear == null && endYear == null) return '—';
  // Real floruit: one `fl.` for the whole span (CBDB earliest–latest), not on both sides.
  if (startPrecision === 'fl.' || endPrecision === 'fl.') {
    const fl = precisionLabel('fl.', t) || 'fl.';
    if (startYear != null && endYear != null && startYear !== endYear) {
      return `${fl} ${Math.abs(startYear)}–${Math.abs(endYear)}`;
    }
    const year = startYear ?? endYear!;
    return `${fl} ${Math.abs(year)}`;
  }
  if (startYear == null) return scholarlyYear(endYear!, endPrecision, t);
  if (endYear == null) return scholarlyYear(startYear, startPrecision, t);
  return `${scholarlyYear(startYear, startPrecision, t)}–${scholarlyYear(endYear, endPrecision, t)}`;
};

/** Groups same-value assertions (e.g. CBDB and DILA both asserting "d. 226") into one row. */
interface AssertionValueGroup {
  element: string;
  value: string;
  precision: string | null | undefined;
  keys: string[];
  sources: string[];
}

const groupAssertionsByValue = (
  assertions: EntityAssertionSummary[],
  keyOf: (assertion: EntityAssertionSummary) => string = (assertion) => assertion.value,
): AssertionValueGroup[] => {
  const map = new Map<string, AssertionValueGroup>();
  for (const assertion of assertions) {
    const source = assertion.source?.split(':')[0] ?? 'authority';
    const canonicalValue = keyOf(assertion);
    const groupKey = `${assertion.element} ${canonicalValue}`;
    const existing = map.get(groupKey);
    if (existing) {
      existing.keys.push(assertion.key);
      if (!existing.sources.includes(source)) existing.sources.push(source);
    } else {
      map.set(groupKey, {
        element: assertion.element,
        value: canonicalValue,
        precision: assertion.precision,
        keys: [assertion.key],
        sources: [source],
      });
    }
  }
  return [...map.values()];
};

/** Which database the panel is currently browsing - a pure view switch, unrelated to syncToCentral. */
type DatabaseView = 'project' | 'central';

interface ConfirmState {
  title: string;
  body: string;
  confirmLabel: string;
  destructive?: boolean;
  showSkipDetachOption?: boolean;
  onConfirm: () => void;
}

interface SidebarDatabaseTabProps {
  /** True while this tab is the visible one; triggers a refresh on activation. */
  active?: boolean;
}

type PendingValidationMode = 'assertion' | 'date' | 'description' | 'geo';
interface PendingValidation {
  key: string;
  mode: PendingValidationMode;
}

interface EntityDescriptionEditorProps {
  initialValue: string;
  label: string;
  onValueChange: (value: string) => void;
}

/**
 * Keep the frequently edited description out of SidebarDatabaseTab's large
 * render tree. The parent only needs the latest draft when Save is clicked.
 */
const EntityDescriptionEditor = memo(function EntityDescriptionEditor({
  initialValue,
  label,
  onValueChange,
}: EntityDescriptionEditorProps) {
  const [value, setValue] = useState(initialValue);

  useEffect(() => {
    setValue(initialValue);
    onValueChange(initialValue);
  }, [initialValue, onValueChange]);

  return (
    <TextField
      fullWidth
      size="small"
      label={label}
      value={value}
      onChange={(event) => {
        const nextValue = event.target.value;
        setValue(nextValue);
        onValueChange(nextValue);
      }}
      sx={{ mt: 1 }}
    />
  );
});

interface EntityRowData {
  entities: EntitySummary[];
  selected: Set<string>;
  toggleSelected: (id: string) => void;
  romanizedOf: (entity: EntitySummary) => string | null;
  authorityOrder: Record<string, string[]>;
  openEdit: (entity: EntitySummary) => void;
  openXPathForEntity: (entity: EntitySummary) => void;
  notifyViaSnackbar: (notification: NotificationProps | string) => void;
  showRejected: boolean;
  /** Synced projects have no project-local key distinct from the central one — hide the redundant "(central)" line. */
  syncToCentral: boolean;
  t: TFn;
}

/** First line always present (name/romanization/badges) plus the padding above it. */
const ENTITY_ROW_BASE_HEIGHT = 34;
/** Second line (id + copy button) — omitted when syncToCentral and the entity has no project-local key. */
const ENTITY_ROW_ID_LINE_HEIGHT = 20;
/** Each optional line (description; dates/dynasties/origins). */
const ENTITY_ROW_OPTIONAL_LINE_HEIGHT = 20;

/**
 * Static per-row height, computed from the entity's own fields — no
 * measurement, no `ResizeObserver`. `react-window`'s dynamic-height mode
 * (`useDynamicRowHeight`) observes every visible row's real layout on every
 * scroll/render, which the library's own docs flag as meaningfully slower;
 * that's what made hovering/scrolling the list janky. Rows only vary by
 * whether a description and/or a dates/dynasties/origins line is present, so
 * a cheap boolean count gives an exact height with zero runtime overhead.
 */
const entityRowHeight = (index: number, rowProps: EntityRowData): number => {
  const entity = rowProps.entities[index];
  if (!entity) return ENTITY_ROW_BASE_HEIGHT + ENTITY_ROW_ID_LINE_HEIGHT;
  const hasDatesLine =
    entity.startYear != null ||
    entity.endYear != null ||
    entity.nationalities.length > 0 ||
    entity.placesOfOrigin.length > 0;
  const hasRejectedLine =
    rowProps.showRejected &&
    (entity.rejectedCount > 0 || (entity.rejectedConcordances?.length ?? 0) > 0);
  const hasIdLine = !rowProps.syncToCentral || entity.projectKey != null;
  const optionalLines =
    (entity.description ? 1 : 0) + (hasDatesLine ? 1 : 0) + (hasRejectedLine ? 1 : 0);
  return (
    ENTITY_ROW_BASE_HEIGHT +
    (hasIdLine ? ENTITY_ROW_ID_LINE_HEIGHT : 0) +
    optionalLines * ENTITY_ROW_OPTIONAL_LINE_HEIGHT
  );
};

/**
 * One entity row, rendered by `react-window`'s `List`. Pulled out to module
 * scope (rather than an inline closure in the render loop) so its identity is
 * stable across renders — required for the virtualized list to avoid
 * remounting every row on every parent re-render. A large database can have
 * tens of thousands of entities, so rendering every row as a real DOM/React
 * element at once (the previous approach) was enough to OOM the renderer.
 */
function EntityRow({
  index,
  style,
  entities,
  selected,
  toggleSelected,
  romanizedOf,
  authorityOrder,
  openEdit,
  openXPathForEntity,
  notifyViaSnackbar,
  showRejected,
  syncToCentral,
  t,
}: RowComponentProps<EntityRowData>) {
  const entity = entities[index];
  if (!entity) return null;
  const romanized = romanizedOf(entity);
  const authorities = sortAuthoritiesByPreference(
    normalizedAuthorityRefs(entity.authorities),
    authorityOrder,
    entity.kind,
  );
  return (
    <Box
      style={style}
      sx={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 0.5,
        px: 1,
        py: 0.75,
        borderBottom: 1,
        borderColor: 'divider',
        bgcolor: selected.has(entity.id) ? 'action.selected' : undefined,
      }}
    >
      <Checkbox
        size="small"
        checked={selected.has(entity.id)}
        onChange={() => toggleSelected(entity.id)}
        sx={{ p: 0.25, mt: 0.125 }}
      />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Stack direction="row" spacing={0.75} alignItems="baseline">
          <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
            {entity.names[0] ?? '(unnamed)'}
          </Typography>
          {romanized && romanized !== entity.names[0] && (
            <Typography variant="caption" color="text.secondary" noWrap>
              {romanized}
            </Typography>
          )}
          {authorities.length > 0 && (
            <Box
              component="span"
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 0.5,
                minWidth: 0,
                flex: 1,
                overflow: 'hidden',
                whiteSpace: 'nowrap',
              }}
            >
              {authorityBadgeGroups(authorities).map(({ ref, count }) => {
                const url = authorityLookupUrl(ref);
                return (
                  <Box
                    key={`${ref.type}-${ref.value}`}
                    component="span"
                    onClick={url ? () => openExternalUrl(url) : undefined}
                    sx={{
                      cursor: url ? 'pointer' : 'default',
                      display: 'inline-flex',
                      flexShrink: 0,
                    }}
                    title={ref.value}
                  >
                    <SourceBadges label={Array(count).fill(ref.type).join('+')} />
                  </Box>
                );
              })}
            </Box>
          )}
        </Stack>
        {(!syncToCentral || listProjectKey(entity)) && (
          <Stack direction="row" alignItems="center" spacing={0.5}>
            <Typography variant="caption" color="text.secondary" component="div" noWrap>
              {listProjectKey(entity) ?? '(central)'}
            </Typography>
            {listProjectKey(entity) && (
              <Tooltip title={t('LWC.desktop.sidebar.database.copy_id')}>
                <IconButton
                  size="small"
                  aria-label={t('LWC.desktop.sidebar.database.copy_id')}
                  onClick={() => {
                    const key = listProjectKey(entity);
                    if (!key) return;
                    void navigator.clipboard.writeText(key).then(() => {
                      notifyViaSnackbar({
                        message: t('LWC.desktop.sidebar.database.id_copied'),
                        options: { variant: 'success' },
                      });
                    });
                  }}
                  sx={{ p: 0.25, flexShrink: 0 }}
                >
                  <ContentCopyIcon sx={{ fontSize: 14 }} />
                </IconButton>
              </Tooltip>
            )}
          </Stack>
        )}
        {entity.description && (
          <Typography variant="caption" color="text.secondary" component="div" noWrap>
            {entity.description}
          </Typography>
        )}
        {(entity.startYear != null ||
          entity.endYear != null ||
          entity.nationalities.length > 0 ||
          entity.placesOfOrigin.length > 0) && (
          <Typography variant="caption" color="text.secondary" component="div" noWrap>
            {entity.startYear != null || entity.endYear != null
              ? `${t('LWC.desktop.sidebar.database.dates')}: ${
                  entity.workDate
                    ? scholarlyDateRange(
                        entity.workDate.startYear,
                        entity.workDate.endYear,
                        entity.workDate.startPrecision,
                        entity.workDate.endPrecision,
                        t,
                      )
                    : `${entity.startYear ?? '—'}–${entity.endYear ?? '—'}`
                }`
              : ''}
            {entity.nationalities.length > 0
              ? `${entity.startYear != null || entity.endYear != null ? ' · ' : ''}${t('LWC.desktop.sidebar.database.dynasties')}: ${entity.nationalities.join(', ')}`
              : ''}
            {entity.placesOfOrigin.length > 0
              ? `${entity.startYear != null || entity.endYear != null || entity.nationalities.length > 0 ? ' · ' : ''}${t('LWC.desktop.sidebar.database.origins')}: ${entity.placesOfOrigin.join(', ')}`
              : ''}
          </Typography>
        )}
        {showRejected &&
          (entity.rejectedCount > 0 || (entity.rejectedConcordances?.length ?? 0) > 0) && (
            <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap" sx={{ mt: 0.25 }}>
              {entity.rejectedCount > 0 && (
                <Chip
                  label={t('LWC.desktop.sidebar.database.rejected_count', {
                    count: entity.rejectedCount,
                  })}
                  size="small"
                  color="error"
                  variant="outlined"
                  sx={{
                    height: 20,
                    textDecoration: 'line-through',
                    '& .MuiChip-label': { px: 0.75, fontSize: 11 },
                  }}
                />
              )}
              {entity.rejectedAssertions.slice(0, 6).map((assertion) => (
                <Chip
                  key={`${assertion.element}-${assertion.value}-${assertion.source ?? ''}`}
                  label={`${assertion.element}: ${assertion.value}`}
                  size="small"
                  color="error"
                  variant="outlined"
                  sx={{
                    height: 20,
                    textDecoration: 'line-through',
                    '& .MuiChip-label': { px: 0.75, fontSize: 11 },
                  }}
                />
              ))}
              {(entity.rejectedConcordances ?? []).slice(0, 3).map((rejection) => (
                <Chip
                  key={`${rejection.leftId}-${rejection.rightId}`}
                  label={`${rejection.leftId} ↔ ${rejection.rightId}`}
                  size="small"
                  color="error"
                  variant="outlined"
                  sx={{
                    height: 20,
                    textDecoration: 'line-through',
                    '& .MuiChip-label': { px: 0.75, fontSize: 11 },
                  }}
                />
              ))}
            </Stack>
          )}
      </Box>
      <Stack direction="row" spacing={0} sx={{ flexShrink: 0 }}>
        <Tooltip title={t('LWC.desktop.sidebar.database.open')}>
          <IconButton
            size="small"
            onClick={() => openEdit(entity)}
            aria-label={t('LWC.desktop.sidebar.database.open')}
          >
            <OpenInNewIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="Find in XPath panel">
          <IconButton
            size="small"
            onClick={() => openXPathForEntity(entity)}
            aria-label="Find entity in XPath panel"
          >
            <SearchIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Stack>
    </Box>
  );
}

export const SidebarDatabaseTab = ({ active = false }: SidebarDatabaseTabProps) => {
  const { t, i18n } = useTranslation();
  const { skipEntityDetachConfirm } = useAppState().ui;
  const { setSkipEntityDetachConfirm, notifyViaSnackbar } = useActions().ui;
  const { config, rootPath } = useAppState().project;
  const [savedSyncOverride, setSavedSyncOverride] = useState<boolean | null>(null);
  const syncToCentral = savedSyncOverride ?? config?.syncToCentral === true;
  const [databaseView, setDatabaseView] = useState<DatabaseView>('project');
  const [store, setStore] = useState<EntityStore | null>(null);
  const [centralStore, setCentralStore] = useState<EntityStore | null>(null);
  const [projectLang, setProjectLang] = useState<string | null>(null);
  const [authorityOrder, setAuthorityOrder] = useState<Record<string, string[]>>({});
  const [entities, setEntities] = useState<EntitySummary[]>([]);
  const [duplicates, setDuplicates] = useState<DuplicateGroup[]>([]);
  const [concordanceConflicts, setConcordanceConflicts] = useState<
    ConcordanceImportResult['conflicts']
  >([]);
  const [warnings, setWarnings] = useState<LookupWarning[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyMessage, setBusyMessage] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [kindFilter, setKindFilterState] = useState<EntityKind>(() => readStoredKindFilter());
  const setKindFilter = useCallback((kind: EntityKind) => {
    setKindFilterState(kind);
    writeStoredKindFilter(kind);
  }, []);
  const [subtypeFilter, setSubtypeFilter] = useState<string>('');
  // Read fresh each render (cheap in-memory getter) rather than memoized, so a
  // type added in Project Settings shows up here without remounting the tab.
  const thingTypeOptions = readPersistedAuthoritySettings()?.customThingTypes ?? [];
  useEffect(() => {
    if (kindFilter !== 'thing') setSubtypeFilter('');
  }, [kindFilter]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [showRejected, setShowRejected] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [skipDetachChecked, setSkipDetachChecked] = useState(false);
  const [mergeIds, setMergeIds] = useState<string[] | null>(null);
  const [mergeKeepId, setMergeKeepId] = useState<string>('');
  const [editEntity, setEditEntity] = useState<EntitySummary | null>(null);
  /** Tracks the open card id across async backfill so we can refresh it after list reload. */
  const editEntityIdRef = useRef<string | null>(null);
  editEntityIdRef.current = editEntity?.id ?? null;
  const [editCanonicalName, setEditCanonicalName] = useState('');
  const [editingName, setEditingName] = useState(false);
  const nameBeforeRename = useRef('');
  const [editingRomanized, setEditingRomanized] = useState(false);
  const romanizedBeforeEdit = useRef('');
  const [editDescriptionSeed, setEditDescriptionSeed] = useState('');
  const editDescriptionRef = useRef('');
  const handleEditDescriptionChange = useCallback((value: string) => {
    editDescriptionRef.current = value;
  }, []);
  const [editRomanized, setEditRomanized] = useState('');
  const [editNameTypes, setEditNameTypes] = useState<Record<string, string>>({});
  const [editNameLanguages, setEditNameLanguages] = useState<Record<string, string>>({});
  const [editNewName, setEditNewName] = useState('');
  const [editNewNameType, setEditNewNameType] = useState<string>('');
  const [editNewNameLanguage, setEditNewNameLanguage] = useState('');
  const [focusAddNameToken, setFocusAddNameToken] = useState(0);
  const [suggestGlossBusy, setSuggestGlossBusy] = useState(false);
  const [suggestGlossError, setSuggestGlossError] = useState<string | null>(null);
  const [projectTranslationLanguages, setProjectTranslationLanguages] = useState<
    TranslationLanguage[]
  >([]);
  const [pendingValidations, setPendingValidations] = useState<PendingValidation[]>([]);
  const [dateEditing, setDateEditing] = useState(false);
  const [dateBirth, setDateBirth] = useState('');
  const [dateDeath, setDateDeath] = useState('');
  const mirrorSyncQueueRef = useRef<Promise<void>>(Promise.resolve());
  const mirrorSyncPendingRef = useRef(false);
  const [dateBirthQualifier, setDateBirthQualifier] = useState<DatePrecision>('');
  const [dateDeathQualifier, setDateDeathQualifier] = useState<DatePrecision>('');
  const [dateBirthBce, setDateBirthBce] = useState(false);
  const [dateDeathBce, setDateDeathBce] = useState(false);
  const [workDateStart, setWorkDateStart] = useState('');
  const [workDateEnd, setWorkDateEnd] = useState('');
  const [workDateStartPrecision, setWorkDateStartPrecision] = useState<WorkDatePrecision>('');
  const [workDateEndPrecision, setWorkDateEndPrecision] = useState<WorkDatePrecision>('');
  const [valuesEditing, setValuesEditing] = useState(false);
  const [namesExpanded, setNamesExpanded] = useState(false);
  const [titlesExpanded, setTitlesExpanded] = useState(false);
  const [rolesExpanded, setRolesExpanded] = useState(false);
  const [geoMapPin, setGeoMapPin] = useState<MapPin | null>(null);
  const [newTitle, setNewTitle] = useState({
    dynasty: '',
    fief: '',
    posthumousName: '',
    title: '',
  });
  const [lastSummary, setLastSummary] = useState<KeyRemapSummary | null>(null);
  const [bridgeOpen, setBridgeOpen] = useState(false);
  const [docketOpen, setDocketOpen] = useState(false);
  const [docketCount, setDocketCount] = useState(0);
  const [backfillBusy, setBackfillBusy] = useState(false);
  /** Ids being enriched; `null` means bulk (all linked persons). */
  const [backfillScopeIds, setBackfillScopeIds] = useState<string[] | null>(null);
  const [bulkProposals, setBulkProposals] = useState<BulkBridgeProposal[]>([]);
  const [proposalsOpen, setProposalsOpen] = useState(false);
  const [acceptingProposals, setAcceptingProposals] = useState(false);
  const [backfillProgress, setBackfillProgress] = useState<{
    done: number;
    total: number;
    entityLabel?: string;
  } | null>(null);
  /** Bumped when the open card is rehydrated so uncontrolled fields remount. */
  const [editFormEpoch, setEditFormEpoch] = useState(0);
  const backfillAbortRef = useRef<AbortController | null>(null);
  /** Guards against overlapping bulk catch-up sync passes across successive reload() calls. */
  const bulkSyncInFlightRef = useRef(false);
  /** After we ask once (accept or decline), do not re-prompt until the tab remounts. */
  const catchUpPromptedRef = useRef(false);

  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const reload = useCallback(async () => {
    const currentStore = entityStoreFromDesktop();
    setStore(currentStore);
    try {
      const globals = window as unknown as {
        __leafWriterProject?: { getProjectSourceLanguage?: () => Promise<string | null> };
      };
      setProjectLang((await globals.__leafWriterProject?.getProjectSourceLanguage?.()) ?? null);
    } catch {
      setProjectLang(null);
    }
    try {
      const preferences = await db.lookupServicePreferences.toArray();
      const nextOrder: Record<string, string[]> = {};
      for (const preference of preferences.sort((a, b) => a.priority - b.priority)) {
        (nextOrder[preference.entityType] ??= []).push(preference.authorityId);
      }
      setAuthorityOrder(nextOrder);
    } catch {
      setAuthorityOrder({});
    }
    if (!currentStore) {
      setEntities([]);
      setDuplicates([]);
      setConcordanceConflicts([]);
      setWarnings([]);
      setCentralStore(null);
      setDocketCount(0);
      return;
    }
    const centralFolder =
      (await window.electronAPI?.getEntityDbFolder?.().catch(() => null)) ?? null;
    const resolvedCentralStore = centralEntityStoreFromDesktop(centralFolder);
    setCentralStore(resolvedCentralStore);
    if (resolvedCentralStore) {
      const api = desktopEntityFileApi();
      const proposalPath = `${resolvedCentralStore.projectGrognardDir}/bulk-import-proposals.jsonl`;
      if (api && (await api.pathExists(proposalPath))) {
        const rows = (await api.readFile(proposalPath)).split(/\r?\n/).filter(Boolean);
        setBulkProposals(
          rows.flatMap((row) => {
            try {
              return [JSON.parse(row) as BulkBridgeProposal];
            } catch {
              return [];
            }
          }),
        );
      }
    }

    // Synchronized projects use a checkpointed CEDB/PEDB mirror. This is
    // deliberately not the manual bridge/union workflow: CEDB is canonical,
    // an offline PEDB edit is uploaded only when CEDB is unchanged, and
    // simultaneous edits remain explicit conflicts.
    if (syncToCentral && !resolvedCentralStore) {
      setLoadError('Central database is not configured; synchronisation did not start.');
    }

    // Unsynchronized projects: on Refresh / tab load, pull non-conflicting
    // central content (new courtesy names, authorities, empty scalars) into
    // linked PEDB entities. Conflicts stay in the Bridge inbox.
    if (!syncToCentral && resolvedCentralStore) {
      try {
        const availability = await loadBridgeContext();
        if (availability.available) {
          const pulled = await syncNonConflictingLinkedEntities(availability.context);
          if (pulled.synced > 0) {
            notifyViaSnackbar({
              message: t('LWC.desktop.sidebar.database.bridge.auto_sync_updated', {
                count: pulled.synced,
              }),
              options: { variant: 'info' },
            });
          }
        }
      } catch (error) {
        // Never block the entity list on a bridge pull failure.
        console.error('[bridge] auto-sync on reload failed:', error);
      }
    }

    if (
      syncToCentral &&
      resolvedCentralStore &&
      !bulkSyncInFlightRef.current &&
      !mirrorSyncPendingRef.current
    ) {
      bulkSyncInFlightRef.current = true;
      await (async () => {
        try {
          const api = desktopEntityFileApi();
          if (!api) return;
          const { id: userStableId } = await readOrMintUserStableId(api, centralFolder);
          const mirror = await synchronizeMirroredProject(
            currentStore,
            resolvedCentralStore,
            userStableId,
          );
          if (mirror.unavailable) {
            setLoadError(SQLITE_REQUIRED_BRIDGE_MESSAGE);
          } else if (mirror.conflicts.length > 0) {
            setLoadError(
              `Central synchronisation found ${mirror.conflicts.length} conflicting offline edit${mirror.conflicts.length === 1 ? '' : 's'}.`,
            );
          }

          const unlinked = await countUnlinkedPedbEntities(currentStore, userStableId);
          if (unlinked > 0 && !getBulkSyncProgress().active && !catchUpPromptedRef.current) {
            catchUpPromptedRef.current = true;
            const confirmed = window.confirm(
              `This project has ${unlinked} entit${unlinked === 1 ? 'y' : 'ies'} not yet linked to the central database.\n\n` +
                `Link and mint them into the central database now? ` +
                `Ambiguous matches will be listed as proposals for review.`,
            );
            if (confirmed) {
              const label = 'Catching up unlinked entities';
              const start = window.electronAPI?.bulkBridgeStart;
              const onProgress = window.electronAPI?.onBulkBridgeProgress;
              if (!start || !onProgress) {
                throw new Error('Background catch-up sync is unavailable in this desktop build.');
              }
              void (async () => {
                try {
                  await new Promise<void>((resolve, reject) => {
                    let jobId: string | null = null;
                    const cancel = () => {
                      if (jobId) void window.electronAPI?.bulkBridgeCancel?.(jobId);
                    };
                    const unsubscribe = onProgress((event) => {
                      if (!jobId || event.jobId !== jobId) return;
                      if (event.progress) {
                        setBulkSyncProgress({
                          active: true,
                          label,
                          done: event.progress.done,
                          total: event.progress.total,
                          cancel,
                        });
                      }
                      if (event.status === 'complete' || event.status === 'cancelled') {
                        if (event.result?.proposals) setBulkProposals(event.result.proposals);
                        setBulkSyncProgress({ active: false, label: '', done: 0, total: 0 });
                        unsubscribe();
                        resolve();
                      } else if (event.status === 'error') {
                        setBulkSyncProgress({ active: false, label: '', done: 0, total: 0 });
                        unsubscribe();
                        reject(new Error(event.error ?? 'Background catch-up sync failed.'));
                      }
                    });
                    void (async () => {
                      try {
                        jobId = await start({
                          sourceEntitiesPath: currentStore.entitiesPath,
                          centralEntitiesPath: resolvedCentralStore.entitiesPath,
                          centralGrognardDir: resolvedCentralStore.projectGrognardDir,
                          userStableId,
                          chunkSize: 250,
                        });
                        setBulkSyncProgress({ active: true, label, done: 0, total: 0, cancel });
                      } catch (error) {
                        unsubscribe();
                        reject(error);
                      }
                    })();
                  });
                  // Refresh the CEDB panel so minted/linked rows appear; prompt is suppressed.
                  void reload();
                } catch (error) {
                  console.error('[central-mirror] catch-up sync failed:', error);
                  setBulkSyncProgress({ active: false, label: '', done: 0, total: 0 });
                  setLoadError(
                    `Catch-up synchronisation failed: ${error instanceof Error ? error.message : String(error)}`,
                  );
                }
              })();
            }
            // On decline: leave unlinked and continue browsing CEDB.
          }
        } catch (error) {
          console.error('[central-mirror] synchronisation failed:', error);
          setLoadError(
            `Central synchronisation failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        } finally {
          bulkSyncInFlightRef.current = false;
        }
      })();
    }

    // Synchronized projects expose CEDB only. The PEDB is an implementation
    // mirror for corpus keys, not an alternate database view.
    const activeStore =
      (syncToCentral || databaseView === 'central') && resolvedCentralStore
        ? resolvedCentralStore
        : currentStore;

    if (
      !(await activeStore.hasSqliteDatabase()) ||
      !window.electronAPI?.entitySqliteListPanelSummaries
    ) {
      setLoading(false);
      setLoadError(SQLITE_REQUIRED_MESSAGE);
      return;
    }

    setLoading(true);
    setLoadError(null);
    try {
      if (resolvedCentralStore && activeStore !== resolvedCentralStore) {
        computeMergeDocket(resolvedCentralStore)
          .then((docket) => setDocketCount(docket.length))
          .catch(() => setDocketCount(0));
      } else if (!resolvedCentralStore) {
        setDocketCount(0);
      }

      let conflicts: ConcordanceImportResult['conflicts'] = [];
      if (activeStore === currentStore && window.electronAPI?.entitySqliteApplyConcordance) {
        // Debounced: pack-lifecycle refresh may have just applied the same pack.
        const imported = await refreshCbdbConcordanceSqliteDebounced(
          activeStore,
          cachedPackReader(),
          { clearCache: false },
        );
        if (imported) conflicts = imported.conflicts;
      }

      const snapshots = await activeStore.sqlitePanelSummaries();
      if (snapshots === null) throw new Error('SQLite entity database is unavailable.');
      const summaries = await attachProjectCentralKeys(
        snapshots.map((snapshot) =>
          entitySummaryFromSqlite(snapshot as Parameters<typeof entitySummaryFromSqlite>[0]),
        ),
        {
          viewingCentral: activeStore === resolvedCentralStore,
          projectStore: currentStore,
          centralFolder: resolvedCentralStore?.centralFolder,
        },
      );
      const duplicateRows = window.electronAPI?.entitySqliteAuthorityDuplicates
        ? await activeStore.sqliteAuthorityDuplicates()
        : null;
      if (resolvedCentralStore && activeStore === resolvedCentralStore) {
        computeMergeDocket(resolvedCentralStore)
          .then((docket) => setDocketCount(docket.length))
          .catch(() => setDocketCount(0));
      }
      setEntities(summaries);
      // Selection can outlive a Project↔Central switch or a project change.
      // Prune to ids that still exist in this database so Fusionner(N) matches
      // the visible checkboxes and merge never sends a foreign id to SQLite.
      setSelected((previous) => {
        if (previous.size === 0) return previous;
        const knownIds = new Set(summaries.map((summary) => summary.id));
        let changed = false;
        const next = new Set<string>();
        for (const id of previous) {
          if (knownIds.has(id)) next.add(id);
          else changed = true;
        }
        return changed ? next : previous;
      });
      setMergeIds((previous) => {
        if (!previous) return previous;
        const knownIds = new Set(summaries.map((summary) => summary.id));
        const next = previous.filter((id) => knownIds.has(id));
        if (next.length < 2) return null;
        return next.length === previous.length ? previous : next;
      });
      setDuplicates((duplicateRows ?? []) as DuplicateGroup[]);
      setConcordanceConflicts(activeStore === currentStore ? conflicts : []);
      setWarnings(activeStore === currentStore ? await loadOpenWarnings(currentStore) : []);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, [databaseView, notifyViaSnackbar, syncToCentral, t]);

  // Drop cross-database selection when the browse target changes. Reload also
  // prunes, but clearing immediately avoids a Fusionner(3) flash with ghost ids.
  useEffect(() => {
    setSelected(new Set());
    setMergeIds(null);
  }, [databaseView, rootPath]);

  // A synchronized project has one visible database: the central one.
  useEffect(() => {
    if (syncToCentral && databaseView !== 'central') setDatabaseView('central');
  }, [databaseView, syncToCentral]);

  // Load on mount and refresh whenever the tab becomes visible (the project —
  // and with it the entity store — may not exist yet at app start). Also reload
  // when the open project root changes so we never keep a stale EntityStore
  // pointed at a previous folder after a switch.
  useEffect(() => {
    if (active || !store) void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, reload, rootPath]);

  // Project translation languages for empty-gloss nudge chips in the names editor.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const bundle = getActiveProjectBundle();
      if (!bundle) {
        if (!cancelled) setProjectTranslationLanguages([]);
        return;
      }
      const settings = await readTranslationSettings(bundle);
      if (cancelled) return;
      setProjectTranslationLanguages(settings?.languages ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [rootPath, active]);

  // Native project settings are saved from a separate BrowserWindow. Refresh
  // the sidebar immediately when that window commits syncToCentral, even
  // before the main project state has been reloaded from project.json.
  useEffect(() => {
    const handleConfigSaved = (event: Event) => {
      const detail = (event as CustomEvent<{ syncToCentral?: boolean }>).detail;
      if (typeof detail?.syncToCentral !== 'boolean') return;
      setSavedSyncOverride(detail.syncToCentral);
      // A hidden database tab will refresh when it becomes active. Avoid a
      // full entity-list reload in the background just because settings were
      // changed in the separate project window.
      if (active) void reload();
    };
    window.addEventListener('grognard-project-config-saved', handleConfigSaved);
    return () => window.removeEventListener('grognard-project-config-saved', handleConfigSaved);
  }, [active, reload]);

  useEffect(() => {
    const handleShowEntity = (event: Event) => {
      const detail = (event as CustomEvent<DesktopDatabaseEntityDetail>).detail;
      if (!detail?.id) return;

      const type = detail.type === 'org' || detail.type === 'organization' ? 'org' : detail.type;
      const projectKey = detail.id;
      setDatabaseView(syncToCentral ? 'central' : 'project');
      setKindFilter(type as EntityKind);
      // Always search by the corpus / project key (never by central id).
      setSearch(`^${escapeRegExp(projectKey)}$`);
      window.dispatchEvent(
        new CustomEvent(DESKTOP_LEFT_PANEL_EVENT, { detail: { tab: 'database' } }),
      );
      requestAnimationFrame(() => searchInputRef.current?.focus());

      void (async () => {
        // Synced projects browse CEDB here. Only select a row id that exists in
        // that list — never plant the corpus @key when there is no central
        // mapping, or Delete entity (1) lights up with no checkbox checked.
        if (syncToCentral) {
          if (!store) {
            setSelected(new Set());
            return;
          }
          const api = desktopEntityFileApi();
          if (!api) {
            setSelected(new Set());
            return;
          }
          try {
            const { id: userStableId } = await readOrMintUserStableId(
              api,
              centralStore?.centralFolder ?? null,
            );
            const centralId = await store.sqliteGetCentralId(projectKey, userStableId);
            setSelected(centralId ? new Set([centralId]) : new Set());
          } catch {
            setSelected(new Set());
          }
          return;
        }
        setSelected(new Set([projectKey]));
      })();
    };

    window.addEventListener(DESKTOP_DATABASE_ENTITY_EVENT, handleShowEntity);
    return () => window.removeEventListener(DESKTOP_DATABASE_ENTITY_EVENT, handleShowEntity);
  }, [centralStore?.centralFolder, setKindFilter, store, syncToCentral]);

  // Reload when either database changes on disk (external edit or another flow).
  useEffect(() => {
    // Keep the selected entity and any in-progress form edits in memory, but
    // do not retain a live filesystem subscription or rebuild the full list
    // while this sidebar tab is hidden. Re-entering the tab calls reload().
    if (!active || !window.electronAPI?.onExternalFileChange || !store) return;
    const watchedPaths = new Set(
      [store.entitiesPath, centralStore?.entitiesPath]
        .filter((path): path is string => Boolean(path))
        .map((path) => path.replace(/\\/g, '/')),
    );
    return window.electronAPI.onExternalFileChange((filePath: string) => {
      if (watchedPaths.has(filePath.replace(/\\/g, '/'))) void reload();
    });
  }, [active, reload, store, centralStore]);

  const { regex, regexError } = useMemo(() => {
    const trimmed = search.trim();
    if (!trimmed) return { regex: null, regexError: null };
    try {
      return { regex: new RegExp(trimmed, 'iu'), regexError: null };
    } catch (error) {
      return {
        regex: null,
        regexError: error instanceof Error ? error.message : 'Invalid expression',
      };
    }
  }, [search]);

  interface KindFilterOption {
    value: EntityKind;
    label: string;
  }

  const kindFilterOptions = useMemo(
    (): KindFilterOption[] => [
      { value: 'person', label: t('LWC.desktop.sidebar.database.entity_types.person') },
      { value: 'place', label: t('LWC.desktop.sidebar.database.entity_types.place') },
      { value: 'org', label: t('LWC.desktop.sidebar.database.entity_types.organization') },
      { value: 'work', label: t('LWC.desktop.sidebar.database.entity_types.work') },
      { value: 'office', label: t('LWC.desktop.sidebar.database.entity_types.office') },
      { value: 'thing', label: t('LWC.desktop.sidebar.database.entity_types.thing') },
    ],
    [t],
  );

  const selectedKindOption =
    kindFilterOptions.find((option) => option.value === kindFilter) ?? kindFilterOptions[0];

  /**
   * Romanization shown under the display name: the stored -Latn name, or an
   * on-the-fly autogeneration for legacy entities (also searchable below).
   */
  const romanizedOf = useCallback(
    (entity: EntitySummary): string | null =>
      entity.romanized ?? autoRomanizeForKind(entity.names[0] ?? '', projectLang, entity.kind),
    [projectLang],
  );

  /**
   * Script-insensitive search blob per entity: "zhangheng" matches "Zhāng
   * Héng", "Zhang Heng", and (via stored/generated romanization) 張衡.
   *
   * Romanization (pinyin/Wylie/kana conversion) isn't free, and while a large
   * database indexes, `entities` grows in ~250-row batches — without caching,
   * this useMemo would redo romanization for every already-processed entity
   * on every batch (O(n²) across the whole load). The WeakMap caches each
   * entity summary's folded blob by object identity, so re-summarized/edited
   * entities (new object) still recompute, but unchanged ones never do twice.
   */
  const foldedIndexCacheRef = useRef({
    projectLang,
    cache: new WeakMap<EntitySummary, string>(),
  });
  const foldedIndex = useMemo(() => {
    const state = foldedIndexCacheRef.current;
    if (state.projectLang !== projectLang) {
      state.projectLang = projectLang;
      state.cache = new WeakMap<EntitySummary, string>();
    }
    const index = new Map<string, string>();
    for (const entity of entities) {
      let folded = state.cache.get(entity);
      if (folded === undefined) {
        const romanizations = [
          entity.romanized ?? '',
          ...entity.names.map((name) => autoRomanizeForKind(name, projectLang, entity.kind) ?? ''),
        ];
        // Names + romanization + project key only — not description, not central id.
        const projectKey = entity.projectKey ?? '';
        folded = foldForSearch([...entity.names, ...romanizations, projectKey].join('\n'));
        state.cache.set(entity, folded);
      }
      index.set(entity.id, folded);
    }
    return index;
  }, [entities, projectLang]);

  const visible = useMemo(() => {
    const folded = foldForSearch(search.trim());
    return entities.filter((entity) => {
      if (entity.kind !== kindFilter) return false;
      if (kindFilter === 'thing' && subtypeFilter && entity.subtype !== subtypeFilter) {
        return false;
      }
      if (!regex && !folded) return true;
      // Check the precomputed folded blob first: a single Map lookup + substring
      // test, versus building a fresh haystack array and running a regex against
      // every string in it. For a typical (non-regex-metacharacter) query this
      // resolves almost every entity without ever touching the expensive path —
      // across ~33k entities per keystroke, that difference is the whole cost.
      if (folded && (foldedIndex.get(entity.id) ?? '').includes(folded)) return true;
      if (!regex) return false;
      const projectKey = entity.projectKey;
      if (projectKey && regex.test(projectKey)) return true;
      if (entity.romanized && regex.test(entity.romanized)) return true;
      return entity.names.some((name) => regex.test(name));
    });
  }, [entities, foldedIndex, kindFilter, subtypeFilter, regex, search]);

  const toggleSelected = useCallback((id: string) => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  /** Whichever database is currently being browsed - every visible row belongs to it. */
  const resolveStoreFor = useCallback(
    (_id: string): EntityStore | null =>
      syncToCentral || databaseView === 'central' ? centralStore : store,
    [centralStore, databaseView, store, syncToCentral],
  );

  /** Active entity store for list/browse mutations (project PEDB or central CEDB view). */
  const activeStore = useMemo(
    () => ((syncToCentral || databaseView === 'central') && centralStore ? centralStore : store),
    [centralStore, databaseView, store, syncToCentral],
  );

  /**
   * Mirror work is deliberately post-save and serialized. The Central edit is
   * the user-visible save; rebuilding the PEDB is background maintenance and
   * must not make the save button wait on two XML reads/writes.
   */
  const scheduleMirrorSync = useCallback(() => {
    if (!syncToCentral || !store || !centralStore) return;
    mirrorSyncPendingRef.current = true;
    const queued = mirrorSyncQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        const api = desktopEntityFileApi();
        if (!api) return;
        const { id: userStableId } = await readOrMintUserStableId(api, centralStore.centralFolder);
        const mirror = await synchronizeMirroredProject(store, centralStore, userStableId);
        if (mirror.unavailable) {
          setLoadError(SQLITE_REQUIRED_BRIDGE_MESSAGE);
        } else if (mirror.conflicts.length > 0) {
          setLoadError(
            `Central synchronisation found ${mirror.conflicts.length} conflicting offline edit${mirror.conflicts.length === 1 ? '' : 's'}.`,
          );
        }
        if (mirror.downloadedCentralChanges > 0) void reload();
      })
      .catch((error) => {
        console.error('[central-mirror] background synchronisation failed:', error);
        setLoadError(
          `Central synchronisation failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
    mirrorSyncQueueRef.current = queued;
    void queued.finally(() => {
      if (mirrorSyncQueueRef.current === queued) mirrorSyncPendingRef.current = false;
    });
  }, [centralStore, reload, store, syncToCentral]);

  /**
   * Pull typed names (字/名/… and Wikidata claims) onto person entities from
   * installed authority packs + live Wikidata. Non-destructive: never overwrites
   * an existing `@type` on a name element.
   */
  const runNameBackfill = useCallback(
    async (entityIds?: string[]) => {
      if (!activeStore || backfillBusy) return;
      const controller = new AbortController();
      backfillAbortRef.current = controller;
      setBackfillBusy(true);
      setBackfillScopeIds(entityIds ?? null);
      setBackfillProgress({ done: 0, total: 0 });
      const cardScoped = entityIds?.length === 1 && editEntityIdRef.current === entityIds[0];
      try {
        const readPack = cachedPackReader();
        if (
          !(await activeStore.hasSqliteDatabase()) ||
          !window.electronAPI?.entitySqliteApplyAuthorityBackfillPatch
        ) {
          setLoadError(SQLITE_REQUIRED_MESSAGE);
          return;
        }
        // Concordance is a whole-database apply. Skip it for scoped refresh —
        // panel reload / bulk backfill remain the safety net for new CBDB links.
        const scopedRefresh = Boolean(entityIds && entityIds.length > 0);
        if (!scopedRefresh && activeStore === store) {
          await refreshCbdbConcordanceSqliteDebounced(activeStore, readPack, {
            force: true,
            clearCache: false,
          });
        }
        const lookupPackRowsByIds = packRowsByIdsReader();
        const result = await backfillEntitiesSqlite(activeStore, {
          entityIds,
          readPackFile: readPack,
          lookupPackRowsByIds,
          projectLang,
          desktopLanguage: i18n.language,
          signal: controller.signal,
          expandWikidataWorks: false,
          lookupAuthorityRef: window.electronAPI?.authorityRefLookup,
          onProgress: (progress) =>
            setBackfillProgress({
              done: progress.done,
              total: progress.total,
              entityLabel: progress.entityLabel,
            }),
        });

        if (entityIds && entityIds.length > 0 && activeStore === store) {
          // Promote still works without a meaningful DOM when both DBs are SQLite.
          await autoSyncEntitiesToCentral(null, entityIds);
        }
        if (
          !scopedRefresh &&
          activeStore === store &&
          window.electronAPI?.entitySqliteApplyConcordance
        ) {
          const imported = await refreshCbdbConcordanceSqliteDebounced(
            activeStore,
            cachedPackReader(),
            { force: true, clearCache: false },
          );
          if (imported) setConcordanceConflicts(imported.conflicts);
        }
        if (syncToCentral && store && centralStore && activeStore === centralStore) {
          scheduleMirrorSync();
        }

        // In-card refresh: rehydrate that one card + list row. Avoid a full list
        // reload (progress belongs on the card, not the panel underneath).
        if (cardScoped && entityIds?.[0]) {
          await refreshEditEntityFromSqlite(activeStore, entityIds[0], { remount: true });
          await refreshListEntityFromSqlite(activeStore, entityIds[0]);
        } else {
          await reload();
          const openId = editEntityIdRef.current;
          if (openId && (!entityIds || entityIds.length === 0 || entityIds.includes(openId))) {
            await refreshEditEntityFromSqlite(activeStore, openId, { remount: true });
          }
        }
        const scope =
          entityIds?.length === 1 ? 'this person' : `${result.entitiesScanned} linked persons`;
        notifyViaSnackbar({
          message: result.cancelled
            ? `Backfill cancelled — added ${result.namesAdded} name${result.namesAdded === 1 ? '' : 's'} across ${result.entitiesUpdated} entit${result.entitiesUpdated === 1 ? 'y' : 'ies'}.`
            : `Backfill complete for ${scope}: added ${result.namesAdded} name${result.namesAdded === 1 ? '' : 's'} across ${result.entitiesUpdated} entit${result.entitiesUpdated === 1 ? 'y' : 'ies'}.` +
              (result.bridgeLinksAttached
                ? ` Attached ${result.bridgeLinksAttached} Norbert bridge link${result.bridgeLinksAttached === 1 ? '' : 's'}.`
                : '') +
              (result.bridgeDuplicatesMerged
                ? ` Merged ${result.bridgeDuplicatesMerged} same-name duplicate${result.bridgeDuplicatesMerged === 1 ? '' : 's'}.`
                : '') +
              (result.bridgeConflicts
                ? ` ${result.bridgeConflicts} bridge conflict${result.bridgeConflicts === 1 ? '' : 's'} need review (different names sharing an authority id).`
                : '') +
              (result.skippedNoAuthority > 0
                ? ` Skipped ${result.skippedNoAuthority} person${result.skippedNoAuthority === 1 ? '' : 's'} with no authority id.`
                : ''),
          options: { variant: result.cancelled ? 'warning' : 'success' },
        });
      } catch (error) {
        setLoadError(error instanceof Error ? error.message : String(error));
      } finally {
        backfillAbortRef.current = null;
        setBackfillBusy(false);
        setBackfillScopeIds(null);
        setBackfillProgress(null);
      }
    },
    // `refreshEditEntityFromSqlite` is deliberately absent: it is declared below
    // this callback, and a dependency array is evaluated during render, so
    // naming it here is a temporal-dead-zone ReferenceError rather than a
    // stale-closure fix. It is also redefined every render, which would defeat
    // this memo. Closing this properly means hoisting that function.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      activeStore,
      backfillBusy,
      i18n.language,
      notifyViaSnackbar,
      projectLang,
      reload,
      store,
      centralStore,
      scheduleMirrorSync,
      syncToCentral,
    ],
  );

  /**
   * Identity-changing SQLite mutation (merge/delete): mutate via typed IPC,
   * then apply the same order log + corpus `@key` remap. Requires SQLite.
   */
  const runSqliteRemapMutation = useCallback(
    async (
      targetStore: EntityStore,
      message: string,
      mutate: () => Promise<Record<string, string | null>>,
    ): Promise<boolean> => {
      const sqliteAvailable =
        Boolean(window.electronAPI?.entitySqliteSoftDelete) &&
        (await targetStore.hasSqliteDatabase());
      if (!sqliteAvailable) {
        setLoadError(SQLITE_REQUIRED_MESSAGE);
        return false;
      }
      setBusyMessage(message);
      try {
        const dbId = (await targetStore.sqliteDatabaseId()) ?? undefined;
        const remap = await mutate();
        if (syncToCentral && store && centralStore && targetStore === centralStore) {
          scheduleMirrorSync();
        }
        if (Object.keys(remap).length > 0) {
          await targetStore.recordEntityOrder(remap, dbId);
          const summary = await applyKeyRemapAcrossProjects(targetStore, remap);
          setLastSummary(summary);
        }
        setSelected(new Set());
        await reload();
        return true;
      } catch (error) {
        setLoadError(error instanceof Error ? error.message : String(error));
        return false;
      } finally {
        setBusyMessage(null);
      }
    },
    [centralStore, reload, scheduleMirrorSync, store, syncToCentral],
  );

  const refreshEditEntityFromSqlite = async (
    targetStore: EntityStore,
    entityId: string,
    options?: { remount?: boolean },
  ) => {
    const raw = await targetStore.sqliteEntitySummary(entityId);
    if (!raw) return;
    const refreshed = entitySummaryFromSqlite(raw as Parameters<typeof entitySummaryFromSqlite>[0]);
    // Keep project/central key badges from the open card / list row.
    setEditEntity((previous) => {
      if (!previous || previous.id !== entityId) return previous;
      return {
        ...refreshed,
        projectKey: previous.projectKey,
        centralKey: previous.centralKey,
      };
    });
    if (editEntityIdRef.current !== entityId) return;
    syncEditFormFields(refreshed, {
      resetAccordions: false,
      remount: options?.remount === true,
    });
  };

  /**
   * Re-apply form fields from an EntitySummary. Used by openEdit and by
   * in-place refresh after authority backfill so the open card shows new data
   * without close/reopen (including uncontrolled TextFields via editFormEpoch).
   */
  const syncEditFormFields = useCallback(
    (entity: EntitySummary, options?: { resetAccordions?: boolean; remount?: boolean }) => {
      const suggestedRomanized =
        entity.romanized ??
        (entity.kind === 'person'
          ? suggestPersonRomanization(entity.names[0] ?? '', projectLang)
          : autoRomanizeForKind(entity.names[0] ?? '', projectLang, entity.kind));
      setEditCanonicalName(entity.names[0] ?? '');
      setEditingName(false);
      setEditingRomanized(false);
      const description = entity.description ?? '';
      setEditDescriptionSeed(description);
      editDescriptionRef.current = description;
      setEditRomanized(suggestedRomanized ?? '');
      const workDate = entity.workDate;
      const isFloruitRange = workDate?.startPrecision === 'fl.';
      const birthAssertion = entity.assertions.find(
        (assertion) => assertion.element === 'birth' && assertion.origin === 'user',
      );
      const deathAssertion = entity.assertions.find(
        (assertion) => assertion.element === 'death' && assertion.origin === 'user',
      );
      if (isFloruitRange) {
        setDateBirth(workDate?.startYear != null ? String(Math.abs(workDate.startYear)) : '');
        setDateDeath(workDate?.endYear != null ? String(Math.abs(workDate.endYear)) : '');
        setDateBirthBce(false);
        setDateDeathBce(false);
        setDateBirthQualifier('fl.');
        setDateDeathQualifier('');
      } else {
        setDateBirth(entity.startYear != null ? String(Math.abs(entity.startYear)) : '');
        setDateDeath(entity.endYear != null ? String(Math.abs(entity.endYear)) : '');
        setDateBirthBce(entity.startYear != null && entity.startYear < 0);
        setDateDeathBce(entity.endYear != null && entity.endYear < 0);
        setDateBirthQualifier((birthAssertion?.precision as DatePrecision) ?? '');
        setDateDeathQualifier((deathAssertion?.precision as DatePrecision) ?? '');
      }
      setWorkDateStart(
        workDate?.startYear != null
          ? String(Math.abs(workDate.startYear))
          : entity.startYear != null
            ? String(Math.abs(entity.startYear))
            : '',
      );
      setWorkDateEnd(
        workDate?.endYear != null
          ? String(Math.abs(workDate.endYear))
          : entity.endYear != null
            ? String(Math.abs(entity.endYear))
            : '',
      );
      setWorkDateStartPrecision((workDate?.startPrecision as WorkDatePrecision) ?? '');
      setWorkDateEndPrecision((workDate?.endPrecision as WorkDatePrecision) ?? '');
      setDateEditing(false);
      setValuesEditing(false);
      setPendingValidations([]);
      setEditNameTypes(
        Object.fromEntries(entity.nameEntries.map((entry) => [entry.text, entry.type ?? ''])),
      );
      setEditNameLanguages(
        Object.fromEntries(
          entity.nameEntries
            .filter((entry) => entry.lang)
            .map((entry) => [entry.text, entry.lang!] as const),
        ),
      );
      setEditNewName('');
      setEditNewNameType('');
      setEditNewNameLanguage('');
      setNewTitle({ dynasty: '', fief: '', posthumousName: '', title: '' });
      if (options?.resetAccordions !== false) {
        setNamesExpanded(false);
        setTitlesExpanded(false);
      }
      if (options?.remount) {
        setEditFormEpoch((epoch) => epoch + 1);
      }
    },
    [projectLang],
  );

  /**
   * A direct field edit changes one entity, not the entire database. Keep the
   * virtualized list stable by replacing that one row; full reloads remain for
   * bulk jobs, identity changes, and external filesystem changes.
   */
  const refreshListEntityFromSqlite = async (targetStore: EntityStore, entityId: string) => {
    const raw = await targetStore.sqliteEntitySummary(entityId);
    if (!raw) return;
    const refreshed = entitySummaryFromSqlite(raw as Parameters<typeof entitySummaryFromSqlite>[0]);
    setEntities((previous) =>
      previous.map((entity) =>
        entity.id === entityId
          ? {
              ...refreshed,
              projectKey: entity.projectKey,
              centralKey: entity.centralKey,
            }
          : entity,
      ),
    );
  };

  /**
   * Require a typed SQLite transaction for panel mutations.
   * Migrated DBs must not fall back to DOM/XML (sibling entities.xml is stale).
   */
  const runSqliteEntityMutation = useCallback(
    async (
      entityId: string,
      message: string,
      mutate: (targetStore: EntityStore) => Promise<void>,
    ): Promise<boolean> => {
      const targetStore = resolveStoreFor(entityId);
      if (!targetStore) {
        setLoadError(SQLITE_REQUIRED_MESSAGE);
        return false;
      }
      const sqliteAvailable =
        Boolean(window.electronAPI?.entitySqliteGet) && (await targetStore.hasSqliteDatabase());
      if (!sqliteAvailable) {
        setLoadError(SQLITE_REQUIRED_MESSAGE);
        return false;
      }
      setBusyMessage(message);
      try {
        await mutate(targetStore);
        await refreshEditEntityFromSqlite(targetStore, entityId);
        await refreshListEntityFromSqlite(targetStore, entityId);
        return true;
      } catch (error) {
        setLoadError(error instanceof Error ? error.message : String(error));
        return false;
      } finally {
        setBusyMessage(null);
      }
    },
    // Same as above: `refreshEditEntityFromSqlite` is declared later in the
    // component, so listing it here would be a temporal-dead-zone reference.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [resolveStoreFor],
  );

  const rejectAssertionKeys = useCallback(
    (entityId: string, keys: string[], message: string) => {
      void (async () => {
        await runSqliteEntityMutation(entityId, message, async (targetStore) => {
          for (const key of keys) await targetStore.sqliteRejectAssertion(entityId, key);
        });
      })();
    },
    [runSqliteEntityMutation],
  );

  const restoreAssertionKeys = useCallback(
    (entityId: string, keys: string[], message: string) => {
      void (async () => {
        await runSqliteEntityMutation(entityId, message, async (targetStore) => {
          for (const key of keys) await targetStore.sqliteRestoreAssertion(entityId, key);
        });
      })();
    },
    [runSqliteEntityMutation],
  );

  const removeAssertionKeys = useCallback(
    (entityId: string, keys: string[], message: string) => {
      void (async () => {
        await runSqliteEntityMutation(entityId, message, async (targetStore) => {
          for (const key of keys) await targetStore.sqliteRemoveAssertion(entityId, key);
        });
      })();
    },
    [runSqliteEntityMutation],
  );

  /** Merge button: <2 selected extends the search with an alternation, ≥2 opens the merge dialog. */
  const handleMergeClick = () => {
    const ids = pruneToKnownEntityIds(selected, entities);
    if (ids.length !== selected.size) {
      setSelected(new Set(ids));
      if (ids.length < selected.size) {
        notifyViaSnackbar({
          message:
            'Dropped selected ids that are not in this database (often leftover after switching Project/Central).',
          options: { variant: 'info' },
        });
      }
    }
    if (ids.length >= 2) {
      setMergeIds(ids);
      setMergeKeepId(oldestId(ids));
      return;
    }
    setSearch((previous) => `${previous}|`);
    searchInputRef.current?.focus();
  };

  const confirmMerge = () => {
    if (!mergeIds || !mergeKeepId) return;
    const ids = pruneToKnownEntityIds(mergeIds, entities);
    if (ids.length < 2 || !ids.includes(mergeKeepId)) {
      setMergeIds(null);
      setSelected(new Set(ids));
      notifyViaSnackbar({
        message:
          'Cannot merge: one or more selected entities are not in this database. Selection was cleaned — try again.',
        options: { variant: 'warning' },
      });
      return;
    }
    const dropIds = ids.filter((id) => id !== mergeKeepId);
    const targetStore = resolveStoreFor(mergeKeepId);
    // A conflict only matters for a PEDB merge: it's the signal that two
    // *central* entities might also be duplicates (see mergeEntities). A
    // central-to-central merge has no PEDB counterpart to raise a suggestion for.
    const isProjectMerge = targetStore === store;
    setMergeIds(null);
    if (!targetStore) return;

    void (async () => {
      let sourceDbId: string | null = null;
      let centralConflicts: CentralMergeConflict[] = [];

      const handled = await runSqliteRemapMutation(targetStore, 'Merging entities…', async () => {
        sourceDbId = await targetStore.sqliteDatabaseId();
        const result = await targetStore.sqliteMerge(mergeKeepId, dropIds);
        centralConflicts = result.centralConflicts;
        return result.remap;
      });

      if (!handled) return;

      if (!isProjectMerge || !centralStore || centralConflicts.length === 0) return;
      for (const conflict of centralConflicts) {
        await centralStore
          .recordMergeSuggestion(sourceDbId ?? 'unknown', [
            conflict.keptCentralId,
            conflict.droppedCentralId,
          ])
          .catch(() => undefined);
      }
      computeMergeDocket(centralStore)
        .then((docket) => setDocketCount(docket.length))
        .catch(() => undefined);
    })();
  };

  const requestDetach = (entity: EntitySummary, ref: AuthorityId) => {
    const detach = () =>
      void (async () => {
        await runSqliteEntityMutation(entity.id, 'Detaching authority…', async (targetStore) => {
          await targetStore.sqliteDecoupleAuthority(entity.id, ref.type, ref.value);
        });
      })();
    if (skipEntityDetachConfirm) {
      detach();
      return;
    }
    setSkipDetachChecked(false);
    setConfirm({
      title: `Detach ${ref.type} from ${entity.names[0] ?? entity.id}?`,
      body: `The ${ref.type} identifier will be removed from this entity. Documents are not touched.`,
      confirmLabel: 'Detach',
      showSkipDetachOption: true,
      onConfirm: detach,
    });
  };

  /**
   * Delete button in the entity edit dialog: strips the key from every tagged
   * mention across all projects sharing this database (via the merge/delete
   * remap engine already used for merges), then removes the entity itself from
   * PEDB. When the deleted entity is linked to the user's central database, a
   * delete suggestion is lodged there too — the central row is purged only
   * after review in the merge docket, never automatically.
   */
  const requestDeleteEntity = (entity: EntitySummary) => {
    requestDeleteEntities([entity]);
  };

  const requestDeleteEntities = (targets: EntitySummary[]) => {
    const entitiesToDelete = targets.filter((entity) => resolveStoreFor(entity.id));
    if (entitiesToDelete.length === 0) return;
    const single = entitiesToDelete.length === 1 ? entitiesToDelete[0]! : null;
    setConfirm({
      title: single
        ? t('LWC.desktop.sidebar.database.delete_entity_title', {
            name: single.names[0] ?? single.id,
          })
        : t('LWC.desktop.sidebar.database.delete_selected_title', {
            count: entitiesToDelete.length,
            defaultValue: `Delete ${entitiesToDelete.length} entities?`,
          }),
      body: t('LWC.desktop.sidebar.database.delete_entity_body'),
      confirmLabel: t('LWC.desktop.sidebar.database.delete_entity_confirm'),
      destructive: true,
      onConfirm: () => {
        void (async () => {
          // Group by store so project and central rows stay on their own DB.
          const byStore = new Map<EntityStore, EntitySummary[]>();
          for (const entity of entitiesToDelete) {
            const targetStore = resolveStoreFor(entity.id);
            if (!targetStore) continue;
            const list = byStore.get(targetStore) ?? [];
            list.push(entity);
            byStore.set(targetStore, list);
          }

          let anyHandled = false;
          const deletedIds = new Set<string>();
          for (const [targetStore, group] of byStore) {
            const isProjectEntity = targetStore === store;
            const centralPurges: { sourceDbId: string; centralId: string }[] = [];
            const handled = await runSqliteRemapMutation(
              targetStore,
              group.length === 1
                ? t('LWC.desktop.sidebar.database.deleting_entity')
                : t('LWC.desktop.sidebar.database.deleting_selected', {
                    count: group.length,
                    defaultValue: `Deleting ${group.length} entities…`,
                  }),
              async () => {
                const sourceDbId = await targetStore.sqliteDatabaseId();
                const remap: Record<string, string | null> = {};
                for (const entity of group) {
                  if (isProjectEntity && centralStore && sourceDbId) {
                    const api = desktopEntityFileApi();
                    if (api) {
                      const { id: userStableId } = await readOrMintUserStableId(
                        api,
                        centralStore.centralFolder,
                      );
                      const centralId = await targetStore.sqliteGetCentralId(
                        entity.id,
                        userStableId,
                      );
                      if (centralId) {
                        centralPurges.push({ sourceDbId, centralId });
                      }
                    }
                  }
                  await targetStore.sqliteSoftDelete(entity.id);
                  remap[entity.id] = null;
                  deletedIds.add(entity.id);
                }
                return remap;
              },
            );
            if (!handled) continue;
            anyHandled = true;
            if (centralStore && centralPurges.length > 0) {
              for (const purge of centralPurges) {
                await centralStore
                  .recordDeleteSuggestion(purge.sourceDbId, purge.centralId)
                  .catch(() => undefined);
              }
              computeMergeDocket(centralStore)
                .then((docket) => setDocketCount(docket.length))
                .catch(() => undefined);
            }
          }

          if (!anyHandled) return;
          setEditEntity((previous) => (previous && deletedIds.has(previous.id) ? null : previous));
        })();
      },
    });
  };

  const requestDeleteSelected = () => {
    const ids = pruneToKnownEntityIds(selected, entities);
    if (ids.length !== selected.size) {
      setSelected(new Set(ids));
    }
    const targets = ids
      .map((id) => entities.find((entity) => entity.id === id))
      .filter((entity): entity is EntitySummary => Boolean(entity));
    requestDeleteEntities(targets);
  };

  const openEdit = useCallback(
    (entity: EntitySummary) => {
      setEditEntity(entity);
      syncEditFormFields(entity, { resetAccordions: true });
    },
    [syncEditFormFields],
  );

  const queueValidation = useCallback(
    (keys: string[], mode: PendingValidationMode = 'assertion') => {
      if (!editEntity || keys.length === 0) return;
      setPendingValidations((previous) => {
        const existing = new Set(previous.map((item) => `${item.mode}\0${item.key}`));
        const additions = keys
          .filter((key) => !existing.has(`${mode}\0${key}`))
          .map((key) => ({ key, mode }));
        return additions.length > 0 ? [...previous, ...additions] : previous;
      });
      setEditEntity((previous) =>
        previous
          ? {
              ...previous,
              assertions: previous.assertions.map((assertion) =>
                keys.includes(assertion.key)
                  ? { ...assertion, origin: 'user' as const, status: 'active' as const }
                  : assertion,
              ),
            }
          : previous,
      );
    },
    [editEntity],
  );

  const openEntityLookup = (entity: EntitySummary) => {
    const lookupStore = getDefaultStore();
    lookupStore.set(entityLookupDialogAtom, {
      isUserAuthenticated: window.writer?.overmindState?.user?.uri !== '#anonymous',
      query: entity.names[0] ?? '',
      type: entity.kind === 'org' ? 'organization' : entity.kind,
      attachToEntityId: entity.id,
      onClose: (response) => {
        lookupStore.set(entityLookupDialogAtom, RESET);
        if (!response || response.repository === 'entity-database') return;
        void (async () => {
          const uris = [response.uri, ...(response.extraUris ?? [])];
          const refs = uris.map((uri) => {
            const parsed = parseAuthorityUri(uri);
            return {
              type: parsed?.idnoType ?? response.repository,
              value: parsed?.value ?? uri,
            };
          });
          await runSqliteEntityMutation(entity.id, 'Linking authority…', async (targetStore) => {
            for (const ref of refs) {
              await targetStore.sqliteAttachAuthority(entity.id, ref.type, ref.value);
            }
            // Mirror EntityLookupField: enrich names/dates from packs + Wikidata
            // so the open card shows badges and new data without a second Refresh.
            if (
              (entity.kind === 'person' || entity.kind === 'work') &&
              window.electronAPI?.entitySqliteApplyAuthorityBackfillPatch
            ) {
              await backfillEntitiesSqlite(targetStore, {
                entityIds: [entity.id],
                readPackFile: cachedPackReader(),
                lookupPackRowsByIds: packRowsByIdsReader(),
                projectLang,
                desktopLanguage: i18n.language,
                expandWikidataWorks: entity.kind === 'person',
                lookupAuthorityRef: window.electronAPI?.authorityRefLookup,
              }).catch(() => undefined);
              if (targetStore === store) {
                await autoSyncEntitiesToCentral(null, [entity.id]).catch(() => undefined);
              }
            }
          });
        })();
      },
    });
  };

  const refreshWorkDetails = async (entity: EntitySummary) => {
    const wikidata = entity.authorities.find((ref) => ref.type.toLowerCase() === 'wikidata');
    const qid = extractWikidataId(wikidata?.value ?? '');
    if (!qid) return;
    const targetStore = resolveStoreFor(entity.id);
    if (!targetStore) return;
    if (
      (await targetStore.hasSqliteDatabase()) &&
      window.electronAPI?.entitySqliteApplyAuthorityBackfillPatch
    ) {
      if (backfillBusy) return;
      const controller = new AbortController();
      backfillAbortRef.current = controller;
      setBackfillBusy(true);
      setBackfillScopeIds([entity.id]);
      setBackfillProgress({ done: 0, total: 1, entityLabel: entity.names[0] });
      try {
        const result = await backfillEntitiesSqlite(targetStore, {
          entityIds: [entity.id],
          projectLang,
          desktopLanguage: i18n.language,
          signal: controller.signal,
          lookupAuthorityRef: window.electronAPI?.authorityRefLookup,
          onProgress: (progress) =>
            setBackfillProgress({
              done: progress.done,
              total: progress.total,
              entityLabel: progress.entityLabel,
            }),
        });
        if (result.entitiesUpdated > 0 && targetStore === store) {
          // Authors minted during work refresh are promoted when sync is on.
          await autoSyncEntitiesToCentral(null, [entity.id]);
        }
        if (syncToCentral && store && centralStore && targetStore === centralStore) {
          scheduleMirrorSync();
        }
        if (editEntityIdRef.current === entity.id) {
          await refreshEditEntityFromSqlite(targetStore, entity.id, { remount: true });
          await refreshListEntityFromSqlite(targetStore, entity.id);
        } else {
          await reload();
        }
      } catch (error) {
        setLoadError(error instanceof Error ? error.message : String(error));
      } finally {
        backfillAbortRef.current = null;
        setBackfillBusy(false);
        setBackfillScopeIds(null);
        setBackfillProgress(null);
      }
      return;
    }
    setLoadError(SQLITE_REQUIRED_MESSAGE);
  };

  const startRename = () => {
    nameBeforeRename.current = editCanonicalName;
    setEditingName(true);
  };

  const acceptRename = () => {
    const trimmed = editCanonicalName.trim();
    setEditCanonicalName(trimmed || nameBeforeRename.current);
    setEditingName(false);
  };

  const cancelRename = () => {
    setEditCanonicalName(nameBeforeRename.current);
    setEditingName(false);
  };

  const startRomanizedEdit = () => {
    romanizedBeforeEdit.current = editRomanized;
    setEditingRomanized(true);
  };

  const acceptRomanizedEdit = () => {
    setEditRomanized((value) => value.trim());
    setEditingRomanized(false);
  };

  const cancelRomanizedEdit = () => {
    setEditRomanized(romanizedBeforeEdit.current);
    setEditingRomanized(false);
  };

  const saveEdit = () => {
    if (!editEntity) return;
    const id = editEntity.id;
    const validations = pendingValidations;
    const canonicalName = editCanonicalName.trim();
    const description = editDescriptionRef.current;
    const romanized = editRomanized.trim();
    const romanizedChanged = romanized !== (editEntity.romanized ?? '');
    setEditEntity(null);
    setPendingValidations([]);
    void (async () => {
      await runSqliteEntityMutation(id, 'Saving entity…', async (targetStore) => {
        for (const validation of validations) {
          if (validation.mode === 'date') {
            await targetStore.sqliteAcceptDateAssertion(id, validation.key);
          } else if (validation.mode === 'geo') {
            await targetStore.sqliteAcceptGeoAssertion(id, validation.key);
          } else if (validation.mode === 'description') {
            await targetStore.sqliteAcceptDescriptionAssertion(id, validation.key);
          } else {
            await targetStore.sqliteValidateAssertion(id, validation.key);
          }
        }
        if (canonicalName) await targetStore.sqliteRenamePrimaryName(id, canonicalName);
        await targetStore.sqliteUpdateDescription(id, description);
        if (romanizedChanged) await targetStore.sqliteSetRomanizedName(id, romanized);
      });
    })();
  };

  const saveDates = () => {
    if (!editEntity) return;
    const parseYear = (value: string, bce: boolean): number | null => {
      const number = Number(value.trim());
      if (!value.trim() || !Number.isInteger(number) || number < 0) return null;
      return bce ? -number : number;
    };
    const start = parseYear(dateBirth, dateBirthBce);
    const end = parseYear(dateDeath, dateDeathBce);
    const entityId = editEntity.id;
    const asFloruit = dateBirthQualifier === 'fl.';
    setDateEditing(false);
    void (async () => {
      await runSqliteEntityMutation(entityId, 'Saving dates…', async (targetStore) => {
        if (asFloruit) {
          // CBDB-style earliest–latest: dates row + fl., not birth/death.
          await targetStore.sqliteSetUserDate({
            entityId,
            part: 'birth',
            year: null,
            precision: null,
          });
          await targetStore.sqliteSetUserDate({
            entityId,
            part: 'death',
            year: null,
            precision: null,
          });
          await targetStore.sqliteSetUserWorkDate({
            entityId,
            startYear: start,
            endYear: end ?? start,
            startPrecision: 'fl.',
            endPrecision: null,
          });
          return;
        }
        // Leaving floruit mode: clear a prior floruit dates row if present.
        if (editEntity.workDate?.startPrecision === 'fl.') {
          await targetStore.sqliteSetUserWorkDate({
            entityId,
            startYear: null,
            endYear: null,
          });
        }
        await targetStore.sqliteSetUserDate({
          entityId,
          part: 'birth',
          year: start,
          precision: dateBirthQualifier,
        });
        await targetStore.sqliteSetUserDate({
          entityId,
          part: 'death',
          year: end,
          precision: dateDeathQualifier,
        });
      });
    })();
  };

  const saveWorkDates = () => {
    if (!editEntity) return;
    const parseYear = (value: string): number | null => {
      const number = Number(value.trim());
      return value.trim() && Number.isInteger(number) && number >= 0 ? number : null;
    };
    const startYear = parseYear(workDateStart);
    const endYear = parseYear(workDateEnd);
    const startPrecision = workDateStartPrecision || null;
    const endPrecision = workDateEndPrecision || null;
    const entityId = editEntity.id;
    setDateEditing(false);
    void (async () => {
      await runSqliteEntityMutation(entityId, 'Saving dates…', async (targetStore) => {
        await targetStore.sqliteSetUserWorkDate({
          entityId,
          startYear,
          endYear,
          startPrecision,
          endPrecision,
        });
      });
    })();
  };

  const saveWorkType = (workType: string) => {
    if (!editEntity) return;
    const entityId = editEntity.id;
    void (async () => {
      await runSqliteEntityMutation(entityId, 'Saving type…', async (targetStore) => {
        await targetStore.sqliteSetWorkType({ entityId, workType: workType || 'book' });
      });
    })();
  };

  /** One tab-aligned row: label only on the first line of a field, blank thereafter. */
  interface GridRow {
    key: string;
    label: string;
    value: ReactNode;
    trailing?: ReactNode;
    muted?: boolean;
  }

  // All of this only depends on editEntity/showRejected/dateEditing/databaseView, not on
  // unrelated component state (search text, in-progress name/description edits, …) — memoized
  // so typing elsewhere in the dialog doesn't rebuild these rows (and their embedded
  // Tooltip/IconButton elements) on every keystroke.
  const {
    dateGridRows,
    nationalityGridRows,
    originGridRows,
    descriptionGroups,
    geoGroups,
    nameRows,
    roleRows,
  } = useMemo(() => {
    const dateAssertions =
      editEntity?.assertions.filter(
        (assertion) =>
          (assertion.element === 'birth' || assertion.element === 'death') &&
          assertion.origin === 'authority' &&
          (showRejected || assertion.status === 'active'),
      ) ?? [];
    const dateYear = (assertion: EntityAssertionSummary | undefined): number | null => {
      if (!assertion) return null;
      const value = Number(assertion.value);
      return Number.isFinite(value) ? value : null;
    };
    const userBirthAssertion = editEntity?.assertions.find(
      (assertion) =>
        assertion.element === 'birth' &&
        assertion.origin === 'user' &&
        assertion.status === 'active',
    );
    const userDeathAssertion = editEntity?.assertions.find(
      (assertion) =>
        assertion.element === 'death' &&
        assertion.origin === 'user' &&
        assertion.status === 'active',
    );
    const userBirthYearRaw = dateYear(userBirthAssertion);
    const userDeathYearRaw = dateYear(userDeathAssertion);
    // Ignore sentinel `0` (unknown CBDB / polluted Central mint) so authority
    // birth/death assertions can surface as the primary span.
    const userBirthYear =
      userBirthYearRaw != null && userBirthYearRaw !== 0
        ? userBirthYearRaw
        : editEntity?.startYear != null && editEntity.startYear !== 0
          ? editEntity.startYear
          : null;
    const userDeathYear =
      userDeathYearRaw != null && userDeathYearRaw !== 0
        ? userDeathYearRaw
        : editEntity?.endYear != null && editEntity.endYear !== 0
          ? editEntity.endYear
          : null;
    const workDate =
      editEntity?.kind === 'work' || editEntity?.kind === 'office' ? editEntity.workDate : null;
    const pendingDateAssertions = dateAssertions.filter((assertion) => {
      const current = assertion.element === 'birth' ? userBirthYear : userDeathYear;
      return assertion.status === 'active' && (current == null || dateYear(assertion) !== current);
    });
    const rejectedDateAssertions = dateAssertions.filter(
      (assertion) => assertion.status === 'rejected',
    );
    const agreeingDateSources = Array.from(
      new Set(
        dateAssertions
          .filter((assertion) => {
            const current = assertion.element === 'birth' ? userBirthYear : userDeathYear;
            return (
              assertion.status === 'active' && current != null && dateYear(assertion) === current
            );
          })
          .map((assertion) => assertion.source?.split(':')[0])
          .filter((source): source is string => Boolean(source)),
      ),
    );

    const nationalityAssertions =
      editEntity?.assertions.filter((assertion) => assertion.element === 'nationality') ?? [];
    const nationalityKeyOf = (assertion: EntityAssertionSummary): string =>
      canonicalNationalityLabel(assertion.source, assertion.ref, assertion.value);
    const nationalityGroups = groupFieldAssertions(
      nationalityAssertions,
      new Set(editEntity?.nationalities ?? []),
      showRejected,
      nationalityKeyOf,
    );
    const originAssertions =
      editEntity?.assertions.filter((assertion) => assertion.element === 'placeName') ?? [];
    const originGroups = groupFieldAssertions(
      originAssertions,
      new Set(editEntity?.placesOfOrigin ?? []),
      showRejected,
    );
    /** Distinct agreeing sources per current value, so each row gets its own badge. */
    const sourcesForValue = (
      assertions: EntityAssertionSummary[],
      value: string,
      keyOf: (assertion: EntityAssertionSummary) => string = (assertion) => assertion.value,
    ): string[] =>
      Array.from(
        new Set(
          assertions
            .filter(
              (assertion) =>
                assertion.status === 'active' &&
                Boolean(assertion.source) &&
                keyOf(assertion) === value,
            )
            .map((assertion) => assertion.source?.split(':')[0])
            .filter((source): source is string => Boolean(source)),
        ),
      );

    /** Every active assertion key backing a displayed value, so "remove" can clear all of them. */
    const keysForValue = (
      assertions: EntityAssertionSummary[],
      value: string,
      keyOf: (assertion: EntityAssertionSummary) => string = (assertion) => assertion.value,
    ): string[] =>
      assertions
        .filter((assertion) => assertion.status === 'active' && keyOf(assertion) === value)
        .map((assertion) => assertion.key);

    const dateMarker = (element: string): string =>
      element === 'birth'
        ? t('LWC.desktop.sidebar.database.date_marker_birth')
        : t('LWC.desktop.sidebar.database.date_marker_death');

    const factTrailingClusterSx = {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'flex-end',
      gap: 0.25,
      width: '100%',
      minWidth: 0,
    };

    /** One row per distinct (element, value) — every source agreeing on "d. 226" shares one line. */
    const acceptDateGroupRow = (group: AssertionValueGroup, muted = false): GridRow => {
      const year = Number(group.value);
      const display = Number.isFinite(year) ? scholarlyYear(year, group.precision, t) : group.value;
      return {
        key: group.keys.join('+'),
        label: '',
        value: `${dateMarker(group.element)} ${display}`,
        muted,
        trailing: muted ? (
          <Tooltip title={t('LWC.desktop.sidebar.database.restore_data')}>
            <IconButton
              size="small"
              sx={neutralActionButtonSx}
              onClick={() =>
                restoreAssertionKeys(
                  editEntity!.id,
                  group.keys,
                  t('LWC.desktop.sidebar.database.restoring_data'),
                )
              }
            >
              <UndoIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        ) : (
          <Stack direction="row" spacing={0.5} alignItems="center" sx={factTrailingClusterSx}>
            <SourceBadges label={group.sources.join('+')} />
            <Box>
              <Tooltip title={t('LWC.desktop.sidebar.database.accept_data')}>
                <IconButton
                  size="small"
                  sx={neutralActionButtonSx}
                  onClick={() => queueValidation([group.keys[0]!], 'date')}
                >
                  <CheckIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Box>
            <Box>
              <Tooltip title={t('LWC.desktop.sidebar.database.reject_data')}>
                <IconButton
                  size="small"
                  sx={neutralActionButtonSx}
                  onClick={() =>
                    rejectAssertionKeys(
                      editEntity!.id,
                      group.keys,
                      t('LWC.desktop.sidebar.database.rejecting_data'),
                    )
                  }
                >
                  <ClearIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Box>
          </Stack>
        ),
      };
    };

    const dateBadgeLabel = [
      databaseView === 'central' ? 'CEDB' : 'PEDB',
      ...agreeingDateSources,
    ].join('+');

    const dateGridRows: GridRow[] =
      (editEntity?.kind === 'person' ||
        editEntity?.kind === 'work' ||
        editEntity?.kind === 'office') &&
      !dateEditing
        ? [
            {
              key: 'dates-span',
              label: `${t('LWC.desktop.sidebar.database.dates')}:`,
              value:
                editEntity?.kind === 'work' || editEntity?.kind === 'office'
                  ? scholarlyDateRange(
                      workDate?.startYear ?? null,
                      workDate?.endYear ?? null,
                      workDate?.startPrecision,
                      workDate?.endPrecision,
                      t,
                    )
                  : scholarlyDateRange(
                      userBirthYear,
                      userDeathYear,
                      userBirthAssertion?.precision,
                      userDeathAssertion?.precision,
                      t,
                    ),
              trailing: (
                <Stack direction="row" spacing={0.5} alignItems="center" sx={factTrailingClusterSx}>
                  <SourceBadges label={dateBadgeLabel} />
                </Stack>
              ),
            },
            ...groupAssertionsByValue(pendingDateAssertions).map((group) =>
              acceptDateGroupRow(group),
            ),
            ...groupAssertionsByValue(rejectedDateAssertions).map((group) =>
              acceptDateGroupRow(group, true),
            ),
          ]
        : [];

    /** Turns one multi-valued field (nationality, place of origin) into tab-aligned rows. */
    const buildValueFieldRows = (field: {
      label: string;
      values: string[];
      assertions: EntityAssertionSummary[];
      groups: FieldAssertionGroups;
      /** Canonical grouping/display key for an assertion (e.g. dynasty-id crosswalk); keyed on raw value by default. */
      keyOf?: (assertion: EntityAssertionSummary) => string;
    }): GridRow[] => {
      const keyOf = field.keyOf ?? ((assertion: EntityAssertionSummary) => assertion.value);
      const lines: (Omit<GridRow, 'key' | 'label'> & { key: string })[] = [];
      for (const value of field.values) {
        const sources = sourcesForValue(field.assertions, value, keyOf);
        const keys = keysForValue(field.assertions, value, keyOf);
        const authorityKeys = field.assertions
          .filter(
            (assertion) =>
              assertion.origin === 'authority' &&
              assertion.status === 'active' &&
              keyOf(assertion) === value,
          )
          .map((assertion) => assertion.key);
        const hasUserAssertion = field.assertions.some(
          (assertion) =>
            assertion.origin === 'user' &&
            assertion.status === 'active' &&
            keyOf(assertion) === value,
        );
        lines.push({
          key: `${field.label}:${value}`,
          value,
          trailing: (
            <Stack direction="row" spacing={0.5} alignItems="center" sx={factTrailingClusterSx}>
              {hasUserAssertion && (
                <SourceBadges label={databaseView === 'central' ? 'CEDB' : 'PEDB'} />
              )}
              {sources.length > 0 && <SourceBadges label={sources.join('+')} />}
              {authorityKeys.length > 0 && !hasUserAssertion && (
                <Tooltip
                  title={`${t('LWC.desktop.sidebar.database.validate_data')}: ${field.label}`}
                >
                  <IconButton
                    size="small"
                    sx={neutralActionButtonSx}
                    aria-label={`${t('LWC.desktop.sidebar.database.validate_data')}: ${field.label} ${value}`}
                    onClick={() => queueValidation(authorityKeys)}
                  >
                    <CheckIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              )}
              {keys.length > 0 && (
                <Tooltip title={t('LWC.desktop.sidebar.database.remove_value')}>
                  <IconButton
                    size="small"
                    sx={neutralActionButtonSx}
                    onClick={() =>
                      removeAssertionKeys(
                        editEntity!.id,
                        keys,
                        t('LWC.desktop.sidebar.database.removing_data'),
                      )
                    }
                  >
                    <ClearIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              )}
            </Stack>
          ),
        });
      }
      for (const group of groupAssertionsByValue(field.groups.pending, keyOf)) {
        lines.push({
          key: group.keys.join('+'),
          value: group.value,
          trailing: (
            <Stack direction="row" spacing={0.5} alignItems="center" sx={factTrailingClusterSx}>
              <SourceBadges label={group.sources.join('+')} />
              <Tooltip title={t('LWC.desktop.sidebar.database.validate_data')}>
                <IconButton
                  size="small"
                  sx={neutralActionButtonSx}
                  onClick={() => queueValidation(group.keys)}
                >
                  <CheckIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              <Tooltip title={t('LWC.desktop.sidebar.database.reject_data')}>
                <IconButton
                  size="small"
                  sx={neutralActionButtonSx}
                  onClick={() =>
                    rejectAssertionKeys(
                      editEntity!.id,
                      group.keys,
                      t('LWC.desktop.sidebar.database.rejecting_data'),
                    )
                  }
                >
                  <ClearIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Stack>
          ),
        });
      }
      for (const group of groupAssertionsByValue(field.groups.rejected, keyOf)) {
        lines.push({
          key: `rejected:${group.keys.join('+')}`,
          value: group.value,
          muted: true,
          trailing: (
            <Tooltip title={t('LWC.desktop.sidebar.database.restore_data')}>
              <IconButton
                size="small"
                sx={neutralActionButtonSx}
                onClick={() =>
                  restoreAssertionKeys(
                    editEntity!.id,
                    group.keys,
                    t('LWC.desktop.sidebar.database.restoring_data'),
                  )
                }
              >
                <UndoIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          ),
        });
      }
      if (lines.length === 0) lines.push({ key: `${field.label}:empty`, value: '—' });
      return lines.map((line, index) => ({
        ...line,
        label: index === 0 ? `${field.label}:` : '',
      }));
    };

    const nationalityGridRows: GridRow[] =
      editEntity?.kind === 'person'
        ? buildValueFieldRows({
            label: t('LWC.desktop.sidebar.database.nationality'),
            values: editEntity.nationalities,
            assertions: nationalityAssertions,
            groups: nationalityGroups,
            keyOf: nationalityKeyOf,
          })
        : [];
    const originGridRows: GridRow[] =
      editEntity?.kind === 'person'
        ? buildValueFieldRows({
            label: t('LWC.desktop.sidebar.database.place_of_origin'),
            values: editEntity.placesOfOrigin,
            assertions: originAssertions,
            groups: originGroups,
          })
        : [];

    const descriptionAssertions =
      editEntity?.assertions.filter(
        (assertion) => assertion.element === 'note' && assertion.noteType === 'description',
      ) ?? [];
    const descriptionGroups = groupFieldAssertions(
      descriptionAssertions,
      new Set(editEntity?.description ? [editEntity.description] : []),
      showRejected,
    );

    const geoAssertions =
      editEntity?.kind === 'place'
        ? editEntity.assertions.filter((assertion) => assertion.element === 'geo')
        : [];
    const geoGroups = groupFieldAssertions(
      geoAssertions,
      new Set(
        editEntity?.location ? [`${editEntity.location.lat} ${editEntity.location.lon}`] : [],
      ),
      showRejected,
    );

    /** One row per distinct name text: authority badges + accept/reject, grouped like the fields above. */
    const nameTag = editEntity ? ENTITY_KINDS[editEntity.kind].name : null;
    const nameAssertions =
      nameTag && editEntity
        ? editEntity.assertions.filter(
            (assertion) => assertion.element === nameTag && assertion.status === 'active',
          )
        : [];
    const nameRows: NameRow[] = (editEntity?.nameEntries ?? [])
      .filter((entry) => entry.text !== editEntity?.romanized)
      .filter((entry) => {
        if (editEntity?.kind === 'person') return true;
        const type = entry.type ?? '';
        return type !== 'family' && type !== 'given';
      })
      .map((entry) => {
        const matching = nameAssertions.filter(
          (assertion) => assertion.value === entry.text && assertion.status === 'active',
        );
        const authorityMatching = matching.filter((assertion) => assertion.origin === 'authority');
        const sourcedMatching = matching.filter(
          (assertion) => assertion.status === 'active' && assertion.source,
        );
        return {
          key: entry.text,
          text: entry.text,
          sources: (() => {
            const sources = Array.from(
              new Set(
                sourcedMatching
                  .map((assertion) => assertion.source?.split(':')[0])
                  .filter((source): source is string => Boolean(source)),
              ),
            );
            // Legacy authority imports may have origin=authority but no
            // source attribute. Still expose the authority badge and the
            // tombstone action rather than silently treating them as plain
            // user names.
            if (sources.length > 0) return sources;
            // Every displayed name gets an explicit provenance affordance.
            // Legacy rows may not have a source attribute, so use the linked
            // authority ids when available and a neutral authority badge as a
            // final fallback.
            const entitySources = (editEntity?.authorities ?? []).map(
              (authority) => authority.type,
            );
            return entitySources.length > 0 ? entitySources : ['authority'];
          })(),
          keys: authorityMatching.map((assertion) => assertion.key),
          isValidated: matching.some(
            (assertion) => assertion.origin === 'user' && Boolean(assertion.source),
          ),
          isPrimary: entry.text === editEntity?.names[0],
        };
      });

    /** One row per distinct role text: authority badges + accept/reject, like names. */
    interface RoleRow {
      key: string;
      text: string;
      sources: string[];
      keys: string[];
      status: 'active' | 'rejected';
    }
    const roleAssertions =
      editEntity?.assertions.filter((assertion) => assertion.element === 'affiliation') ?? [];
    const roleTexts = Array.from(
      new Set([
        ...(editEntity?.roles ?? []),
        ...roleAssertions
          .filter(
            (assertion) =>
              assertion.status === 'active' || (showRejected && assertion.status === 'rejected'),
          )
          .map((assertion) => assertion.value)
          .filter(Boolean),
      ]),
    );
    const roleRows: RoleRow[] = roleTexts.map((text) => {
      const matching = roleAssertions.filter((assertion) => assertion.value === text);
      const activeMatching = matching.filter((assertion) => assertion.status === 'active');
      const authorityMatching = activeMatching.filter(
        (assertion) => assertion.origin === 'authority',
      );
      const rejectedMatching = matching.filter((assertion) => assertion.status === 'rejected');
      return {
        key: text,
        text,
        sources: Array.from(
          new Set(
            [...activeMatching, ...rejectedMatching]
              .filter((assertion) => assertion.source)
              .map((assertion) => assertion.source?.split(':')[0])
              .filter((source): source is string => Boolean(source)),
          ),
        ),
        keys:
          authorityMatching.length > 0
            ? authorityMatching.map((assertion) => assertion.key)
            : rejectedMatching.map((assertion) => assertion.key),
        status: activeMatching.length > 0 ? 'active' : 'rejected',
      };
    });

    return {
      dateGridRows,
      nationalityGridRows,
      originGridRows,
      descriptionGroups,
      geoGroups,
      nameRows,
      roleRows,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    editEntity,
    showRejected,
    dateEditing,
    databaseView,
    rejectAssertionKeys,
    restoreAssertionKeys,
    removeAssertionKeys,
    t,
  ]);

  const missingTranslationNudges = useMemo(() => {
    if (!editEntity || projectTranslationLanguages.length === 0) return [];
    // Person names are romanized, not given vernacular glosses.
    if (!entityKindSupportsVernacularGloss(editEntity.kind)) return [];
    // Prefer live editor state so a just-added gloss hides its chip immediately.
    const liveEntries = Object.keys(editNameTypes).map((text) => ({
      text,
      type: editNameTypes[text] || null,
      lang: editNameLanguages[text] || null,
    }));
    const entries =
      liveEntries.length > 0
        ? liveEntries
        : editEntity.nameEntries.map((entry) => ({
            text: entry.text,
            type: entry.type ?? null,
            lang: entry.lang ?? null,
          }));
    const missing = missingTranslationLangs(
      entityLikeFromNameEntries(entries),
      projectTranslationLanguages.map((lang) => lang.code),
    );
    return missing.map((code) => {
      const configured = projectTranslationLanguages.find((lang) => lang.code === code);
      return {
        code,
        label: configured?.label || languageLabelForCode(code),
      };
    });
  }, [editEntity, editNameLanguages, editNameTypes, projectTranslationLanguages]);

  const requestAddTranslation = useCallback((langCode: string) => {
    setNamesExpanded(true);
    setEditNewName('');
    setEditNewNameType('translation');
    setEditNewNameLanguage(langCode);
    setSuggestGlossError(null);
    setFocusAddNameToken((token) => token + 1);
  }, []);

  const suggestNewTranslationGloss = useCallback(async () => {
    if (!isAiUiFeatureEnabled('entityGlossSuggest')) return;
    if (!editEntity || !entityKindSupportsVernacularGloss(editEntity.kind)) return;
    if (editNewNameType !== 'translation' || !editNewNameLanguage.trim()) return;
    const suggest = window.electronAPI?.suggestEntityGloss;
    if (!suggest) {
      setSuggestGlossError(t('LWC.desktop.sidebar.database.suggest_translation_error'));
      return;
    }
    setSuggestGlossBusy(true);
    setSuggestGlossError(null);
    try {
      const chineseName =
        editEntity.nameEntries.find((entry) => (entry.lang ?? '').startsWith('zh'))?.text ??
        editEntity.names.find((name) => /[\u3400-\u9FFF]/.test(name)) ??
        null;
      const result = await suggest({
        kind: editEntity.kind,
        primaryName: editEntity.names[0] ?? null,
        romanizedName: editEntity.romanized,
        chineseName,
        description: editEntity.description,
        targetLanguage: editNewNameLanguage,
      });
      if (!result.ok || !result.gloss?.trim()) {
        setSuggestGlossError(
          result.error?.trim() || t('LWC.desktop.sidebar.database.suggest_translation_error'),
        );
        return;
      }
      setEditNewName(result.gloss.trim());
      setFocusAddNameToken((token) => token + 1);
    } catch (error) {
      setSuggestGlossError(
        error instanceof Error
          ? error.message
          : t('LWC.desktop.sidebar.database.suggest_translation_error'),
      );
    } finally {
      setSuggestGlossBusy(false);
    }
  }, [editEntity, editNewNameLanguage, editNewNameType, t]);

  const commitNameType = (text: string, type: string) => {
    if (!editEntity) return;
    const id = editEntity.id;
    setEditNameTypes((previous) => ({ ...previous, [text]: type }));
    const targetStore = resolveStoreFor(id);
    void (async () => {
      const sqliteAvailable = Boolean(
        targetStore &&
        window.electronAPI?.entitySqliteUpdateNames &&
        (await window.electronAPI.pathExists(targetStore.sqlitePath)),
      );
      if (!sqliteAvailable || !targetStore) {
        setLoadError(SQLITE_REQUIRED_MESSAGE);
        return;
      }
      setBusyMessage('Updating name type…');
      try {
        await targetStore.sqliteUpdateNames({ entityId: id, text, nameType: type || null });
        await refreshEditEntityFromSqlite(targetStore, id);
        await refreshListEntityFromSqlite(targetStore, id);
      } catch (error) {
        setLoadError(error instanceof Error ? error.message : String(error));
      } finally {
        setBusyMessage(null);
      }
    })();
  };

  const commitNameLanguage = (text: string, lang: string) => {
    if (!editEntity) return;
    const id = editEntity.id;
    setEditNameLanguages((previous) => ({ ...previous, [text]: lang }));
    const targetStore = resolveStoreFor(id);
    void (async () => {
      const sqliteAvailable = Boolean(
        targetStore &&
        window.electronAPI?.entitySqliteUpdateNames &&
        (await window.electronAPI.pathExists(targetStore.sqlitePath)),
      );
      const currentType = editNameTypes[text] || '';
      if (!sqliteAvailable || !targetStore) {
        setLoadError(SQLITE_REQUIRED_MESSAGE);
        return;
      }
      setBusyMessage('Updating name language…');
      try {
        await targetStore.sqliteUpdateNames({
          entityId: id,
          text,
          nameType: currentType || null,
          language: lang || null,
        });
        await refreshEditEntityFromSqlite(targetStore, id);
        await refreshListEntityFromSqlite(targetStore, id);
      } catch (error) {
        setLoadError(error instanceof Error ? error.message : String(error));
      } finally {
        setBusyMessage(null);
      }
    })();
  };

  /** Add-name row: text + type commit together as one new name element. */
  const commitNewName = () => {
    if (!editEntity) return;
    const id = editEntity.id;
    const text = editNewName.trim();
    if (!text) return;
    const type = (editNewNameType || null) as NameTypeId | null;
    if (type === 'translation' && !editNewNameLanguage) return;
    setEditNewName('');
    setEditNewNameType('');
    setEditNewNameLanguage('');
    const targetStore = resolveStoreFor(id);
    void (async () => {
      const sqliteAvailable = Boolean(
        targetStore &&
        window.electronAPI?.entitySqliteAddName &&
        (await window.electronAPI.pathExists(targetStore.sqlitePath)),
      );
      if (!sqliteAvailable || !targetStore) {
        setLoadError(SQLITE_REQUIRED_MESSAGE);
        return;
      }
      setBusyMessage('Adding name…');
      try {
        await targetStore.sqliteAddName({
          entityId: id,
          text,
          nameType: type,
          language: editNewNameLanguage || null,
          nameRole: 'variant',
          origin: 'user',
        });
        await refreshEditEntityFromSqlite(targetStore, id);
        await refreshListEntityFromSqlite(targetStore, id);
      } catch (error) {
        setLoadError(error instanceof Error ? error.message : String(error));
      } finally {
        setBusyMessage(null);
      }
    })();
  };

  /** Delete button on a name row: removes it immediately. */
  const commitDeleteName = (text: string) => {
    if (!editEntity) return;
    const id = editEntity.id;
    const targetStore = resolveStoreFor(id);
    void (async () => {
      const sqliteAvailable = Boolean(
        targetStore &&
        window.electronAPI?.entitySqliteRemoveName &&
        (await window.electronAPI.pathExists(targetStore.sqlitePath)),
      );
      if (!sqliteAvailable || !targetStore) {
        setLoadError(SQLITE_REQUIRED_MESSAGE);
        return;
      }
      setBusyMessage('Removing name…');
      try {
        await targetStore.sqliteRemoveName(id, text);
        await refreshEditEntityFromSqlite(targetStore, id);
        await refreshListEntityFromSqlite(targetStore, id);
      } catch (error) {
        setLoadError(error instanceof Error ? error.message : String(error));
      } finally {
        setBusyMessage(null);
      }
    })();
  };

  const commitNewNobleTitle = () => {
    if (!editEntity || editEntity.kind !== 'person') return;
    const input = newTitle;
    if (!Object.values(input).some((value) => value.trim())) return;
    const entityId = editEntity.id;
    setNewTitle({ dynasty: '', fief: '', posthumousName: '', title: '' });
    void (async () => {
      await runSqliteEntityMutation(entityId, 'Adding noble title…', async (targetStore) => {
        await targetStore.sqliteAddNobleTitle({ entityId, ...input });
      });
    })();
  };

  const commitEditNobleTitle = (
    key: string,
    input: { dynasty: string; fief: string; posthumousName: string; title: string },
  ) => {
    if (!editEntity) return;
    const entityId = editEntity.id;
    void (async () => {
      await runSqliteEntityMutation(entityId, 'Updating noble title…', async (targetStore) => {
        await targetStore.sqliteUpdateNobleTitle(entityId, key, input);
      });
    })();
  };

  const commitAddNationality = useCallback(
    (input: EntityLookupValue) => {
      if (!editEntity) return;
      const entityId = editEntity.id;
      void (async () => {
        await runSqliteEntityMutation(
          entityId,
          t('LWC.desktop.sidebar.database.adding_data'),
          async (targetStore) => {
            await targetStore.sqliteAddNationality({
              entityId,
              label: input.name,
              ref: input.ref,
              source: authoritySourceFromLookupRef(input.ref),
            });
          },
        );
      })();
    },
    [editEntity, runSqliteEntityMutation, t],
  );

  const commitAddOrigin = useCallback(
    (input: EntityLookupValue) => {
      if (!editEntity) return;
      const entityId = editEntity.id;
      void (async () => {
        await runSqliteEntityMutation(
          entityId,
          t('LWC.desktop.sidebar.database.adding_data'),
          async (targetStore) => {
            await targetStore.sqliteAddOrigin({
              entityId,
              label: input.name,
              ref: input.ref,
              source: authoritySourceFromLookupRef(input.ref),
            });
          },
        );
      })();
    },
    [editEntity, runSqliteEntityMutation, t],
  );

  const removeEditedValues = useCallback(
    (element: 'nationality' | 'placeName', values: { name: string }[]) => {
      if (!editEntity) return;
      const current =
        element === 'nationality' ? editEntity.nationalities : editEntity.placesOfOrigin;
      const removed = current.filter((value) => !values.some((item) => item.name === value));
      if (removed.length === 0) return;
      const keys = editEntity.assertions
        .filter(
          (assertion) =>
            assertion.element === element &&
            assertion.status === 'active' &&
            removed.includes(
              element === 'nationality'
                ? canonicalNationalityLabel(assertion.source, assertion.ref, assertion.value)
                : assertion.value,
            ),
        )
        .map((assertion) => assertion.key);
      if (keys.length === 0) return;
      removeAssertionKeys(editEntity.id, keys, t('LWC.desktop.sidebar.database.removing_data'));
    },
    [editEntity, removeAssertionKeys, t],
  );

  const mergeDuplicateGroup = (group: DuplicateGroup) => {
    const ids = pruneToKnownEntityIds(group.entityIds, entities);
    if (ids.length < 2) {
      notifyViaSnackbar({
        message: t('LWC.desktop.sidebar.database.merge_group_unavailable'),
        options: { variant: 'warning' },
      });
      return;
    }
    setMergeIds(ids);
    setMergeKeepId(oldestId(ids));
  };

  const markGroupIntentional = (group: DuplicateGroup) => {
    // Duplicate-authority detection is PEDB-only (see reload), so this always targets the project store.
    void (async () => {
      const entityId = group.entityIds[0];
      if (!entityId || !store) return;
      await runSqliteEntityMutation(entityId, 'Marking as intentional…', async (targetStore) => {
        await targetStore.sqliteMarkDuplicateIntentional(group.entityIds);
      });
    })();
  };

  const rejectConcordanceConflict = (conflict: ConcordanceImportResult['conflicts'][number]) => {
    void (async () => {
      const entityId = conflict.entityIds[0];
      if (!entityId) return;
      await runSqliteEntityMutation(entityId, 'Rejecting concordance…', async (targetStore) => {
        await targetStore.sqliteRejectConcordance(conflict.association, entityId);
      });
    })();
  };

  const entityById = (id: string) => entities.find((entity) => entity.id === id);

  /** Jump the list to one entity (search pins it by project key, checkbox selects it). */
  const jumpToEntity = (id: string) => {
    const entity = entities.find((row) => row.id === id);
    const projectKey = entity?.projectKey;
    if (entity) setKindFilter(entity.kind);
    if (projectKey) setSearch(`^${escapeRegExp(projectKey)}$`);
    else setSearch('');
    // Never plant a ghost id that is not in the loaded list.
    setSelected(entity ? new Set([id]) : new Set());
  };

  const openXPathForEntity = useCallback(
    (entity: EntitySummary) => {
      const projectKey = entity.projectKey;
      if (!projectKey) {
        notifyViaSnackbar({
          message: t('LWC.desktop.sidebar.database.no_project_key', {
            defaultValue: 'This entity is central-only — it has no project key in the corpus.',
          }),
          options: { variant: 'info' },
        });
        return;
      }
      const tagType =
        entity.kind === 'person'
          ? 'persName'
          : entity.kind === 'place'
            ? 'placeName'
            : entity.kind === 'org'
              ? 'orgName'
              : entity.kind === 'work'
                ? 'title'
                : entity.kind;
      window.dispatchEvent(
        new CustomEvent(DESKTOP_XPATH_SEARCH_EVENT, {
          detail: { query: `TEI//${tagType}[@key="${projectKey}"]` },
        }),
      );
    },
    [notifyViaSnackbar, t],
  );

  /** Show every implicated entity together, preselected so Merge is one click away. */
  const reviewWarningEntities = (warning: LookupWarning) => {
    const implicated = warning.entityIds
      .map((id) => entities.find((entity) => entity.id === id))
      .filter((entity): entity is EntitySummary => Boolean(entity));
    if (implicated[0]) setKindFilter(implicated[0].kind);
    const projectKeys = implicated.map((entity) => entity.projectKey ?? entity.id).filter(Boolean);
    setSearch(projectKeys.length > 0 ? `^(${projectKeys.map(escapeRegExp).join('|')})$` : '');
    // Only select entities actually present in this database list — never the
    // raw warning id set, which can include stale / cross-database ids.
    setSelected(new Set(implicated.map((entity) => entity.id)));
  };

  const dismissWarning = (warning: LookupWarning) => {
    if (!store) return;
    void (async () => {
      try {
        await resolveWarning(store, warning);
        setWarnings((previous) =>
          previous.filter((candidate) => warningKey(candidate) !== warningKey(warning)),
        );
      } catch (error) {
        setLoadError(error instanceof Error ? error.message : String(error));
      }
    })();
  };

  const entityRowProps: EntityRowData = useMemo(
    () => ({
      entities: visible,
      selected,
      toggleSelected,
      romanizedOf,
      authorityOrder,
      openEdit,
      openXPathForEntity,
      notifyViaSnackbar,
      showRejected,
      syncToCentral,
      t,
    }),
    [
      visible,
      selected,
      toggleSelected,
      romanizedOf,
      authorityOrder,
      openEdit,
      openXPathForEntity,
      notifyViaSnackbar,
      showRejected,
      syncToCentral,
      t,
    ],
  );

  const unmatchedProposals = bulkProposals.filter(
    (proposal) => proposal.reason === 'no-authority-match',
  );

  /**
   * Add every unambiguous ("no-authority-match", zero candidates) proposal to
   * the central database as a new entity and link it — the same thing
   * Promote does one-by-one elsewhere. Ambiguous proposals (candidateCentralIds
   * has 2+ entries) are left in the list: picking the right one automatically
   * risks silently merging into the wrong central entity.
   */
  const acceptAllUnmatchedProposals = async () => {
    if (unmatchedProposals.length === 0) return;
    setAcceptingProposals(true);
    setLoadError(null);
    try {
      const availability = await loadBridgeContext();
      if (!availability.available) throw new Error(availability.reason);
      const promoted = await promoteEntities(
        availability.context,
        unmatchedProposals.map((proposal) => proposal.sourceId),
      );
      const remaining = bulkProposals.filter(
        (proposal) => proposal.reason !== 'no-authority-match',
      );
      setBulkProposals(remaining);
      const api = desktopEntityFileApi();
      if (api && centralStore) {
        const proposalPath = `${centralStore.projectGrognardDir}/bulk-import-proposals.jsonl`;
        const text = remaining.map((proposal) => JSON.stringify(proposal)).join('\n');
        await api.writeFile(proposalPath, text ? `${text}\n` : '');
      }
      notifyViaSnackbar({
        message: t('LWC.desktop.sidebar.database.accept_proposals_added', { count: promoted }),
      });
      await reload();
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error));
    } finally {
      setAcceptingProposals(false);
    }
  };

  if (!store) {
    return (
      <Box sx={{ p: 2 }}>
        <Typography variant="body2" color="text.secondary">
          {t('LWC.desktop.sidebar.database.open_project_hint')}
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* Toolbar: search / type+view / tools */}
      <Stack spacing={1} sx={{ p: 1, borderBottom: 1, borderColor: 'divider' }}>
        <TextField
          fullWidth
          inputRef={searchInputRef}
          size="small"
          placeholder={t('LWC.desktop.sidebar.database.search_placeholder')}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          error={!!regexError}
          helperText={
            regexError
              ? t('LWC.desktop.sidebar.database.invalid_regex', { detail: regexError })
              : undefined
          }
          InputProps={{
            endAdornment: search ? (
              <InputAdornment position="end">
                <IconButton
                  size="small"
                  onClick={() => setSearch('')}
                  aria-label={t('LWC.desktop.sidebar.database.clear_search')}
                >
                  ×
                </IconButton>
              </InputAdornment>
            ) : undefined,
          }}
        />
        <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'nowrap' }}>
          <Autocomplete
            size="small"
            disableClearable
            autoHighlight
            openOnFocus
            options={kindFilterOptions}
            value={selectedKindOption}
            onChange={(_event, option) => setKindFilter(option.value)}
            getOptionLabel={(option) => option.label}
            isOptionEqualToValue={(a, b) => a.value === b.value}
            sx={{ flex: 1, minWidth: 140 }}
            renderInput={(params) => (
              <TextField
                {...params}
                aria-label={t('LWC.desktop.sidebar.database.entity_type_filter')}
              />
            )}
          />
          {kindFilter === 'thing' && thingTypeOptions.length > 0 && (
            <Autocomplete
              size="small"
              autoHighlight
              openOnFocus
              options={thingTypeOptions}
              value={thingTypeOptions.find((option) => option.id === subtypeFilter) ?? null}
              onChange={(_event, option) => setSubtypeFilter(option?.id ?? '')}
              getOptionLabel={(option) => option.label}
              isOptionEqualToValue={(a, b) => a.id === b.id}
              sx={{ flex: 1, minWidth: 140 }}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label={t('LWC.desktop.sidebar.database.subtype_filter')}
                  aria-label={t('LWC.desktop.sidebar.database.subtype_filter')}
                />
              )}
            />
          )}
          {!syncToCentral && (
            <Tooltip
              title={
                databaseView === 'central'
                  ? 'Browsing your central database'
                  : 'Browsing this project’s database'
              }
            >
              <span>
                <Button
                  size="small"
                  variant="contained"
                  color={databaseView === 'central' ? 'error' : 'success'}
                  onClick={() =>
                    setDatabaseView((prev) => (prev === 'central' ? 'project' : 'central'))
                  }
                  startIcon={<HubOutlinedIcon fontSize="small" />}
                  sx={{ flexShrink: 0, whiteSpace: 'nowrap' }}
                >
                  {databaseView === 'central' ? 'Central' : 'Project'}
                </Button>
              </span>
            </Tooltip>
          )}
        </Stack>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'nowrap' }}>
          <Tooltip
            title={
              selected.size >= 2
                ? t('LWC.desktop.sidebar.database.merge_selected', { count: selected.size })
                : t('LWC.desktop.sidebar.database.merge_hint')
            }
          >
            <span>
              <Button
                size="small"
                startIcon={<MergeIcon />}
                variant={selected.size >= 2 ? 'contained' : 'outlined'}
                onClick={handleMergeClick}
                sx={{ flexShrink: 0, whiteSpace: 'nowrap' }}
              >
                {t('LWC.desktop.sidebar.database.merge')}
                {selected.size >= 2 ? ` (${selected.size})` : ''}
              </Button>
            </span>
          </Tooltip>
          <Tooltip
            title={
              selected.size > 0
                ? t('LWC.desktop.sidebar.database.delete_selected', {
                    count: selected.size,
                    defaultValue: `Delete ${selected.size} selected`,
                  })
                : t('LWC.desktop.sidebar.database.delete_selected_hint', {
                    defaultValue: 'Select one or more entities to delete',
                  })
            }
          >
            <span>
              <Button
                size="small"
                color="error"
                startIcon={<DeleteOutlineIcon />}
                variant="outlined"
                disabled={selected.size === 0}
                onClick={requestDeleteSelected}
                sx={{ flexShrink: 0, whiteSpace: 'nowrap' }}
              >
                {t('LWC.desktop.sidebar.database.delete_entity')}
                {selected.size > 0 ? ` (${selected.size})` : ''}
              </Button>
            </span>
          </Tooltip>
          <Box sx={{ flex: 1, minWidth: 0 }} />
          {!syncToCentral && (
            <Tooltip title="Bridge to central database">
              <IconButton
                size="small"
                onClick={() => setBridgeOpen(true)}
                aria-label="Bridge to central database"
                sx={{ flexShrink: 0 }}
              >
                <HubOutlinedIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
          {bulkProposals.length > 0 && (
            <Tooltip title="Review entities that were not added automatically">
              <Button
                size="small"
                startIcon={<PlaylistAddIcon />}
                onClick={() => setProposalsOpen(true)}
              >
                Review ({bulkProposals.length})
              </Button>
            </Tooltip>
          )}
          {centralStore && !syncToCentral && (
            <Tooltip
              title={
                docketCount > 0
                  ? `Merge docket: ${docketCount} central suggestion(s) pending review`
                  : 'Merge docket'
              }
            >
              <IconButton
                size="small"
                onClick={() => setDocketOpen(true)}
                aria-label="Merge docket"
                sx={{ flexShrink: 0 }}
              >
                <Badge badgeContent={docketCount} color="warning">
                  <FactCheckOutlinedIcon fontSize="small" />
                </Badge>
              </IconButton>
            </Tooltip>
          )}
          <Tooltip
            title={
              'Backfill from authorities — adds missing typed names (字/名/…), dates, nationality, and place of origin ' +
              "from CBDB/DILA/Norbert packs and Wikidata, plus noble titles from Norbert's canonical person_nt data " +
              '(Norbert has no place-of-origin data). ' +
              'Best results need a rebuilt CBDB pack with bare forms in names[]; Wikidata-linked people get live enrichment.'
            }
          >
            <span>
              <IconButton
                size="small"
                disabled={!activeStore || backfillBusy}
                onClick={() => void runNameBackfill()}
                aria-label="Backfill names from authorities"
                sx={{ flexShrink: 0 }}
              >
                <PlaylistAddIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title={t('LWC.desktop.sidebar.database.reload_entities')}>
            <IconButton
              size="small"
              onClick={() => void reload()}
              aria-label={t('LWC.desktop.sidebar.database.reload_entities')}
              sx={{ flexShrink: 0 }}
            >
              <RefreshIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Stack>
        {backfillBusy &&
          !(
            editEntity &&
            backfillScopeIds?.length === 1 &&
            backfillScopeIds[0] === editEntity.id
          ) && (
            <Stack spacing={0.5}>
              <LinearProgress
                variant={
                  backfillProgress && backfillProgress.total > 0 ? 'determinate' : 'indeterminate'
                }
                value={
                  backfillProgress && backfillProgress.total > 0
                    ? (backfillProgress.done / backfillProgress.total) * 100
                    : undefined
                }
              />
              <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
                <Typography
                  variant="caption"
                  color="text.secondary"
                  noWrap
                  sx={{ flex: 1, minWidth: 0 }}
                >
                  {backfillProgress?.entityLabel
                    ? t('LWC.desktop.sidebar.database.backfill_progress_enriching', {
                        label: backfillProgress.entityLabel,
                        done: backfillProgress.done,
                        total: backfillProgress.total || '…',
                      })
                    : t('LWC.desktop.sidebar.database.backfill_progress_names')}
                </Typography>
                <Button
                  size="small"
                  onClick={() => backfillAbortRef.current?.abort()}
                  sx={{ flexShrink: 0 }}
                >
                  {t('LWC.desktop.sidebar.database.cancel')}
                </Button>
              </Stack>
            </Stack>
          )}
      </Stack>

      {/* Duplicate-authority warning */}
      {duplicates.length > 0 && (
        <Alert severity="warning" icon={<WarningAmberIcon fontSize="small" />} sx={{ m: 1, py: 0 }}>
          <Typography variant="caption" component="div" sx={{ fontWeight: 600 }}>
            {duplicates.length === 1
              ? t('LWC.desktop.sidebar.database.duplicate_authority_one')
              : t('LWC.desktop.sidebar.database.duplicate_authority_many', {
                  count: duplicates.length,
                })}
          </Typography>
          {duplicates.slice(0, 5).map((group) => (
            <Stack
              key={`${group.type}-${group.value}`}
              direction="row"
              spacing={0.5}
              alignItems="center"
              sx={{ mt: 0.5 }}
            >
              <Typography variant="caption" sx={{ flex: 1, minWidth: 0 }} noWrap>
                {group.type} {group.value}:{' '}
                {group.entityIds.map((id) => entityById(id)?.names[0] ?? id).join(', ')}
              </Typography>
              <Button size="small" onClick={() => mergeDuplicateGroup(group)}>
                {t('LWC.desktop.sidebar.database.merge')}
              </Button>
              <Button size="small" onClick={() => markGroupIntentional(group)}>
                {t('LWC.desktop.sidebar.database.intentional')}
              </Button>
            </Stack>
          ))}
        </Alert>
      )}

      {concordanceConflicts.length > 0 && (
        <Alert severity="info" sx={{ m: 1, py: 0 }}>
          <Typography variant="caption" component="div" sx={{ fontWeight: 600 }}>
            CBDB concordance associations need review
          </Typography>
          {concordanceConflicts.slice(0, 5).map((conflict) => (
            <Stack
              key={`${conflict.association.source}:${conflict.association.canonicalId}:${conflict.association.mergedFromId}`}
              direction="row"
              spacing={0.5}
              alignItems="center"
              sx={{ mt: 0.5 }}
            >
              <Typography variant="caption" sx={{ flex: 1, minWidth: 0 }} noWrap>
                {conflict.association.source} {conflict.association.canonicalId} ↔{' '}
                {conflict.association.mergedFromId}:{' '}
                {conflict.entityIds.map((id) => entityById(id)?.names[0] ?? id).join(', ')}
              </Typography>
              <Button size="small" onClick={() => rejectConcordanceConflict(conflict)}>
                Reject
              </Button>
            </Stack>
          ))}
        </Alert>
      )}

      {/* Lookup curation warnings (filed by the entity lookup dialog) */}
      {warnings.length > 0 && (
        <Alert severity="warning" icon={<WarningAmberIcon fontSize="small" />} sx={{ m: 1, py: 0 }}>
          <Typography variant="caption" component="div" sx={{ fontWeight: 600 }}>
            {warnings.length === 1
              ? t('LWC.desktop.sidebar.database.lookup_warning_one')
              : t('LWC.desktop.sidebar.database.lookup_warning_many', { count: warnings.length })}
          </Typography>
          {warnings.map((warning) => (
            <Box key={warningKey(warning)} sx={{ mt: 0.5 }}>
              <Tooltip title={warning.detail ?? ''}>
                <Typography variant="caption" component="div">
                  {warning.kind === 'concordance-conflict'
                    ? t('LWC.desktop.sidebar.database.lookup_conflict_duplicates', {
                        authority: warning.authority,
                        value: warning.value,
                      })
                    : t('LWC.desktop.sidebar.database.lookup_conflict_mismatch', {
                        authority: warning.authority,
                        value: warning.value,
                      })}
                </Typography>
              </Tooltip>
              <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap" alignItems="center">
                {warning.entityIds.map((id) => (
                  <Chip
                    key={id}
                    label={entityById(id)?.names[0] ?? id}
                    size="small"
                    variant="outlined"
                    onClick={() => jumpToEntity(id)}
                    sx={{ height: 20, '& .MuiChip-label': { px: 0.75, fontSize: 11 } }}
                  />
                ))}
                {warning.kind === 'concordance-conflict' && warning.entityIds.length > 1 && (
                  <Button size="small" onClick={() => reviewWarningEntities(warning)}>
                    {t('LWC.desktop.sidebar.database.review')}
                  </Button>
                )}
                <Button size="small" onClick={() => dismissWarning(warning)}>
                  {t('LWC.desktop.sidebar.database.dismiss')}
                </Button>
              </Stack>
            </Box>
          ))}
        </Alert>
      )}

      {loadError && (
        <Alert severity="error" sx={{ m: 1 }} onClose={() => setLoadError(null)}>
          {loadError}
        </Alert>
      )}

      {/* Entity list */}
      <Box sx={{ flex: 1, minHeight: 0 }}>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
            <CircularProgress size={20} />
          </Box>
        ) : visible.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
            {entities.length === 0
              ? t('LWC.desktop.sidebar.database.empty')
              : t('LWC.desktop.sidebar.database.no_matches')}
          </Typography>
        ) : (
          <List
            rowComponent={EntityRow}
            rowCount={visible.length}
            rowHeight={entityRowHeight}
            rowProps={entityRowProps}
            style={{ height: '100%' }}
          />
        )}
      </Box>

      {/* Footer: counts */}
      <Box sx={{ px: 1.5, py: 0.5, borderTop: 1, borderColor: 'divider' }}>
        <Typography variant="caption" color="text.secondary">
          {visible.length === entities.length
            ? `${entities.length} entities`
            : `${visible.length} of ${entities.length} entities`}
          {selected.size > 0 ? ` · ${selected.size} selected` : ''}
        </Typography>
      </Box>

      {/* Generic confirm dialog (delete / detach) */}
      <Dialog open={!!confirm} onClose={() => setConfirm(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{confirm?.title}</DialogTitle>
        <DialogContent>
          <DialogContentText>{confirm?.body}</DialogContentText>
          {confirm?.showSkipDetachOption && (
            <FormControlLabel
              sx={{ mt: 1 }}
              control={
                <Checkbox
                  size="small"
                  checked={skipDetachChecked}
                  onChange={(event) => setSkipDetachChecked(event.target.checked)}
                />
              }
              label={t('LWC.desktop.sidebar.database.dont_warn_detach')}
            />
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirm(null)}>
            {t('LWC.desktop.sidebar.database.dialogs.cancel')}
          </Button>
          <Button
            color={confirm?.destructive ? 'error' : 'primary'}
            variant="contained"
            onClick={() => {
              if (confirm?.showSkipDetachOption && skipDetachChecked)
                setSkipEntityDetachConfirm(true);
              confirm?.onConfirm();
              setConfirm(null);
            }}
          >
            {confirm?.confirmLabel}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Merge dialog */}
      <Dialog open={!!mergeIds} onClose={() => setMergeIds(null)} maxWidth="xs" fullWidth>
        <DialogTitle>
          {t('LWC.desktop.sidebar.database.merge_dialog_title', { count: mergeIds?.length ?? 0 })}
        </DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 1 }}>
            {t('LWC.desktop.sidebar.database.merge_dialog_message')}
          </DialogContentText>
          {mergeIds?.map((id) => {
            const entity = entityById(id);
            return (
              <Stack key={id} direction="row" alignItems="center" spacing={1}>
                <Radio
                  size="small"
                  checked={mergeKeepId === id}
                  onChange={() => setMergeKeepId(id)}
                />
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="body2" noWrap>
                    {entity?.names.join(' · ') ?? id}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" noWrap component="div">
                    {id}
                    {entity?.description ? ` — ${entity.description}` : ''}
                  </Typography>
                </Box>
              </Stack>
            );
          })}
          <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
            {t('LWC.desktop.sidebar.database.merge_dialog_note')}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setMergeIds(null)}>
            {t('LWC.desktop.sidebar.database.dialogs.cancel')}
          </Button>
          <Button variant="contained" onClick={confirmMerge}>
            {t('LWC.desktop.sidebar.database.merge')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Edit dialog */}
      <Dialog
        open={!!editEntity}
        onClose={() => {
          if (backfillBusy) return;
          setEditEntity(null);
        }}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>
          <Stack direction="row" alignItems="center" spacing={0.5}>
            {editingName ? (
              <TextField
                autoFocus
                fullWidth
                size="small"
                variant="standard"
                value={editCanonicalName}
                onChange={(event) => setEditCanonicalName(event.target.value)}
                onBlur={acceptRename}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    acceptRename();
                  } else if (event.key === 'Escape') {
                    // Keep the Escape from also closing the dialog.
                    event.stopPropagation();
                    cancelRename();
                  }
                }}
                inputProps={{ 'aria-label': t('LWC.desktop.sidebar.database.rename_name') }}
                InputProps={{ sx: { typography: 'h6' } }}
              />
            ) : (
              <>
                <Typography
                  variant="h6"
                  component="button"
                  type="button"
                  onClick={startRename}
                  aria-label={t('LWC.desktop.sidebar.database.rename_name')}
                  sx={{
                    minWidth: 0,
                    maxWidth: '100%',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    border: 0,
                    p: 0,
                    background: 'transparent',
                    color: 'inherit',
                    font: 'inherit',
                    fontWeight: 600,
                    textAlign: 'left',
                    cursor: 'text',
                  }}
                >
                  {editCanonicalName || editEntity?.id}
                </Typography>
                {editingRomanized ? (
                  <TextField
                    autoFocus
                    size="small"
                    variant="standard"
                    value={editRomanized}
                    onChange={(event) => setEditRomanized(event.target.value)}
                    onBlur={acceptRomanizedEdit}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        acceptRomanizedEdit();
                      } else if (event.key === 'Escape') {
                        event.stopPropagation();
                        cancelRomanizedEdit();
                      }
                    }}
                    inputProps={{ 'aria-label': t('LWC.desktop.sidebar.database.romanized_name') }}
                    InputProps={{
                      sx: { typography: 'body2' },
                      endAdornment: canAutoRomanize(projectLang) ? (
                        <InputAdornment position="end">
                          <Tooltip title={t('LWC.desktop.sidebar.database.generate_romanization')}>
                            <IconButton
                              size="small"
                              aria-label={t('LWC.desktop.sidebar.database.generate_romanization')}
                              onMouseDown={(event) => event.preventDefault()}
                              onClick={() =>
                                setEditRomanized(
                                  (editEntity?.kind === 'person'
                                    ? suggestPersonRomanization(
                                        editCanonicalName || editEntity?.names[0] || '',
                                        projectLang,
                                      )
                                    : autoRomanizeForKind(
                                        editCanonicalName || editEntity?.names[0] || '',
                                        projectLang,
                                        editEntity?.kind,
                                      )) ?? editRomanized,
                                )
                              }
                            >
                              <AutorenewIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        </InputAdornment>
                      ) : undefined,
                    }}
                    sx={{ minWidth: 0, maxWidth: 140 }}
                  />
                ) : (
                  <Typography
                    variant="body2"
                    component="button"
                    type="button"
                    onClick={startRomanizedEdit}
                    aria-label={t('LWC.desktop.sidebar.database.romanized_name')}
                    noWrap
                    sx={{
                      minWidth: 0,
                      maxWidth: 140,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      border: 0,
                      p: 0,
                      background: 'transparent',
                      color: 'text.secondary',
                      textAlign: 'left',
                      cursor: 'text',
                    }}
                  >
                    {editRomanized || t('LWC.desktop.sidebar.database.romanized_name')}
                  </Typography>
                )}
                <Tooltip title={t('LWC.desktop.sidebar.database.lookup_entity')}>
                  <IconButton
                    size="small"
                    onClick={() => editEntity && openEntityLookup(editEntity)}
                    aria-label={t('LWC.desktop.sidebar.database.lookup_entity')}
                    sx={{ p: 0.25 }}
                  >
                    <SearchIcon fontSize="inherit" />
                  </IconButton>
                </Tooltip>
              </>
            )}
            <Box sx={{ flex: 1 }} />
            {editEntity && (
              <Tooltip
                title={t(
                  showRejected
                    ? 'LWC.desktop.sidebar.database.hide_rejected'
                    : 'LWC.desktop.sidebar.database.show_rejected',
                )}
              >
                <IconButton
                  size="small"
                  aria-label={t(
                    showRejected
                      ? 'LWC.desktop.sidebar.database.hide_rejected'
                      : 'LWC.desktop.sidebar.database.show_rejected',
                  )}
                  aria-pressed={showRejected}
                  color={showRejected ? 'primary' : 'default'}
                  onClick={() => setShowRejected((previous) => !previous)}
                >
                  {showRejected ? (
                    <VisibilityIcon fontSize="small" />
                  ) : (
                    <VisibilityOffIcon fontSize="small" />
                  )}
                </IconButton>
              </Tooltip>
            )}
            {editEntity && (
              <Tooltip title={t('LWC.desktop.sidebar.database.delete_entity')}>
                <IconButton
                  size="small"
                  aria-label={t('LWC.desktop.sidebar.database.delete_entity')}
                  onClick={() => requestDeleteEntity(editEntity)}
                >
                  <DeleteOutlineIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            )}
            {editEntity && (
              <Tooltip title={t('LWC.desktop.sidebar.database.refresh_authorities')}>
                <span>
                  <IconButton
                    size="small"
                    aria-label={t('LWC.desktop.sidebar.database.refresh_authorities')}
                    disabled={
                      backfillBusy ||
                      // Offices can scrub legacy 姓/名 without linked authorities.
                      (editEntity.kind !== 'office' && editEntity.authorities.length === 0)
                    }
                    onClick={() =>
                      editEntity.kind === 'work'
                        ? void refreshWorkDetails(editEntity)
                        : void runNameBackfill([editEntity.id])
                    }
                  >
                    {backfillBusy &&
                    backfillScopeIds?.length === 1 &&
                    backfillScopeIds[0] === editEntity.id ? (
                      <CircularProgress size={16} />
                    ) : (
                      <RefreshIcon fontSize="small" />
                    )}
                  </IconButton>
                </span>
              </Tooltip>
            )}
          </Stack>
          {backfillBusy &&
            editEntity &&
            backfillScopeIds?.length === 1 &&
            backfillScopeIds[0] === editEntity.id && (
              <Stack spacing={0.5} sx={{ mt: 1 }}>
                <LinearProgress
                  variant={
                    backfillProgress && backfillProgress.total > 0 ? 'determinate' : 'indeterminate'
                  }
                  value={
                    backfillProgress && backfillProgress.total > 0
                      ? (backfillProgress.done / backfillProgress.total) * 100
                      : undefined
                  }
                />
                <Stack
                  direction="row"
                  spacing={1}
                  alignItems="center"
                  justifyContent="space-between"
                >
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    noWrap
                    sx={{ flex: 1, minWidth: 0 }}
                  >
                    {backfillProgress?.entityLabel
                      ? t('LWC.desktop.sidebar.database.backfill_progress_enriching', {
                          label: backfillProgress.entityLabel,
                          done: backfillProgress.done,
                          total: backfillProgress.total || '…',
                        })
                      : t('LWC.desktop.sidebar.database.backfill_progress_refreshing')}
                  </Typography>
                  <Button
                    size="small"
                    onClick={() => backfillAbortRef.current?.abort()}
                    sx={{ flexShrink: 0 }}
                  >
                    {t('LWC.desktop.sidebar.database.cancel')}
                  </Button>
                </Stack>
              </Stack>
            )}
          <Stack spacing={0.25} sx={{ mt: 0.25 }}>
            <Stack direction="row" alignItems="center" spacing={0.5}>
              <Typography variant="caption" color="text.secondary" component="div" noWrap>
                {t('LWC.desktop.sidebar.database.project_key', { defaultValue: 'Project' })}:{' '}
                {editEntity?.projectKey ??
                  t('LWC.desktop.sidebar.database.no_key', { defaultValue: '(none)' })}
              </Typography>
              {editEntity?.projectKey && (
                <Tooltip title={t('LWC.desktop.sidebar.database.copy_id')}>
                  <IconButton
                    size="small"
                    aria-label={t('LWC.desktop.sidebar.database.copy_id')}
                    onClick={() =>
                      void navigator.clipboard.writeText(editEntity.projectKey!).then(() => {
                        notifyViaSnackbar({
                          message: t('LWC.desktop.sidebar.database.id_copied'),
                          options: { variant: 'success' },
                        });
                      })
                    }
                    sx={{ p: 0.25 }}
                  >
                    <ContentCopyIcon sx={{ fontSize: 14 }} />
                  </IconButton>
                </Tooltip>
              )}
            </Stack>
            <Stack direction="row" alignItems="center" spacing={0.5}>
              <Typography variant="caption" color="text.secondary" component="div" noWrap>
                {t('LWC.desktop.sidebar.database.central_key', { defaultValue: 'Central' })}:{' '}
                {editEntity?.centralKey ??
                  t('LWC.desktop.sidebar.database.no_key', { defaultValue: '(none)' })}
              </Typography>
              {editEntity?.centralKey && (
                <Tooltip title={t('LWC.desktop.sidebar.database.copy_id')}>
                  <IconButton
                    size="small"
                    aria-label={t('LWC.desktop.sidebar.database.copy_id')}
                    onClick={() =>
                      void navigator.clipboard.writeText(editEntity.centralKey!).then(() => {
                        notifyViaSnackbar({
                          message: t('LWC.desktop.sidebar.database.id_copied'),
                          options: { variant: 'success' },
                        });
                      })
                    }
                    sx={{ p: 0.25 }}
                  >
                    <ContentCopyIcon sx={{ fontSize: 14 }} />
                  </IconButton>
                </Tooltip>
              )}
            </Stack>
          </Stack>
          {editEntity && normalizedAuthorityRefs(editEntity.authorities).length > 0 && (
            <Box
              sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, alignItems: 'center', mt: 0.5 }}
            >
              {sortAuthoritiesByPreference(
                normalizedAuthorityRefs(editEntity.authorities),
                authorityOrder,
                editEntity.kind,
              ).map((ref) => {
                const url = authorityLookupUrl(ref);
                return (
                  <Stack
                    key={`${ref.type}-${ref.value}`}
                    direction="row"
                    spacing={0.25}
                    alignItems="center"
                  >
                    <Box
                      component="span"
                      onClick={url ? () => openExternalUrl(url) : undefined}
                      sx={{ cursor: url ? 'pointer' : 'default', display: 'inline-flex' }}
                      title={ref.type}
                    >
                      <SourceBadges label={ref.type} />
                    </Box>
                    <Typography variant="caption" noWrap sx={{ maxWidth: 220 }}>
                      {ref.value}
                    </Typography>
                    <Tooltip title={t('LWC.desktop.sidebar.database.detach_authority')}>
                      <IconButton
                        size="small"
                        aria-label={`${t('LWC.desktop.sidebar.database.detach_authority')} ${ref.type}`}
                        onClick={() => requestDetach(editEntity, ref)}
                        sx={{ p: 0.25, color: 'text.secondary' }}
                      >
                        <ClearIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </Stack>
                );
              })}
            </Box>
          )}
        </DialogTitle>
        <DialogContent key={editFormEpoch}>
          {(editEntity?.kind === 'place' ||
            editEntity?.kind === 'office' ||
            editEntity?.kind === 'work') && (
            <Alert severity="info" sx={{ mb: 1.5, py: 0 }}>
              {t('LWC.desktop.sidebar.database.card_wip_note')}
            </Alert>
          )}
          {editEntity?.kind === 'place' && (
            <Stack direction="row" spacing={0.5} alignItems="center" sx={{ mb: 0.5 }}>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {t('LWC.desktop.sidebar.database.coordinates_heading')}
              </Typography>
              <Typography variant="body2" color={editEntity.location ? undefined : 'text.disabled'}>
                {editEntity.location
                  ? `${editEntity.location.lat.toFixed(4)}, ${editEntity.location.lon.toFixed(4)}`
                  : '—'}
              </Typography>
              {editEntity.location && (
                <>
                  <SourceBadges label={editEntity.location.source ?? 'authority'} />
                  <Tooltip title={t('LWC.desktop.sidebar.database.show_on_map')}>
                    <IconButton
                      size="small"
                      sx={neutralActionButtonSx}
                      onClick={() =>
                        setGeoMapPin({
                          id: editEntity.id,
                          label: 'A',
                          color: '#d32f2f',
                          lat: editEntity.location!.lat,
                          lon: editEntity.location!.lon,
                          sources: editEntity.location!.source ? [editEntity.location!.source] : [],
                          description: editEntity.names[0] ?? editEntity.id,
                          memberIds: [editEntity.id],
                        })
                      }
                    >
                      <RoomIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </>
              )}
            </Stack>
          )}
          {editEntity?.kind === 'place' &&
            geoGroups.pending.map((assertion) => (
              <Stack
                key={assertion.key}
                direction="row"
                spacing={0.5}
                alignItems="center"
                sx={{ mt: 0.5 }}
              >
                <Typography
                  variant="body2"
                  sx={{ flex: 1, minWidth: 0 }}
                  noWrap
                  title={assertion.value}
                >
                  {assertion.value.replace(' ', ', ')}
                </Typography>
                <SourceBadges label={assertion.source?.split(':')[0] ?? 'authority'} />
                <Tooltip title={t('LWC.desktop.sidebar.database.accept_data')}>
                  <IconButton
                    size="small"
                    sx={neutralActionButtonSx}
                    onClick={() => queueValidation([assertion.key], 'geo')}
                  >
                    <CheckIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
                <Tooltip title={t('LWC.desktop.sidebar.database.reject_data')}>
                  <IconButton
                    size="small"
                    sx={neutralActionButtonSx}
                    onClick={() =>
                      rejectAssertionKeys(
                        editEntity.id,
                        [assertion.key],
                        t('LWC.desktop.sidebar.database.rejecting_data'),
                      )
                    }
                  >
                    <ClearIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Stack>
            ))}
          {editEntity?.kind === 'place' &&
            showRejected &&
            geoGroups.rejected.map((assertion) => (
              <Stack
                key={assertion.key}
                direction="row"
                spacing={0.5}
                alignItems="center"
                sx={{ mt: 0.5 }}
              >
                <Typography
                  variant="body2"
                  sx={{ flex: 1, minWidth: 0 }}
                  noWrap
                  title={assertion.value}
                  color="text.disabled"
                >
                  {assertion.value.replace(' ', ', ')}
                </Typography>
                <SourceBadges label={assertion.source?.split(':')[0] ?? 'authority'} />
                <Tooltip title={t('LWC.desktop.sidebar.database.restore_data')}>
                  <IconButton
                    size="small"
                    sx={neutralActionButtonSx}
                    onClick={() =>
                      restoreAssertionKeys(
                        editEntity.id,
                        [assertion.key],
                        t('LWC.desktop.sidebar.database.restoring_data'),
                      )
                    }
                  >
                    <UndoIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Stack>
            ))}
          <EntityDescriptionEditor
            initialValue={editDescriptionSeed}
            label={t('LWC.desktop.sidebar.database.one_line_description')}
            onValueChange={handleEditDescriptionChange}
          />
          {editEntity?.kind === 'thing' && (
            <TextField
              select
              fullWidth
              size="small"
              sx={{ mt: 1.5 }}
              label={t('LWC.desktop.sidebar.database.subtype_filter')}
              value={editEntity.subtype ?? ''}
              onChange={(event) => {
                const value = event.target.value || null;
                void runSqliteEntityMutation(
                  editEntity.id,
                  t('LWC.desktop.sidebar.database.saving_subtype'),
                  async (targetStore) => {
                    await targetStore.sqliteUpdateSubtype(editEntity.id, value);
                  },
                );
              }}
            >
              <MenuItem value="">
                <em>{t('LWC.desktop.sidebar.database.subtype_none')}</em>
              </MenuItem>
              {thingTypeOptions.map((option) => (
                <MenuItem key={option.id} value={option.id}>
                  {option.label}
                </MenuItem>
              ))}
            </TextField>
          )}
          {editEntity &&
            descriptionGroups.pending.map((assertion) => (
              <Stack
                key={assertion.key}
                direction="row"
                spacing={0.5}
                alignItems="center"
                sx={{ mt: 0.5 }}
              >
                <Typography
                  variant="body2"
                  sx={{ flex: 1, minWidth: 0 }}
                  noWrap
                  title={assertion.value}
                >
                  {assertion.value}
                </Typography>
                <SourceBadges label={assertion.source?.split(':')[0] ?? 'authority'} />
                <Tooltip title={t('LWC.desktop.sidebar.database.accept_data')}>
                  <IconButton
                    size="small"
                    sx={neutralActionButtonSx}
                    onClick={() => {
                      const value = assertion.value;
                      queueValidation([assertion.key], 'description');
                      setEditDescriptionSeed(value);
                      editDescriptionRef.current = value;
                    }}
                  >
                    <CheckIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
                <Tooltip title={t('LWC.desktop.sidebar.database.reject_data')}>
                  <IconButton
                    size="small"
                    sx={neutralActionButtonSx}
                    onClick={() =>
                      rejectAssertionKeys(
                        editEntity.id,
                        [assertion.key],
                        t('LWC.desktop.sidebar.database.rejecting_data'),
                      )
                    }
                  >
                    <ClearIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Stack>
            ))}
          {editEntity?.kind === 'work' && (
            <TextField
              select
              size="small"
              label={t('LWC.desktop.sidebar.database.work_type')}
              value={editEntity.workType || 'book'}
              onChange={(event) => saveWorkType(event.target.value)}
              sx={{ mt: 2, minWidth: 180 }}
            >
              {WORK_TYPE_OPTIONS.map((option) => (
                <MenuItem key={option} value={option}>
                  {t(`LWC.desktop.sidebar.database.work_type_${option}`)}
                </MenuItem>
              ))}
            </TextField>
          )}
          {(editEntity?.kind === 'work' || editEntity?.kind === 'office') && dateEditing && (
            <Stack spacing={0.75} sx={{ mt: 2 }}>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {t('LWC.desktop.sidebar.database.dates')}:
              </Typography>
              <Stack spacing={0.75}>
                <Stack direction="row" spacing={0.5} alignItems="center">
                  <TextField
                    select
                    size="small"
                    value={workDateStartPrecision}
                    onChange={(event) =>
                      setWorkDateStartPrecision(event.target.value as WorkDatePrecision)
                    }
                    sx={{ minWidth: 140 }}
                  >
                    {WORK_DATE_START_PRECISION_OPTIONS.map((option) => (
                      <MenuItem key={option || 'exact'} value={option}>
                        {option || '—'}
                      </MenuItem>
                    ))}
                  </TextField>
                  <TextField
                    size="small"
                    label={t('LWC.desktop.sidebar.database.from')}
                    value={workDateStart}
                    onChange={(event) =>
                      setWorkDateStart(event.target.value.replace(/[^0-9]/g, ''))
                    }
                    sx={{ flex: 1 }}
                    inputProps={{ inputMode: 'numeric' }}
                  />
                </Stack>
                <Stack direction="row" spacing={0.5} alignItems="center">
                  <TextField
                    select
                    size="small"
                    value={workDateEndPrecision}
                    onChange={(event) =>
                      setWorkDateEndPrecision(event.target.value as WorkDatePrecision)
                    }
                    sx={{ minWidth: 140 }}
                  >
                    {WORK_DATE_END_PRECISION_OPTIONS.map((option) => (
                      <MenuItem key={option || 'exact'} value={option}>
                        {option || '—'}
                      </MenuItem>
                    ))}
                  </TextField>
                  <TextField
                    size="small"
                    label={t('LWC.desktop.sidebar.database.to')}
                    value={workDateEnd}
                    onChange={(event) => setWorkDateEnd(event.target.value.replace(/[^0-9]/g, ''))}
                    sx={{ flex: 1 }}
                    inputProps={{ inputMode: 'numeric' }}
                  />
                </Stack>
              </Stack>
              <Stack direction="row" justifyContent="flex-end" spacing={1}>
                <Button size="small" onClick={() => setDateEditing(false)}>
                  {t('LWC.desktop.sidebar.database.dialogs.cancel')}
                </Button>
                <Button size="small" variant="contained" onClick={saveWorkDates}>
                  {t('LWC.desktop.sidebar.database.save')}
                </Button>
              </Stack>
            </Stack>
          )}
          {(editEntity?.kind === 'work' || editEntity?.kind === 'office') && !dateEditing && (
            <>
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: 'max-content minmax(0, 1fr) minmax(0, 1fr)',
                  columnGap: 1,
                  rowGap: 0.25,
                  alignItems: 'center',
                  mt: 2,
                }}
              >
                {dateGridRows.map((row) => (
                  <Fragment key={row.key}>
                    <Typography
                      variant="body2"
                      sx={{ whiteSpace: 'nowrap', fontWeight: row.label ? 600 : 400 }}
                    >
                      {row.label}
                    </Typography>
                    <Typography variant="body2" color="text.primary" component="span">
                      <Box
                        component="button"
                        type="button"
                        onClick={() => setDateEditing(true)}
                        aria-label={t('LWC.desktop.sidebar.database.edit_dates')}
                        sx={{
                          border: 0,
                          p: 0,
                          background: 'transparent',
                          color: 'inherit',
                          font: 'inherit',
                          textAlign: 'left',
                          cursor: 'text',
                        }}
                      >
                        {row.value}
                      </Box>
                    </Typography>
                    <Box sx={{ display: 'flex', justifyContent: 'flex-end', minWidth: 0 }}>
                      {row.trailing}
                    </Box>
                  </Fragment>
                ))}
              </Box>
              {editEntity.kind === 'work' && (
                <Box sx={{ mt: 2 }}>
                  {editEntity.authors
                    .filter((author) => author.origin === 'authority')
                    .map((author) => (
                      <Stack
                        key={author.key}
                        direction="row"
                        spacing={0.5}
                        alignItems="center"
                        sx={{ mb: 0.5 }}
                      >
                        <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }} noWrap>
                          {author.name}
                        </Typography>
                        {author.source && <SourceBadges label={author.source.split(':')[0]} />}
                        <Tooltip title={t('LWC.desktop.sidebar.database.validate_data')}>
                          <IconButton
                            size="small"
                            sx={neutralActionButtonSx}
                            onClick={() => queueValidation([author.key])}
                          >
                            <CheckIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title={t('LWC.desktop.sidebar.database.reject_data')}>
                          <IconButton
                            size="small"
                            sx={neutralActionButtonSx}
                            onClick={() =>
                              rejectAssertionKeys(
                                editEntity.id,
                                [author.key],
                                t('LWC.desktop.sidebar.database.rejecting_data'),
                              )
                            }
                          >
                            <ClearIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </Stack>
                    ))}
                  <EntityLookupField
                    kind="person"
                    tag="persName"
                    label={`${t('LWC.desktop.sidebar.database.authors')}:`}
                    mode="multi"
                    values={editEntity.authors
                      .filter((author) => author.origin === 'user')
                      .map((author) => ({
                        name: author.name,
                        ref: author.ref ?? undefined,
                      }))}
                    onChange={(authors) =>
                      void (async () => {
                        await runSqliteEntityMutation(
                          editEntity.id,
                          'Saving authors…',
                          async (targetStore) => {
                            await targetStore.sqliteSetUserWorkAuthors(editEntity.id, authors);
                          },
                        );
                      })()
                    }
                  />
                </Box>
              )}
            </>
          )}
          {editEntity?.kind === 'person' && (
            <Stack spacing={0.75} sx={{ mt: 2 }}>
              {dateEditing && (
                <Stack direction="row" alignItems="center" spacing={0.5}>
                  <Typography variant="body2" sx={{ flex: 1 }}>
                    {t('LWC.desktop.sidebar.database.dates')}:
                  </Typography>
                </Stack>
              )}
              {dateEditing && (
                <Stack spacing={0.75}>
                  {[
                    {
                      key: 'start',
                      label:
                        dateBirthQualifier === 'fl.'
                          ? t('LWC.desktop.sidebar.database.floruit_from')
                          : t('LWC.desktop.sidebar.database.birth'),
                      value: dateBirth,
                      setValue: setDateBirth,
                      qualifier: dateBirthQualifier,
                      setQualifier: setDateBirthQualifier,
                      bce: dateBirthBce,
                      setBce: setDateBirthBce,
                      options: ['b.', 'b. ca.', 'active', 'active ca.', 'fl.'],
                      isFloruitEnd: false,
                    },
                    {
                      key: 'end',
                      label:
                        dateBirthQualifier === 'fl.'
                          ? t('LWC.desktop.sidebar.database.floruit_to')
                          : t('LWC.desktop.sidebar.database.death'),
                      value: dateDeath,
                      setValue: setDateDeath,
                      qualifier: dateDeathQualifier,
                      setQualifier: setDateDeathQualifier,
                      bce: dateDeathBce,
                      setBce: setDateDeathBce,
                      options:
                        dateBirthQualifier === 'fl.'
                          ? ['']
                          : [
                              'd.',
                              'd. ca.',
                              ...(dateBirthQualifier === 'active' ||
                              dateBirthQualifier === 'active ca.'
                                ? ['active to', 'active to ca.']
                                : []),
                            ],
                      isFloruitEnd: true,
                    },
                  ].map((part) => (
                    <Stack key={part.key} direction="row" spacing={0.5} alignItems="center">
                      <TextField
                        select
                        size="small"
                        value={
                          dateBirthQualifier === 'fl.' && part.isFloruitEnd ? '' : part.qualifier
                        }
                        onChange={(event) => part.setQualifier(event.target.value as DatePrecision)}
                        disabled={dateBirthQualifier === 'fl.' && part.isFloruitEnd}
                        sx={{ width: 92 }}
                        SelectProps={{ native: true }}
                      >
                        {part.options.map((option) => (
                          <option key={option || 'blank'} value={option}>
                            {option || '—'}
                          </option>
                        ))}
                      </TextField>
                      <TextField
                        size="small"
                        label={part.label}
                        value={part.value}
                        onChange={(event) =>
                          part.setValue(event.target.value.replace(/[^0-9]/g, ''))
                        }
                        sx={{ flex: 1 }}
                        inputProps={{ inputMode: 'numeric' }}
                      />
                      <FormControlLabel
                        control={
                          <Switch
                            size="small"
                            disabled={dateBirthQualifier === 'fl.'}
                            checked={part.bce}
                            onChange={(event) => part.setBce(event.target.checked)}
                          />
                        }
                        label="BCE"
                        sx={{ mr: 0 }}
                      />
                    </Stack>
                  ))}
                  {dateBirth &&
                    dateDeath &&
                    dateBirthQualifier !== 'fl.' &&
                    Math.abs(
                      (dateDeathBce ? -Number(dateDeath) : Number(dateDeath)) -
                        (dateBirthBce ? -Number(dateBirth) : Number(dateBirth)),
                    ) > 150 && (
                      <Alert severity="warning" sx={{ py: 0 }}>
                        {t('LWC.desktop.sidebar.database.date_lifespan_warning')}
                      </Alert>
                    )}
                  <Stack direction="row" justifyContent="flex-end" spacing={1}>
                    <Button size="small" onClick={() => setDateEditing(false)}>
                      {t('LWC.desktop.sidebar.database.dialogs.cancel')}
                    </Button>
                    <Button size="small" variant="contained" onClick={saveDates}>
                      {t('LWC.desktop.sidebar.database.save')}
                    </Button>
                  </Stack>
                </Stack>
              )}
              {valuesEditing && (
                <Stack spacing={1}>
                  <EntityLookupField
                    kind="place"
                    label={t('LWC.desktop.sidebar.database.nationality')}
                    mode="multi"
                    onChange={(values) => removeEditedValues('nationality', values)}
                    onPersistedChange={commitAddNationality}
                    tag="placeName"
                    values={editEntity.nationalities.map((name) => ({ name }))}
                  />
                  <EntityLookupField
                    kind="place"
                    label={t('LWC.desktop.sidebar.database.place_of_origin')}
                    mode="multi"
                    onChange={(values) => removeEditedValues('placeName', values)}
                    onPersistedChange={commitAddOrigin}
                    tag="placeName"
                    values={editEntity.placesOfOrigin.map((name) => ({ name }))}
                  />
                  <Stack direction="row" justifyContent="flex-end">
                    <Button size="small" onClick={() => setValuesEditing(false)}>
                      {t('LWC.desktop.sidebar.database.dialogs.cancel')}
                    </Button>
                  </Stack>
                </Stack>
              )}
              {!dateEditing && !valuesEditing && (
                <Box
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: 'max-content minmax(0, 1fr) minmax(0, 1fr)',
                    columnGap: 1,
                    rowGap: 0.25,
                    alignItems: 'center',
                  }}
                >
                  {[...dateGridRows, ...nationalityGridRows, ...originGridRows].map((row) => (
                    <Fragment key={row.key}>
                      <Typography
                        variant="body2"
                        sx={{ whiteSpace: 'nowrap', fontWeight: row.label ? 600 : 400 }}
                      >
                        {row.label}
                      </Typography>
                      <Typography
                        variant="body2"
                        color={row.muted ? 'text.secondary' : 'text.primary'}
                        component="span"
                        sx={{ textDecoration: row.muted ? 'line-through' : undefined }}
                      >
                        {row.key === dateGridRows[0]?.key ||
                        row.key === nationalityGridRows[0]?.key ||
                        row.key === originGridRows[0]?.key ? (
                          <Box
                            component="button"
                            type="button"
                            onClick={() =>
                              row.key === dateGridRows[0]?.key
                                ? setDateEditing(true)
                                : setValuesEditing(true)
                            }
                            aria-label={
                              row.key === dateGridRows[0]?.key
                                ? t('LWC.desktop.sidebar.database.edit_dates')
                                : t('LWC.desktop.sidebar.database.edit_values')
                            }
                            sx={{
                              border: 0,
                              p: 0,
                              background: 'transparent',
                              color: 'inherit',
                              font: 'inherit',
                              textAlign: 'left',
                              cursor: 'text',
                            }}
                          >
                            {row.value}
                          </Box>
                        ) : (
                          row.value
                        )}
                      </Typography>
                      <Box sx={{ display: 'flex', justifyContent: 'flex-end', minWidth: 0 }}>
                        {row.trailing}
                      </Box>
                    </Fragment>
                  ))}
                </Box>
              )}
            </Stack>
          )}
          {editEntity && (
            <EntityNamesAccordion
              expanded={namesExpanded}
              onExpandedChange={setNamesExpanded}
              rows={nameRows}
              allowedNameTypes={
                editEntity.kind === 'person'
                  ? entityKindSupportsVernacularGloss(editEntity.kind)
                    ? ALL_NAME_TYPES
                    : ALL_NAME_TYPES.filter((type) => type !== 'translation')
                  : editEntity.kind === 'work'
                    ? WORK_TITLE_TYPES
                    : NON_PERSON_NAME_TYPES
              }
              projectLang={projectLang}
              validatedSourceLabel={databaseView === 'central' ? 'CEDB' : 'PEDB'}
              nameTypes={editNameTypes}
              nameLanguages={editNameLanguages}
              onNameTypeChange={commitNameType}
              onNameLanguageChange={commitNameLanguage}
              onValidate={queueValidation}
              onReject={(keys) =>
                rejectAssertionKeys(
                  editEntity.id,
                  keys,
                  t('LWC.desktop.sidebar.database.rejecting_data'),
                )
              }
              onDelete={commitDeleteName}
              newName={editNewName}
              onNewNameChange={setEditNewName}
              newNameType={editNewNameType}
              onNewNameTypeChange={setEditNewNameType}
              newNameLanguage={editNewNameLanguage}
              onNewNameLanguageChange={setEditNewNameLanguage}
              onAdd={commitNewName}
              missingTranslations={missingTranslationNudges}
              onRequestAddTranslation={
                entityKindSupportsVernacularGloss(editEntity.kind)
                  ? requestAddTranslation
                  : undefined
              }
              focusAddFieldToken={focusAddNameToken}
              onSuggestTranslation={
                entityKindSupportsVernacularGloss(editEntity.kind) &&
                isAiUiFeatureEnabled('entityGlossSuggest') &&
                window.electronAPI?.suggestEntityGloss
                  ? suggestNewTranslationGloss
                  : undefined
              }
              suggestBusy={suggestGlossBusy}
              suggestError={suggestGlossError}
              title={
                editEntity.kind === 'work'
                  ? t('LWC.desktop.sidebar.database.titles_heading')
                  : t('LWC.desktop.sidebar.database.names_heading')
              }
              hint={
                editEntity.kind === 'work'
                  ? t('LWC.desktop.sidebar.database.titles_hint')
                  : t('LWC.desktop.sidebar.database.names_hint')
              }
              addPlaceholder={
                editEntity.kind === 'work'
                  ? t('LWC.desktop.sidebar.database.add_title_placeholder')
                  : t('LWC.desktop.sidebar.database.add_name_placeholder')
              }
            />
          )}
          {editEntity && editEntity.kind === 'person' && (
            <Accordion
              disableGutters
              elevation={0}
              expanded={titlesExpanded}
              onChange={(_event, expanded) => setTitlesExpanded(expanded)}
              sx={{
                mt: 2,
                border: 1,
                borderColor: 'divider',
                borderRadius: 1,
                '&:before': { display: 'none' },
              }}
            >
              <AccordionSummary
                expandIcon={<ExpandMoreIcon fontSize="small" />}
                sx={{ minHeight: 0, '& .MuiAccordionSummary-content': { my: 1 } }}
              >
                <Typography variant="subtitle2">
                  {t('LWC.desktop.sidebar.database.noble_titles_heading')}
                </Typography>
              </AccordionSummary>
              <AccordionDetails>
                <Stack spacing={1}>
                  <Typography variant="caption" color="text.secondary">
                    {t('LWC.desktop.sidebar.database.noble_titles_hint')}
                  </Typography>
                  {editEntity.nobleTitles.map((title) => {
                    const input = {
                      dynasty: title.dynasty,
                      fief: title.fief,
                      posthumousName: title.posthumousName,
                      title: title.title,
                    };
                    return (
                      <Stack key={title.key} spacing={0.5}>
                        <Stack direction="row" spacing={0.5} alignItems="center">
                          {(['dynasty', 'fief', 'posthumousName', 'title'] as const).map(
                            (field) => (
                              <TextField
                                key={field}
                                size="small"
                                label={t(
                                  `LWC.desktop.sidebar.database.noble_title_fields.${field}`,
                                )}
                                defaultValue={input[field]}
                                onBlur={(event) =>
                                  commitEditNobleTitle(title.key, {
                                    ...input,
                                    [field]: event.target.value,
                                  })
                                }
                                sx={{ flex: 1, minWidth: 0 }}
                              />
                            ),
                          )}
                          {title.source && <SourceBadges label={title.source.split(':')[0]} />}
                          {title.origin === 'authority' && (
                            <IconButton
                              size="small"
                              sx={neutralActionButtonSx}
                              onClick={() => queueValidation([title.key])}
                            >
                              <CheckIcon fontSize="small" />
                            </IconButton>
                          )}
                          <IconButton
                            size="small"
                            sx={neutralActionButtonSx}
                            onClick={() =>
                              removeAssertionKeys(
                                editEntity.id,
                                [title.key],
                                'Removing noble title…',
                              )
                            }
                          >
                            <ClearIcon fontSize="small" />
                          </IconButton>
                        </Stack>
                      </Stack>
                    );
                  })}
                  <Stack direction="row" spacing={0.5} alignItems="center">
                    {(['dynasty', 'fief', 'posthumousName', 'title'] as const).map((field) => (
                      <TextField
                        key={field}
                        size="small"
                        label={t(`LWC.desktop.sidebar.database.noble_title_fields.${field}`)}
                        value={newTitle[field]}
                        onChange={(event) =>
                          setNewTitle((previous) => ({ ...previous, [field]: event.target.value }))
                        }
                        sx={{ flex: 1, minWidth: 0 }}
                      />
                    ))}
                    <Button
                      variant="outlined"
                      size="small"
                      disabled={!Object.values(newTitle).some((value) => value.trim())}
                      onClick={commitNewNobleTitle}
                    >
                      {t('LWC.desktop.sidebar.database.add_name')}
                    </Button>
                  </Stack>
                </Stack>
              </AccordionDetails>
            </Accordion>
          )}
          {editEntity && editEntity.kind === 'person' && (
            <Accordion
              disableGutters
              elevation={0}
              expanded={rolesExpanded}
              onChange={(_event, expanded) => setRolesExpanded(expanded)}
              sx={{
                mt: 2,
                border: 1,
                borderColor: 'divider',
                borderRadius: 1,
                '&:before': { display: 'none' },
              }}
            >
              <AccordionSummary
                expandIcon={<ExpandMoreIcon fontSize="small" />}
                sx={{ minHeight: 0, '& .MuiAccordionSummary-content': { my: 1 } }}
              >
                <Typography variant="subtitle2">
                  {t('LWC.desktop.sidebar.database.roles_heading')}
                </Typography>
              </AccordionSummary>
              <AccordionDetails>
                <Stack spacing={0.75}>
                  <Typography variant="caption" color="text.secondary">
                    {t('LWC.desktop.sidebar.database.roles_hint')}
                  </Typography>
                  {roleRows.length === 0 && (
                    <Typography variant="body2" color="text.secondary">
                      {t('LWC.desktop.sidebar.database.no_roles')}
                    </Typography>
                  )}
                  {roleRows.map((row) => (
                    <Stack key={row.key} direction="row" spacing={1} alignItems="center">
                      <Typography
                        variant="body2"
                        sx={{
                          flex: 1,
                          color: row.status === 'rejected' ? 'text.secondary' : undefined,
                          textDecoration: row.status === 'rejected' ? 'line-through' : undefined,
                        }}
                      >
                        {row.text}
                      </Typography>
                      {row.sources.length > 0 && <SourceBadges label={row.sources.join('+')} />}
                      {row.keys.length > 0 && row.status === 'active' && (
                        <>
                          <Tooltip title={t('LWC.desktop.sidebar.database.validate_data')}>
                            <IconButton
                              size="small"
                              sx={neutralActionButtonSx}
                              onClick={() => queueValidation(row.keys)}
                            >
                              <CheckIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title={t('LWC.desktop.sidebar.database.reject_data')}>
                            <IconButton
                              size="small"
                              sx={neutralActionButtonSx}
                              onClick={() =>
                                rejectAssertionKeys(
                                  editEntity.id,
                                  row.keys,
                                  t('LWC.desktop.sidebar.database.rejecting_data'),
                                )
                              }
                            >
                              <ClearIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        </>
                      )}
                      {row.keys.length > 0 && row.status === 'rejected' && (
                        <Tooltip title={t('LWC.desktop.sidebar.database.restore_data')}>
                          <IconButton
                            size="small"
                            sx={neutralActionButtonSx}
                            onClick={() =>
                              restoreAssertionKeys(
                                editEntity.id,
                                row.keys,
                                t('LWC.desktop.sidebar.database.restoring_data'),
                              )
                            }
                          >
                            <UndoIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      )}
                    </Stack>
                  ))}
                </Stack>
              </AccordionDetails>
            </Accordion>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditEntity(null)} disabled={backfillBusy}>
            {t('LWC.desktop.sidebar.database.dialogs.cancel')}
          </Button>
          <Button variant="contained" onClick={saveEdit} disabled={backfillBusy}>
            {t('LWC.desktop.sidebar.database.save')}
          </Button>
        </DialogActions>
      </Dialog>

      <PlaceComparisonMap
        open={geoMapPin != null}
        pins={geoMapPin ? [geoMapPin] : []}
        title={geoMapPin?.description ?? ''}
        onClose={() => setGeoMapPin(null)}
      />

      {/* Post-remap summary */}
      <Dialog open={!!lastSummary} onClose={() => setLastSummary(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('LWC.desktop.sidebar.database.dialogs.keys_updated')}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {lastSummary
              ? `${lastSummary.keysUpdated} tag${lastSummary.keysUpdated === 1 ? '' : 's'} updated in ` +
                `${lastSummary.filesChanged} file${lastSummary.filesChanged === 1 ? '' : 's'} across ` +
                `${lastSummary.projectRoots.length} project${lastSummary.projectRoots.length === 1 ? '' : 's'}.`
              : ''}
          </DialogContentText>
          {lastSummary && lastSummary.errors.length > 0 && (
            <Alert severity="error" sx={{ mt: 1 }}>
              {lastSummary.errors.slice(0, 5).map((message) => (
                <Typography key={message} variant="caption" component="div">
                  {message}
                </Typography>
              ))}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setLastSummary(null)}>
            {t('LWC.desktop.sidebar.database.dialogs.close')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Busy overlay: direct user-initiated mutations (edit/merge/backfill) only —
          the background project<->central catch-up sync uses the non-blocking
          bottom-bar BulkSyncIndicator instead, since it can run on every view
          switch and shouldn't block the whole panel. */}
      <Dialog open={!!busyMessage}>
        <DialogContent>
          <Stack direction="row" spacing={2} alignItems="center">
            <CircularProgress size={20} />
            <Box sx={{ minWidth: 360 }}>
              <Typography variant="body2">{busyMessage}</Typography>
            </Box>
          </Stack>
        </DialogContent>
      </Dialog>

      <BridgeInboxDialog
        open={bridgeOpen}
        onClose={() => setBridgeOpen(false)}
        onChanged={() => void reload()}
      />

      <Dialog open={proposalsOpen} onClose={() => setProposalsOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>Bulk-import proposals</DialogTitle>
        <DialogContent dividers>
          <DialogContentText sx={{ mb: 2 }}>
            These source entities were not added automatically. Review them in the project and
            central databases, then merge or add them manually. Ambiguous authority matches are
            listed with their possible central IDs.
          </DialogContentText>
          <Stack spacing={1}>
            {bulkProposals.map((proposal) => (
              <Box
                key={`${proposal.kind}:${proposal.sourceId}`}
                sx={{ borderBottom: 1, borderColor: 'divider', pb: 1 }}
              >
                <Typography variant="body2">
                  <strong>{proposal.name ?? proposal.sourceId}</strong> ({proposal.kind}) —{' '}
                  {proposal.reason}
                </Typography>
                {proposal.authorities.length > 0 && (
                  <Typography variant="caption" color="text.secondary" component="div">
                    Authorities:{' '}
                    {proposal.authorities
                      .map((authority) => `${authority.type}:${authority.value}`)
                      .join(', ')}
                  </Typography>
                )}
                {proposal.candidateCentralIds.length > 0 && (
                  <Typography variant="caption" color="warning.main" component="div">
                    Candidates: {proposal.candidateCentralIds.join(', ')}
                  </Typography>
                )}
              </Box>
            ))}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Tooltip
            title={
              unmatchedProposals.length === 0
                ? 'No unambiguous proposals to accept'
                : `Add ${unmatchedProposals.length} unmatched ${unmatchedProposals.length === 1 ? 'entity' : 'entities'} to the central database (ambiguous matches are left for manual review)`
            }
          >
            <span>
              <Button
                onClick={() => void acceptAllUnmatchedProposals()}
                disabled={unmatchedProposals.length === 0 || acceptingProposals}
                startIcon={acceptingProposals ? <CircularProgress size={14} /> : undefined}
              >
                Accept all ({unmatchedProposals.length})
              </Button>
            </span>
          </Tooltip>
          <Button onClick={() => setProposalsOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>

      <MergeDocketDialog
        open={docketOpen}
        onClose={() => setDocketOpen(false)}
        centralStore={centralStore}
        onChanged={() => void reload()}
      />
    </Box>
  );
};
