/**
 * Provider-agnostic LLM client for auto-tagging. One provider is wired for
 * v1 (Mistral-family: a local Ollama-served model for development, the
 * hosted Mistral API as the BYO-key fallback for users without local
 * hardware) — the response-contract validation in llmSuggest/llmAudit is
 * the real portability layer, so adding another provider later means one
 * more class here, not a redesign.
 */
export interface RateLimitRetryInfo {
  /** 1-based retry attempt number. */
  attempt: number;
  maxAttempts: number;
  delayMs: number;
}

export interface LlmRequest {
  system: string;
  user: string;
  /** When set, request structured JSON (schema / json_object). Omit for plain-text responses. */
  jsonSchema?: Record<string, unknown>;
  /** Called before each 429 retry sleep so callers can surface live progress. */
  onRateLimitRetry?: (info: RateLimitRetryInfo) => void;
  /** Aborts the in-flight HTTP request (and any retry wait) when triggered. */
  signal?: AbortSignal;
}

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface LlmResponse {
  /** Raw JSON text — parse and validate before use; a provider can still emit malformed output. */
  json: string;
  usage: LlmUsage;
}

export interface LlmClient {
  /** Identifier stored in suggestion provenance and the cache key, e.g. "ollama:ministral-8b". */
  readonly modelId: string;
  complete(request: LlmRequest): Promise<LlmResponse>;
}

export type FetchFn = typeof fetch;

/** Keep fetch's global receiver — bare `fetch` stored then called throws Illegal invocation. */
const defaultFetch: FetchFn = ((...args: Parameters<FetchFn>) =>
  globalThis.fetch(...args)) as FetchFn;

export interface OllamaClientOptions {
  /** e.g. http://localhost:11434 */
  baseUrl: string;
  model: string;
  fetchImpl?: FetchFn;
}

/**
 * Local model via an Ollama-compatible server (works for Ministral and
 * anything else Ollama serves). Uses /api/chat with a JSON-schema `format`
 * so most models constrain their output structurally.
 */
export class OllamaLlmClient implements LlmClient {
  readonly modelId: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchFn;

  constructor(options: OllamaClientOptions) {
    this.modelId = `ollama:${options.model}`;
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.fetchImpl = options.fetchImpl ?? defaultFetch;
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    const res = await this.fetchImpl(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      signal: request.signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: this.modelId.replace(/^ollama:/, ''),
        stream: false,
        ...(request.jsonSchema ? { format: request.jsonSchema } : {}),
        messages: [
          { role: 'system', content: request.system },
          { role: 'user', content: request.user },
        ],
      }),
    });
    if (!res.ok) {
      throw new Error(`Ollama request failed: ${res.status} ${await res.text()}`);
    }
    const body = (await res.json()) as {
      message: { content: string };
      prompt_eval_count?: number;
      eval_count?: number;
    };
    return {
      json: body.message.content,
      usage: {
        inputTokens: body.prompt_eval_count ?? 0,
        outputTokens: body.eval_count ?? 0,
      },
    };
  }
}

export interface MistralClientOptions {
  apiKey: string;
  /** e.g. "ministral-8b-2512", "mistral-small-2506", "qwen/qwen3-32b" */
  model: string;
  baseUrl?: string;
  fetchImpl?: FetchFn;
  /**
   * How to request structured output. Mistral/LM Studio use json_schema; Groq
   * Qwen models reject json_schema and often fail json_object when reasoning
   * is on — default Groq to prompt_only (JSON discipline in the prompt;
   * llmParse validates). Override with json_object/json_schema if needed.
   */
  structuredOutput?: 'json_schema' | 'json_object' | 'prompt_only';
  /** Retries on HTTP 429 (rate limit), each waiting 30-60s. Defaults to 6. */
  maxRateLimitRetries?: number;
  /**
   * Retries on transient failures: network errors (connection reset, network
   * changed, DNS) and HTTP 5xx. Exponential backoff. Defaults to 4.
   */
  maxTransientRetries?: number;
  /** Base delay for transient-failure backoff (doubles per attempt). Defaults to 2000ms. */
  transientRetryBaseDelayMs?: number;
}

function extractJsonContent(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) return trimmed;
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  return fenced ? fenced[1]!.trim() : trimmed;
}

function isJsonValidateFailed(status: number, bodyText: string): boolean {
  if (status !== 400) return false;
  try {
    const err = JSON.parse(bodyText) as { error?: { code?: string } };
    return err.error?.code === 'json_validate_failed';
  } catch {
    return bodyText.includes('json_validate_failed');
  }
}

