import {
  Alert,
  Box,
  Button,
  ButtonBase,
  Chip,
  Divider,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type Writer from '../../js/Writer';
import { getCharInfo, preloadCharInfo, variantList, type CharInfo } from '../../utilities/charInfo';
import { insertAtCursor } from '../../utilities/chhivSymbols';
import { toggleComponentInFindText } from '../../utilities/composerComponents';
import {
  applyPaletteOperator,
  draftIds,
  emptyLeafSlot,
  isSlotFilled,
  parseIdsToComposerTree,
  replaceSlotAt,
  slotAt,
  slotHasContent,
  type ComposerSlot,
} from '../../utilities/composerTree';
import type { GlyphwikiCandidate } from '../../utilities/glyphwikiIndex';
import {
  findAndSortContaining,
  FIND_RESULTS_CAP,
  preloadContainingIndex,
  primaryStrokeCount,
} from '../../utilities/idsContainingSearch';
import { findIdsDecompositions } from '../../utilities/idsUnicodeIndex';
import {
  boxesEqual,
  canonicalUnicodeChar,
  defaultBoxesFor,
  expandIdsAbbreviations,
  partCountFor,
  type IdsOperator,
  type KageBox,
} from '../../utilities/kageCompose';
import { renderKageToSvg } from '../../utilities/kageRenderer';
import { automaticFormFor, nextFormOf } from '../../utilities/radicalForms';
import {
  emptyProjectGlyphRegistry,
  projectGlyphKageComponentMap,
  type ProjectGlyph,
  type ProjectGlyphRegistry,
} from '../../utilities/projectGlyphRegistry';
import {
  adoptGlyphwikiCandidateAndInsert,
  composeTreeAndInsertProjectGlyph,
  getProjectRootPath,
  insertProjectGlyphAtCursor,
  loadProjectGlyphRegistryFromDisk,
  previewComposerTree,
} from '../../utilities/projectGlyphStore';
import { ComponentsCatalogue } from './ComponentsCatalogue';
import { LayoutAdjustDialog } from './LayoutAdjustDialog';
import { LayoutPalette, LayoutRegion, PART_NAMES } from './LayoutCanvas';

const GlyphThumbnail = ({ svg, size = 160 }: { svg: string; size?: number }) => (
  <Box
    sx={{
      width: size,
      height: size,
      overflow: 'hidden',
      // kage-engine's raw SVG carries its own width="200" height="200"
      // attributes; without this, the browser honors those over the
      // wrapper's size and the glyph renders at full size, overflowing
      // everything below it instead of scaling to fit the preview box.
      '& svg': { width: '100%', height: '100%', display: 'block' },
    }}
    dangerouslySetInnerHTML={{ __html: svg }}
  />
);

const thumbCache = new Map<string, string>();
/** Data URLs of glyphs drawn from their saved SVG (no KAGE data to render). */
const fileThumbCache = new Map<string, string>();

/** Renders a project glyph's KAGE only once it scrolls into view, and caches
 * the SVG, so a large registry costs nothing until its tiles are seen. */
const ProjectGlyphThumb = ({
  glyph,
  components,
}: {
  glyph: ProjectGlyph;
  components: Record<string, string>;
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node || visible) return undefined;
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return undefined;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisible(true);
        observer.disconnect();
      }
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [visible]);

  const svg = useMemo(() => {
    if (!visible || !glyph.kage) return '';
    const key = `${glyph.id}\u0000${glyph.kage}`;
    let cached = thumbCache.get(key);
    if (cached === undefined) {
      cached = renderKageToSvg(glyph.kage, components).svg;
      thumbCache.set(key, cached);
    }
    return cached;
  }, [visible, glyph.id, glyph.kage, components]);

  // Pasted/imported glyphs have no KAGE data: show their saved SVG file instead.
  // An <img> data URL keeps any script in a foreign SVG inert.
  const [fileSrc, setFileSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!visible || glyph.kage) return undefined;
    const projectRoot = getProjectRootPath();
    const api = window.electronAPI;
    if (!projectRoot || !api?.readFile) return undefined;
    const path = `${projectRoot}/${glyph.svgRelativeUrl}`;
    const cached = fileThumbCache.get(path);
    if (cached) {
      setFileSrc(cached);
      return undefined;
    }
    let cancelled = false;
    void api
      .readFile(path)
      .then((text) => {
        if (typeof text !== 'string' || !text.includes('<svg')) return;
        const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`;
        fileThumbCache.set(path, url);
        if (!cancelled) setFileSrc(url);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [visible, glyph.kage, glyph.svgRelativeUrl]);

  if (!svg && fileSrc) {
    return (
      <Box
        ref={ref}
        component="img"
        src={fileSrc}
        alt={glyph.id}
        sx={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
      />
    );
  }

  return svg ? (
    <Box
      ref={ref}
      sx={{
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        '& svg': { width: '100%', height: '100%', display: 'block' },
      }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  ) : (
    <Box ref={ref} sx={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center' }}>
      <Typography variant="caption" color="text.secondary" sx={{ fontSize: 9 }}>
        {glyph.id.replace(/^chhiv-/, '')}
      </Typography>
    </Box>
  );
};

const InfoRow = ({ label, value }: { label: string; value?: string }) => {
  if (!value) return null;
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: '88px 1fr', gap: 1, py: 0.25 }}>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="body2" sx={{ fontFamily: 'serif' }}>
        {value}
      </Typography>
    </Box>
  );
};

/**
 * CHHIV glyph composer — marinaMoji three-column layout
 * (plugins/marinaMoji-composer-parity.md). Construct | Examine | Discover,
 * with TEI insert via project glyphs / plain Unicode.
 *
 * Stays open after a successful save (matching the other two CHHIV dialogs).
 */
const componentsOf = (ids: string): string[] => [
  ...new Set(Array.from(ids).filter((char) => !/[\u2FF0-\u2FFF\u31EF]/.test(char))),
];

type ExamineMode = 'composition' | 'lookup';

export const ComposeCharacterDialog = ({ writer }: { writer: Writer }) => {
  const [operator, setOperator] = useState<IdsOperator>('⿰');
  const [parts, setParts] = useState<ComposerSlot[]>([emptyLeafSlot(), emptyLeafSlot()]);
  const [registry, setRegistry] = useState<ProjectGlyphRegistry>(emptyProjectGlyphRegistry());
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [insertedMessage, setInsertedMessage] = useState<string | null>(null);
  const [flattenNotice, setFlattenNotice] = useState<string | null>(null);
  // [] means the outer square is selected. A field's path, e.g. [1], means
  // the next palette click builds a layout inside that field. Kept in a ref
  // as well as state so a palette click sees the field the scholar just
  // focused, even before React has re-rendered.
  const [selection, setSelection] = useState<number[]>([]);
  const selectionRef = useRef<number[]>([]);
  // "Break apart": the character typed, every IDS on record for it (only those
  // the composer can load), and which one is currently loaded.
  const [breakInput, setBreakInput] = useState('');
  const [breakResult, setBreakResult] = useState<
    | { status: 'cannot'; char: string }
    | {
        status: 'ok';
        char: string;
        options: string[];
        chosen: number;
        unencoded: number;
        /** False when the composer already held something, so it was left alone. */
        loaded: boolean;
      }
    | null
  >(null);

  const [idsText, setIdsText] = useState('⿰??');
  const idsEditingRef = useRef(false);
  const [middleTab, setMiddleTab] = useState(0);
  const [examineMode, setExamineMode] = useState<ExamineMode>('composition');
  const [lookupChar, setLookupChar] = useState<string | null>(null);
  const [lookupInfo, setLookupInfo] = useState<CharInfo | null>(null);
  const [findInput, setFindInput] = useState('');
  const [findResult, setFindResult] = useState<{
    shown: string[];
    matchCount: number;
    truncated: boolean;
  } | null>(null);
  const [findBusy, setFindBusy] = useState(false);
  /** null = operator defaults; otherwise top-level box overrides from Adjust. */
  const [layoutBoxes, setLayoutBoxes] = useState<KageBox[] | null>(null);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [insertingProjectId, setInsertingProjectId] = useState<string | null>(null);

  useEffect(() => {
    void preloadCharInfo();
    // First Find otherwise pauses ~several seconds building this index.
    // Defer so the dialog paints first; later Finds are then instant.
    const useIdle = typeof window !== 'undefined' && 'requestIdleCallback' in window;
    const warmId = useIdle
      ? window.requestIdleCallback(() => preloadContainingIndex(), { timeout: 2000 })
      : window.setTimeout(() => preloadContainingIndex(), 0);
    const cancelWarm = () => {
      if (useIdle) window.cancelIdleCallback(warmId as number);
      else window.clearTimeout(warmId as number);
    };
    const projectRoot = getProjectRootPath();
    if (!projectRoot) return cancelWarm;
    let cancelled = false;
    void loadProjectGlyphRegistryFromDisk(projectRoot).then((loaded) => {
      if (!cancelled) setRegistry(loaded);
    });
    return () => {
      cancelled = true;
      cancelWarm();
    };
  }, []);

  // Drop adjustments when the operator (box count / shape) changes.
  useEffect(() => {
    setLayoutBoxes(null);
  }, [operator]);

  const preview = useMemo(() => {
    if (!parts.every(isSlotFilled)) return null;
    return previewComposerTree(operator, parts, registry, layoutBoxes);
  }, [operator, parts, registry, layoutBoxes]);

  const compositionIds = draftIds(operator, parts);

  const renderAdjustPreview = useCallback(
    (boxes: KageBox[]) => {
      if (!parts.every(isSlotFilled)) return '';
      return previewComposerTree(operator, parts, registry, boxes).svg;
    },
    [operator, parts, registry],
  );

  const projectKageComponents = useMemo(() => projectGlyphKageComponentMap(registry), [registry]);

  useEffect(() => {
    if (!idsEditingRef.current) setIdsText(compositionIds);
  }, [compositionIds]);

  const examineChar =
    examineMode === 'lookup'
      ? lookupChar
      : (preview?.existingUnicodeChar ??
        (breakResult?.status === 'ok' && !breakResult.loaded ? breakResult.char : null));

  useEffect(() => {
    if (!examineChar) {
      setLookupInfo(null);
      return;
    }
    let cancelled = false;
    void getCharInfo(examineChar).then((info) => {
      if (!cancelled) setLookupInfo(info);
    });
    return () => {
      cancelled = true;
    };
  }, [examineChar]);

  const resetSlots = () => {
    setParts(Array.from({ length: partCountFor(operator) }, emptyLeafSlot));
    setLayoutBoxes(null);
    select([]);
    setExamineMode('composition');
    setLookupChar(null);
  };

  const select = (path: number[]) => {
    selectionRef.current = path;
    setSelection(path);
  };

  const handlePalette = (next: IdsOperator) => {
    setFlattenNotice(null);
    setExamineMode('composition');
    const applied = applyPaletteOperator(operator, parts, selectionRef.current, next);
    setOperator(applied.operator);
    setParts(applied.parts);
    if (selectionRef.current.length > 0 && !slotAt(applied.parts, selectionRef.current)) {
      select([]);
    }
  };

  const applyIdsText = (raw: string) => {
    const expanded = expandIdsAbbreviations(raw.trim());
    const parsed = parseIdsToComposerTree(expanded);
    if (!parsed) return false;
    setFlattenNotice(null);
    setSaveError(null);
    setOperator(parsed.operator);
    setParts(parsed.parts);
    select([]);
    setExamineMode('composition');
    setIdsText(draftIds(parsed.operator, parsed.parts));
    return true;
  };

  const loadDecomposition = (char: string, options: string[], chosen: number) => {
    const parsed = parseIdsToComposerTree(options[chosen] ?? '');
    if (!parsed) return;
    setFlattenNotice(null);
    setSaveError(null);
    setInsertedMessage(null);
    setOperator(parsed.operator);
    setParts(parsed.parts);
    select([]);
    setExamineMode('composition');
    setBreakResult({
      status: 'ok',
      char,
      options,
      chosen,
      unencoded: parsed.unencodedCount,
      loaded: true,
    });
  };

  /** The decomposition on offer without touching the layout square. */
  const offerDecomposition = (char: string, options: string[]) => {
    const parsed = parseIdsToComposerTree(options[0] ?? '');
    if (!parsed) return;
    setBreakResult({
      status: 'ok',
      char,
      options,
      chosen: 0,
      unencoded: parsed.unencodedCount,
      loaded: false,
    });
  };

  /** Loads the first decomposition into the layout square and lists every other
   * one on record. Only an empty composer is filled in: once something is typed
   * there, a later split just offers its components (to copy, or to load by hand)
   * rather than wiping the boxes. A character that cannot be broken leaves the
   * composer as it is. */
  const handleBreakApart = () => {
    const char = Array.from(breakInput.trim())[0];
    if (!char) return;
    const options = findIdsDecompositions(char).filter((ids) => parseIdsToComposerTree(ids));
    if (options.length === 0) {
      setBreakResult({ status: 'cannot', char });
      return;
    }
    if (parts.some(slotHasContent)) offerDecomposition(char, options);
    else loadDecomposition(char, options, 0);
  };

  const copyComponent = (component: string) => {
    void navigator.clipboard?.writeText(component).catch(() => undefined);
  };

  const selectedSlot = slotAt(parts, selection);

  /** The box the "Next form" button acts on: the selected one, when it is a
   * single character that is a form of some radical, with the character it
   * is drawn as now (the one its position calls for, unless an exact one was
   * chosen) and the one the button would switch to. */
  const formCycle = (() => {
    if (!selectedSlot || selectedSlot.kind !== 'leaf') return null;
    const typed = selectedSlot.input.trim();
    if (Array.from(typed).length !== 1) return null;
    const parentPath = selection.slice(0, -1);
    const parent = parentPath.length === 0 ? null : slotAt(parts, parentPath);
    const parentOperator = parent?.kind === 'nested' ? parent.operator : operator;
    const shown = selectedSlot.exactForm
      ? typed
      : (automaticFormFor(typed, parentOperator, selection[selection.length - 1] ?? 0) ?? typed);
    const next = nextFormOf(shown);
    return next ? { shown, next } : null;
  })();

  const handleNextForm = () => {
    if (!formCycle || !selectedSlot || selectedSlot.kind !== 'leaf') return;
    setParts(
      replaceSlotAt(parts, selection, {
        kind: 'leaf',
        input: formCycle.next,
        exactForm: true,
      }),
    );
  };

  const activeOperator: IdsOperator | null =
    selection.length === 0
      ? operator
      : selectedSlot?.kind === 'nested'
        ? selectedSlot.operator
        : null;

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    setInsertedMessage(null);
    const result = await composeTreeAndInsertProjectGlyph(writer, operator, parts, layoutBoxes);
    setSaving(false);
    if (!result.ok) {
      setSaveError(result.error);
      return;
    }
    resetSlots();
    setInsertedMessage(result.glyph.id);
    const projectRoot = getProjectRootPath();
    if (projectRoot) setRegistry(await loadProjectGlyphRegistryFromDisk(projectRoot));
  };

  const handleAdopt = async (candidate: GlyphwikiCandidate) => {
    setSaving(true);
    setSaveError(null);
    setInsertedMessage(null);
    const result = await adoptGlyphwikiCandidateAndInsert(writer, candidate);
    setSaving(false);
    if (!result.ok) {
      setSaveError(result.error);
      return;
    }
    resetSlots();
    setInsertedMessage(result.glyph.id);
    const projectRoot = getProjectRootPath();
    if (projectRoot) setRegistry(await loadProjectGlyphRegistryFromDisk(projectRoot));
  };

  /** Route A (plugins/glyph_maker.md): this candidate already IS an ordinary
   * encoded Unicode character - insert the plain character directly, no SVG
   * gaiji/registry entry at all. No file I/O, so no error path to handle. */
  const handleInsertUnicode = (char: string, codepointLabel: string) => {
    setSaveError(null);
    setInsertedMessage(null);
    insertAtCursor(writer, char);
    resetSlots();
    setInsertedMessage(`${char} (${codepointLabel}, plain text)`);
  };

  const canSave = Boolean(preview) && preview!.unresolvedComponents.length === 0 && !saving;
  const canInsertUnicode = Boolean(preview?.existingUnicodeChar) && !saving;
  const canAdjust = Boolean(preview) && preview!.unresolvedComponents.length === 0 && !saving;
  const layoutIsAdjusted =
    Boolean(layoutBoxes) && !boxesEqual(layoutBoxes!, defaultBoxesFor(operator));
  const canInsertLookup =
    examineMode === 'lookup' &&
    Boolean(lookupChar) &&
    !saving &&
    Array.from(lookupChar!).length === 1;

  const handleInsertProjectGlyph = async (glyph: ProjectGlyph) => {
    setInsertingProjectId(glyph.id);
    setSaveError(null);
    setInsertedMessage(null);
    const result = await insertProjectGlyphAtCursor(writer, glyph);
    setInsertingProjectId(null);
    if (!result.ok) {
      setSaveError(result.error);
      return;
    }
    setInsertedMessage(result.glyph.id);
  };

  const handleInsert = () => {
    if (canInsertLookup && lookupChar) {
      const cp = lookupChar.codePointAt(0)?.toString(16).toUpperCase() ?? '';
      handleInsertUnicode(lookupChar, `U+${cp}`);
      return;
    }
    if (preview?.existingUnicodeChar) {
      handleInsertUnicode(
        preview.existingUnicodeChar,
        `U+${preview.existingUnicodeChar.codePointAt(0)?.toString(16).toUpperCase()}`,
      );
      return;
    }
    if (canSave) void handleSave();
  };

  const insertEnabled = canInsertLookup || canInsertUnicode || canSave;

  const handleCopy = () => {
    if (examineMode === 'lookup' && lookupChar) {
      void navigator.clipboard?.writeText(lookupChar).catch(() => undefined);
      return;
    }
    if (preview?.existingUnicodeChar) {
      void navigator.clipboard?.writeText(preview.existingUnicodeChar).catch(() => undefined);
      return;
    }
    if (preview?.svg) {
      void navigator.clipboard?.writeText(preview.svg).catch(() => undefined);
      return;
    }
    void navigator.clipboard?.writeText(compositionIds).catch(() => undefined);
  };

  const openLookup = (char: string) => {
    setLookupChar(char);
    setExamineMode('lookup');
    setMiddleTab(0);
  };

  const runFind = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) {
      setFindResult(null);
      return;
    }
    setFindBusy(true);
    try {
      // Stroke filters read the char-info table; wait for it rather than
      // silently matching nothing while it is still loading.
      await preloadCharInfo();
      const result = findAndSortContaining(trimmed);
      setFindResult({
        shown: result.shown,
        matchCount: result.matches.length,
        truncated: result.truncated,
      });
    } finally {
      setFindBusy(false);
    }
  };

  const handleFindContaining = () => void runFind(findInput);

  const handleToggleCatalogueComponent = (component: string) => {
    const next = toggleComponentInFindText(findInput, component);
    setFindInput(next);
    void runFind(next);
  };

  const columnSx = {
    display: 'flex',
    flexDirection: 'column',
    gap: 1,
    minHeight: 0,
  } as const;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, minWidth: 0 }}>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: '280px minmax(220px, 1fr) minmax(240px, 1fr)' },
          gap: 2,
          alignItems: 'stretch',
        }}
      >
        {/* —— Construct —— */}
        <Box sx={{ ...columnSx, width: { md: 280 } }}>
          <Typography variant="subtitle2">Structure</Typography>
          <LayoutPalette activeOperator={activeOperator} onPick={handlePalette} />
          <Box sx={{ width: 280, height: 280, maxWidth: '100%' }}>
            <LayoutRegion
              operator={operator}
              parts={parts}
              path={[]}
              selectedPath={selection}
              onSelect={(path) => {
                setExamineMode('composition');
                select(path);
              }}
              onPartsChange={(next) => {
                setExamineMode('composition');
                setParts(next);
              }}
              onFlattenRefused={() =>
                setFlattenNotice(
                  'This layout has more than one part filled in. Clear the extras, then remove it.',
                )
              }
            />
          </Box>
          <TextField
            size="small"
            label="IDS"
            value={idsText}
            placeholder="e.g. LR日月 or ⿰日月"
            onFocus={() => {
              idsEditingRef.current = true;
              setExamineMode('composition');
            }}
            onBlur={() => {
              idsEditingRef.current = false;
              applyIdsText(idsText);
            }}
            onChange={(event) => setIdsText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                idsEditingRef.current = false;
                applyIdsText(idsText);
              }
            }}
            slotProps={{ htmlInput: { style: { fontFamily: 'serif', fontSize: 18 } } }}
            fullWidth
            helperText="LR / UD / … expand to ⿰ / ⿱ / …"
          />
          <Tooltip
            title={
              formCycle
                ? `Change the selected box from ${formCycle.shown} to ${formCycle.next}`
                : 'Select a box that holds a radical (言, 人, 水 ...) to cycle through its forms'
            }
          >
            <span>
              <Button
                variant="outlined"
                size="small"
                disabled={!formCycle}
                onClick={handleNextForm}
              >
                Next form
              </Button>
            </span>
          </Tooltip>
        </Box>

        {/* —— Examine —— */}
        <Box
          sx={{
            ...columnSx,
            borderLeft: { md: '1px solid' },
            borderColor: 'divider',
            pl: { md: 2 },
          }}
        >
          <Tabs
            value={middleTab}
            onChange={(_, value: number) => setMiddleTab(value)}
            sx={{ minHeight: 36, '& .MuiTab-root': { minHeight: 36, py: 0 } }}
          >
            <Tab label="Character" />
            <Tab label="Components" />
          </Tabs>

          {middleTab === 0 && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, flex: 1 }}>
              {examineMode === 'lookup' && lookupChar && (
                <Button
                  size="small"
                  onClick={() => setExamineMode('composition')}
                  sx={{ alignSelf: 'flex-start' }}
                >
                  Return to composition
                </Button>
              )}

              <Box
                sx={{
                  display: 'flex',
                  justifyContent: 'center',
                  alignItems: 'center',
                  minHeight: 120,
                  border: '1px solid',
                  borderColor: 'divider',
                  borderRadius: 1,
                  p: 1,
                  bgcolor: 'background.default',
                }}
              >
                {examineChar ? (
                  <Typography sx={{ fontSize: 64, lineHeight: 1, fontFamily: 'serif' }}>
                    {examineChar}
                  </Typography>
                ) : preview ? (
                  <GlyphThumbnail svg={preview.svg} size={120} />
                ) : (
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{ px: 2, textAlign: 'center' }}
                  >
                    Compose on the left, or break apart a character on the right.
                  </Typography>
                )}
              </Box>

              {examineChar && (
                <Typography variant="body2" color="text.secondary">
                  {lookupInfo?.cp ?? `U+${examineChar.codePointAt(0)?.toString(16).toUpperCase()}`}
                </Typography>
              )}

              {/* Phase A (composer-visual-redesign.md §3-4): this exact IDS
                  composition already has a standard Unicode decomposition on
                  record - a stronger, qualitatively different result than a
                  GlyphWiki candidate (which only means *some* non-standard
                  glyph happens to combine the same parts). */}
              {preview?.existingUnicodeChar && examineMode === 'composition' && (
                <Alert severity="success" sx={{ py: 0.5 }}>
                  Already Unicode — Insert will put {preview.existingUnicodeChar} in as plain text.
                </Alert>
              )}

              {examineChar && lookupInfo && (
                <Box sx={{ overflow: 'auto', maxHeight: 200 }}>
                  <InfoRow label="Pinyin" value={lookupInfo.pinyin} />
                  <InfoRow label="Meaning" value={lookupInfo.definition} />
                  <InfoRow label="Strokes" value={lookupInfo.strokes} />
                  <InfoRow label="Radical" value={lookupInfo.rs} />
                  <InfoRow
                    label="On / Kun"
                    value={
                      lookupInfo.ja_kana ||
                      [lookupInfo.ja_on, lookupInfo.ja_kun].filter(Boolean).join(' ')
                    }
                  />
                  <InfoRow label="旧字体" value={lookupInfo.old_form} />
                  <InfoRow label="新字体" value={lookupInfo.new_form} />
                  {variantList(lookupInfo).length > 0 && (
                    <Box sx={{ mt: 0.5 }}>
                      <Typography variant="caption" color="text.secondary">
                        Variants
                      </Typography>
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
                        {variantList(lookupInfo).map((variant) => (
                          <Tooltip
                            key={variant}
                            title="Click to examine · double-click to break apart · right-click to copy"
                          >
                            <span>
                              <Chip
                                label={variant}
                                size="small"
                                onClick={() => openLookup(variant)}
                                onDoubleClick={() => {
                                  setBreakInput(variant);
                                  setMiddleTab(0);
                                  const options = findIdsDecompositions(variant).filter((ids) =>
                                    parseIdsToComposerTree(ids),
                                  );
                                  if (options.length === 0) {
                                    setBreakResult({ status: 'cannot', char: variant });
                                    return;
                                  }
                                  if (parts.some(slotHasContent)) {
                                    offerDecomposition(variant, options);
                                  } else {
                                    loadDecomposition(variant, options, 0);
                                  }
                                }}
                                onContextMenu={(event) => {
                                  event.preventDefault();
                                  copyComponent(variant);
                                }}
                                sx={{ fontFamily: 'serif', fontSize: 16 }}
                              />
                            </span>
                          </Tooltip>
                        ))}
                      </Box>
                    </Box>
                  )}
                </Box>
              )}

              {examineMode === 'composition' &&
                preview &&
                preview.unresolvedComponents.length > 0 && (
                  <Alert severity="warning">
                    No geometry found for: {preview.unresolvedComponents.join(', ')}
                  </Alert>
                )}

              {examineMode === 'composition' &&
                preview &&
                preview.glyphwikiCandidates.length > 0 &&
                !preview.existingUnicodeChar && (
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    <Typography variant="body2" color="text.secondary">
                      GlyphWiki matches — adopt one instead of composing new:
                    </Typography>
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                      {preview.glyphwikiCandidates.map((candidate) => {
                        const unicodeChar = canonicalUnicodeChar(candidate.name);
                        if (unicodeChar) {
                          // This candidate already IS an ordinary encoded character -
                          // show it as plain text in the document's own font, not a
                          // KAGE-rendered SVG, and insert exactly that on click. No
                          // gaiji object, no registry entry: Route A.
                          const codepointLabel = `U+${unicodeChar.codePointAt(0)?.toString(16).toUpperCase()}`;
                          return (
                            <Tooltip
                              key={candidate.name}
                              title={`Insert ${codepointLabel} as plain text`}
                            >
                              <ButtonBase
                                disabled={saving}
                                onClick={() => handleInsertUnicode(unicodeChar, codepointLabel)}
                                sx={{
                                  width: 56,
                                  height: 56,
                                  border: '2px solid',
                                  borderColor: 'success.main',
                                  borderRadius: 1,
                                }}
                              >
                                <Typography sx={{ fontSize: 28 }}>{unicodeChar}</Typography>
                              </ButtonBase>
                            </Tooltip>
                          );
                        }
                        const { svg } = renderKageToSvg(candidate.kageData);
                        return (
                          <Tooltip key={candidate.name} title={`Adopt ${candidate.name}`}>
                            <ButtonBase
                              disabled={saving}
                              onClick={() => void handleAdopt(candidate)}
                              sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1 }}
                            >
                              <GlyphThumbnail svg={svg} size={56} />
                            </ButtonBase>
                          </Tooltip>
                        );
                      })}
                    </Box>
                  </Box>
                )}
            </Box>
          )}

          {middleTab === 1 && (
            <ComponentsCatalogue
              findInput={findInput}
              onToggleComponent={handleToggleCatalogueComponent}
            />
          )}
        </Box>

        {/* —— Discover —— */}
        <Box
          sx={{
            ...columnSx,
            borderLeft: { md: '1px solid' },
            borderColor: 'divider',
            pl: { md: 2 },
          }}
        >
          <Typography variant="subtitle2">Decompose a character</Typography>
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
            <TextField
              size="small"
              label="Break apart a character"
              value={breakInput}
              onChange={(event) => setBreakInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  handleBreakApart();
                }
              }}
              slotProps={{ htmlInput: { style: { fontFamily: 'serif', fontSize: 18 } } }}
              sx={{ flex: 1 }}
            />
            <Button variant="outlined" disabled={!breakInput.trim()} onClick={handleBreakApart}>
              Break apart
            </Button>
          </Box>

          {breakResult?.status === 'cannot' && (
            <Alert severity="info">
              {breakResult.char} can&apos;t be broken apart: it is a basic component, or there is no
              decomposition for it in the data. The composer is unchanged.
            </Alert>
          )}
          {breakResult?.status === 'ok' && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
              <Typography variant="body2" color="text.secondary">
                {breakResult.loaded
                  ? breakResult.options.length === 1
                    ? `${breakResult.char} is loaded as ${breakResult.options[0]}.`
                    : `${breakResult.char} has ${breakResult.options.length} decompositions. Pick one:`
                  : `${breakResult.char} is ${breakResult.options[0]}. The composer already holds something, so it was left alone. Copy a component, or pick a decomposition to load:`}
              </Typography>
              {(!breakResult.loaded || breakResult.options.length > 1) && (
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                  {breakResult.options.map((ids, index) => (
                    <Chip
                      key={ids}
                      label={ids}
                      color={
                        breakResult.loaded && index === breakResult.chosen ? 'primary' : 'default'
                      }
                      variant={
                        breakResult.loaded && index === breakResult.chosen ? 'filled' : 'outlined'
                      }
                      onClick={() =>
                        loadDecomposition(breakResult.char, breakResult.options, index)
                      }
                      sx={{ fontFamily: 'serif', fontSize: 16 }}
                    />
                  ))}
                </Box>
              )}
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, alignItems: 'center' }}>
                <Typography variant="caption" color="text.secondary">
                  Components (click to copy):
                </Typography>
                {componentsOf(breakResult.options[breakResult.chosen] ?? '').map((component) => (
                  <Chip
                    key={component}
                    label={component}
                    size="small"
                    onClick={() => copyComponent(component)}
                    sx={{ fontFamily: 'serif', fontSize: 16 }}
                  />
                ))}
              </Box>
              {breakResult.unencoded > 0 && (
                <Typography variant="caption" color="text.secondary">
                  {breakResult.unencoded === 1
                    ? '1 component has no Unicode character and is left empty.'
                    : `${breakResult.unencoded} components have no Unicode character and are left empty.`}
                </Typography>
              )}
              <Button
                size="small"
                onClick={() => openLookup(breakResult.char)}
                sx={{ alignSelf: 'flex-start' }}
              >
                Examine {breakResult.char}
              </Button>
            </Box>
          )}

          <Divider sx={{ my: 1 }} />

          <Typography variant="subtitle2">Find by components</Typography>
          <Typography variant="caption" color="text.secondary">
            Type components (言木), optional strokes (木16, 木&lt;10, 木9-12). Click a result to
            examine it — composition is left alone.
          </Typography>
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
            <TextField
              size="small"
              label="Find components"
              value={findInput}
              onChange={(event) => setFindInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  handleFindContaining();
                }
              }}
              placeholder="e.g. 言木 or 木16"
              slotProps={{ htmlInput: { style: { fontFamily: 'serif', fontSize: 18 } } }}
              sx={{ flex: 1 }}
            />
            <Button
              variant="outlined"
              disabled={!findInput.trim() || findBusy}
              onClick={handleFindContaining}
            >
              {findBusy ? 'Finding…' : 'Find'}
            </Button>
          </Box>

          {findResult && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, minHeight: 0 }}>
              <Typography variant="caption" color="text.secondary">
                {findResult.matchCount === 0
                  ? 'No characters found.'
                  : findResult.truncated
                    ? `${findResult.matchCount} found; showing the first ${FIND_RESULTS_CAP}. Narrow with more components or strokes.`
                    : `${findResult.matchCount} character${findResult.matchCount === 1 ? '' : 's'} found.`}
              </Typography>
              {findResult.shown.length > 0 && (
                <Box
                  sx={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 0.5,
                    maxHeight: 220,
                    overflow: 'auto',
                    contentVisibility: 'auto',
                  }}
                >
                  {findResult.shown.map((char) => {
                    const strokes = primaryStrokeCount(char);
                    return (
                      <Tooltip
                        key={char}
                        title={strokes != null ? `${char} · ${strokes} strokes` : char}
                      >
                        <ButtonBase
                          aria-label={`Examine ${char}`}
                          onClick={() => openLookup(char)}
                          sx={{
                            width: 40,
                            height: 40,
                            border: '1px solid',
                            borderColor:
                              examineMode === 'lookup' && lookupChar === char
                                ? 'primary.main'
                                : 'divider',
                            borderRadius: 1,
                            fontFamily: 'serif',
                            fontSize: 22,
                          }}
                        >
                          {char}
                        </ButtonBase>
                      </Tooltip>
                    );
                  })}
                </Box>
              )}
              <Button
                size="small"
                onClick={() => setFindResult(null)}
                sx={{ alignSelf: 'flex-start' }}
              >
                Clear results
              </Button>
            </Box>
          )}

          <Divider sx={{ my: 1 }} />

          <Typography variant="subtitle2">Project glyphs</Typography>
          <Typography variant="caption" color="text.secondary">
            Glyphs already saved in this project. Click to insert at the cursor (composition is left
            alone).
          </Typography>
          {registry.glyphs.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No project glyphs yet — compose one with Save and insert.
            </Typography>
          ) : (
            <Box
              sx={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 0.5,
                maxHeight: 160,
                overflow: 'auto',
              }}
            >
              {registry.glyphs.map((glyph) => (
                <Tooltip
                  key={glyph.id}
                  title={`${glyph.id}${glyph.ids ? ` · ${glyph.ids}` : ''} — Insert`}
                >
                  <span>
                    <ButtonBase
                      aria-label={`Insert project glyph ${glyph.id}`}
                      disabled={insertingProjectId === glyph.id || saving}
                      onClick={() => void handleInsertProjectGlyph(glyph)}
                      sx={{
                        width: 44,
                        height: 44,
                        border: '1px solid',
                        borderColor: 'divider',
                        borderRadius: 1,
                        p: 0.25,
                      }}
                    >
                      <ProjectGlyphThumb glyph={glyph} components={projectKageComponents} />
                    </ButtonBase>
                  </span>
                </Tooltip>
              ))}
            </Box>
          )}
        </Box>
      </Box>

      {flattenNotice && <Alert severity="info">{flattenNotice}</Alert>}
      {saveError && <Alert severity="error">{saveError}</Alert>}
      {insertedMessage && !saveError && (
        <Alert severity="success">
          Inserted {insertedMessage} — compose another, or close this dialog.
        </Alert>
      )}

      {/* —— Footer —— */}
      <Box
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 1,
          pt: 1,
          borderTop: '1px solid',
          borderColor: 'divider',
        }}
      >
        <Button variant="outlined" onClick={resetSlots}>
          Clear
        </Button>
        <Tooltip
          title={
            canAdjust
              ? layoutIsAdjusted
                ? 'Layout boxes were adjusted — drag again, or reset inside the dialog'
                : 'Drag and resize component boxes before saving'
              : 'Fill every component first'
          }
        >
          <span>
            <Button
              variant="outlined"
              disabled={!canAdjust}
              onClick={() => setAdjustOpen(true)}
              color={layoutIsAdjusted ? 'secondary' : 'inherit'}
            >
              Adjust layout…{layoutIsAdjusted ? ' *' : ''}
            </Button>
          </span>
        </Tooltip>
        <Box sx={{ flex: 1 }} />
        <Button variant="outlined" onClick={handleCopy}>
          Copy
        </Button>
        <Button variant="contained" disabled={!insertEnabled} onClick={handleInsert}>
          {canInsertLookup || canInsertUnicode ? 'Insert' : 'Save and insert'}
        </Button>
      </Box>

      <LayoutAdjustDialog
        open={adjustOpen}
        operator={operator}
        partLabels={PART_NAMES[operator] ?? []}
        initialBoxes={layoutBoxes ?? defaultBoxesFor(operator)}
        renderPreview={renderAdjustPreview}
        onCancel={() => setAdjustOpen(false)}
        onApply={(boxes) => {
          setLayoutBoxes(boxes);
          setAdjustOpen(false);
        }}
      />
    </Box>
  );
};

export default ComposeCharacterDialog;
