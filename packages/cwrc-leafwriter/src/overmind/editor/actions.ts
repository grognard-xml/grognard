import $ from 'jquery';
import Cookies from 'js-cookie';
import { Context } from '../';
import { db } from '../../db';
import { resetLookupPreferences } from '../../jotai/entity-lookup/utilities';
import type { LeafWriterOptionsSettings, Schema } from '../../types';
import {
  DEFAULT_ASIAN_FONT,
  DEFAULT_LATIN_FONT,
  buildEditorFontCss,
  combineFontFamilies,
  getValidFontFamily,
} from './fontFamilies';
import {
  DEFAULT_EDITOR_FONT_SIZE,
  type ChoiceDisplayMode,
  type MultiFileSnapshotTrigger,
} from './state';

const DIALOG_PREFS_COOKIE_NAME = 'leaf-writer-base-dialog-preferences';
const ASIAN_FONT_KEY = 'asianFont';
const CHOICE_DISPLAY_MODE_KEY = 'choiceDisplayMode';
const CHOICE_DISPLAY_STYLE_ID = 'choiceDisplayStyle';
const CHOICE_DISPLAY_MODES: ChoiceDisplayMode[] = ['original', 'corrected', 'both'];
const FONT_FAMILY_STYLE_ID = 'leafwriter-default-font-families';
const FONT_SIZE_KEY = 'fontSize';
const LATIN_FONT_KEY = 'latinFont';
const SHOW_BREAKS_KEY = 'showBreaks';
const SHOW_NOTES_KEY = 'showNotes';
const SHOW_RAW_XML_PANEL_KEY = 'showRawXmlPanel';
const STRIP_CJK_WHITESPACE_KEY = 'stripCjkWhitespace';
const TEXT_LOCKED_KEY = 'textLocked';
const VALIDATE_XML_ON_REPLACE_KEY = 'validateXmlOnReplace';
const ENABLE_XML_EDITING_KEY = 'enableXmlEditing';
const ENABLE_MULTI_FILE_AUTOMATION_KEY = 'enableMultiFileAutomation';
const MULTI_FILE_SNAPSHOT_BEFORE_KEY = 'multiFileSnapshotBefore';
const VALIDATE_MULTI_FILE_AUTOMATION_KEY = 'validateMultiFileAutomation';
const ALLOW_SOURCE_MODE_SCHEMA_VIOLATIONS_KEY = 'allowSourceModeSchemaViolations';
const MULTI_FILE_SNAPSHOT_TRIGGERS: MultiFileSnapshotTrigger[] = [
  'multiFile',
  'corpusWide',
  'none',
];

/**
 * A correction entity's live editor content is always its corrected text (see
 * CorrectionDialog); the original text is stamped separately as a `data-sic-text`
 * attribute (not editor content, so it's invisible to XML export). To display the
 * original instead, we shrink the real (corrected) text to nothing and show the
 * original via a same-size `::before` pseudo-element - CSS-only, no DOM/content changes.
 */
const applyChoiceDisplayMode = (mode: ChoiceDisplayMode, fontSize: number) => {
  if (!window.writer?.editor) return;
  const doc = window.writer.editor.getDoc();

  let $style = $(`#${CHOICE_DISPLAY_STYLE_ID}`, doc);
  if ($style.length === 0) {
    $style = $(`<style id="${CHOICE_DISPLAY_STYLE_ID}" type="text/css" />`).appendTo(
      $('head', doc),
    );
  }
  $style.text(`
    .choiceDisplay-original .entity.correction[data-sic-text] {
      font-size: 0 !important;
    }
    .choiceDisplay-original .entity.correction[data-sic-text]::before {
      content: attr(data-sic-text) " [sic.]";
      font-size: ${fontSize}pt !important;
    }
    .choiceDisplay-both .entity.correction[data-sic-text]::before {
      content: attr(data-sic-text) " [sic.] / ";
    }
    .choiceDisplay-corrected .entity.correction[_tag="surplus"],
    .choiceDisplay-corrected [_tag="sic"]:not(.entity.correction),
    .choiceDisplay-corrected [_tag="surplus"] {
      font-size: 0 !important;
    }
    .choiceDisplay-original .entity.correction[_tag="supplied"],
    .choiceDisplay-original [_tag="corr"]:not(.entity.correction),
    .choiceDisplay-original [_tag="supplied"] {
      font-size: 0 !important;
    }
  `);

  $('body', doc)
    .removeClass(CHOICE_DISPLAY_MODES.map((m) => `choiceDisplay-${m}`).join(' '))
    .addClass(`choiceDisplay-${mode}`);
};

