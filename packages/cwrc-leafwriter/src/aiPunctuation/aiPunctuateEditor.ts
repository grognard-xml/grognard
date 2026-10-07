import {
  finishAiRunProgress,
  startAiRunProgress,
  updateAiRunProgress,
} from '../autoTagging/aiRunProgress';
import { appendTeiRevisionChange } from '../../../../apps/commons/src/desktop/kanripoImportXml';
import {
  createLlmClientFromSettings,
  isAiSuggestReady,
  aiApiSettingsFromDesktop,
} from '../autoTagging/llmClientFromSettings';
import { formatAiProvenance } from './formatAiProvenance';
import {
  finalizeKanripoBody,
  listAiPunctSegments,
  purgePunctuation,
  reflowParagraphs,
} from './pluginBridge';
import { runAiPunctuate } from './runAiPunctuate';
import {
  extractJuanDiv,
  findSelectionHanRange,
  getEditorSelectedPlainText,
  consumeCapturedEditorSelection,
  punctInHanRange,
  replaceJuanDiv,
  segmentsInSelection,
  unpunctuatedRanges,
  type HanRange,
} from './selectionScope';
import { AI_PUNCT_PROMPT_VERSION } from './prompts';
import { MIN_SEGMENT_HAN } from './punctSchema';

const xmlLooksWellFormed = (xml: string): boolean => {
  try {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    return !doc.querySelector('parsererror');
  } catch {
    return false;
  }
};

export type AiPunctuateEditorOutcome =
  { ok: true; message: string } | { ok: false; message: string; cancelled?: boolean };

function scopeHasPunct(
  segments: { id: number; has_punct: boolean }[],
  segmentIds?: number[],
): boolean {
  const idSet = segmentIds ? new Set(segmentIds) : null;
  return segments.some((seg) => {
    if (idSet && !idSet.has(seg.id)) return false;
    return seg.has_punct;
  });
}

type ExistingPunctChoice = 'keep' | 'purge' | 'cancel';

/** What to do when the target already carries punctuation. Keep is the safe default. */
async function askExistingPunctChoice(inSelection: boolean): Promise<ExistingPunctChoice> {
  const where = inSelection ? 'The selected text' : 'This juan';
  const detail =
    'Keep existing marks and punctuate only the paragraphs that have none (nothing already ' +
    'punctuated is changed), or purge the marks and punctuate everything again. ' +
    'Purging rewrites the file and cannot be undone from the editor.';
  const api = window.electronAPI;
  if (api?.showNativeMessageBox) {
    const { response } = await api.showNativeMessageBox({
      type: 'question',
      title: 'AI punctuate',
      message: `${where} already contains punctuation marks.`,
      detail,
      buttons: ['Keep existing', 'Purge and re-punctuate', 'Cancel'],
      defaultId: 0,
      cancelId: 2,
    });
    return response === 0 ? 'keep' : response === 1 ? 'purge' : 'cancel';
  }
  if (
    window.confirm(
      `${where} already contains punctuation marks.\n\n${detail}\n\nOK = keep existing.`,
    )
  ) {
    return 'keep';
  }
  return window.confirm('Purge the punctuation and re-punctuate everything?') ? 'purge' : 'cancel';
}

async function writeActiveDocument(next: string): Promise<boolean> {
  const filePath = window.__leafWriterProject?.getActiveFilePath?.();
  if (filePath && window.electronAPI?.writeFile) {
    await window.electronAPI.writeFile(filePath, next);
    await window.__leafWriterProject?.reloadFileFromDisk?.(filePath);
    return true;
  }
  if (window.writer?.setDocument) {
    window.writer.setDocument(next);
    return true;
  }
  return false;
}

