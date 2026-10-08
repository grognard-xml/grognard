import {
  createLlmClientFromSettings,
  effectiveAiConcurrency,
  isAiSuggestReady,
  isLocalAiBaseUrl,
  normalizeLlmChatBaseUrl,
} from './llmClientFromSettings';

describe('llmClientFromSettings', () => {
  const verifiedLocal = {
    apiKey: '',
    baseUrl: 'http://localhost:1234/v1',
    model: 'test',
    verifiedAt: new Date().toISOString(),
    verifiedBaseUrl: 'http://localhost:1234/v1',
    verifiedModel: 'test',
  };
  it('strips trailing /v1 for MistralLlmClient', () => {
    expect(normalizeLlmChatBaseUrl('http://localhost:1234/v1')).toBe('http://localhost:1234');
    expect(normalizeLlmChatBaseUrl('https://api.groq.com/openai/v1/')).toBe(
      'https://api.groq.com/openai',
    );
  });

  it('detects local base URLs', () => {
    expect(isLocalAiBaseUrl('http://localhost:1234/v1')).toBe(true);
    expect(isLocalAiBaseUrl('https://api.groq.com/openai')).toBe(false);
  });

  it('requires model and base URL', () => {
    expect(isAiSuggestReady(null)).toBe(false);
    expect(isAiSuggestReady({ apiKey: '', baseUrl: '', model: '' })).toBe(false);
    expect(isAiSuggestReady(verifiedLocal)).toBe(true);
    expect(
      isAiSuggestReady({ apiKey: '', baseUrl: 'http://localhost:1234/v1', model: 'test' }),
    ).toBe(false);
  });

  it('requires API key for hosted endpoints', () => {
    expect(
      isAiSuggestReady({
        apiKey: '',
        baseUrl: 'https://api.groq.com/openai',
        model: 'qwen/qwen3.6-27b',
      }),
    ).toBe(false);
    expect(
      isAiSuggestReady({
        apiKey: 'gsk_x',
        baseUrl: 'https://api.groq.com/openai',
        model: 'qwen/qwen3.6-27b',
        verifiedAt: new Date().toISOString(),
        verifiedBaseUrl: 'https://api.groq.com/openai',
        verifiedModel: 'qwen/qwen3.6-27b',
      }),
    ).toBe(true);
  });

  it('builds a client from settings', () => {
    const client = createLlmClientFromSettings(
      {
        apiKey: 'gsk_test',
        baseUrl: 'https://api.groq.com/openai/v1',
        model: 'qwen/qwen3.6-27b',
      },
      async () => ({ ok: true, status: 200, text: async () => '{}' }) as Response,
    );
    expect(client.modelId).toBe('mistral:qwen/qwen3.6-27b');
  });

  it('uses OllamaLlmClient for port 11434', () => {
    const client = createLlmClientFromSettings({
      apiKey: '',
      baseUrl: 'http://localhost:11434',
      model: 'ministral-3:latest',
    });
    expect(client.modelId).toBe('ollama:ministral-3:latest');
  });
});

describe('effectiveAiConcurrency', () => {
  const hosted = { apiKey: 'k', baseUrl: 'https://api.openai.com/v1', model: 'm' };

  it('uses the configured value, capped at 16', () => {
    expect(effectiveAiConcurrency({ ...hosted, concurrency: 3 })).toBe(3);
    expect(effectiveAiConcurrency({ ...hosted, concurrency: 40 })).toBe(16);
    expect(effectiveAiConcurrency({ ...hosted, concurrency: 2.8 })).toBe(2);
  });

  it('defaults to 6 for a hosted API when automatic', () => {
    expect(effectiveAiConcurrency(hosted)).toBe(6);
    expect(effectiveAiConcurrency({ ...hosted, concurrency: 0 })).toBe(6);
  });

  it('defaults to 1 for a local server or Ollama, and when there are no settings', () => {
    expect(effectiveAiConcurrency({ ...hosted, baseUrl: 'http://localhost:1234/v1' })).toBe(1);
    expect(effectiveAiConcurrency({ ...hosted, baseUrl: 'http://192.168.1.5:11434' })).toBe(1);
    expect(effectiveAiConcurrency(null)).toBe(1);
  });

  it('still honours an explicit value for a local server', () => {
    expect(
      effectiveAiConcurrency({ ...hosted, baseUrl: 'http://localhost:1234/v1', concurrency: 4 }),
    ).toBe(4);
  });
});