const CJK_FONT_SELECTORS = [
  ':lang(zh)',
  ':lang(ja)',
  ':lang(ko)',
  '[lang|="zh"]',
  '[lang|="ja"]',
  '[lang|="ko"]',
  '[xml\\:lang|="zh"]',
  '[xml\\:lang|="ja"]',
  '[xml\\:lang|="ko"]',
].join(',\n');

const applyFontFamiliesToEditor = (latinFont: string, asianFont: string) => {
  const editor = window.writer?.editor;
  if (!editor) return;

  // Latin fonts first, then the Asian font, so Han text in documents without lang tags still
  // gets the Asian font (the lang-scoped rule below only matches tagged content).
  const bodyFont = combineFontFamilies(latinFont, asianFont);
  editor.dom.setStyles(editor.dom.getRoot(), { fontFamily: bodyFont });

  const doc = editor.getDoc();
  let style = doc.getElementById(FONT_FAMILY_STYLE_ID);
  if (!style) {
    style = doc.createElement('style');
    style.id = FONT_FAMILY_STYLE_ID;
    doc.head?.appendChild(style);
  }

  style.textContent = buildEditorFontCss(latinFont, asianFont, CJK_FONT_SELECTORS);
};

export const writerInitSettings = async (
  { state: { editor }, actions }: Context,
  settings: LeafWriterOptionsSettings,
) => {
  const { baseUrl, schemas } = settings;

  editor.baseUrl = baseUrl;
  editor.settings = settings;

  const schemaObjs: Record<string, Schema> = {};
  schemas?.forEach((element) => (schemaObjs[element.id] = element));

  editor.schemas = schemaObjs;

  actions.editor.setReadonly(settings.readonly);
};

/**
 * Applies the note/citation/keyword commentary folding to the current DOM -
 * shared by toggleShowNotes and applyInitialSettings so a (re)initialized
 * TinyMCE document (new doc load, undo across a load boundary, source-mode
 * round trip) picks up the persisted showNotes preference instead of
 * defaulting every note back to visible. See toggleShowNotes for why bare
 * [_tag="note"] elements are toggled separately from .noteWrapper.
 */
const applyShowNotesToDom = (doc: Document, show: boolean) => {
  $('.noteWrapper', doc).toggleClass('hide', !show);
  $('[_tag="note"]', doc)
    .filter((_i, el) => $(el).closest('.noteWrapper').length === 0)
    .toggleClass('hide', !show);
};

