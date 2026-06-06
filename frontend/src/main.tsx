import React from 'react';
import ReactDOM from 'react-dom/client';
import { AuthProvider } from './lib/auth';
import { initSyncDetection } from './lib/sync';
import App from './App';
import './index.css';

// Initialize sync/offline detection
initSyncDetection();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </React.StrictMode>
);
