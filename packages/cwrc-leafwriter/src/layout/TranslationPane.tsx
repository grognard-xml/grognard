import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  ListSubheader,
  Menu,
  MenuItem,
  Popover,
  Select,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import FormatBoldIcon from '@mui/icons-material/FormatBold';
import FormatClearIcon from '@mui/icons-material/FormatClear';
import FormatItalicIcon from '@mui/icons-material/FormatItalic';
import FormatQuoteIcon from '@mui/icons-material/FormatQuote';
import FormatStrikethroughIcon from '@mui/icons-material/FormatStrikethrough';
import FormatUnderlinedIcon from '@mui/icons-material/FormatUnderlined';
import LinkIcon from '@mui/icons-material/Link';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import RefreshIcon from '@mui/icons-material/Refresh';
import SettingsIcon from '@mui/icons-material/Settings';
import SpellcheckIcon from '@mui/icons-material/Spellcheck';
import FactCheckIcon from '@mui/icons-material/FactCheck';
import StickyNote2Icon from '@mui/icons-material/StickyNote2';
import SubscriptIcon from '@mui/icons-material/Subscript';
import SuperscriptIcon from '@mui/icons-material/Superscript';
import TextFieldsIcon from '@mui/icons-material/TextFields';
import PersonOutlineIcon from '@mui/icons-material/PersonOutline';
import { ZoteroIcon } from '../components/icons/ZoteroIcon';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type SyntheticEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { copyUnitsForExport } from '../js/conversion/copyForExport';
import { translationFontZoom } from '../js/fontSizeZoom';
import { useActions, useAppState } from '../overmind';
import { isMacOS } from '../utils/platform';
import {
  applyTextContentReplacement,
  shiftLanguageToolMatchViews,
  type LanguageToolMatchView,
} from './languageToolApply';
import { collectMatchOverlayRects, type TextRangeRect } from './languageToolOverlays';
import {
  FN_BODY_ATTR,
  FN_MARK_ATTR,
  flattenFootnoteNotesForPersist,
  footnoteBodyHtml,
  footnoteBodyOf,
  normalizeFootnoteNotes,
} from './translationFootnotes';
import { convertMarkdownInXmlFragment, looksLikeInlineMarkdown } from './markdownToTei';
import {
  buildPlaceholderRetryInstruction,
  missingPlaceholders,
} from './entityFields/aiPlaceholderGuard';
import {
  collectEntitiesFromSourceUnitXml,
  fetchEntitySummary,
  replaceEntitiesWithPlaceholdersInSourceXml,
  searchEntitiesForPicker,
  substituteOpaquePlaceholders,
  type EntityPickerSearchHit,
  type OpaqueEntityHit,
} from './entityFields/sourceUnitEntities';
import {
  collectMentionsFromSourceUnitXml,
  resolveMentionsWithEntities,
  isCharacterOnlyTranslationTarget,
  deriveDisplaySpec,
  type MentionContext,
} from './entityFields/mentionContext';
import { substituteMentionPlaceholders } from './entityFields/mentionSubstitute';
import { dateFormatSettingsForLang } from './entityFields/dateFormatSettings';
import {
  buildCjkMentionParts,
  buildWesternMentionParts,
  mentionPartsToPlainPreview,
} from './entityFields/mentionRender';
import {
  countPriorEntityRefsInDocument,
  fileOccurrenceIndexForUnitInsert,
} from './entityFields/fileWideOccurrence';
import {
  collectDatesFromSourceUnitXml,
  collectSourceUnitDates,
  replaceDatesWithPlaceholdersInSourceXml,
  type SourceUnitDateHit,
} from './entityFields/sourceUnitDates';
import {
  collectNotesFromSourceUnitXml,
  replaceNotesWithPlaceholdersInSourceXml,
} from './entityFields/sourceUnitNotes';
import type { DateGlossInput } from './entityFields/dateGloss';
import { autoRomanize } from '../utilities/romanize';
import {
  adjustDatePrepositionsBeforeDateFields,
  adjustDatePrepositionsInText,
  ensureDatePrepositionsBeforeDateFields,
  ensureDatePrepositionsInText,
  dayLevelByDateIndex,
} from './entityFields/adjustDatePrepositions';
import { normalizeAiPlaceholders } from './entityFields/normalizeAiPlaceholders';
import { entityStoreFromDesktop } from '../autoTagging/entityStore';
import { clearOfficeGlossIndexCaches } from '../autoTagging/officeGlossLookup';
import {
  buildSuggestionsAtCaret,
  candidateFromMention,
  caretAnchorPosition,
  type EntityAutocompleteCandidate,
  type EntityAutocompleteSuggestion,
} from './entityFields/entityAutocomplete';
import {
  ENTITY_DISPLAY_FORMAT_ATTR,
  ENTITY_DISPLAY_SPEC_ATTR,
  ENTITY_FIELD_ATTR,
  ENTITY_REF_TYPE,
  ENTITY_WORK_STYLE_ATTR,
  createEntityFieldElement,
  createMentionFieldElement,
  prepareAtomicEntityFields,
  recalculateAllEntityFieldsInRoot,
  recalculateEntityFieldsInRoot,
  readDisplaySpecFromField,
  writeDisplaySpecToField,
} from './entityFields/translationEntityFields';
import {
  createDateFieldElement,
  prepareAtomicDateFields,
  recalculateDateFieldsInRoot,
} from './entityFields/translationDateFields';
import {
  EMPTY_DISPLAY_SPEC,
  chineseNameOf,
  entityKindSupportsVernacularGloss,
  type EntityDisplaySpec,
} from './entityFields/entityDisplay';
import type { EntitySummary } from './entityFields/entitySummary';
import { EntityDisplayPopup } from './entityFields/EntityDisplayPopup';
import { TRANSLATION_POLICY_CHANGED_EVENT } from './entityFields/dateFormatSettings';
import { SCHOLARLY_CONVENTIONS_CHANGED_EVENT } from './entityFields/scholarlyConventions';
import {
  applyEditorialCleanupToRoot,
  applyEditorialCleanupToRootPreservingSelection,
} from './translationEditorialCleanup';
import {
  collectTranslationUnitCards,
  footnoteStartIndexForUnit,
  isTranslationUnitBlank,
} from './translationUnitCards';
import {
  GLYPH_SELECTOR,
  insertTranslationGlyphFromDataUrl,
  insertTranslationGlyphFromImageFile,
  insertTranslationGlyphFromRemoteImageUrl,
  prepareAtomicGlyphFields,
  translationGlyphImageUnavailableReason,
} from './translationGlyphs';
import {
  getClipboardImageFile,
  getDraggedImageDataUrl,
  getDraggedImageUrl,
  getDroppedImageFile,
  hasUnreadableDraggedImage,
} from '../utilities/clipboardImage';
import { isAiUiFeatureEnabled } from '../autoTagging/aiUiFeatures';
import {
  finishAiRunProgress,
  startAiRunProgress,
  updateAiRunProgress,
} from '../autoTagging/aiRunProgress';

const TEI_NS = 'http://www.tei-c.org/ns/1.0';
const SPELLCHECK_STORAGE_KEY = 'leafWriterTranslationSpellcheck';

const readSpellcheckEnabled = (): boolean => {
  try {
    const stored = window.localStorage.getItem(SPELLCHECK_STORAGE_KEY);
    if (stored === null) return true;
    return stored === '1' || stored === 'true';
  } catch {
    return true;
  }
};

const writeSpellcheckEnabled = (enabled: boolean): void => {
  try {
    window.localStorage.setItem(SPELLCHECK_STORAGE_KEY, enabled ? '1' : '0');
  } catch {
    // Ignore quota / private-mode failures; the in-memory toggle still works.
  }
};

const getElementsByLocalName = (root: Document | Element, localName: string): Element[] => {
  const namespaced = Array.from(root.getElementsByTagNameNS(TEI_NS, localName));
  const plain = Array.from(root.getElementsByTagName(localName));
  const seen = new Set<Element>();
  const result: Element[] = [];
  for (const element of [...namespaced, ...plain]) {
    if (!seen.has(element)) {
      seen.add(element);
      result.push(element);
    }
  }
  return result;
};

const findUnitByCorrespId = (
  doc: Document,
  alignmentUnit: 'div' | 'p' | 'ab',
  sourceFileName: string,
  unitId: string,
): Element | null => {
  const expected = `${sourceFileName}#${unitId}`;
  return (
    getElementsByLocalName(doc, alignmentUnit).find(
      (element) => element.getAttribute('corresp') === expected,
    ) ?? null
  );
};

const fileNameOf = (filePath: string): string => {
  const idx = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  return idx === -1 ? filePath : filePath.slice(idx + 1);
};

const ACTIVE_SOURCE_UNIT_CLASS = 'grognard-translation-active-unit';

/** Looks up the tagger's schema id attribute name (xml:id or id), matching attributeIdHelpers.ts. */
const getSchemaIdAttributeName = (): string =>
  window.writer?.schemaManager?.getIdName?.() ?? 'xml:id';

/**
 * Find a source alignment unit in the TinyMCE body without XPath.
 * `@xml:id` in document.evaluate() throws NamespaceError in the HTML editor doc
 * (the `xml:` prefix is unresolvable), and CWRC's xpath rewriter also mangles `//*`.
 */
const findSourceUnitElement = (body: HTMLElement, unitId: string): Element | null => {
  const schemaId = getSchemaIdAttributeName();
  const fromTagger = Array.from(body.querySelectorAll('[_tag]')).find((el) => {
    const attrs = window.writer?.tagger?.getAttributesForTag?.(el as Element) ?? {};
    const id = attrs[schemaId] ?? (schemaId !== 'id' ? attrs.id : undefined);
    return id === unitId;
  });
  if (fromTagger) return fromTagger;

  return (
    (body.querySelector(`[xml\\:id="${CSS.escape(unitId)}"]`) as Element | null) ??
    (body.querySelector(`[id="${CSS.escape(unitId)}"]`) as Element | null) ??
    (body.querySelector(`#${CSS.escape(unitId)}`) as Element | null)
  );
};

/** Select the source alignment unit in TinyMCE and broadcast NodeChange (same as Find jump). */
const selectSourceUnitInEditor = (unitId: string): boolean => {
  const writer = window.writer as
    | {
        editor?: {
          getBody?: () => HTMLElement | null;
          nodeChanged?: () => void;
        };
        utilities?: {
          getElementXPath?: (element: Element) => string | null;
          selectNode?: (
            target: { xpath: string },
            scrollIntoView?: boolean,
            focusEditor?: boolean,
          ) => void;
        };
      }
    | undefined;
  if (!writer?.editor || !writer.utilities?.getElementXPath || !writer.utilities.selectNode) {
    return false;
  }

  const body = writer.editor.getBody?.();
  if (!body) return false;

  const node = findSourceUnitElement(body, unitId);
  if (!node) return false;

  const xpath = writer.utilities.getElementXPath(node);
  if (!xpath) return false;
  writer.utilities.selectNode({ xpath }, false, false);
  writer.editor.nodeChanged?.();
  return true;
};

const markActiveSourceUnit = (unitId: string | null): void => {
  const body = window.writer?.editor?.getBody?.();
  if (!body) return;
  for (const el of Array.from(body.querySelectorAll(`.${ACTIVE_SOURCE_UNIT_CLASS}`))) {
    el.classList.remove(ACTIVE_SOURCE_UNIT_CLASS);
  }
  if (!unitId) return;
  findSourceUnitElement(body, unitId)?.classList.add(ACTIVE_SOURCE_UNIT_CLASS);
};

interface DesktopElectronApi {
  generateAiTranslation?: (request: {
    alignmentUnit: 'div' | 'p' | 'ab' | 'note';
    sourceUnitXml: string;
    targetLanguage: string;
    /** Id + kind only — never names, or the model expands placeholders. */
    entities?: {
      id: string;
      kind: string;
    }[];
    /** Index only — gloss/surface stay local for post-substitute. */
    dates?: {
      index: number;
    }[];
    /** Set on a second attempt when the first reply dropped placeholders. */
    retryInstruction?: string;
  }) => Promise<{ error?: string; ok: boolean; translationXml?: string }>;
  getAiApiSettings?: () => Promise<{
    placeholderRetryLimit?: number;
  }>;
  suggestEntityGloss?: (request: {
    kind: string;
    primaryName: string | null;
    romanizedName: string | null;
    chineseName?: string | null;
    description?: string | null;
    targetLanguage: string;
  }) => Promise<{ error?: string; ok: boolean; gloss?: string }>;
  readFile?: (filePath: string) => Promise<string>;
  writeFile?: (filePath: string, content: string) => Promise<void>;
}

interface TranslationLanguageState {
  indexing: boolean;
  languages: { code: string; label: string }[];
  projectSourceLang: string | null;
  selectedLang: string;
  setSelectedLang: (lang: string) => void;
}

interface CslJsonItem {
  id: string | number;
  type: string;
  title?: string;
  author?: { family?: string; given?: string; literal?: string }[];
  issued?: { 'date-parts'?: (string | number)[][]; literal?: string };
  [key: string]: unknown;
}

interface BiblEntry {
  id: string;
  uri: string;
  csl: CslJsonItem;
}

interface ZoteroCaywPick {
  uri: string;
  csl: CslJsonItem;
  locator?: string;
  label?: string;
  prefix?: string;
  suffix?: string;
}

type ZoteroCaywResult =
  { ok: true; picks: ZoteroCaywPick[] } | { ok: false; cancelled: boolean; error?: string };

interface DesktopCitationBridge {
  chipLabel: (item: CslJsonItem) => string;
  renderCitation: (options: {
    item: CslJsonItem;
    styleId?: string;
    lang?: string;
    locator?: string;
    locatorType?: string;
    prefix?: string;
    suffix?: string;
  }) => string;
  upsertBiblEntry: (doc: Document, item: CslJsonItem, uri: string) => string;
  readBiblEntries: (doc: Document) => Map<string, BiblEntry>;
  garbageCollectBibl: (doc: Document) => void;
  pickZoteroCitation: () => Promise<ZoteroCaywResult>;
  getCitationStyleOptions: () => Promise<{
    defaultStyleId: string;
    options: { id: string; label: string }[];
  }>;
  setCitationStyle: (styleId: string) => Promise<boolean>;
}

declare global {
  interface Window {
    __leafWriterTranslationPane?: {
      filePath: string | null;
      isActive: () => boolean;
      redo: () => Promise<boolean>;
      replaceContent: (filePath: string, content: string) => boolean;
      undo: () => Promise<boolean>;
    };
  }
}

const getDesktopApi = (): DesktopElectronApi | undefined =>
  (window as Window & { electronAPI?: DesktopElectronApi }).electronAPI;

const getTranslationLanguageState = (): TranslationLanguageState | null =>
  (
    window as Window & {
      __desktopTranslationLanguageState?: TranslationLanguageState;
    }
  ).__desktopTranslationLanguageState ?? null;

const getCitationBridge = (): DesktopCitationBridge | null =>
  (window as Window & { __desktopCitationBridge?: DesktopCitationBridge })
    .__desktopCitationBridge ?? null;

const prepareAtomicCitationFields = (root: ParentNode, title: string): void => {
  for (const bibl of Array.from(root.querySelectorAll('bibl[type="zotero-ref"]'))) {
    bibl.setAttribute('contenteditable', 'false');
    bibl.setAttribute('data-leaf-citation-field', 'true');
    bibl.setAttribute('title', title);
  }
  prepareAtomicEntityFields(root);
  prepareAtomicDateFields(root);
};

const stripInvisibleCaretSpacers = (root: ParentNode): void => {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let node: Node | null;

  while ((node = walker.nextNode())) {
    const textNode = node as Text;
    if (textNode.textContent?.includes('\uFEFF') || textNode.textContent?.includes('\u200B')) {
      textNodes.push(textNode);
    }
  }

  for (const textNode of textNodes) {
    textNode.textContent =
      textNode.textContent?.replace(/\uFEFF/g, '').replace(/\u200B/g, '') ?? '';
  }
};

const EDITING_ONLY_ATTRIBUTES = new Set([
  'class',
  'contenteditable',
  'face',
  'size',
  'style',
  'title',
]);
const WRAPPER_ELEMENTS = new Set(['div', 'font', 'p', 'span']);
const TEI_INLINE_ELEMENTS = new Set([
  'b',
  'bibl',
  'br',
  'graphic',
  'hi',
  'i',
  'lb',
  'note',
  'ref',
  's',
  'strike',
  'sub',
  'sup',
  'u',
]);

const sanitizeTranslationFragment = (root: ParentNode, title: string): void => {
  for (const element of Array.from(root.querySelectorAll('*'))) {
    for (const attr of Array.from(element.attributes)) {
      const attrName = attr.name.toLowerCase();
      if (
        EDITING_ONLY_ATTRIBUTES.has(attrName) ||
        (attrName.startsWith('data-') &&
          attrName !== 'data-locator' &&
          attrName !== 'data-locator-type' &&
          attrName !== 'data-prefix' &&
          attrName !== 'data-suffix' &&
          attrName !== ENTITY_DISPLAY_FORMAT_ATTR &&
          attrName !== ENTITY_DISPLAY_SPEC_ATTR)
      ) {
        element.removeAttribute(attr.name);
      }
    }

    const tagName = element.tagName.toLowerCase();
    if (WRAPPER_ELEMENTS.has(tagName) || !TEI_INLINE_ELEMENTS.has(tagName)) {
      const parent = element.parentNode;
      if (!parent) continue;
      while (element.firstChild) parent.insertBefore(element.firstChild, element);
      parent.removeChild(element);
    }
  }

  prepareAtomicCitationFields(root, title);
};

const unwrapElementsByTagName = (root: ParentNode, tagName: string): void => {
  for (const element of Array.from(root.querySelectorAll(tagName))) {
    const parent = element.parentNode;
    if (!parent) continue;
    while (element.firstChild) parent.insertBefore(element.firstChild, element);
    parent.removeChild(element);
  }
};

const findUnitById = (
  doc: Document,
  alignmentUnit: 'div' | 'p' | 'ab',
  unitId: string,
): Element | null =>
  getElementsByLocalName(doc, alignmentUnit).find((element) => {
    return element.getAttribute('xml:id') === unitId || element.getAttribute('id') === unitId;
  }) ?? null;

const getXmlParseError = (doc: Document): string | null => {
  const error = doc.getElementsByTagName('parsererror')[0];
  return error?.textContent?.trim() || null;
};

const parseTranslationDocument = (xml: string): Document | null => {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  return getXmlParseError(doc) ? null : doc;
};

const serializeSourceUnit = (
  sourceXml: string,
  alignmentUnit: 'div' | 'p' | 'ab',
  unitId: string,
): { error?: string; xml?: string } => {
  const doc = new DOMParser().parseFromString(sourceXml, 'application/xml');
  const parseError = getXmlParseError(doc);
  if (parseError) return { error: 'Source XML could not be parsed.' };

  const unit = findUnitById(doc, alignmentUnit, unitId);
  if (!unit) return { error: `Could not find source ${alignmentUnit} ${unitId}.` };

  return { xml: new XMLSerializer().serializeToString(unit) };
};

const ALLOWED_GENERATED_TAGS = new Set(['b', 'i', 'u', 's', 'strike', 'sup', 'sub', 'hi']);
const ALLOWED_HI_REND = new Set(['bold', 'italic', 'underline', 'strikethrough', 'small-caps']);