export const applyInitialSettings = ({ state, actions, effects }: Context) => {
  if (!window.writer?.editor) return;

  state.editor.latinFont = getValidFontFamily(
    effects.editor.api.getFromLocalStorage<string>(LATIN_FONT_KEY),
    state.editor.latinFont,
  );
  state.editor.asianFont = getValidFontFamily(
    effects.editor.api.getFromLocalStorage<string>(ASIAN_FONT_KEY),
    state.editor.asianFont,
  );

  const storedFontSize = effects.editor.api.getFromLocalStorage<number>(FONT_SIZE_KEY);
  actions.editor.setFontSize(
    typeof storedFontSize === 'number' && Number.isFinite(storedFontSize)
      ? storedFontSize
      : state.editor.fontSize,
  );
  actions.editor.applyFontFamilies();
  const body = window.writer.editor.getBody();
  if (state.editor.showTags) $(body).addClass('showTags');
  if (!state.editor.showBreaks) $(body).addClass('hideBreaks');
  if (state.editor.showTagBubble) $(body).addClass('showTagBubble');
  window.writer.layoutManager.applyRawXmlPanelVisibility(state.editor.showRawXmlPanel);

  const storedStripCjk = effects.editor.api.getFromLocalStorage<boolean>(STRIP_CJK_WHITESPACE_KEY);
  if (storedStripCjk !== null) state.editor.stripCjkWhitespace = storedStripCjk;

  const storedTextLocked = effects.editor.api.getFromLocalStorage<boolean>(TEXT_LOCKED_KEY);
  if (storedTextLocked !== null) {
    state.editor.textLocked = storedTextLocked;
    window.writer.isTextLocked = storedTextLocked;
  }

  const storedValidateXmlOnReplace = effects.editor.api.getFromLocalStorage<boolean>(
    VALIDATE_XML_ON_REPLACE_KEY,
  );
  if (storedValidateXmlOnReplace !== null) {
    state.editor.validateXmlOnReplace = storedValidateXmlOnReplace;
  }

  const storedEnableXmlEditing =
    effects.editor.api.getFromLocalStorage<boolean>(ENABLE_XML_EDITING_KEY);
  if (storedEnableXmlEditing !== null) state.editor.enableXmlEditing = storedEnableXmlEditing;

  const storedEnableMultiFileAutomation = effects.editor.api.getFromLocalStorage<boolean>(
    ENABLE_MULTI_FILE_AUTOMATION_KEY,
  );
  if (storedEnableMultiFileAutomation !== null) {
    state.editor.enableMultiFileAutomation = storedEnableMultiFileAutomation;
  }

  const storedMultiFileSnapshotBefore =
    effects.editor.api.getFromLocalStorage<MultiFileSnapshotTrigger>(
      MULTI_FILE_SNAPSHOT_BEFORE_KEY,
    );
  if (
    storedMultiFileSnapshotBefore &&
    MULTI_FILE_SNAPSHOT_TRIGGERS.includes(storedMultiFileSnapshotBefore)
  ) {
    state.editor.multiFileSnapshotBefore = storedMultiFileSnapshotBefore;
  }

  const storedValidateMultiFileAutomation = effects.editor.api.getFromLocalStorage<boolean>(
    VALIDATE_MULTI_FILE_AUTOMATION_KEY,
  );
  if (storedValidateMultiFileAutomation !== null) {
    state.editor.validateMultiFileAutomation = storedValidateMultiFileAutomation;
  }

  const storedAllowSourceModeSchemaViolations = effects.editor.api.getFromLocalStorage<boolean>(
    ALLOW_SOURCE_MODE_SCHEMA_VIOLATIONS_KEY,
  );
  if (storedAllowSourceModeSchemaViolations !== null) {
    state.editor.allowSourceModeSchemaViolations = storedAllowSourceModeSchemaViolations;
  }

  const storedChoiceDisplayMode =
    effects.editor.api.getFromLocalStorage<ChoiceDisplayMode>(CHOICE_DISPLAY_MODE_KEY);
  if (storedChoiceDisplayMode && CHOICE_DISPLAY_MODES.includes(storedChoiceDisplayMode)) {
    state.editor.choiceDisplayMode = storedChoiceDisplayMode;
  }
  applyChoiceDisplayMode(state.editor.choiceDisplayMode, state.editor.fontSize);

  const storedShowBreaks = effects.editor.api.getFromLocalStorage<boolean>(SHOW_BREAKS_KEY);
  if (storedShowBreaks !== null) state.editor.showBreaks = storedShowBreaks;
  $('body', window.writer.editor.getDoc()).toggleClass('hideBreaks', !state.editor.showBreaks);

  const storedShowNotes = effects.editor.api.getFromLocalStorage<boolean>(SHOW_NOTES_KEY);
  if (storedShowNotes !== null) state.editor.showNotes = storedShowNotes;
  applyShowNotesToDom(window.writer.editor.getDoc(), state.editor.showNotes);
};

export const suspendLWChangeEvent = async ({ state }: Context, value: boolean) => {
  if (!window.writer?.editor) return;

  const { uuid } = window.writer;
  state.editor.LWChangeEventSuspended = value;

  if (value) {
    const content = await window.writer.getContent();
    if (typeof content !== 'string') return;
    await db.suspendedDocuments.put({ content, uuid }, uuid);
  } else {
    await db.suspendedDocuments.delete(uuid);
    state.editor.contentHasChanged = true;
  }
};

