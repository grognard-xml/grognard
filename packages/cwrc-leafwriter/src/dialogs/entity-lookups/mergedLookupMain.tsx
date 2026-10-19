/**
 * Disambiguation-style merged candidate list for the entity lookup dialog.
 * Replaces the legacy per-authority side-menu columns with one collapsed list
 * (Wikidata/CBDB/DILA/VIAF concordance union), gated by attach vs tag mode.
 */
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import {
  Box,
  Checkbox,
  CircularProgress,
  DialogContent,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  Stack,
  Typography,
} from '@mui/material';
import { useAtom, useAtomValue } from 'jotai';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AuthorityCache } from '../../autoTagging/authorityCache';
import {
  buildDisambiguationCandidates,
  candidateLinks,
  candidatePrimaryLabel,
  candidateRomanizationSubtitle,
  loadSqliteDisambiguationCandidates,
  type DisambiguationCandidate,
} from '../../autoTagging/disambiguationCandidates';
import {
  centralEntityStoreFromDesktop,
  desktopEntityFileApi,
  entityStoreFromDesktop,
} from '../../autoTagging/entityStore';
import { SQLITE_REQUIRED_LOOKUP_MESSAGE } from '../../autoTagging/sqliteRequired';
import { SourceBadges } from '../../autoTagging/SourceBadges';
import { readOrMintUserStableId } from '../../autoTagging/userStableId';
import { cachedPackReader } from '../../services/authority-pack-lookup';
import { centralEntityUri } from '../../services/central-entity-database-lookup';
import { internalEntityUri } from '../../services/entity-database-lookup';
import type { EntryLink, NamedEntityType } from '../../types';
import { openExternalUrl } from '../../utilities/DOM';
import { ManualEntryField } from './main/manual-entry-field';
import { projectSyncsToCentral } from './lookupMode';
import {
  attachToEntityIdAtom,
  checkedEntriesAtom,
  lookupTypeAtom,
  queryAtom,
  selectedAtom,
} from './store';
import { useEntityLookup } from './useEntityLookup';

const LOOKUP_TYPE_TO_TAG: Partial<Record<NamedEntityType, string>> = {
  person: 'persName',
  place: 'placeName',
  organization: 'orgName',
  work: 'title',
  citation: 'title',
  office: 'roleName',
  thing: 'rs',
};

const yearsLabel = (candidate: DisambiguationCandidate): string | null => {
  if (candidate.startYear == null && candidate.endYear == null) return null;
  const start = candidate.startYear != null ? String(candidate.startYear) : '?';
  const end = candidate.endYear != null ? String(candidate.endYear) : '?';
  return `${start}–${end}`;
};