const validateGeneratedFragment = (fragmentXml: string): { error?: string; xml?: string } => {
  const wrapped = `<fragment>${fragmentXml}</fragment>`;
  const doc = new DOMParser().parseFromString(wrapped, 'application/xml');
  const parseError = getXmlParseError(doc);
  if (parseError) {
    console.error(
      '[translation] AI fragment failed XML parsing.\nParser error:',
      parseError,
      '\nFragment length:',
      fragmentXml.length,
      '\nFragment:',
      fragmentXml,
    );
    const firstLine = parseError.split('\n')[0] ?? parseError;
    return { error: `AI returned XML that is not well formed (${firstLine}).` };
  }

  const root = doc.documentElement;
  const elementChildren = Array.from(root.children);
  const contentRoot =
    elementChildren.length === 1 &&
    (elementChildren[0]!.tagName === 'p' ||
      elementChildren[0]!.tagName === 'div' ||
      elementChildren[0]!.tagName === 'ab')
      ? elementChildren[0]!
      : root;

  for (const element of Array.from(contentRoot.getElementsByTagName('*'))) {
    const tag = element.tagName;
    if (!ALLOWED_GENERATED_TAGS.has(tag)) {
      return { error: `AI returned unsupported tag <${tag}>.` };
    }
    for (const attr of Array.from(element.attributes)) {
      if (tag === 'hi' && attr.name === 'rend' && ALLOWED_HI_REND.has(attr.value)) continue;
      return { error: `AI returned unsupported attribute ${attr.name} on <${tag}>.` };
    }
  }

  return {
    xml: Array.from(contentRoot.childNodes)
      .map((node) => new XMLSerializer().serializeToString(node))
      .join(''),
  };
};

interface BlindedUnitTranslationRequest {
  alignmentUnit: 'div' | 'p' | 'ab' | 'note';
  sourceUnitXml: string;
  targetLanguage: string;
  mentions?: { index: number; kind: string }[];
  dates?: { index: number }[];
}

/**
 * Run one blinded-XML translation request, resending (up to `retryLimit`
 * times) whenever the model drops a required `{{…}}` placeholder. Shared by
 * the main-unit call and each independent per-note call in
 * `generateTranslation` — returns the raw (not yet validated/substituted)
 * `translationXml`.
 */
const translateBlindedUnitXml = async (
  api: DesktopElectronApi,
  payload: BlindedUnitTranslationRequest,
  retryLimit: number,
): Promise<{ xml: string } | { error: string }> => {
  const runAi = (retryInstruction?: string) =>
    api.generateAiTranslation!({
      ...payload,
      ...(retryInstruction ? { retryInstruction } : {}),
    });

  const first = await runAi();
  if (!first.ok || !first.translationXml) {
    return { error: first.error ?? 'AI did not return a translation.' };
  }

  let translationXml = first.translationXml;
  let missing = missingPlaceholders(payload.sourceUnitXml, translationXml);
  let retriesUsed = 0;
  while (missing.length > 0 && retriesUsed < retryLimit) {
    retriesUsed += 1;
    console.warn(
      `[translation] AI omitted placeholders; retry ${retriesUsed}/${retryLimit}`,
      missing,
    );
    const retry = await runAi(buildPlaceholderRetryInstruction(missing));
    if (!retry.ok || !retry.translationXml) break;
    const stillMissing = missingPlaceholders(payload.sourceUnitXml, retry.translationXml);
    // Keep the retry only if it improves or fully repairs the inventory.
    if (stillMissing.length < missing.length || stillMissing.length === 0) {
      translationXml = retry.translationXml;
      missing = stillMissing;
    } else {
      break;
    }
  }
  if (missing.length > 0) {
    console.warn('[translation] placeholders still missing after retries', {
      missing,
      retriesUsed,
      retryLimit,
    });
  }

  return { xml: translationXml };
};

/** After schema validation, turn leftover **markdown** in text nodes into <hi>. */
const applyMarkdownCleanupToFragment = (fragmentXml: string): string => {
  const wrapped = `<fragment>${fragmentXml}</fragment>`;
  const doc = new DOMParser().parseFromString(wrapped, 'text/html');
  const root = doc.body.querySelector('fragment') ?? doc.body;
  convertMarkdownInXmlFragment(root as Element);
  // Prefer the fragment wrapper children when present.
  const fragment = doc.body.querySelector('fragment');
  const source = fragment ?? doc.body;
  return Array.from(source.childNodes)
    .map((node) => {
      if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
      if (node.nodeType === Node.ELEMENT_NODE) {
        return (node as Element).outerHTML;
      }
      return '';
    })
    .join('');
};

const DATE_PLACEHOLDER_RE = /\{\{date:(\d+)\}\}/g;

/** @see mentionSubstitute.substituteEntityPlaceholders */
export {
  substituteEntityPlaceholders,
  substituteMentionPlaceholders,
} from './entityFields/mentionSubstitute';

/**
 * Replace every `{{date:N}}` placeholder with an atomic `ref[type="grognard-date"]`
 * field whose gloss is computed by LJBtero (`formatDateGlossTokens`), never
 * by the LLM. N is the 0-based index from `collectDatesFromSourceUnitXml`.
 */
export const substituteDatePlaceholders = (
  fragmentXml: string,
  dates: Map<number, DateGlossInput>,
  lang?: string | null,
): string => {
  const dayLevels = dayLevelByDateIndex(dates);
  const cleanedFragment = ensureDatePrepositionsInText(
    adjustDatePrepositionsInText(normalizeAiPlaceholders(fragmentXml), dayLevels, lang),
    dayLevels,
    lang,
  );
  if (!cleanedFragment.includes('{{date:')) return cleanedFragment;

  const wrapped = `<fragment>${cleanedFragment}</fragment>`;
  const doc = new DOMParser().parseFromString(wrapped, 'text/html');
  const root = doc.body.querySelector('fragment') ?? doc.body;

  const textNodes: Text[] = [];
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node: Node | null;

  while ((node = walker.nextNode())) {
    if ((node.textContent ?? '').includes('{{date:')) textNodes.push(node as Text);
  }

  for (const textNode of textNodes) {
    const text = ensureDatePrepositionsInText(
      adjustDatePrepositionsInText(
        normalizeAiPlaceholders(textNode.textContent ?? ''),
        dayLevels,
        lang,
      ),
      dayLevels,
      lang,
    );
    DATE_PLACEHOLDER_RE.lastIndex = 0;
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    const replacement = doc.createDocumentFragment();
    let sawMatch = false;

    while ((match = DATE_PLACEHOLDER_RE.exec(text))) {
      sawMatch = true;
      if (match.index > lastIndex) {
        replacement.appendChild(doc.createTextNode(text.slice(lastIndex, match.index)));
      }
      const index = parseInt(match[1]!, 10);
      const input = dates.get(index);
      if (input) {
        const field = createDateFieldElement(input, lang);
        replacement.appendChild(field);
      } else {
        console.warn('[translation] AI date placeholder had no matching date:', index);
        replacement.appendChild(doc.createTextNode(match[0]));
      }
      lastIndex = DATE_PLACEHOLDER_RE.lastIndex;
    }
    if (!sawMatch) continue;
    if (lastIndex < text.length) {
      replacement.appendChild(doc.createTextNode(text.slice(lastIndex)));
    }
    textNode.parentNode?.replaceChild(replacement, textNode);
  }

  adjustDatePrepositionsBeforeDateFields(root, lang);
  ensureDatePrepositionsBeforeDateFields(root, lang);
  return root.innerHTML;
};

const NOTE_PLACEHOLDER_RE = /\{\{note:(\d+)\}\}/g;

/**
 * Replace every `{{note:N}}` placeholder with a real `<note place="foot">`
 * element carrying that note's own (independently translated and already
 * entity/date-substituted) HTML. `normalizeFootnoteNotes` — already wired to
 * run whenever the unit's HTML changes — picks these up and numbers/wraps
 * them exactly like a manually inserted footnote.
 */
export const substituteNotePlaceholders = (
  fragmentXml: string,
  notes: Map<number, string>,
): string => {
  const cleanedFragment = normalizeAiPlaceholders(fragmentXml);
  if (!cleanedFragment.includes('{{note:')) return cleanedFragment;

  const wrapped = `<fragment>${cleanedFragment}</fragment>`;
  const doc = new DOMParser().parseFromString(wrapped, 'text/html');
  const root = doc.body.querySelector('fragment') ?? doc.body;

  const textNodes: Text[] = [];
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node: Node | null;

  while ((node = walker.nextNode())) {
    if ((node.textContent ?? '').includes('{{note:')) textNodes.push(node as Text);
  }

  for (const textNode of textNodes) {
    const text = normalizeAiPlaceholders(textNode.textContent ?? '');
    NOTE_PLACEHOLDER_RE.lastIndex = 0;
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    const replacement = doc.createDocumentFragment();
    let sawMatch = false;

    while ((match = NOTE_PLACEHOLDER_RE.exec(text))) {
      sawMatch = true;
      if (match.index > lastIndex) {
        replacement.appendChild(doc.createTextNode(text.slice(lastIndex, match.index)));
      }
      const index = parseInt(match[1]!, 10);
      const html = notes.get(index);
      if (html != null) {
        const note = doc.createElement('note');
        note.setAttribute('place', 'foot');
        note.innerHTML = html;
        replacement.appendChild(note);
      } else {
        console.warn('[translation] AI note placeholder had no matching note:', index);
        replacement.appendChild(doc.createTextNode(match[0]));
      }
      lastIndex = NOTE_PLACEHOLDER_RE.lastIndex;
    }
    if (!sawMatch) continue;
    if (lastIndex < text.length) {
      replacement.appendChild(doc.createTextNode(text.slice(lastIndex)));
    }
    textNode.parentNode?.replaceChild(replacement, textNode);
  }

  return root.innerHTML;
};

interface TextIndex {
  combined: string;
  textNodes: Text[];
  offsets: number[];
}

const buildTextIndex = (container: HTMLElement): TextIndex => {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  const offsets: number[] = [];
  let combined = '';
  let node: Node | null;
  while ((node = walker.nextNode())) {
    offsets.push(combined.length);
    textNodes.push(node as Text);
    combined += node.textContent ?? '';
  }
  return { combined, textNodes, offsets };
};

const locateInIndex = (
  index: TextIndex,
  globalOffset: number,
): { node: Text; offset: number } | null => {
  for (let i = 0; i < index.textNodes.length; i++) {
    const start = index.offsets[i]!;
    const length = index.textNodes[i]!.textContent?.length ?? 0;
    if (globalOffset <= start + length) {
      return { node: index.textNodes[i]!, offset: Math.max(0, globalOffset - start) };
    }
  }
  return null;
};

const selectRange = (index: TextIndex, start: number, end: number): boolean => {
  const startPos = locateInIndex(index, start);
  const endPos = locateInIndex(index, end);
  if (!startPos || !endPos) return false;

  const range = document.createRange();
  range.setStart(startPos.node, startPos.offset);
  range.setEnd(endPos.node, endPos.offset);

  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);

  startPos.node.parentElement?.scrollIntoView({ block: 'center', behavior: 'smooth' });

  return true;
};

/** Selects the exact match a Find hit pointed to, given its decoded-character offset within
 * the unit's own text — correctly distinguishes multiple occurrences of the same text, unlike
 * a plain substring search. Falls back to the first occurrence of `text` when no offset is
 * available (e.g. the match was inside a nested inline tag rather than the unit's own text). */
const selectHighlightedMatch = (
  container: HTMLElement,
  text: string,
  offset: { start: number; end: number } | null,
): boolean => {
  const index = buildTextIndex(container);

  if (offset) {
    if (selectRange(index, offset.start, offset.end)) return true;
    // Offset didn't line up with the currently rendered content (e.g. stale) — fall through.
  }

  if (!text) return false;
  const idx = index.combined.toLowerCase().indexOf(text.toLowerCase());
  if (idx === -1) return false;
  return selectRange(index, idx, idx + text.length);
};

const dateCandidateId = (index: number): string => `date:${index}`;

/**
 * Autocomplete candidate for a Sanmiao date span. The romanization is
 * mechanical (character-by-character pinyin of the raw Chinese date text) and
 * exists only to help the user find the date field while typing — it is never
 * stored on the date field or written anywhere.
 */
const candidateFromDateHit = (hit: SourceUnitDateHit, id: string): EntityAutocompleteCandidate => {
  const aliases = new Set<string>();
  // Spaced form lets a match start mid-string (e.g. typing just the era
  // name); concatenated form lets a match start-anchor across the whole date.
  const romanized = autoRomanize(hit.surface, 'zh');
  const concatenated = autoRomanize(hit.surface, 'zh', { concatenate: true });
  if (romanized) aliases.add(romanized);
  if (concatenated) aliases.add(concatenated);
  if (hit.surface) aliases.add(hit.surface);

  return {
    id,
    kind: 'date',
    label: romanized ?? hit.gloss ?? hit.surface,
    detail: hit.gloss || hit.surface,
    aliases: [...aliases],
  };
};

