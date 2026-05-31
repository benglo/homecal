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

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`/sw.js?v=${__BUILD_ID__}`).catch(() => {
      /* SW optional; app still works online without it */
    });
  });
}
