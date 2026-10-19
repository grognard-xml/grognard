// import { scan } from 'react-scan';

import '@fontsource/lato/100.css';
import '@fontsource/lato/300.css';
import '@fontsource/lato/400.css';
import '@fontsource/lato/700.css';
import '@fontsource/lato/900.css';
import './fonts/han.css';
import { createOvermind } from 'overmind';
import { Provider } from 'overmind-react';
import { createRoot } from 'react-dom/client';
import { HelmetProvider } from 'react-helmet-async';
import { BrowserRouter } from 'react-router';
import App from './App';
import './i18n';
import { config } from './overmind';
import {
  clearChunkLoadRecoveryGuard,
  recoverFromChunkLoadFailure,
} from '../../../packages/cwrc-leafwriter/src/plugins/chunkLoadRecovery';
import { registerHostSettingsPanels } from './desktop/registerHostSettingsPanels';
import './utilities/devtoolsLog';
import './utilities/log';

// scan({ enabled: true });

// The editor package renders the project-metadata tab of its settings dialog,
// but the form itself is commons-owned and desktop-only. Register it here, at
// module init, so it is in place before any dialog can be opened.
registerHostSettingsPanels();

// A webpack watch rebuild can briefly leave the page with an old lazy-chunk
// name while the new asset is being written. Reload once so the page obtains
// the current app manifest instead of leaving the desktop renderer broken.
if (typeof window !== 'undefined') {
  window.addEventListener('unhandledrejection', (event) => {
    recoverFromChunkLoadFailure(event.reason);
  });
  window.setTimeout(clearChunkLoadRecoveryGuard, 5000);
}

const isNativeDialogRoute =
  typeof window !== 'undefined' && window.location.pathname.startsWith('/project/native/');

// Overmind attempts to connect to localhost:3031 as soon as this option is
// enabled. Keep the production and desktop console clean unless the developer
// explicitly asks for the inspector with `?overmindDevtools=1`.
const enableOvermindDevtools =
  !isNativeDialogRoute &&
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('overmindDevtools') === '1';

const overmind = createOvermind(config, {
  name: isNativeDialogRoute ? 'Commons-NativeDialog' : 'Commons',
  devtools: enableOvermindDevtools,
  logProxies: enableOvermindDevtools,
});

const container = document.getElementById('app');
if (!container) throw new Error(`HTML element id 'app' not found`);

const root = createRoot(container);

root.render(
  <Provider value={overmind}>
    <HelmetProvider>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </HelmetProvider>
  </Provider>,
);
