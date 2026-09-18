import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  FormLabel,
  InputLabel,
  LinearProgress,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  MenuItem,
  Radio,
  RadioGroup,
  Select,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  uniqueKanripoXmlPath,
  wrapKanripoTeiDocument,
  type KanripoNormalizeMode,
  type KanripoTeiMeta,
} from '../../../../../apps/commons/src/desktop/kanripoImportXml';
import { ensureImportHeaderEntitiesForPaths } from '../../../../../apps/commons/src/desktop/ensureImportHeaderEntities';
import { loadParallelPlainText } from '../../../../../apps/commons/src/desktop/kanripoParallelText';
import {
  daozangParallelIssueMessage,
  loadBundledDaozangParallel,
  type DaozangParallelLoadIssue,
} from '../../../../../apps/commons/src/desktop/kanripoDaozangParallel';
import {
  daozangSources,
  lookupKanripoCrosswalk,
  wikisourceSources,
  type ParallelCrosswalkEntry,
  type ParallelSourceEntry,
} from '../../../../../apps/commons/src/desktop/kanripoCrosswalk';
import {
  appendTeiRevisionChange,
  formatParallelProvenance,
} from '../../../../../apps/commons/src/desktop/kanripoImportXml';
import {
  ctextChapterUrlFromIndex,
  isCtextWikiResUrl,
  isCtextWikiUrl,
  isWikisourceUrl,
  isWikisourceVolumeUrl,
  unsupportedCtextUrlMessage,
} from '../../../../../apps/commons/src/desktop/parallelUrlFetch';
import { CorpusWorkRow } from '../corpusWorkRow';
import type { IDialog } from '../type';
import { isPluginEnabled } from '../../plugins';
import {
  createLlmClientFromSettings,
  isAiSuggestReady,
  aiApiSettingsFromDesktop,
} from '../../autoTagging/llmClientFromSettings';
import { fetchPunctCoverage } from '../../aiPunctuation/pluginBridge';
import {
  runAiFillGapsEditorCommand,
  runAiFillGapsOnFile,
} from '../../aiPunctuation/aiPunctuateEditor';
import { formatAiProvenance } from '../../aiPunctuation/formatAiProvenance';
import { runAiPunctuate } from '../../aiPunctuation/runAiPunctuate';
import { AI_PUNCT_PROMPT_VERSION } from '../../aiPunctuation/prompts';

const PLUGIN_ID = 'kanripo-import';
const DAOZANG_PLUGIN_ID = 'daozang-import';

const extractKanripoIdFromXml = (xml: string): string | null => {
  const match = xml.match(/<idno[^>]*type="Kanripo"[^>]*>([^<]+)<\/idno>/i);
  return match?.[1]?.trim() || null;
};

const CTEXT_IMPORT_MESSAGE =
  'ctext wiki URLs are for in-editor punctuation only (Segment and punctuate on one open juan). For import, use Wikisource, a file, or paste.';

interface KanripoWorkHit {
  id: string;
  title: string;
  section: string;
  dynasty: string;
  authors: string;
  dzid: string;
}

interface ConvertPayload {
  meta: KanripoTeiMeta;
  body_xml: string;
  metadata_xml?: string;
  entities?: Pick<KanripoTeiMeta, 'authorship'>;
}

interface CoverageSpan {
  start: number;
  end: number;
  covered_chars: number;
  source: string;
  preview: string;
}

interface Coverage {
  start: number;
  end: number;
  covered_chars: number;
  total_chars: number;
  ratio: number;
  empty: boolean;
  spans?: CoverageSpan[];
}

interface ParallelSource {
  id: string;
  label: string;
  text: string;
  kind?: 'file' | 'paste' | 'ctext' | 'wikisource' | 'url' | 'daozang' | 'folder-reference';
  url?: string;
  chapters?: { id: string; title: string; text: string }[];
}

interface AlignedParagraphMatch {
  ref_juan_id: string;
  ref_para_idx: number;
  source_file: string | null;
  source_para_idx: number | null;
  source_para_end_idx: number | null;
  score: number;
  match_type: string;
}

interface ParallelPunctPayload {
  body_xml: string;
  coverage: Coverage;
  applied: boolean;
  matched_chapter_ids?: string[];
  quality?: {
    warnings: ParallelQualityWarning[];
  };
}

interface DaozangMatchInfo {
  krId: string;
  title: string;
  dzId: string;
  matchMethod: string;
}

type ParallelAlignMode = 'tape' | 'segmented';

interface ParallelQualityWarning {
  code: string;
  severity: 'info' | 'warning';
  message: string;
}

export interface KanripoImportDialogProps extends IDialog {
  variant?: 'import' | 'punctuate';
  initialKrId?: string;
  initialImportScope?: 'work' | 'juan';
  initialJuan?: string;
  initialUrl?: string;
}

const coverageHasGaps = (coverage: Coverage): boolean => coverage.empty || coverage.ratio < 1;

const joinPath = (...parts: string[]): string =>
  parts.filter(Boolean).join('/').replace(/\/+/g, '/');

const parentDir = (filePath: string): string => {
  const normalized = filePath.replace(/\\/g, '/');
  const index = normalized.lastIndexOf('/');
  return index === -1 ? '' : normalized.slice(0, index);
};

const xmlLooksWellFormed = (xml: string): boolean => {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  return !doc.querySelector('parsererror');
};

const extractJuanDiv = (xml: string): string | null => {
  const juan = xml.match(/<div\b[^>]*type="juan"[^>]*>[\s\S]*?<\/div>/);
  if (juan) return juan[0];
  const body = xml.match(/<body\b[^>]*>([\s\S]*?)<\/body>/);
  return body?.[1]?.trim() || null;
};

const replaceJuanDiv = (xml: string, bodyXml: string): string => {
  if (/<div\b[^>]*type="juan"/.test(xml)) {
    return xml.replace(/<div\b[^>]*type="juan"[^>]*>[\s\S]*?<\/div>/, bodyXml.trim());
  }
  return xml.replace(/<body\b[^>]*>[\s\S]*?<\/body>/, `<body>\n${bodyXml.trim()}\n</body>`);
};

const barSegments = (coverage: Coverage): CoverageSpan[] => {
  if (coverage.spans && coverage.spans.length > 0) return coverage.spans;
  if (coverage.empty) return [];
  return [
    {
      start: coverage.start,
      end: coverage.end,
      covered_chars: coverage.covered_chars,
      source: '',
      preview: '',
    },
  ];
};

const CoverageBar = ({ coverage, label }: { coverage: Coverage; label: string }) => {
  const spans = barSegments(coverage);
  const pct = Math.round(coverage.ratio * 100);
  return (
    <Box sx={{ mt: 1 }}>
      <Typography variant="caption">
        {label}:{' '}
        {coverage.empty
          ? 'unpunctuated'
          : `${coverage.covered_chars} / ${coverage.total_chars} Han punctuated (${pct}%)`}
      </Typography>
      <Box
        sx={{
          position: 'relative',
          height: 12,
          bgcolor: 'grey.300',
          borderRadius: 0.5,
          overflow: 'hidden',
          mt: 0.5,
        }}
      >
        {spans.map((span, index) => {
          const left = Math.max(0, Math.min(100, span.start * 100));
          const width = Math.max(0, Math.min(100 - left, (span.end - span.start) * 100));
          const title = [span.source, span.preview].filter(Boolean).join(': ') || 'overlap';
          return (
            <Tooltip key={`${span.source}-${index}`} title={title}>
              <Box
                sx={{
                  position: 'absolute',
                  left: `${left}%`,
                  width: `${width}%`,
                  top: 0,
                  bottom: 0,
                  bgcolor: 'success.main',
                }}
              />
            </Tooltip>
          );
        })}
      </Box>
    </Box>
  );
};

