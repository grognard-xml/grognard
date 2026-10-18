import { costOfUsage, isQuotaOrAuthError, llmErrorStatus, withUsageMeter } from './importJobLlm';

describe('llmErrorStatus', () => {
  it('reads the status the clients print', () => {
    expect(llmErrorStatus(new Error('Mistral request failed: 429 {"message":"rate limit"}'))).toBe(
      429,
    );
    expect(llmErrorStatus(new Error('Ollama request failed: 500 boom'))).toBe(500);
  });

  it('prefers a status property on the error', () => {
    expect(llmErrorStatus(Object.assign(new Error('x'), { status: 401 }))).toBe(401);
  });

  it('ignores digits that are not a status', () => {
    expect(llmErrorStatus(new Error('XML error at line 4029, offset 4011'))).toBeNull();
    expect(llmErrorStatus('plain string 429')).toBeNull();
  });
});

describe('isQuotaOrAuthError', () => {
  it('maps authentication and quota failures', () => {
    expect(isQuotaOrAuthError(new Error('Mistral request failed: 401 nope'))).toBe('api_key');
    expect(isQuotaOrAuthError(new Error('Mistral request failed: 403 nope'))).toBe('api_key');
    expect(isQuotaOrAuthError(new Error('Mistral request failed: 402 pay'))).toBe('quota');
    expect(isQuotaOrAuthError(new Error('Mistral request failed: 429 slow down'))).toBe('quota');
  });

  it('does not block the job for an ordinary error that mentions such a number', () => {
    expect(isQuotaOrAuthError(new Error('Invalid XML at line 4029'))).toBeNull();
    expect(
      isQuotaOrAuthError(new Error('Wrapped TEI is not well-formed XML (offset 4010)')),
    ).toBeNull();
    expect(isQuotaOrAuthError(new Error('Mistral request failed: 500 server'))).toBeNull();
    expect(isQuotaOrAuthError(new Error('the quota of fish is 7'))).toBeNull();
  });
});

describe('withUsageMeter', () => {
  it('adds up the tokens of every request and passes the responses through', async () => {
    const responses = [
      { json: '{}', usage: { inputTokens: 100, outputTokens: 20 } },
      { json: '{"a":1}', usage: { inputTokens: 50, outputTokens: 5 } },
    ];
    const client = {
      modelId: 'test:model',
      complete: jest.fn(async () => responses.shift()!),
    };
    const { client: metered, usage } = withUsageMeter(client);
    expect(metered.modelId).toBe('test:model');
    expect((await metered.complete({} as never)).json).toBe('{}');
    expect((await metered.complete({} as never)).json).toBe('{"a":1}');
    expect(usage).toEqual({ inputTokens: 150, outputTokens: 25 });
  });

  it('counts nothing for a response without usage and still counts earlier ones when a request fails', async () => {
    const complete = jest
      .fn()
      .mockResolvedValueOnce({ json: '{}', usage: { inputTokens: 10, outputTokens: 1 } })
      .mockResolvedValueOnce({ json: '{}' })
      .mockRejectedValueOnce(new Error('Mistral request failed: 429 x'));
    const { client, usage } = withUsageMeter({ modelId: 'm', complete });
    await client.complete({} as never);
    await client.complete({} as never);
    await expect(client.complete({} as never)).rejects.toThrow('429');
    expect(usage).toEqual({ inputTokens: 10, outputTokens: 1 });
  });
});

describe('costOfUsage', () => {
  it('prices input and output tokens separately, per million', () => {
    expect(
      costOfUsage(
        { inputTokens: 2_000_000, outputTokens: 500_000 },
        { inputPerMillion: 0.4, outputPerMillion: 2 },
      ),
    ).toBeCloseTo(0.8 + 1.0);
  });

  it('is zero without prices: only tokens are counted then', () => {
    expect(costOfUsage({ inputTokens: 1000, outputTokens: 1000 }, null)).toBe(0);
    expect(costOfUsage({ inputTokens: 1000, outputTokens: 1000 }, undefined)).toBe(0);
  });
});
