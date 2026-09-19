import { findTeiHeader, TEI_NS } from './teiHeaderXml';

/**
 * Structured TEI source description for the per-file metadata panel.
 *
 * Mapping (TEI P5 standard practice):
 * - Book title      → fileDesc/titleStmt/title AND sourceDesc/biblStruct/monogr/title
 * - Authors         → fileDesc/titleStmt/author[@ref] AND monogr/author[@ref]
 * - Year (work)     → profileDesc/creation/date[@when | @notBefore/@notAfter]
 * - Edition         → sourceDesc/biblStruct/monogr/edition
 * - Year of edition → sourceDesc/biblStruct/monogr/imprint/date[@when]
 * - Transcription source (free text) → sourceDesc/biblStruct/note
 *
 * Legacy files store free-text source in sourceDesc/p; it is read as the
 * transcription source and migrated into biblStruct/note on the next apply.
 *
 * Format (CHHIV: book/slips/boards - 書/簡/牘) is a physical-carrier fact,
 * which in TEI belongs under sourceDesc/msDesc/physDesc/objectDesc/@form -
 * but msDesc is only defined by the "TEI All" schema (confirmed by reading
 * the RNG directly; CBETA, TEI Lite, and the others don't have it at all),
 * and even there it requires a mandatory msIdentifier as msDesc's first
 * child. So: proper TEI (msDesc/physDesc/objectDesc/@form, with an empty
 * but schema-valid msIdentifier placeholder) when the active schema is TEI
 * All, and a plain sourceDesc/biblStruct/note[@type="format"] sibling
 * everywhere else - same mechanism the existing sourceNote already uses,
 * just distinguished by @type. Reading checks both locations regardless of
 * the current schema, since a file may have been created under a different
 * one than it's opened under.
 */

export type SourceFormat = 'book' | 'slips' | 'boards';

export interface SourceAuthor {
  name: string;
  /** Authority URI (Wikidata/VIAF/…) carried on author/@ref. */
  ref?: string;
  /** Local-only entities.xml id (bare, e.g. "person-000100"), carried on author/@key. */
  key?: string;
}

export interface SourceWorkDate {
  /** Exact year — mutually exclusive with notBefore/notAfter. */
  when?: string;
  notBefore?: string;
  notAfter?: string;
}

export interface SourceDescription {
  title: string;
  /** Authority URI (Wikidata/VIAF/…) carried on title/@ref. */
  titleRef?: string;
  /** Local-only entities.xml id (bare, e.g. "work-000010"), carried on title/@key. */
  titleKey?: string;
  authors: SourceAuthor[];
  workDate: SourceWorkDate;
  edition: string;
  editionDate: string;
  sourceNote: string;
  format?: SourceFormat;
}

export const emptySourceDescription = (): SourceDescription => ({
  title: '',
  titleRef: undefined,
  titleKey: undefined,
  authors: [],
  workDate: {},
  edition: '',
  editionDate: '',
  sourceNote: '',
  format: undefined,
});

const SOURCE_FORMATS: readonly SourceFormat[] = ['book', 'slips', 'boards'];
const isSourceFormat = (value: string): value is SourceFormat =>
  (SOURCE_FORMATS as readonly string[]).includes(value);

const childNS = (parent: Element, localName: string): Element | null => {
  for (const child of Array.from(parent.children)) {
    if (child.localName === localName) return child;
  }
  return null;
};

const childrenNS = (parent: Element, localName: string): Element[] =>
  Array.from(parent.children).filter((child) => child.localName === localName);

const descendantNS = (root: Element, localName: string): Element | null =>
  root.getElementsByTagNameNS(TEI_NS, localName)[0] ??
  root.getElementsByTagName(localName)[0] ??
  null;