/** Parse Groq/OpenAI-style rate-limit messages, e.g. "try again in 12.96s". */
export function parseRateLimitRetryMs(bodyText: string): number | null {
  const match = bodyText.match(/try again in ([\d.]+)s/i);
  if (!match) return null;
  return Math.ceil(parseFloat(match[1]!) * 1000) + 500;
}

/**
 * Backoff floor/ceiling for 429 retries. Providers sometimes report a very
 * short "try again in Xs" (a few seconds) that just triggers another
 * near-immediate 429 under sustained rate limiting — always wait at least
 * 30s, and cap the per-attempt wait at 60s so a single huge reported delay
 * doesn't stall one attempt for minutes (subsequent attempts pick up the
 * remainder via the retry loop). Grows slightly per attempt within the band.
 */
const MIN_RATE_LIMIT_DELAY_MS = 30_000;
const MAX_RATE_LIMIT_DELAY_MS = 60_000;

export function rateLimitDelayMs(suggestedMs: number | null, attempt: number): number {
  const floorForAttempt = Math.min(
    MIN_RATE_LIMIT_DELAY_MS + attempt * 15_000,
    MAX_RATE_LIMIT_DELAY_MS,
  );
  if (suggestedMs == null) return floorForAttempt;
  return Math.min(Math.max(suggestedMs, floorForAttempt), MAX_RATE_LIMIT_DELAY_MS);
}

const DEFAULT_TRANSIENT_RETRY_BASE_MS = 2_000;
const MAX_TRANSIENT_DELAY_MS = 30_000;

/** 5xx only: 4xx (other than 429, handled separately) will not succeed on resend. */
const isTransientStatus = (status: number): boolean => status >= 500 && status <= 599;

export function transientDelayMs(baseMs: number, attempt: number): number {
  return Math.min(baseMs * 2 ** attempt, MAX_TRANSIENT_DELAY_MS);
}

/** Sleep that wakes up (and rejects) immediately when the signal aborts. */
const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal!.reason instanceof Error ? signal!.reason : new Error('aborted'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });

/**
 * OpenAI-compatible chat-completions client (Mistral API, Groq, LM Studio,
 * etc.). Uses response_format json_schema where supported; Groq Qwen defaults
 * to prompt-only JSON (reasoning off) with llmParse as the validator.
 */
export class MistralLlmClient implements LlmClient {
  readonly modelId: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchFn;
  private readonly structuredOutput: 'json_schema' | 'json_object' | 'prompt_only';
  private readonly isGroq: boolean;
  private readonly maxRateLimitRetries: number;
  private readonly maxTransientRetries: number;
  private readonly transientRetryBaseDelayMs: number;

