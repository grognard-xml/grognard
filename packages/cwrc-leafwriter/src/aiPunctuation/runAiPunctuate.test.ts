import type { LlmClient, LlmRequest } from '../autoTagging/llmClient';
import { runAiPunctuate } from './runAiPunctuate';
import type { AiPunctSegment } from './pluginBridge';

jest.mock('./pluginBridge', () => ({
  listAiPunctSegments: jest.fn(),
  applyAiParallelPunct: jest.fn(),
}));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const bridge = require('./pluginBridge') as {
  listAiPunctSegments: jest.Mock;
  applyAiParallelPunct: jest.Mock;
};

/** 12 base-text fragments of 100 Han, each followed by a 25-Han note. */
const buildSegments = (): AiPunctSegment[] => {
  const segments: AiPunctSegment[] = [];
  let cursor = 0;
  const push = (kind: 'text' | 'comm', han: string) => {
    segments.push({
      id: segments.length,
      kind,
      han,
      text: han,
      han_start: cursor,
      han_end: cursor + han.length,
      has_punct: false,
    });
    cursor += han.length;
  };
  for (let i = 0; i < 12; i++) {
    push('text', String.fromCodePoint(0x4e00 + i).repeat(100));
    push('comm', String.fromCodePoint(0x5000 + i).repeat(25));
  }
  return segments;
};

const BASE_MARKER = 'Base text (Han only — punctuate this string):\n';
const baseOf = (user: string) => {
  const start = user.indexOf(BASE_MARKER) + BASE_MARKER.length;
  const rest = user.slice(start);
  const end = rest.search(/\n\n|$/);
  return rest.slice(0, end);
};

const makeClient = (options: { corrupt?: (han: string) => boolean } = {}) => {
  const state = { inFlight: 0, peak: 0, calls: 0 };
  const client: LlmClient = {
    modelId: 'test',
    async complete(request: LlmRequest) {
      state.calls += 1;
      state.inFlight += 1;
      state.peak = Math.max(state.peak, state.inFlight);
      const order = state.calls;
      // later calls finish sooner, so completion order is the reverse of start order
      await new Promise((resolve) => setTimeout(resolve, Math.max(1, 40 - order * 2)));
      state.inFlight -= 1;
      request.signal?.throwIfAborted();
      const han = baseOf(request.user);
      const answer = options.corrupt?.(han) ? han.slice(0, -1) : `${han}。`;
      return { json: answer, usage: { inputTokens: 0, outputTokens: 0 } };
    },
  };
  return { client, state };
};

beforeEach(() => {
  const segments = buildSegments();
  bridge.listAiPunctSegments.mockResolvedValue({
    segments,
    has_any_punct: false,
    body_xml: '<div/>',
  });
  bridge.applyAiParallelPunct.mockImplementation(async (xml: string, parallels: unknown[]) => ({
    body_xml: xml,
    stats: {
      segments_total: parallels.length,
      segments_applied: parallels.length,
      align_failed: 0,
      marks_added: parallels.length,
      reflowed: false,
    },
    applied: true,
  }));
});

describe('runAiPunctuate', () => {
  it('sends calls in parallel, never above the limit, and applies in document order', async () => {
    const { client, state } = makeClient();
    const progress: [number, number][] = [];
    const result = await runAiPunctuate('<div/>', {
      client,
      concurrency: 4,
      onProgress: (done, total) => progress.push([done, total]),
    });
    expect(result.applied).toBe(true);
    expect(state.peak).toBe(4);

    const parallels = bridge.applyAiParallelPunct.mock.calls[0]![1] as {
      parallel_text: string;
      han_start: number;
      han_end: number;
    }[];
    // 12 fragments + 12 notes, each exactly once, each carrying its own text back
    expect(parallels).toHaveLength(24);
    const segments = buildSegments();
    for (const p of parallels) {
      const seg = segments.find((s) => s.han_start === p.han_start)!;
      expect(p.han_end).toBe(seg.han_end);
      expect(p.parallel_text.replace(/。/g, '')).toBe(seg.han);
    }
    // progress counts model calls and ends at the total
    const [done, total] = progress[progress.length - 1]!;
    expect(done).toBe(total);
    expect(total).toBe(state.calls);
    expect(progress.map(([d]) => d)).toEqual([...progress.map(([d]) => d)].sort((a, b) => a - b));
  });

  it('produces the same result as a sequential run, whatever order calls finish in', async () => {
    const run = async (concurrency: number) => {
      bridge.applyAiParallelPunct.mockClear();
      await runAiPunctuate('<div/>', { client: makeClient().client, concurrency });
      return bridge.applyAiParallelPunct.mock.calls[0]![1];
    };
    expect(await run(6)).toEqual(await run(1));
  });

  it('runs one call at a time by default', async () => {
    const { client, state } = makeClient();
    await runAiPunctuate('<div/>', { client });
    expect(state.peak).toBe(1);
  });

  it('applies a note as the model answered it even when a character is missing (the plugin aligns it)', async () => {
    // the model drops a character of one note only
    const bad = String.fromCodePoint(0x5003).repeat(25);
    const { client } = makeClient({ corrupt: (han) => han === bad });
    const result = await runAiPunctuate('<div/>', { client, concurrency: 3 });
    const parallels = bridge.applyAiParallelPunct.mock.calls[0]![1] as { han_start: number }[];
    expect(parallels).toHaveLength(24);
    expect(result.stats.align_failed).toBe(0);
  });

  it('leaves a run chunk unpunctuated and counts it when the model keeps miscounting', async () => {
    const run = String.fromCodePoint(0x4e00).repeat(100);
    const { client } = makeClient({ corrupt: (han) => han.startsWith(run) });
    const result = await runAiPunctuate('<div/>', { client, concurrency: 3 });
    const parallels = bridge.applyAiParallelPunct.mock.calls[0]![1] as { han_start: number }[];
    expect(result.stats.align_failed).toBe(1);
    // that chunk's fragments are not applied; the other chunks' fragments and all notes are
    expect(parallels.length).toBeLessThan(24);
    expect(parallels.length).toBeGreaterThanOrEqual(24 - 4);
  });

  it('rejects and stops when the caller aborts mid-run', async () => {
    const { client, state } = makeClient();
    const controller = new AbortController();
    const run = runAiPunctuate('<div/>', { client, concurrency: 2, signal: controller.signal });
    setTimeout(() => controller.abort(new DOMException('stopped', 'AbortError')), 15);
    await expect(run).rejects.toMatchObject({ name: 'AbortError' });
    expect(state.calls).toBeLessThan(10);
    expect(bridge.applyAiParallelPunct).not.toHaveBeenCalled();
  });
});
