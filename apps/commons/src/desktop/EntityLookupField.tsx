import AddIcon from '@mui/icons-material/Add';
import SearchIcon from '@mui/icons-material/Search';
import {
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AuthorityCache } from '../../../../packages/cwrc-leafwriter/src/autoTagging/authorityCache';
import {
  buildDisambiguationCandidates,
  collectGivenFamilyNamesForCandidate,
  collectTypedNamesForCandidate,
  extractWikidataId,
  loadSqliteDisambiguationCandidates,
  mergeSelectedCandidates,
  resolveCandidateForPedb,
  toAuthoritySourcedFields,
  type DisambiguationCandidate,
} from '../../../../packages/cwrc-leafwriter/src/autoTagging/disambiguationCandidates';
import { autoSyncEntityToCentral } from '../../../../packages/cwrc-leafwriter/src/autoTagging/autoSync';
import {
  mintEntitySqlite,
  mintOrLinkEntitySqlite,
} from '../../../../packages/cwrc-leafwriter/src/autoTagging/sqliteLookupMint';
import { backfillEntitiesSqlite } from '../../../../packages/cwrc-leafwriter/src/autoTagging/sqliteAuthorityBackfill';
import { SQLITE_REQUIRED_LOOKUP_MESSAGE } from '../../../../packages/cwrc-leafwriter/src/autoTagging/sqliteRequired';
import {
  createEntitiesScaffold,
  parseEntities,
  type EntityKind,
} from '../../../../packages/cwrc-leafwriter/src/autoTagging/entities';
import {
  suggestPersonNameSplit,
  suggestPersonRomanization,
} from '../../../../packages/cwrc-leafwriter/src/plugins/personNameDefaults';
import {
  centralEntityStoreFromDesktop,
  desktopEntityFileApi,
  entityStoreFromDesktop,
  type DesktopEntityStoreGlobals,
  type EntityStore,
} from '../../../../packages/cwrc-leafwriter/src/autoTagging/entityStore';
import { readOrMintUserStableId } from '../../../../packages/cwrc-leafwriter/src/autoTagging/userStableId';
import {
  autoRomanizeForKind,
  canAutoRomanize,
} from '../../../../packages/cwrc-leafwriter/src/utilities/romanize';
import { persistOfficeTranslationNames } from '../../../../packages/cwrc-leafwriter/src/autoTagging/officeGlossLookup';

/** An entity-backed value: a name plus either an authority ref (URI) or a local-only key (entities.xml id). */
export interface EntityLookupValue {
  name: string;
  /** Authority URI (Wikidata/VIAF/…), when linked to an external authority record. */
  ref?: string;
  /** Local-only entities.xml id (bare, e.g. "person-000100"), when minted without an authority match. */
  key?: string;
}

interface LookupSession {
  store: EntityStore | null;
  entitiesDoc: Document;
  cache: AuthorityCache;
  projectLang: string | null;
  /** Present only for a syncToCentral project - lets lookup also search/adopt from the CEDB. */
  central: { store: EntityStore; doc: Document; userStableId: string } | null;
}

const projectSourceLanguage = async (): Promise<string | null> => {
  try {
    const globals = window as unknown as {
      __leafWriterProject?: { getProjectSourceLanguage?: () => Promise<string | null> };
    };
    return (await globals.__leafWriterProject?.getProjectSourceLanguage?.()) ?? null;
  } catch {
    return null;
  }
};

/** Resolve the central database + this user's stable id, when this project has syncToCentral on. */
const resolveCentralLookupContext = async (): Promise<LookupSession['central']> => {
  try {
    const project = (window as unknown as DesktopEntityStoreGlobals).__ljbLspProject;
    if (!project?.syncToCentral) return null;
    const api = desktopEntityFileApi();
    if (!api) return null;
    const centralFolder = project.entityDbFolder ?? null;
    const centralStore = centralEntityStoreFromDesktop(centralFolder);
    if (!centralStore) return null;
    if (!(await centralStore.hasSqliteDatabase())) return null;
    const { id: userStableId } = await readOrMintUserStableId(api, centralFolder);
    return {
      store: centralStore,
      doc: parseEntities(createEntitiesScaffold()),
      userStableId,
    };
  } catch {
    return null;
  }
};

