import {
  MistralLlmClient,
  parseRateLimitRetryMs,
  rateLimitDelayMs,
  retryAfterMsFromHeaders,
  transientDelayMs,
} from './llmClient';

describe('parseRateLimitRetryMs', () => {
  it('parses Groq-style retry delay from error body', () => {
    const body =
      'Please try again in 12.96s. Need more tokens? Upgrade to Dev Tier today at https://console.groq.com/settings/billing';
    expect(parseRateLimitRetryMs(body)).toBe(13_460);
  });

  it('returns null when no delay is present', () => {
    expect(parseRateLimitRetryMs('rate limit exceeded')).toBeNull();
  });
});

describe('MistralLlmClient rate-limit retry', () => {
  it('waits and retries on HTTP 429', async () => {
    const timeoutSpy = jest.spyOn(globalThis, 'setTimeout').mockImplementation(((
      callback: TimerHandler,
    ) => {
      if (typeof callback === 'function') callback();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }) as unknown as typeof setTimeout);
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      if (calls === 1) {
        return {
          ok: false,
          status: 429,
          text: async () =>
            JSON.stringify({
              error: {
                message: 'Please try again in 0.01s',
                type: 'tokens',
                code: 'rate_limit_exceeded',
              },
            }),
        };
      }
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            choices: [{ message: { content: '{"suggestions":[]}' } }],
            usage: { prompt_tokens: 10, completion_tokens: 2 },
          }),
      };
    }) as unknown as typeof fetch;

    const client = new MistralLlmClient({
      apiKey: 'test',
      model: 'qwen/qwen3.6-27b',
      baseUrl: 'https://api.groq.com/openai',
      fetchImpl,
    });

    const response = await client.complete({
      system: 'test',
      user: 'chunk',
      jsonSchema: { type: 'object' },
    });

    expect(calls).toBe(2);
    expect(response.json).toContain('suggestions');
    timeoutSpy.mockRestore();
  });
});

describe('MistralLlmClient transient-failure retry', () => {
  const okResponse = {
    ok: true,
    status: 200,
    text: async () =>
      JSON.stringify({
        choices: [{ message: { content: 'hello' } }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }),
  };
  const makeClient = (fetchImpl: typeof fetch, maxTransientRetries = 3) =>
    new MistralLlmClient({
      apiKey: 'k',
      model: 'm',
      baseUrl: 'https://api.openai.com',
      fetchImpl,
      maxTransientRetries,
      transientRetryBaseDelayMs: 1,
    });

  it('retries a thrown network error and then succeeds', async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      if (calls < 3) throw new TypeError('Failed to fetch');
      return okResponse;
    }) as unknown as typeof fetch;
    const res = await makeClient(fetchImpl).complete({ system: 's', user: 'u' });
    expect(res.json).toBe('hello');
    expect(calls).toBe(3);
  });

  it('retries HTTP 503 and then succeeds', async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      return calls === 1 ? { ok: false, status: 503, text: async () => 'unavailable' } : okResponse;
    }) as unknown as typeof fetch;
    const res = await makeClient(fetchImpl).complete({ system: 's', user: 'u' });
    expect(res.json).toBe('hello');
    expect(calls).toBe(2);
  });

  it('does not retry HTTP 401', async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      return { ok: false, status: 401, text: async () => 'bad key' };
    }) as unknown as typeof fetch;
    await expect(makeClient(fetchImpl).complete({ system: 's', user: 'u' })).rejects.toThrow(/401/);
    expect(calls).toBe(1);
  });

  it('gives up after the retry budget with a descriptive network error', async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    await expect(makeClient(fetchImpl, 2).complete({ system: 's', user: 'u' })).rejects.toThrow(
      /Network error reaching the AI endpoint after 3 attempts/,
    );
    expect(calls).toBe(3);
  });

  it('does not retry when aborted', async () => {
    const controller = new AbortController();
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      controller.abort();
      throw new DOMException('aborted', 'AbortError');
    }) as unknown as typeof fetch;
    await expect(
      makeClient(fetchImpl).complete({ system: 's', user: 'u', signal: controller.signal }),
    ).rejects.toThrow();
    expect(calls).toBe(1);
  });
});

describe('transientDelayMs', () => {
  it('doubles per attempt and caps at 30s', () => {
    expect(transientDelayMs(2000, 0)).toBe(2000);
    expect(transientDelayMs(2000, 2)).toBe(8000);
    expect(transientDelayMs(2000, 10)).toBe(30_000);
  });
});

