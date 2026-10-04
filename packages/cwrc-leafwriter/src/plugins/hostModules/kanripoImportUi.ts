import { KanripoImportDialog, isKanripoImportAvailable } from '../../dialogs/kanripoImport';
import {
  runAiFillGapsEditorCommand,
  runAiPunctuateEditorCommand,
  runPurgePunctEditorCommand,
  runReflowParagraphsEditorCommand,
} from '../../aiPunctuation/aiPunctuateEditor';
import { runApplyGaijiTableToProject } from '../../utilities/applyGaijiOverridesToProject';
import { isPluginEnabled } from '../registry';
import type { PluginRegisterContext } from '../registerContext';

const openKanripoDialog = (props?: { variant?: 'import' | 'punctuate' }): boolean => {
  const dialog = { type: 'kanripoImport', props };
  if (window.__ljbHostDialogBridge?.openDialog) {
    window.__ljbHostDialogBridge.openDialog(dialog);
    return true;
  }
  if (window.writer?.overmindActions?.ui?.openDialog) {
    window.writer.overmindActions.ui.openDialog({ type: 'kanripoImport', props });
    return true;
  }
  return false;
};

const hostNotify = (message: string): void => {
  window.__ljbHostDialogBridge?.notify?.(message);
  window.writer?.overmindActions?.ui?.notifyViaSnackbar?.(message);
};

