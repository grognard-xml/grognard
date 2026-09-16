import { findTeiBodyRoot } from './dateTeiHelpers';
import {
  isChineseLanguageCode,
  isEastAsianCalendarLanguageCode,
  isJapaneseLanguageCode,
  isKoreanLanguageCode,
  normalizeSourceLanguageCode,
} from '../utilities/languageCodes';

const DATES_PASS_STORAGE_KEY = 'grognard:autoTagging:datesPass';
const PROJECT_LANGUAGE_FIELD = 'profileDesc/langUsage/language';
const DEFAULT_METADATA_REL = 'schema/project-metadata.json';
// Kept in sync by hand with apps/desktop/src/projectTypes.ts and
// apps/commons/src/desktop/projectTypes.ts — see the fuller comment there.
const PROJECT_FILE_NAME = 'grognard.project.json';
const LEGACY_PROJECT_FILE_NAME = 'jean-baptiste.project.json';

const HAN_RE = /\p{Script=Han}/u;
const KANA_RE = /[\p{Script=Hiragana}\p{Script=Katakana}]/u;

export type DatesPassStatus = 'ran' | 'applied';

type DatesPassStore = Record<string, DatesPassStatus>;

/** Stable per-document key for workflow flags (session + reopen). */
export function autoTaggingDocumentKey(
  writer?: {
    overmindState?: {
      editor?: { resource?: { filePath?: string } };
      document?: { url?: string };
    };
  } | null,
): string {
  const path =
    writer?.overmindState?.editor?.resource?.filePath?.trim() ||
    writer?.overmindState?.document?.url?.trim();
  return path || 'unknown';
}

/**
 * Read source language from a TEI document (`profileDesc/langUsage/language`
 * or root `xml:lang`). The visual editor body often omits the header.
 */
export function sourceLanguageFromDocument(doc: Document): string | null {
  const root = doc.documentElement;
  if (!root) return null;

  for (const el of root.getElementsByTagName('*')) {
    if (el.localName !== 'language') continue;
    let inLangUsage = false;
    for (let p = el.parentElement; p; p = p.parentElement) {
      if (p.localName === 'langUsage') {
        inLangUsage = true;
        break;
      }
    }
    if (!inLangUsage) continue;
    const ident = el.getAttribute('ident') || el.getAttribute('lang') || el.textContent;
    const normalized = normalizeSourceLanguageCode(ident);
    if (normalized) return normalized;
  }

  const rootLang = root.getAttribute('xml:lang') || root.getAttribute('lang');
  return normalizeSourceLanguageCode(rootLang);
}

/** Plain text from the taggable body (for script inference). */
export function collectBodyText(doc: Document): string {
  const body = findTeiBodyRoot(doc);
  const walker = doc.createTreeWalker(body, NodeFilter.SHOW_TEXT);
  const parts: string[] = [];
  let node = walker.nextNode();
  while (node) {
    const text = node.textContent;
    if (text) parts.push(text);
    node = walker.nextNode();
  }
  return parts.join('');
}

/**
 * When project metadata is missing, guess Chinese vs Japanese from body script.
 * Returns null for predominantly Latin documents.
 */
export function inferEastAsianLanguageFromText(text: string): 'zh-Hans' | 'ja' | null {
  let han = 0;
  let kana = 0;
  let latin = 0;
  let sampled = 0;

  for (const ch of text) {
    if (/\s/u.test(ch)) continue;
    sampled += 1;
    if (HAN_RE.test(ch)) han += 1;
    else if (KANA_RE.test(ch)) kana += 1;
    else if (/[A-Za-zÀ-ÿ]/.test(ch)) latin += 1;
    if (sampled >= 4000) break;
  }

  if (sampled < 20) return null;

  const cjk = han + kana;
  const cjkRatio = cjk / sampled;
  if (cjkRatio < 0.2) return null;

  // Meaningful kana → Japanese; otherwise literary/classical Chinese body text.
  if (kana >= 8 && kana / Math.max(cjk, 1) >= 0.08) return 'ja';
  if (latin / sampled > 0.65 && cjkRatio < 0.35) return null;

  return 'zh-Hans';
}

export function inferEastAsianLanguageFromDocument(doc: Document): 'zh-Hans' | 'ja' | null {
  return inferEastAsianLanguageFromText(collectBodyText(doc));
}

const joinProjectPath = (rootPath: string, relativePath: string): string => {
  const separator = rootPath.includes('\\') ? '\\' : '/';
  return [rootPath, ...relativePath.split(/[/\\]/)].join(separator);
};

