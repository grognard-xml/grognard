import {
  buildPunctUnits,
  chunkRunFragments,
  splitPunctuatedRun,
  type RunSegmentLike,
} from './punctRuns';
import { llmPunctuatePlainRun } from './llmPunctuatePlain';
import { buildRunPunctUserPrompt } from './prompts';
import { filterSegmentsForAi, segmentNeedsAiGap } from './selectionScope';
import type { LlmClient } from '../autoTagging/llmClient';

let cursor = 0;
const seg = (
  id: number,
  kind: 'text' | 'comm' | 'head',
  han: string,
): RunSegmentLike & {
  has_punct: boolean;
} => {
  const han_start = cursor;
  cursor += Array.from(han).length;
  return { id, kind, han, han_start, han_end: cursor, has_punct: false };
};
const build = (spec: ['text' | 'comm' | 'head', string][]) => {
  cursor = 0;
  return spec.map(([kind, han], id) => seg(id, kind, han));
};

describe('splitPunctuatedRun', () => {
  it('splits marks onto the earlier fragment', () => {
    expect(splitPunctuatedRun('多桂，多金玉，有草焉。', [2, 3, 3])).toEqual([
      '多桂，',
      '多金玉，',
      '有草焉。',
    ]);
  });

  it('keeps opening brackets with the following fragment', () => {
    expect(splitPunctuatedRun('曰：「招搖」。', [1, 2])).toEqual(['曰：', '「招搖」。']);
  });

  it('keeps leading and trailing marks on the first and last fragment', () => {
    expect(splitPunctuatedRun('《山海經》曰，', [2, 2])).toEqual(['《山海', '經》曰，']);
  });

  it('counts astral Han as one character', () => {
    expect(splitPunctuatedRun('𪁺甲，乙丙。', [2, 2])).toEqual(['𪁺甲，', '乙丙。']);
  });

  it('returns null when the model added or dropped a character', () => {
    expect(splitPunctuatedRun('多桂，多金玉。', [2, 4])).toBeNull();
    expect(splitPunctuatedRun('多桂，多金玉玉。', [2, 3])).toBeNull();
  });

  it('keeps a fragment with no marks intact', () => {
    expect(splitPunctuatedRun('甲乙丙丁，戊己。', [2, 2, 2])).toEqual(['甲乙', '丙丁，', '戊己。']);
  });
});

describe('buildPunctUnits', () => {
  it('groups base-text fragments across notes and keeps each note atomic', () => {
    const segments = build([
      ['text', '多桂'],
      ['comm', '在蜀伏山南西頭濱西海也'],
      ['text', '多金玉有草焉其狀如韭'],
      ['comm', '璨曰韭音九'],
      ['text', '而青花其名曰祝餘'],
    ]);
    const units = buildPunctUnits(segments, segments, 1);
    const text = units.filter((u) => u.kind === 'text');
    expect(text).toHaveLength(1);
    expect(text[0]).toMatchObject({
      fragments: [
        { han: '多桂', notes_after: '在蜀伏山南西頭濱西海也' },
        { han: '多金玉有草焉其狀如韭', notes_after: '璨曰韭音九' },
        { han: '而青花其名曰祝餘' },
      ],
    });
    expect(units.filter((u) => u.kind === 'comm')).toHaveLength(2);
  });

  it('ends a run at a text segment that is not a target', () => {
    const segments = build([
      ['text', '甲'.repeat(10)],
      ['comm', '乙'],
      ['text', '丙'.repeat(10)],
      ['comm', '乙'],
      ['text', '丁'.repeat(10)],
    ]);
    const targets = segments.filter((s) => s.kind === 'text' && s.id !== 2);
    const units = buildPunctUnits(segments, targets, 1);
    expect(units.map((u) => (u.kind === 'text' ? u.fragments.length : 0))).toEqual([1, 1]);
  });

  it('never joins base text across a heading and never targets the heading', () => {
    const segments = build([
      ['text', '甲'.repeat(25)],
      ['head', '北山經'],
      ['text', '乙'.repeat(25)],
      ['comm', '注'],
      ['text', '丙'.repeat(25)],
    ]);
    const targets = filterSegmentsForAi(segments);
    expect(targets.map((s) => s.kind)).not.toContain('head');
    const units = buildPunctUnits(
      segments,
      segments.filter((s) => s.kind !== 'head'),
    );
    expect(
      units.flatMap((u) => (u.kind === 'text' ? [u.fragments.map((f) => f.han[0])] : [])),
    ).toEqual([['甲'], ['乙', '丙']]);
  });

  it('even if a heading is passed as a target it ends the run instead of joining it', () => {
    const segments = build([
      ['text', '甲'.repeat(25)],
      ['head', '北山經'],
      ['text', '乙'.repeat(25)],
    ]);
    const units = buildPunctUnits(segments, segments);
    expect(units.map((u) => u.kind)).toEqual(['text', 'text']);
  });

  it('drops runs shorter than the minimum', () => {
    const segments = build([
      ['text', '多桂'],
      ['comm', '注'],
      ['text', '多金'],
    ]);
    expect(
      buildPunctUnits(
        segments,
        segments.filter((s) => s.kind === 'text'),
      ),
    ).toEqual([]);
  });

  it('orders units by document position', () => {
    const segments = build([
      ['text', '甲'.repeat(12)],
      ['comm', '乙'.repeat(25)],
      ['text', '丙'.repeat(12)],
    ]);
    const units = buildPunctUnits(segments, [segments[1]!, segments[0]!, segments[2]!]);
    expect(units.map((u) => u.kind)).toEqual(['text', 'comm']);
  });
});

