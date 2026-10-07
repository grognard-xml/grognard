import { MistralLlmClient, parseRateLimitRetryMs, transientDelayMs } from './llmClient';

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