const readAuthors = (parent: Element): SourceAuthor[] =>
  childrenNS(parent, 'author')
    .map((el) => {
      const name = el.textContent?.trim() ?? '';
      let ref = el.getAttribute('ref') ?? undefined;
      const key = el.getAttribute('key') ?? undefined;
      if (!ref && !key) {
        const legacyN = (el.getAttribute('n') ?? '').trim();
        if (/^\d+$/.test(legacyN)) {
          ref = `NORBERT:person-${legacyN}`;
        } else {
          const wikidataRef = legacyN.match(/^(?:Q\d+|https?:\/\/.*)$/i) ? legacyN : '';
          if (wikidataRef.startsWith('http')) ref = wikidataRef;
          else if (/^Q\d+$/i.test(wikidataRef)) {
            ref = `https://www.wikidata.org/entity/${wikidataRef.toUpperCase()}`;
          }
        }
      }
      return { name, ref, key };
    })
    .filter((author) => author.name);

export const readSourceDescription = (header: Element): SourceDescription => {
  const result = emptySourceDescription();

  const fileDesc = descendantNS(header, 'fileDesc');
  const titleStmt = fileDesc ? childNS(fileDesc, 'titleStmt') : null;
  const sourceDesc = fileDesc ? childNS(fileDesc, 'sourceDesc') : null;
  const biblStruct = sourceDesc ? childNS(sourceDesc, 'biblStruct') : null;
  const monogr = biblStruct ? childNS(biblStruct, 'monogr') : null;

  const titleStmtTitle = titleStmt?.getElementsByTagNameNS(TEI_NS, 'title')[0];
  const monogrTitle = monogr ? childNS(monogr, 'title') : null;
  const titleEl = titleStmtTitle ?? monogrTitle;

  result.title = titleEl?.textContent?.trim() ?? '';
  result.titleRef = titleEl?.getAttribute('ref') ?? undefined;
  result.titleKey = titleEl?.getAttribute('key') ?? undefined;

  const titleAuthors = titleStmt ? readAuthors(titleStmt) : [];
  result.authors = titleAuthors.length > 0 ? titleAuthors : monogr ? readAuthors(monogr) : [];

  const profileDesc = descendantNS(header, 'profileDesc');
  const creation = profileDesc ? childNS(profileDesc, 'creation') : null;
  const creationDate = creation ? childNS(creation, 'date') : null;
  if (creationDate) {
    const when = creationDate.getAttribute('when') ?? '';
    const notBefore = creationDate.getAttribute('notBefore') ?? '';
    const notAfter = creationDate.getAttribute('notAfter') ?? '';
    if (notBefore || notAfter) {
      result.workDate = { notBefore: notBefore || undefined, notAfter: notAfter || undefined };
    } else if (when || creationDate.textContent?.trim()) {
      result.workDate = { when: when || creationDate.textContent?.trim() };
    }
  }

  if (monogr) {
    result.edition = childNS(monogr, 'edition')?.textContent?.trim() ?? '';
    const imprint = childNS(monogr, 'imprint');
    const imprintDate = imprint ? childNS(imprint, 'date') : null;
    result.editionDate = imprintDate ? readEditionDate(imprintDate) : '';
  }

  if (biblStruct) {
    const notes = childrenNS(biblStruct, 'note');
    result.sourceNote =
      notes.find((note) => note.getAttribute('type') !== 'format')?.textContent?.trim() ?? '';
    const formatNote = notes.find((note) => note.getAttribute('type') === 'format');
    const formatNoteValue = formatNote?.textContent?.trim() ?? '';
    if (isSourceFormat(formatNoteValue)) result.format = formatNoteValue;
  } else if (sourceDesc) {
    // Legacy free-text source in sourceDesc/p.
    result.sourceNote = childNS(sourceDesc, 'p')?.textContent?.trim() ?? '';
  }

  const msDesc = sourceDesc ? childNS(sourceDesc, 'msDesc') : null;
  const physDesc = msDesc ? childNS(msDesc, 'physDesc') : null;
  const objectDesc = physDesc ? childNS(physDesc, 'objectDesc') : null;
  const msDescFormat = objectDesc?.getAttribute('form') ?? '';
  if (isSourceFormat(msDescFormat)) result.format = msDescFormat;

  return result;
};

const removeChildrenNS = (parent: Element, localName: string) => {
  for (const el of childrenNS(parent, localName)) {
    parent.removeChild(el);
  }
};