export const setFontSize = ({ state, effects }: Context, value: number) => {
  if (!window.writer?.editor) return;

  const styles = { fontSize: `${value}pt` };
  window.writer.editor.dom.setStyles(window.writer.editor.dom.getRoot(), styles);
  state.editor.fontSize = value;
  effects.editor.api.saveToLocalStorage(FONT_SIZE_KEY, value);
  applyChoiceDisplayMode(state.editor.choiceDisplayMode, value);
};

export const applyFontFamilies = ({ state }: Context) => {
  applyFontFamiliesToEditor(state.editor.latinFont, state.editor.asianFont);
};

export const setLatinFont = ({ state, effects }: Context, value: string) => {
  const font = getValidFontFamily(value, DEFAULT_LATIN_FONT);
  state.editor.latinFont = font;
  effects.editor.api.saveToLocalStorage(LATIN_FONT_KEY, font);
  applyFontFamiliesToEditor(font, state.editor.asianFont);
};

export const setAsianFont = ({ state, effects }: Context, value: string) => {
  const font = getValidFontFamily(value, DEFAULT_ASIAN_FONT);
  state.editor.asianFont = font;
  effects.editor.api.saveToLocalStorage(ASIAN_FONT_KEY, font);
  applyFontFamiliesToEditor(state.editor.latinFont, font);
};

export const toggleTextLocked = ({ state, effects }: Context, value?: boolean) => {
  const next = value ?? !state.editor.textLocked;
  state.editor.textLocked = next;
  effects.editor.api.saveToLocalStorage(TEXT_LOCKED_KEY, next);
  if (window.writer) {
    window.writer.isTextLocked = next;
    window.writer.applyTextLockDomGuard?.();
  }
};

export const toggleShowTags = ({ state }: Context, value?: boolean) => {
  if (!window.writer?.editor) return;
  if (!value) value = !state.editor.showTags;

  $('body', window.writer.editor.getDoc()).toggleClass('showTags');
  state.editor.showTags = value;
};

/**
 * Bulk show/hide for all folded commentary (note/citation/keyword entities
 * wrapped in .noteWrapper by tagger.addNoteWrapper). Individual notes stay
 * independently toggleable afterward via their own click handler - this just
 * mass-sets every wrapper's .hide class to match.
 *
 * <note> elements that were never converted into a CWRC note entity (e.g.
 * imported/hand-authored TEI with no matching RDF annotation - see
 * xml2cwrc.ts's processRDF) have no .noteWrapper span at all - regardless of
 * @type, including type="editor"/"comm" - so the rule above has nothing to
 * act on for them. Toggle those bare [_tag="note"] elements directly too
 * (see the matching CSS rule in editor.less); elements already inside a
 * .noteWrapper are excluded so they aren't double-toggled.
 */
export const toggleShowNotes = ({ state, effects }: Context, value?: boolean) => {
  if (!window.writer?.editor) return;
  const next = value ?? !state.editor.showNotes;
  applyShowNotesToDom(window.writer.editor.getDoc(), next);
  state.editor.showNotes = next;
  effects.editor.api.saveToLocalStorage<boolean>(SHOW_NOTES_KEY, next);
};

export const toggleShowBreaks = ({ state, effects }: Context, value?: boolean) => {
  if (!window.writer?.editor) return;
  const next = value ?? !state.editor.showBreaks;
  $('body', window.writer.editor.getDoc()).toggleClass('hideBreaks', !next);
  state.editor.showBreaks = next;
  effects.editor.api.saveToLocalStorage(SHOW_BREAKS_KEY, next);
};

export const setChoiceDisplayMode = ({ state, effects }: Context, mode: ChoiceDisplayMode) => {
  if (!window.writer?.editor) return;
  applyChoiceDisplayMode(mode, state.editor.fontSize);
  state.editor.choiceDisplayMode = mode;
  effects.editor.api.saveToLocalStorage(CHOICE_DISPLAY_MODE_KEY, mode);
};

