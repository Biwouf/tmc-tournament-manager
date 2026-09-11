import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

const vite = await createServer({ optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
after(() => vite.close());
const { default: ContactForm } = await vite.ssrLoadModule('/src/components/contact/ContactForm.tsx');
const { SiteProvider } = await vite.ssrLoadModule('/src/contexts/SiteContext.tsx');

test('formulaire : destinataire côté serveur, double clic, erreurs et message conservé sans email', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' });
  const saved = Object.fromEntries(['window', 'document', 'FormData', 'IS_REACT_ACT_ENVIRONMENT', 'fetch'].map(k => [k, globalThis[k]]));
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, FormData: dom.window.FormData, IS_REACT_ACT_ENVIRONMENT: true });
  const root = createRoot(document.getElementById('root'));
  try {
    await act(async () => root.render(React.createElement(SiteProvider, { site: { club: { id: 'club-cac' } } }, React.createElement(ContactForm))));
    const form = document.querySelector('form');
    const fill = () => {
      for (const [name, value] of Object.entries({ firstname: 'Jean', lastname: 'Dupont', email: 'visitor@example.invalid', message: 'Bonjour, je souhaite découvrir le club.' })) {
        form.elements.namedItem(name).value = value;
      }
    };
    const submit = () => form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    fill();
    let release;
    const calls = [];
    globalThis.fetch = (url, options) => {
      calls.push({ url, options });
      return new Promise(resolve => { release = resolve; });
    };
    await act(async () => { submit(); submit(); });
    assert.equal(calls.length, 1);
    assert.equal(document.querySelector('button').disabled, true);
    assert.ok(calls[0].url.endsWith('/functions/v1/contact-form'));
    const body = JSON.parse(calls[0].options.body);
    assert.deepEqual(Object.keys(body).sort(), ['club_id', 'email', 'first_name', 'last_name', 'message', 'phone', 'website']);
    assert.equal(body.club_id, 'club-cac');
    assert.equal(body.email, 'visitor@example.invalid');
    await act(async () => release(Response.json({ success: true, email_sent: true })));
    assert.match(document.querySelector('[role=status]').textContent, /bien été envoyé/);
    assert.equal(form.elements.namedItem('message').value, '');

    fill();
    globalThis.fetch = async () => Response.json({ success: false, error: 'Trop de messages.' }, { status: 429 });
    await act(async () => submit());
    assert.equal(document.querySelector('[role=alert]').textContent, 'Trop de messages.');
    assert.ok(form.elements.namedItem('message').value);
    assert.equal(document.querySelector('button').disabled, false);

    globalThis.fetch = async () => { throw new TypeError('network'); };
    await act(async () => submit());
    assert.match(document.querySelector('[role=alert]').textContent, /connexion/);
    assert.ok(form.elements.namedItem('message').value);

    globalThis.fetch = async () => Response.json({ success: true, email_sent: false, email_error: 'Brevo private error' });
    await act(async () => submit());
    assert.match(document.querySelector('[role=status]').textContent, /bien été enregistré/);
    assert.doesNotMatch(document.querySelector('[role=status]').textContent, /Brevo private error/);
    assert.equal(form.elements.namedItem('message').value, '');
  } finally {
    await act(async () => root.unmount());
    Object.assign(globalThis, saved);
    dom.window.close();
  }
});
