import { StrictMode } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import type { Site } from './lib/site';
import { inject } from '@vercel/analytics';
import App from './App';

inject();

const site = JSON.parse(document.getElementById('site-data')!.textContent!) as Site;
hydrateRoot(document.getElementById('root')!,
  <StrictMode><BrowserRouter><App site={site} /></BrowserRouter></StrictMode>,
);
// Le retour navigateur doit lui aussi réévaluer les publications et suspensions.
window.addEventListener('pageshow', event => { if (event.persisted) window.location.reload(); });
