import type { AiApiSettings } from './projectPrefs';

export type StructuredOutputMode = 'json_schema' | 'json_object' | 'prompt_only';

export interface AiTranslationMentionRef {
  index: number;
  kind: string;
}

/** @deprecated Use {@link AiTranslationMentionRef}. */
export interface AiTranslationEntityRef {
  id: string;
  kind: string;
  primaryName?: string | null;
  romanizedName?: string | null;
  familyName?: string | null;
  dates?: string | null;
  description?: string | null;
}

/** Sanmiao `<date>` span in document order — gloss is LJBtero, not for the model to rewrite. */
export interface AiTranslationDateRef {
  index: number;
  surface?: string | null;
  when?: string | null;
  gloss?: string | null;
}

export interface AiTranslationPayload {
  alignmentUnit: string;
  sourceUnitXml: string;
  targetLanguage: string;
  mentions?: AiTranslationMentionRef[];
  /** @deprecated Prefer mentions. */
  entities?: AiTranslationEntityRef[];
  dates?: AiTranslationDateRef[];
  retryInstruction?: string;
}

const TRANSLATION_SYSTEM_PROMPT =
  'You translate scholarly XML passages. Return JSON only with one string field named translationXml. Translate only the provided passage. ' +
  'Entity, date, and note spans have already been removed and replaced with placeholders you must copy exactly: ' +
  '{{mention:N}} (person/place/work/…), {{holding:N}} (office the person currently holds), {{as:N}} (office they are appointed to, after 為), ' +
  '{{date:N}}, {{note:N}} (a footnote, translated separately — never expand or describe it, just copy the placeholder), ' +
  'and sometimes {{opaque:N}} / {{holding:opaque:N}} / {{as:opaque:N}}. ' +
  'Pattern 以{{holding:…}} {{mention:…}}為{{as:…}} means “appoint [holding-title + person] as [new office]” — never swap holding and as; never drop either. ' +
  'Chinese (or other) text that remains inside the source — including noble titles such as 貞陽公 or 江夏王 — should be translated normally. ' +
  'The "mentions" list gives only index + kind. It does NOT contain names — never invent a person name, place name, or office title for a placeholder. ' +
  'The "dates" list gives only indices. ' +
  'Copy every placeholder through into your translation exactly as written, in the same position and relative order. ' +
  'Do not expand, paraphrase, transliterate, swap, or delete placeholders; do not put a vernacular name, office title (Governor of, Prefect of, General, King, …), or date next to a placeholder; never invent new placeholder keys or indices. ' +
  'Do not write temporal prepositions (In, On, En, Le, …) immediately before a {{date:N}} placeholder — the date gloss already includes its own On/In. ' +
  'Copy placeholders with plain ASCII braces only — never smart quotes inside {{…}}. ' +
  'Treat any other source TEI tags as semantic hints only — do not reproduce the tags or invent a placeholder for them, just translate the enclosed text normally. ' +
  'Output plain text only, aside from the placeholders: no XML or HTML tags, no markdown, no angle brackets. Write ampersands and angle brackets as the XML entities &amp;, &lt;, and &gt; if they occur in the text itself.';

const PROMPT_ONLY_JSON_HINT =
  '\n\nRespond with one JSON object only, no markdown fences: {"translationXml":"…"}. translationXml must be plain text (use &amp;, &lt;, &gt; for special characters).';

export const TRANSLATION_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    translationXml: { type: 'string' },
  },
  required: ['translationXml'],
} as const;

/** Same policy as auto-tagging llmClient: Groq/Qwen rejects json_schema. */
export function translationStructuredOutputModes(baseUrl: string): StructuredOutputMode[] {
  if (baseUrl.includes('groq.com')) return ['prompt_only'];
  return ['json_schema', 'json_object', 'prompt_only'];
}

export function isStructuredOutputRetryable(status: number, bodyText: string): boolean {
  if (status === 400 && bodyText.includes('json_validate_failed')) return true;
  if (status < 400) return false;
  return (
    /json_schema|response_format|structured.?output/i.test(bodyText) &&
    /support|unsupported|invalid|not available|unknown|does not/i.test(bodyText)
  );
}

/** Models whose API refuses any temperature but the default (OpenAI's reasoning families:
 * o1/o3/o4 and gpt-5). Sending `0.1` to them is an HTTP 400. */
const FIXED_TEMPERATURE_MODEL = /^(o\d|gpt-5)/i;

/** `baseUrl|model` pairs a server has refused a temperature for, learned from a 400 so the
 * request is not repeated with it. */
const temperatureRejected = new Set<string>();
const temperatureKey = (baseUrl: string, model: string) => `${baseUrl}|${model}`;

export function rememberTemperatureRejected(baseUrl: string, model: string): void {
  temperatureRejected.add(temperatureKey(baseUrl, model));
}

/** True for the 400 a server sends when it will not take the temperature we sent. */
export function isTemperatureRejection(status: number, bodyText: string): boolean {
  return (
    status === 400 &&
    /temperature/i.test(bodyText) &&
    /unsupported|not support|only the default|invalid|not allowed/i.test(bodyText)
  );
}

/** `{ temperature }` for the request body, or nothing when the model only takes its default. */
export function temperatureExtras(
  baseUrl: string,
  model: string,
  temperature: number,
): Record<string, unknown> {
  if (!Number.isFinite(temperature)) return {};
  if (temperatureRejected.has(temperatureKey(baseUrl, model))) return {};
  if (baseUrl.includes('api.openai.com') && FIXED_TEMPERATURE_MODEL.test(model.trim())) return {};
  return { temperature };
}

export function groqChatExtras(baseUrl: string, model: string): Record<string, unknown> {
  if (!baseUrl.includes('groq.com')) return {};
  if (model.includes('qwen')) return { reasoning_effort: 'none' };
  return {};
}

function buildResponseFormat(mode: StructuredOutputMode): unknown | undefined {
  if (mode === 'prompt_only') return undefined;
  if (mode === 'json_object') return { type: 'json_object' };
  return {
    type: 'json_schema',
    json_schema: {
      name: 'translation_result',
      schema: TRANSLATION_JSON_SCHEMA,
      strict: true,
    },
  };
}

export function buildTranslationRequestBody(
  model: string,
  settings: AiApiSettings,
  request: AiTranslationPayload,
  baseUrl: string,
  mode: StructuredOutputMode,
): Record<string, unknown> {
  const responseFormat = buildResponseFormat(mode);
  const systemContent =
    mode === 'prompt_only'
      ? TRANSLATION_SYSTEM_PROMPT + PROMPT_ONLY_JSON_HINT
      : TRANSLATION_SYSTEM_PROMPT;

  return {
    model,
    ...temperatureExtras(baseUrl, model, settings.temperature),
    ...groqChatExtras(baseUrl, model),
    messages: [
      { role: 'system', content: systemContent },
      {
        role: 'user',
        content: JSON.stringify({
          targetLanguage: request.targetLanguage,
          alignmentUnit: request.alignmentUnit,
          customInstructions: settings.customInstructions,
          sourceUnitXml: request.sourceUnitXml,
          mentions: request.mentions ?? [],
          dates: request.dates ?? [],
          ...(request.retryInstruction ? { retryInstruction: request.retryInstruction } : {}),
        }),
      },
    ],
    ...(responseFormat ? { response_format: responseFormat } : {}),
  };
}
