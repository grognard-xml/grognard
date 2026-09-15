import type { NameTypePolicyIO } from '../../../../../packages/cwrc-leafwriter/src/autoTagging/NameTypePolicyPanel';
import type { ThingTypePolicyIO } from '../../../../../packages/cwrc-leafwriter/src/autoTagging/ThingTypePolicyPanel';
import type { ProjectMetadataDialogMode } from '../projectMetadataSession';
import type { ProjectMetadataEditorIO } from './ProjectMetadataForm';

export type PedbBackendConfig = { backend: 'local' } | { backend: 'turso'; url: string };

export interface PedbIO {
  load: () => Promise<PedbBackendConfig | undefined>;
  save: (pedb: PedbBackendConfig) => Promise<void>;
  hasToken: (url: string) => Promise<boolean>;
  setToken: (url: string, token: string | null) => Promise<void>;
  testConnection: (url: string, token: string) => Promise<{ ok: boolean; error?: string }>;
  migrateLocalData: () => Promise<{
    ok: boolean;
    tables?: number;
    rows?: number;
    error?: string;
  }>;
}

/**
 * The Turso auth-token operations never depend on which project or dialog
 * mode is active (they're keyed only by database url), so both `pedb` IO
 * implementations below share this instead of each re-wrapping the same
 * three `window.electronAPI` calls.
 */
const sharedTursoTokenIO = {
  hasToken: async (url: string) => (await window.electronAPI?.entityDbTursoHasToken?.(url)) ?? false,
  setToken: async (url: string, token: string | null) => {
    await window.electronAPI?.entityDbTursoSetToken?.(url, token);
  },
  testConnection: async (url: string, token: string) =>
    (await window.electronAPI?.entityDbTursoTestConnection?.(url, token)) ?? {
      ok: false,
      error: 'Not available.',
    },
};

export const createNativeProjectMetadataIO = (
  dialogId: string,
  options: {
    onCancel: () => void;
    onSaved: () => void;
  },
): ProjectMetadataEditorIO => {
  // Both the bridge object and the method are optional-chained: a preload that
  // predates `nativeDialogInvoke` should degrade the same way a missing
  // `electronAPI` already does (callers treat `undefined` as a failed call)
  // rather than throwing a raw TypeError.
  const invoke = async (method: string, args?: unknown) =>
    window.electronAPI?.nativeDialogInvoke?.({ dialogId, method, args });

  const nameTypePolicy: NameTypePolicyIO = {
    load: async () => {
      const state = (await invoke('getNameTypeTaggingPolicyState', {
        dialogId,
      })) as {
        buckets: Record<string, 'phase1' | 'phase2' | 'never'>;
        customTypes: { id: string; label: string; bucket: 'phase1' | 'phase2' | 'never' }[];
        artMinCodePoints: number;
        sourceLanguage: string | null;
      } | null;
      if (!state) {
        throw new Error('Could not load name-type policy.');
      }
      return state;
    },
    persist: async (next) => {
      const result = (await invoke('persistNameTypeTaggingPolicy', {
        dialogId,
        buckets: next.buckets,
        customTypes: next.customTypes,
        artMinCodePoints: next.artMinCodePoints,
      })) as { ok?: boolean; error?: string } | null;
      if (!result?.ok) {
        throw new Error(result?.error ?? 'Could not save name-type policy.');
      }
    },
  };

  const thingTypePolicy: ThingTypePolicyIO = {
    load: async () => {
      const state = (await invoke('getThingTypePolicyState', { dialogId })) as {
        customTypes: { id: string; label: string }[];
      } | null;
      if (!state) {
        throw new Error('Could not load thing-type policy.');
      }
      return state;
    },
    persist: async (customTypes) => {
      const result = (await invoke('persistThingTypePolicy', {
        dialogId,
        customTypes,
      })) as { ok?: boolean; error?: string } | null;
      if (!result?.ok) {
        throw new Error(result?.error ?? 'Could not save thing-type policy.');
      }
    },
  };

  const pedb: PedbIO = {
    ...sharedTursoTokenIO,
    load: async () => {
      const state = (await invoke('getPedbState', { dialogId })) as PedbBackendConfig | null;
      return state ?? undefined;
    },
    save: async (next) => {
      await invoke('savePedb', { dialogId, pedb: next });
    },
    migrateLocalData: async () => {
      const result = (await invoke('migratePedbLocalData', { dialogId })) as {
        ok: boolean;
        tables?: number;
        rows?: number;
        error?: string;
      } | null;
      return result ?? { ok: false, error: 'Could not migrate local data.' };
    },
  };

  return {
    loadState: async () => {
      const dialogState = (await invoke('getProjectMetadataState', { dialogId })) as Awaited<
        ReturnType<NonNullable<ProjectMetadataEditorIO['loadState']>>
      > | null;
      return dialogState;
    },
    saveMetadata: async (payload) => {
      const result = (await invoke('saveProjectMetadata', {
        dialogId,
        ...payload,
      })) as {
        ok: boolean;
        error?: string;
        summary?: string;
        syncReport?: { broken: number; conflicts: number };
      };
      return result ?? { ok: false, error: 'Could not save project metadata.' };
    },
    nameTypePolicy,
    thingTypePolicy,
    pedb,
    onCancel: options.onCancel,
    onSaved: options.onSaved,
  };
};

export const createEmbeddedProjectMetadataIO = (
  projectFilePath: string,
  mode: ProjectMetadataDialogMode = 'edition',
): ProjectMetadataEditorIO | null => {
  const projectApi = window.__leafWriterProject;
  if (!projectApi?.loadProjectMetadataState || !projectApi.saveProjectMetadata) return null;

  const pedb: PedbIO = {
    ...sharedTursoTokenIO,
    load: async () => (await window.electronAPI?.reloadProjectBundle?.(projectFilePath))?.config.pedb,
    save: async (next) => {
      await window.electronAPI?.updateProjectFileConfig?.(projectFilePath, { pedb: next });
    },
    migrateLocalData: async () =>
      (await window.electronAPI?.entityDbTursoMigrateLocalData?.(projectFilePath)) ?? {
        ok: false,
        error: 'Not available.',
      },
  };

  return {
    loadState: () => projectApi.loadProjectMetadataState!(mode),
    saveMetadata: (payload) =>
      projectApi.saveProjectMetadata!({
        projectFilePath,
        mode,
        ...payload,
      }),
    pedb,
    nameTypePolicy: {
      load: async () => {
        const state = await projectApi.getNameTypeTaggingPolicyState?.();
        if (!state) throw new Error('Could not load name-type policy.');
        return state;
      },
      persist: async (next) => {
        const result = await projectApi.persistNameTypeTaggingPolicy?.(next);
        if (!result?.ok) {
          throw new Error(result?.error ?? 'Could not save name-type policy.');
        }
      },
    },
    thingTypePolicy: {
      load: async () => {
        const state = await projectApi.getThingTypePolicyState?.();
        if (!state) throw new Error('Could not load thing-type policy.');
        return state;
      },
      persist: async (customTypes) => {
        const result = await projectApi.persistThingTypePolicy?.({ customTypes });
        if (!result?.ok) {
          throw new Error(result?.error ?? 'Could not save thing-type policy.');
        }
      },
    },
  };
};