/** Read language from `schema/project-metadata.json` when the bridge is unavailable. */
export async function readProjectLanguageFromDisk(): Promise<string | null> {
  const api =
    typeof window !== 'undefined'
      ? (
          window as {
            electronAPI?: { readFile?: (path: string) => Promise<string> };
            __leafWriterProject?: { getProjectFilePath?: () => string };
            __ljbLspProject?: { projectRoot?: string };
          }
        ).electronAPI
      : undefined;
  const projectApi =
    typeof window !== 'undefined'
      ? (window as {
          __leafWriterProject?: { getProjectFilePath?: () => string };
          __ljbLspProject?: { projectRoot?: string };
        })
      : undefined;

  const root = projectApi?.__ljbLspProject?.projectRoot?.trim();
  if (!root || !api?.readFile) return null;

  let metadataRel = DEFAULT_METADATA_REL;
  const explicitProjectFile = projectApi?.__leafWriterProject?.getProjectFilePath?.().trim();
  // Falls back to guessing the filename only when the real, already-resolved
  // path isn't available (e.g. the Word add-in's LSP bridge) — try the
  // current name first, then the pre-rename name for a project that still
  // uses it (see PROJECT_FILE_NAME's doc comment in projectTypes.ts).
  const candidateProjectFiles = explicitProjectFile
    ? [explicitProjectFile]
    : [joinProjectPath(root, PROJECT_FILE_NAME), joinProjectPath(root, LEGACY_PROJECT_FILE_NAME)];

  for (const projectFile of candidateProjectFiles) {
    try {
      const config = JSON.parse(await api.readFile(projectFile)) as { metadata?: string };
      if (config.metadata?.trim()) metadataRel = config.metadata.trim();
      break;
    } catch {
      // try the next candidate, or fall through to the default metadata path
    }
  }

  try {
    const raw = await api.readFile(joinProjectPath(root, metadataRel));
    const parsed = JSON.parse(raw) as { fields?: Record<string, string> };
    return normalizeSourceLanguageCode(parsed.fields?.[PROJECT_LANGUAGE_FIELD]);
  } catch {
    return null;
  }
}

/** Project metadata → stored header → editor doc → CJK body inference. */
export async function resolveAutoTaggingSourceLanguage(
  doc: Document,
  getProjectLanguage?: () => Promise<string | null | undefined>,
): Promise<string | null> {
  if (getProjectLanguage) {
    try {
      const fromProject = normalizeSourceLanguageCode(await getProjectLanguage());
      if (fromProject) return fromProject;
    } catch {
      // fall through
    }
  }

  const fromDisk = await readProjectLanguageFromDisk();
  if (fromDisk) return fromDisk;

  const storedXml =
    typeof window !== 'undefined'
      ? (window as { __desktopStoredDocumentXml?: string }).__desktopStoredDocumentXml
      : undefined;
  if (storedXml?.trim()) {
    const fullDoc = new DOMParser().parseFromString(storedXml, 'application/xml');
    if (fullDoc.getElementsByTagName('parsererror').length === 0) {
      const fromStored = sourceLanguageFromDocument(fullDoc);
      if (fromStored) return fromStored;
    }
  }

  const fromDoc = sourceLanguageFromDocument(doc);
  if (fromDoc) return fromDoc;

  return inferEastAsianLanguageFromDocument(doc);
}

/** East Asian calendar tagging is optional; it no longer gates other methods. */
export function requiresDatesBeforeOtherTagging(_language: string | null | undefined): boolean {
  return false;
}

/** East Asian dates method is offered for Chinese / Japanese / Korean source languages. */
export function isEastAsianDatesMethodAvailable(language: string | null | undefined): boolean {
  return isEastAsianCalendarLanguageCode(language);
}

export type SanmiaoCivId = 'c' | 'j' | 'k';

export const SANMIAO_CIV_OPTIONS: readonly { id: SanmiaoCivId; label: string }[] = [
  { id: 'c', label: 'Chinese' },
  { id: 'j', label: 'Japanese' },
  { id: 'k', label: 'Korean' },
];

/** Default sanmiao `civ` for a project language. */
export function defaultSanmiaoCivForLanguage(language: string | null | undefined): SanmiaoCivId[] {
  if (isJapaneseLanguageCode(language)) return ['j'];
  if (isKoreanLanguageCode(language)) return ['k'];
  if (isChineseLanguageCode(language)) return ['c'];
  return ['c'];
}

export const defaultSanmiaoCivSelection = (
  language: string | null | undefined,
): Record<SanmiaoCivId, boolean> => {
  const defaults = defaultSanmiaoCivForLanguage(language);
  return {
    c: defaults.includes('c'),
    j: defaults.includes('j'),
    k: defaults.includes('k'),
  };
};