const createLookupSession = async (): Promise<LookupSession> => {
  const store = entityStoreFromDesktop();
  const projectLang = await projectSourceLanguage();
  const emptyDoc = parseEntities(createEntitiesScaffold());
  if (!store) {
    return {
      store: null,
      entitiesDoc: emptyDoc,
      cache: new AuthorityCache(null, null),
      projectLang,
      central: null,
    };
  }
  const api = window.electronAPI;
  const cacheApi = api
    ? {
        readFile: api.readFile,
        writeFile: api.writeFile,
        pathExists: api.pathExists,
        ensureDirectory: api.ensureDirectory,
      }
    : null;
  return {
    store,
    // Search/mint use SQLite; keep an empty scaffold only for the session shape.
    entitiesDoc: emptyDoc,
    cache: new AuthorityCache(cacheApi, cacheApi ? store.authorityCacheDir : null),
    projectLang,
    central: await resolveCentralLookupContext(),
  };
};

interface EntityLookupFieldProps {
  /** entities.xml kind this field mints/links against. */
  kind: EntityKind;
  /** Tag passed to buildDisambiguationCandidates (drives which authority packs/entity-file lists are searched). */
  tag: string;
  label: string;
  /** "single" caps at one linked value and replaces on accept (e.g. work title); "multi" is a growing pill list (e.g. authors). */
  mode: 'single' | 'multi';
  values: EntityLookupValue[];
  disabled?: boolean;
  onChange: (values: EntityLookupValue[]) => void;
  /** Called after a selected/created entity has been persisted to entities.xml. */
  onPersistedChange?: (value: EntityLookupValue) => void;
  /**
   * kind: 'work' only — after linking to a Wikidata work, fetches P577/P50 and
   * offers the publication year + author entities for the caller to backfill
   * (e.g. into otherwise-empty work-date/author fields).
   */
  onWorkDetails?: (details: { workYear?: number; authors: EntityLookupValue[] }) => void;
}

/**
 * Entity-lookup field: search installed authorities + the local entity file,
 * multi-select candidates to merge cross-authority links onto one entity, or
 * mint a new local-only entity (canonical name + one-line description) when
 * nothing matches. Everything minted/linked here is stored in entities.xml.
 */