export async function runAiPunctuateEditorCommand(options?: {
  forcePurge?: boolean;
  skipPurgePrompt?: boolean;
}): Promise<AiPunctuateEditorOutcome> {
  const settings = aiApiSettingsFromDesktop();
  if (!isAiSuggestReady(settings)) {
    return { ok: false, message: 'Configure and test AI API settings first (App Settings).' };
  }
  const xml = window.__leafWriterProject?.getActiveFileXml?.() ?? '';
  const body = extractJuanDiv(xml);
  if (!body) {
    return { ok: false, message: 'Open a Kanripo TEI file (with a juan div) first.' };
  }

  const listed = await listAiPunctSegments(body);
  const selectedPlain = getEditorSelectedPlainText();
  const hanRange = findSelectionHanRange(listed.segments, selectedPlain);
  if (selectedPlain.trim() && hanRange === null) {
    return {
      ok: false,
      message:
        'Could not locate the selected text in this juan. Select contiguous characters in the main text.',
    };
  }
  const segmentIds = hanRange ? segmentsInSelection(listed.segments, selectedPlain) : undefined;

  const selectionHasPunct = hanRange ? punctInHanRange(listed.segments, hanRange) : false;
  const juanHasPunct = scopeHasPunct(listed.segments);
  const scopeHasMarks = hanRange ? selectionHasPunct : listed.has_any_punct && juanHasPunct;

  let choice: ExistingPunctChoice = 'purge';
  if (scopeHasMarks) {
    choice = options?.forcePurge
      ? 'purge'
      : options?.skipPurgePrompt
        ? 'keep'
        : await askExistingPunctChoice(Boolean(hanRange));
    if (choice === 'cancel') {
      return { ok: false, message: 'Cancelled.', cancelled: true };
    }
  }

  // Keep: AI sees only the paragraphs that carry no marks. Segments span adjacent paragraphs, so
  // paragraph spans (not segments) are what say which part of the scope is still bare.
  let keepRanges: HanRange[] | undefined;
  if (scopeHasMarks && choice === 'keep') {
    const tapeEnd = listed.segments[listed.segments.length - 1]?.han_end ?? 0;
    const scope: HanRange = hanRange ?? { start: 0, end: tapeEnd };
    keepRanges = listed.paragraphs ? unpunctuatedRanges(listed.paragraphs, scope) : undefined;
    if (!keepRanges) {
      return {
        ok: false,
        message:
          'Keeping existing punctuation needs a newer Kanripo plugin. Update it, or purge first.',
      };
    }
    if (keepRanges.length === 0) {
      return {
        ok: false,
        message: `Nothing to do: every paragraph ${hanRange ? 'in the selection' : 'in the juan'} is already punctuated.`,
      };
    }
  } else if (scopeHasMarks) {
    listed.body_xml = await purgePunctuation(
      listed.body_xml,
      hanRange ? 'han_range' : 'whole_juan',
      undefined,
      hanRange ?? undefined,
    );
  }

  const client = createLlmClientFromSettings(settings!);
  const abortController = new AbortController();
  startAiRunProgress('AI punctuation', () => abortController.abort());
  let result;
  try {
    result = await runAiPunctuate(listed.body_xml, {
      client,
      segmentIds: keepRanges ? undefined : segmentIds,
      hanRange: keepRanges ? undefined : (hanRange ?? undefined),
      hanRanges: keepRanges,
      signal: abortController.signal,
      onProgress: (done, total) => updateAiRunProgress(done, total),
    });
  } catch (error) {
    if (abortController.signal.aborted) {
      return { ok: false, message: 'Cancelled.', cancelled: true };
    }
    throw error;
  } finally {
    consumeCapturedEditorSelection();
    finishAiRunProgress();
  }

  if (!result.applied) {
    const skippedShort =
      listed.segments.filter((s) => s.han.length < MIN_SEGMENT_HAN).length ===
      listed.segments.length;
    let detail: string;
    if (result.llm_segments === 0) {
      detail = hanRange
        ? ' The selection was too short, already punctuated, or could not be matched to a segment.'
        : ' All segments were too short or already marked as punctuated.';
    } else if (result.stats.align_failed > 0) {
      detail = ` The model responded, but alignment failed (${result.stats.align_failed} segment(s) could not be matched onto the XML).`;
    } else {
      detail = skippedShort
        ? ` All segments were too short (< ${MIN_SEGMENT_HAN} Han characters) or already punctuated.`
        : ' The model returned no transferable punctuation marks.';
    }
    return {
      ok: false,
      message: `No punctuation applied.${detail}`,
    };
  }

  let next = replaceJuanDiv(xml, await finalizeKanripoBody(result.body_xml));
  next = appendTeiRevisionChange(
    next,
    formatAiProvenance({
      modelId: client.modelId,
      promptVersion: AI_PUNCT_PROMPT_VERSION,
      normalize: 'none',
      stats: result.stats,
    }),
  );
  if (!xmlLooksWellFormed(next)) {
    return { ok: false, message: 'Resulting XML is not well-formed.' };
  }
  if (!(await writeActiveDocument(next))) {
    return { ok: false, message: 'Could not write the active document.' };
  }
  return {
    ok: true,
    message: keepRanges
      ? `Applied ${result.stats.applied} mark(s) to the unpunctuated paragraphs${hanRange ? ' in the selection' : ''}; existing punctuation was left as it was.`
      : hanRange
        ? `Applied ${result.stats.applied} mark(s) in the selection.`
        : `Applied ${result.stats.applied} mark(s) across ${result.stats.segments_applied} segment(s).`,
  };
}

