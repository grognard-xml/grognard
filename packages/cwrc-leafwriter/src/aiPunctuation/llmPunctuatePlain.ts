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

const PRECEDING_CONTEXT_HAN = 40;

export interface LlmPunctuatePlainRunResult {
  /** One punctuated string per input fragment; null when the model gave nothing usable for it. */
  texts: (string | null)[];
  /** Chunks whose output kept failing the character-count check and were left unpunctuated. */
  failedChunks: number;
}

/**
 * Punctuate a base-text run: fragments are joined across the notes that separate them, sent in
 * chunks that never split a fragment, and the output is split back onto the fragments.
 *
 * Each chunk's output must contain exactly as many content characters as went in, otherwise the
 * split would shift every later fragment. A miscount is retried once; a chunk that still fails is
 * left unpunctuated (its fragments get null) so one bad answer cannot corrupt the rest of the run.
 */
export async function llmPunctuatePlainRun(
  fragments: PunctFragment[],
  client: LlmClient,
  signal?: AbortSignal,
  onCall?: () => void,
): Promise<LlmPunctuatePlainRunResult> {
  const texts: (string | null)[] = [];
  let failedChunks = 0;
  let precedingText = '';

  for (const chunk of chunkRunFragments(fragments)) {
    signal?.throwIfAborted();
    const lengths = chunk.map((fragment) => contentLength(fragment.han));
    const prompt = buildRunPunctPrompt({
      han: chunk.map((fragment) => fragment.han).join(''),
      preceding_text: precedingText || undefined,
      notes: chunk.flatMap((fragment) =>
        fragment.notes_after
          ? [{ after: Array.from(fragment.han).slice(-6).join(''), note: fragment.notes_after }]
          : [],
      ),
    });

    let parts: string[] | null = null;
    for (let attempt = 0; attempt < 2 && !parts; attempt++) {
      signal?.throwIfAborted();
      const response = await client.complete({ ...prompt, signal });
      const punctuated = stripPlainPunctResponse(response.json);
      if (contentLength(punctuated) === lengths.reduce((a, b) => a + b, 0)) {
        parts = splitPunctuatedRun(punctuated, lengths);
      }
    }
    onCall?.();

    if (parts) {
      texts.push(...parts);
      precedingText = Array.from(parts.join('')).slice(-PRECEDING_CONTEXT_HAN).join('');
    } else {
      failedChunks += 1;
      texts.push(...chunk.map(() => null));
      precedingText = '';
    }
  }
  return { texts, failedChunks };
}
