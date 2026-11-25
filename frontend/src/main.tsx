import React from 'react';
import ReactDOM from 'react-dom/client';
import { AuthProvider } from './lib/auth';
import { initSyncDetection } from './lib/sync';
import App from './App';
import { configureFeatureFlagRuntimeDefaults } from './app/feature-flags';
import { DesktopWorkspaceProvider } from './app/v04/desktopWorkspaceContext';
import { isDesktopRuntime } from './platforms/runtime';
import {
  ThemeProvider,
  createLocalStorageThemeStorage,
  createMatchMediaSystemThemeSource,
} from './shared/theme';
import './index.css';

// The Web rollout remains opt-in, while the desktop Alpha opens
// directly into the v0.4 local-first product whose slices have
// already passed WP-02 through WP-07 gates. Collaboration and
// its remote gateway remain opt-in.
if (isDesktopRuntime()) {
  configureFeatureFlagRuntimeDefaults({
    v04Shell: true,
    v04Assistant: true,
    v04Study: true,
    v04Research: true,
    v04Canvas: true,
  });
}

// Initialize sync/offline detection
initSyncDetection();

const themeAdapters = {
  storage: createLocalStorageThemeStorage(),
  systemTheme: createMatchMediaSystemThemeSource(),
};

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider adapters={themeAdapters}>
      <DesktopWorkspaceProvider>
        <AuthProvider>
          <App />
        </AuthProvider>
      </DesktopWorkspaceProvider>
    </ThemeProvider>
  </React.StrictMode>
);