const makeAuthorElement = (doc: Document, author: SourceAuthor): Element => {
  const el = doc.createElementNS(TEI_NS, 'author');
  el.textContent = author.name;
  if (author.ref?.trim()) el.setAttribute('ref', author.ref.trim());
  else if (author.key?.trim()) el.setAttribute('key', author.key.trim());
  return el;
};

/**
 * TEI date attributes (@when/@notBefore/@notAfter) use W3C datatypes: years
 * must be zero-padded to 4 digits ("526" → "0526", "-52-03" → "-0052-03").
 * Values that aren't year-led dates are returned untouched.
 */
export const normalizeTeiDateValue = (value: string): string => {
  const match = value.trim().match(/^(-?)(\d{1,4})((?:-\d{2}){0,2})$/);
  if (!match) return value.trim();
  const [, sign, year, rest] = match;
  return `${sign}${year.padStart(4, '0')}${rest}`;
};

/**
 * TEI `@when` / `@notBefore` / `@notAfter` must be a W3C date literal. Return the
 * normalised value only when it qualifies; a human label like `乾隆47年` or
 * `唐` yields `''` so the caller can omit the attribute rather than emit an
 * invalid one.
 */
export const teiDateLiteral = (raw?: string | null): string => {
  const v = normalizeTeiDateValue((raw ?? '').trim());
  return /^-?\d{4}(-\d{2}){0,2}$/.test(v) ? v : '';
};

/** Unambiguous range separators: en/em dash, slash, or the word "to". */
const EDITION_RANGE_SEP = /^(.+?)\s*(?:–|—|\/|\bto\b)\s*(.+?)$/i;
/** Bare "YYYY-YYYY" — a hyphen only splits when both sides are plain years. */
const EDITION_RANGE_HYPHEN = /^(\d{3,4})\s*-\s*(\d{3,4})$/;

/**
 * Derive W3C-literal attributes for `imprint/date` from a free-text "year of
 * edition" field. A range ("1924–1934", "1924-1934", "1924/1934", "1924 to
 * 1934") yields `from`/`to` — the span an edition was printed over — a single
 * year yields `when`, and an unparseable label ("乾隆年間") yields nothing, so
 * the caller keeps the text as a human label without emitting an invalid date.
 * Endpoints are zero-padded to 4 digits like every other TEI date here.
 */
export const editionDateAttrs = (raw: string): { when?: string; from?: string; to?: string } => {
  const text = (raw ?? '').trim();
  if (!text) return {};

  const hyphen = text.match(EDITION_RANGE_HYPHEN);
  const parts = hyphen ?? text.match(EDITION_RANGE_SEP);
  if (parts) {
    const from = teiDateLiteral(parts[1]);
    const to = teiDateLiteral(parts[2]);
    if (from || to) return { from: from || undefined, to: to || undefined };
    return {};
  }

  const when = teiDateLiteral(text);
  return when ? { when } : {};
};

/**
 * Human-readable "year of edition" from an `imprint/date` element. Prefer the
 * element text the editor wrote; fall back to reconstructing it from the
 * attributes so importer output (`<date from="1924" to="1934"/>`) still reads
 * back cleanly. `@from`/`@to` and the legacy `@notBefore`/`@notAfter` are both
 * accepted for the range.
 */
const readEditionDate = (dateEl: Element): string => {
  const text = dateEl.textContent?.trim();
  if (text) return text;
  const when = dateEl.getAttribute('when')?.trim();
  if (when) return when;
  const from = (dateEl.getAttribute('from') ?? dateEl.getAttribute('notBefore'))?.trim();
  const to = (dateEl.getAttribute('to') ?? dateEl.getAttribute('notAfter'))?.trim();
  if (from && to) return `${from}–${to}`;
  return from || to || '';
};

const workDateLabel = (date: SourceWorkDate): string => {
  if (date.when?.trim()) return date.when.trim();
  const notBefore = date.notBefore?.trim() ?? '';
  const notAfter = date.notAfter?.trim() ?? '';
  if (notBefore && notAfter) return `${notBefore}–${notAfter}`;
  if (notBefore) return `after ${notBefore}`;
  if (notAfter) return `before ${notAfter}`;
  return '';
};