export const cycleChoiceDisplayMode = ({ state, actions }: Context) => {
  const index = CHOICE_DISPLAY_MODES.indexOf(state.editor.choiceDisplayMode);
  const next = CHOICE_DISPLAY_MODES[(index + 1) % CHOICE_DISPLAY_MODES.length]!;
  actions.editor.setChoiceDisplayMode(next);
};

export const toggleShowTagBubble = ({ state, effects }: Context, value?: boolean) => {
  if (!window.writer?.editor) return;
  const next = value ?? !state.editor.showTagBubble;
  $('body', window.writer.editor.getDoc()).toggleClass('showTagBubble', next);
  state.editor.showTagBubble = next;
  effects.editor.api.saveToLocalStorage<boolean>('showTagBubble', next);
};

export const setStripCjkWhitespace = ({ state, effects }: Context, value: boolean) => {
  state.editor.stripCjkWhitespace = value;
  effects.editor.api.saveToLocalStorage<boolean>(STRIP_CJK_WHITESPACE_KEY, value);
  // Re-process the current document so the change takes effect immediately.
  if (value && window.writer?.isDocLoaded) {
    void window.writer.getDocumentString().then((xml) => {
      if (xml) window.writer?.loadDocumentXML(xml);
    });
  }
};

export const setValidateXmlOnReplace = ({ state, effects }: Context, value: boolean) => {
  state.editor.validateXmlOnReplace = value;
  effects.editor.api.saveToLocalStorage<boolean>(VALIDATE_XML_ON_REPLACE_KEY, value);
};

export const setEnableXmlEditing = ({ state, actions, effects }: Context, value: boolean) => {
  state.editor.enableXmlEditing = value;
  effects.editor.api.saveToLocalStorage<boolean>(ENABLE_XML_EDITING_KEY, value);
  if (!value && state.ui.editorViewMode === 'source') {
    void actions.ui.exitSourceMode();
  }
  // The desktop shell (right panel tabs, etc.) lives outside this overmind
  // instance and can't subscribe to it directly — notify via a DOM event,
  // like the auto-tagging/disambiguation review-panel open/close signals.
  window.dispatchEvent(
    new CustomEvent('leafwriter:enable-xml-editing-change', { detail: { value } }),
  );
};

export const setEnableMultiFileAutomation = ({ state, effects }: Context, value: boolean) => {
  state.editor.enableMultiFileAutomation = value;
  effects.editor.api.saveToLocalStorage<boolean>(ENABLE_MULTI_FILE_AUTOMATION_KEY, value);
};

export const setMultiFileSnapshotBefore = (
  { state, effects }: Context,
  value: MultiFileSnapshotTrigger,
) => {
  state.editor.multiFileSnapshotBefore = value;
  effects.editor.api.saveToLocalStorage<MultiFileSnapshotTrigger>(
    MULTI_FILE_SNAPSHOT_BEFORE_KEY,
    value,
  );
};

export const setValidateMultiFileAutomation = ({ state, effects }: Context, value: boolean) => {
  state.editor.validateMultiFileAutomation = value;
  effects.editor.api.saveToLocalStorage<boolean>(VALIDATE_MULTI_FILE_AUTOMATION_KEY, value);
};

export const setAllowSourceModeSchemaViolations = ({ state, effects }: Context, value: boolean) => {
  state.editor.allowSourceModeSchemaViolations = value;
  effects.editor.api.saveToLocalStorage<boolean>(ALLOW_SOURCE_MODE_SCHEMA_VIOLATIONS_KEY, value);
};

export const setShowRawXmlPanel = ({ state, effects }: Context, value: boolean) => {
  state.editor.showRawXmlPanel = value;
  effects.editor.api.saveToLocalStorage(SHOW_RAW_XML_PANEL_KEY, value);
  window.writer?.layoutManager?.applyRawXmlPanelVisibility(value);
};

export const toggleAdvancedSettings = ({ state }: Context, value: boolean) => {
  state.editor.advancedSettings = value;
};