/** AI on segments still missing or sparsely punctuated after parallel transfer. */
async function fillGapsInKanripoXml(
  xml: string,
  options?: { signal?: AbortSignal; onProgress?: (done: number, total: number) => void },
): Promise<
  | { ok: true; nextXml: string; message: string }
  | { ok: false; message: string; cancelled?: boolean }
> {
  const settings = aiApiSettingsFromDesktop();
  if (!isAiSuggestReady(settings)) {
    return { ok: false, message: 'Configure and test AI API settings first (App Settings).' };
  }
  const body = extractJuanDiv(xml);
  if (!body) {
    return { ok: false, message: 'Open a Kanripo TEI file (with a juan div) first.' };
  }

  const listed = await listAiPunctSegments(body);
  const client = createLlmClientFromSettings(settings!);
  const abortController = new AbortController();
  const onParentAbort = () => abortController.abort();
  options?.signal?.addEventListener('abort', onParentAbort);
  startAiRunProgress('AI fill gaps', () => abortController.abort());
  let result;
  try {
    result = await runAiPunctuate(listed.body_xml, {
      client,
      gapsOnly: true,
      signal: abortController.signal,
      onProgress: options?.onProgress ?? updateAiRunProgress,
    });
  } catch (error) {
    if (abortController.signal.aborted) {
      return { ok: false, message: 'Cancelled.', cancelled: true };
    }
    throw error;
  } finally {
    options?.signal?.removeEventListener('abort', onParentAbort);
    finishAiRunProgress();
  }

  if (!result.applied) {
    return {
      ok: false,
      message:
        'No gaps to fill — parallel coverage looks adequate on all segments (or all gap segments were too short).',
    };
  }

  let next = replaceJuanDiv(xml, await finalizeKanripoBody(result.body_xml));
  next = appendTeiRevisionChange(
    next,
    formatAiProvenance({
      modelId: client.modelId,
      promptVersion: AI_PUNCT_PROMPT_VERSION,
      normalize: 'none',
      stats: result.stats,
    }),
  );
  if (!xmlLooksWellFormed(next)) {
    return { ok: false, message: 'Resulting XML is not well-formed.' };
  }
  return {
    ok: true,
    nextXml: next,
    message: `Filled gaps: ${result.stats.applied} mark(s) across ${result.stats.segments_applied} segment(s).`,
  };
}

export async function runAiFillGapsOnFile(
  filePath: string,
  options?: { signal?: AbortSignal; onProgress?: (done: number, total: number) => void },
): Promise<AiPunctuateEditorOutcome> {
  const api = window.electronAPI;
  if (!api?.readFile || !api?.writeFile) {
    return { ok: false, message: 'Fill gaps is only available in the desktop app.' };
  }
  const xml = await api.readFile(filePath);
  const outcome = await fillGapsInKanripoXml(xml, options);
  if (!outcome.ok) return outcome;
  await api.writeFile(filePath, outcome.nextXml);
  await window.__leafWriterProject?.reloadFileFromDisk?.(filePath);
  return { ok: true, message: outcome.message };
}

