import CloseIcon from '@mui/icons-material/Close';
import RuleIcon from '@mui/icons-material/Rule';
import {
  Badge,
  Box,
  Button,
  Checkbox,
  Chip,
  Collapse,
  IconButton,
  MenuItem,
  Paper,
  Select,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import { ColorSwatchPicker } from '@src/components/ColorSwatchPicker';
import { leafwriterAtom } from '@src/jotai';
import { useAppState } from '@src/overmind';
import { useAtomValue } from 'jotai';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { HighlighterIcon } from './HighlighterIcon';
import {
  TAG_COLORS_CHANGED_EVENT,
  bindAppearanceHistoryToEditor,
  clearAppearanceHistory,
  recordAppearanceChange,
  setAppearanceFlushHandler,
} from './appearanceHistory';
import { loadCssRuleSuggestions } from './cssRuleSuggestions';
import type { CssRuleSuggestion } from './cssRuleSuggestions';
import { getEditorTagContext } from './tagSuggestions';
import { clearTagStatsCache, loadTagStats, previewProjectTagStats } from './tagStats';
import type { TagUsageStats } from './tagStats';
import {
  isTagAppearanceCandidate,
  tagAppearanceSupportsHighlight,
} from './tagAppearanceExclusions';
import {
  getAttributeRuleKeys,
  loadTagColors,
  makeTagRuleKey,
  parseTagRuleKey,
  resolveTagColor,
  updateTagColor,
} from './tagColors';
import type { TagColorEntry, TagColorsFile } from './tagColors';

const emptyStats = (): TagUsageStats => ({
  version: 1,
  project: { tags: {}, attrs: {}, attrValues: {} },
  files: {},
});

const NEW_RULE_HIGHLIGHT = '#fff2a8';

type UpdateEntry = (key: string, mutate: (current: TagColorEntry) => TagColorEntry | null) => void;

interface ColorControlsProps {
  colors: TagColorEntry;
  disabled: boolean;
  label: string;
  onUpdate: (mutate: (current: TagColorEntry) => TagColorEntry | null) => void;
  supportsHighlight: boolean;
}

const ColorControls = ({
  colors,
  disabled,
  label,
  onUpdate,
  supportsHighlight,
}: ColorControlsProps) => {
  const highlightOn = supportsHighlight && colors.highlightEnabled !== false;
  const textOn = colors.textEnabled !== false;
  return (
    <>
      {supportsHighlight ? (
        <ColorSwatchPicker
          ariaLabel={`${label} highlight color`}
          disabled={disabled}
          onChange={(hex) => onUpdate((current) => ({ ...current, highlight: hex }))}
          swatchColor={colors.highlight && highlightOn ? colors.highlight : undefined}
          value={colors.highlight ?? '#ffffff'}
        />
      ) : null}
      <ColorSwatchPicker
        ariaLabel={`${label} text color`}
        disabled={disabled}
        onChange={(hex) => onUpdate((current) => ({ ...current, text: hex }))}
        swatchColor={colors.text ?? '#000000'}
        sx={{ opacity: textOn ? 1 : 0.5 }}
        value={colors.text ?? '#000000'}
      />
      {supportsHighlight ? (
        <Checkbox
          checked={highlightOn}
          disabled={disabled}
          inputProps={{ 'aria-label': `${label} show background` }}
          onChange={(_event, checked) =>
            onUpdate((current) => ({ ...current, highlightEnabled: checked }))
          }
          sx={{
            color: 'text.primary',
            flexShrink: 0,
            height: 18,
            ml: 'auto',
            p: 0,
            width: 18,
            '& .MuiSvgIcon-root': { fontSize: 18 },
          }}
        />
      ) : null}
    </>
  );
};

interface AttributeRulesProps {
  cssSuggestions: CssRuleSuggestion[];
  disabled: boolean;
  supportsHighlight: boolean;
  tagColors: TagColorsFile | null;
  tagName: string;
  tagStats: TagUsageStats;
  updateEntry: UpdateEntry;
}

/** Sub-list under a tag: one colour rule per attribute value, plus an "add rule" row. */
const AttributeRules = ({
  cssSuggestions,
  disabled,
  supportsHighlight,
  tagColors,
  tagName,
  tagStats,
  updateEntry,
}: AttributeRulesProps) => {
  const { t } = useTranslation();
  const [attrName, setAttrName] = useState('');
  const [attrValue, setAttrValue] = useState('');

  const file = tagColors ?? { version: 1 as const, tags: {} };
  const ruleKeys = getAttributeRuleKeys(file, tagName);
  const attrValues = tagStats.project.attrValues[tagName] ?? {};
  const attrNames = Object.keys(attrValues).sort((a, b) => a.localeCompare(b));
  const valueCounts = attrValues[attrName] ?? {};
  const availableValues = Object.keys(valueCounts)
    .filter((value) => !ruleKeys.includes(makeTagRuleKey(tagName, attrName, value)))
    .sort((a, b) => a.localeCompare(b));

  const createRule = (name: string, value: string) =>
    updateEntry(makeTagRuleKey(tagName, name, value), () => ({ highlight: NEW_RULE_HIGHLIGHT }));

  const addRule = () => {
    if (!attrName || !attrValue) return;
    createRule(attrName, attrValue);
    setAttrValue('');
  };

  // Attribute values the project stylesheet already treats specially, not yet given a colour.
  const suggestions = cssSuggestions.filter(
    (suggestion) =>
      suggestion.tagName === tagName &&
      !ruleKeys.includes(makeTagRuleKey(tagName, suggestion.attrName, suggestion.attrValue)),
  );

  return (
    <Stack spacing={0.5} sx={{ borderLeft: 2, borderColor: 'divider', ml: 2, mt: 0.5, pl: 1 }}>
      {ruleKeys.length === 0 && suggestions.length === 0 ? (
        <Typography color="text.secondary" variant="caption">
          {t('LWC.desktop.tagging.tag_appearance_rules_empty')}
        </Typography>
      ) : null}
      {ruleKeys.map((key) => {
        const parsed = parseTagRuleKey(key);
        const colors = resolveTagColor(file, key) ?? {};
        const count = attrValues[parsed.attrName ?? '']?.[parsed.attrValue ?? ''];
        return (
          <Stack alignItems="center" direction="row" gap={0.75} key={key} sx={{ minWidth: 0 }}>
            <Typography
              fontSize="0.8125rem"
              sx={{ flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}
              noWrap
              title={key}
            >
              {parsed.attrName}={parsed.attrValue}
              {count ? (
                <Typography color="text.secondary" component="span" fontSize="0.75rem">
                  {' '}
                  ({count})
                </Typography>
              ) : null}
            </Typography>
            <ColorControls
              colors={colors}
              disabled={disabled}
              label={key}
              onUpdate={(mutate) => updateEntry(key, mutate)}
              supportsHighlight={supportsHighlight}
            />
            <IconButton
              aria-label={`${key} remove rule`}
              disabled={disabled}
              onClick={() => updateEntry(key, () => null)}
              size="small"
              sx={{ p: 0.25 }}
            >
              <CloseIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Stack>
        );
      })}
      {suggestions.length > 0 ? (
        <Stack spacing={0.5}>
          <Typography color="text.secondary" variant="caption">
            {t('LWC.desktop.tagging.tag_appearance_rules_from_css')}
          </Typography>
          <Stack direction="row" flexWrap="wrap" gap={0.5}>
            {suggestions.map(({ attrName: name, attrValue: value }) => (
              <Chip
                aria-label={`${tagName} add rule ${name}=${value}`}
                disabled={disabled}
                key={`${name}=${value}`}
                label={`+ ${name}=${value}`}
                onClick={() => createRule(name, value)}
                size="small"
                variant="outlined"
              />
            ))}
          </Stack>
        </Stack>
      ) : null}
      {attrNames.length > 0 ? (
        <Stack alignItems="center" direction="row" gap={0.5}>
          <Select
            displayEmpty
            disabled={disabled}
            inputProps={{ 'aria-label': `${tagName} rule attribute` }}
            onChange={(event) => {
              setAttrName(event.target.value);
              setAttrValue('');
            }}
            size="small"
            sx={{ flex: 1, fontSize: '0.8125rem', minWidth: 0 }}
            value={attrName}
          >
            <MenuItem value="">
              <em>{t('LWC.desktop.tagging.tag_appearance_rule_attribute')}</em>
            </MenuItem>
            {attrNames.map((name) => (
              <MenuItem key={name} value={name}>
                {name}
              </MenuItem>
            ))}
          </Select>
          <Select
            displayEmpty
            disabled={disabled || !attrName}
            inputProps={{ 'aria-label': `${tagName} rule value` }}
            onChange={(event) => setAttrValue(event.target.value)}
            size="small"
            sx={{ flex: 1, fontSize: '0.8125rem', minWidth: 0 }}
            value={attrValue}
          >
            <MenuItem value="">
              <em>{t('LWC.desktop.tagging.tag_appearance_rule_value')}</em>
            </MenuItem>
            {availableValues.map((value) => (
              <MenuItem key={value} value={value}>
                {value || '∅'}
              </MenuItem>
            ))}
          </Select>
          <Button
            disabled={disabled || !attrName || !attrValue}
            onClick={addRule}
            size="small"
            sx={{ flexShrink: 0, minWidth: 0 }}
          >
            {t('LWC.desktop.tagging.tag_appearance_rule_add')}
          </Button>
        </Stack>
      ) : (
        <Typography color="text.secondary" variant="caption">
          {t('LWC.desktop.tagging.tag_appearance_rules_no_attributes')}
        </Typography>
      )}
    </Stack>
  );
};

const isVisualEditorActive = (): boolean =>
  Boolean(window.writer?.editor) && window.writer?.overmindState?.ui?.editorViewMode !== 'source';

export const CssPanel = ({ visible = true }: { visible?: boolean }) => {
  const { t } = useTranslation();
  const { activeTabPath, openTabs, rootPath } = useAppState().project;
  const { readonly } = useAppState().editor;
  const cssPath = useAppState().project.config?.schema?.css;
  const leafWriter = useAtomValue(leafwriterAtom);

  const [tagColors, setTagColors] = useState<TagColorsFile | null>(null);
  const [tagStats, setTagStats] = useState<TagUsageStats>(emptyStats);
  const [activeTagName, setActiveTagName] = useState('');
  const [cssSuggestions, setCssSuggestions] = useState<CssRuleSuggestion[]>([]);
  const [expandedTags, setExpandedTags] = useState<Set<string>>(() => new Set());

  const saveDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingEntryRef = useRef<{ tagName: string; colors: TagColorEntry | null } | null>(null);

  const refreshStats = useCallback(async () => {
    if (!rootPath) {
      setTagStats(emptyStats());
      return;
    }
    clearTagStatsCache();
    const persisted = await loadTagStats(rootPath);
    setTagStats(previewProjectTagStats(persisted, rootPath, openTabs));
  }, [openTabs, rootPath]);

  const refreshTagColors = useCallback(async () => {
    if (!rootPath) {
      setTagColors(null);
      return;
    }
    setTagColors(await loadTagColors(rootPath));
  }, [rootPath]);

  const refreshCssSuggestions = useCallback(async () => {
    setCssSuggestions(rootPath ? await loadCssRuleSuggestions(rootPath, cssPath) : []);
  }, [cssPath, rootPath]);

  const syncActiveTag = useCallback(() => {
    if (!isVisualEditorActive()) {
      setActiveTagName('');
      return;
    }
    const name = getEditorTagContext()?.tagElement?.getAttribute('_tag') ?? '';
    setActiveTagName(name);
  }, []);

  const persistPendingChange = useCallback(async () => {
    const pending = pendingEntryRef.current;
    if (!pending || !rootPath) return;
    pendingEntryRef.current = null;
    const updated = await updateTagColor(rootPath, pending.tagName, pending.colors);
    setTagColors(updated);
  }, [rootPath]);

  const refreshPanel = useCallback(async () => {
    await Promise.all([refreshStats(), refreshTagColors(), refreshCssSuggestions()]);
    syncActiveTag();
  }, [refreshCssSuggestions, refreshStats, refreshTagColors, syncActiveTag]);

  useEffect(() => {
    if (visible) {
      void refreshPanel();
      return;
    }

    if (saveDebounceRef.current) {
      clearTimeout(saveDebounceRef.current);
      saveDebounceRef.current = null;
    }
    void persistPendingChange();
  }, [visible, refreshPanel, persistPendingChange]);

  useEffect(() => {
    if (!visible || !leafWriter) return;

    const writer = window.writer;
    if (!writer) return;

    const onEditorChange = () => {
      syncActiveTag();
      void refreshStats();
    };

    const events = [
      'documentLoaded',
      'selectionChanged',
      'tagEdited',
      'contentChanged',
      'entityAdded',
      'entityRemoved',
      'nodeChanged',
    ] as const;

    for (const eventName of events) {
      writer.event(eventName).subscribe(onEditorChange);
    }

    return () => {
      for (const eventName of events) {
        writer.event(eventName).unsubscribe(onEditorChange);
      }
    };
  }, [leafWriter, refreshStats, syncActiveTag, visible]);

  // Follow the editor's undo position and let Undo/Redo reach colour changes made here.
  useEffect(() => {
    const writer = window.writer;
    if (!leafWriter || !writer) return;

    let boundEditor: unknown = null;
    let unbind: (() => void) | null = null;
    const ensureBound = () => {
      const editor = writer.editor;
      if (!editor || editor === boundEditor) return;
      unbind?.();
      boundEditor = editor;
      unbind = bindAppearanceHistoryToEditor(editor);
    };

    ensureBound();
    writer.event('documentLoaded').subscribe(ensureBound);
    return () => {
      writer.event('documentLoaded').unsubscribe(ensureBound);
      unbind?.();
    };
  }, [leafWriter]);

  useEffect(() => {
    setAppearanceFlushHandler(async () => {
      if (saveDebounceRef.current) {
        clearTimeout(saveDebounceRef.current);
        saveDebounceRef.current = null;
      }
      await persistPendingChange();
    });
    return () => setAppearanceFlushHandler(null);
  }, [persistPendingChange]);

  useEffect(() => {
    clearAppearanceHistory();
  }, [rootPath]);

  useEffect(() => {
    const onColorsChanged = () => void refreshTagColors();
    window.addEventListener(TAG_COLORS_CHANGED_EVENT, onColorsChanged);
    return () => window.removeEventListener(TAG_COLORS_CHANGED_EVENT, onColorsChanged);
  }, [refreshTagColors]);

  useEffect(
    () => () => {
      if (saveDebounceRef.current) clearTimeout(saveDebounceRef.current);
      void persistPendingChange();
    },
    [persistPendingChange],
  );

  const scheduleSave = useCallback(
    (tagName: string, colors: TagColorEntry | null) => {
      pendingEntryRef.current = { tagName, colors };
      if (saveDebounceRef.current) clearTimeout(saveDebounceRef.current);
      saveDebounceRef.current = setTimeout(() => {
        void persistPendingChange();
      }, 300);
    },
    [persistPendingChange],
  );

  const updateEntry = useCallback(
    (tagName: string, mutate: (current: TagColorEntry) => TagColorEntry | null) => {
      const current = resolveTagColor(tagColors ?? { version: 1, tags: {} }, tagName) ?? {};
      const next = mutate(current);
      if (rootPath) {
        recordAppearanceChange({
          rootPath,
          key: tagName,
          before: tagColors?.tags[tagName] ?? null,
          after: next,
        });
      }
      setTagColors((prev) => {
        const base = prev ?? { version: 1, tags: {} };
        const tags = { ...base.tags };
        if (!next) delete tags[tagName];
        else tags[tagName] = next;
        return { version: 1, tags };
      });
      scheduleSave(tagName, next);
    },
    [rootPath, scheduleSave, tagColors],
  );

  const orderedTags = useMemo(
    () =>
      Object.entries(tagStats.project.tags)
        .filter(([tagName, count]) => isTagAppearanceCandidate(tagName, count))
        .sort((left, right) => {
          if (right[1] !== left[1]) return right[1] - left[1];
          return left[0].localeCompare(right[0]);
        }),
    [tagStats.project.tags],
  );

  if (!activeTabPath) {
    return (
      <Paper elevation={0} square sx={{ height: '100%', p: 2 }}>
        <Typography color="text.secondary" variant="body2">
          {t('LWC.desktop.tagging.tag_appearance_open_file')}
        </Typography>
      </Paper>
    );
  }

  return (
    <Paper
      elevation={0}
      square
      sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}
    >
      <Stack spacing={0.5} sx={{ borderBottom: 1, borderColor: 'divider', p: 1.5 }}>
        <Stack alignItems="center" direction="row" spacing={1}>
          <HighlighterIcon color="action" fontSize="small" />
          <Typography fontWeight={600} variant="subtitle2">
            {t('LWC.desktop.tagging.tag_appearance')}
          </Typography>
        </Stack>
        <Typography color="text.secondary" variant="caption">
          {t('LWC.desktop.tagging.tag_appearance_hint')}
        </Typography>
      </Stack>

      <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        {orderedTags.length === 0 ? (
          <Typography color="text.secondary" sx={{ p: 2 }} variant="body2">
            {t('LWC.desktop.tagging.tag_appearance_empty')}
          </Typography>
        ) : (
          <Stack spacing={0.5} sx={{ p: 1 }}>
            {orderedTags.map(([tagName, count]) => {
              const colors = resolveTagColor(tagColors ?? { version: 1, tags: {} }, tagName) ?? {};
              const supportsHighlight = tagAppearanceSupportsHighlight(tagName);
              const disabled = readonly || !rootPath;
              const ruleCount = getAttributeRuleKeys(
                tagColors ?? { version: 1, tags: {} },
                tagName,
              ).length;
              const expanded = expandedTags.has(tagName);
              return (
                <Box key={tagName}>
                  <Stack
                    alignItems="center"
                    direction="row"
                    sx={{
                      borderRadius: 2,
                      gap: 0.75,
                      minWidth: 0,
                      px: 0.75,
                      py: 0.5,
                      ...(activeTagName === tagName ? { bgcolor: 'action.hover' } : undefined),
                    }}
                  >
                    <Chip
                      label={count}
                      size="medium"
                      sx={{
                        bgcolor: 'action.hover',
                        borderRadius: '18px',
                        flexShrink: 0,
                        fontSize: 12,
                        fontWeight: 700,
                        height: 24,
                        minWidth: 36,
                        '& .MuiChip-label': { px: 0.75 },
                      }}
                    />
                    <Typography
                      fontSize="0.875rem"
                      fontWeight={activeTagName === tagName ? 700 : 600}
                      lineHeight={1.2}
                      sx={{
                        flex: '1 1 auto',
                        minWidth: 0,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {tagName}
                    </Typography>
                    <Tooltip title={t('LWC.desktop.tagging.tag_appearance_rules')}>
                      <IconButton
                        aria-expanded={expanded}
                        aria-label={`${tagName} attribute rules`}
                        onClick={() =>
                          setExpandedTags((prev) => {
                            const next = new Set(prev);
                            if (next.has(tagName)) next.delete(tagName);
                            else next.add(tagName);
                            return next;
                          })
                        }
                        size="small"
                        sx={{ flexShrink: 0, p: 0.25 }}
                      >
                        <Badge
                          badgeContent={ruleCount}
                          color="primary"
                          sx={{ '& .MuiBadge-badge': { fontSize: 10, height: 14, minWidth: 14 } }}
                        >
                          <RuleIcon color={expanded ? 'primary' : 'action'} sx={{ fontSize: 18 }} />
                        </Badge>
                      </IconButton>
                    </Tooltip>
                    <ColorControls
                      colors={colors}
                      disabled={disabled}
                      label={tagName}
                      onUpdate={(mutate) => updateEntry(tagName, mutate)}
                      supportsHighlight={supportsHighlight}
                    />
                  </Stack>
                  <Collapse in={expanded} mountOnEnter unmountOnExit>
                    <AttributeRules
                      cssSuggestions={cssSuggestions}
                      disabled={disabled}
                      supportsHighlight={supportsHighlight}
                      tagColors={tagColors}
                      tagName={tagName}
                      tagStats={tagStats}
                      updateEntry={updateEntry}
                    />
                  </Collapse>
                </Box>
              );
            })}
          </Stack>
        )}
      </Box>
    </Paper>
  );
};
