/**
 * Small helpers for the AI step of an import job: what a failed model request means, and how many
 * tokens (and so how much money) the calls used. Kept apart from the pipeline so they can be tested
 * without the TEI and Python machinery.
 */

import type { LlmClient } from '../../../packages/cwrc-leafwriter/src/autoTagging/llmClient';
import type { ImportJobAiPricing } from '../../commons/src/desktop/importJobTypes';

/**
 * HTTP status of a failed model request: the `status` of the error if it carries one, else the
 * one the clients print ("Mistral request failed: 429 …"). Digits anywhere else in a message
 * (a line number, an offset) say nothing about the API.
 */
export const llmErrorStatus = (error: unknown): number | null => {
  const status = (error as { status?: unknown } | null)?.status;
  if (typeof status === 'number') return status;
  const message = error instanceof Error ? error.message : String(error);
  const match = /request failed:\s*(\d{3})\b/i.exec(message);
  return match ? Number(match[1]) : null;
};

export const isQuotaOrAuthError = (error: unknown): 'api_key' | 'quota' | null => {
  const status = llmErrorStatus(error);
  if (status === 401 || status === 403) return 'api_key';
  if (status === 402 || status === 429) return 'quota';
  return null;
};

/** Wraps a client to add up the tokens its requests use. */
export const withUsageMeter = (
  client: LlmClient,
): { client: LlmClient; usage: { inputTokens: number; outputTokens: number } } => {
  const usage = { inputTokens: 0, outputTokens: 0 };
  return {
    usage,
    client: {
      get modelId() {
        return client.modelId;
      },
      complete: async (request) => {
        const response = await client.complete(request);
        usage.inputTokens += response.usage?.inputTokens ?? 0;
        usage.outputTokens += response.usage?.outputTokens ?? 0;
        return response;
      },
    },
  };
};

export const costOfUsage = (
  usage: { inputTokens: number; outputTokens: number },
  pricing: ImportJobAiPricing | null | undefined,
): number =>
  pricing
    ? (usage.inputTokens * pricing.inputPerMillion +
        usage.outputTokens * pricing.outputPerMillion) /
      1_000_000
    : 0;