  constructor(options: MistralClientOptions) {
    this.modelId = `mistral:${options.model}`;
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? 'https://api.mistral.ai').replace(/\/$/, '');
    this.fetchImpl = options.fetchImpl ?? defaultFetch;
    this.isGroq = this.baseUrl.includes('groq.com');
    this.structuredOutput =
      options.structuredOutput ?? (this.isGroq ? 'prompt_only' : 'json_schema');
    this.maxRateLimitRetries = options.maxRateLimitRetries ?? 6;
    this.maxTransientRetries = options.maxTransientRetries ?? 4;
    this.transientRetryBaseDelayMs =
      options.transientRetryBaseDelayMs ?? DEFAULT_TRANSIENT_RETRY_BASE_MS;
  }

  private groqExtras(): Record<string, unknown> {
    if (!this.isGroq) return {};
    const model = this.modelId.replace(/^mistral:/, '');
    // Qwen3 on Groq defaults to reasoning; that breaks JSON modes (empty content).
    if (model.includes('qwen')) return { reasoning_effort: 'none' };
    return {};
  }

  private buildResponseFormat(
    request: LlmRequest,
    mode: 'json_schema' | 'json_object' | 'prompt_only',
  ): unknown | undefined {
    if (mode === 'prompt_only') return undefined;
    if (mode === 'json_object') return { type: 'json_object' };
    return {
      type: 'json_schema',
      json_schema: { name: 'suggestions', schema: request.jsonSchema, strict: true },
    };
  }

  /**
   * One logical POST, resent on transient failures: a thrown fetch (connection
   * reset, ERR_NETWORK_CHANGED after a Wi-Fi roam or wake from sleep, DNS) or a
   * 5xx response. Aborts are never retried. After the final attempt a network
   * error is rethrown with context and a 5xx is returned for the caller to report.
   */
  private async postCompletion(
    request: LlmRequest,
    mode: 'json_schema' | 'json_object' | 'prompt_only' | 'plain_text',
  ): Promise<{ ok: boolean; status: number; text: string }> {
    for (let attempt = 0; ; attempt++) {
      const canRetry = attempt < this.maxTransientRetries;
      let result: { ok: boolean; status: number; text: string };
      try {
        result = await this.postCompletionOnce(request, mode);
      } catch (error) {
        if (
          request.signal?.aborted ||
          (error instanceof DOMException && error.name === 'AbortError')
        ) {
          throw error;
        }
        if (!canRetry) {
          const detail = error instanceof Error ? error.message : String(error);
          throw new Error(
            `Network error reaching the AI endpoint after ${attempt + 1} attempts: ${detail}`,
            { cause: error },
          );
        }
        await sleep(transientDelayMs(this.transientRetryBaseDelayMs, attempt), request.signal);
        continue;
      }
      if (isTransientStatus(result.status) && canRetry) {
        await sleep(transientDelayMs(this.transientRetryBaseDelayMs, attempt), request.signal);
        continue;
      }
      return result;
    }
  }

  private async postCompletionOnce(
    request: LlmRequest,
    mode: 'json_schema' | 'json_object' | 'prompt_only' | 'plain_text',
  ): Promise<{ ok: boolean; status: number; text: string }> {
    const responseFormat =
      mode === 'plain_text' ? undefined : this.buildResponseFormat(request, mode);
    const jsonHint =
      mode === 'prompt_only'
        ? '\n\nRespond with one JSON object only, no markdown fences: {"suggestions":[{"surface":"…","occurrence":1,"tag":"persName","action":"add","confidence":0.9,"rationale":"…"}]}. Use {"suggestions":[]} if none.'
        : '';
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;
    const res = await this.fetchImpl(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      signal: request.signal,
      headers,
      body: JSON.stringify({
        model: this.modelId.replace(/^mistral:/, ''),
        ...(responseFormat ? { response_format: responseFormat } : {}),
        ...this.groqExtras(),
        messages: [
          { role: 'system', content: request.system + jsonHint },
          { role: 'user', content: request.user },
        ],
      }),
    });
    const text = await res.text();
    return { ok: res.ok, status: res.status, text };
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    if (!request.jsonSchema) {
      const result = await this.postCompletion(request, 'plain_text');
      if (!result.ok) {
        throw new Error(`Mistral request failed: ${result.status} ${result.text}`);
      }
      const body = JSON.parse(result.text) as {
        choices: { message: { content: string | null } }[];
        usage?: { prompt_tokens: number; completion_tokens: number };
      };
      return {
        json: body.choices[0]!.message.content ?? '',
        usage: {
          inputTokens: body.usage?.prompt_tokens ?? 0,
          outputTokens: body.usage?.completion_tokens ?? 0,
        },
      };
    }

    let mode = this.structuredOutput;
    let rateLimitAttempt = 0;

    while (true) {
      let result = await this.postCompletion(request, mode);
      if (!result.ok && result.status === 429 && rateLimitAttempt < this.maxRateLimitRetries) {
        const delayMs = rateLimitDelayMs(parseRateLimitRetryMs(result.text), rateLimitAttempt);
        rateLimitAttempt++;
        request.onRateLimitRetry?.({
          attempt: rateLimitAttempt,
          maxAttempts: this.maxRateLimitRetries,
          delayMs,
        });
        await sleep(delayMs, request.signal);
        continue;
      }
      if (
        !result.ok &&
        isJsonValidateFailed(result.status, result.text) &&
        mode !== 'prompt_only'
      ) {
        mode = 'prompt_only';
        result = await this.postCompletion(request, mode);
      }
      if (!result.ok) {
        throw new Error(`Mistral request failed: ${result.status} ${result.text}`);
      }
      const body = JSON.parse(result.text) as {
        choices: { message: { content: string | null } }[];
        usage?: { prompt_tokens: number; completion_tokens: number };
      };
      const raw = body.choices[0]!.message.content ?? '';
      return {
        json: extractJsonContent(raw),
        usage: {
          inputTokens: body.usage?.prompt_tokens ?? 0,
          outputTokens: body.usage?.completion_tokens ?? 0,
        },
      };
    }
  }
}