export async function runAiFillGapsEditorCommand(): Promise<AiPunctuateEditorOutcome> {
  const xml = window.__leafWriterProject?.getActiveFileXml?.() ?? '';
  if (!xml.trim()) {
    return { ok: false, message: 'Open a document first.' };
  }
  const outcome = await fillGapsInKanripoXml(xml);
  if (!outcome.ok) return outcome;
  if (!(await writeActiveDocument(outcome.nextXml))) {
    return { ok: false, message: 'Could not write the active document.' };
  }
  return { ok: true, message: outcome.message };
}

export async function runPurgePunctEditorCommand(): Promise<AiPunctuateEditorOutcome> {
  const xml = window.__leafWriterProject?.getActiveFileXml?.() ?? '';
  const body = extractJuanDiv(xml);
  if (!body) {
    return { ok: false, message: 'Open a Kanripo TEI file (with a juan div) first.' };
  }
  const listed = await listAiPunctSegments(body);
  if (!listed.has_any_punct) {
    return { ok: false, message: 'No punctuation marks to purge in this juan.' };
  }
  const selectedPlain = getEditorSelectedPlainText();
  const hanRange = findSelectionHanRange(listed.segments, selectedPlain);
  if (selectedPlain.trim() && hanRange === null) {
    return {
      ok: false,
      message:
        'Could not locate the selected text in this juan. Select contiguous characters in the main text.',
    };
  }
  const selectionHasPunct = hanRange ? punctInHanRange(listed.segments, hanRange) : false;
  if (hanRange && !selectionHasPunct) {
    return { ok: false, message: 'The selection contains no punctuation marks.' };
  }
  const segmentIds = hanRange ? undefined : segmentsInSelection(listed.segments, selectedPlain);
  const scopeLabel = hanRange ? 'selection' : segmentIds ? 'selection' : 'juan';
  const ok = window.confirm(`Remove punctuation marks from this ${scopeLabel}?`);
  if (!ok) {
    return { ok: false, message: 'Cancelled.', cancelled: true };
  }
  const cleaned = await purgePunctuation(
    listed.body_xml,
    hanRange ? 'han_range' : segmentIds ? 'segments' : 'whole_juan',
    segmentIds,
    hanRange ?? undefined,
  );
  let next = replaceJuanDiv(xml, cleaned);
  next = appendTeiRevisionChange(next, `purged punctuation (${scopeLabel})`);
  if (!xmlLooksWellFormed(next)) {
    return { ok: false, message: 'Resulting XML is not well-formed.' };
  }
  if (!(await writeActiveDocument(next))) {
    return { ok: false, message: 'Could not write the active document.' };
  }
  return { ok: true, message: 'Punctuation purged.' };
}

export async function runReflowParagraphsEditorCommand(): Promise<AiPunctuateEditorOutcome> {
  const xml = window.__leafWriterProject?.getActiveFileXml?.() ?? '';
  const body = extractJuanDiv(xml);
  if (!body) {
    return { ok: false, message: 'Open a Kanripo TEI file (with a juan div) first.' };
  }
  const ok = window.confirm('Reflow paragraphs at sentence boundaries in this juan?');
  if (!ok) {
    return { ok: false, message: 'Cancelled.', cancelled: true };
  }
  const reflowed = await reflowParagraphs(body);
  let next = replaceJuanDiv(xml, reflowed);
  next = appendTeiRevisionChange(next, 'reflowed paragraphs at sentence boundaries');
  if (!xmlLooksWellFormed(next)) {
    return { ok: false, message: 'Resulting XML is not well-formed.' };
  }
  if (!(await writeActiveDocument(next))) {
    return { ok: false, message: 'Could not write the active document.' };
  }
  return { ok: true, message: 'Paragraphs reflowed.' };
}
