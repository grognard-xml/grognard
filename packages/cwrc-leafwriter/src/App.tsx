import { Box } from '@mui/material';
import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { BottomBar, ContextMenu, EditorLocationBar, EditorToolbar } from './components';
import { createConfig } from './config';
import { EntityLookupDialog } from './dialogs';
import { useDialog, useNotifier, useTeiHeaderRepairPrompt } from './hooks';
import { configureAuthorityServices } from './jotai/entity-lookup/utilities';
import type Writer from './js/Writer';
import { useActions, useAppState } from './overmind';
import { MarkupPanel } from './panels/markup';
import { TocPanel } from './panels/toc';
import { AutoTaggingReviewPane } from './layout/AutoTaggingReviewPane';
import {
  DisambiguationReviewPane,
  DISAMBIGUATION_PANEL_WIDTH,
} from './layout/DisambiguationReviewPane';
import { TranslationPane } from './layout/TranslationPane';
import type { LeafWriterOptions } from './types';
import './utilities/cursorSession';
// import { Layout } from './layout';

const CONTAINER = 'lw-layout-container';

const SourceEditorPane = lazy(() =>
  import(
    /* webpackChunkName: "leafwriter-monaco" */ './components/sourceEditor/SourceEditorPane'
  ).then((module) => ({
    default: module.SourceEditorPane,
  })),
);

// Same chunk as the editor: the toolbar drives Monaco and would otherwise drag it
// into the main bundle.
const SourceToolbar = lazy(() =>
  import(
    /* webpackChunkName: "leafwriter-monaco" */ './components/sourceEditor/SourceToolbar'
  ).then((module) => ({ default: module.SourceToolbar })),
);

const CodePanel = lazy(() =>
  import(/* webpackChunkName: "leafwriter-monaco" */ './panels/code').then((module) => ({
    default: module.CodePanel,
  })),
);

declare global {
  interface Window {
    __ljbDebugValidator?: (options?: { runValidation?: boolean }) => Promise<unknown>;
  }
}

const isDesktopApp = () => typeof window !== 'undefined' && !!window.electronAPI;

const waitForElement = (selector: string, timeoutMs = 5000): Promise<Element> =>
  new Promise((resolve, reject) => {
    const started = Date.now();
    const check = () => {
      const element = document.querySelector(selector);
      if (element) {
        resolve(element);
        return;
      }
      if (Date.now() - started > timeoutMs) {
        reject(new Error(`Element not found: ${selector}`));
        return;
      }
      requestAnimationFrame(check);
    };
    check();
  });

const observeElement = (
  selector: string,
  onChange: (element: Element | null) => void,
): (() => void) => {
  let lastElement: Element | null = null;

  const publish = () => {
    const nextElement = document.querySelector(selector);
    if (nextElement === lastElement) return;
    lastElement = nextElement;
    onChange(nextElement);
  };

  publish();

  const observer = new MutationObserver(() => publish());
  observer.observe(document.body, { childList: true, subtree: true });

  return () => observer.disconnect();
};

