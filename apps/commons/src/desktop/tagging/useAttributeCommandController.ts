import { useActions, useAppState } from '@src/overmind';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { applyAttributeToTag } from './attributeCommand';
import { getCaretScreenPosition } from './editorAnchor';
import {
  fetchSchemaAttributes,
  filterAttributeSuggestions,
  orderAttributeSuggestions,
  pickPrefillAttributeName,
  rankAttributeValues,
  rememberLastAttribute,
  resolveAttributeNameForApply,
  suggestAttributeValues,
  type SchemaAttributeDetail,
} from './attributeSuggestions';
import { matchesEditorAttribute } from './keybindings';
import { isImeKeyboardEvent } from './ime';
import { getEditorTagContext } from './tagSuggestions';
import { loadTagStats, updateTagStatsForFile } from './tagStats';

const isVisualEditorActive = (): boolean =>
  Boolean(window.writer?.editor) && window.writer?.overmindState?.ui?.editorViewMode !== 'source';

export interface AttributeCommandController {
  anchor: { left: number; top: number } | null;
  closePopup: () => void;
  focusedField: 'name' | 'value';
  handleEditorKeyDown: (
    event: KeyboardEvent,
    options: { tagPopupOpen: boolean; walkMode: boolean },
  ) => boolean;
  handlePopupKeyDown: (event: React.KeyboardEvent) => void;
  highlightedIndex: number;
  nameFilter: string;
  open: boolean;
  openPopup: (anchorOverride?: { left: number; top: number } | null) => Promise<boolean>;
  schemaAttributes: SchemaAttributeDetail[];
  setFocusedField: (field: 'name' | 'value') => void;
  setHighlightedIndex: (index: number) => void;
  setNameFilter: (value: string) => void;
  setValueFilter: (value: string) => void;
  tagElement: Element | null;
  tagName: string;
  /** The name box holds a remembered attribute the user has not typed over yet. */
  nameIsPrefill: boolean;
  valueFilter: string;
  valueHighlightedIndex: number;
  valueSuggestions: string[];
}

