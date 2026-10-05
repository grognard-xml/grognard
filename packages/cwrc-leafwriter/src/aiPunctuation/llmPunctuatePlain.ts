import type { LlmClient } from '../autoTagging/llmClient';
import { buildPlainPunctPrompt, stripPlainPunctResponse, type PunctPromptSegment } from './prompts';
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