describe('MistralLlmClient rate limits and reasoning effort', () => {
  const ok = {
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: async () =>
      JSON.stringify({
        choices: [{ message: { content: 'hello' } }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }),
  };
  const make = (fetchImpl: typeof fetch, extra: Record<string, unknown> = {}) =>
    new MistralLlmClient({
      apiKey: 'k',
      model: 'gpt-5-mini',
      baseUrl: 'https://api.openai.com',
      fetchImpl,
      transientRetryBaseDelayMs: 1,
      ...extra,
    });

  afterEach(() => jest.restoreAllMocks());

  it('retries a 429 on the plain-text path too (AI punctuation uses it)', async () => {
    jest.spyOn(globalThis, 'setTimeout').mockImplementation(((cb: TimerHandler) => {
      if (typeof cb === 'function') cb();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }) as unknown as typeof setTimeout);
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      return calls === 1
        ? {
            ok: false,
            status: 429,
            headers: { get: (n: string) => (n === 'retry-after-ms' ? '5' : null) },
            text: async () => 'slow down',
          }
        : ok;
    }) as unknown as typeof fetch;
    const seen: number[] = [];
    const res = await make(fetchImpl).complete({
      system: 's',
      user: 'u',
      onRateLimitRetry: (info) => seen.push(info.attempt),
    });
    expect(res.json).toBe('hello');
    expect(calls).toBe(2);
    expect(seen).toEqual([1]);
  });

  it('gives up after maxRateLimitRetries and reports the 429', async () => {
    jest.spyOn(globalThis, 'setTimeout').mockImplementation(((cb: TimerHandler) => {
      if (typeof cb === 'function') cb();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }) as unknown as typeof setTimeout);
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      return { ok: false, status: 429, headers: { get: () => null }, text: async () => 'nope' };
    }) as unknown as typeof fetch;
    await expect(
      make(fetchImpl, { maxRateLimitRetries: 2 }).complete({ system: 's', user: 'u' }),
    ).rejects.toThrow(/429/);
    expect(calls).toBe(3);
  });

  it('makes every request wait for a cooldown set by one 429', async () => {
    const waits: number[] = [];
    jest.spyOn(globalThis, 'setTimeout').mockImplementation(((cb: TimerHandler, ms?: number) => {
      waits.push(ms ?? 0);
      if (typeof cb === 'function') cb();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }) as unknown as typeof setTimeout);
    let first = true;
    const fetchImpl = (async () => {
      if (first) {
        first = false;
        return {
          ok: false,
          status: 429,
          headers: { get: (n: string) => (n === 'retry-after' ? '20' : null) },
          text: async () => '',
        };
      }
      return ok;
    }) as unknown as typeof fetch;
    const client = make(fetchImpl);
    await client.complete({ system: 's', user: 'u' });
    // the 429-ing request waited ~20s; a request issued right after waits for the same cooldown
    waits.length = 0;
    await client.complete({ system: 's', user: 'u' });
    expect(waits.some((ms) => ms > 10_000)).toBe(true);
  });

  it('sends reasoning_effort when configured and drops it if the API rejects it', async () => {
    const bodies: Record<string, unknown>[] = [];
    const fetchImpl = (async (_url: string, init: { body: string }) => {
      bodies.push(JSON.parse(init.body));
      return bodies.length === 1
        ? {
            ok: false,
            status: 400,
            headers: { get: () => null },
            text: async () =>
              JSON.stringify({ error: { message: "Unsupported value: 'reasoning_effort'" } }),
          }
        : ok;
    }) as unknown as typeof fetch;
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const client = make(fetchImpl, { reasoningEffort: 'minimal' });
    const res = await client.complete({ system: 's', user: 'u' });
    expect(res.json).toBe('hello');
    expect(bodies[0]!.reasoning_effort).toBe('minimal');
    expect(bodies[1]).not.toHaveProperty('reasoning_effort');
    expect(warn).toHaveBeenCalledTimes(1);
    // remembered: later requests do not send it again
    await client.complete({ system: 's', user: 'u' });
    expect(bodies[2]).not.toHaveProperty('reasoning_effort');
  });

  it('sends no reasoning_effort by default', async () => {
    const bodies: Record<string, unknown>[] = [];
    const fetchImpl = (async (_url: string, init: { body: string }) => {
      bodies.push(JSON.parse(init.body));
      return ok;
    }) as unknown as typeof fetch;
    await make(fetchImpl).complete({ system: 's', user: 'u' });
    expect(bodies[0]).not.toHaveProperty('reasoning_effort');
  });
});

describe('rate-limit hints', () => {
  it('reads millisecond and second hints from the body', () => {
    expect(parseRateLimitRetryMs('Please try again in 20ms.')).toBe(520);
    expect(parseRateLimitRetryMs('try again in 1.5s')).toBe(2000);
  });

  it('reads Retry-After headers', () => {
    const h = (map: Record<string, string>) => ({ get: (n: string) => map[n] ?? null });
    expect(retryAfterMsFromHeaders(h({ 'retry-after-ms': '1200' }))).toBe(1450);
    expect(retryAfterMsFromHeaders(h({ 'retry-after': '3' }))).toBe(3250);
    expect(retryAfterMsFromHeaders(h({}))).toBeUndefined();
    expect(retryAfterMsFromHeaders(undefined)).toBeUndefined();
  });

  it('OpenAI-style backoff doubles from 1s and trusts the provider hint', () => {
    expect(rateLimitDelayMs(null, 0, true)).toBe(1_000);
    expect(rateLimitDelayMs(null, 3, true)).toBe(8_000);
    expect(rateLimitDelayMs(null, 9, true)).toBe(30_000);
    expect(rateLimitDelayMs(2_500, 0, true)).toBe(2_500);
    expect(rateLimitDelayMs(2_500, 0)).toBe(30_000); // Groq-style band unchanged
  });
});
