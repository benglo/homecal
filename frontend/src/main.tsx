import React from 'react';
import ReactDOM from 'react-dom/client';
import { AppProviders } from './AppProviders';
import { ModeRouter } from './ModeRouter';
import './styles/index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppProviders>
      <ModeRouter />
    </AppProviders>
  </React.StrictMode>
);

// Never-blank: service worker caches the app shell + last-good API responses,
// so a reload while the server is down still renders (spec §0).
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* SW optional; app still works online without it */
    });
  });
}
