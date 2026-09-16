import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';

const vite = await createServer({ cacheDir: 'node_modules/.vite-pwa-bridge-test', optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
after(() => vite.close());
const { default: Bridge } = await vite.ssrLoadModule('/src/components/install/PwaInstallBridge.tsx');
const { SiteProvider } = await vite.ssrLoadModule('/src/contexts/SiteContext.tsx');
const { pwaUrl } = await vite.ssrLoadModule('/src/lib/pwaUrl.ts');
const element = (slug = 'alpha') => React.createElement(SiteProvider, {
  site: { club: { id: slug, slug, status: 'active' }, clubName: `Club ${slug}`, origin: 'https://custom.example' },
}, React.createElement(Bridge, { key: slug }));
const key = slug => `feelike:${slug}:pwaBridgeDismissedAt`;

test('destination par club, sans reprise du domaine personnalisé ni URL arbitraire', () => {
  assert.equal(pwaUrl('cac-tennis'), 'https://app-cac-tennis.feelike.pro/');
  assert.equal(pwaUrl('beta'), 'https://app-beta.feelike.pro/');
  for (const slug of ['', 'https://evil.example', 'alpha.evil', '../beta', 'a'.repeat(33)]) assert.equal(pwaUrl(slug), null);
  assert.equal(renderToString(element()), '', 'HTML serveur et premier rendu client identiques');
});

test('hydratation, fermeture persistante par club, expiration, stockage bloqué et standalone', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://custom.example' });
  const saved = Object.fromEntries(['window', 'document', 'IS_REACT_ACT_ENVIRONMENT'].map(k => [k, globalThis[k]]));
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  let standalone = false;
  dom.window.matchMedia = () => ({ matches: standalone });
  const container = document.getElementById('root');
  let root;
  const mount = async (slug = 'alpha') => {
    if (root) await act(async () => root.unmount());
    root = createRoot(container);
    await act(async () => root.render(element(slug)));
  };
  try {
    const errors = [];
    container.innerHTML = renderToString(element());
    await act(async () => { root = hydrateRoot(container, element(), { onRecoverableError: error => errors.push(error) }); });
    assert.deepEqual(errors, []);
    assert.equal(document.querySelector('a').href, 'https://app-alpha.feelike.pro/');
    assert.match(document.querySelector('aside').textContent, /Club alpha/);
    await act(async () => document.querySelector('button').click());
    assert.equal(document.querySelector('aside'), null);
    assert.ok(dom.window.localStorage.getItem(key('alpha')));
    await mount();
    assert.equal(document.querySelector('aside'), null, 'fermeture conservée après navigation');
    await mount('beta');
    assert.equal(document.querySelector('a').href, 'https://app-beta.feelike.pro/');
    const link = document.querySelector('a');
    // JSDOM ne navigue pas : intercepter seulement l'action native, après React.
    let navigationAllowed = false;
    document.addEventListener('click', event => {
      navigationAllowed = !event.defaultPrevented;
      event.preventDefault();
    }, { once: true });
    await act(async () => link.click());
    assert.equal(navigationAllowed, true, 'le pont ne bloque pas la navigation du lien');
    assert.equal(document.querySelector('aside'), null);
    assert.ok(dom.window.localStorage.getItem(key('beta')));
    await mount('beta');
    assert.equal(document.querySelector('aside'), null, 'clic sur Ouvrir mémorisé au retour');
    dom.window.localStorage.setItem(key('alpha'), String(Date.now() - 8 * 86400000));
    await mount();
    assert.ok(document.querySelector('aside'), 'réapparition après sept jours');
    for (const value of ['invalid', String(Date.now() + 86400000)]) {
      dom.window.localStorage.setItem(key('alpha'), value);
      await mount();
      assert.ok(document.querySelector('aside'), 'valeur invalide ou future ignorée');
    }
    Object.defineProperty(dom.window, 'localStorage', { get() { throw new Error('blocked'); } });
    await mount();
    assert.ok(document.querySelector('aside'));
    await act(async () => document.querySelector('button').click());
    assert.equal(document.querySelector('aside'), null);
    standalone = true;
    await mount();
    assert.equal(document.querySelector('aside'), null);
    standalone = false;
    Object.defineProperty(dom.window.navigator, 'standalone', { value: true });
    await mount();
    assert.equal(document.querySelector('aside'), null, 'mode installé iOS');
  } finally {
    if (root) await act(async () => root.unmount());
    Object.assign(globalThis, saved);
    dom.window.close();
  }
});