export const KanripoImportDialog = ({
  onClose,
  open = false,
  variant = 'import',
  initialKrId = '',
  initialImportScope,
  initialJuan = '',
  initialUrl = '',
}: KanripoImportDialogProps) => {
  const punctuateOnly = variant === 'punctuate';
  const [query, setQuery] = useState('');
  const [importScope, setImportScope] = useState<'work' | 'juan'>('work');
  const [juanInput, setJuanInput] = useState('');
  const [hits, setHits] = useState<KanripoWorkHit[]>([]);
  const [selected, setSelected] = useState<KanripoWorkHit | null>(null);
  const [normalize, setNormalize] = useState<KanripoNormalizeMode>('off');
  const [punctMode, setPunctMode] = useState<'as-is' | 'parallel' | 'ai'>(
    punctuateOnly ? 'parallel' : 'as-is',
  );
  const [alignMode, setAlignMode] = useState<ParallelAlignMode>('tape');
  const [sources, setSources] = useState<ParallelSource[]>([]);
  const [pasteDraft, setPasteDraft] = useState('');
  const [pasteCount, setPasteCount] = useState(0);
  const [ctextUrl, setCtextUrl] = useState('');
  const [ctextSection, setCtextSection] = useState('');
  const [ctextContains, setCtextContains] = useState('');
  const [ctextSections, setCtextSections] = useState<
    { id: string; slug: string; title: string; rowCount: number }[]
  >([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<{
    written: string[];
    failed: { stem: string; message: string }[];
    bars?: { stem: string; coverage: Coverage; outputPath: string }[];
    warnings?: { stem: string; items: ParallelQualityWarning[] }[];
  } | null>(null);
  const [editorPreview, setEditorPreview] = useState<{
    xml: string;
    body: string;
    coverage: Coverage;
    warnings?: ParallelQualityWarning[];
  } | null>(null);
  const [stampCoverage, setStampCoverage] = useState<Coverage | null>(null);
  const [parallelApplied, setParallelApplied] = useState(false);
  const [usedChapterIds, setUsedChapterIds] = useState<string[]>([]);
  const [daozangMatch, setDaozangMatch] = useState<DaozangMatchInfo | null>(null);
  const [daozangIssue, setDaozangIssue] = useState<DaozangParallelLoadIssue | null>(null);
  const [daozangIssueDetail, setDaozangIssueDetail] = useState('');
  const [daozangLoading, setDaozangLoading] = useState(false);
  const [daozangPluginEnabled, setDaozangPluginEnabled] = useState(() =>
    isPluginEnabled(DAOZANG_PLUGIN_ID),
  );
  const importAbortRef = useRef<AbortController | null>(null);
  const fillGapsAbortRef = useRef<AbortController | null>(null);
  const [fillingGapsStem, setFillingGapsStem] = useState<string | null>(null);

  const stopImport = useCallback(() => {
    importAbortRef.current?.abort();
    fillGapsAbortRef.current?.abort();
    setStatus('Stopping…');
  }, []);

  useEffect(() => {
    if (!open) {
      importAbortRef.current?.abort();
      importAbortRef.current = null;
    }
  }, [open]);
  const [parallelCrosswalk, setParallelCrosswalk] = useState<ParallelCrosswalkEntry | null>(null);
  const [parallelChoice, setParallelChoice] = useState('');
  const [crosswalkLoading, setCrosswalkLoading] = useState(false);

  const activeKrId = useMemo(() => {
    if (!punctuateOnly) return selected?.id ?? null;
    const xml = window.__leafWriterProject?.getActiveFileXml?.() ?? '';
    return extractKanripoIdFromXml(xml);
  }, [punctuateOnly, selected?.id, open]);

  const projectReady = Boolean(window.__leafWriterProject?.isProjectReady?.());
  const hasSources = sources.some((source) => source.text.trim());
  const aiReady = useMemo(() => isAiSuggestReady(aiApiSettingsFromDesktop()), [open, punctMode]);

  const search = useCallback(async (text: string) => {
    const api = window.electronAPI?.kanripoSearch;
    if (!api) return;
    const next = await api(text);
    setHits(next);
    setSelected((current) => {
      if (current && next.some((hit) => hit.id === current.id)) return current;
      return next[0] ?? null;
    });
  }, []);

  useEffect(() => {
    if (!open || punctuateOnly) return;
    void search('');
  }, [open, punctuateOnly, search]);

  useEffect(() => {
    if (!open || punctuateOnly || !initialKrId.trim()) return;
    setQuery(initialKrId.trim());
    if (initialImportScope) setImportScope(initialImportScope);
    if (initialJuan.trim()) setJuanInput(initialJuan.trim());
  }, [open, punctuateOnly, initialKrId, initialImportScope, initialJuan]);

  useEffect(() => {
    if (!open || punctuateOnly || !initialKrId.trim() || hits.length === 0) return;
    const wanted = initialKrId.trim().toLowerCase();
    const match = hits.find((hit) => hit.id.toLowerCase() === wanted);
    if (match) setSelected(match);
  }, [open, punctuateOnly, initialKrId, hits]);

  useEffect(() => {
    if (!open || punctuateOnly) return;
    const handle = window.setTimeout(() => {
      void search(query);
    }, 200);
    return () => window.clearTimeout(handle);
  }, [open, punctuateOnly, query, search]);

  useEffect(() => {
    if (!open || !punctuateOnly) {
      setStampCoverage(null);
      setParallelApplied(false);
      return;
    }
    const xml = window.__leafWriterProject?.getActiveFileXml?.() ?? '';
    const body = extractJuanDiv(xml);
    if (!body) return;
    let cancelled = false;
    void (async () => {
      try {
        const result = await fetchPunctCoverage(body);
        if (!cancelled) setStampCoverage(result);
      } catch {
        if (!cancelled) setStampCoverage(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, punctuateOnly]);

  useEffect(() => {
    const syncPlugins = () => setDaozangPluginEnabled(isPluginEnabled(DAOZANG_PLUGIN_ID));
    syncPlugins();
    window.addEventListener('grognardPluginRegistryChanged', syncPlugins);
    return () => window.removeEventListener('grognardPluginRegistryChanged', syncPlugins);
  }, [open]);

  const applyDaozangParallelText = useCallback(
    (
      krId: string,
      relPath: string,
      label: string,
      text: string,
      matchMethod: string,
      dzId: string,
    ) => {
      setDaozangIssue(null);
      setDaozangIssueDetail('');
      setDaozangMatch({
        krId,
        title: label,
        dzId,
        matchMethod,
      });
      setAlignMode('tape');
      setSources((current) => [
        ...current.filter((source) => source.kind !== 'daozang'),
        {
          id: `daozang-${krId}-${relPath}`,
          label,
          text,
          kind: 'daozang',
        },
      ]);
      setStatus(`Bundled Daozang parallel: ${label} (${text.trim().length} characters).`);
    },
    [],
  );

  const applyBundledDaozangParallel = useCallback(
    async (krId: string) => {
      setDaozangLoading(true);
      setDaozangIssue(null);
      setDaozangIssueDetail('');
      try {
        const result = await loadBundledDaozangParallel(krId, {
          pluginEnabled: daozangPluginEnabled,
        });
        if (!result.entry || !result.text || !result.label) {
          setDaozangMatch(null);
          setSources((current) => current.filter((source) => source.kind !== 'daozang'));
          setDaozangIssue(result.issue);
          setDaozangIssueDetail(result.detail ?? '');
          return;
        }
        applyDaozangParallelText(
          krId,
          result.entry.daozang_rel_path,
          result.label,
          result.text,
          result.entry.match_method,
          result.entry.dz_id,
        );
      } finally {
        setDaozangLoading(false);
      }
    },
    [applyDaozangParallelText, daozangPluginEnabled],
  );

  useEffect(() => {
    if (!open || (!punctuateOnly && punctMode !== 'parallel')) {
      setParallelCrosswalk(null);
      return;
    }
    if (!activeKrId) {
      setParallelCrosswalk(null);
      return;
    }
    let cancelled = false;
    setCrosswalkLoading(true);
    void (async () => {
      try {
        const crosswalk = await lookupKanripoCrosswalk(activeKrId);
        if (!cancelled) setParallelCrosswalk(crosswalk);
      } catch {
        if (!cancelled) setParallelCrosswalk(null);
      } finally {
        if (!cancelled) setCrosswalkLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, punctMode, punctuateOnly, activeKrId]);

  const invokeParallel = async (
    bodyXml: string,
    chapterIdsUsed?: string[],
    overrideSources?: ParallelSource[],
  ): Promise<ParallelPunctPayload> => {
    const api = window.electronAPI;
    if (!api?.pluginsInvokePython) throw new Error('Python bridge unavailable.');
    const sourceList = overrideSources ?? sources;
    return (await api.pluginsInvokePython(PLUGIN_ID, {
      op: 'parallel_punct',
      mode: alignMode,
      body_xml: bodyXml,
      used_chapter_ids: chapterIdsUsed ?? usedChapterIds,
      sources: sourceList.map((source) => ({
        id: source.id,
        label: source.label,
        text: source.text,
        kind: source.kind ?? '',
        chapters: source.chapters,
      })),
    })) as ParallelPunctPayload;
  };

  /**
   * Applies punctuation match-by-match, each scoped to its own paragraph's
   * known Han position -- used instead of `invokeParallel` for folder-reference
   * aligned sources. `invokeParallel`'s `parallel_punct` op reassembles matches
   * into per-file excerpts and searches for them globally (`apply_parallel_sources`),
   * which is both slow and prone to silently under-punctuating large excerpts
   * with internal gaps (see `apply_paragraph_scoped_sources`'s docstring).
   */
  const invokeParagraphScoped = async (
    bodyXml: string,
    juanId: string,
    matches: AlignedParagraphMatch[],
    sourcesPayload: { id: string; label: string; text: string }[],
  ): Promise<ParallelPunctPayload> => {
    const api = window.electronAPI;
    if (!api?.pluginsInvokePython) throw new Error('Python bridge unavailable.');
    return (await api.pluginsInvokePython(PLUGIN_ID, {
      op: 'apply_paragraph_scoped',
      body_xml: bodyXml,
      juan_id: juanId,
      matches,
      sources: sourcesPayload,
    })) as ParallelPunctPayload;
  };

  const fetchParallelUrl = async (overrideUrl?: string) => {
    const api = window.electronAPI;
    const fetcher = api?.kanripoFetchParallelUrl ?? api?.kanripoFetchCtextParallel;
    if (!fetcher) {
      setError('URL fetch is only available in the desktop app.');
      return;
    }
    const url = (overrideUrl ?? ctextUrl).trim();
    if (!url) {
      setError(
        punctuateOnly
          ? 'Paste a parallel URL first (ctext wiki, Wikisource, or other).'
          : 'Paste a Wikisource URL, or add a file or paste below.',
      );
      return;
    }
    if (!punctuateOnly && isCtextWikiUrl(url)) {
      setError(CTEXT_IMPORT_MESSAGE);
      return;
    }
    const ctextHint = unsupportedCtextUrlMessage(url);
    if (ctextHint) {
      setError(ctextHint);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await fetcher({
        url,
        section: punctuateOnly ? ctextSection.trim() || undefined : undefined,
        contains: punctuateOnly ? ctextContains.trim() || undefined : undefined,
        fetchAll:
          !punctuateOnly && isWikisourceUrl(url) && !isWikisourceVolumeUrl(url) ? true : undefined,
      });
      if (!result.text.trim()) {
        setError('That URL returned no text.');
        return;
      }
      if (result.sections?.length) {
        setCtextSections(result.sections);
      }
      const kind =
        'kind' in result && result.kind
          ? (result.kind as ParallelSource['kind'])
          : isCtextWikiUrl(url)
            ? 'ctext'
            : 'url';
      if (kind === 'ctext' && punctuateOnly) {
        setAlignMode('segmented');
      } else if (isWikisourceUrl(url)) {
        setAlignMode('tape');
      }
      setEditorPreview(null);
      setSources((current) => [
        ...current,
        {
          id: `url-${result.label}-${Date.now()}`,
          label: result.label,
          text: result.text,
          kind,
          url,
          chapters:
            'chapters' in result && Array.isArray(result.chapters)
              ? (result.chapters as ParallelSource['chapters'])
              : undefined,
        },
      ]);
      setUsedChapterIds([]);
      const chapterCount =
        'chapters' in result && Array.isArray(result.chapters) ? result.chapters.length : 0;
      setStatus(
        chapterCount > 1
          ? `Fetched ${result.label} (${chapterCount} chapters, ${result.text.trim().length} characters).`
          : `Fetched ${result.label} (${result.text.trim().length} characters).`,
      );
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : String(fetchError));
    } finally {
      setBusy(false);
    }
  };

  const applyWikisourceFromCrosswalk = async (source: ParallelSourceEntry) => {
    if (!source.url) return;
    setCtextUrl(source.url);
    setError(null);
    if (punctuateOnly) {
      setStatus(`Wikisource URL set: ${source.label}. Click Fetch URL, then Preview.`);
      return;
    }
    await fetchParallelUrl(source.url);
  };

  const knownWikisource = wikisourceSources(parallelCrosswalk);
  const knownDaozang = daozangSources(parallelCrosswalk);
  const hasKnownSources = knownWikisource.length > 0 || knownDaozang.length > 0;

  const listCtextSections = async () => {
    const api = window.electronAPI;
    const url = ctextUrl.trim();
    if (!api?.kanripoListCtextSections || !url) return;
    setBusy(true);
    setError(null);
    try {
      const sections = await api.kanripoListCtextSections(url);
      setCtextSections(sections);
      setStatus(
        sections.length
          ? `Found ${sections.length} sections on that wiki page.`
          : 'No section headings found on that page.',
      );
    } catch (listError) {
      setError(listError instanceof Error ? listError.message : String(listError));
    } finally {
      setBusy(false);
    }
  };

  const listWikisourceVolumes = async () => {
    const api = window.electronAPI;
    const url = ctextUrl.trim();
    if (!api?.kanripoListWikisourceVolumes || !url) return;
    setBusy(true);
    setError(null);
    try {
      const sections = await api.kanripoListWikisourceVolumes(url);
      setCtextSections(sections);
      setStatus(
        sections.length
          ? `Found ${sections.length} Wikisource 卷 pages (Fetch URL loads all of them on import).`
          : 'No 卷 pages found under that Wikisource URL.',
      );
    } catch (listError) {
      setError(listError instanceof Error ? listError.message : String(listError));
    } finally {
      setBusy(false);
    }
  };

  const addPasteSource = () => {
    const text = pasteDraft.trim();
    if (!text) return;
    const next = pasteCount + 1;
    setPasteCount(next);
    setSources((current) => [...current, { id: `paste-${next}`, label: `Paste ${next}`, text }]);
    setPasteDraft('');
  };

  const addFiles = async () => {
    const api = window.electronAPI;
    if (!api?.pickDocumentImportSources) {
      setError('File picking is only available in the desktop app.');
      return;
    }
    setError(null);
    const picked = await api.pickDocumentImportSources();
    if (!picked?.length) return;
    setBusy(true);
    try {
      const added: ParallelSource[] = [];
      for (const item of picked) {
        const loaded = await loadParallelPlainText({
          format: item.format,
          sourcePath: item.sourcePath,
        });
        if (!loaded.text.trim()) continue;
        added.push({
          id: `file-${item.sourcePath}`,
          label: loaded.label,
          text: loaded.text,
        });
      }
      if (added.length === 0) {
        setError('Those files had no usable text.');
        return;
      }
      setSources((current) => [...current, ...added]);
    } catch (pickError) {
      setError(pickError instanceof Error ? pickError.message : String(pickError));
    } finally {
      setBusy(false);
    }
  };

  const addReferenceFolder = async () => {
    const api = window.electronAPI;
    if (!api?.pickDocumentImportSources) {
      setError('File picking is only available in the desktop app.');
      return;
    }
    setError(null);
    const picked = await api.pickDocumentImportSources();
    if (!picked?.length) return;
    setBusy(true);
    try {
      const added: ParallelSource[] = [];
      for (const item of picked) {
        const loaded = await loadParallelPlainText({
          format: item.format,
          sourcePath: item.sourcePath,
        });
        if (!loaded.text.trim()) continue;
        added.push({
          id: `folder-ref-${item.sourcePath}`,
          label: loaded.label,
          text: loaded.text,
          kind: 'folder-reference',
        });
      }
      if (added.length === 0) {
        setError('Those files had no usable text.');
        return;
      }
      setSources((current) => [...current, ...added]);
      setStatus(
        `Added ${added.length} reference file(s). They will be aligned to juan by content, not by filename, before import.`,
      );
    } catch (pickError) {
      setError(pickError instanceof Error ? pickError.message : String(pickError));
    } finally {
      setBusy(false);
    }
  };

  const canRunImport = Boolean(
    selected &&
    projectReady &&
    !busy &&
    window.electronAPI?.kanripoClone &&
    (importScope === 'work' ||
      (importScope === 'juan' && juanInput.trim() && window.electronAPI?.kanripoFetchJuan)) &&
    (punctMode === 'as-is' || punctMode === 'ai' || hasSources),
  );

  const runImport = async () => {
    if (!selected) return;
    const project = window.__leafWriterProject;
    const rootPath = project?.getProjectRootPath?.();
    const config = project?.getProjectConfig?.();
    if (!project || !projectReady || !rootPath || !config) {
      setError('Open a project before importing from Kanripo.');
      return;
    }
    const api = window.electronAPI;
    if (!api?.kanripoClone || !api.pluginsInvokePython || !api.writeFile || !api.ensureDirectory) {
      setError('Kanripo import is only available in the desktop app.');
      return;
    }

    if (punctMode === 'parallel') {
      const hasCtextSource = sources.some(
        (source) => source.kind === 'ctext' || (source.url && isCtextWikiUrl(source.url)),
      );
      if (hasCtextSource) {
        setError(CTEXT_IMPORT_MESSAGE);
        return;
      }
    }

    if (punctMode === 'ai') {
      const settings = aiApiSettingsFromDesktop();
      if (!isAiSuggestReady(settings)) {
        setError('Configure and test AI API settings first (App Settings).');
        return;
      }
    }

    setBusy(true);
    setError(null);
    setReport(null);
    setUsedChapterIds([]);
    setStatus(importScope === 'juan' ? `Fetching ${selected.id} juan…` : `Cloning ${selected.id}…`);

    importAbortRef.current?.abort();
    const importAbort = new AbortController();
    importAbortRef.current = importAbort;
    const { signal } = importAbort;

    let cloned = false;
    const written: string[] = [];
    const failed: { stem: string; message: string }[] = [];
    const bars: { stem: string; coverage: Coverage; outputPath: string }[] = [];
    const warnings: { stem: string; items: ParallelQualityWarning[] }[] = [];

    try {
      let files: string[] = [];
      if (importScope === 'juan') {
        const juan = juanInput.trim();
        if (!api.kanripoFetchJuan) {
          throw new Error('Single-juan fetch is not available in this app session.');
        }
        const fetched = await api.kanripoFetchJuan(selected.id, juan);
        files = fetched.files ?? (fetched.path ? [fetched.path] : []);
        cloned = true;
        if (files.length === 0) {
          throw new Error(`No text returned for ${fetched.loc ?? juan}.`);
        }
        setStatus(`Fetched ${fetched.loc ?? juan} via Kanripo API…`);
      } else {
        const clone = await api.kanripoClone(selected.id);
        cloned = true;
        files = clone.files ?? [];
        if (files.length === 0) {
          throw new Error(`No .txt files found in ${selected.id}.`);
        }
      }

      const destDir = joinPath(rootPath, 'imported', 'kanripo', selected.id);
      await api.ensureDirectory(destDir);
      const used = new Set<string>();
      const existingEntries = (await api.readDirectory?.(destDir, { allFiles: true })) ?? [];
      for (const entry of existingEntries) {
        if (!entry.isDirectory && entry.name.toLowerCase().endsWith('.xml')) {
          used.add(joinPath(destDir, entry.name).replace(/\\/g, '/'));
        }
      }

      const usedDuringImport: string[] = [];

      const aiSettings = punctMode === 'ai' ? aiApiSettingsFromDesktop() : null;
      const aiClient =
        punctMode === 'ai' && aiSettings ? createLlmClientFromSettings(aiSettings) : null;

      const convertedByFile = new Map<string, ConvertPayload>();
      let alignedJuanSources: Record<string, ParallelSource[]> | null = null;
      let alignedMatches: AlignedParagraphMatch[] | null = null;
      let alignedSourcesPayload: { id: string; label: string; text: string }[] | null = null;
      const folderReferenceSources = sources.filter((source) => source.kind === 'folder-reference');

      if (punctMode === 'parallel' && folderReferenceSources.length > 0) {
        const juanPayload: { juan_id: string; body_xml: string }[] = [];
        for (let i = 0; i < files.length; i += 1) {
          signal.throwIfAborted();
          const filePath = files[i];
          setStatus(`Converting for alignment (${i + 1} of ${files.length})…`);
          const converted = (await api.pluginsInvokePython(PLUGIN_ID, {
            path: filePath,
            normalize,
            gaiji_dest_dir: joinPath(destDir, '_gaiji'),
          })) as ConvertPayload;
          if (!converted?.body_xml || !converted.meta) continue;
          convertedByFile.set(filePath, converted);
          juanPayload.push({
            juan_id: converted.meta.juan || converted.meta.stem || filePath,
            body_xml: converted.body_xml,
          });
        }

        setStatus(
          `Aligning ${folderReferenceSources.length} reference file(s) against ${juanPayload.length} juan…`,
        );
        const alignedSourcesPayloadCandidate = folderReferenceSources.map((source) => ({
          id: source.id,
          label: source.label,
          text: source.text,
        }));
        const alignResult = (await api.pluginsInvokePython(PLUGIN_ID, {
          op: 'align_folder_sources',
          juan: juanPayload,
          sources: alignedSourcesPayloadCandidate,
        })) as {
          matches: AlignedParagraphMatch[];
          juan_sources: Record<string, { id: string; label: string; text: string }[]>;
          missing_juan_ids: string[];
        };

        const totalParas = alignResult.matches.length;
        const unmatchedParas = alignResult.matches.filter(
          (match) => match.match_type === 'unmatched',
        ).length;
        const summaryLines = [
          `Aligned reference folder against ${juanPayload.length} juan.`,
          `${totalParas - unmatchedParas}/${totalParas} paragraphs matched.`,
          alignResult.missing_juan_ids.length > 0
            ? `${alignResult.missing_juan_ids.length} juan have no matching source content: ${alignResult.missing_juan_ids.join(', ')}. They will be imported unpunctuated.`
            : 'No juan are entirely missing source content.',
          'Continue with this alignment?',
        ];
        if (!window.confirm(summaryLines.join('\n'))) {
          setStatus('Import cancelled: alignment not confirmed.');
          return;
        }

        alignedJuanSources = Object.fromEntries(
          Object.entries(alignResult.juan_sources).map(([juanId, list]) => [
            juanId,
            list.map(
              (item) => ({ id: item.id, label: item.label, text: item.text }) as ParallelSource,
            ),
          ]),
        );
        alignedMatches = alignResult.matches;
        alignedSourcesPayload = alignedSourcesPayloadCandidate;
      }

      for (let i = 0; i < files.length; i += 1) {
        signal.throwIfAborted();
        const filePath = files[i];
        const stem =
          filePath
            .replace(/\\/g, '/')
            .split('/')
            .pop()
            ?.replace(/\.txt$/i, '') ?? 'juan';
        setStatus(`Converting ${stem} (${i + 1} of ${files.length})…`);
        try {
          const converted =
            convertedByFile.get(filePath) ??
            ((await api.pluginsInvokePython(PLUGIN_ID, {
              path: filePath,
              normalize,
              gaiji_dest_dir: joinPath(destDir, '_gaiji'),
            })) as ConvertPayload);
          if (!converted?.body_xml || !converted.meta) {
            throw new Error('Python conversion returned no TEI body.');
          }
          let bodyXml = converted.body_xml;
          let punctNote: string | undefined;
          let barCoverage: Coverage | undefined;
          if (punctMode === 'parallel') {
            setStatus(`Punctuating ${stem} (${i + 1} of ${files.length})…`);
            const juanId = converted.meta.juan || converted.meta.stem || stem;
            const overrideSources = alignedJuanSources
              ? (alignedJuanSources[juanId] ?? [])
              : undefined;
            const punct =
              alignedMatches && alignedSourcesPayload
                ? await invokeParagraphScoped(
                    bodyXml,
                    juanId,
                    alignedMatches,
                    alignedSourcesPayload,
                  )
                : await invokeParallel(bodyXml, usedDuringImport, overrideSources);
            if (punct.matched_chapter_ids?.length) {
              for (const chapterId of punct.matched_chapter_ids) {
                if (!usedDuringImport.includes(chapterId)) {
                  usedDuringImport.push(chapterId);
                }
              }
            }
            if (punct.quality?.warnings?.length) {
              warnings.push({ stem, items: punct.quality.warnings });
            }
            if (punct.applied) {
              bodyXml = punct.body_xml;
              punctNote = formatParallelProvenance(overrideSources ?? sources, alignMode);
            }
            barCoverage = await fetchPunctCoverage(bodyXml);
          } else if (punctMode === 'ai' && aiClient) {
            setStatus(
              `AI punctuation ${stem} (juan ${i + 1} of ${files.length}, starting segments…)`,
            );
            const aiResult = await runAiPunctuate(bodyXml, {
              client: aiClient,
              signal,
              onProgress: (done, total) => {
                setStatus(
                  `AI punctuation ${stem} (juan ${i + 1} of ${files.length}, segment ${done} of ${total})…`,
                );
              },
            });
            if (aiResult.applied) {
              bodyXml = aiResult.body_xml;
              punctNote = formatAiProvenance({
                modelId: aiClient.modelId,
                promptVersion: AI_PUNCT_PROMPT_VERSION,
                normalize,
                stats: aiResult.stats,
              });
            }
          }
          const xml = wrapKanripoTeiDocument({
            config,
            meta: {
              ...converted.meta,
              normalize,
              stem: converted.meta.stem || stem,
              authorship: converted.entities?.authorship ?? converted.meta.authorship,
            },
            bodyXml,
            metadataXml: converted.metadata_xml,
            punctNote,
          });
          if (!xmlLooksWellFormed(xml)) {
            throw new Error('Wrapped TEI is not well-formed XML.');
          }
          const outputPath = uniqueKanripoXmlPath(destDir, converted.meta.stem || stem, used);
          const dir = parentDir(outputPath);
          if (dir) await api.ensureDirectory(dir);
          await api.writeFile(outputPath, xml);
          written.push(outputPath);
          if (barCoverage) {
            bars.push({ stem, coverage: barCoverage, outputPath });
          }
        } catch (itemError) {
          if (itemError instanceof DOMException && itemError.name === 'AbortError') {
            throw itemError;
          }
          failed.push({
            stem,
            message: itemError instanceof Error ? itemError.message : String(itemError),
          });
        }
      }

      if (failed.length === 0 && importScope === 'work') {
        await api.kanripoFlush?.(selected.id);
        cloned = false;
      }
      setUsedChapterIds(usedDuringImport);

      setStatus(`Finalising ${written.length} juan…`);
      await ensureImportHeaderEntitiesForPaths(written);
      await project.refreshExplorer?.();
      for (let i = 0; i < written.length; i += 1) {
        signal.throwIfAborted();
        setStatus(`Reloading juan (${i + 1} of ${written.length})…`);
        await project.reloadFileFromDisk?.(written[i]);
      }
      setReport({ written, failed, bars, warnings });
      const warningCount = warnings.reduce((sum, row) => sum + row.items.length, 0);
      setStatus(
        failed.length === 0
          ? warningCount > 0
            ? `Imported ${written.length} juan with ${warningCount} parallel quality warning(s).`
            : `Imported ${written.length} juan.`
          : `Imported ${written.length} juan; ${failed.length} failed. The clone was kept so you can retry.`,
      );

      if (written.length === 1 && failed.length === 0) {
        await project.openFile?.(written[0]);
      }
    } catch (runError) {
      if (runError instanceof DOMException && runError.name === 'AbortError') {
        if (written.length > 0) {
          await project.refreshExplorer?.();
          for (const outputPath of written) {
            await project.reloadFileFromDisk?.(outputPath);
          }
          setReport({ written, failed, bars, warnings });
        }
        setStatus(
          written.length > 0
            ? `Import stopped. ${written.length} juan saved to imported/kanripo/${selected.id}/.`
            : 'Import cancelled.',
        );
        setError(null);
      } else {
        setError(runError instanceof Error ? runError.message : String(runError));
        setStatus('');
        if (cloned && written.length === 0) {
          // Keep the clone on failure so a retry does not re-download.
        }
      }
    } finally {
      importAbortRef.current = null;
      setBusy(false);
    }
  };

  const previewEditor = async () => {
    setError(null);
    setEditorPreview(null);
    setParallelApplied(false);
    const xml = window.__leafWriterProject?.getActiveFileXml?.() ?? '';
    const body = extractJuanDiv(xml);
    if (!body) {
      setError('Open a Kanripo TEI file (with a juan div) first.');
      return;
    }
    if (!hasSources) {
      setError('Add a punctuated parallel (file or paste).');
      return;
    }
    setBusy(true);
    try {
      const punct = await invokeParallel(body);
      setEditorPreview({
        xml,
        body: punct.body_xml,
        coverage: punct.coverage,
        warnings: punct.quality?.warnings,
      });
      setStatus(
        punct.quality?.warnings?.length
          ? `Preview ready with ${punct.quality.warnings.length} quality warning(s).`
          : punct.applied
            ? 'Preview ready for this file. Apply writes punctuation only on the green stretch.'
            : 'No overlap in this file — the parallel does not match this juan. Nothing will be changed.',
      );
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : String(previewError));
    } finally {
      setBusy(false);
    }
  };

  const applyEditor = async () => {
    if (!editorPreview?.coverage || editorPreview.coverage.empty) {
      setError('Nothing to apply (empty coverage).');
      return;
    }
    const filePath = window.__leafWriterProject?.getActiveFilePath?.();
    let next = replaceJuanDiv(editorPreview.xml, editorPreview.body);
    next = appendTeiRevisionChange(next, formatParallelProvenance(sources, alignMode));
    if (!xmlLooksWellFormed(next)) {
      setError('Resulting XML is not well-formed.');
      return;
    }
    if (filePath && window.electronAPI?.writeFile) {
      await window.electronAPI.writeFile(filePath, next);
      await window.__leafWriterProject?.reloadFileFromDisk?.(filePath);
    } else if (window.writer?.setDocument) {
      window.writer.setDocument(next);
    } else {
      setError('Could not write the active document.');
      return;
    }
    setStampCoverage(await fetchPunctCoverage(editorPreview.body));
    setParallelApplied(true);
    setStatus('Applied parallel punctuation. Use Fill gaps for grey areas.');
  };

  const aiFillGaps = async () => {
    setError(null);
    setBusy(true);
    try {
      const outcome = await runAiFillGapsEditorCommand();
      if (outcome.ok) {
        setStatus(outcome.message);
        const xml = window.__leafWriterProject?.getActiveFileXml?.() ?? '';
        const body = extractJuanDiv(xml);
        if (body) {
          setStampCoverage(await fetchPunctCoverage(body));
        }
      } else if (!outcome.cancelled) {
        setError(outcome.message);
      }
    } catch (fillError) {
      setError(fillError instanceof Error ? fillError.message : String(fillError));
    } finally {
      setBusy(false);
    }
  };

  const importHasGaps = Boolean(report?.bars?.some((bar) => coverageHasGaps(bar.coverage)));
  const canAiFillGaps = Boolean(punctuateOnly && aiReady && parallelApplied && !busy);

  const aiFillGapsForJuan = async (bar: { stem: string; outputPath: string }) => {
    if (!aiReady) {
      setError('Configure and test AI API settings first (App Settings).');
      return;
    }
    fillGapsAbortRef.current?.abort();
    const fillAbort = new AbortController();
    fillGapsAbortRef.current = fillAbort;
    setFillingGapsStem(bar.stem);
    setBusy(true);
    setError(null);
    try {
      const outcome = await runAiFillGapsOnFile(bar.outputPath, {
        signal: fillAbort.signal,
        onProgress: (done, total) => {
          setStatus(`AI fill gaps ${bar.stem} (segment ${done} of ${total})…`);
        },
      });
      if (outcome.ok) {
        setStatus(outcome.message);
        const api = window.electronAPI;
        if (api?.readFile) {
          const xml = await api.readFile(bar.outputPath);
          const body = extractJuanDiv(xml);
          if (body) {
            const cov = await fetchPunctCoverage(body);
            setReport((prev) =>
              prev
                ? {
                    ...prev,
                    bars: prev.bars?.map((row) =>
                      row.stem === bar.stem ? { ...row, coverage: cov } : row,
                    ),
                  }
                : prev,
            );
          }
        }
        await window.__leafWriterProject?.openFile?.(bar.outputPath);
      } else if (!outcome.cancelled) {
        setError(outcome.message);
      } else {
        setStatus('Fill gaps cancelled.');
      }
    } catch (fillError) {
      if (fillError instanceof DOMException && fillError.name === 'AbortError') {
        setStatus('Fill gaps cancelled.');
      } else {
        setError(fillError instanceof Error ? fillError.message : String(fillError));
      }
    } finally {
      setFillingGapsStem(null);
      setBusy(false);
      fillGapsAbortRef.current = null;
    }
  };

  const hint = useMemo(() => {
    if (punctuateOnly) {
      return 'Parallel punctuation applies to the open file only. When a Wikisource or Daozang match exists for this Kanripo id, use the one-click buttons below. For ctext commentary, files, or other URLs, use the advanced fields.';
    }
    if (initialUrl.trim()) {
      return `Sent from browser (${initialUrl.trim()}). Confirm the work, import scope, and options below.`;
    }
    if (!projectReady) return 'Open a project first (same as Import Documents).';
    if (punctMode === 'parallel') {
      return 'Punctuation is taken from a parallel transcription in the KRP–Wikisource–Daozang crosswalk. Gaps can be filled later with AI.';
    }
    if (punctMode === 'ai') {
      return 'Each juan is converted to TEI, then punctuation is inferred by AI. Requires configured AI API settings.';
    }
    return '';
  }, [projectReady, punctuateOnly, punctMode, initialUrl]);

  useEffect(() => {
    setParallelChoice('');
  }, [selected?.id]);

  const parallelChoices = [
    ...knownWikisource.map((source) => ({
      value: `ws:${source.ws_page ?? source.url}`,
      label: `Wikisource — ${source.label}`,
      apply: () => applyWikisourceFromCrosswalk(source),
    })),
    ...knownDaozang.map((source) => ({
      value: `dz:${source.rel_path}`,
      label: `Daozang — ${source.label}`,
      apply: async () => {
        if (activeKrId) await applyBundledDaozangParallel(activeKrId);
      },
    })),
  ];

  const parallelEmptyMessage = !selected
    ? 'Select a work above.'
    : crosswalkLoading
      ? 'Looking up the crosswalk…'
      : `No parallel transcription for ${activeKrId ?? 'this work'}.`;

  /** Import flow: the KRP–Wikisource–Daozang bridge already knows the options. */
  const importParallelPanel = punctMode === 'parallel' && !punctuateOnly && (
    <Box sx={{ mt: 2 }}>
      {parallelChoices.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          {parallelEmptyMessage}
        </Typography>
      ) : (
        <FormControl fullWidth size="small" disabled={busy || daozangLoading}>
          <InputLabel id="kanripo-parallel-source">Parallel transcription</InputLabel>
          <Select
            labelId="kanripo-parallel-source"
            label="Parallel transcription"
            value={parallelChoice}
            onChange={(event) => {
              const value = event.target.value;
              setParallelChoice(value);
              void parallelChoices.find((choice) => choice.value === value)?.apply();
            }}
          >
            {parallelChoices.map((choice) => (
              <MenuItem key={choice.value} value={choice.value}>
                {choice.label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      )}
      {knownDaozang.length > 0 && !daozangPluginEnabled && (
        <Alert severity="warning" sx={{ mt: 1 }}>
          Enable <strong>Daozang import</strong> in Tools → Plugins.
        </Alert>
      )}
      {daozangMatch && (
        <Alert severity="success" sx={{ mt: 1 }}>
          Loaded Daozang ({daozangMatch.dzId}): {daozangMatch.title}
        </Alert>
      )}
      {daozangIssue && knownDaozang.length > 0 && (
        <Alert severity="info" sx={{ mt: 1 }}>
          {daozangParallelIssueMessage(daozangIssue)}
          {daozangIssueDetail ? ` ${daozangIssueDetail}` : ''}
        </Alert>
      )}
      <Box sx={{ mt: 2 }}>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          Or add your own reference text(s) — a single file per juan, or a whole folder of reference
          files (any provider, e.g. ctext) whose boundaries don't match juan boundaries; those are
          aligned to juan by content automatically.
        </Typography>
        <Button
          size="small"
          variant="outlined"
          disabled={busy}
          sx={{ mr: 1 }}
          onClick={() => void addFiles()}
        >
          Add file…
        </Button>
        <Tooltip title="For a folder of reference files whose boundaries don't match juan boundaries (e.g. ctext) -- content is aligned to juan automatically, not by filename.">
          <Button
            size="small"
            variant="outlined"
            disabled={busy}
            onClick={() => void addReferenceFolder()}
          >
            Add reference folder (auto-align)…
          </Button>
        </Tooltip>
        {sources.length > 0 && (
          <List dense sx={{ mt: 1, border: 1, borderColor: 'divider', borderRadius: 1 }}>
            {sources.map((source) => (
              <ListItem
                key={source.id}
                disablePadding
                secondaryAction={
                  <Button
                    size="small"
                    onClick={() =>
                      setSources((current) => current.filter((item) => item.id !== source.id))
                    }
                  >
                    Remove
                  </Button>
                }
              >
                <ListItemText
                  sx={{ pl: 1 }}
                  primary={source.label}
                  secondary={
                    source.kind === 'folder-reference' ? 'reference folder file' : source.kind
                  }
                />
              </ListItem>
            ))}
          </List>
        )}
      </Box>
    </Box>
  );

  const shownEditorCoverage = editorPreview?.coverage ?? stampCoverage;
  const showEditorCoverageBar =
    punctuateOnly && shownEditorCoverage && (editorPreview?.coverage || !shownEditorCoverage.empty);

  const parallelPanel = punctuateOnly && (
    <Box sx={{ mt: 2 }}>
      <Typography variant="subtitle2">Parallel transcription</Typography>
      {(activeKrId || crosswalkLoading) && (
        <Box sx={{ mt: 1, mb: 2, p: 1.5, border: 1, borderColor: 'divider', borderRadius: 1 }}>
          <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
            Known sources{activeKrId ? ` for ${activeKrId}` : ''}
          </Typography>
          {crosswalkLoading ? (
            <Typography variant="body2" color="text.secondary">
              Looking up crosswalk…
            </Typography>
          ) : hasKnownSources ? (
            <>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                {parallelCrosswalk?.title ? `${parallelCrosswalk.title} — ` : ''}
                One-click load from the bundled KRP–Wikisource–Daozang crosswalk.
              </Typography>
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 1 }}>
                {knownWikisource.map((source) => (
                  <Button
                    key={`ws-${source.ws_page ?? source.url}`}
                    size="small"
                    variant="contained"
                    disabled={busy}
                    onClick={() => void applyWikisourceFromCrosswalk(source)}
                  >
                    Wikisource: {source.label}
                  </Button>
                ))}
                {knownDaozang.map((source) => (
                  <Button
                    key={`dz-${source.rel_path}`}
                    size="small"
                    variant="contained"
                    disabled={busy || daozangLoading || !activeKrId || !daozangPluginEnabled}
                    onClick={() => activeKrId && void applyBundledDaozangParallel(activeKrId)}
                  >
                    Daozang: {source.label}
                  </Button>
                ))}
              </Box>
              {knownDaozang.length > 0 && !daozangPluginEnabled && (
                <Alert severity="warning" sx={{ mb: 1 }}>
                  Enable <strong>Daozang import</strong> in Tools → Plugins to load bundled Daozang
                  punctuation.
                </Alert>
              )}
              {daozangMatch && (
                <Alert severity="success" sx={{ mb: 1 }}>
                  Loaded Daozang ({daozangMatch.dzId}): {daozangMatch.title}
                </Alert>
              )}
              {daozangIssue && knownDaozang.length > 0 && (
                <Alert severity="info" sx={{ mb: 1 }}>
                  {daozangParallelIssueMessage(daozangIssue)}
                  {daozangIssueDetail ? ` ${daozangIssueDetail}` : ''}
                </Alert>
              )}
            </>
          ) : activeKrId ? (
            <Typography variant="body2" color="text.secondary">
              No bundled Wikisource or Daozang match for this id — use file, paste, or URL below.
            </Typography>
          ) : (
            <Typography variant="body2" color="text.secondary">
              Open a Kanripo TEI file with a Kanripo idno to see crosswalk matches.
            </Typography>
          )}
        </Box>
      )}
      <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
        Other sources
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        For ctext wiki (e.g. 李善 commentary), paste a URL and use segmented mode. Kanripo 卷
        numbers often differ from Wikisource — use the work index or correct 卷 page when not using
        the crosswalk button above.{' '}
        {isCtextWikiUrl(ctextUrl) &&
          (isCtextWikiResUrl(ctextUrl)
            ? 'A res= index lists chapters — use List ctext sections, then click a chapter to fetch it.'
            : 'Narrow with section/contains below if the chapter page is long.')}
      </Typography>
      <FormControl sx={{ mb: 2 }} disabled={busy}>
        <FormLabel>Alignment mode</FormLabel>
        <RadioGroup
          value={alignMode}
          onChange={(event) => setAlignMode(event.target.value as ParallelAlignMode)}
        >
          <FormControlLabel
            value="segmented"
            control={<Radio />}
            label="Segmented (basetext + commentary separately — for ctext)"
          />
          <FormControlLabel
            value="tape"
            control={<Radio />}
            label="Single tape (one contiguous Han string)"
          />
        </RadioGroup>
      </FormControl>
      <Typography variant="body2" sx={{ mb: 1 }}>
        Parallel URL (ctext wiki, Wikisource, or other)
      </Typography>
      <TextField
        fullWidth
        size="small"
        label="URL"
        placeholder="https://ctext.org/wiki.pl?chapter=… or https://zh.wikisource.org/wiki/後漢書"
        value={ctextUrl}
        onChange={(event) => setCtextUrl(event.target.value)}
        disabled={busy}
        sx={{ mb: 1 }}
      />
      {isCtextWikiUrl(ctextUrl) && (
        <Box sx={{ display: 'flex', gap: 1, mb: 1, flexWrap: 'wrap' }}>
          <TextField
            size="small"
            label="Section (ctext)"
            placeholder="兩都賦序"
            value={ctextSection}
            onChange={(event) => setCtextSection(event.target.value)}
            disabled={busy}
            sx={{ flex: 1, minWidth: 160 }}
          />
          <TextField
            size="small"
            label="Contains (ctext)"
            placeholder="或曰"
            value={ctextContains}
            onChange={(event) => setCtextContains(event.target.value)}
            disabled={busy}
            sx={{ flex: 1, minWidth: 160 }}
          />
        </Box>
      )}
      <Button
        size="small"
        variant="outlined"
        disabled={busy || !ctextUrl.trim()}
        sx={{ mb: 1, mr: 1 }}
        onClick={() => void fetchParallelUrl()}
      >
        Fetch URL
      </Button>
      {isCtextWikiUrl(ctextUrl) && (
        <Button
          size="small"
          variant="text"
          disabled={busy || !ctextUrl.trim()}
          sx={{ mb: 1 }}
          onClick={() => void listCtextSections()}
        >
          List ctext sections
        </Button>
      )}
      {isWikisourceUrl(ctextUrl) && (
        <Button
          size="small"
          variant="text"
          disabled={busy || !ctextUrl.trim()}
          sx={{ mb: 1 }}
          onClick={() => void listWikisourceVolumes()}
        >
          List Wikisource 卷
        </Button>
      )}
      {isCtextWikiUrl(ctextUrl) && ctextSections.length > 0 && punctuateOnly && (
        <List dense sx={{ mb: 1, border: 1, borderColor: 'divider', borderRadius: 1 }}>
          {ctextSections.map((section) => (
            <ListItemButton
              key={section.id}
              disabled={busy}
              onClick={() => {
                if (section.rowCount === 0 && isCtextWikiResUrl(ctextUrl)) {
                  const chapterUrl = ctextChapterUrlFromIndex(ctextUrl, section.id);
                  if (chapterUrl) void fetchParallelUrl(chapterUrl);
                  return;
                }
                setCtextSection(section.title || section.slug);
              }}
            >
              <ListItemText
                primary={section.title || section.slug}
                secondary={
                  section.rowCount === 0 && isCtextWikiResUrl(ctextUrl)
                    ? `chapter ${section.id} · click to fetch`
                    : `${section.rowCount} rows · ${section.id}`
                }
              />
            </ListItemButton>
          ))}
        </List>
      )}
      {!punctuateOnly && isWikisourceUrl(ctextUrl) && ctextSections.length > 0 && (
        <List dense sx={{ mb: 1, border: 1, borderColor: 'divider', borderRadius: 1 }}>
          {ctextSections.map((section) => (
            <ListItem key={section.id} dense>
              <ListItemText
                primary={section.title || section.slug}
                secondary={`included in whole-edition fetch · ${section.id}`}
              />
            </ListItem>
          ))}
        </List>
      )}
      <Button
        size="small"
        variant="outlined"
        disabled={busy}
        sx={{ mb: 1, mr: 1 }}
        onClick={() => void addFiles()}
      >
        Add file…
      </Button>
      <TextField
        fullWidth
        multiline
        minRows={3}
        label="Paste punctuated text"
        value={pasteDraft}
        onChange={(event) => setPasteDraft(event.target.value)}
        disabled={busy}
      />
      <Button
        size="small"
        sx={{ mt: 1 }}
        disabled={busy || !pasteDraft.trim()}
        onClick={addPasteSource}
      >
        Add paste
      </Button>
      {sources.length > 0 && (
        <List dense sx={{ mt: 1, border: 1, borderColor: 'divider', borderRadius: 1 }}>
          {sources.map((source) => (
            <ListItem
              key={source.id}
              disablePadding
              secondaryAction={
                <Button
                  size="small"
                  disabled={busy}
                  onClick={() =>
                    setSources((current) => current.filter((item) => item.id !== source.id))
                  }
                >
                  Remove
                </Button>
              }
            >
              <ListItemText
                sx={{ pl: 2, pr: 10 }}
                primary={source.label}
                secondary={`${source.text.trim().length} characters${
                  source.kind && source.kind !== 'file' && source.kind !== 'paste'
                    ? ` · ${source.kind}`
                    : ''
                }`}
              />
            </ListItem>
          ))}
        </List>
      )}
    </Box>
  );

  return (
    <Dialog
      fullWidth
      maxWidth="md"
      open={open}
      onClose={busy ? () => stopImport() : () => onClose?.('cancel')}
    >
      <DialogTitle>{punctuateOnly ? 'Segment and punctuate' : 'Import from Kanripo'}</DialogTitle>
      <DialogContent>
        {hint && (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {hint}
          </Typography>
        )}
        {!punctuateOnly && (
          <>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
              Search Kanripo — title, KR id, section, dynasty, or author
            </Typography>
            <TextField
              autoFocus
              fullWidth
              hiddenLabel
              placeholder="KR1a0145 or 周易"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              disabled={busy}
            />
            <List
              dense
              sx={{
                maxHeight: 240,
                overflow: 'auto',
                mt: 1,
                border: 1,
                borderColor: 'divider',
                borderRadius: 1,
              }}
            >
              {hits.map((hit) => (
                <ListItemButton
                  key={hit.id}
                  selected={selected?.id === hit.id}
                  disabled={busy}
                  onClick={() => setSelected(hit)}
                >
                  <CorpusWorkRow
                    section={hit.section}
                    ident={hit.id}
                    title={hit.title}
                    dynasty={hit.dynasty}
                    authors={hit.authors}
                  />
                </ListItemButton>
              ))}
              {hits.length === 0 && (
                <Box sx={{ px: 2, py: 1 }}>
                  <Typography variant="body2" color="text.secondary">
                    No matches.
                  </Typography>
                </Box>
              )}
            </List>
            <FormControl sx={{ mt: 2 }} disabled={busy}>
              <FormLabel>Import scope</FormLabel>
              <RadioGroup
                value={importScope}
                onChange={(event) => setImportScope(event.target.value as 'work' | 'juan')}
              >
                <FormControlLabel value="work" control={<Radio />} label="Entire work" />
                <FormControlLabel value="juan" control={<Radio />} label="One juan only" />
              </RadioGroup>
              {importScope === 'juan' && (
                <Box sx={{ mt: 1 }}>
                  <TextField
                    fullWidth
                    size="small"
                    label="Juan"
                    placeholder="001 or KR1a0030_001"
                    value={juanInput}
                    onChange={(event) => setJuanInput(event.target.value)}
                    disabled={busy}
                    helperText="Usually three digits (_001, _002, …)."
                  />
                </Box>
              )}
            </FormControl>
            <FormControl sx={{ mt: 2 }} disabled={busy}>
              <FormLabel>Character normalisation</FormLabel>
              <RadioGroup
                value={normalize}
                onChange={(event) => setNormalize(event.target.value as KanripoNormalizeMode)}
              >
                <FormControlLabel value="off" control={<Radio />} label="None" />
                <FormControlLabel value="dpm" control={<Radio />} label="DPM variant table" />
              </RadioGroup>
            </FormControl>
            <FormControl sx={{ mt: 2 }} disabled={busy}>
              <FormLabel>Punctuation</FormLabel>
              <RadioGroup
                value={punctMode}
                onChange={(event) => {
                  const next = event.target.value as 'as-is' | 'parallel' | 'ai';
                  setPunctMode(next);
                  if (next === 'parallel') setAlignMode('tape');
                }}
              >
                <FormControlLabel value="as-is" control={<Radio />} label="None" />
                <FormControlLabel
                  value="parallel"
                  control={<Radio />}
                  label="From parallel transcription"
                />
                <FormControlLabel value="ai" control={<Radio />} label="AI inference" />
              </RadioGroup>
              {punctMode === 'ai' && (
                <Alert severity={aiReady ? 'info' : 'warning'} sx={{ mt: 1 }}>
                  {aiReady ? (
                    'Select a work above.'
                  ) : (
                    <>
                      Configure your AI API in <strong>App Settings</strong> first.
                    </>
                  )}
                </Alert>
              )}
              {importParallelPanel}
            </FormControl>
          </>
        )}
        {parallelPanel}
        {showEditorCoverageBar && shownEditorCoverage && (
          <CoverageBar
            coverage={shownEditorCoverage}
            label={editorPreview ? 'Preview' : 'Existing stamps'}
          />
        )}
        {punctuateOnly && editorPreview && !parallelApplied && editorPreview.coverage.ratio < 1 && (
          <Alert severity="info" sx={{ mt: 1 }}>
            Green = parallel will be applied. Grey = not yet punctuated — click{' '}
            <strong>Apply</strong>, then <strong>Fill gaps</strong> if grey remains.
          </Alert>
        )}
        {punctuateOnly &&
          parallelApplied &&
          shownEditorCoverage &&
          shownEditorCoverage.ratio < 1 && (
            <Alert severity="info" sx={{ mt: 1 }}>
              Green = punctuated Han. Grey = still untreated. Click <strong>Fill gaps</strong> on
              grey segments (one juan at a time — can take several minutes).
            </Alert>
          )}
        {punctuateOnly &&
          editorPreview?.warnings?.map((item, index) => (
            <Alert
              key={`editor-${item.code}-${index}`}
              severity={item.severity === 'info' ? 'info' : 'warning'}
              sx={{ mt: 1 }}
            >
              {item.message}
            </Alert>
          ))}
        {report?.bars?.map((bar) => (
          <Box key={bar.stem} sx={{ mt: 1 }}>
            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <CoverageBar coverage={bar.coverage} label={bar.stem} />
              </Box>
              {!punctuateOnly && coverageHasGaps(bar.coverage) && (
                <Button
                  size="small"
                  variant="outlined"
                  disabled={busy || !aiReady || fillingGapsStem === bar.stem}
                  onClick={() => void aiFillGapsForJuan(bar)}
                  sx={{ mt: 0.5, flexShrink: 0 }}
                >
                  {fillingGapsStem === bar.stem ? 'Filling…' : 'Fill gaps'}
                </Button>
              )}
            </Box>
            {report.warnings
              ?.filter((row) => row.stem === bar.stem)
              .flatMap((row) => row.items)
              .map((item, index) => (
                <Alert
                  key={`${bar.stem}-${item.code}-${index}`}
                  severity={item.severity === 'info' ? 'info' : 'warning'}
                  sx={{ mt: 1 }}
                >
                  <strong>{bar.stem}:</strong> {item.message}
                </Alert>
              ))}
          </Box>
        ))}
        {busy && <LinearProgress sx={{ mt: 2 }} />}
        {status && (
          <Typography variant="body2" sx={{ mt: 1 }}>
            {status}
          </Typography>
        )}
        {error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error}
          </Alert>
        )}
        {report && (
          <Alert
            severity={
              report.failed.length ? 'warning' : report.warnings?.length ? 'warning' : 'success'
            }
            sx={{ mt: 2 }}
          >
            Written: {report.written.length}. Failed: {report.failed.length}.
            {report.warnings && report.warnings.length > 0 && (
              <>
                {' '}
                Parallel warnings: {report.warnings.reduce(
                  (sum, row) => sum + row.items.length,
                  0,
                )}{' '}
                across {report.warnings.length} juan.
              </>
            )}
            {report.failed.length > 0 && (
              <Box component="ul" sx={{ mt: 1, pl: 2 }}>
                {report.failed.map((item) => (
                  <li key={item.stem}>
                    {item.stem}: {item.message}
                  </li>
                ))}
              </Box>
            )}
          </Alert>
        )}
        {importHasGaps && !punctuateOnly && (
          <Alert severity={aiReady ? 'info' : 'warning'} sx={{ mt: 2 }}>
            {aiReady ? (
              <>
                Green = punctuated Han. Grey = still untreated. Use <strong>Fill gaps</strong> on
                each juan that still has grey areas (one juan at a time — can take several minutes).
              </>
            ) : (
              <>
                Some juans have grey (untreated) areas. Configure AI in{' '}
                <strong>App Settings</strong> to use <strong>Fill gaps</strong> on each bar above.
              </>
            )}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button
          color={busy ? 'warning' : undefined}
          onClick={() => (busy ? stopImport() : onClose?.('cancel'))}
        >
          {busy ? 'Stop' : 'Close'}
        </Button>
        {punctuateOnly ? (
          <>
            <Button disabled={busy || !hasSources} onClick={() => void previewEditor()}>
              Preview
            </Button>
            <Button
              disabled={busy || !editorPreview || editorPreview.coverage.empty}
              onClick={() => void applyEditor()}
            >
              Apply
            </Button>
            <Button variant="contained" disabled={!canAiFillGaps} onClick={() => void aiFillGaps()}>
              AI fill gaps
            </Button>
          </>
        ) : (
          <Button variant="contained" disabled={!canRunImport} onClick={() => void runImport()}>
            Import
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
};

export const isKanripoImportAvailable = (): boolean =>
  typeof window !== 'undefined' &&
  Boolean(window.electronAPI?.kanripoClone) &&
  isPluginEnabled(PLUGIN_ID);