/** Map internal pipeline source ids to badge-friendly labels. */
const displaySources = (sources: readonly string[]): string => {
  const seen = new Set<string>();
  return sources
    .map((source) => {
      const lower = source.toLowerCase();
      if (lower === 'entity-file' || lower === 'pedb') return 'pedb';
      if (lower === 'central-database' || lower === 'cedb') return 'cedb';
      return source;
    })
    .filter((source) => {
      const key = source.toLowerCase();
      if (!source || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join('+');
};

const primaryUriForCandidate = (candidate: DisambiguationCandidate): string => {
  // Own-DB rows must keep internal/central URIs so tag mode can adopt/link by key.
  if (candidate.localEntityId) return internalEntityUri(candidate.localEntityId);
  if (candidate.centralEntityId) return centralEntityUri(candidate.centralEntityId);
  if (candidate.uri) return candidate.uri;
  const links = candidateLinks(candidate);
  if (links[0]) return links[0].url;
  const auth = candidate.authorityIds?.[0];
  if (auth) {
    const type = auth.type.toLowerCase();
    if (type === 'wikidata') return `https://www.wikidata.org/wiki/${auth.value}`;
    if (type === 'viaf') return `https://viaf.org/viaf/${auth.value}`;
    if (type === 'cbdb') return `https://cbdb.fas.harvard.edu/cbdbapi/person.php?id=${auth.value}`;
    if (type === 'bdrc')
      return `https://library.bdrc.io/show/bdr:${auth.value.replace(/^bdr:/i, '')}`;
  }
  return `urn:grognard:lookup:${candidate.id}`;
};

const entryFromCandidate = (
  candidate: DisambiguationCandidate,
  entityType: NamedEntityType,
): EntryLink => {
  const uri = primaryUriForCandidate(candidate);
  const authority = candidate.sources[0] ?? 'custom';
  const internal = candidate.localEntityId
    ? {
        id: candidate.localEntityId,
        idnos: (candidate.authorityIds ?? []).map((ref) => ({
          type: ref.type,
          value: ref.value,
        })),
      }
    : candidate.centralEntityId
      ? {
          id: candidate.centralEntityId,
          idnos: (candidate.authorityIds ?? []).map((ref) => ({
            type: ref.type,
            value: ref.value,
          })),
        }
      : undefined;
  return {
    authority,
    entityType,
    label: candidatePrimaryLabel(candidate),
    uri,
    description: candidate.description,
    internal,
  };
};

const stopRowClick = (event: { stopPropagation: () => void }) => event.stopPropagation();

export const MergedLookupMain = () => {
  const query = useAtomValue(queryAtom);
  const lookupType = useAtomValue(lookupTypeAtom);
  const attachToEntityId = useAtomValue(attachToEntityIdAtom);
  const [selected, setSelected] = useAtom(selectedAtom);
  const [checkedEntries, setCheckedEntries] = useAtom(checkedEntriesAtom);
  const { confirmSelected } = useEntityLookup();

  const [candidates, setCandidates] = useState<DisambiguationCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [liveLoading, setLiveLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);
  const cacheRef = useRef<AuthorityCache | null>(null);

  const tag = LOOKUP_TYPE_TO_TAG[lookupType];

  const cache = useMemo(() => {
    if (cacheRef.current) return cacheRef.current;
    const store = entityStoreFromDesktop();
    const api = desktopEntityFileApi();
    if (store && api) {
      cacheRef.current = new AuthorityCache(api, store.authorityCacheDir);
    } else {
      cacheRef.current = new AuthorityCache(
        {
          readFile: async () => {
            throw new Error('unavailable');
          },
          writeFile: async () => undefined,
          pathExists: async () => false,
          ensureDirectory: async () => undefined,
        },
        '/tmp/grognard-lookup-cache',
      );
    }
    return cacheRef.current;
  }, []);

  useEffect(() => {
    const surface = query.trim();
    if (!surface || !tag) {
      setCandidates([]);
      setError(null);
      setLoading(false);
      return;
    }

    const requestId = ++requestIdRef.current;
    setLoading(true);
    setLiveLoading(false);
    setError(null);

    void (async () => {
      try {
        const syncToCentral = projectSyncsToCentral();
        const attachMode = Boolean(attachToEntityId);
        const pedbStore = entityStoreFromDesktop();
        let localCandidates: DisambiguationCandidate[] = [];
        let central: { userStableId: string; candidates: DisambiguationCandidate[] } | undefined;
        let ownDatabaseByAuthority:
          { store: NonNullable<typeof pedbStore>; origin: 'pedb' | 'cedb' } | undefined;

        if (!attachMode && pedbStore) {
          if (syncToCentral) {
            const api = desktopEntityFileApi();
            const centralStore = centralEntityStoreFromDesktop(null);
            if (api && centralStore) {
              const { id: userStableId } = await readOrMintUserStableId(api, null);
              const candidates = await loadSqliteDisambiguationCandidates(
                centralStore,
                tag,
                surface,
                'cedb',
              );
              if (candidates == null) throw new Error(SQLITE_REQUIRED_LOOKUP_MESSAGE);
              central = {
                userStableId,
                candidates,
              };
              ownDatabaseByAuthority = { store: centralStore, origin: 'cedb' };
            }
          } else {
            const sqliteLocal = await loadSqliteDisambiguationCandidates(
              pedbStore,
              tag,
              surface,
              'pedb',
            );
            if (sqliteLocal == null) throw new Error(SQLITE_REQUIRED_LOOKUP_MESSAGE);
            localCandidates = sqliteLocal;
            ownDatabaseByAuthority = { store: pedbStore, origin: 'pedb' };
          }
        }

        const projectLang =
          (await window.__leafWriterProject?.getProjectSourceLanguage?.()) ?? null;

        // Pack hits first; skip per-QID lifespan enrichment. Dual-script names
        // are filled so Tibetan (and other non-Latin) projects mint uchen, not Latin.
        const rows = await buildDisambiguationCandidates(
          null,
          tag,
          surface,
          cache,
          ['Wikidata', 'VIAF'],
          false,
          cachedPackReader(),
          undefined,
          undefined,
          undefined,
          projectLang,
          central,
          undefined,
          localCandidates,
          {
            enrichLifespans: false,
            enrichNames: true,
            ownDatabaseByAuthority,
            onPartialResults: (partial) => {
              if (requestId !== requestIdRef.current) return;
              setCandidates(partial);
              setLoading(false);
              setLiveLoading(true);
            },
          },
        );
        if (requestId !== requestIdRef.current) return;
        setCandidates(rows);
      } catch (err) {
        if (requestId !== requestIdRef.current) return;
        setCandidates([]);
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (requestId === requestIdRef.current) {
          setLoading(false);
          setLiveLoading(false);
        }
      }
    })();
  }, [attachToEntityId, cache, lookupType, query, tag]);

  const toggleChecked = (entry: EntryLink, next: boolean) => {
    setCheckedEntries((prev) => {
      const map = new Map(prev);
      if (next) map.set(entry.uri, entry);
      else map.delete(entry.uri);
      return map;
    });
  };

  return (
    <DialogContent
      sx={{
        px: 1,
        pt: 0,
        pb: 1,
        display: 'flex',
        flexDirection: 'column',
        gap: 0.5,
        // Compact: scroll the list, not a tall empty sheet.
        maxHeight: 'min(40vh, 320px)',
      }}
    >
      <Box sx={{ overflow: 'auto', flex: '1 1 auto', minHeight: 72 }}>
        {loading && (
          <Stack alignItems="center" py={1.5}>
            <CircularProgress size={22} />
          </Stack>
        )}
        {error && (
          <Typography color="error" variant="body2" sx={{ px: 1, py: 0.5 }}>
            {error}
          </Typography>
        )}
        {!loading && !error && query.trim() && candidates.length === 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ px: 1, py: 0.5 }}>
            No matching authorities for “{query.trim()}”.
          </Typography>
        )}
        <List dense disablePadding>
          {candidates.map((candidate) => {
            const entry = entryFromCandidate(candidate, lookupType);
            const { uri } = entry;
            const selectedRow = selected?.uri === uri;
            const checked = checkedEntries.has(uri);
            const links = candidateLinks(candidate);
            const years = yearsLabel(candidate);
            const sources = displaySources([
              ...candidate.sources,
              ...(candidate.authorityIds ?? []).map((auth) => auth.type),
            ]);
            return (
              <ListItem
                key={`${candidate.id}:${uri}`}
                dense
                disablePadding
                onClick={() => setSelected(entry)}
                onDoubleClick={() => {
                  setSelected(entry);
                  if (!checkedEntries.has(uri)) {
                    setCheckedEntries(new Map([[uri, entry]]));
                  }
                  void confirmSelected();
                }}
                secondaryAction={
                  links[0] ? (
                    <IconButton
                      edge="end"
                      size="small"
                      aria-label={links[0].title}
                      onClick={(event) => {
                        stopRowClick(event);
                        openExternalUrl(links[0]!.url);
                      }}
                    >
                      <OpenInNewIcon fontSize="inherit" />
                    </IconButton>
                  ) : undefined
                }
                sx={{ my: 0.25 }}
              >
                <Checkbox
                  aria-label={`Also link ${candidate.label}`}
                  checked={checked}
                  onChange={(event) => toggleChecked(entry, event.target.checked)}
                  onClick={stopRowClick}
                  onMouseDown={stopRowClick}
                  size="small"
                  sx={{ p: 0.5, ml: 0.25 }}
                />
                <ListItemButton
                  selected={selectedRow}
                  sx={[
                    { borderRadius: 1, py: 0.25 },
                    checked && { borderLeft: '3px solid', borderLeftColor: 'primary.main' },
                  ]}
                >
                  <ListItemText
                    primary={
                      <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap">
                        <Typography variant="body2" component="span">
                          {candidatePrimaryLabel(candidate)}
                        </Typography>
                        {years && (
                          <Typography variant="caption" color="text.secondary" component="span">
                            {years}
                          </Typography>
                        )}
                        {sources ? <SourceBadges label={sources} /> : null}
                      </Stack>
                    }
                    secondary={
                      candidate.description?.trim() || candidateRomanizationSubtitle(candidate)
                    }
                    secondaryTypographyProps={{ noWrap: true, variant: 'caption' }}
                  />
                </ListItemButton>
              </ListItem>
            );
          })}
        </List>
        {liveLoading && (
          <Stack direction="row" alignItems="center" spacing={1} px={1} py={0.5}>
            <CircularProgress size={14} />
            <Typography variant="caption" color="text.secondary">
              Checking Wikidata / VIAF…
            </Typography>
          </Stack>
        )}
      </Box>
      <Box
        sx={{
          flex: '0 0 auto',
          borderTopWidth: 1,
          borderTopStyle: 'solid',
          borderTopColor: 'divider',
          pt: 0.5,
        }}
      >
        <ManualEntryField setAuthorityInView={() => undefined} />
      </Box>
    </DialogContent>
  );
};
