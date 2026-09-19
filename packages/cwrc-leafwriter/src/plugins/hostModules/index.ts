import type { PluginRegisterContext } from '../registerContext';

export interface PluginHostModule {
  registerCjkDatesUi?: (context: PluginRegisterContext) => void;
  registerNorbertNobleTitleUi?: (context: PluginRegisterContext) => void;
  registerKanripoImportUi?: (context: PluginRegisterContext) => void;
  registerDaozangImportUi?: (context: PluginRegisterContext) => void;
  registerCbetaImportUi?: (context: PluginRegisterContext) => void;
  registerBdrcImportUi?: (context: PluginRegisterContext) => void;
  registerChhivSymbolPaletteUi?: (context: PluginRegisterContext) => void;
}

const loaders: Record<string, () => Promise<PluginHostModule>> = {
  'cjk-dates-ui': () => import('./cjkDatesUi'),
  'norbert-noble-title-ui': () => import('./norbertNobleTitleUi'),
  'kanripo-import-ui': () => import('./kanripoImportUi'),
  'daozang-import-ui': () => import('./daozangImportUi'),
  'cbeta-import-ui': () => import('./cbetaImportUi'),
  'bdrc-import-ui': () => import('./bdrcImportUi'),
  'chhiv-symbol-palette-ui': () => import('./chhivSymbolPaletteUi'),
};

export async function loadPluginHostModule(moduleId: string): Promise<PluginHostModule> {
  const load = loaders[moduleId];
  if (!load) {
    throw new Error(`Unknown plugin host module: ${moduleId}`);
  }
  return load();
}
