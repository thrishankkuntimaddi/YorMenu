import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { SessionProvider } from './session';
import { ToastProvider } from './ui';
import './styles.css';

// Phone back button (Android app) on screens outside the main layout: close a popup first.
// The main layout replaces this with one that also goes back a screen.
const baseBack = () => {
  if (document.querySelector('.overlay')) { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); return 'handled'; }
  return 'none';
};
Object.assign(window, { yormenuBack: baseBack, yormenuBaseBack: baseBack });

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <SessionProvider>
          <App />
        </SessionProvider>
      </ToastProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