describe('chunkRunFragments', () => {
  it('cuts only at fragment boundaries', () => {
    const fragments = ['甲'.repeat(300), '乙'.repeat(300), '丙'.repeat(50)].map((han, i) => ({
      han,
      han_start: i * 1000,
      han_end: i * 1000 + han.length,
    }));
    const chunks = chunkRunFragments(fragments, 400);
    expect(chunks.map((c) => c.length)).toEqual([1, 2]);
  });
});

describe('kind-aware target filters', () => {
  it('lets short base-text fragments through but still filters short notes', () => {
    const segments = [
      { id: 0, kind: 'text' as const, han: '多桂', has_punct: false },
      { id: 1, kind: 'comm' as const, han: '或作桂荼', has_punct: false },
    ];
    expect(filterSegmentsForAi(segments).map((s) => s.id)).toEqual([0]);
    expect(segmentNeedsAiGap(segments[0]!)).toBe(true);
    expect(segmentNeedsAiGap(segments[1]!)).toBe(false);
  });

  it('never selects a heading, with or without punctuation', () => {
    const head = { id: 2, kind: 'head' as const, han: '北山經', has_punct: false };
    expect(filterSegmentsForAi([head])).toEqual([]);
    expect(segmentNeedsAiGap(head)).toBe(false);
  });
});

describe('buildRunPunctUserPrompt', () => {
  it('quotes the anchor of each note and caps long notes', () => {
    const prompt = buildRunPunctUserPrompt({
      han: '多桂多金玉',
      notes: [{ after: '多桂', note: '注'.repeat(500) }],
    });
    expect(prompt).toContain('after 「多桂」');
    expect(prompt.length).toBeLessThan(600);
  });
});

describe('llmPunctuatePlainRun', () => {
  const fragments = [
    { han: '多桂', han_start: 0, han_end: 2 },
    { han: '多金玉', han_start: 10, han_end: 13 },
  ];
  const clientReturning = (answers: string[]): LlmClient & { calls: number } => {
    const client = {
      modelId: 'test',
      calls: 0,
      async complete() {
        const json = answers[Math.min(client.calls, answers.length - 1)]!;
        client.calls += 1;
        return { json, usage: { inputTokens: 0, outputTokens: 0 } };
      },
    };
    return client;
  };

  it('punctuates the joined run and splits it back onto the fragments', async () => {
    const client = clientReturning(['多桂，多金玉。']);
    const result = await llmPunctuatePlainRun(fragments, client);
    expect(result).toEqual({ texts: ['多桂，', '多金玉。'], failedChunks: 0 });
    expect(client.calls).toBe(1);
  });

  it('retries once when the model changes the character count', async () => {
    const client = clientReturning(['多桂，多金。', '多桂，多金玉。']);
    const result = await llmPunctuatePlainRun(fragments, client);
    expect(result.texts).toEqual(['多桂，', '多金玉。']);
    expect(client.calls).toBe(2);
  });

  it('leaves a chunk unpunctuated after two bad answers instead of mis-splitting', async () => {
    const client = clientReturning(['多桂。']);
    const result = await llmPunctuatePlainRun(fragments, client);
    expect(result).toEqual({ texts: [null, null], failedChunks: 1 });
    expect(client.calls).toBe(2);
  });
});
