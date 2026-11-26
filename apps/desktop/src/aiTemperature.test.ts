import {
  isTemperatureRejection,
  rememberTemperatureRejected,
  temperatureExtras,
} from './aiTranslationLlm';

const OPENAI = 'https://api.openai.com/v1';

describe('temperatureExtras', () => {
  it('sends the temperature to ordinary models', () => {
    expect(temperatureExtras(OPENAI, 'gpt-4o-mini', 0.1)).toEqual({ temperature: 0.1 });
    expect(temperatureExtras('http://localhost:1234/v1', 'qwen', 0)).toEqual({ temperature: 0 });
  });

  it('leaves it out for OpenAI reasoning models, which only take the default', () => {
    expect(temperatureExtras(OPENAI, 'gpt-5-mini', 0.1)).toEqual({});
    expect(temperatureExtras(OPENAI, 'o3', 0.1)).toEqual({});
    expect(temperatureExtras(OPENAI, 'o4-mini', 0.1)).toEqual({});
  });

  it('still sends it to a gpt-5-named model on another server', () => {
    expect(temperatureExtras('http://localhost:1234/v1', 'gpt-5-local', 0.1)).toEqual({
      temperature: 0.1,
    });
  });

  it('leaves it out once a server has refused it for that model', () => {
    const base = 'https://proxy.example/v1';
    expect(temperatureExtras(base, 'some-model', 0.3)).toEqual({ temperature: 0.3 });
    rememberTemperatureRejected(base, 'some-model');
    expect(temperatureExtras(base, 'some-model', 0.3)).toEqual({});
    expect(temperatureExtras(base, 'other-model', 0.3)).toEqual({ temperature: 0.3 });
  });

  it('sends nothing for a non-numeric temperature', () => {
    expect(temperatureExtras(OPENAI, 'gpt-4o', Number.NaN)).toEqual({});
  });
});

describe('isTemperatureRejection', () => {
  it('recognises OpenAI’s refusal', () => {
    expect(
      isTemperatureRejection(
        400,
        "Unsupported value: 'temperature' does not support 0.1 with this model. Only the default (1) value is supported.",
      ),
    ).toBe(true);
  });

  it('ignores other errors', () => {
    expect(isTemperatureRejection(400, 'json_validate_failed')).toBe(false);
    expect(isTemperatureRejection(500, 'temperature unsupported')).toBe(false);
  });
});