export const TranslationPane = () => {
  const { t } = useTranslation('LW');
  const mac = isMacOS();
  // This is used by callbacks that also run while the pane is inactive. Keep it
  // initialized before those callbacks so a later active render cannot reuse a
  // closure with an uninitialized binding.
  const zoteroCitationLabel = t('LW.translationPane.formatItems.zoteroCitation');
  const { translationMode } = useAppState().ui;
  const { notifyViaSnackbar, setSelectedTranslationUnit } = useActions().ui;
  const isDesktopShell = typeof window !== 'undefined' && !!window.electronAPI;
  const [desktopToolbarSlot, setDesktopToolbarSlot] = useState<Element | null>(null);

  const syncDesktopToolbarSlot = useCallback(() => {
    if (!isDesktopShell) {
      setDesktopToolbarSlot(null);
      return;
    }
    setDesktopToolbarSlot(document.getElementById('desktop-translation-toolbar-slot'));
  }, [isDesktopShell]);

  useEffect(() => {
    syncDesktopToolbarSlot();
  }, [syncDesktopToolbarSlot, translationMode.active]);

  useEffect(() => {
    if (!isDesktopShell) return;
    const onSlotReady = () => syncDesktopToolbarSlot();
    window.addEventListener('desktop:translation-toolbar-slot-ready', onSlotReady);
    return () => window.removeEventListener('desktop:translation-toolbar-slot-ready', onSlotReady);
  }, [isDesktopShell, syncDesktopToolbarSlot]);

  const [translationDoc, setTranslationDoc] = useState<Document | null>(null);
  const [unitHtml, setUnitHtml] = useState('');
  const [caretInUnindexedUnit, setCaretInUnindexedUnit] = useState(false);
  const [aiStatus, setAiStatus] = useState<{
    message: string;
    severity: 'error' | 'info' | 'success';
  } | null>(null);
  const [generatingUnitId, setGeneratingUnitId] = useState<string | null>(null);
  const generating = generatingUnitId !== null;
  const [languageState, setLanguageState] = useState<TranslationLanguageState | null>(() =>
    getTranslationLanguageState(),
  );
  const selectedLanguage = languageState?.selectedLang || translationMode.lang || '';
  const projectSourceLang = languageState?.projectSourceLang ?? null;
  const [spellcheckEnabled, setSpellcheckEnabled] = useState(() => readSpellcheckEnabled());
  const [languageToolEnabled, setLanguageToolEnabled] = useState(false);
  const [languageToolLive, setLanguageToolLive] = useState(false);
  const [languageToolChecking, setLanguageToolChecking] = useState(false);
  const [languageToolMatches, setLanguageToolMatches] = useState<LanguageToolMatchView[]>([]);
  const [languageToolSnapshot, setLanguageToolSnapshot] = useState<string | null>(null);
  const [languageToolOverlays, setLanguageToolOverlays] = useState<TextRangeRect[]>([]);
  const [languageToolStatus, setLanguageToolStatus] = useState<{
    message: string;
    severity: 'error' | 'info' | 'success';
  } | null>(null);
  const languageToolSeqRef = useRef(0);
  const languageToolDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [formatAnchor, setFormatAnchor] = useState<HTMLElement | null>(null);
  const [zoteroMenuAnchor, setZoteroMenuAnchor] = useState<HTMLElement | null>(null);
  const [aiMenuAnchor, setAiMenuAnchor] = useState<HTMLElement | null>(null);
  const [entityMenuAnchor, setEntityMenuAnchor] = useState<HTMLElement | null>(null);
  const [sourceMentions, setSourceMentions] = useState<MentionContext[]>([]);
  const [entityPickerQuery, setEntityPickerQuery] = useState('');
  const [entityPickerResults, setEntityPickerResults] = useState<EntityPickerSearchHit[]>([]);
  const [entityPickerSearching, setEntityPickerSearching] = useState(false);
  const entityPickerSearchSeqRef = useRef(0);
  const [entityAcCandidates, setEntityAcCandidates] = useState<EntityAutocompleteCandidate[]>([]);
  const [entityAcSuggestions, setEntityAcSuggestions] = useState<EntityAutocompleteSuggestion[]>(
    [],
  );
  const [entityAcIndex, setEntityAcIndex] = useState(0);
  const [entityAcAnchor, setEntityAcAnchor] = useState<{ top: number; left: number } | null>(null);
  const entityAcCandidatesRef = useRef<EntityAutocompleteCandidate[]>([]);
  entityAcCandidatesRef.current = entityAcCandidates;
  /** Maps a date candidate's synthetic id back to its source-unit hit (not persisted anywhere). */
  const dateAcHitsRef = useRef<Map<string, SourceUnitDateHit>>(new Map());
  const mentionManifestRef = useRef<MentionContext[]>([]);
  const entityAcSuggestionsRef = useRef<EntityAutocompleteSuggestion[]>([]);
  entityAcSuggestionsRef.current = entityAcSuggestions;
  const entityAcIndexRef = useRef(0);
  entityAcIndexRef.current = entityAcIndex;
  const [entityFormatOpen, setEntityFormatOpen] = useState(false);
  const [entityFormatAnchor, setEntityFormatAnchor] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const [entityFormatSpec, setEntityFormatSpec] = useState<EntityDisplaySpec>(EMPTY_DISPLAY_SPEC);
  const [entityFormatEntity, setEntityFormatEntity] = useState<EntitySummary | null>(null);
  const [entityFormatOccurrence, setEntityFormatOccurrence] = useState(1);
  const entityFormatFieldRef = useRef<Element | null>(null);
  const [paneFontSize, setPaneFontSize] = useState(() => translationFontZoom.get());
  const editableRef = useRef<HTMLDivElement>(null);
  const savedBodyRangeRef = useRef<Range | null>(null);
  const savedRangeRef = useRef<Range | null>(null);
  const savedFootnoteRangeRef = useRef<{ index: number; range: Range } | null>(null);
  const zoteroStatusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const aiStatusDismissTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastCitationTargetRef = useRef<'body' | 'footnote'>('body');
  const focusFootnoteIndexRef = useRef<number | null>(null);
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [footnotes, setFootnotes] = useState<string[]>([]);
  const [citationStylePickerOpen, setCitationStylePickerOpen] = useState(false);
  const [citationStyleChoices, setCitationStyleChoices] = useState<{ id: string; label: string }[]>(
    [],
  );
  const [pendingCitationStyle, setPendingCitationStyle] = useState('');
  const citationStyleResolveRef = useRef<((styleId: string | null) => void) | null>(null);
  const docRef = useRef<Document | null>(null);
  docRef.current = translationDoc;
  const pendingHighlightRef = useRef<{
    unitId: string;
    text: string;
    offset: { start: number; end: number } | null;
  } | null>(null);
  const { translationPath, alignmentUnit, sourcePath, selectedUnitId } = translationMode;
  const selectedUnitIdRef = useRef<string | null>(null);
  selectedUnitIdRef.current = selectedUnitId ?? null;
  const translationPathRef = useRef<string | null>(null);
  translationPathRef.current = translationPath ?? null;
  const focusedRef = useRef(false);
  const blurTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeCitationStyle = pendingCitationStyle || translationMode.citationStyle || undefined;
  const cardNodeRefs = useRef(new Map<string, HTMLElement>());
  const listScrollRef = useRef<HTMLDivElement>(null);
  const [cardsEpoch, setCardsEpoch] = useState(0);

  const unitCards = useMemo(() => {
    if (!translationDoc || !alignmentUnit || !sourcePath) return [];
    return collectTranslationUnitCards(translationDoc, alignmentUnit, fileNameOf(sourcePath));
    // `cardsEpoch` is an invalidation signal, not an input: the cards are read out
    // of a mutable document React cannot observe, so the counter is bumped to
    // force a rebuild. The rule calls it unnecessary because the body never
    // mentions it, which is the point.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [translationDoc, alignmentUnit, sourcePath, cardsEpoch]);

  const footnoteStartIndex = useMemo(
    () => (selectedUnitId ? footnoteStartIndexForUnit(selectedUnitId, unitCards) : 0),
    [selectedUnitId, unitCards],
  );

  const setTranslationDocument = useCallback((doc: Document) => {
    docRef.current = doc;
    setTranslationDoc(doc);
  }, []);

  useEffect(() => {
    const syncLanguageState = () => setLanguageState(getTranslationLanguageState());
    syncLanguageState();
    window.addEventListener('desktop:translation-language-state-changed', syncLanguageState);
    return () =>
      window.removeEventListener('desktop:translation-language-state-changed', syncLanguageState);
  }, []);

  // Chromium spellcheck: live LanguageTool mode turns it off to avoid double underlines.
  useEffect(() => {
    const setSpellcheck = window.electronAPI?.setTranslationSpellcheck;
    if (!setSpellcheck) return;
    const languageCodes = [languageState?.selectedLang || translationMode.lang || ''].filter(
      Boolean,
    );
    const enabled = spellcheckEnabled && !languageToolLive;
    void setSpellcheck({ enabled, languageCodes });
  }, [languageState?.selectedLang, languageToolLive, spellcheckEnabled, translationMode.lang]);

  useEffect(() => {
    const load = window.electronAPI?.getLanguageToolSettings;
    if (!load) return;
    const apply = (
      settings: {
        enabled?: boolean;
        checkMode?: 'onDemand' | 'live';
      } | null,
    ) => {
      setLanguageToolEnabled(settings?.enabled === true);
      setLanguageToolLive(settings?.enabled === true && settings?.checkMode === 'live');
    };
    void load().then(apply);
    const onPrefs = () => {
      void load().then(apply);
    };
    window.addEventListener('grognardCommonsUiChanged', onPrefs);
    return () => window.removeEventListener('grognardCommonsUiChanged', onPrefs);
  }, []);

  useEffect(() => {
    setLanguageToolMatches([]);
    setLanguageToolSnapshot(null);
    setLanguageToolStatus(null);
    setLanguageToolOverlays([]);
  }, [selectedUnitId]);

  // Pane text zoom (8–24px): keyboard Cmd/Ctrl +/-/0 while the pane has focus,
  // plus a window bridge so the desktop menu accelerators can drive it.
  useEffect(() => {
    const unsubscribe = translationFontZoom.subscribe(setPaneFontSize);
    const zoomBridge = {
      zoomIn: () => translationFontZoom.zoomIn(),
      zoomOut: () => translationFontZoom.zoomOut(),
      reset: () => translationFontZoom.reset(),
      get: () => translationFontZoom.get(),
    };
    window.__leafWriterTranslationZoom = zoomBridge;
    return () => {
      unsubscribe();
      if (window.__leafWriterTranslationZoom === zoomBridge) {
        delete window.__leafWriterTranslationZoom;
      }
    };
  }, []);

  useEffect(
    () => () => {
      if (blurTimeoutRef.current) clearTimeout(blurTimeoutRef.current);
      if (zoteroStatusTimeoutRef.current) clearTimeout(zoteroStatusTimeoutRef.current);
      if (aiStatusDismissTimeoutRef.current) clearTimeout(aiStatusDismissTimeoutRef.current);
    },
    [],
  );

  // Drop focus from the rich editor while its unit is being AI-translated.
  useEffect(() => {
    if (!generatingUnitId || generatingUnitId !== selectedUnitId) return;
    editableRef.current?.blur();
  }, [generatingUnitId, selectedUnitId]);

  // Success/error banners are per file — drop them when the user switches source or companion.
  useEffect(() => {
    if (aiStatusDismissTimeoutRef.current) {
      clearTimeout(aiStatusDismissTimeoutRef.current);
      aiStatusDismissTimeoutRef.current = null;
    }
    setAiStatus(null);
  }, [sourcePath, translationPath]);

  // A Find hit inside this unit's content requests a highlight. If the content is already
  // showing (rendered before this event arrives), apply it immediately; otherwise store it as
  // pending for the innerHTML-sync effect below to apply once the matching content renders.
  useEffect(() => {
    const onHighlightText = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          unitId?: string;
          text?: string;
          offset?: { start: number; end: number } | null;
        }>
      ).detail;
      if (!detail?.unitId || !detail.text) return;

      if (
        selectedUnitIdRef.current === detail.unitId &&
        editableRef.current &&
        selectHighlightedMatch(editableRef.current, detail.text, detail.offset ?? null)
      ) {
        return;
      }

      pendingHighlightRef.current = {
        unitId: detail.unitId,
        text: detail.text,
        offset: detail.offset ?? null,
      };
    };
    window.addEventListener('desktop:translation-highlight-text', onHighlightText);
    return () => window.removeEventListener('desktop:translation-highlight-text', onHighlightText);
  }, []);

  // Load the companion translation file whenever it changes, or after a reindex rewrote it
  // on disk (translationPath itself doesn't change, so the reindex event forces a reload).
  useEffect(() => {
    if (!translationPath) return;
    let cancelled = false;

    const load = async () => {
      const xml = await getDesktopApi()
        ?.readFile?.(translationPath)
        .catch(() => null);
      if (cancelled || !xml) return;
      const doc = parseTranslationDocument(xml);
      if (doc) setTranslationDocument(doc);
    };

    void load();
    window.addEventListener('desktop:translation-reindexed', load);
    return () => {
      cancelled = true;
      window.removeEventListener('desktop:translation-reindexed', load);
    };
  }, [setTranslationDocument, translationPath]);

  // Track the main editor's selection to figure out which alignment unit is active. Re-subscribes
  // whenever the active source file changes, since window.writer.editor may be a fresh
  // instance/body by then — keying only on alignmentUnit (a fixed per-project setting) would
  // leave a stale listener attached to the previous file's editor.
  useEffect(() => {
    if (!alignmentUnit) return;

    let cancelled = false;
    let detachEditorListener: (() => void) | null = null;
    let unsubscribeDocumentLoaded: (() => void) | null = null;
    let pollTimeout: ReturnType<typeof setTimeout> | null = null;

    const schemaId = getSchemaIdAttributeName();

    // Distinguishes "cursor not inside an alignment unit at all" from "inside one that has
    // no schema id yet" (e.g. a freshly split paragraph before the next save indexes it) —
    // the pane shows different guidance for each.
    const resolveUnit = (
      startNode: Element | null,
    ): { id: string | null; inUnindexedUnit: boolean } => {
      let node: Element | null = startNode;
      while (node && node.getAttribute?.('_tag') !== alignmentUnit) {
        node = node.parentElement;
      }
      if (!node) return { id: null, inUnindexedUnit: false };
      const attrs = window.writer?.tagger?.getAttributesForTag?.(node) ?? {};
      const id = attrs[schemaId] ?? (schemaId !== 'id' ? attrs.id : undefined);
      if (typeof id === 'string' && id) return { id, inUnindexedUnit: false };
      return { id: null, inUnindexedUnit: true };
    };

    const applyResolved = (resolved: { id: string | null; inUnindexedUnit: boolean }) => {
      setSelectedTranslationUnit(resolved.id);
      setCaretInUnindexedUnit(resolved.inUnindexedUnit);
    };

    // Attempts to attach the NodeChange listener; returns false if the editor for the current
    // source file isn't ready yet (e.g. right after opening a file the editor hasn't finished
    // initializing) so the caller can retry once it is.
    const attach = (): boolean => {
      const editor = window.writer?.editor;
      if (!editor?.on) return false;

      const handler = (event: { element: Element }) => {
        applyResolved(resolveUnit(event.element));
      };
      editor.on('NodeChange', handler);
      detachEditorListener = () => editor.off?.('NodeChange', handler);

      // Sync immediately using the current cursor position — otherwise, if the cursor was
      // already sitting in a paragraph before this effect (re-)attached (e.g. switching back
      // to this tab, or switching files, without moving the caret), no NodeChange event fires
      // and the pane is left showing nothing until the next click.
      const currentNode = editor.selection?.getNode?.();
      if (currentNode) applyResolved(resolveUnit(currentNode));

      return true;
    };

    const retryUntilAttached = () => {
      if (cancelled || attach()) return;

      if (window.writer) {
        const onDocumentLoaded = (success: boolean) => {
          if (!success || cancelled) return;
          if (attach()) unsubscribeDocumentLoaded?.();
        };
        window.writer.event('documentLoaded').subscribe(onDocumentLoaded);
        unsubscribeDocumentLoaded = () =>
          window.writer?.event('documentLoaded').unsubscribe(onDocumentLoaded);
      } else {
        // window.writer itself doesn't exist yet (very first load) — poll briefly.
        pollTimeout = setTimeout(retryUntilAttached, 200);
      }
    };

    retryUntilAttached();

    return () => {
      cancelled = true;
      detachEditorListener?.();
      unsubscribeDocumentLoaded?.();
      if (pollTimeout) clearTimeout(pollTimeout);
    };
  }, [alignmentUnit, sourcePath, setSelectedTranslationUnit]);

  // Reflect the selected unit's current content into the editable surface.
  useEffect(() => {
    if (!translationDoc || !alignmentUnit || !sourcePath || !selectedUnitId) {
      setUnitHtml('');
      return;
    }
    const unit = findUnitByCorrespId(
      translationDoc,
      alignmentUnit,
      fileNameOf(sourcePath),
      selectedUnitId,
    );
    let html = unit?.innerHTML ?? '';
    const plain = html.replace(/<[^>]+>/g, '');
    if (looksLikeInlineMarkdown(plain)) {
      html = applyMarkdownCleanupToFragment(html);
    }
    setUnitHtml(html);
  }, [translationDoc, alignmentUnit, sourcePath, selectedUnitId]);

  /** Sync the numbered footnote list below the text from the inline <note> elements,
   * marking them non-editable so they behave as atomic anchors in the main text. */
  const refreshFootnotes = useCallback(() => {
    const editable = editableRef.current;
    if (!editable) {
      setFootnotes([]);
      return;
    }
    normalizeFootnoteNotes(editable, footnoteStartIndex);
    const notes = Array.from(editable.querySelectorAll('note'));
    for (const note of notes) {
      const body = footnoteBodyOf(note);
      const target = body ?? note;
      prepareAtomicCitationFields(target, zoteroCitationLabel);
      prepareAtomicGlyphFields(target, translationPath);
    }
    setFootnotes(notes.map((note) => footnoteBodyHtml(note)));
  }, [footnoteStartIndex, zoteroCitationLabel, translationPath]);

  const renderCitationRefs = useCallback(
    (doc: Document, styleId = activeCitationStyle) => {
      const bridge = getCitationBridge();
      if (!bridge) return;

      const entries = bridge.readBiblEntries(doc);
      for (const bibl of Array.from(doc.getElementsByTagName('bibl'))) {
        if (bibl.getAttribute('type') !== 'zotero-ref') continue;
        const corresp = bibl.getAttribute('corresp') ?? '';
        if (!corresp.startsWith('#')) continue;
        const entry = entries.get(corresp.slice(1));
        if (!entry) continue;
        bibl.innerHTML = bridge.renderCitation({
          item: entry.csl,
          styleId,
          lang: translationMode.lang ?? undefined,
          locator: bibl.getAttribute('data-locator') ?? undefined,
          locatorType: bibl.getAttribute('data-locator-type') ?? undefined,
          prefix: bibl.getAttribute('data-prefix') ?? undefined,
          suffix: bibl.getAttribute('data-suffix') ?? undefined,
        });
      }
    },
    [activeCitationStyle, translationMode.lang],
  );

  useEffect(() => {
    const editable = editableRef.current;
    if (editable && editable.innerHTML !== unitHtml) {
      editable.innerHTML = unitHtml;
    }
    if (editable) {
      prepareAtomicCitationFields(editable, zoteroCitationLabel);
      prepareAtomicGlyphFields(editable, translationPath);
      recalculateDateFieldsInRoot(editable, selectedLanguage);
      void recalculateAllEntityFieldsInRoot(
        editable,
        fetchEntitySummary,
        undefined,
        selectedLanguage,
      )
        .then(() => {
          prepareAtomicEntityFields(editable);
          prepareAtomicDateFields(editable);
        })
        .catch((error) => {
          console.warn('[translation] entity field refresh failed', error);
        });
    }
    refreshFootnotes();

    const pending = pendingHighlightRef.current;
    if (pending && selectedUnitId === pending.unitId && editable) {
      if (selectHighlightedMatch(editable, pending.text, pending.offset)) {
        pendingHighlightRef.current = null;
      }
    }
  }, [
    unitHtml,
    selectedUnitId,
    refreshFootnotes,
    zoteroCitationLabel,
    selectedLanguage,
    translationPath,
  ]);

  const refreshEntityAnchors = useCallback(() => {
    const editable = editableRef.current;
    if (!editable) return;
    clearOfficeGlossIndexCaches();
    recalculateDateFieldsInRoot(editable, selectedLanguage);
    void recalculateAllEntityFieldsInRoot(editable, fetchEntitySummary, undefined, selectedLanguage)
      .then(() => {
        prepareAtomicEntityFields(editable);
        prepareAtomicDateFields(editable);
      })
      .catch((error) => {
        console.warn('[translation] entity field refresh failed', error);
      });
  }, [selectedLanguage]);

  useEffect(() => {
    window.addEventListener(TRANSLATION_POLICY_CHANGED_EVENT, refreshEntityAnchors);
    window.addEventListener(SCHOLARLY_CONVENTIONS_CHANGED_EVENT, refreshEntityAnchors);
    return () => {
      window.removeEventListener(TRANSLATION_POLICY_CHANGED_EVENT, refreshEntityAnchors);
      window.removeEventListener(SCHOLARLY_CONVENTIONS_CHANGED_EVENT, refreshEntityAnchors);
    };
  }, [refreshEntityAnchors]);

  useEffect(() => {
    // Fired by the Electron menu bridge when the user presses F5.
    window.addEventListener('desktop:refresh', refreshEntityAnchors);
    return () => window.removeEventListener('desktop:refresh', refreshEntityAnchors);
  }, [refreshEntityAnchors]);

  const persist = useCallback(async () => {
    const doc = docRef.current;
    if (!doc || !alignmentUnit || !sourcePath || !selectedUnitId || !translationPath) return;

    const unit = findUnitByCorrespId(doc, alignmentUnit, fileNameOf(sourcePath), selectedUnitId);
    if (!unit || !editableRef.current) return;

    // Quiet house style before write: spaces, ellipsis, quotes, ranges, punctuation.
    applyEditorialCleanupToRoot(editableRef.current, selectedLanguage);

    // Strip the editing-only contenteditable markers before writing to disk.
    const clone = editableRef.current.cloneNode(true) as HTMLElement;
    for (const note of Array.from(clone.querySelectorAll('note'))) {
      note.removeAttribute('contenteditable');
    }
    for (const bibl of Array.from(clone.querySelectorAll('bibl[type="zotero-ref"]'))) {
      bibl.removeAttribute('contenteditable');
      bibl.removeAttribute('data-leaf-citation-field');
      bibl.removeAttribute('title');
    }
    for (const ref of Array.from(clone.querySelectorAll(`ref[type="${ENTITY_REF_TYPE}"]`))) {
      ref.removeAttribute('contenteditable');
      ref.removeAttribute(ENTITY_FIELD_ATTR);
      ref.removeAttribute('title');
      // Presentation-only (CSS-driven); recomputed from the entity record on load.
      ref.removeAttribute(ENTITY_WORK_STYLE_ATTR);
    }
    for (const graphic of Array.from(clone.querySelectorAll(GLYPH_SELECTOR))) {
      graphic.removeAttribute('contenteditable');
      // The mask CSS is presentation-only (an inline `style`, from
      // prepareAtomicGlyphFields) and recomputed on load - never written to disk.
      graphic.removeAttribute('style');
    }
    stripInvisibleCaretSpacers(clone);
    flattenFootnoteNotesForPersist(clone);
    // Import nodes directly rather than round-tripping through an HTML string
    // (`unit.innerHTML = clone.innerHTML`): `unit` belongs to an XML document, and
    // Chromium's XML innerHTML setter requires the string to be well-formed XML, which
    // HTML's own serialization doesn't guarantee. Importing already-built DOM nodes
    // sidesteps that string round-trip (and its "invalid XML" failures) entirely.
    while (unit.firstChild) unit.removeChild(unit.firstChild);
    for (const child of Array.from(clone.childNodes)) {
      unit.appendChild(doc.importNode(child, true));
    }
    getCitationBridge()?.garbageCollectBibl(doc);
    const nextXml = new XMLSerializer().serializeToString(doc);
    await getDesktopApi()?.writeFile?.(translationPath, nextXml);
    setCardsEpoch((n) => n + 1);
  }, [alignmentUnit, sourcePath, selectedUnitId, selectedLanguage, translationPath]);

  const navigateToUnit = useCallback(
    async (nextUnitId: string, options?: { selectSource?: boolean }) => {
      if (!nextUnitId) return;
      const selectSource = options?.selectSource !== false;
      if (nextUnitId !== selectedUnitIdRef.current) {
        await persist();
        setSelectedTranslationUnit(nextUnitId);
      }
      if (selectSource) selectSourceUnitInEditor(nextUnitId);
    },
    [persist, setSelectedTranslationUnit],
  );

  // Keep the active card visible when the source caret (or Find) changes the unit.
  useEffect(() => {
    if (!selectedUnitId) return;
    const node = cardNodeRefs.current.get(selectedUnitId);
    if (typeof node?.scrollIntoView === 'function') {
      node.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [selectedUnitId]);

  // Soft wash on the matching source unit while translation mode is active.
  useEffect(() => {
    markActiveSourceUnit(selectedUnitId);
    return () => markActiveSourceUnit(null);
  }, [selectedUnitId, sourcePath]);

  // Prefetch mention manifest + romanizations for autocomplete while typing.
  useEffect(() => {
    if (!alignmentUnit || !selectedUnitId || !sourcePath) {
      setEntityAcCandidates([]);
      setEntityAcSuggestions([]);
      setEntityAcAnchor(null);
      dateAcHitsRef.current = new Map();
      mentionManifestRef.current = [];
      return;
    }

    const dateHits = collectSourceUnitDates(alignmentUnit, selectedUnitId, selectedLanguage);
    const dateHitsById = new Map<string, SourceUnitDateHit>();
    const dateCandidates = dateHits.map((hit) => {
      const id = dateCandidateId(hit.index);
      dateHitsById.set(id, hit);
      return candidateFromDateHit(hit, id);
    });
    dateAcHitsRef.current = dateHitsById;

    let cancelled = false;
    void (async () => {
      const api = getDesktopApi();
      if (!api?.readFile) return;
      const sourceXml = await api.readFile(sourcePath);
      const sourceUnit = serializeSourceUnit(sourceXml, alignmentUnit, selectedUnitId);
      const manifest = collectMentionsFromSourceUnitXml(sourceUnit.xml ?? '');
      mentionManifestRef.current = manifest;

      const entityMap = new Map<string, EntitySummary>();
      await Promise.all(
        [...new Set(manifest.map((mention) => mention.key))].map(async (key) => {
          const entity = await fetchEntitySummary(key);
          if (entity) entityMap.set(key, entity);
        }),
      );
      if (cancelled) return;

      const resolved = resolveMentionsWithEntities(manifest, entityMap);
      const settings = dateFormatSettingsForLang(selectedLanguage);
      const cjk = isCharacterOnlyTranslationTarget(selectedLanguage);

      const entityCandidates = resolved
        .map((mention) => {
          const entity = entityMap.get(mention.key);
          if (!entity) return null;
          const displaySpec = deriveDisplaySpec(mention.role, 1, settings.bracketsPolicy);
          const parts = cjk
            ? buildCjkMentionParts(mention, entity, 1, displaySpec, settings, selectedLanguage)
            : buildWesternMentionParts(
                mention,
                entity,
                1,
                displaySpec,
                settings,
                projectSourceLang,
                selectedLanguage,
              );
          return candidateFromMention(
            mention,
            entity,
            mentionPartsToPlainPreview(parts),
            selectedLanguage,
          );
        })
        .filter((row): row is EntityAutocompleteCandidate => Boolean(row));

      setEntityAcCandidates([...entityCandidates, ...dateCandidates]);
    })();
    return () => {
      cancelled = true;
    };
  }, [alignmentUnit, selectedUnitId, sourcePath, selectedLanguage]);

  useEffect(() => {
    const doc = window.writer?.editor?.getDoc?.() ?? document;
    if (
      !doc ||
      typeof doc.createElement !== 'function' ||
      typeof doc.getElementById !== 'function'
    ) {
      return;
    }
    const styleId = 'grognard-translation-active-unit-style';
    if (doc.getElementById(styleId)) return;
    const parent = doc.head ?? doc.documentElement ?? doc.body;
    if (!parent) return;
    const style = doc.createElement('style');
    style.id = styleId;
    style.textContent = `
      .${ACTIVE_SOURCE_UNIT_CLASS} {
        background-color: rgba(25, 118, 210, 0.08) !important;
        box-shadow: inset 3px 0 0 rgba(25, 118, 210, 0.55);
      }
    `;
    parent.appendChild(style);
  }, [sourcePath]);

  // Entity fields live in the plain contentEditable translation pane (not a TinyMCE
  // iframe), so this is a normal top-level style tag, not doc-injection like above.
  useEffect(() => {
    const styleId = 'grognard-entity-worktype-style';
    if (document.getElementById(styleId)) return;
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      /* Italics live on inner <hi rend="italic"> runs only — Chinese and ’s stay upright. */
      ref[type="${ENTITY_REF_TYPE}"] hi[rend="italic"] {
        font-style: italic;
      }
    `;
    document.head.appendChild(style);
  }, []);

  const refreshCurrentCitationFields = useCallback(
    async (styleId = activeCitationStyle) => {
      const doc = docRef.current;
      if (!doc || !alignmentUnit || !sourcePath || !selectedUnitId || !translationPath) return;

      renderCitationRefs(doc, styleId);

      const unit = findUnitByCorrespId(doc, alignmentUnit, fileNameOf(sourcePath), selectedUnitId);
      const nextHtml = unit?.innerHTML ?? '';
      setUnitHtml(nextHtml);
      if (editableRef.current) editableRef.current.innerHTML = nextHtml;
      refreshFootnotes();
      await getDesktopApi()?.writeFile?.(
        translationPath,
        new XMLSerializer().serializeToString(doc),
      );
    },
    [
      activeCitationStyle,
      alignmentUnit,
      refreshFootnotes,
      renderCitationRefs,
      selectedUnitId,
      sourcePath,
      translationPath,
    ],
  );

  useEffect(() => {
    const onCitationStyleChanged = async (event: Event) => {
      const citationStyle = (event as CustomEvent<{ citationStyle?: string }>).detail
        ?.citationStyle;
      if (citationStyle) setPendingCitationStyle(citationStyle);
      await refreshCurrentCitationFields(citationStyle ?? activeCitationStyle);
    };

    const onZoteroRefresh = async () => {
      await refreshCurrentCitationFields();
    };

    const onZoteroOpenStylePicker = async () => {
      const bridge = getCitationBridge();
      if (!bridge) {
        setAiStatus({ severity: 'error', message: t('LW.translationPane.zoteroPrefsUnavailable') });
        return;
      }

      const styleId = await openCitationStylePicker(bridge);
      if (styleId) await refreshCurrentCitationFields(styleId);
    };

    window.addEventListener('desktop:translation-citation-style-changed', onCitationStyleChanged);
    window.addEventListener('desktop:zotero-refresh-citations', onZoteroRefresh);
    window.addEventListener('desktop:zotero-open-style-picker', onZoteroOpenStylePicker);
    return () => {
      window.removeEventListener(
        'desktop:translation-citation-style-changed',
        onCitationStyleChanged,
      );
      window.removeEventListener('desktop:zotero-refresh-citations', onZoteroRefresh);
      window.removeEventListener('desktop:zotero-open-style-picker', onZoteroOpenStylePicker);
    };
    // Re-registers only when the citation style or refresh helper changes.
    // `openCitationStylePicker` and `t` are read inside the handlers, not used to
    // decide whether to re-register, and naming them would tear down and rebuild
    // these window listeners far more often than needed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCitationStyle, refreshCurrentCitationFields]);

  useEffect(() => {
    const runHistoryCommand = async (command: 'redo' | 'undo'): Promise<boolean> => {
      const editable = editableRef.current;
      if (!editable || !translationPathRef.current) return false;

      editable.focus();
      if (
        typeof document.queryCommandEnabled === 'function' &&
        !document.queryCommandEnabled(command)
      ) {
        return false;
      }

      const before = editable.innerHTML;
      const ok = document.execCommand(command);
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

      if (editable.innerHTML !== before) {
        await persist();
        setUnitHtml(editable.innerHTML);
        return true;
      }

      return ok;
    };

    const bridge = {
      filePath: translationPath ?? null,
      isActive: () =>
        focusedRef.current ||
        (!!editableRef.current && document.activeElement === editableRef.current),
      redo: () => runHistoryCommand('redo'),
      replaceContent: (filePath: string, content: string) => {
        if (translationPathRef.current !== filePath) return false;

        const doc = parseTranslationDocument(content);
        if (!doc) return false;
        setTranslationDocument(doc);

        if (alignmentUnit && sourcePath && selectedUnitIdRef.current) {
          const unit = findUnitByCorrespId(
            doc,
            alignmentUnit,
            fileNameOf(sourcePath),
            selectedUnitIdRef.current,
          );
          const nextHtml = unit?.innerHTML ?? '';
          setUnitHtml(nextHtml);
          if (editableRef.current) editableRef.current.innerHTML = nextHtml;
        }

        return true;
      },
      undo: () => runHistoryCommand('undo'),
    };
    window.__leafWriterTranslationPane = bridge;

    return () => {
      if (window.__leafWriterTranslationPane === bridge) {
        delete window.__leafWriterTranslationPane;
      }
    };
  }, [alignmentUnit, persist, setTranslationDocument, sourcePath, translationPath]);

  const replaceCurrentUnit = useCallback(
    async (nextUnitXml: string, unitId: string = selectedUnitId ?? '') => {
      const doc = docRef.current;
      if (!doc || !alignmentUnit || !sourcePath || !unitId || !translationPath) {
        return { error: 'No translation unit is selected.' };
      }

      const unit = findUnitByCorrespId(doc, alignmentUnit, fileNameOf(sourcePath), unitId);
      if (!unit) return { error: 'Could not find the matching translation unit.' };

      unit.innerHTML = nextUnitXml;
      // A batch run touches units other than the one on screen — only mirror
      // into the live editor/React state when it's the one actually displayed.
      if (unitId === selectedUnitIdRef.current) {
        setUnitHtml(nextUnitXml);
        if (editableRef.current) editableRef.current.innerHTML = nextUnitXml;
      }

      const nextXml = new XMLSerializer().serializeToString(doc);
      await getDesktopApi()?.writeFile?.(translationPath, nextXml);
      return {};
    },
    [alignmentUnit, sourcePath, selectedUnitId, translationPath],
  );

  const generateTranslation = useCallback(
    async (unitId: string = selectedUnitId ?? '', options?: { silent?: boolean }) => {
      const silent = options?.silent ?? false;
      const isSelected = unitId === selectedUnitIdRef.current;
      if (!alignmentUnit || !sourcePath || !unitId) {
        if (!silent) {
          setAiStatus({
            severity: 'error',
            message: t('LW.translationPane.selectSourceUnitFirst'),
          });
        }
        return { skipped: false, error: 'No unit selected.' };
      }

      const doc = docRef.current;
      const unit = doc && findUnitByCorrespId(doc, alignmentUnit, fileNameOf(sourcePath), unitId);
      // The live editor fallback only applies to the unit actually on screen —
      // otherwise a batch run over other units would read the wrong content.
      const currentHtml =
        unit?.innerHTML ?? (isSelected ? (editableRef.current?.innerHTML ?? '') : '');
      if (!isTranslationUnitBlank(currentHtml)) {
        if (!silent) {
          setAiStatus({ severity: 'info', message: t('LW.translationPane.aiSkippedExisting') });
        }
        return { skipped: true };
      }

      const api = getDesktopApi();
      if (!api?.generateAiTranslation || !api.readFile) {
        if (!silent) {
          setAiStatus({
            severity: 'error',
            message: t('LW.translationPane.aiTranslationUnavailable'),
          });
        }
        return { skipped: false, error: 'AI translation unavailable.' };
      }

      setGeneratingUnitId(unitId);
      try {
        const sourceXml = await api.readFile(sourcePath);
        const sourceUnit = serializeSourceUnit(sourceXml, alignmentUnit, unitId);
        if (!sourceUnit.xml) {
          const message = sourceUnit.error ?? 'Could not read source unit.';
          if (!silent) setAiStatus({ severity: 'error', message });
          return { skipped: false, error: message };
        }

        // Same source of truth as dates: collect + blind from the serialized unit
        // XML the model will see. TinyMCE DOM collect can miss the active unit.
        const sourceEntityHits = collectEntitiesFromSourceUnitXml(sourceUnit.xml);
        const mentionManifest = collectMentionsFromSourceUnitXml(sourceUnit.xml);
        const entityMap = new Map<string, EntitySummary>();
        await Promise.all(
          sourceEntityHits.map(async (hit) => {
            if (entityMap.has(hit.key)) return;
            const entity = await fetchEntitySummary(hit.key);
            if (entity) entityMap.set(hit.key, entity);
          }),
        );
        const resolvedManifest = resolveMentionsWithEntities(mentionManifest, entityMap);
        const mentionsPayload = resolvedManifest.map((mention) => ({
          index: mention.index,
          kind: mention.kind,
        }));

        const sourceDateHits = collectDatesFromSourceUnitXml(
          sourceUnit.xml,
          selectedLanguage ?? translationMode.lang,
        );
        const dateMap = new Map<number, DateGlossInput>();
        const datesPayload = sourceDateHits.map((hit) => {
          dateMap.set(hit.index, hit.input);
          // Index only for the model; gloss is applied locally after substitute.
          return { index: hit.index };
        });
        const knownEntityKeys = new Set(sourceEntityHits.map((hit) => hit.key));

        // Notes are stripped and translated independently — collect from the
        // full unit XML (before blinding) so their own inner XML still has
        // real entity/date tags to blind for the note-specific AI call below.
        const noteHits = collectNotesFromSourceUnitXml(sourceUnit.xml);
        const sourceXmlNotesStripped = replaceNotesWithPlaceholdersInSourceXml(sourceUnit.xml);

        const {
          xml: sourceUnitXmlForAi,
          opaques,
          mentions,
        } = replaceEntitiesWithPlaceholdersInSourceXml(
          replaceDatesWithPlaceholdersInSourceXml(sourceXmlNotesStripped),
          knownEntityKeys,
        );
        const opaqueMap = new Map<number, OpaqueEntityHit>(opaques.map((hit) => [hit.index, hit]));
        console.info('[translation] AI blinded source unit', {
          entityKeys: knownEntityKeys.size,
          mentionCount: mentions.length,
          opaqueCount: opaques.length,
          dates: datesPayload.length,
          notes: noteHits.length,
          xml: sourceUnitXmlForAi,
        });

        // First attempt + up to N resends (from AI settings; hard-capped 0–5).
        const aiPrefs = await api.getAiApiSettings?.().catch(() => null);
        const bridgeLimit = (
          window as Window & {
            __ljbCommonsUi?: { aiApiSettings?: { placeholderRetryLimit?: number } | null };
          }
        ).__ljbCommonsUi?.aiApiSettings?.placeholderRetryLimit;
        const rawLimit =
          typeof aiPrefs?.placeholderRetryLimit === 'number'
            ? aiPrefs.placeholderRetryLimit
            : typeof bridgeLimit === 'number'
              ? bridgeLimit
              : 1;
        const retryLimit = Math.min(5, Math.max(0, Math.floor(rawLimit)));

        const mainResult = await translateBlindedUnitXml(
          api,
          {
            alignmentUnit,
            sourceUnitXml: sourceUnitXmlForAi,
            targetLanguage: translationMode.lang ?? '',
            mentions: mentionsPayload,
            dates: datesPayload,
          },
          retryLimit,
        );
        if ('error' in mainResult) {
          if (!silent) setAiStatus({ severity: 'error', message: mainResult.error });
          return { skipped: false, error: mainResult.error };
        }

        const validated = validateGeneratedFragment(mainResult.xml);
        if (!validated.xml) {
          const message = validated.error ?? 'AI returned invalid translation XML.';
          if (!silent) setAiStatus({ severity: 'error', message });
          return { skipped: false, error: message };
        }

        const fileOccurrenceOffsetByKey = new Map<string, number>();
        if (docRef.current && alignmentUnit && sourcePath) {
          for (const key of knownEntityKeys) {
            fileOccurrenceOffsetByKey.set(
              key,
              countPriorEntityRefsInDocument(
                docRef.current,
                alignmentUnit,
                fileNameOf(sourcePath),
                unitId,
                key,
              ),
            );
          }
        }

        const cleanedXml = normalizeAiPlaceholders(applyMarkdownCleanupToFragment(validated.xml));
        const withOpaques = substituteOpaquePlaceholders(cleanedXml, opaqueMap);
        const withEntities = substituteMentionPlaceholders(
          withOpaques,
          resolvedManifest,
          entityMap,
          {
            lang: selectedLanguage,
            sourceLang: projectSourceLang,
            translationDoc: docRef.current,
            alignmentUnit: alignmentUnit ?? undefined,
            sourceFileName: sourcePath ? fileNameOf(sourcePath) : undefined,
            unitId,
            fileOccurrenceOffsetByKey,
          },
        );
        const withDates = substituteDatePlaceholders(withEntities, dateMap, selectedLanguage);

        // Translate each note independently, only after the main text succeeded.
        // A note failure never fails the whole operation — it falls back to the
        // note's original (untranslated) content and is surfaced as a warning.
        const noteHtmlByIndex = new Map<number, string>();
        const noteWarnings: string[] = [];
        let nextOpaqueStart = opaques.length;

        for (const noteHit of noteHits) {
          if (!noteHit.innerXml.trim()) {
            noteHtmlByIndex.set(noteHit.index, '');
            continue;
          }

          const { xml: noteXmlForAi, opaques: noteOpaques } =
            replaceEntitiesWithPlaceholdersInSourceXml(
              replaceDatesWithPlaceholdersInSourceXml(noteHit.innerXml),
              knownEntityKeys,
              nextOpaqueStart,
            );
          nextOpaqueStart += noteOpaques.length;
          for (const hit of noteOpaques) opaqueMap.set(hit.index, hit);

          const noteResult = await translateBlindedUnitXml(
            api,
            {
              alignmentUnit: 'note',
              sourceUnitXml: noteXmlForAi,
              targetLanguage: translationMode.lang ?? '',
              mentions: mentionsPayload,
              dates: datesPayload,
            },
            retryLimit,
          );
          if ('error' in noteResult) {
            console.warn(
              '[translation] note translation failed, keeping original text',
              noteResult.error,
            );
            noteWarnings.push(noteResult.error);
            noteHtmlByIndex.set(noteHit.index, noteHit.innerXml);
            continue;
          }

          const noteValidated = validateGeneratedFragment(noteResult.xml);
          if (!noteValidated.xml) {
            console.warn(
              '[translation] note translation was invalid XML, keeping original text',
              noteValidated.error,
            );
            noteWarnings.push(noteValidated.error ?? 'AI returned invalid note XML.');
            noteHtmlByIndex.set(noteHit.index, noteHit.innerXml);
            continue;
          }

          const noteCleaned = normalizeAiPlaceholders(
            applyMarkdownCleanupToFragment(noteValidated.xml),
          );
          const noteWithOpaques = substituteOpaquePlaceholders(noteCleaned, opaqueMap);
          const noteWithEntities = substituteMentionPlaceholders(
            noteWithOpaques,
            resolvedManifest,
            entityMap,
            {
              lang: selectedLanguage,
              sourceLang: projectSourceLang,
              translationDoc: docRef.current,
              alignmentUnit: alignmentUnit ?? undefined,
              sourceFileName: sourcePath ? fileNameOf(sourcePath) : undefined,
              unitId,
              fileOccurrenceOffsetByKey,
            },
          );
          const noteWithDates = substituteDatePlaceholders(
            noteWithEntities,
            dateMap,
            selectedLanguage,
          );
          noteHtmlByIndex.set(noteHit.index, noteWithDates);
        }

        const substitutedXml = substituteNotePlaceholders(withDates, noteHtmlByIndex);
        const replaceResult = await replaceCurrentUnit(substitutedXml, unitId);
        if (replaceResult.error) {
          if (!silent) setAiStatus({ severity: 'error', message: replaceResult.error });
          return { skipped: false, error: replaceResult.error };
        }
        if (isSelected && editableRef.current) {
          prepareAtomicEntityFields(editableRef.current);
          prepareAtomicDateFields(editableRef.current);
        }

        if (!silent) {
          if (aiStatusDismissTimeoutRef.current) {
            clearTimeout(aiStatusDismissTimeoutRef.current);
          }
          setAiStatus({
            severity: 'success',
            message:
              noteWarnings.length > 0
                ? `${t('LW.translationPane.translationGenerated')} ${t('LW.translationPane.aiNotesPartial', { count: noteWarnings.length })}`
                : t('LW.translationPane.translationGenerated'),
          });
          aiStatusDismissTimeoutRef.current = setTimeout(() => {
            setAiStatus(null);
            aiStatusDismissTimeoutRef.current = null;
          }, 5000);
        }
        return { skipped: false };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'AI translation failed.';
        if (!silent) setAiStatus({ severity: 'error', message });
        return { skipped: false, error: message };
      } finally {
        setGeneratingUnitId(null);
      }
    },
    [
      alignmentUnit,
      replaceCurrentUnit,
      selectedLanguage,
      selectedUnitId,
      sourcePath,
      t,
      translationMode.lang,
    ],
  );

  /**
   * Translate every still-blank unit in the document, one at a time, via the
   * bottom-bar progress indicator (same module the auto-tagging dialog's
   * background mode uses) — not the per-unit `aiStatus` chatter, which stays
   * reserved for the single-unit path.
   */
  const translateDocument = useCallback(async () => {
    if (generating) return;
    const blankUnits = unitCards.filter((card) => isTranslationUnitBlank(card.previewHtml));
    if (blankUnits.length === 0) {
      setAiStatus({ severity: 'info', message: t('LW.translationPane.aiSkippedExisting') });
      return;
    }

    const abortController = new AbortController();
    startAiRunProgress(t('LW.translationPane.translateDocumentProgress'), () =>
      abortController.abort(),
    );
    let translated = 0;
    let skipped = 0;
    let failed = 0;
    try {
      for (let i = 0; i < blankUnits.length; i++) {
        if (abortController.signal.aborted) break;
        updateAiRunProgress(i, blankUnits.length);
        const result = await generateTranslation(blankUnits[i]!.unitId, { silent: true });
        if (result?.skipped) skipped += 1;
        else if (result?.error) failed += 1;
        else translated += 1;
      }
      updateAiRunProgress(blankUnits.length, blankUnits.length);
    } finally {
      finishAiRunProgress();
    }

    if (aiStatusDismissTimeoutRef.current) {
      clearTimeout(aiStatusDismissTimeoutRef.current);
      aiStatusDismissTimeoutRef.current = null;
    }
    const severity = failed > 0 ? 'error' : 'success';
    setAiStatus({
      severity,
      message: t('LW.translationPane.translateDocumentDone', {
        count: translated,
        skipped,
        failed,
      }),
    });
    if (severity === 'success') {
      aiStatusDismissTimeoutRef.current = setTimeout(() => {
        setAiStatus(null);
        aiStatusDismissTimeoutRef.current = null;
      }, 5000);
    }
  }, [generateTranslation, generating, t, unitCards]);

  const refreshLanguageToolOverlays = useCallback((matches: LanguageToolMatchView[]) => {
    const root = editableRef.current;
    if (!root || matches.length === 0) {
      setLanguageToolOverlays([]);
      return;
    }
    setLanguageToolOverlays(collectMatchOverlayRects(root, matches));
  }, []);

  const runLanguageToolCheck = useCallback(
    async (options?: { quiet?: boolean }) => {
      const check = window.electronAPI?.checkLanguageTool;
      if (!check) {
        if (!options?.quiet) {
          setLanguageToolStatus({
            severity: 'error',
            message: t('LW.translationPane.languageToolUnavailable'),
          });
        }
        return;
      }
      if (!languageToolEnabled) {
        if (!options?.quiet) {
          setLanguageToolStatus({
            severity: 'info',
            message: t('LW.translationPane.languageToolDisabled'),
          });
        }
        return;
      }
      if (!selectedUnitId || !editableRef.current) return;

      const seq = ++languageToolSeqRef.current;
      const text = editableRef.current.textContent ?? '';
      setLanguageToolChecking(true);
      if (!options?.quiet) setLanguageToolStatus(null);
      try {
        const result = await check({
          text,
          language: languageState?.selectedLang || translationMode.lang || 'auto',
        });
        if (seq !== languageToolSeqRef.current) return;
        if (!result.ok) {
          setLanguageToolMatches([]);
          setLanguageToolSnapshot(null);
          setLanguageToolOverlays([]);
          if (!options?.quiet) {
            setLanguageToolStatus({
              severity: 'error',
              message: result.error ?? t('LW.settings.language_tool.connection_failed'),
            });
          }
          return;
        }
        const matches = (result.matches ?? []) as LanguageToolMatchView[];
        const liveText = editableRef.current?.textContent ?? '';
        if (liveText !== text) return;
        setLanguageToolSnapshot(text);
        setLanguageToolMatches(matches);
        refreshLanguageToolOverlays(matches);
        if (!options?.quiet || matches.length > 0) {
          setLanguageToolStatus({
            severity: matches.length === 0 ? 'success' : 'info',
            message:
              matches.length === 0
                ? t('LW.translationPane.languageToolNoMatches')
                : t('LW.translationPane.languageToolMatches', { count: matches.length }),
          });
        } else if (matches.length === 0) {
          setLanguageToolStatus(null);
        }
      } catch (error) {
        if (seq !== languageToolSeqRef.current) return;
        if (!options?.quiet) {
          setLanguageToolStatus({
            severity: 'error',
            message:
              error instanceof Error
                ? error.message
                : t('LW.settings.language_tool.connection_failed'),
          });
        }
      } finally {
        if (seq === languageToolSeqRef.current) setLanguageToolChecking(false);
      }
    },
    [
      languageState?.selectedLang,
      languageToolEnabled,
      refreshLanguageToolOverlays,
      selectedUnitId,
      t,
      translationMode.lang,
    ],
  );

  const scheduleLiveLanguageToolCheck = useCallback(() => {
    if (!languageToolLive || !languageToolEnabled) return;
    if (languageToolDebounceRef.current) clearTimeout(languageToolDebounceRef.current);
    languageToolDebounceRef.current = setTimeout(() => {
      void runLanguageToolCheck({ quiet: true });
    }, 700);
  }, [languageToolEnabled, languageToolLive, runLanguageToolCheck]);

  const dismissLanguageToolMatch = useCallback(
    (match: LanguageToolMatchView) => {
      setLanguageToolMatches((current) => {
        const next = current.filter(
          (item) => item.offset !== match.offset || item.length !== match.length,
        );
        refreshLanguageToolOverlays(next);
        return next;
      });
    },
    [refreshLanguageToolOverlays],
  );

  const applyLanguageToolReplacement = useCallback(
    async (match: LanguageToolMatchView, replacement: string) => {
      const root = editableRef.current;
      if (!root) return;
      const liveText = root.textContent ?? '';
      if (languageToolSnapshot !== null && liveText !== languageToolSnapshot) {
        setLanguageToolStatus({
          severity: 'error',
          message: t('LW.translationPane.languageToolTextChanged'),
        });
        setLanguageToolMatches([]);
        setLanguageToolSnapshot(null);
        setLanguageToolOverlays([]);
        return;
      }

      const ok = applyTextContentReplacement(root, match.offset, match.length, replacement);
      if (!ok) {
        setLanguageToolStatus({
          severity: 'error',
          message: t('LW.translationPane.languageToolApplyFailed'),
        });
        return;
      }

      const nextText = root.textContent ?? '';
      setLanguageToolSnapshot(nextText);
      setLanguageToolMatches((current) => {
        const next = shiftLanguageToolMatchViews(
          current,
          match.offset,
          match.length,
          replacement.length,
        );
        refreshLanguageToolOverlays(next);
        return next;
      });
      refreshFootnotes();
      await persist();
    },
    [languageToolSnapshot, persist, refreshFootnotes, refreshLanguageToolOverlays, t],
  );

  const getEditableRange = (): Range | null => {
    const selection = window.getSelection();
    const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
    if (range) {
      const inFootnoteEditor = Array.from(
        document.querySelectorAll<HTMLElement>('[data-leaf-footnote-editor]'),
      ).some((element) => element.contains(range.commonAncestorContainer));
      if (inFootnoteEditor) return null;
    }
    if (range && editableRef.current?.contains(range.commonAncestorContainer)) {
      savedBodyRangeRef.current = range.cloneRange();
      lastCitationTargetRef.current = 'body';
      return range;
    }

    const saved = savedBodyRangeRef.current;
    if (
      saved &&
      editableRef.current?.contains(saved.startContainer) &&
      editableRef.current.contains(saved.endContainer)
    ) {
      editableRef.current.focus();
      selection?.removeAllRanges();
      selection?.addRange(saved);
      return saved.cloneRange();
    }

    return null;
  };

  const rememberBodyRange = () => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    if (!editableRef.current?.contains(range.commonAncestorContainer)) return;
    savedBodyRangeRef.current = range.cloneRange();
    lastCitationTargetRef.current = 'body';
  };

  const rememberFootnoteRange = (index: number, element: HTMLElement) => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    if (!element.contains(range.commonAncestorContainer)) return;
    savedFootnoteRangeRef.current = { index, range: range.cloneRange() };
    lastCitationTargetRef.current = 'footnote';
  };

  const restoreFootnoteRange = (index: number): Range | null => {
    const saved = savedFootnoteRangeRef.current;
    if (!saved || saved.index !== index) return null;
    const footnoteEditor = document.querySelector<HTMLElement>(
      `[data-leaf-footnote-editor="${index}"]`,
    );
    if (
      !footnoteEditor ||
      !footnoteEditor.contains(saved.range.startContainer) ||
      !footnoteEditor.contains(saved.range.endContainer)
    ) {
      return null;
    }

    footnoteEditor.focus();
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(saved.range);
    return saved.range.cloneRange();
  };

  const getCitationInsertionTarget = ():
    | { kind: 'body'; range: Range }
    | { element: HTMLElement; index: number; kind: 'footnote'; range: Range }
    | null => {
    const selection = window.getSelection();
    const liveRange = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
    if (liveRange && editableRef.current?.contains(liveRange.commonAncestorContainer)) {
      savedBodyRangeRef.current = liveRange.cloneRange();
      lastCitationTargetRef.current = 'body';
      return { kind: 'body', range: liveRange.cloneRange() };
    }

    if (liveRange) {
      const footnoteEditor = Array.from(
        document.querySelectorAll<HTMLElement>('[data-leaf-footnote-editor]'),
      ).find((element) => element.contains(liveRange.commonAncestorContainer));
      if (footnoteEditor) {
        const index = Number(footnoteEditor.dataset.leafFootnoteEditor);
        lastCitationTargetRef.current = 'footnote';
        return { element: footnoteEditor, index, kind: 'footnote', range: liveRange.cloneRange() };
      }
    }

    const saved = savedFootnoteRangeRef.current;
    if (lastCitationTargetRef.current === 'footnote' && saved) {
      const footnoteEditor = document.querySelector<HTMLElement>(
        `[data-leaf-footnote-editor="${saved.index}"]`,
      );
      const range = restoreFootnoteRange(saved.index);
      if (footnoteEditor && range) {
        return { element: footnoteEditor, index: saved.index, kind: 'footnote', range };
      }
    }

    const savedBody = getEditableRange();
    if (savedBody) return { kind: 'body', range: savedBody };
    if (!saved) return null;
    const footnoteEditor = document.querySelector<HTMLElement>(
      `[data-leaf-footnote-editor="${saved.index}"]`,
    );
    const range = restoreFootnoteRange(saved.index);
    if (!footnoteEditor || !range) return null;
    return { element: footnoteEditor, index: saved.index, kind: 'footnote', range };
  };

  const unwrapElement = (element: Element) => {
    const parent = element.parentNode;
    if (!parent) return;
    const first = element.firstChild;
    const last = element.lastChild;
    while (element.firstChild) parent.insertBefore(element.firstChild, element);
    parent.removeChild(element);
    if (first && last) {
      const selection = window.getSelection();
      const range = document.createRange();
      range.setStartBefore(first);
      range.setEndAfter(last);
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
  };

  const findSmallCapsAncestor = (range: Range): Element | null => {
    const start = range.commonAncestorContainer;
    let el = start.nodeType === Node.ELEMENT_NODE ? (start as Element) : start.parentElement;
    while (el && el !== editableRef.current) {
      if (el.tagName.toLowerCase() === 'hi' && el.getAttribute('rend') === 'small-caps') {
        return el;
      }
      el = el.parentElement;
    }
    return null;
  };

  const toggleSmallCaps = () => {
    const range = getEditableRange();
    if (!range) return;

    // Already inside a small-caps <hi>: toggle it off by unwrapping.
    const ancestor = findSmallCapsAncestor(range);
    if (ancestor) {
      unwrapElement(ancestor);
      return;
    }

    // Selection contains small-caps <hi> elements: unwrap those.
    const contained = Array.from(
      editableRef.current?.querySelectorAll('hi[rend="small-caps"]') ?? [],
    ).filter((hi) => range.intersectsNode(hi));
    if (contained.length > 0) {
      for (const hi of contained) unwrapElement(hi);
      return;
    }

    if (range.collapsed) return;

    const wrapper = document.createElement('hi');
    wrapper.setAttribute('rend', 'small-caps');
    wrapper.appendChild(range.extractContents());
    range.insertNode(wrapper);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    const nextRange = document.createRange();
    nextRange.selectNodeContents(wrapper);
    selection?.addRange(nextRange);
  };

  const removeAllFormatting = () => {
    const range = getEditableRange();
    if (!range || range.collapsed) return;

    document.execCommand('removeFormat');

    // execCommand doesn't know TEI <hi>; unwrap any that intersect the selection.
    const selection = window.getSelection();
    const current = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
    if (!current || !editableRef.current) return;
    for (const hi of Array.from(editableRef.current.querySelectorAll('hi'))) {
      if (current.intersectsNode(hi)) unwrapElement(hi);
    }
  };

  const findAncestorTag = (range: Range, tagName: string): Element | null => {
    const start = range.commonAncestorContainer;
    let el = start.nodeType === Node.ELEMENT_NODE ? (start as Element) : start.parentElement;
    while (el && el !== editableRef.current) {
      if (el.tagName.toLowerCase() === tagName) return el;
      el = el.parentElement;
    }
    return null;
  };

  const selectContents = (element: Node) => {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(element);
    selection?.removeAllRanges();
    selection?.addRange(range);
  };

  const openLinkDialog = () => {
    const range = getEditableRange();
    if (!range) return;
    savedRangeRef.current = range.cloneRange();
    // Editing an existing link: prefill its target.
    const existingRef = findAncestorTag(range, 'ref');
    setLinkUrl(existingRef?.getAttribute('target') ?? '');
    setLinkDialogOpen(true);
  };

  const applyLink = () => {
    setLinkDialogOpen(false);
    const url = linkUrl.trim();
    const saved = savedRangeRef.current;
    savedRangeRef.current = null;
    if (!saved || !editableRef.current) return;

    editableRef.current.focus();
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(saved);

    const existingRef = findAncestorTag(saved, 'ref');
    if (existingRef) {
      // Empty URL removes the link, otherwise update it.
      if (!url) unwrapElement(existingRef);
      else existingRef.setAttribute('target', url);
      return;
    }

    if (!url) return;

    const wrapper = document.createElement('ref');
    wrapper.setAttribute('target', url);
    if (saved.collapsed) {
      // No selection: insert the URL itself as the link text, like Word does.
      wrapper.textContent = url;
      saved.insertNode(wrapper);
    } else {
      wrapper.appendChild(saved.extractContents());
      saved.insertNode(wrapper);
    }
    selectContents(wrapper);
  };

  const insertFootnote = () => {
    const range = getEditableRange();
    if (!range) return;

    // Optional Word-like "footnote from selection": only when the selection is
    // short. A long selection usually means the caret accidentally selected the
    // rest of the paragraph — that used to swallow body text into the note.
    let initialHtml = '';
    if (!range.collapsed) {
      const selectedText = range.toString();
      if (selectedText.length > 0 && selectedText.length <= 80) {
        const extracted = range.extractContents();
        const holder = document.createElement('div');
        holder.appendChild(extracted);
        initialHtml = holder.innerHTML;
      } else {
        range.collapse(true);
      }
    }

    const note = document.createElement('note');
    note.setAttribute('place', 'foot');
    note.setAttribute('contenteditable', 'false');

    const mark = document.createElement('span');
    mark.setAttribute(FN_MARK_ATTR, 'true');
    mark.setAttribute('contenteditable', 'false');
    mark.textContent = '1';

    const body = document.createElement('span');
    body.setAttribute(FN_BODY_ATTR, 'true');
    if (initialHtml) body.innerHTML = initialHtml;

    note.appendChild(mark);
    note.appendChild(body);
    range.insertNode(note);

    // Guard node after the note so the next keystroke cannot be absorbed into it.
    const guard = document.createTextNode('\u200B');
    note.after(guard);
    const selection = window.getSelection();
    const after = document.createRange();
    after.setStartAfter(guard);
    after.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(after);

    const notes = Array.from(editableRef.current?.querySelectorAll('note') ?? []);
    focusFootnoteIndexRef.current = notes.indexOf(note);
    refreshFootnotes();
  };

  const chooseCitationStyleForFirstReference = async (
    bridge: DesktopCitationBridge,
  ): Promise<string | null> => {
    if (pendingCitationStyle) return pendingCitationStyle;
    if (translationMode.citationStyle) return translationMode.citationStyle;

    return openCitationStylePicker(bridge);
  };

  const openCitationStylePicker = async (
    bridge: DesktopCitationBridge,
    initialStyleId = pendingCitationStyle || translationMode.citationStyle || undefined,
  ): Promise<string | null> => {
    let defaultStyleId: string;
    let options: Awaited<ReturnType<DesktopCitationBridge['getCitationStyleOptions']>>['options'];
    try {
      const result = await bridge.getCitationStyleOptions();
      defaultStyleId = result.defaultStyleId;
      options = result.options;
    } catch {
      setAiStatus({ severity: 'error', message: t('LW.translationPane.zoteroPrefsLoadFailed') });
      return null;
    }

    const fallbackStyleId = options[0]?.id ?? defaultStyleId;
    setCitationStyleChoices(options);
    setPendingCitationStyle(initialStyleId ?? fallbackStyleId);
    setCitationStylePickerOpen(true);

    const styleId = await new Promise<string | null>((resolve) => {
      citationStyleResolveRef.current = resolve;
    });
    citationStyleResolveRef.current = null;
    setCitationStylePickerOpen(false);

    if (!styleId) {
      setPendingCitationStyle('');
      return null;
    }

    const saved = await bridge.setCitationStyle(styleId);
    if (!saved) {
      setAiStatus({ severity: 'error', message: t('LW.translationPane.citationStyleSaveFailed') });
      setPendingCitationStyle('');
      return null;
    }

    setPendingCitationStyle(styleId);
    return styleId;
  };

  const createRenderedCitation = (
    pick: ZoteroCaywPick,
    biblId: string,
    styleId: string | undefined,
  ): HTMLElement | null => {
    const bridge = getCitationBridge();
    if (!bridge) return null;

    const bibl = document.createElement('bibl');
    bibl.setAttribute('type', 'zotero-ref');
    bibl.setAttribute('contenteditable', 'false');
    bibl.setAttribute('data-leaf-citation-field', 'true');
    bibl.setAttribute('title', 'Zotero citation');
    bibl.setAttribute('corresp', `#${biblId}`);
    if (pick.locator) bibl.setAttribute('data-locator', pick.locator);
    if (pick.label) bibl.setAttribute('data-locator-type', pick.label);
    if (pick.prefix) bibl.setAttribute('data-prefix', pick.prefix);
    if (pick.suffix) bibl.setAttribute('data-suffix', pick.suffix);
    bibl.innerHTML = bridge.renderCitation({
      item: pick.csl,
      styleId,
      lang: translationMode.lang ?? undefined,
      locator: pick.locator,
      locatorType: pick.label,
      prefix: pick.prefix,
      suffix: pick.suffix,
    });
    return bibl;
  };

  const insertFragmentAtRange = (range: Range, fragment: DocumentFragment): ChildNode | null => {
    range.deleteContents();
    const lastInserted = fragment.lastChild;
    range.insertNode(fragment);

    if (lastInserted) {
      const selection = window.getSelection();
      const after = document.createRange();
      after.setStartAfter(lastInserted);
      after.collapse(true);
      selection?.removeAllRanges();
      selection?.addRange(after);
    }

    return lastInserted;
  };

  const insertZoteroCitation = async () => {
    const bridge = getCitationBridge();
    if (!bridge) {
      setAiStatus({
        severity: 'error',
        message: t('LW.translationPane.zoteroCitationsUnavailable'),
      });
      return;
    }

    const doc = docRef.current;
    if (!doc || !alignmentUnit || !sourcePath || !selectedUnitId || !translationPath) {
      setAiStatus({
        severity: 'error',
        message: t('LW.translationPane.selectTranslationUnitFirst'),
      });
      return;
    }

    const insertionTarget = getCitationInsertionTarget();
    if (!insertionTarget) return;

    setAiStatus({ severity: 'info', message: t('LW.translationPane.waitingForZoteroCitation') });
    zoteroStatusTimeoutRef.current = setTimeout(() => {
      setAiStatus(null);
      zoteroStatusTimeoutRef.current = null;
    }, 30_000);
    const result = await bridge.pickZoteroCitation();
    if (zoteroStatusTimeoutRef.current) {
      clearTimeout(zoteroStatusTimeoutRef.current);
      zoteroStatusTimeoutRef.current = null;
    }
    if (!result.ok) {
      if (!result.cancelled) {
        setAiStatus({
          severity: 'error',
          message: result.error ?? t('LW.translationPane.zoteroCitationFailed'),
        });
      } else {
        setAiStatus(null);
      }
      return;
    }

    const styleId = await chooseCitationStyleForFirstReference(bridge);
    if (!styleId) {
      setAiStatus(null);
      return;
    }

    const fragment = document.createDocumentFragment();
    result.picks.forEach((pick, index) => {
      const biblId = bridge.upsertBiblEntry(doc, pick.csl, pick.uri);
      const bibl = createRenderedCitation(pick, biblId, styleId);
      if (!bibl) return;
      if (index > 0) fragment.appendChild(document.createTextNode('; '));
      fragment.appendChild(bibl);
    });

    if (insertionTarget.kind === 'footnote') {
      insertionTarget.element.focus();
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(insertionTarget.range);
      insertFragmentAtRange(insertionTarget.range, fragment);
      prepareAtomicCitationFields(insertionTarget.element, zoteroCitationLabel);
      updateFootnote(insertionTarget.index, insertionTarget.element.innerHTML);
      rememberFootnoteRange(insertionTarget.index, insertionTarget.element);
    } else {
      editableRef.current?.focus();
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(insertionTarget.range);
      insertFragmentAtRange(insertionTarget.range, fragment);
      rememberBodyRange();
    }

    renderCitationRefs(doc);
    refreshFootnotes();
    await persist();
    setAiStatus(null);
  };

  const insertEntityMention = async (
    entityId: string,
    options?: {
      replace?: { textNode: Text; start: number; end: number };
      mention?: MentionContext;
    },
  ) => {
    const editable = editableRef.current;
    if (!editable) return;

    // Snapshot the caret *before* any await or focus(). fetchEntitySummary yields to
    // the browser; focusing the contentEditable afterwards invents a caret at the
    // start of the unit, and getEditableRange would then prefer that live (wrong)
    // selection over the range rememberBodyRange saved when the insert menu opened.
    const caretBeforeAwait =
      options?.replace || !editableRef.current
        ? null
        : (() => {
            const live = getEditableRange();
            return live?.cloneRange() ?? null;
          })();

    try {
      const entity = await fetchEntitySummary(entityId);
      if (!entity) {
        notifyViaSnackbar(t('LW.translationPane.entityNotFound', { id: entityId }));
        return;
      }

      let range: Range | null = null;
      if (options?.replace) {
        const { textNode, start, end } = options.replace;
        const value = textNode.nodeValue ?? '';
        if (textNode.parentNode) {
          range = document.createRange();
          range.setStart(textNode, Math.max(0, Math.min(start, value.length)));
          range.setEnd(textNode, Math.max(0, Math.min(end, value.length)));
          range.deleteContents();
        }
      }
      if (
        !range &&
        caretBeforeAwait &&
        editable.contains(caretBeforeAwait.startContainer) &&
        editable.contains(caretBeforeAwait.endContainer)
      ) {
        range = caretBeforeAwait;
        editable.focus();
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
      if (!range) range = getEditableRange();
      if (!range) {
        editable.focus();
        range = document.createRange();
        range.selectNodeContents(editable);
        range.collapse(false);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      }

      const existingCount = Array.from(
        editable.querySelectorAll(`ref[type="${ENTITY_REF_TYPE}"]`),
      ).filter((node) => node.getAttribute('key') === entityId).length;

      const settings = dateFormatSettingsForLang(selectedLanguage);
      const fileOccurrenceIndex = fileOccurrenceIndexForUnitInsert(
        translationDoc,
        alignmentUnit ?? 'p',
        sourcePath ? fileNameOf(sourcePath) : '',
        selectedUnitId ?? '',
        entityId,
        existingCount,
      );

      let field: HTMLElement;
      if (options?.mention) {
        const mention = options.mention;
        const displaySpec = deriveDisplaySpec(
          mention.role,
          fileOccurrenceIndex,
          settings.bracketsPolicy,
        );
        const parts = isCharacterOnlyTranslationTarget(selectedLanguage)
          ? buildCjkMentionParts(
              mention,
              entity,
              fileOccurrenceIndex,
              displaySpec,
              settings,
              selectedLanguage,
            )
          : buildWesternMentionParts(
              mention,
              entity,
              fileOccurrenceIndex,
              displaySpec,
              settings,
              projectSourceLang,
              selectedLanguage,
            );
        field = createMentionFieldElement(entity, mention, parts, displaySpec);
      } else {
        field = createEntityFieldElement(
          entity,
          existingCount + 1,
          EMPTY_DISPLAY_SPEC,
          undefined,
          selectedLanguage,
        );
      }
      range.insertNode(field);
      const guard = document.createTextNode('\u200B');
      field.after(guard);
      const after = document.createRange();
      after.setStartAfter(guard);
      after.collapse(true);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(after);

      recalculateEntityFieldsInRoot(editable, entity.id, entity, undefined, selectedLanguage, {
        translationDoc,
        alignmentUnit: alignmentUnit ?? undefined,
        sourceFileName: sourcePath ? fileNameOf(sourcePath) : undefined,
        unitId: selectedUnitId ?? undefined,
        sourceLang: projectSourceLang,
      });
      setCardsEpoch((epoch) => epoch + 1);
      prepareAtomicEntityFields(editable);
      rememberBodyRange();
      setEntityAcSuggestions([]);
      setEntityAcAnchor(null);
      await persist();
    } catch (error) {
      console.warn('[translation] entity insert failed', error);
      notifyViaSnackbar(
        error instanceof Error
          ? error.message
          : t('LW.translationPane.entityNotFound', { id: entityId }),
      );
    }
  };

  const insertDateMention = (
    input: DateGlossInput,
    replace: { textNode: Text; start: number; end: number },
  ) => {
    const editable = editableRef.current;
    if (!editable) return;
    const { textNode, start, end } = replace;
    if (!textNode.parentNode) return;
    const value = textNode.nodeValue ?? '';
    const range = document.createRange();
    range.setStart(textNode, Math.max(0, Math.min(start, value.length)));
    range.setEnd(textNode, Math.max(0, Math.min(end, value.length)));
    range.deleteContents();

    const field = createDateFieldElement(input, selectedLanguage ?? translationMode.lang);
    range.insertNode(field);
    const guard = document.createTextNode('​');
    field.after(guard);
    const after = document.createRange();
    after.setStartAfter(guard);
    after.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(after);

    prepareAtomicDateFields(editable);
    rememberBodyRange();
    setEntityAcSuggestions([]);
    setEntityAcAnchor(null);
    void persist();
  };

  const dismissEntityAutocomplete = useCallback(() => {
    setEntityAcSuggestions([]);
    setEntityAcAnchor(null);
    setEntityAcIndex(0);
  }, []);

  const refreshEntityAutocomplete = useCallback(() => {
    const selection = window.getSelection();
    const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
    if (!range || !editableRef.current?.contains(range.commonAncestorContainer)) {
      dismissEntityAutocomplete();
      return;
    }
    const suggestions = buildSuggestionsAtCaret(range, entityAcCandidatesRef.current);
    setEntityAcSuggestions(suggestions);
    setEntityAcIndex(0);
    const place = () => {
      const live = window.getSelection();
      const liveRange = live && live.rangeCount > 0 ? live.getRangeAt(0) : range;
      setEntityAcAnchor(suggestions[0] ? caretAnchorPosition(suggestions[0], liveRange) : null);
    };
    place();
    // Collapsed carets sometimes report empty rects until the next frame.
    window.requestAnimationFrame(place);
  }, [dismissEntityAutocomplete]);

  const acceptEntityAutocomplete = async (index?: number) => {
    const suggestion = entityAcSuggestionsRef.current[index ?? entityAcIndexRef.current];
    if (!suggestion) return;
    dismissEntityAutocomplete();

    if (suggestion.candidate.kind === 'date') {
      const hit = dateAcHitsRef.current.get(suggestion.candidate.id);
      if (!hit) return;
      insertDateMention(hit.input, {
        textNode: suggestion.textNode,
        start: suggestion.replaceStart,
        end: suggestion.replaceEnd,
      });
      return;
    }

    await insertEntityMention(suggestion.candidate.id, {
      replace: {
        textNode: suggestion.textNode,
        start: suggestion.replaceStart,
        end: suggestion.replaceEnd,
      },
      mention:
        suggestion.candidate.mentionIndex != null
          ? mentionManifestRef.current.find(
              (row) =>
                row.index === suggestion.candidate.mentionIndex &&
                row.key === suggestion.candidate.id,
            )
          : undefined,
    });
  };

  const openEntityMenu = (anchor: HTMLElement) => {
    if (!alignmentUnit || !selectedUnitId) {
      notifyViaSnackbar(t('LW.translationPane.entityNeedUnit'));
      return;
    }
    // Snapshot the caret now, before the Menu opens and steals focus (it auto-focuses
    // its own content for keyboard nav) — insertEntityMention falls back to this saved
    // range once the live selection is gone, which happens as soon as the menu mounts.
    rememberBodyRange();
    setSourceMentions(mentionManifestRef.current);
    setEntityPickerQuery('');
    setEntityPickerResults([]);
    setEntityPickerSearching(false);
    setEntityMenuAnchor(anchor);
  };

  useEffect(() => {
    if (!entityMenuAnchor) return;
    const query = entityPickerQuery.trim();
    if (query.length < 1) {
      setEntityPickerResults([]);
      setEntityPickerSearching(false);
      return;
    }
    const seq = ++entityPickerSearchSeqRef.current;
    setEntityPickerSearching(true);
    const handle = window.setTimeout(() => {
      void searchEntitiesForPicker(query)
        .then((hits) => {
          if (seq !== entityPickerSearchSeqRef.current) return;
          setEntityPickerResults(hits);
        })
        .catch((error) => {
          console.warn('[translation] entity picker search failed', error);
          if (seq !== entityPickerSearchSeqRef.current) return;
          setEntityPickerResults([]);
        })
        .finally(() => {
          if (seq === entityPickerSearchSeqRef.current) setEntityPickerSearching(false);
        });
    }, 200);
    return () => window.clearTimeout(handle);
  }, [entityMenuAnchor, entityPickerQuery]);

  const resolveEntityFieldTarget = (clicked: Element): Element | null => {
    const editable = editableRef.current;
    if (!editable) return null;
    if (editable.contains(clicked)) return clicked;

    const footnoteEditor = clicked.closest('[data-leaf-footnote-editor]');
    if (!(footnoteEditor instanceof HTMLElement)) return null;
    const index = Number(footnoteEditor.getAttribute('data-leaf-footnote-editor'));
    if (!Number.isFinite(index)) return null;
    const note = editable.querySelectorAll('note')[index];
    if (!note) return null;
    const key = clicked.getAttribute('key');
    if (!key) return null;
    const editorRefs = Array.from(
      footnoteEditor.querySelectorAll(`ref[type="${ENTITY_REF_TYPE}"]`),
    ).filter((node) => node.getAttribute('key') === key);
    const noteRefs = Array.from(note.querySelectorAll(`ref[type="${ENTITY_REF_TYPE}"]`)).filter(
      (node) => node.getAttribute('key') === key,
    );
    const localIndex = editorRefs.indexOf(clicked);
    return noteRefs[localIndex] ?? noteRefs[0] ?? null;
  };

  const occurrenceIndexForField = (field: Element): number => {
    const editable = editableRef.current;
    const key = field.getAttribute('key');
    if (!editable || !key) return 1;
    const fields = Array.from(editable.querySelectorAll(`ref[type="${ENTITY_REF_TYPE}"]`)).filter(
      (node) => node.getAttribute('key') === key,
    );
    const index = fields.indexOf(field);
    return index >= 0 ? index + 1 : 1;
  };

  const openEntityFormatPopup = async (event: ReactMouseEvent, clicked: Element) => {
    const field = resolveEntityFieldTarget(clicked);
    const key = field?.getAttribute('key');
    if (!field || !key) return;

    event.preventDefault();
    event.stopPropagation();

    const entity = await fetchEntitySummary(key);
    if (!entity) {
      notifyViaSnackbar(t('LW.translationPane.entityNotFound', { id: key }));
      return;
    }

    entityFormatFieldRef.current = field;
    setEntityFormatEntity(entity);
    setEntityFormatSpec(readDisplaySpecFromField(field));
    setEntityFormatOccurrence(occurrenceIndexForField(field));
    setEntityFormatAnchor({ top: event.clientY, left: event.clientX });
    setEntityFormatOpen(true);
  };

  const handleEntityFieldContextMenu = (event: ReactMouseEvent<HTMLElement>) => {
    const target = event.target as Node | null;
    const element =
      target?.nodeType === Node.ELEMENT_NODE ? (target as Element) : target?.parentElement;
    const ref = element?.closest?.(`ref[${ENTITY_FIELD_ATTR}="true"]`);
    if (!ref) return;
    void openEntityFormatPopup(event, ref);
  };

  const applyEntityDisplaySpec = async (spec: EntityDisplaySpec) => {
    const field = entityFormatFieldRef.current;
    const entity = entityFormatEntity;
    const editable = editableRef.current;
    if (!field || !entity || !editable) return;

    writeDisplaySpecToField(field, spec);
    setEntityFormatSpec(spec);
    recalculateEntityFieldsInRoot(editable, entity.id, entity, undefined, selectedLanguage, {
      sourceLang: projectSourceLang,
    });
    prepareAtomicEntityFields(editable);
    refreshFootnotes();
    setEntityFormatOccurrence(occurrenceIndexForField(field));
    await persist();
  };

  const saveEntityTranslationFromPopup = async (text: string, lang: string): Promise<boolean> => {
    const entity = entityFormatEntity;
    const editable = editableRef.current;
    if (!entity) return false;
    const store = entityStoreFromDesktop();
    if (!store || !(await store.hasSqliteDatabase())) return false;
    try {
      await store.sqliteAddName({
        entityId: entity.id,
        text,
        nameType: 'translation',
        language: lang,
      });
      const refreshed = await fetchEntitySummary(entity.id);
      if (!refreshed) return false;
      setEntityFormatEntity(refreshed);
      if (editable) {
        recalculateEntityFieldsInRoot(
          editable,
          refreshed.id,
          refreshed,
          undefined,
          selectedLanguage,
          { sourceLang: projectSourceLang },
        );
        prepareAtomicEntityFields(editable);
        refreshFootnotes();
        await persist();
      }
      return true;
    } catch {
      return false;
    }
  };

  const suggestEntityTranslationFromPopup = async (): Promise<string | null> => {
    if (!isAiUiFeatureEnabled('entityGlossSuggest')) return null;
    const entity = entityFormatEntity;
    const lang = selectedLanguage?.trim();
    if (!entity || !lang) return null;
    const api = getDesktopApi();
    if (!api?.suggestEntityGloss) return null;
    try {
      const result = await api.suggestEntityGloss({
        kind: entity.kind,
        primaryName: entity.primaryName,
        romanizedName: entity.romanizedName,
        chineseName: chineseNameOf(entity),
        description: entity.description,
        targetLanguage: lang,
      });
      if (!result.ok || !result.gloss?.trim()) return null;
      return result.gloss.trim();
    } catch {
      return null;
    }
  };

  const resetEntityDisplaySpec = async () => {
    await applyEntityDisplaySpec({ ...EMPTY_DISPLAY_SPEC });
  };

  const closeEntityFormatPopup = () => {
    setEntityFormatOpen(false);
    entityFormatFieldRef.current = null;
  };

  /** Paste/drop a palaeographic character image into the translation pane
   * or a footnote - the plain-DOM counterpart to the main editor's own
   * glyph paste/drop handling (see translationGlyphs.ts for why this can't
   * just reuse that code). Always returns true/false for "handled it",
   * never falls through to the normal text/html paste path once an image
   * has been recognized, matching the main editor's own contract. */
  const handleTranslationImageDrop = async (
    currentTarget: HTMLElement,
    range: Range,
    source: { file: File } | { url: string } | { dataUrl: string } | null,
    onInserted?: () => void,
  ): Promise<boolean> => {
    if (!source) return false;

    const reason = translationGlyphImageUnavailableReason(translationPath);
    if (reason) {
      notifyViaSnackbar(t(reason));
      return true;
    }

    try {
      const inserted =
        'file' in source
          ? await insertTranslationGlyphFromImageFile(translationPath!, source.file, range)
          : 'dataUrl' in source
            ? await insertTranslationGlyphFromDataUrl(translationPath!, source.dataUrl, range)
            : await insertTranslationGlyphFromRemoteImageUrl(translationPath!, source.url, range);
      if (!inserted) {
        notifyViaSnackbar(t('LW.translationPane.glyphInsertFailed'));
        return true;
      }

      prepareAtomicGlyphFields(currentTarget, translationPath);
      refreshFootnotes();
      onInserted?.();
    } catch (error) {
      // Surface the failure rather than a silent no-op (previously: an
      // unhandled rejection here just vanished, and pasting/dropping a
      // glyph image appeared to do nothing at all).
      console.warn('[translation] glyph image insert failed', error);
      notifyViaSnackbar(t('LW.translationPane.glyphInsertFailed'));
    }
    return true;
  };

  const handleTranslationPaste = (
    event: ClipboardEvent<HTMLElement>,
    options: { target: 'body' | 'footnote'; onImageInserted?: () => void } = { target: 'body' },
  ) => {
    const range = window.getSelection()?.rangeCount ? window.getSelection()?.getRangeAt(0) : null;
    if (!range || !event.currentTarget.contains(range.commonAncestorContainer)) return;

    const clipboard = event.clipboardData;
    const text = clipboard.getData('text/plain');
    // Only treat this as an image paste when there's no plain-text
    // alternative - same gate the main editor uses, so pasting e.g. a
    // formatted Word paragraph (which can also carry an embedded image
    // representation) doesn't get hijacked into a bare glyph insert.
    const imageFile = !text.trim() ? getClipboardImageFile(clipboard) : null;
    if (imageFile) {
      event.preventDefault();
      const currentTarget = event.currentTarget;
      void handleTranslationImageDrop(
        currentTarget,
        range,
        { file: imageFile },
        options.onImageInserted,
      );
      return;
    }

    event.preventDefault();
    const html = clipboard.getData('text/html');
    const container = document.createElement('div');
    if (html) container.innerHTML = html;
    else container.textContent = text;

    sanitizeTranslationFragment(container, zoteroCitationLabel);
    if (options.target === 'footnote') {
      unwrapElementsByTagName(container, 'note');
    }

    const fragment = document.createDocumentFragment();
    while (container.firstChild) fragment.appendChild(container.firstChild);
    insertFragmentAtRange(range, fragment);
    sanitizeTranslationFragment(event.currentTarget, zoteroCitationLabel);
    prepareAtomicGlyphFields(event.currentTarget, translationPath);
    applyEditorialCleanupToRootPreservingSelection(event.currentTarget, selectedLanguage);
    refreshFootnotes();
  };

  /** Dropping an image is the drag-and-drop counterpart to pasting one.
   * There's no existing drop handling at all in this pane to extend - this
   * adds it, image-only, mirroring the main editor's own drop handler. A
   * drag can carry an image three different ways depending on its source -
   * a real OS file, a self-contained `data:` URI (another in-app/in-page
   * image), or a remote URL (dragged off a live web page) - tried in that
   * order. If none of those can be read but the drag still looks like an
   * image (an `<img>` present in the dragged HTML with an unreadable src,
   * e.g. a local `file://` path with no OS-provided `File` object), this
   * still blocks the browser's default handling and reports a clear
   * failure rather than letting an unvectorized, full-size image slip
   * through as a fallback - a dropped non-image falls through to the
   * browser's default contentEditable drop behaviour untouched, same as
   * before this existed. */
  const handleTranslationDrop = (event: DragEvent<HTMLElement>, onInserted?: () => void) => {
    const dataTransfer = event.dataTransfer;
    if (!dataTransfer) return;

    const imageFile = getDroppedImageFile(dataTransfer);
    const dataUrl = !imageFile ? getDraggedImageDataUrl(dataTransfer) : null;
    const imageUrl = !imageFile && !dataUrl ? getDraggedImageUrl(dataTransfer) : null;
    const unreadable =
      !imageFile && !dataUrl && !imageUrl && hasUnreadableDraggedImage(dataTransfer);
    if (!imageFile && !dataUrl && !imageUrl && !unreadable) return;

    event.preventDefault();
    if (unreadable) {
      notifyViaSnackbar(t('LW.translationPane.glyphInsertFailed'));
      return;
    }

    const range = document.caretRangeFromPoint?.(event.clientX, event.clientY) ?? null;
    if (!range || !event.currentTarget.contains(range.commonAncestorContainer)) return;

    const source = imageFile
      ? { file: imageFile }
      : dataUrl
        ? { dataUrl }
        : imageUrl
          ? { url: imageUrl }
          : null;
    const currentTarget = event.currentTarget;
    void handleTranslationImageDrop(currentTarget, range, source, onInserted);
  };

  const protectCitationField = (event: SyntheticEvent<HTMLElement>) => {
    const target = event.target as Node | null;
    const element =
      target?.nodeType === Node.ELEMENT_NODE ? (target as Element) : target?.parentElement;
    if (
      element?.closest?.('bibl[data-leaf-citation-field="true"]') ||
      element?.closest?.(`ref[${ENTITY_FIELD_ATTR}="true"]`)
    ) {
      event.preventDefault();
    }
  };

  const updateFootnote = (index: number, html: string) => {
    const note = editableRef.current?.querySelectorAll('note')[index];
    if (!note || !editableRef.current) return;
    normalizeFootnoteNotes(editableRef.current, footnoteStartIndex);
    const body = footnoteBodyOf(note);
    if (!body) return;
    body.innerHTML = html;
    prepareAtomicCitationFields(body, zoteroCitationLabel);
  };

  const removeFootnote = (index: number) => {
    const note = editableRef.current?.querySelectorAll('note')[index];
    if (!note) return;
    note.remove();
    refreshFootnotes();
    void persist();
  };

  const applyFormat = (
    command:
      | 'bold'
      | 'italic'
      | 'underline'
      | 'strikeThrough'
      | 'superscript'
      | 'subscript'
      | 'smallCaps'
      | 'removeFormat'
      | 'link',
  ) => {
    if (command === 'smallCaps') {
      toggleSmallCaps();
      return;
    }
    if (command === 'removeFormat') {
      removeAllFormatting();
      return;
    }
    if (command === 'link') {
      openLinkDialog();
      return;
    }
    editableRef.current?.focus();
    document.execCommand(command);
  };

  if (!translationMode.active) return null;

  const languageOptions = languageState?.languages ?? [];
  const spellcheckLang = selectedLanguage || undefined;

  const toggleSpellcheck = () => {
    setSpellcheckEnabled((previous) => {
      const next = !previous;
      writeSpellcheckEnabled(next);
      return next;
    });
  };
  const shortcut = (macShortcut: string, otherShortcut: string) =>
    mac ? macShortcut : otherShortcut;

  const handleZoteroRefresh = async () => {
    setZoteroMenuAnchor(null);
    await refreshCurrentCitationFields();
    notifyViaSnackbar(t('LW.translationPane.zoteroMenu.refreshing'));
  };

  const handleZoteroPreferences = async () => {
    setZoteroMenuAnchor(null);
    const bridge = getCitationBridge();
    if (!bridge) {
      setAiStatus({ severity: 'error', message: t('LW.translationPane.zoteroMenu.unavailable') });
      return;
    }
    const styleId = await openCitationStylePicker(bridge);
    if (styleId) await refreshCurrentCitationFields(styleId);
  };

  const toolbarDivider = (
    <Divider
      orientation="vertical"
      flexItem
      sx={{ alignSelf: 'center', height: 18, mx: 0.25, borderColor: 'divider' }}
    />
  );

  const formatItems: {
    command:
      | 'bold'
      | 'italic'
      | 'underline'
      | 'strikeThrough'
      | 'smallCaps'
      | 'superscript'
      | 'subscript'
      | 'removeFormat'
      | 'link';
    icon: ReactNode;
    label: string;
    shortcut: string;
  }[] = [
    {
      command: 'bold',
      icon: <FormatBoldIcon fontSize="small" />,
      label: t('LW.translationPane.formatItems.bold'),
      shortcut: shortcut('⌘B', 'Ctrl+B'),
    },
    {
      command: 'italic',
      icon: <FormatItalicIcon fontSize="small" />,
      label: t('LW.translationPane.formatItems.italic'),
      shortcut: shortcut('⌘I', 'Ctrl+I'),
    },
    {
      command: 'underline',
      icon: <FormatUnderlinedIcon fontSize="small" />,
      label: t('LW.translationPane.formatItems.underline'),
      shortcut: shortcut('⌘U', 'Ctrl+U'),
    },
    {
      command: 'strikeThrough',
      icon: <FormatStrikethroughIcon fontSize="small" />,
      label: t('LW.translationPane.formatItems.strikethrough'),
      shortcut: shortcut('⌥⇧5', 'Alt+Shift+5'),
    },
    {
      command: 'smallCaps',
      icon: <TextFieldsIcon fontSize="small" />,
      label: t('LW.translationPane.formatItems.smallCaps'),
      shortcut: shortcut('⌘⇧K', 'Ctrl+Shift+K'),
    },
    {
      command: 'superscript',
      icon: <SuperscriptIcon fontSize="small" />,
      label: t('LW.translationPane.formatItems.superscript'),
      shortcut: shortcut('⌘.', 'Ctrl+.'),
    },
    {
      command: 'subscript',
      icon: <SubscriptIcon fontSize="small" />,
      label: t('LW.translationPane.formatItems.subscript'),
      shortcut: shortcut('⌘,', 'Ctrl+,'),
    },
    {
      command: 'link',
      icon: <LinkIcon fontSize="small" />,
      label: t('LW.translationPane.formatItems.link'),
      shortcut: shortcut('⌘K', 'Ctrl+K'),
    },
    {
      command: 'removeFormat',
      icon: <FormatClearIcon fontSize="small" />,
      label: t('LW.translationPane.formatItems.clearFormatting'),
      shortcut: shortcut('⌘M', 'Ctrl+M'),
    },
  ];

  const toolbarInRightPanel = Boolean(desktopToolbarSlot);

  const translationToolbar = (
    <Stack
      direction="row"
      alignItems="center"
      spacing={0.5}
      sx={{
        minWidth: 0,
        flex: toolbarInRightPanel ? 1 : undefined,
        overflow: 'hidden',
        ...(toolbarInRightPanel
          ? { py: 0, px: 0 }
          : { p: 0.5, borderBottom: 1, borderColor: 'divider' }),
      }}
    >
      {languageOptions.length > 0 ? (
        <Select
          disabled={languageState?.indexing}
          onChange={(event) => languageState?.setSelectedLang(String(event.target.value))}
          size="small"
          sx={{
            flex: '0 0 auto',
            minWidth: 48,
            // Compact lang code chip — hide the default dropdown caret.
            '& .MuiSelect-icon': { display: 'none' },
            '& .MuiSelect-select': { px: 1, py: 0.5, pr: '8px !important' },
          }}
          value={
            languageOptions.some((lang) => lang.code === selectedLanguage)
              ? selectedLanguage
              : languageOptions[0]!.code
          }
        >
          {languageOptions.map((lang) => (
            <MenuItem key={lang.code} value={lang.code}>
              {lang.code}
            </MenuItem>
          ))}
        </Select>
      ) : (
        <Typography
          noWrap
          variant="caption"
          sx={{
            border: 1,
            borderColor: 'divider',
            borderRadius: 1,
            flex: '0 0 auto',
            minWidth: 48,
            px: 1,
            py: 0.5,
            textAlign: 'center',
          }}
        >
          {selectedLanguage || '--'}
        </Typography>
      )}

      <Tooltip title={t('LW.translationPane.copyForExport')}>
        <span>
          <IconButton
            disabled={!selectedUnitId}
            onClick={() => {
              if (!selectedUnitId) return;
              void copyUnitsForExport({
                translationMode: { alignmentUnit, sourcePath, translationPath },
                unitIds: [selectedUnitId],
                translationDoc,
                notify: (message) => notifyViaSnackbar(message),
              }).catch((error) => {
                notifyViaSnackbar(
                  t('LW.translationPane.copyFailed', {
                    error: error instanceof Error ? error.message : String(error),
                  }),
                );
              });
            }}
            size="small"
          >
            <ContentCopyIcon fontSize="small" />
          </IconButton>
        </span>
      </Tooltip>

      <Tooltip
        title={
          languageToolLive
            ? t('LW.translationPane.spellcheckOffForLiveLt')
            : spellcheckEnabled
              ? t('LW.translationPane.disableSpellcheck')
              : t('LW.translationPane.enableSpellcheck')
        }
      >
        <span>
          <IconButton
            aria-pressed={spellcheckEnabled && !languageToolLive}
            color={spellcheckEnabled && !languageToolLive ? 'primary' : 'default'}
            disabled={languageToolLive}
            onClick={toggleSpellcheck}
            size="small"
          >
            <SpellcheckIcon fontSize="small" />
          </IconButton>
        </span>
      </Tooltip>

      <Tooltip
        title={
          languageToolEnabled
            ? t('LW.translationPane.languageToolCheck')
            : t('LW.translationPane.languageToolDisabled')
        }
      >
        <span>
          <IconButton
            aria-label={t('LW.translationPane.languageToolCheck')}
            color={languageToolMatches.length > 0 ? 'primary' : 'default'}
            disabled={!selectedUnitId || languageToolChecking}
            onClick={() => void runLanguageToolCheck()}
            size="small"
          >
            {languageToolChecking ? (
              <CircularProgress size={18} />
            ) : (
              <FactCheckIcon fontSize="small" />
            )}
          </IconButton>
        </span>
      </Tooltip>

      <Tooltip title={t('LW.translationPane.insertEntity')}>
        <span>
          <IconButton
            aria-controls={entityMenuAnchor ? 'translation-entity-menu' : undefined}
            aria-haspopup="menu"
            disabled={!selectedUnitId}
            onMouseDown={(event) => event.preventDefault()}
            onClick={(event) => openEntityMenu(event.currentTarget)}
            size="small"
          >
            <PersonOutlineIcon fontSize="small" />
          </IconButton>
        </span>
      </Tooltip>

      <Menu
        anchorEl={entityMenuAnchor}
        id="translation-entity-menu"
        onClose={() => setEntityMenuAnchor(null)}
        open={Boolean(entityMenuAnchor)}
        slotProps={{
          paper: { sx: { width: 360, maxHeight: 420 } },
          list: { sx: { py: 0 } },
        }}
      >
        <Box onKeyDown={(event) => event.stopPropagation()} sx={{ px: 1.5, pt: 1.25, pb: 1 }}>
          <TextField
            autoFocus
            fullWidth
            placeholder={t('LW.translationPane.entityPickerSearch')}
            size="small"
            value={entityPickerQuery}
            onChange={(event) => setEntityPickerQuery(event.target.value)}
          />
        </Box>

        {sourceMentions.length > 0 ? (
          <ListSubheader disableSticky sx={{ lineHeight: 2 }}>
            {t('LW.translationPane.entityPickerFromUnit')}
          </ListSubheader>
        ) : null}
        {sourceMentions.map((mention) => (
          <MenuItem
            key={`unit-${mention.index}-${mention.key}`}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              setEntityMenuAnchor(null);
              void insertEntityMention(mention.key, { mention });
            }}
          >
            <ListItemText
              primary={mention.surface || mention.key}
              secondary={`${mention.role} · ${mention.kind} · ${mention.key}`}
            />
          </MenuItem>
        ))}

        {entityPickerQuery.trim().length > 0 && (
          <ListSubheader disableSticky sx={{ lineHeight: 2 }}>
            {entityPickerSearching
              ? t('LW.translationPane.entityPickerSearching')
              : t('LW.translationPane.entityPickerAllEntities')}
          </ListSubheader>
        )}
        {entityPickerQuery.trim().length > 0 &&
          !entityPickerSearching &&
          entityPickerResults.length === 0 && (
            <MenuItem disabled>{t('LW.translationPane.entityPickerNoResults')}</MenuItem>
          )}
        {entityPickerResults.map((hit) => (
          <MenuItem
            key={`${hit.source}-${hit.id}`}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              setEntityMenuAnchor(null);
              void insertEntityMention(hit.id);
            }}
          >
            <ListItemText
              primary={hit.label || hit.id}
              secondary={
                hit.description
                  ? `${hit.kind} · ${hit.source} · ${hit.description}`
                  : `${hit.kind} · ${hit.source} · ${hit.id}`
              }
            />
          </MenuItem>
        ))}

        {sourceMentions.length === 0 && entityPickerQuery.trim().length === 0 && (
          <MenuItem disabled>{t('LW.translationPane.entityPickerTypeToSearch')}</MenuItem>
        )}
      </Menu>

      {toolbarDivider}

      <Tooltip title={t('LW.translationPane.insertFootnote')}>
        <span>
          <IconButton disabled={!selectedUnitId} onClick={insertFootnote} size="small">
            <StickyNote2Icon fontSize="small" />
          </IconButton>
        </span>
      </Tooltip>

      {toolbarDivider}

      <Tooltip title={t('LW.translationPane.refreshEntityAnchors')}>
        <span>
          <IconButton onClick={refreshEntityAnchors} size="small">
            <RefreshIcon fontSize="small" />
          </IconButton>
        </span>
      </Tooltip>

      {toolbarDivider}

      <Tooltip title={t('LW.translationPane.zoteroMenu.title')}>
        <span>
          <IconButton
            aria-controls={zoteroMenuAnchor ? 'translation-zotero-menu' : undefined}
            aria-haspopup="menu"
            onClick={(event) => setZoteroMenuAnchor(event.currentTarget)}
            size="small"
          >
            <ZoteroIcon sx={{ width: 20, height: 20 }} />
          </IconButton>
        </span>
      </Tooltip>

      <Menu
        anchorEl={zoteroMenuAnchor}
        id="translation-zotero-menu"
        onClose={() => setZoteroMenuAnchor(null)}
        open={Boolean(zoteroMenuAnchor)}
      >
        <MenuItem onClick={() => void handleZoteroRefresh()}>
          <ListItemIcon>
            <RefreshIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText primary={t('LW.translationPane.zoteroMenu.refresh')} />
        </MenuItem>
        <MenuItem onClick={() => void handleZoteroPreferences()}>
          <ListItemIcon>
            <SettingsIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText primary={t('LW.translationPane.zoteroMenu.preferences')} />
        </MenuItem>
      </Menu>

      <Tooltip title={t('LW.translationPane.formatItems.zoteroCitation')}>
        <span>
          <IconButton
            disabled={!selectedUnitId}
            onClick={() => void insertZoteroCitation()}
            size="small"
          >
            <FormatQuoteIcon fontSize="small" />
          </IconButton>
        </span>
      </Tooltip>

      {isAiUiFeatureEnabled('translationGenerate') && (
        <>
          {toolbarDivider}

          <Button
            aria-controls={aiMenuAnchor ? 'translation-ai-menu' : undefined}
            aria-haspopup="menu"
            disabled={!selectedUnitId}
            onClick={(event) => setAiMenuAnchor(event.currentTarget)}
            size="small"
            sx={{ flexShrink: 0, fontWeight: 600, minWidth: 0, px: 1, textTransform: 'none' }}
            variant="text"
          >
            {generating ? <CircularProgress size={16} /> : 'AI'}
          </Button>

          <Menu
            anchorEl={aiMenuAnchor}
            id="translation-ai-menu"
            onClose={() => setAiMenuAnchor(null)}
            open={Boolean(aiMenuAnchor)}
          >
            <MenuItem
              disabled={generating}
              onClick={() => {
                setAiMenuAnchor(null);
                void generateTranslation();
              }}
            >
              <ListItemText primary={t('LW.translationPane.generateTranslation')} />
            </MenuItem>
            <MenuItem
              disabled={generating}
              onClick={() => {
                setAiMenuAnchor(null);
                void translateDocument();
              }}
            >
              <ListItemText primary={t('LW.translationPane.translateDocument')} />
            </MenuItem>
          </Menu>
        </>
      )}

      <Tooltip title={t('LW.translationPane.formatting')}>
        <span>
          <IconButton
            aria-controls={formatAnchor ? 'translation-format-menu' : undefined}
            aria-haspopup="menu"
            disabled={!selectedUnitId}
            onClick={(event) => setFormatAnchor(event.currentTarget)}
            size="small"
          >
            <MoreVertIcon fontSize="small" />
          </IconButton>
        </span>
      </Tooltip>

      <Menu
        anchorEl={formatAnchor}
        id="translation-format-menu"
        onClose={() => setFormatAnchor(null)}
        open={Boolean(formatAnchor)}
      >
        {formatItems.map((item) => (
          <MenuItem
            key={item.command}
            onClick={() => {
              applyFormat(item.command);
              setFormatAnchor(null);
            }}
          >
            <ListItemIcon>{item.icon}</ListItemIcon>
            <ListItemText primary={item.label} />
            <Typography color="text.secondary" sx={{ ml: 3 }} variant="caption">
              {item.shortcut}
            </Typography>
          </MenuItem>
        ))}
      </Menu>
    </Stack>
  );

  // Portal must not be a Box child: MUI PropTypes.node rejects React portals
  // (they are valid React children, but PropTypes.isValidElement is false for them).
  return (
    <>
      {toolbarInRightPanel && desktopToolbarSlot
        ? createPortal(translationToolbar, desktopToolbarSlot)
        : null}
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          borderLeft: toolbarInRightPanel ? 0 : 1,
          borderColor: 'divider',
        }}
      >
        {!toolbarInRightPanel ? translationToolbar : null}

        <Dialog
          fullWidth
          maxWidth="xs"
          onClose={() => {
            setLinkDialogOpen(false);
            savedRangeRef.current = null;
          }}
          open={linkDialogOpen}
        >
          <DialogTitle>{t('LW.translationPane.linkDialogTitle')}</DialogTitle>
          <DialogContent>
            <TextField
              autoFocus
              fullWidth
              label={t('LW.translationPane.linkTargetLabel')}
              margin="dense"
              onChange={(event) => setLinkUrl(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  applyLink();
                }
              }}
              placeholder={t('LW.translationPane.linkUrlPlaceholder')}
              size="small"
              value={linkUrl}
            />
          </DialogContent>
          <DialogActions>
            <Button
              onClick={() => {
                setLinkDialogOpen(false);
                savedRangeRef.current = null;
              }}
            >
              {t('LW.commons.cancel')}
            </Button>
            <Button onClick={applyLink} variant="contained">
              {t('LW.commons.update')}
            </Button>
          </DialogActions>
        </Dialog>

        <Dialog
          fullWidth
          maxWidth="xs"
          onClose={() => citationStyleResolveRef.current?.(null)}
          open={citationStylePickerOpen}
        >
          <DialogTitle>{t('LW.translationPane.citationStyleDialogTitle')}</DialogTitle>
          <DialogContent>
            <TextField
              autoFocus
              fullWidth
              margin="dense"
              onChange={(event) => setPendingCitationStyle(event.target.value)}
              select
              SelectProps={{ native: true }}
              size="small"
              value={pendingCitationStyle}
            >
              {citationStyleChoices.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </TextField>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => citationStyleResolveRef.current?.(null)}>
              {t('LW.commons.cancel')}
            </Button>
            <Button
              onClick={() => citationStyleResolveRef.current?.(pendingCitationStyle)}
              variant="contained"
            >
              {t('LW.translationPane.useStyle')}
            </Button>
          </DialogActions>
        </Dialog>

        {aiStatus ? (
          <Alert severity={aiStatus.severity} sx={{ borderRadius: 0 }}>
            {aiStatus.message}
          </Alert>
        ) : null}

        {languageToolStatus ? (
          <Alert
            action={
              languageToolMatches.length > 0 ? (
                <Button
                  color="inherit"
                  onClick={() => {
                    setLanguageToolMatches([]);
                    setLanguageToolSnapshot(null);
                    setLanguageToolStatus(null);
                  }}
                  size="small"
                >
                  {t('LW.translationPane.languageToolCloseResults')}
                </Button>
              ) : undefined
            }
            severity={languageToolStatus.severity}
            sx={{ borderRadius: 0 }}
          >
            {languageToolStatus.message}
          </Alert>
        ) : null}

        {languageToolMatches.length > 0 ? (
          <Box
            sx={{
              borderBottom: 1,
              borderColor: 'divider',
              maxHeight: 180,
              overflow: 'auto',
              px: 1,
              py: 0.5,
            }}
          >
            <List dense disablePadding>
              {languageToolMatches.map((match) => (
                <ListItem
                  alignItems="flex-start"
                  disableGutters
                  key={`${match.offset}-${match.length}-${match.ruleId ?? match.message}`}
                  sx={{ flexDirection: 'column', py: 0.5 }}
                >
                  <Typography variant="body2">{match.message}</Typography>
                  <Typography color="text.secondary" variant="caption">
                    “{(languageToolSnapshot ?? '').slice(match.offset, match.offset + match.length)}
                    ”
                  </Typography>
                  <Stack direction="row" flexWrap="wrap" spacing={0.5} sx={{ mt: 0.5 }}>
                    {match.replacements.map((replacement) => (
                      <Chip
                        key={`${match.offset}-${replacement}`}
                        label={replacement === ' ' ? '␣' : replacement || '∅'}
                        onClick={() => void applyLanguageToolReplacement(match, replacement)}
                        size="small"
                        variant="outlined"
                      />
                    ))}
                    <Button
                      onClick={() => dismissLanguageToolMatch(match)}
                      size="small"
                      sx={{ minWidth: 0 }}
                    >
                      {t('LW.translationPane.languageToolDismiss')}
                    </Button>
                  </Stack>
                </ListItem>
              ))}
            </List>
          </Box>
        ) : null}

        {unitCards.length > 0 || selectedUnitId ? (
          <Box
            ref={listScrollRef}
            onKeyDown={(event) => {
              if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
              if (event.key === '=' || event.key === '+') translationFontZoom.zoomIn();
              else if (event.key === '-') translationFontZoom.zoomOut();
              else if (event.key === '0') translationFontZoom.reset();
              else return;
              event.preventDefault();
              event.stopPropagation();
            }}
            sx={{
              flex: 1,
              minHeight: 0,
              overflow: 'auto',
              fontSize: `${paneFontSize}px`,
              counterReset: 'footnote',
            }}
          >
            {caretInUnindexedUnit && !selectedUnitId ? (
              <Alert severity="info" sx={{ borderRadius: 0 }}>
                {t('LW.translationPane.unindexedUnitMessage')}
              </Alert>
            ) : null}
            {(unitCards.length > 0
              ? unitCards
              : selectedUnitId
                ? [{ unitId: selectedUnitId, previewText: '', previewHtml: '', noteCount: 0 }]
                : []
            ).map((card) => {
              const isActive = card.unitId === selectedUnitId;
              const isGeneratingCard = generatingUnitId === card.unitId;
              const unitBodySx = {
                p: 1.5,
                outline: 'none',
                textAlign: 'justify' as const,
                '& hi[rend="small-caps"]': { fontVariant: 'small-caps' },
                '& hi[rend="bold"]': { fontWeight: 'bold' },
                '& hi[rend="italic"]': { fontStyle: 'italic' },
                '& hi[rend="underline"]': { textDecoration: 'underline' },
                '& hi[rend="strikethrough"]': { textDecoration: 'line-through' },
                '& ref': { color: 'primary.main', textDecoration: 'underline' },
                '& ref hi[rend="italic"]': { fontStyle: 'italic' },
                '& note': {
                  // Wrapper only when structured; flat TEI notes (read-only cards) get a pill via ::after.
                  counterIncrement: 'footnote',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  verticalAlign: 'super',
                  position: 'relative',
                  // Fixed rem box — never grow with hidden/transparent footnote text.
                  boxSizing: 'border-box',
                  width: '1.15rem',
                  height: '1.15rem',
                  minWidth: '1.15rem',
                  maxWidth: '1.15rem',
                  flexShrink: 0,
                  mx: '0.15rem',
                  p: 0,
                  borderRadius: '999px',
                  bgcolor: 'primary.main',
                  color: 'transparent',
                  fontSize: 0,
                  lineHeight: 0,
                  overflow: 'hidden',
                  cursor: 'default',
                  userSelect: 'none',
                  whiteSpace: 'nowrap',
                  [`& [${FN_MARK_ATTR}]`]: {
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxSizing: 'border-box',
                    width: '1.15rem',
                    height: '1.15rem',
                    minWidth: '1.15rem',
                    maxWidth: '1.15rem',
                    flexShrink: 0,
                    p: 0,
                    borderRadius: '999px',
                    bgcolor: 'primary.main',
                    color: 'primary.contrastText',
                    fontSize: '0.65rem',
                    fontWeight: 700,
                    lineHeight: 1,
                    overflow: 'hidden',
                  },
                  [`& [${FN_BODY_ATTR}]`]: {
                    display: 'none',
                  },
                },
                // Structured notes: the mark span is the pill; clear the wrapper chrome.
                [`& note:has([${FN_MARK_ATTR}])`]: {
                  width: 'auto',
                  height: 'auto',
                  minWidth: 0,
                  maxWidth: 'none',
                  bgcolor: 'transparent',
                  overflow: 'visible',
                  color: 'inherit',
                  fontSize: 'inherit',
                  lineHeight: 'inherit',
                },
                // Flat notes (inactive card HTML from TEI): paint the number with ::after.
                [`& note:not(:has([${FN_MARK_ATTR}]))::after`]: {
                  content: 'counter(footnote)',
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'primary.contrastText',
                  fontSize: '0.65rem',
                  fontWeight: 700,
                  lineHeight: 1,
                },
                // Hide raw footnote children inside flat notes.
                [`& note:not(:has([${FN_MARK_ATTR}])) > *`]: {
                  display: 'none',
                },
              };
              return (
                <Box
                  key={card.unitId}
                  data-unit-id={card.unitId}
                  data-active={isActive ? 'true' : undefined}
                  ref={(el: HTMLDivElement | null) => {
                    if (el) cardNodeRefs.current.set(card.unitId, el);
                    else cardNodeRefs.current.delete(card.unitId);
                  }}
                  onClick={() => {
                    if (!isActive && !isGeneratingCard) void navigateToUnit(card.unitId);
                  }}
                  sx={{
                    position: 'relative',
                    borderBottom: 1,
                    borderColor: 'divider',
                    borderLeft: 3,
                    borderLeftColor: isActive ? 'error.main' : 'transparent',
                    bgcolor: isActive ? 'background.paper' : 'transparent',
                    cursor: isActive ? (isGeneratingCard ? 'default' : 'text') : 'pointer',
                    '&:hover':
                      isActive || isGeneratingCard ? undefined : { bgcolor: 'action.hover' },
                  }}
                >
                  {!isActive ? (
                    card.previewHtml.trim() || card.previewText ? (
                      <Box
                        dangerouslySetInnerHTML={{
                          __html: looksLikeInlineMarkdown(card.previewText)
                            ? applyMarkdownCleanupToFragment(card.previewHtml)
                            : card.previewHtml,
                        }}
                        sx={unitBodySx}
                      />
                    ) : (
                      <Typography color="text.disabled" sx={{ px: 1.5, py: 1.5 }} variant="body2">
                        {t('LW.translationPane.emptyUnitPreview')}
                      </Typography>
                    )
                  ) : (
                    <>
                      <Box sx={{ position: 'relative', flex: '0 0 auto' }}>
                        <Box
                          ref={editableRef}
                          contentEditable={!isGeneratingCard}
                          aria-busy={isGeneratingCard}
                          lang={spellcheckLang}
                          spellCheck={spellcheckEnabled && !languageToolLive && !isGeneratingCard}
                          suppressContentEditableWarning
                          onBlur={() => {
                            void persist();
                            dismissEntityAutocomplete();
                            blurTimeoutRef.current = setTimeout(() => {
                              focusedRef.current = false;
                            }, 200);
                          }}
                          onBeforeInput={protectCitationField}
                          onFocus={() => {
                            if (blurTimeoutRef.current) clearTimeout(blurTimeoutRef.current);
                            focusedRef.current = true;
                            rememberBodyRange();
                          }}
                          onInput={() => {
                            if (editableRef.current) {
                              applyEditorialCleanupToRootPreservingSelection(
                                editableRef.current,
                                selectedLanguage,
                              );
                            }
                            refreshFootnotes();
                            rememberBodyRange();
                            refreshEntityAutocomplete();
                            scheduleLiveLanguageToolCheck();
                          }}
                          onScroll={() => refreshLanguageToolOverlays(languageToolMatches)}
                          onKeyUp={rememberBodyRange}
                          onMouseUp={() => {
                            rememberBodyRange();
                            refreshEntityAutocomplete();
                          }}
                          onContextMenu={handleEntityFieldContextMenu}
                          onKeyDown={(event) => {
                            protectCitationField(event);
                            if (event.defaultPrevented) return;

                            const acCount = entityAcSuggestionsRef.current.length;
                            if (acCount > 0) {
                              if (event.key === 'Escape') {
                                event.preventDefault();
                                dismissEntityAutocomplete();
                                return;
                              }
                              if (event.key === 'ArrowDown') {
                                event.preventDefault();
                                setEntityAcIndex((index) => (index + 1) % acCount);
                                return;
                              }
                              if (event.key === 'ArrowUp') {
                                event.preventDefault();
                                setEntityAcIndex((index) => (index - 1 + acCount) % acCount);
                                return;
                              }
                              if (event.key === 'Tab' || event.key === 'Enter') {
                                event.preventDefault();
                                void acceptEntityAutocomplete();
                                return;
                              }
                            }

                            if (!(event.metaKey || event.ctrlKey)) return;
                            const key = event.key.toLowerCase();
                            let command:
                              | 'smallCaps'
                              | 'superscript'
                              | 'subscript'
                              | 'removeFormat'
                              | 'link'
                              | 'footnote'
                              | null = null;
                            if (event.shiftKey && key === 'k') command = 'smallCaps';
                            else if (!event.shiftKey && !event.altKey && key === 'k')
                              command = 'link';
                            else if (
                              event.altKey &&
                              !event.shiftKey &&
                              (key === 'f' || key === 'ƒ' || event.code === 'KeyF')
                            )
                              command = 'footnote';
                            else if (key === '.') command = 'superscript';
                            else if (key === ',') command = 'subscript';
                            else if (key === 'm') command = 'removeFormat';
                            if (!command) return;
                            event.preventDefault();
                            event.stopPropagation();
                            if (command === 'footnote') insertFootnote();
                            else applyFormat(command);
                          }}
                          onPaste={(event) => {
                            handleTranslationPaste(event);
                            rememberBodyRange();
                          }}
                          onDragOver={(event) => event.preventDefault()}
                          onDrop={handleTranslationDrop}
                          sx={{
                            ...unitBodySx,
                            flex: '1 0 auto',
                            ...(isGeneratingCard
                              ? {
                                  pointerEvents: 'none',
                                  userSelect: 'none',
                                  color: 'text.disabled',
                                }
                              : {}),
                            '&:empty::before': {
                              content: `"${t('LW.translationPane.startTypingPlaceholder')}"`,
                              color: 'text.disabled',
                            },
                          }}
                        />
                        <Popover
                          anchorReference="anchorPosition"
                          anchorPosition={
                            entityAcAnchor
                              ? { top: entityAcAnchor.top, left: entityAcAnchor.left }
                              : undefined
                          }
                          disableAutoFocus
                          disableEnforceFocus
                          disableRestoreFocus
                          onClose={dismissEntityAutocomplete}
                          open={entityAcSuggestions.length > 0 && Boolean(entityAcAnchor)}
                          slotProps={{
                            paper: {
                              sx: { minWidth: 240, maxWidth: 360 },
                            },
                          }}
                          sx={{ pointerEvents: 'none' }}
                        >
                          <Box sx={{ pointerEvents: 'auto' }}>
                            <List dense disablePadding>
                              {entityAcSuggestions.map((suggestion, index) => (
                                <ListItemButton
                                  key={suggestion.candidate.id}
                                  selected={index === entityAcIndex}
                                  onMouseDown={(event) => event.preventDefault()}
                                  onClick={() => void acceptEntityAutocomplete(index)}
                                >
                                  <ListItemText
                                    primary={suggestion.candidate.label}
                                    secondary={suggestion.candidate.detail}
                                  />
                                </ListItemButton>
                              ))}
                            </List>
                            <Typography
                              color="text.secondary"
                              sx={{ display: 'block', px: 1.5, py: 0.75 }}
                              variant="caption"
                            >
                              {t('LW.translationPane.entityAutocompleteHint')}
                            </Typography>
                          </Box>
                        </Popover>
                        {languageToolOverlays.map((rect, index) => (
                          <Box
                            key={`lt-overlay-${rect.matchIndex}-${index}`}
                            onClick={() => {
                              const match = languageToolMatches[rect.matchIndex];
                              if (!match) return;
                              setLanguageToolStatus({
                                severity: 'info',
                                message: match.message,
                              });
                            }}
                            sx={{
                              position: 'absolute',
                              top: rect.top,
                              left: rect.left,
                              width: rect.width,
                              height: rect.height,
                              bgcolor: 'error.main',
                              opacity: 0.85,
                              borderRadius: 1,
                              pointerEvents: 'auto',
                              cursor: 'pointer',
                              zIndex: 1,
                            }}
                            title={languageToolMatches[rect.matchIndex]?.shortMessage}
                          />
                        ))}
                      </Box>

                      {footnotes.length > 0 ? (
                        <Box sx={{ px: 1.5, pb: 1.5 }}>
                          <Divider sx={{ width: 120, mb: 1 }} />
                          <Stack spacing={0.5}>
                            {footnotes.map((text, index) => (
                              <Stack alignItems="baseline" direction="row" key={index} spacing={1}>
                                <Typography
                                  color="text.secondary"
                                  sx={{ minWidth: 16, textAlign: 'right', flexShrink: 0 }}
                                  variant="caption"
                                >
                                  {footnoteStartIndex + index + 1}.
                                </Typography>
                                <Box
                                  contentEditable={!isGeneratingCard}
                                  data-leaf-footnote-editor={index}
                                  dangerouslySetInnerHTML={{ __html: text }}
                                  lang={spellcheckLang}
                                  spellCheck={
                                    spellcheckEnabled && !languageToolLive && !isGeneratingCard
                                  }
                                  onBlur={(event) => {
                                    rememberFootnoteRange(index, event.currentTarget);
                                    updateFootnote(index, event.currentTarget.innerHTML);
                                    void persist();
                                  }}
                                  onBeforeInput={protectCitationField}
                                  onFocus={(event) =>
                                    rememberFootnoteRange(index, event.currentTarget)
                                  }
                                  onInput={(event) => {
                                    applyEditorialCleanupToRootPreservingSelection(
                                      event.currentTarget,
                                      selectedLanguage,
                                    );
                                    prepareAtomicCitationFields(
                                      event.currentTarget,
                                      zoteroCitationLabel,
                                    );
                                    updateFootnote(index, event.currentTarget.innerHTML);
                                    rememberFootnoteRange(index, event.currentTarget);
                                  }}
                                  onKeyDown={(event) => {
                                    protectCitationField(event);
                                  }}
                                  onKeyUp={(event) =>
                                    rememberFootnoteRange(index, event.currentTarget)
                                  }
                                  onMouseUp={(event) =>
                                    rememberFootnoteRange(index, event.currentTarget)
                                  }
                                  onContextMenu={handleEntityFieldContextMenu}
                                  onPaste={(event) => {
                                    const el = event.currentTarget;
                                    handleTranslationPaste(event, {
                                      target: 'footnote',
                                      onImageInserted: () => updateFootnote(index, el.innerHTML),
                                    });
                                    updateFootnote(index, el.innerHTML);
                                    rememberFootnoteRange(index, el);
                                  }}
                                  onDragOver={(event) => event.preventDefault()}
                                  onDrop={(event) => {
                                    const el = event.currentTarget;
                                    handleTranslationDrop(event, () =>
                                      updateFootnote(index, el.innerHTML),
                                    );
                                  }}
                                  ref={(el: HTMLDivElement | null) => {
                                    if (el) prepareAtomicCitationFields(el, zoteroCitationLabel);
                                    if (el) prepareAtomicGlyphFields(el, translationPath);
                                    if (el && focusFootnoteIndexRef.current === index) {
                                      focusFootnoteIndexRef.current = null;
                                      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
                                      el.focus();
                                    }
                                  }}
                                  suppressContentEditableWarning
                                  sx={{
                                    flex: 1,
                                    fontSize: '0.85em',
                                    lineHeight: 1.4,
                                    minHeight: 22,
                                    outline: 'none',
                                    py: 0.25,
                                    ...(isGeneratingCard
                                      ? {
                                          pointerEvents: 'none',
                                          userSelect: 'none',
                                          color: 'text.disabled',
                                        }
                                      : {}),
                                    '&:empty::before': {
                                      content: `"${t('LW.translationPane.footnotePlaceholder')}"`,
                                      color: 'text.disabled',
                                    },
                                    '& bibl[data-leaf-citation-field="true"]': {
                                      bgcolor: 'action.hover',
                                      border: 1,
                                      borderColor: 'divider',
                                      borderRadius: 0.75,
                                      cursor: 'default',
                                      px: 0.5,
                                      userSelect: 'all',
                                      whiteSpace: 'break-spaces',
                                    },
                                    [`& ref[${ENTITY_FIELD_ATTR}="true"]`]: {
                                      bgcolor: 'action.hover',
                                      border: 1,
                                      borderColor: 'divider',
                                      borderRadius: 0.75,
                                      cursor: 'default',
                                      px: 0.5,
                                      userSelect: 'all',
                                      whiteSpace: 'break-spaces',
                                    },
                                  }}
                                />
                                <Tooltip title={t('LW.translationPane.removeFootnote')}>
                                  <IconButton
                                    aria-label={t('LW.translationPane.removeFootnote')}
                                    disabled={isGeneratingCard}
                                    onClick={() => removeFootnote(index)}
                                    size="small"
                                    sx={{ flexShrink: 0, alignSelf: 'center' }}
                                  >
                                    <CloseIcon sx={{ fontSize: 14 }} />
                                  </IconButton>
                                </Tooltip>
                              </Stack>
                            ))}
                          </Stack>
                        </Box>
                      ) : null}
                    </>
                  )}
                  {isGeneratingCard ? (
                    <Box
                      aria-live="polite"
                      sx={{
                        position: 'absolute',
                        inset: 0,
                        zIndex: 3,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 1.5,
                        bgcolor: (theme) =>
                          theme.palette.mode === 'dark'
                            ? 'rgba(0, 0, 0, 0.55)'
                            : 'rgba(255, 255, 255, 0.82)',
                        pointerEvents: 'all',
                      }}
                    >
                      <CircularProgress size={32} />
                      <Typography color="text.secondary" variant="body2">
                        {t('LW.translationPane.generatingTranslation')}
                      </Typography>
                    </Box>
                  ) : null}
                </Box>
              );
            })}
          </Box>
        ) : (
          <Box sx={{ flex: 1, p: 1.5 }}>
            <Typography color="text.secondary" variant="body2">
              {caretInUnindexedUnit
                ? t('LW.translationPane.unindexedUnitMessage')
                : t('LW.translationPane.selectUnitMessage', {
                    unit: alignmentUnit ?? t('LW.translationPane.defaultUnitLabel'),
                  })}
            </Typography>
          </Box>
        )}

        {entityFormatEntity ? (
          <EntityDisplayPopup
            anchorPosition={entityFormatAnchor}
            entity={entityFormatEntity}
            lang={selectedLanguage}
            occurrenceIndex={entityFormatOccurrence}
            onChange={(spec) => {
              void applyEntityDisplaySpec(spec);
            }}
            onClose={closeEntityFormatPopup}
            onReset={() => {
              void resetEntityDisplaySpec();
            }}
            onSaveTranslation={
              entityKindSupportsVernacularGloss(entityFormatEntity.kind)
                ? saveEntityTranslationFromPopup
                : undefined
            }
            onSuggestTranslation={
              entityKindSupportsVernacularGloss(entityFormatEntity.kind) &&
              isAiUiFeatureEnabled('entityGlossSuggest') &&
              getDesktopApi()?.suggestEntityGloss
                ? suggestEntityTranslationFromPopup
                : undefined
            }
            open={entityFormatOpen}
            spec={entityFormatSpec}
          />
        ) : null}
      </Box>
    </>
  );
};