const hasWorkDate = (date: SourceWorkDate): boolean => Boolean(workDateLabel(date));

const ensureChild = (parent: Element, localName: string): Element => {
  const existing = childNS(parent, localName);
  if (existing) return existing;
  const el = parent.ownerDocument!.createElementNS(TEI_NS, localName);
  parent.appendChild(el);
  return el;
};

/** teiHeader child order per TEI P5 content model. */
const HEADER_CHILD_ORDER = ['fileDesc', 'encodingDesc', 'profileDesc', 'xenoData', 'revisionDesc'];

const ensureHeaderChild = (header: Element, localName: string): Element => {
  const existing = childNS(header, localName);
  if (existing) return existing;
  const el = header.ownerDocument!.createElementNS(TEI_NS, localName);
  const selfIndex = HEADER_CHILD_ORDER.indexOf(localName);
  let before: Element | null = null;
  for (const child of Array.from(header.children)) {
    const index = HEADER_CHILD_ORDER.indexOf(child.localName);
    if (index > selfIndex) {
      before = child;
      break;
    }
  }
  header.insertBefore(el, before);
  return el;
};

const applyTitleRefKey = (title: Element, data: SourceDescription) => {
  title.removeAttribute('ref');
  title.removeAttribute('key');
  if (data.titleRef?.trim()) title.setAttribute('ref', data.titleRef.trim());
  else if (data.titleKey?.trim()) title.setAttribute('key', data.titleKey.trim());
};

const applyTitleStmt = (fileDesc: Element, data: SourceDescription) => {
  const doc = fileDesc.ownerDocument!;
  const titleStmt = ensureChild(fileDesc, 'titleStmt');

  let title = childNS(titleStmt, 'title');
  if (!title) {
    title = doc.createElementNS(TEI_NS, 'title');
    titleStmt.insertBefore(title, titleStmt.firstChild);
  }
  title.textContent = data.title;
  applyTitleRefKey(title, data);

  removeChildrenNS(titleStmt, 'author');
  const anchor: Node | null = title.nextSibling;
  for (const author of data.authors) {
    titleStmt.insertBefore(makeAuthorElement(doc, author), anchor);
  }
};

const applyCreationDate = (header: Element, date: SourceWorkDate) => {
  const doc = header.ownerDocument!;
  const existingProfileDesc = childNS(header, 'profileDesc');

  if (!hasWorkDate(date)) {
    const creation = existingProfileDesc ? childNS(existingProfileDesc, 'creation') : null;
    if (creation) {
      const dateEl = childNS(creation, 'date');
      if (dateEl) creation.removeChild(dateEl);
      if (creation.children.length === 0 && !creation.textContent?.trim()) {
        existingProfileDesc!.removeChild(creation);
      }
      if (existingProfileDesc!.children.length === 0) {
        header.removeChild(existingProfileDesc!);
      }
    }
    return;
  }

  const profileDesc = ensureHeaderChild(header, 'profileDesc');
  // creation must precede langUsage in profileDesc.
  let creation = childNS(profileDesc, 'creation');
  if (!creation) {
    creation = doc.createElementNS(TEI_NS, 'creation');
    profileDesc.insertBefore(creation, profileDesc.firstChild);
  }
  const dateEl = ensureChild(creation, 'date');
  dateEl.removeAttribute('when');
  dateEl.removeAttribute('notBefore');
  dateEl.removeAttribute('notAfter');
  const whenLit = teiDateLiteral(date.when);
  if (whenLit) {
    dateEl.setAttribute('when', whenLit);
  } else {
    const nbLit = teiDateLiteral(date.notBefore);
    const naLit = teiDateLiteral(date.notAfter);
    if (nbLit) dateEl.setAttribute('notBefore', nbLit);
    if (naLit) dateEl.setAttribute('notAfter', naLit);
  }
  dateEl.textContent = workDateLabel(date);
};