export const setReadonly = ({ state }: Context, value = false) => {
  state.editor.isReadonly = value;
};

export const setEditorMode = ({ state }: Context, editorMode: string) => {
  if (!window.writer?.editor) return;

  const writer = window.writer;

  if (editorMode !== 'xmlrdfoverlap') {
    writer.entitiesManager.removeOverlappingEntities();
    writer.entitiesManager.convertBoundaryEntitiesToTags();
  }

  switch (editorMode) {
    case 'xml':
      state.editor.mode = 1;
      state.editor.allowOverlap = false;
      writer.mode = writer.XML;
      writer.allowOverlap = false;
      break;
    case 'xmlrdf':
      state.editor.mode = 0;
      state.editor.allowOverlap = false;
      writer.mode = writer.XMLRDF;
      writer.allowOverlap = false;
      break;
    case 'xmlrdfoverlap':
      state.editor.mode = 0;
      state.editor.allowOverlap = true;
      writer.mode = writer.XMLRDF;
      writer.allowOverlap = true;
      break;
    case 'rdf':
      state.editor.mode = 2;
      state.editor.allowOverlap = true;
      writer.mode = writer.RDF;
      writer.allowOverlap = true;
  }

  state.editor.editorMode = editorMode;

  return state.editor.editorModes.find((edMode) => edMode.value === editorMode);
};

export const getEditorModeByKey = ({ state }: Context, key: number) => {
  return state.editor.editorModes.find((editorMode) => editorMode.key === key);
};

export const getEditorModeByValue = ({ state }: Context, value: string) => {
  return state.editor.editorModes.find((editorMode) => editorMode.value === value);
};

export const setAnnotationrMode = ({ state }: Context, value: number) => {
  if (!window.writer?.editor) return;

  window.writer.annotationMode = value;
  state.editor.annotationMode = value;
  return state.editor.annotationModes.find((annotationMode) => annotationMode.value === value);
};

const isProjectSchemaId = (id: string) => id.startsWith('project-');

/** Drop project-local schemas when switching projects (ids are filename-based, not project-unique). */
export const clearProjectSchemas = ({ state }: Context) => {
  if (!window.writer) return;

  window.writer.schemaManager.schemas = window.writer.schemaManager.schemas.filter(
    (schema) => !isProjectSchemaId(schema.id),
  );

  const kept: Record<string, Schema> = {};
  for (const [id, schema] of Object.entries(state.editor.schemas)) {
    if (!isProjectSchemaId(id)) {
      kept[id] = schema;
    }
  }
  state.editor.schemas = kept;
};

const cloneSchema = (schema: Schema): Schema => ({
  css: [...schema.css],
  editable: schema.editable ?? true,
  id: schema.id,
  mapping: schema.mapping,
  name: schema.name,
  rng: [...schema.rng],
});

/** Register project-local schemas (desktop) without persisting to customSchemas DB. */
export const registerProjectSchemas = ({ state }: Context, schemas: Schema[]) => {
  if (!window.writer) return;

  for (const schema of schemas) {
    const entry = cloneSchema(schema);
    state.editor.schemas[entry.id] = entry;
  }
};

/**
 * It adds a new schema to the list of schemas
 * @param schema - Omit<Schema, 'id'>
 * @returns The new schema that was added.
 */
export const addSchema = async ({ state }: Context, newSchema: Omit<Schema, 'id'>) => {
  if (!window.writer?.editor) return;

  const schema = window.writer.schemaManager.addSchema({ ...newSchema, editable: true });
  state.editor.schemas[schema.id] = schema;

  await db.customSchemas.add(schema);

  return schema;
};

/**
 * Updates a schema
 * @param updatedSchema - Schema - this is the updated schema that we're going to use to
 * update the schemas array.
 * @returns The updated schema.
 */
export const updateSchema = async ({ state }: Context, updatedSchema: Schema) => {
  if (!window.writer?.editor) return;
  window.writer.schemaManager.updateSchema(updatedSchema);
  state.editor.schemas[updatedSchema.id] = updatedSchema;

  await db.customSchemas.put(updatedSchema);

  return updatedSchema;
};

