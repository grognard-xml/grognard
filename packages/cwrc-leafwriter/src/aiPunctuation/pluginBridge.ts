const PLUGIN_ID = 'kanripo-import';

export interface AiPunctSegment {
  id: number;
  kind: 'text' | 'comm';
  han: string;
  text: string;
  han_start: number;
  han_end: number;
  has_punct: boolean;
  preceding_comm?: string;
  following_comm?: string;
}

export interface ListSegmentsResult {
  segments: AiPunctSegment[];
  has_any_punct: boolean;
  body_xml: string;
}

export interface ApplyInsertionsResult {
  body_xml: string;
  stats: {
    applied: number;
    dropped_anchor: number;
    skipped_punctuated: number;
    segments_total: number;
  };
  applied: boolean;
}

export interface AiParallelApplyStats {
  segments_total: number;
  segments_applied: number;
  align_failed: number;
  marks_added: number;
  reflowed: boolean;
}

export interface AiParallelApplyResult {
  body_xml: string;
  stats: AiParallelApplyStats;
  applied: boolean;
}

async function invokePython<T>(payload: Record<string, unknown>): Promise<T> {
  const api = window.electronAPI;
  if (!api?.pluginsInvokePython) {
    throw new Error('Python bridge unavailable.');
  }
  return (await api.pluginsInvokePython(PLUGIN_ID, payload)) as T;
}

export async function listAiPunctSegments(bodyXml: string): Promise<ListSegmentsResult> {
  return invokePython({ op: 'ai_punct_list_segments', body_xml: bodyXml });
}

export async function applyAiPunctInsertions(
  bodyXml: string,
  verifiedBySegment: Record<number, { afterHan: number; mark: string; global_han: number }[]>,
  segmentMeta: AiPunctSegment[],
): Promise<ApplyInsertionsResult> {
  const payload: Record<string, unknown> = {
    op: 'ai_punct_apply',
    body_xml: bodyXml,
    verified_by_segment: Object.fromEntries(
      Object.entries(verifiedBySegment).map(([key, value]) => [String(key), value]),
    ),
    segment_meta: segmentMeta,
  };
  return invokePython(payload);
}

export async function applyAiParallelPunct(
  bodyXml: string,
  segmentParallels: { parallel_text: string; han_start?: number; han_end?: number }[],
  options?: { reflow?: boolean },
): Promise<AiParallelApplyResult> {
  return invokePython({
    op: 'ai_punct_parallel_apply',
    body_xml: bodyXml,
    segment_parallels: segmentParallels,
    reflow: options?.reflow !== false,
  });
}

export async function purgePunctuation(
  bodyXml: string,
  scope: 'whole_juan' | 'segments' | 'han_range' = 'whole_juan',
  segmentIds?: number[],
  hanRange?: { start: number; end: number },
): Promise<string> {
  const result = await invokePython<{ body_xml: string }>({
    op: 'purge_punct',
    body_xml: bodyXml,
    scope,
    segment_ids: segmentIds,
    han_start: hanRange?.start,
    han_end: hanRange?.end,
  });
  return result.body_xml;
}

export async function reflowParagraphs(bodyXml: string): Promise<string> {
  const result = await invokePython<{ body_xml: string }>({
    op: 'reflow_paragraphs',
    body_xml: bodyXml,
  });
  return result.body_xml;
}

export interface PunctCoverage {
  start: number;
  end: number;
  covered_chars: number;
  total_chars: number;
  ratio: number;
  empty: boolean;
  spans?: {
    start: number;
    end: number;
    covered_chars: number;
    source: string;
    preview: string;
  }[];
}

/** Green/grey bar from actual punctuation marks (parallel or AI), not parallel overlap alone. */
export async function fetchPunctCoverage(bodyXml: string): Promise<PunctCoverage> {
  const result = await invokePython<{ coverage: PunctCoverage }>({
    op: 'punct_coverage',
    body_xml: bodyXml,
  });
  return result.coverage;
}