const hasBiblContent = (data: SourceDescription, useMsDescFormat: boolean): boolean =>
  Boolean(
    data.title.trim() ||
    data.authors.length > 0 ||
    data.edition.trim() ||
    data.editionDate.trim() ||
    data.sourceNote.trim() ||
    (!useMsDescFormat && data.format),
  );

/**
 * Manages sourceDesc/msDesc/physDesc/objectDesc/@form - the proper TEI home
 * for a physical-carrier fact, valid only under schemas that define msDesc
 * (currently just TEI All - see the doc comment above SourceDescription).
 * msDesc lives alongside biblStruct as an ordinary repeatable sourceDesc
 * child, not nested inside it. Only removes the wrapper elements this
 * function itself would have created, and only when they'd otherwise be
 * left completely empty - never touches msDesc content authored elsewhere
 * (msContents, history, a real msIdentifier, etc).
 */
const applyMsDescFormat = (sourceDesc: Element, format: SourceFormat | undefined) => {
  const doc = sourceDesc.ownerDocument!;
  const msDesc = childNS(sourceDesc, 'msDesc');

  if (!format) {
    if (!msDesc) return;
    const physDesc = childNS(msDesc, 'physDesc');
    const objectDesc = physDesc ? childNS(physDesc, 'objectDesc') : null;
    if (objectDesc) {
      objectDesc.removeAttribute('form');
      if (objectDesc.children.length === 0 && !objectDesc.getAttributeNames().length) {
        physDesc!.removeChild(objectDesc);
      }
    }
    if (physDesc && physDesc.children.length === 0) msDesc!.removeChild(physDesc);
    const msIdentifier = childNS(msDesc!, 'msIdentifier');
    const msDescOtherwiseEmpty =
      msDesc!.children.length === (msIdentifier ? 1 : 0) &&
      (!msIdentifier || msIdentifier.children.length === 0);
    if (msDescOtherwiseEmpty) sourceDesc.removeChild(msDesc!);
    return;
  }

  const resolvedMsDesc = msDesc ?? doc.createElementNS(TEI_NS, 'msDesc');
  if (!msDesc) sourceDesc.appendChild(resolvedMsDesc);

  // msIdentifier is msDesc's mandatory first child; every one of its own
  // children is optional, so an empty placeholder is schema-valid RNG
  // (TEI's own Schematron guideline wants a real repository/location here,
  // but this app's validator only checks RelaxNG, not Schematron).
  if (!childNS(resolvedMsDesc, 'msIdentifier')) {
    const msIdentifier = doc.createElementNS(TEI_NS, 'msIdentifier');
    resolvedMsDesc.insertBefore(msIdentifier, resolvedMsDesc.firstChild);
  }

  const physDesc = ensureChild(resolvedMsDesc, 'physDesc');
  const objectDesc = ensureChild(physDesc, 'objectDesc');
  objectDesc.setAttribute('form', format);
};

/** Whether sourceDesc already has a msDesc/physDesc/objectDesc/@form entry -
 * the safe default for callers that round-trip a SourceDescription without
 * knowing the active schema (e.g. the post-import entity-linking pass):
 * preserve whatever storage a document already uses rather than silently
 * migrating (and destroying) it. */
const hasExistingMsDescFormat = (sourceDesc: Element): boolean => {
  const msDesc = childNS(sourceDesc, 'msDesc');
  const physDesc = msDesc ? childNS(msDesc, 'physDesc') : null;
  const objectDesc = physDesc ? childNS(physDesc, 'objectDesc') : null;
  return Boolean(objectDesc?.hasAttribute('form'));
};

