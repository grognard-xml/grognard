import type { ProjectBundle } from '../../../../apps/commons/src/desktop/projectTypes';

/**
 * Patch the project file (grognard.project.json) and sync the returned bundle into the
 * desktop bridge + Overmind. Without the sync step, toggles appear to save
 * but revert as soon as the in-memory cache is cleared.
 */
export async function persistProjectConfigPatch(patch: Record<string, unknown>): Promise<boolean> {
  const projectFilePath = window.__leafWriterProject?.getProjectFilePath?.();
  const update = window.electronAPI?.updateProjectFileConfig;
  if (!projectFilePath || !update) return false;

  try {
    const bundle = (await update(projectFilePath, patch)) as ProjectBundle;
    window.__leafWriterProject?.applyProjectConfigBundle?.(bundle);
    return true;
  } catch {
    return false;
  }
}