/** Body already contains `<date>` markup (informational only — does not unlock the gate). */
export function documentHasDateMarkup(doc: Document): boolean {
  return countDocumentDates(doc).tagged > 0;
}

export interface DocumentDateCounts {
  resolved: number;
  tagged: number;
}

const RESOLVED_DATE_ATTRS = [
  'when',
  'year',
  'month',
  'day',
  'era_id',
  'dyn_id',
  'ruler_id',
  'sex_year',
  'gz',
  'nmd_gz',
] as const;

/** True when a `<date>` has sanmiao calendar attributes (not tag-only). */
export function isDateElementResolved(el: Element): boolean {
  if (el.localName !== 'date') return false;
  if (el.getAttribute('when')?.trim()) return true;
  if (el.getAttribute('cert') === 'high') return true;
  return RESOLVED_DATE_ATTRS.some((name) => {
    const value = el.getAttribute(name);
    return value != null && value.trim() !== '';
  });
}

/** Count `<date>` elements in the body and how many have resolved calendar attributes. */
export function countDocumentDates(doc: Document): DocumentDateCounts {
  const body = findTeiBodyRoot(doc);
  let tagged = 0;
  let resolved = 0;
  const walker = doc.createTreeWalker(body, NodeFilter.SHOW_ELEMENT);
  let node = walker.nextNode();
  while (node) {
    const el = node as Element;
    if (el.localName === 'date') {
      tagged += 1;
      if (isDateElementResolved(el)) resolved += 1;
    }
    node = walker.nextNode();
  }
  return { tagged, resolved };
}

const readDatesPassStore = (): DatesPassStore => {
  if (typeof sessionStorage === 'undefined') return {};
  try {
    const raw = sessionStorage.getItem(DATES_PASS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as DatesPassStore;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

const writeDatesPassStore = (store: DatesPassStore): void => {
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.setItem(DATES_PASS_STORAGE_KEY, JSON.stringify(store));
  } catch {
    // quota / private mode — ignore
  }
};

const setDatesPassStatus = (docKey: string, status: DatesPassStatus): void => {
  const store = readDatesPassStore();
  store[docKey] = status;
  writeDatesPassStore(store);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('desktop:calendar-workflow-changed'));
  }
};

export const markDatesPassRan = (docKey: string): void => setDatesPassStatus(docKey, 'ran');

export const markDatesPassApplied = (docKey: string): void => setDatesPassStatus(docKey, 'applied');

export const clearDatesPassForDocument = (docKey: string): void => {
  const store = readDatesPassStore();
  delete store[docKey];
  writeDatesPassStore(store);
};

/**
 * Dictionary, authority, AI, etc. are always available regardless of calendar passes.
 */
export function areOtherAutoTaggingMethodsUnlocked(
  _docKey: string,
  _doc?: Document | null,
  _language?: string | null | undefined,
): boolean {
  return true;
}

export const datesPassStatusForDocument = (docKey: string): DatesPassStatus | undefined =>
  readDatesPassStore()[docKey];

/** True after the user completed the tag-dates workflow step in this session. */
export function isTagDatesPassComplete(
  docKey: string,
  language: string | null | undefined,
): boolean {
  if (!isEastAsianCalendarLanguageCode(language)) return true;
  const status = readDatesPassStore()[docKey];
  return status === 'ran' || status === 'applied';
}

/** True after resolve-dates has been applied at least once in this session. */
export function isResolveDatesPassComplete(
  docKey: string,
  language: string | null | undefined,
): boolean {
  if (!isEastAsianCalendarLanguageCode(language)) return true;
  return readDatesPassStore()[docKey] === 'applied';
}

/** @deprecated Calendar no longer gates other workflows. */
export function shouldWarnTagDatesFirst(
  _docKey: string,
  _language: string | null | undefined,
): boolean {
  return false;
}

/** @deprecated Calendar no longer gates auto-tagging. */
export function isAutoTaggingUnlockedForDocument(
  _docKey: string,
  _language: string | null | undefined,
): boolean {
  return true;
}

/** Disambiguation is always available. */
export function isDisambiguationUnlockedForDocument(
  _docKey: string,
  _language: string | null | undefined,
): boolean {
  return true;
}

/** @deprecated Calendar no longer gates other workflows. */
export function shouldWarnResolveDatesBeforeAutoTag(
  _docKey: string,
  _language: string | null | undefined,
): boolean {
  return false;
}

/** @deprecated Calendar no longer gates other workflows. */
export function needsDatesPassFirst(
  _docKey: string,
  _language: string | null | undefined,
): boolean {
  return false;
}