const App = ({ document, settings, user }: LeafWriterOptions) => {
  const actions = useActions();
  const state = useAppState();
  const { editorViewMode, autoTaggingReview, disambiguationReview, markupPanel } = state.ui;
  const autoTaggingActive = autoTaggingReview?.active ?? false;
  const disambiguationActive = disambiguationReview?.active ?? false;
  const { isReadonly, showRawXmlPanel } = state.editor;
  const [writer, setWriter] = useState<Writer | null>(null);
  const { i18n } = useTranslation();

  useDialog();
  useNotifier();
  useTeiHeaderRepairPrompt(writer);

  const [editorToobarContainer, setEditorToobarContainer] = useState<Element | null>(null);
  const [editorLocationBarContainer, setEditorLocationBarContainer] = useState<Element | null>(
    null,
  );
  const [sourceEditorPaneContainer, setSourceEditorPaneContainer] = useState<Element | null>(null);
  const [codePanelContainer, setCodePanelContainer] = useState<Element | null>(null);
  const [tocPanelContainer, setTocPanelContainer] = useState<Element | null>(null);
  const [structureTreePanelContainer, setStructureTreePanelContainer] = useState<Element | null>(
    null,
  );
  const [translationPaneContainer, setTranslationPaneContainer] = useState<Element | null>(null);
  const [autoTaggingPaneContainer, setAutoTaggingPaneContainer] = useState<Element | null>(null);
  const [disambiguationPaneContainer, setDisambiguationPaneContainer] = useState<Element | null>(
    null,
  );

  const [ready, setReady] = useState(false);
  // Monaco is expensive to create, especially on older machines. Load it only
  // when Source mode is first used, then keep that instance alive while the
  // visual editor is shown so a Visual → Source round trip does not rebuild it.
  // The document key below still recreates it when the active document changes.
  const [sourceEditorHasMounted, setSourceEditorHasMounted] = useState(false);
  const setupInProgressRef = useRef(false);
  const setupWaitersRef = useRef<(() => void)[]>([]);

  useEffect(() => {
    if (editorViewMode === 'source') setSourceEditorHasMounted(true);
  }, [editorViewMode]);

  useEffect(() => {
    i18n.changeLanguage(state.ui.currentLocale);
  }, [state.ui.currentLocale, i18n]);

  useEffect(() => {
    window.document.addEventListener('fullscreenchange', fullscreenchanged);
    window.addEventListener('changeLanguage', actions.ui.listenChangeLanguage);
    window.addEventListener('changeTheme', actions.ui.listenChangeTheme);
    return () => {
      window.document.removeEventListener('fullscreenchange', fullscreenchanged);
      window.removeEventListener('changeLanguage', actions.ui.listenChangeLanguage);
      window.removeEventListener('changeTheme', actions.ui.listenChangeTheme);
    };
    // Registered once for the app's lifetime. Add and remove use the same
    // references within a single run, so the teardown matches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (document.url === undefined) return;

    const existingContainer = window.writer?.layoutManager?.getContainer?.()?.[0];
    // Require TinyMCE finished (`isInitialized`), not merely that Writer exists.
    // Otherwise a half-boot with the same URL permanently skips setup.
    const alreadyLoaded =
      state.document.url === document.url &&
      Boolean(window.writer?.isInitialized) &&
      !!existingContainer &&
      window.document.body.contains(existingContainer);
    if (alreadyLoaded) return;

    actions.document.setDocumentTouched(false);
    actions.document.setLoaded(false);
    setWriter(null);
    void setup();
    // Keyed to the incoming document URL. `state.document.url` is read to detect
    // an already-loaded document and is written by the setup this effect starts,
    // so naming it would re-enter setup in a loop; `setup` is redefined every
    // render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [document.url]);

  useEffect(() => {
    if (ready) actions.ui.updateReadonly();
  }, [ready, state.editor.isReadonly, actions.ui]);

  // The translation tab's mount point only exists once at least one language is
  // configured, which can happen at any point during the session (via Edition
  // metadata) — so keep retrying rather than waiting once at startup.
  useEffect(() => {
    if (!isDesktopApp()) return;
    return observeElement('#desktop-panel-translation', setTranslationPaneContainer);
  }, []);

  useEffect(() => {
    if (!isDesktopApp()) return;
    return observeElement('#desktop-panel-auto-tagging', setAutoTaggingPaneContainer);
  }, []);

  useEffect(() => {
    if (!isDesktopApp()) return;
    return observeElement('#desktop-panel-disambiguation', setDisambiguationPaneContainer);
  }, []);

  useEffect(() => {
    if (!isDesktopApp() || !writer) return;
    const disconnectToc = observeElement('#desktop-panel-toc', setTocPanelContainer);
    const disconnectMarkup = observeElement(
      '#desktop-panel-markup',
      setStructureTreePanelContainer,
    );

    return () => {
      disconnectToc();
      disconnectMarkup();
    };
  }, [writer]);

  const fullscreenchanged = () => actions.ui.setFullscreen(!!window.document.fullscreenElement);

  const setup = async () => {
    // Serialize Writer/TinyMCE construction. A second init (settings → document)
    // used to bail while the first was still running and leave a half-boot.
    if (setupInProgressRef.current) {
      await new Promise<void>((resolve) => {
        setupWaitersRef.current.push(resolve);
      });
      const existingContainer = window.writer?.layoutManager?.getContainer?.()?.[0];
      const alreadyLoaded =
        state.document.url === document.url &&
        Boolean(window.writer?.isInitialized) &&
        !!existingContainer &&
        window.document.body.contains(existingContainer);
      if (alreadyLoaded) return;
    }

    setupInProgressRef.current = true;
    try {
      // Replace any previous Writer (settings bootstrap or failed half-boot)
      // before constructing a new TinyMCE instance on the same host.
      if (window.writer) {
        try {
          window.writer.destroy();
        } catch {
          // ignore teardown errors
        }
        window.writer = undefined as unknown as Writer;
      }

      const config = await createConfig(settings);

      config.container = CONTAINER;

      actions.document.clear();
      actions.editor.clear();

      actions.editor.writerInitSettings(config);

      if (settings?.locale) actions.ui.switchLocal(settings.locale);

      configureAuthorityServices(settings?.authorityServices);

      actions.user.setUser(user);

      await waitForElement(`#${CONTAINER}`);

      const { default: Writer } = await import(
        /* webpackChunkName: "leafwriter-visual-editor" */ './js/Writer'
      );
      const _writer = new Writer(config);

      _writer.overmindState = state;
      _writer.overmindActions = actions;
      window.writer = _writer;

      window.__ljbDebugValidator = (
        opts?: Parameters<typeof actions.validator.debugValidatorState>[0],
      ) => actions.validator.debugValidatorState(opts);

      _writer.event('writerInitialized').subscribe(() => {
        actions.document.setDocumentUrl(document.url);

        if (document.xml) {
          actions.document.setDocumentXml(document.xml);
        }

        // The desktop shell waits for TinyMCE and then loads the active tab
        // through loadDocumentInWriter().  Loading here as well used to run
        // the expensive XML → editor-DOM conversion twice on every cold
        // desktop start.  The standalone/web embedding still owns its first
        // document load here.
        if (!isDesktopApp()) {
          _writer.setDocument(document.xml);
        }

        setWriter(window.writer);

        const desktopToolbarRow = isDesktopApp()
          ? window.document.querySelector('#desktop-toolbar-row')
          : null;
        const legacyToolbarEl = window.document.querySelector('#editor-toolbar');
        if (desktopToolbarRow && legacyToolbarEl instanceof HTMLElement) {
          legacyToolbarEl.style.display = 'none';
        }

        const toolbarContainer = desktopToolbarRow ?? legacyToolbarEl;
        const locationBarContainer = window.document.querySelector('#editor-location-bar');
        const sourceEditorPane = window.document.querySelector('#source-editor-pane');
        const _codePanelContainer = window.document.querySelector(`#${_writer.editorId}-code`);

        setEditorToobarContainer(toolbarContainer);
        setEditorLocationBarContainer(locationBarContainer);
        setSourceEditorPaneContainer(sourceEditorPane);
        setCodePanelContainer(_codePanelContainer);

        if (isDesktopApp()) {
          void (async () => {
            try {
              const [_tocPanelContainer, _structureTreePanelContainer] = await Promise.all([
                waitForElement('#desktop-panel-toc'),
                waitForElement('#desktop-panel-markup'),
              ]);

              setTocPanelContainer(_tocPanelContainer);
              setStructureTreePanelContainer(_structureTreePanelContainer);
            } catch {
              console.warn('Desktop left panel mount points not found');
            }
          })();
        } else {
          const _tocPanelContainer = window.document.querySelector(`#${_writer.editorId}-toc`);
          const _structureTreePanelContainer = window.document.querySelector(
            `#${_writer.editorId}-markup`,
          );

          setTocPanelContainer(_tocPanelContainer);
          setStructureTreePanelContainer(_structureTreePanelContainer);
        }

        setTimeout(() => _writer.layoutManager.resizeEditor(), 50);
      });

      _writer.event('documentLoaded').subscribe((success: boolean) => {
        if (!success) return;
        // Never re-apply the init-time `document.xml` here — that closed-over
        // snapshot is stale after autotag apply / tab loads and used to
        // overwrite the just-loaded document in overmind state.
        actions.document.setLoaded(true);
      });

      setReady(true);
    } finally {
      setupInProgressRef.current = false;
      const waiters = setupWaitersRef.current.splice(0);
      waiters.forEach((resolve) => resolve());
    }
  };

  return (
    <Box
      sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, width: '100%' }}
    >
      <Box id={CONTAINER} sx={{ flex: 1, minHeight: 0, width: '100%' }}>
        {writer && <ContextMenu />}
        <EntityLookupDialog />
        <div>
          {editorLocationBarContainer &&
            createPortal(<EditorLocationBar />, editorLocationBarContainer)}
          {editorToobarContainer &&
            editorViewMode === 'visual' &&
            createPortal(<EditorToolbar />, editorToobarContainer)}
          {editorToobarContainer &&
            !isReadonly &&
            editorViewMode === 'source' &&
            createPortal(
              <Suspense fallback={null}>
                <SourceToolbar />
              </Suspense>,
              editorToobarContainer,
            )}
          {sourceEditorPaneContainer &&
            !isReadonly &&
            (editorViewMode === 'source' || sourceEditorHasMounted) &&
            createPortal(
              <Suspense fallback={null}>
                <SourceEditorPane key={state.document.url ?? state.document.schemaId ?? 'source'} />
              </Suspense>,
              sourceEditorPaneContainer,
            )}
          {tocPanelContainer && createPortal(<TocPanel />, tocPanelContainer)}
          {structureTreePanelContainer &&
            !isReadonly &&
            createPortal(
              <MarkupPanel syncMode={markupPanel.syncMode} />,
              structureTreePanelContainer,
            )}
          {codePanelContainer &&
            !isReadonly &&
            showRawXmlPanel &&
            createPortal(
              <Suspense fallback={null}>
                <CodePanel />
              </Suspense>,
              codePanelContainer,
            )}
          {translationPaneContainer && createPortal(<TranslationPane />, translationPaneContainer)}
          {autoTaggingPaneContainer &&
            createPortal(<AutoTaggingReviewPane />, autoTaggingPaneContainer)}
          {disambiguationPaneContainer &&
            createPortal(<DisambiguationReviewPane />, disambiguationPaneContainer)}
          {!isDesktopApp() && autoTaggingActive && (
            <Box
              sx={{
                position: 'fixed',
                right: 0,
                top: 0,
                bottom: 0,
                width: 380,
                zIndex: 1300,
                boxShadow: 4,
              }}
            >
              <AutoTaggingReviewPane />
            </Box>
          )}
          {!isDesktopApp() && disambiguationActive && (
            <Box
              sx={{
                position: 'fixed',
                right: 0,
                top: 0,
                bottom: 0,
                width: DISAMBIGUATION_PANEL_WIDTH,
                zIndex: 1300,
                boxShadow: 4,
              }}
            >
              <DisambiguationReviewPane />
            </Box>
          )}
        </div>
      </Box>
      {/* //* WIP {docLoaded && <Layout />} */}
      <BottomBar />
    </Box>
  );
};

export default App;
