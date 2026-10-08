import type { LlmClient } from '../autoTagging/llmClient';
import {
  buildPlainPunctPrompt,
  buildRunPunctPrompt,
  stripPlainPunctResponse,
  type PunctPromptSegment,
} from './prompts';
import {
  chunkRunFragments,
  contentLength,
  splitPunctuatedRun,
  type PunctFragment,
} from './punctRuns';
import { PLAIN_CHUNK_HAN } from './punctSchema';
import { runPool } from './taskPool';
import { cpLength } from './selectionScope';

export interface LlmPunctuatePlainSegmentInput extends PunctPromptSegment {
  han_start: number;
}

interface HanChunk {
  text: string;
  offset: number;
}

/** Counts in code points (a 𪁺 is one Han, two UTF-16 units), so a chunk never splits a pair. */
function chunkHanPlainText(han: string, maxLen = PLAIN_CHUNK_HAN): HanChunk[] {
  const chars = Array.from(han);
  if (chars.length <= maxLen) {
    return [{ text: han, offset: 0 }];
  }
  const chunks: HanChunk[] = [];
  let start = 0;
  while (start < chars.length) {
    let end = Math.min(start + maxLen, chars.length);
    if (end < chars.length) {
      const window = chars.slice(start, end);
      const breakAt = Math.max(
        window.lastIndexOf('。'),
        window.lastIndexOf('！'),
        window.lastIndexOf('？'),
      );
      if (breakAt > maxLen * 0.35) {
        end = start + breakAt + 1;
      }
    }
    chunks.push({ text: chars.slice(start, end).join(''), offset: start });
    if (end >= chars.length) break;
    start = end;
  }
  return chunks;
}

export async function llmPunctuatePlainSegment(
  segment: LlmPunctuatePlainSegmentInput,
  client: LlmClient,
  signal?: AbortSignal,
): Promise<{ plainText: string }> {
  const chunks = chunkHanPlainText(segment.han);
  const parts: string[] = [];
  for (const chunk of chunks) {
    signal?.throwIfAborted();
    const prompt = buildPlainPunctPrompt({
      kind: segment.kind,
      han: chunk.text,
      preceding_comm: chunk.offset === 0 ? segment.preceding_comm : undefined,
      following_comm:
        chunk.offset + cpLength(chunk.text) >= cpLength(segment.han)
          ? segment.following_comm
          : undefined,
    });
    const response = await client.complete({ ...prompt, signal });
    parts.push(stripPlainPunctResponse(response.json));
  }
  return { plainText: parts.join('') };
}

const NEIGHBOUR_CONTEXT_HAN = 40;

/** One model call for part of a base-text run, ready to send. */
export interface RunChunkTask {
  fragments: PunctFragment[];
  /** Content length of each fragment, for splitting the answer back. */
  lengths: number[];
  system: string;
  user: string;
}

/**
 * Cut a base-text run into model calls that never split a fragment. The calls are independent:
 * each carries the raw (unpunctuated) Han just before and after it as context, not the previous
 * call's answer, so they can all run at once.
 */
export function planRunChunks(fragments: PunctFragment[]): RunChunkTask[] {
  const chunks = chunkRunFragments(fragments);
  const hanOf = (chunk: PunctFragment[]) => chunk.map((fragment) => fragment.han).join('');
  return chunks.map((chunk, index) => {
    const before = index > 0 ? Array.from(hanOf(chunks[index - 1]!)) : [];
    const after = index < chunks.length - 1 ? Array.from(hanOf(chunks[index + 1]!)) : [];
    const prompt = buildRunPunctPrompt({
      han: hanOf(chunk),
      preceding_text: before.slice(-NEIGHBOUR_CONTEXT_HAN).join('') || undefined,
      following_text: after.slice(0, NEIGHBOUR_CONTEXT_HAN).join('') || undefined,
      notes: chunk.flatMap((fragment) =>
        fragment.notes_after
          ? [{ after: Array.from(fragment.han).slice(-6).join(''), note: fragment.notes_after }]
          : [],
      ),
    });
    return {
      fragments: chunk,
      lengths: chunk.map((fragment) => contentLength(fragment.han)),
      ...prompt,
    };
  });
}

/**
 * Punctuate one chunk and split the answer back onto its fragments. The answer must contain
 * exactly as many content characters as went in, otherwise the split would shift every later
 * fragment; a miscount is retried once, then the chunk is given up (null) and left unpunctuated.
 */
export async function punctuateRunChunk(
  task: RunChunkTask,
  client: LlmClient,
  signal?: AbortSignal,
): Promise<string[] | null> {
  const expected = task.lengths.reduce((sum, length) => sum + length, 0);
  for (let attempt = 0; attempt < 2; attempt++) {
    signal?.throwIfAborted();
    const response = await client.complete({ system: task.system, user: task.user, signal });
    const punctuated = stripPlainPunctResponse(response.json);
    if (contentLength(punctuated) !== expected) continue;
    const parts = splitPunctuatedRun(punctuated, task.lengths);
    if (parts) return parts;
  }
  return null;
}

export interface LlmPunctuatePlainRunResult {
  /** One punctuated string per input fragment; null when the model gave nothing usable for it. */
  texts: (string | null)[];
  /** Chunks whose output kept failing the character-count check and were left unpunctuated. */
  failedChunks: number;
}

/** Put per-chunk answers (null = gave up) back in fragment order. */
export function assembleRunTexts(
  tasks: RunChunkTask[],
  answers: (string[] | null)[],
): LlmPunctuatePlainRunResult {
  const texts: (string | null)[] = [];
  let failedChunks = 0;
  tasks.forEach((task, index) => {
    const parts = answers[index];
    if (parts) texts.push(...parts);
    else {
      failedChunks += 1;
      texts.push(...task.fragments.map(() => null));
    }
  });
  return { texts, failedChunks };
}

/** Punctuate a whole base-text run, its chunks `concurrency` at a time. */
export async function llmPunctuatePlainRun(
  fragments: PunctFragment[],
  client: LlmClient,
  signal?: AbortSignal,
  onCall?: () => void,
  concurrency = 1,
): Promise<LlmPunctuatePlainRunResult> {
  const tasks = planRunChunks(fragments);
  const answers = await runPool(
    tasks.map((task) => async (taskSignal: AbortSignal) => {
      const parts = await punctuateRunChunk(task, client, taskSignal);
      onCall?.();
      return parts;
    }),
    concurrency,
    signal,
  );
  return assembleRunTexts(tasks, answers);
}
