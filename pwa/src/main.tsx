import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthProvider';
import { SessionQueryProvider } from './contexts/SessionQueryProvider';
import './index.css';
import { inject } from '@vercel/analytics';
import App from './App';

// Chemin relayé par web/scripts/domain-routes.mjs vers le Web Analytics du projet PWA.
inject({ endpoint: '/pwa-insights' });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <SessionQueryProvider>
          <App />
        </SessionQueryProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