/**
 * It takes a schemaId as an argument, and then filters the schemas array to remove the schema with
 * the matching id
 * @param {string} schemaId - The id of the schema to delete
 */
export const deleteSchema = async ({ state }: Context, schemaId: string) => {
  if (!window.writer?.editor) return;
  window.writer.schemaManager.deleteSchema(schemaId);

  const updatedSchemaList = state.editor.schemasList.filter((schema) => schema.id !== schemaId);

  const schemaObjs: Record<string, Schema> = {};
  updatedSchemaList.forEach((element) => (schemaObjs[element.id] = element));

  state.editor.schemas = schemaObjs;

  await db.customSchemas.delete(schemaId);
};

export const getSchemsByMappingId = ({ state }: Context, mappingId: string) => {
  return state.editor.schemasList.filter((schema) => schema.mapping === mappingId);
};

export const resetDialogWarnings = async ({ actions }: Context) => {
  Cookies.remove(DIALOG_PREFS_COOKIE_NAME, { path: '' });
  await actions.ui.resetDoNotDisplayDialogs();
};

export const resetPreferences = async ({ actions }: Context) => {
  actions.editor.setFontSize(11);
  actions.editor.setLatinFont(DEFAULT_LATIN_FONT);
  actions.editor.setAsianFont(DEFAULT_ASIAN_FONT);
  actions.editor.toggleShowTags(false);
  actions.editor.setShowRawXmlPanel(false);
  actions.editor.setValidateXmlOnReplace(true);
  actions.editor.setEditorMode('xmlrdf');
  actions.editor.setAnnotationrMode(3);
  await actions.ui.resetDoNotDisplayDialogs();

  resetLookupPreferences();

  actions.ui.resetPreferences();
};

export const setIsAnnotator = ({ state }: Context, value: boolean) => {
  state.editor.isAnnotator = value;
};

export const getContent = async ({ state, actions }: Context) => {
  if (state.editor.LWChangeEventSuspended) {
    if (!window.writer?.editor) return;

    const { uuid } = window.writer;
    const suspended = await db.suspendedDocuments.get(uuid);
    if (!suspended) return;

    return suspended.content;
  }

  if (state.ui.editorViewMode === 'source') {
    let content = state.ui.sourceCurrentContent;
    if (!content) return;

    if (state.document.standOffTags) {
      content = actions.editor.restoreStandOff(content);
    }

    return content;
  }

  let content = await window.writer.getContent();
  if (!content) return;

  if (state.document.standOffTags) {
    content = actions.editor.restoreStandOff(content);
  }

  return content;
};

export const setContentHasChanged = ({ state }: Context, value: boolean) => {
  state.editor.contentHasChanged = value;
};

export const closeEditor = ({ state }: Context) => {
  state.editor.latestEvent = 'close';
};

export const restoreStandOff = ({ state }: Context, content: string) => {
  const xml = new DOMParser().parseFromString(content, 'application/xml');

  const standOffTags = state.document.standOffTags;
  if (standOffTags) {
    standOffTags.forEach((tag) => {
      const standOffTag = new DOMParser().parseFromString(tag.toString(), 'application/xml');
      xml.documentElement.append(standOffTag.documentElement);
    });
  }
  return new XMLSerializer().serializeToString(xml);
};

export const clear = ({ state }: Context) => {
  state.editor.LWChangeEventSuspended = false;
  state.editor.advancedSettings = true;
  state.editor.allowOverlap = false;
  state.editor.annotationMode = 3;
  state.editor.contentHasChanged = false;
  state.editor.editorMode = 'xmlrdf';
  state.editor.asianFont = DEFAULT_ASIAN_FONT;
  state.editor.fontSize = DEFAULT_EDITOR_FONT_SIZE;
  state.editor.latinFont = DEFAULT_LATIN_FONT;
  state.editor.isAnnotator = false;
  state.editor.isReadonly = false;
  state.editor.mode = 0;
  state.editor.showTags = false;
  state.editor.showNotes = true;
  state.editor.showBreaks = true;
  state.editor.validateXmlOnReplace = true;
};