/** Registers File-menu wizard and editor punctuate command for Kanripo import. */
export function registerKanripoImportUi(context: PluginRegisterContext): void {
  context.log('registering Kanripo import UI');
  context.registerDialog('kanripoImport', KanripoImportDialog);

  const openImport = ({ notify }: { notify: (message: string) => void }) => {
    if (!isPluginEnabled('kanripo-import')) {
      notify('Enable the “Kanripo import” plugin in Tools → Plugins.');
      return;
    }
    if (!isKanripoImportAvailable()) {
      notify('Kanripo import is available in the desktop app.');
      return;
    }
    const project = window.__leafWriterProject;
    if (!project?.isProjectReady?.() || !project.getProjectRootPath?.()) {
      notify('Open a project first.');
      return;
    }
    if (openKanripoDialog()) return;
    notify('Kanripo import is not ready yet — try again in a moment.');
  };

  const openPunctuate = ({ notify }: { notify: (message: string) => void }) => {
    if (!isPluginEnabled('kanripo-import')) {
      notify('Enable the “Kanripo import” plugin in Tools → Plugins.');
      return;
    }
    if (!window.__leafWriterProject?.getActiveFileXml?.()) {
      notify('Open a document first.');
      return;
    }
    if (openKanripoDialog({ variant: 'punctuate' })) return;
    notify('Open a document in the editor first.');
  };

  const runEditorCommand = async (
    fn: () => Promise<{ ok: boolean; message: string; cancelled?: boolean }>,
    notify: (message: string) => void,
    options?: { busyMessage?: string },
  ) => {
    if (!isPluginEnabled('kanripo-import')) {
      notify('Enable the “Kanripo import” plugin in Tools → Plugins.');
      return;
    }
    if (!isKanripoImportAvailable()) {
      notify('Kanripo tools are available in the desktop app.');
      return;
    }
    if (!window.__leafWriterProject?.getActiveFileXml?.()) {
      notify('Open a document first.');
      return;
    }
    if (options?.busyMessage) {
      notify(options.busyMessage);
    }
    try {
      const outcome = await fn();
      notify(outcome.message);
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error));
    }
  };

  const openAiPunctuate = async ({ notify }: { notify: (message: string) => void }) => {
    if (!isPluginEnabled('kanripo-import')) {
      notify('Enable the “Kanripo import” plugin in Tools → Plugins.');
      return;
    }
    if (!isKanripoImportAvailable()) {
      notify('Kanripo tools are available in the desktop app.');
      return;
    }
    if (!window.__leafWriterProject?.getActiveFileXml?.()) {
      notify('Open a document first.');
      return;
    }
    try {
      const outcome = await runAiPunctuateEditorCommand();
      if (!outcome.ok && !outcome.cancelled) {
        notify(outcome.message);
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error));
    }
  };

  const openPurgePunct = async ({ notify }: { notify: (message: string) => void }) => {
    await runEditorCommand(runPurgePunctEditorCommand, notify);
  };

  const openReflowParagraphs = async ({ notify }: { notify: (message: string) => void }) => {
    await runEditorCommand(runReflowParagraphsEditorCommand, notify);
  };

  const openAiFillGaps = async ({ notify }: { notify: (message: string) => void }) => {
    if (!isPluginEnabled('kanripo-import')) {
      notify('Enable the “Kanripo import” plugin in Tools → Plugins.');
      return;
    }
    if (!isKanripoImportAvailable()) {
      notify('Kanripo tools are available in the desktop app.');
      return;
    }
    if (!window.__leafWriterProject?.getActiveFileXml?.()) {
      notify('Open a document first.');
      return;
    }
    try {
      const outcome = await runAiFillGapsEditorCommand();
      if (!outcome.ok && !outcome.cancelled) {
        notify(outcome.message);
      } else if (outcome.ok) {
        notify(outcome.message);
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error));
    }
  };

  const openApplyGaijiTable = async ({ notify }: { notify: (message: string) => void }) => {
    if (!isPluginEnabled('kanripo-import')) {
      notify('Enable the “Kanripo import” plugin in Tools → Plugins.');
      return;
    }
    try {
      const outcome = await runApplyGaijiTableToProject();
      if (outcome.ok || !outcome.cancelled) notify(outcome.message);
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error));
    }
  };

  context.registerToolAction('kanripo-import.open', openImport);
  context.registerToolAction('kanripo-import.apply-gaiji-table', openApplyGaijiTable);
  context.registerToolAction('kanripo-import.punctuate', openPunctuate);
  context.registerToolAction('kanripo-import.ai-punctuate', openAiPunctuate);
  context.registerToolAction('kanripo-import.ai-fill-gaps', openAiFillGaps);
  context.registerToolAction('kanripo-import.purge-punct', openPurgePunct);
  context.registerToolAction('kanripo-import.reflow-paragraphs', openReflowParagraphs);

  context.registerToolbarItem({
    id: 'kanripo',
    icon: 'kanripo',
    title: 'Kanripo',
    tooltip: 'Import from Kanripo or punctuate the open file',
    group: 'ui',
    isAvailable: () => isPluginEnabled('kanripo-import') && isKanripoImportAvailable(),
    menuItems: [
      {
        id: 'import',
        label: 'Import from Kanripo…',
        onClick: () => openImport({ notify: hostNotify }),
      },
      {
        id: 'punctuate',
        label: 'Segment and punctuate…',
        onClick: () => openPunctuate({ notify: hostNotify }),
      },
      {
        id: 'ai-punctuate',
        label: 'AI punctuate selection…',
        onClick: () => openAiPunctuate({ notify: hostNotify }),
      },
      {
        id: 'ai-fill-gaps',
        label: 'AI fill gaps…',
        onClick: () => openAiFillGaps({ notify: hostNotify }),
      },
      {
        id: 'purge-punct',
        label: 'Purge punctuation…',
        onClick: () => openPurgePunct({ notify: hostNotify }),
      },
      {
        id: 'apply-gaiji-table',
        label: 'Apply gaiji table to project…',
        onClick: () => openApplyGaijiTable({ notify: hostNotify }),
      },
      {
        id: 'reflow-paragraphs',
        label: 'Reflow paragraphs…',
        onClick: () => openReflowParagraphs({ notify: hostNotify }),
      },
    ],
  });
}

declare global {
  interface Window {
    __ljbHostDialogBridge?: {
      openDialog: (dialog: { type: string; props?: Record<string, unknown> }) => void;
      notify: (message: string) => void;
    };
  }
}
