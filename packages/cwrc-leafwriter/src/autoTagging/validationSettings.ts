import { persistProjectConfigPatch } from './projectConfigPersist';

/**
 * AI validation settings for auto-tagging review.
 * Controls whether AI pre-validates suggestions before human review.
 * Persisted per project in the project file (grognard.project.json) as `autoTaggingValidation`.
 */

export interface ValidationSettings {
  /** When true, run AI curation on tag-bomb suggestions during review. */
  aiValidation?: boolean;
  /** Minimum confidence to auto-accept suggestions (0-1). Default 0.8. */
  autoAcceptThreshold?: number;
  /** Auto-reject curated suggestions below this confidence (0-1). Default 0. */
  curateRejectBelow?: number;
}

export const DEFAULT_AI_VALIDATION = false;
export const DEFAULT_AUTO_ACCEPT_THRESHOLD = 0.8;
export const DEFAULT_CURATE_REJECT_BELOW = 0;

/** Read validation settings from project configuration. */
export function aiValidationFromSettings(settings?: ValidationSettings): boolean {
  return settings?.aiValidation ?? DEFAULT_AI_VALIDATION;
}

/** Read auto-accept threshold from settings. */
export function autoAcceptThresholdFromSettings(settings?: ValidationSettings): number {
  return settings?.autoAcceptThreshold ?? DEFAULT_AUTO_ACCEPT_THRESHOLD;
}

/** Read reject-below threshold for AI curate. */
export function curateRejectBelowFromSettings(settings?: ValidationSettings): number {
  const value = settings?.curateRejectBelow ?? DEFAULT_CURATE_REJECT_BELOW;
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : DEFAULT_CURATE_REJECT_BELOW;
}

/** Read validation settings from desktop project API. */
export function readPersistedValidationSettings(): ValidationSettings | undefined {
  const raw = window.__leafWriterProject?.getAutoTaggingValidationSettings?.();
  if (!raw) return undefined;
  return {
    aiValidation: typeof raw.aiValidation === 'boolean' ? raw.aiValidation : DEFAULT_AI_VALIDATION,
    autoAcceptThreshold:
      typeof raw.autoAcceptThreshold === 'number'
        ? raw.autoAcceptThreshold
        : DEFAULT_AUTO_ACCEPT_THRESHOLD,
    curateRejectBelow:
      typeof raw.curateRejectBelow === 'number'
        ? raw.curateRejectBelow
        : DEFAULT_CURATE_REJECT_BELOW,
  };
}

/**
 * Persist validation settings to the project file.
 * Merges with the current value so a partial update (e.g. only `aiValidation`)
 * does not wipe `autoAcceptThreshold`.
 */
export async function persistValidationSettings(settings: ValidationSettings): Promise<void> {
  const merged: ValidationSettings = {
    ...readPersistedValidationSettings(),
    ...settings,
  };
  const saved = await persistProjectConfigPatch({ autoTaggingValidation: merged });
  if (!saved) return;
  window.__leafWriterProject?.setAutoTaggingValidationSettings?.(merged);
}