export const EntityLookupField = ({
  kind,
  tag,
  label,
  mode,
  values,
  disabled,
  onChange,
  onPersistedChange,
  onWorkDetails,
}: EntityLookupFieldProps) => {
  const { t, i18n } = useTranslation();
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [candidates, setCandidates] = useState<DisambiguationCandidate[] | null>(null);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createDescription, setCreateDescription] = useState('');
  const [createRomanized, setCreateRomanized] = useState('');
  const [showRomanized, setShowRomanized] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const sessionRef = useRef<LookupSession | null>(null);

  const getSession = useCallback(async (): Promise<LookupSession> => {
    if (!sessionRef.current) {
      sessionRef.current = await createLookupSession();
    }
    return sessionRef.current;
  }, []);

  const resetLookup = () => {
    setCandidates(null);
    setCheckedIds(new Set());
    setLookupError(null);
    setCreateOpen(false);
    setCreateDescription('');
    setCreateRomanized('');
  };

  /** Open the create-new panel, prefilling an autogenerated romanization for non-Latin projects. */
  const toggleCreateOpen = async () => {
    if (createOpen) {
      setCreateOpen(false);
      return;
    }
    try {
      const session = await getSession();
      setShowRomanized(canAutoRomanize(session.projectLang));
      const romanized =
        kind === 'person'
          ? suggestPersonRomanization(query.trim(), session.projectLang)
          : autoRomanizeForKind(query.trim(), session.projectLang, kind);
      setCreateRomanized(romanized ?? '');
    } catch {
      setShowRomanized(false);
      setCreateRomanized('');
    }
    setCreateOpen(true);
  };

  const handleSearch = async () => {
    const surface = query.trim();
    if (!surface || searching) return;
    setSearching(true);
    setLookupError(null);
    try {
      const session = await getSession();
      if (!session.store) {
        setLookupError(SQLITE_REQUIRED_LOOKUP_MESSAGE);
        setCandidates(null);
        return;
      }

      let localCandidates: DisambiguationCandidate[] = [];
      let central: { userStableId: string; candidates: DisambiguationCandidate[] } | undefined;

      if (session.central) {
        const candidates = await loadSqliteDisambiguationCandidates(
          session.central.store,
          tag,
          surface,
          'cedb',
        );
        if (candidates == null) throw new Error(SQLITE_REQUIRED_LOOKUP_MESSAGE);
        central = {
          userStableId: session.central.userStableId,
          candidates,
        };
      } else {
        const sqliteLocal = await loadSqliteDisambiguationCandidates(
          session.store,
          tag,
          surface,
          'pedb',
        );
        if (sqliteLocal == null) throw new Error(SQLITE_REQUIRED_LOOKUP_MESSAGE);
        localCandidates = sqliteLocal;
      }

      const rows = await buildDisambiguationCandidates(
        null,
        tag,
        surface,
        session.cache,
        ['Wikidata', 'VIAF'],
        false,
        window.electronAPI?.authorityPackRead,
        undefined,
        undefined,
        undefined,
        session.projectLang,
        central,
        undefined,
        localCandidates,
        {
          enrichLifespans: false,
          enrichNames: false,
        },
      );
      setCandidates(rows);
      setCheckedIds(new Set());
    } catch (error) {
      setLookupError(
        error instanceof Error ? error.message : t('LWC.desktop.author_pill.lookup_failed'),
      );
      setCandidates(null);
    } finally {
      setSearching(false);
    }
  };

  const setValue = (item: EntityLookupValue) => {
    if (mode === 'single') {
      onChange([item]);
    } else {
      if (values.some((v) => v.name === item.name && v.ref === item.ref && v.key === item.key))
        return;
      onChange([...values, item]);
    }
    setQuery('');
    resetLookup();
  };

  const toggleChecked = (id: string, checked: boolean) => {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const linkSelected = async () => {
    if (!candidates) return;
    const checked = candidates.filter((c) => checkedIds.has(c.id));
    let merged = mergeSelectedCandidates(checked);
    if (!merged) return;

    setValue({ name: merged.label, ref: merged.uri });

    try {
      const session = await getSession();
      if (!session.store) {
        onPersistedChange?.({ name: merged.label, ref: merged.uri });
        return;
      }
      // A candidate picked from the central database needs a project mirror
      // minted/linked before it can be treated as an ordinary local match.
      if (merged.centralEntityId && session.central) {
        merged = await resolveCandidateForPedb(
          merged,
          session.store,
          session.central.store,
          session.central.userStableId,
        );
      }
      if (!merged) return;
      const selected = merged;

      const typedNames = await collectTypedNamesForCandidate(selected).catch(() => undefined);
      const givenFamilyNames =
        kind === 'person'
          ? await collectGivenFamilyNamesForCandidate(merged, session.projectLang).catch(
              () => undefined,
            )
          : undefined;
      const { id: resolvedId } = await mintOrLinkEntitySqlite(session.store, {
        kind,
        name: merged.projectLangName ?? merged.label,
        familyName: kind === 'person' ? givenFamilyNames?.familyName : undefined,
        givenName: kind === 'person' ? givenFamilyNames?.givenName : undefined,
        nameLang: session.projectLang ?? undefined,
        romanizedName:
          merged.romanizedName ??
          autoRomanizeForKind(merged.projectLangName ?? merged.label, session.projectLang, kind) ??
          undefined,
        authorityIds: merged.authorityIds,
        authoritySource: merged.authorityIds?.[0]
          ? `${merged.authorityIds[0].type}:${merged.authorityIds[0].value}`
          : undefined,
        description: merged.description,
        startYear: merged.startYear,
        endYear: merged.endYear,
        authorityAssertions: toAuthoritySourcedFields(merged.authorityAssertions),
        localEntityId: merged.localEntityId,
      });
      for (const typed of typedNames ?? []) {
        await session.store.sqliteAddName({
          entityId: resolvedId,
          text: typed.text,
          nameType: typed.type,
          language: typed.lang,
          origin: 'authority',
          source: merged.authorityIds?.[0]?.type,
        });
      }
      if (kind === 'office') {
        await persistOfficeTranslationNames(session.store, resolvedId, {
          translation: merged.authorityMetadata?.translation,
          translationFr: merged.authorityMetadata?.translationFr,
          enSource:
            merged.authorityMetadata?.translationSource ??
            merged.authorityIds?.[0]?.type ??
            'Huckbot5000',
          frSource: merged.authorityMetadata?.translationFrSource ?? 'MaxiRicci7000',
          primaryName: merged.projectLangName ?? merged.label,
        });
      }
      await autoSyncEntityToCentral(null, resolvedId);

      if ((kind === 'work' || kind === 'person') && extractWikidataId(merged.uri ?? '')) {
        await backfillEntitiesSqlite(session.store, {
          entityIds: [resolvedId],
          projectLang: session.projectLang,
          desktopLanguage: i18n.language,
          expandWikidataWorks: kind === 'person',
          lookupAuthorityRef: window.electronAPI?.authorityRefLookup,
        }).catch(() => undefined);
        if (kind === 'work') {
          const summary = await session.store.sqliteEntitySummary(resolvedId);
          const workDate = (summary as { workDate?: { startYear?: number | null } } | null)
            ?.workDate;
          const authors = (summary as { authors?: { name: string; ref?: string | null }[] } | null)
            ?.authors;
          if (workDate?.startYear != null || authors?.length) {
            onWorkDetails?.({
              workYear: workDate?.startYear ?? undefined,
              authors: (authors ?? []).map((author) => ({
                name: author.name,
                ref: author.ref ?? undefined,
              })),
            });
          }
        }
      }

      const persisted: EntityLookupValue = {
        name: selected.label,
        ref: selected.uri,
        key: resolvedId,
      };
      if (mode === 'single') {
        onChange([persisted]);
      } else {
        onChange(
          values.map((entry) =>
            entry.name === selected.label && entry.ref === selected.uri ? persisted : entry,
          ),
        );
      }
      onPersistedChange?.(persisted);
    } catch {
      // Entity database write failed — the field is still applied to the header.
    }
  };

  const confirmCreateNew = async () => {
    const name = query.trim();
    if (!name || createBusy) return;
    setCreateBusy(true);
    try {
      const session = await getSession();
      const description = createDescription.trim() || undefined;
      if (!session.store) {
        setValue({ name });
        onPersistedChange?.({ name });
        return;
      }
      const romanizedName = createRomanized.trim() || undefined;
      const split = kind === 'person' ? suggestPersonNameSplit(name, session.projectLang) : null;
      const id = await mintEntitySqlite(session.store, {
        kind,
        name,
        nameLang:
          session.projectLang && romanizedName && name !== romanizedName
            ? session.projectLang
            : undefined,
        romanizedName:
          romanizedName ||
          (kind === 'person'
            ? (suggestPersonRomanization(name, session.projectLang) ?? undefined)
            : (autoRomanizeForKind(name, session.projectLang, kind) ?? undefined)),
        description,
        familyName: kind === 'person' ? split?.familyName : undefined,
        givenName: kind === 'person' ? split?.givenName : undefined,
      });
      await autoSyncEntityToCentral(null, id);
      setValue({ name, key: id });
      onPersistedChange?.({ name, key: id });
    } catch {
      setValue({ name });
    } finally {
      setCreateBusy(false);
    }
  };

  const removeValue = (index: number) => {
    onChange(values.filter((_, i) => i !== index));
  };

  return (
    <Box>
      <Typography color="text.secondary" sx={{ mb: 0.5 }} variant="caption">
        {label}
      </Typography>

      {values.length > 0 && (
        <Stack direction="row" flexWrap="wrap" gap={0.5} sx={{ mb: 1 }}>
          {values.map((item, index) => (
            <Tooltip
              key={`${item.name}-${index}`}
              title={
                item.ref ??
                (item.key
                  ? `${t('LWC.desktop.author_pill.local_entity')}: ${item.key}`
                  : t('LWC.desktop.author_pill.no_authority_link'))
              }
            >
              <Chip
                color={item.ref || item.key ? 'primary' : 'default'}
                disabled={disabled}
                label={item.name}
                onDelete={disabled ? undefined : () => removeValue(index)}
                size="small"
                variant={item.ref || item.key ? 'filled' : 'outlined'}
              />
            </Tooltip>
          ))}
        </Stack>
      )}

      {(mode === 'multi' || values.length === 0) && (
        <>
          <Stack alignItems="center" direction="row" spacing={0.5}>
            <TextField
              disabled={disabled}
              fullWidth
              label={label}
              onChange={(event) => {
                setQuery(event.target.value);
                resetLookup();
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void handleSearch();
                }
              }}
              placeholder={t('LWC.desktop.author_pill.type_name_search')}
              size="small"
              value={query}
            />
            <Tooltip title={t('LWC.desktop.author_pill.search_authorities')}>
              <span>
                <IconButton
                  disabled={disabled || !query.trim() || searching}
                  onClick={() => void handleSearch()}
                  size="small"
                >
                  {searching ? <CircularProgress size={18} /> : <SearchIcon fontSize="small" />}
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title={t('LWC.desktop.author_pill.create_new')}>
              <span>
                <IconButton
                  disabled={disabled || !query.trim()}
                  onClick={() => void toggleCreateOpen()}
                  size="small"
                >
                  <AddIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
          </Stack>

          {lookupError && (
            <Typography color="error" sx={{ mt: 0.5 }} variant="caption">
              {lookupError}
            </Typography>
          )}

          {createOpen && (
            <Paper sx={{ mt: 0.5, p: 1 }} variant="outlined">
              <Stack spacing={1}>
                <Typography color="text.secondary" variant="caption">
                  {t('LWC.desktop.author_pill.create_new_help')}
                </Typography>
                <TextField
                  disabled
                  label={t('LWC.desktop.author_pill.canonical_name')}
                  size="small"
                  value={query}
                />
                {(showRomanized || createRomanized) && (
                  <TextField
                    disabled={createBusy}
                    label={t('LWC.desktop.author_pill.romanized_name')}
                    onChange={(event) => setCreateRomanized(event.target.value)}
                    size="small"
                    value={createRomanized}
                  />
                )}
                <TextField
                  disabled={createBusy}
                  label={t('LWC.desktop.author_pill.one_line_description')}
                  onChange={(event) => setCreateDescription(event.target.value)}
                  size="small"
                  value={createDescription}
                />
                <Stack direction="row" justifyContent="flex-end" spacing={1}>
                  <Button disabled={createBusy} onClick={() => setCreateOpen(false)} size="small">
                    {t('LWC.commons.cancel')}
                  </Button>
                  <Button
                    disabled={createBusy}
                    onClick={() => void confirmCreateNew()}
                    size="small"
                    variant="contained"
                  >
                    {createBusy ? <CircularProgress size={16} /> : t('LWC.desktop.author_pill.add')}
                  </Button>
                </Stack>
              </Stack>
            </Paper>
          )}

          {candidates !== null && (
            <Paper sx={{ maxHeight: 260, mt: 0.5, overflow: 'auto' }} variant="outlined">
              {candidates.length === 0 ? (
                <Typography color="text.secondary" sx={{ p: 1 }} variant="body2">
                  {t('LWC.desktop.author_pill.no_matches')}
                </Typography>
              ) : (
                <>
                  <List dense disablePadding>
                    {candidates.map((candidate) => {
                      const checked = checkedIds.has(candidate.id);
                      return (
                        <ListItemButton
                          key={candidate.id}
                          onClick={() => toggleChecked(candidate.id, !checked)}
                          dense
                        >
                          <ListItemIcon sx={{ minWidth: 32 }}>
                            <Checkbox
                              checked={checked}
                              edge="start"
                              onChange={(event) =>
                                toggleChecked(candidate.id, event.target.checked)
                              }
                              onClick={(event) => event.stopPropagation()}
                              size="small"
                              tabIndex={-1}
                            />
                          </ListItemIcon>
                          <ListItemText
                            primary={candidate.label}
                            secondary={[candidate.description, candidate.sources.join(', ')]
                              .filter(Boolean)
                              .join(' — ')}
                          />
                        </ListItemButton>
                      );
                    })}
                  </List>
                  <Stack direction="row" justifyContent="flex-end" sx={{ p: 0.5 }}>
                    <Button
                      disabled={checkedIds.size === 0}
                      onClick={() => void linkSelected()}
                      size="small"
                      variant="contained"
                    >
                      {checkedIds.size > 1
                        ? t('LWC.desktop.author_pill.link_selected_count', {
                            count: checkedIds.size,
                          })
                        : t('LWC.desktop.author_pill.link_selected')}
                    </Button>
                  </Stack>
                </>
              )}
            </Paper>
          )}
        </>
      )}
    </Box>
  );
};