const applySourceDesc = (
  fileDesc: Element,
  data: SourceDescription,
  useMsDescFormat: boolean | undefined,
) => {
  const doc = fileDesc.ownerDocument!;
  const sourceDesc = ensureChild(fileDesc, 'sourceDesc');
  const resolvedUseMsDescFormat = useMsDescFormat ?? hasExistingMsDescFormat(sourceDesc);

  applyMsDescFormat(sourceDesc, resolvedUseMsDescFormat ? data.format : undefined);

  if (!hasBiblContent(data, resolvedUseMsDescFormat)) {
    removeChildrenNS(sourceDesc, 'biblStruct');
    if (sourceDesc.children.length === 0) {
      // sourceDesc cannot be empty — keep a valid empty <p/>.
      sourceDesc.appendChild(doc.createElementNS(TEI_NS, 'p'));
    }
    return;
  }

  // biblStruct and p cannot coexist in sourceDesc; legacy p text moves to the note.
  removeChildrenNS(sourceDesc, 'p');

  let biblStruct = childNS(sourceDesc, 'biblStruct');
  if (!biblStruct) {
    biblStruct = doc.createElementNS(TEI_NS, 'biblStruct');
    sourceDesc.insertBefore(biblStruct, sourceDesc.firstChild);
  }
  while (biblStruct.firstChild) biblStruct.removeChild(biblStruct.firstChild);

  const monogr = doc.createElementNS(TEI_NS, 'monogr');
  biblStruct.appendChild(monogr);

  for (const author of data.authors) {
    monogr.appendChild(makeAuthorElement(doc, author));
  }

  const title = doc.createElementNS(TEI_NS, 'title');
  title.textContent = data.title.trim();
  applyTitleRefKey(title, data);
  monogr.appendChild(title);

  if (data.edition.trim()) {
    const edition = doc.createElementNS(TEI_NS, 'edition');
    edition.textContent = data.edition.trim();
    monogr.appendChild(edition);
  }

  // imprint is required inside monogr; an empty <date/> keeps it valid.
  const imprint = doc.createElementNS(TEI_NS, 'imprint');
  const imprintDate = doc.createElementNS(TEI_NS, 'date');
  const editionYear = data.editionDate.trim();
  if (editionYear) {
    const attrs = editionDateAttrs(editionYear);
    if (attrs.when) imprintDate.setAttribute('when', attrs.when);
    if (attrs.from) imprintDate.setAttribute('from', attrs.from);
    if (attrs.to) imprintDate.setAttribute('to', attrs.to);
    imprintDate.textContent = editionYear;
  }
  imprint.appendChild(imprintDate);
  monogr.appendChild(imprint);

  if (data.sourceNote.trim()) {
    const note = doc.createElementNS(TEI_NS, 'note');
    note.textContent = data.sourceNote.trim();
    biblStruct.appendChild(note);
  }

  if (!resolvedUseMsDescFormat && data.format) {
    const formatNote = doc.createElementNS(TEI_NS, 'note');
    formatNote.setAttribute('type', 'format');
    formatNote.textContent = data.format;
    biblStruct.appendChild(formatNote);
  }
};

/**
 * @param useMsDescFormat Whether the active schema defines msDesc (only
 * "TEI All" does - see the doc comment above SourceDescription) - decides
 * where `data.format` is written. Reading isn't gated the same way (it
 * checks both locations) so this only affects writes. Omit it to preserve
 * whichever storage the document already uses (see hasExistingMsDescFormat)
 * - the safe choice for callers that round-trip a SourceDescription without
 * knowing the active schema.
 */
export const applySourceDescription = (
  header: Element,
  data: SourceDescription,
  useMsDescFormat?: boolean,
) => {
  const fileDesc = ensureHeaderChild(header, 'fileDesc');
  applyTitleStmt(fileDesc, data);
  applySourceDesc(fileDesc, data, useMsDescFormat);
  applyCreationDate(header, data.workDate);
};

export const readSourceDescriptionFromXml = (xml: string): SourceDescription => {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror')) return emptySourceDescription();
  const header = findTeiHeader(doc);
  if (!header) return emptySourceDescription();
  return readSourceDescription(header);
};

export const applySourceDescriptionToXml = (
  xml: string,
  data: SourceDescription,
  useMsDescFormat?: boolean,
): string => {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror')) return xml;
  const header = findTeiHeader(doc);
  if (!header) return xml;
  applySourceDescription(header, data, useMsDescFormat);
  return new XMLSerializer().serializeToString(doc);
};