export const useAttributeCommandController = (): AttributeCommandController => {
  const { t } = useTranslation();
  const { rootPath, activeTabPath } = useAppState().project;
  const { notifyViaSnackbar } = useActions().ui;

  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ left: number; top: number } | null>(null);
  const [tagElement, setTagElement] = useState<Element | null>(null);
  const [tagName, setTagName] = useState('');
  const [nameFilter, setNameFilterRaw] = useState('');
  // False while the name box shows a prefilled or arrow-selected name: the list stays unfiltered.
  const [nameFilterActive, setNameFilterActive] = useState(true);
  const [valueFilter, setValueFilterRaw] = useState('');
  const [valueHighlightedIndex, setValueHighlightedIndex] = useState(-1);
  const [valueNavigated, setValueNavigated] = useState(false);
  const [focusedField, setFocusedField] = useState<'name' | 'value'>('name');
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [schemaAttributes, setSchemaAttributes] = useState<SchemaAttributeDetail[]>([]);
  const [stats, setStats] = useState<Awaited<ReturnType<typeof loadTagStats>> | null>(null);

  const applyingRef = useRef(false);

  const setNameFilter = useCallback((value: string) => {
    setNameFilterRaw(value);
    setNameFilterActive(true);
  }, []);

  const setValueFilter = useCallback((value: string) => {
    setValueFilterRaw(value);
    setValueNavigated(false);
    setValueHighlightedIndex(value.trim() ? 0 : -1);
  }, []);

  const effectiveNameFilter = nameFilterActive ? nameFilter : '';

  useEffect(() => {
    if (!rootPath) return;
    void loadTagStats(rootPath).then(setStats);
  }, [rootPath]);

  const refreshStatsForActiveFile = useCallback(async () => {
    if (!rootPath || !activeTabPath) return;
    let xml = '';
    if (window.writer?.overmindState?.ui?.editorViewMode === 'source') {
      xml =
        window.writer.overmindState.ui.sourceCurrentContent ||
        window.__desktopStoredDocumentXml ||
        '';
    } else if (window.writer?.getContent) {
      try {
        xml = (await window.writer.getContent()) || '';
      } catch {
        xml = window.__desktopStoredDocumentXml || '';
      }
    }
    if (!xml) return;
    const next = await updateTagStatsForFile(rootPath, activeTabPath, xml);
    setStats(next);
  }, [activeTabPath, rootPath]);

  const visibleAttributes = useMemo(
    () =>
      orderAttributeSuggestions(
        filterAttributeSuggestions(schemaAttributes, effectiveNameFilter),
        tagName,
        stats,
        effectiveNameFilter,
      ),
    [effectiveNameFilter, schemaAttributes, stats, tagName],
  );

  const highlightedAttribute = visibleAttributes[highlightedIndex] ?? null;

  const valueSuggestions = useMemo(() => {
    const attr = resolveAttributeNameForApply(schemaAttributes, nameFilter, highlightedAttribute);
    if (!attr?.name || !stats || !tagName) return [];
    return rankAttributeValues(
      suggestAttributeValues(tagName, attr.name, stats, attr.choices),
      valueFilter,
    );
  }, [highlightedAttribute, nameFilter, schemaAttributes, stats, tagName, valueFilter]);

  const highlightedValue =
    valueHighlightedIndex >= 0 ? (valueSuggestions[valueHighlightedIndex] ?? null) : null;

  useEffect(() => {
    setHighlightedIndex(0);
  }, [effectiveNameFilter]);

  const closePopup = useCallback(() => {
    setOpen(false);
    setNameFilterRaw('');
    setNameFilterActive(true);
    setValueFilterRaw('');
    setValueHighlightedIndex(-1);
    setValueNavigated(false);
    setFocusedField('name');
    setHighlightedIndex(0);
    setTagElement(null);
    setTagName('');
  }, []);

  const loadSchemaForTag = useCallback(
    async (element: Element) => {
      const attrs = await fetchSchemaAttributes(element);
      const sorted = stats
        ? orderAttributeSuggestions(attrs, element.getAttribute('_tag') ?? '', stats, '')
        : attrs;
      setSchemaAttributes(sorted);

      // Offer the attribute added last, selected so typing replaces it.
      const prefill = pickPrefillAttributeName(sorted, element.getAttribute('_tag') ?? '');
      if (prefill) {
        setNameFilterRaw(prefill);
        setNameFilterActive(false);
        setHighlightedIndex(
          Math.max(
            0,
            sorted.findIndex((attr) => attr.name === prefill),
          ),
        );
      } else {
        setHighlightedIndex(0);
      }
    },
    [stats],
  );

  const openPopup = useCallback(
    async (anchorOverride?: { left: number; top: number } | null) => {
      if (!isVisualEditorActive()) return false;

      const ctx = getEditorTagContext();
      const element = ctx?.tagElement;
      if (!element) {
        notifyViaSnackbar({
          message: t('LWC.desktop.tagging.place_caret_in_tag'),
          options: { variant: 'info' },
        });
        return true;
      }

      const name = element.getAttribute('_tag') ?? '';
      setTagElement(element);
      setTagName(name);
      setNameFilterRaw('');
      setNameFilterActive(true);
      setValueFilterRaw('');
      setValueHighlightedIndex(-1);
      setValueNavigated(false);
      setFocusedField('name');
      setHighlightedIndex(0);
      setAnchor(getCaretScreenPosition(anchorOverride));
      setOpen(true);
      await loadSchemaForTag(element);
      window.writer?.layoutManager?.showModule('attributes');
      return true;
    },
    [loadSchemaForTag, notifyViaSnackbar, t],
  );

  const commitAttribute = useCallback(
    async (valueOverride?: string) => {
      if (applyingRef.current || !tagElement) return;

      const attr = resolveAttributeNameForApply(schemaAttributes, nameFilter, highlightedAttribute);
      if (!attr) {
        notifyViaSnackbar({
          message: nameFilter.trim()
            ? `Attribute "${nameFilter.trim()}" is not valid here.`
            : 'Enter an attribute name.',
          options: { variant: 'info' },
        });
        return;
      }

      applyingRef.current = true;
      try {
        const result = applyAttributeToTag(tagElement, attr.name, valueOverride ?? valueFilter);
        if (!result.applied) {
          if (result.error) {
            notifyViaSnackbar({ message: result.error, options: { variant: 'warning' } });
          }
          return;
        }
        rememberLastAttribute(tagName, attr.name);
        await refreshStatsForActiveFile();
        closePopup();
      } finally {
        applyingRef.current = false;
      }
    },
    [
      highlightedAttribute,
      nameFilter,
      notifyViaSnackbar,
      refreshStatsForActiveFile,
      schemaAttributes,
      tagElement,
      tagName,
      valueFilter,
      closePopup,
    ],
  );

  const handlePopupKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (isImeKeyboardEvent(event)) return;

      if (event.key === 'Escape') {
        event.preventDefault();
        closePopup();
        return;
      }

      if (event.key === 'Tab' && !event.shiftKey) {
        event.preventDefault();
        if (focusedField === 'name') {
          const attr = resolveAttributeNameForApply(
            schemaAttributes,
            nameFilter,
            highlightedAttribute,
          );
          if (attr) setNameFilter(attr.name);
          setFocusedField('value');
        } else if (highlightedValue !== null && highlightedValue !== valueFilter) {
          // Complete the value to the highlighted suggestion.
          setValueFilter(highlightedValue);
        }
        return;
      }

      if (event.key === 'Tab' && event.shiftKey) {
        event.preventDefault();
        setFocusedField('name');
        return;
      }

      if (event.key === 'Enter' || event.key === 'NumpadEnter') {
        event.preventDefault();
        // A suggestion chosen with the arrow keys is used; merely typed text stays as typed.
        const chosen = focusedField === 'value' && valueNavigated ? highlightedValue : null;
        void commitAttribute(chosen ?? undefined);
        return;
      }

      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;

      if (focusedField === 'name') {
        const next = Math.min(Math.max(highlightedIndex + step, 0), visibleAttributes.length - 1);
        setHighlightedIndex(next);
        // Show the selection in the box, without narrowing the list to it.
        const attr = visibleAttributes[next];
        if (attr && !nameFilterActive) setNameFilterRaw(attr.name);
        return;
      }

      if (valueSuggestions.length === 0) return;
      setValueNavigated(true);
      setValueHighlightedIndex((current) =>
        Math.min(Math.max(current + step, 0), valueSuggestions.length - 1),
      );
    },
    [
      closePopup,
      commitAttribute,
      focusedField,
      highlightedAttribute,
      highlightedIndex,
      highlightedValue,
      nameFilter,
      nameFilterActive,
      schemaAttributes,
      setNameFilter,
      setValueFilter,
      valueFilter,
      valueNavigated,
      valueSuggestions.length,
      visibleAttributes,
    ],
  );

  const handleEditorKeyDown = useCallback(
    (event: KeyboardEvent, options: { tagPopupOpen: boolean; walkMode: boolean }): boolean => {
      if (isImeKeyboardEvent(event) || !isVisualEditorActive()) return false;
      if (options.tagPopupOpen || options.walkMode) return false;

      if (open) {
        return false;
      }

      if (matchesEditorAttribute(event)) {
        event.preventDefault();
        void openPopup();
        return true;
      }

      return false;
    },
    [open, openPopup],
  );

  return {
    anchor,
    closePopup,
    focusedField,
    handleEditorKeyDown,
    handlePopupKeyDown,
    highlightedIndex,
    nameFilter,
    open,
    openPopup,
    schemaAttributes: visibleAttributes,
    setFocusedField,
    setHighlightedIndex,
    nameIsPrefill: !nameFilterActive && nameFilter !== '',
    setNameFilter,
    setValueFilter,
    tagElement,
    tagName,
    valueFilter,
    valueHighlightedIndex,
    valueSuggestions,
  };
};
