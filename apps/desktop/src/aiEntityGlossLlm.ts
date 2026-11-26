import type { AiApiSettings } from './projectPrefs';
import {
  groqChatExtras,
  isStructuredOutputRetryable,
  temperatureExtras,
  translationStructuredOutputModes,
  type StructuredOutputMode,
} from './aiTranslationLlm';

export interface EntityGlossSuggestPayload {
  kind: string;
  primaryName: string | null;
  romanizedName: string | null;
  chineseName?: string | null;
  description?: string | null;
  targetLanguage: string;
}

export interface EntityGlossSuggestResult {
  ok: boolean;
  gloss?: string;
  error?: string;
}

const GLOSS_SYSTEM_PROMPT =
  'You propose a scholarly vernacular gloss (translation) for one named entity. ' +
  'Return JSON only with one string field named gloss. ' +
  'The gloss must be in the requested target language only: a conventional title or name form ' +
  'as a digital-humanities scholar would write it (e.g. French "Livre des Jin" for Jinshu 晉書). ' +
  'Do not return romanization, Chinese characters, parentheses, quotes, markdown, or commentary — only the gloss text.';

const PROMPT_ONLY_JSON_HINT =
  '\n\nRespond with one JSON object only, no markdown fences: {"gloss":"…"}.';

export const GLOSS_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    gloss: { type: 'string' },
  },
  required: ['gloss'],
} as const;

function buildResponseFormat(mode: StructuredOutputMode): unknown | undefined {
  if (mode === 'prompt_only') return undefined;
  if (mode === 'json_object') return { type: 'json_object' };
  return {
    type: 'json_schema',
    json_schema: {
      name: 'entity_gloss_result',
      schema: GLOSS_JSON_SCHEMA,
      strict: true,
    },
  };
}

export function buildEntityGlossRequestBody(
  model: string,
  settings: AiApiSettings,
  request: EntityGlossSuggestPayload,
  baseUrl: string,
  mode: StructuredOutputMode,
): Record<string, unknown> {
  const responseFormat = buildResponseFormat(mode);
  const systemContent =
    mode === 'prompt_only' ? GLOSS_SYSTEM_PROMPT + PROMPT_ONLY_JSON_HINT : GLOSS_SYSTEM_PROMPT;

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
          kind: request.kind,
          primaryName: request.primaryName,
          romanizedName: request.romanizedName,
          chineseName: request.chineseName ?? null,
          description: request.description ? request.description.slice(0, 300) : null,
          customInstructions: settings.customInstructions,
        }),
      },
    ],
    ...(responseFormat ? { response_format: responseFormat } : {}),
  };
}

/** Parse model content into a trimmed gloss string, or null if unusable. */
export function parseEntityGlossContent(content: unknown): string | null {
  if (typeof content !== 'string' || !content.trim()) return null;
  let text = content.trim();
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)```$/i);
  if (fenced?.[1]) text = fenced[1].trim();
  try {
    const parsed = JSON.parse(text) as { gloss?: unknown };
    if (typeof parsed.gloss === 'string' && parsed.gloss.trim()) return parsed.gloss.trim();
  } catch {
    // Fall through: treat bare string as gloss if it has no JSON braces.
  }
  if (!text.includes('{') && !text.includes('}')) return text;
  return null;
}

export { isStructuredOutputRetryable, translationStructuredOutputModes };
export type { StructuredOutputMode };
