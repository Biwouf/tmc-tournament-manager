import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' });
globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; };
const req = createRequire(new URL('../pwa/package.json', import.meta.url));
const { createElement: h, act } = req('react'); const { createRoot } = req('react-dom/client');
const { QueryClient, QueryClientProvider } = req('@tanstack/react-query');
const { MemoryRouter } = req('react-router-dom');
const src = resolve(new URL('../pwa/src', import.meta.url).pathname);

const candidates = [
  { id: 'u1', prenom: 'Romain', nom: 'Escaffre', classement: '30', sex: 'male', is_captain: true },
  { id: 'u2', prenom: 'Julien', nom: 'Marty', classement: '15/3', sex: 'male', is_captain: false },
  { id: 'u3', prenom: 'Claire', nom: 'Dupont', classement: null, sex: 'female', is_captain: false },
  { id: 'u4', prenom: 'Hugo', nom: 'Daran', classement: null, sex: null, is_captain: false },
];
const base = { captains: [{ prenom: 'Romain', nom: 'Escaffre' }], updated_at: null, updated_by: null,
  min_players: 3, simples: 3, doubles: 1, format: '3S1D', genre: 'hommes' };
let lineup; let saved = []; let saveError = null;
const mocks = {
  '/lib/supabase.ts': { supabase: { rpc: async (name, args) => {
    if (name === 'team_compo_get') return { data: lineup, error: null };
    if (name === 'team_compo_candidates') return { data: candidates, error: null };
    if (name === 'team_compo_save') {
      saved.push(args);
      if (saveError) return { data: null, error: saveError };
      lineup = { ...lineup, version: lineup.version + 1 };
      return { data: lineup, error: null };
    }
    return { data: null, error: null };
  } } },
};
const modules = new Map();
function load(file) {
  for (const [suffix, value] of Object.entries(mocks)) if (file.endsWith(suffix)) return value;
  if (modules.has(file)) return modules.get(file).exports;
  const module = { exports: {} }; modules.set(file, module);
  const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const require = name => { if (!name.startsWith('.')) return req(name); const path = resolve(dirname(file), name); return load([path, `${path}.ts`, `${path}.tsx`].find(existsSync)); };
  vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename: file })(require, module, module.exports);
  return module.exports;
}
const Section = load(resolve(src, 'components/teamMatches/TeamLineupSection.tsx')).default;
const button = text => [...document.querySelectorAll('button')].find(b => b.textContent.includes(text));
const row = name => [...document.querySelectorAll('[role=checkbox]')].find(r => r.textContent.includes(name));
const click = async target => act(async () => target.dispatchEvent(new window.MouseEvent('click', { bubbles: true })));
const wait = () => act(async () => { await new Promise(r => setTimeout(r, 0)); });
const type = async (value) => act(async () => {
  const input = document.querySelector('input[type=search]');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, value); input.dispatchEvent(new window.Event('input', { bubbles: true }));
});
async function render(props) {
  const root = createRoot(document.getElementById('root'));
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: 0, retry: false } } });
  await act(async () => root.render(h(MemoryRouter, null, h(QueryClientProvider, { client },
    h(Section, { clubId: 'club', rencontreId: 'r', signedIn: true, started: false, ...props })))));
  await wait();
  return () => act(async () => root.unmount());
}

test('Visiteur : verrou avec connexion et inscription, aucune lecture de la compo', async () => {
  lineup = { ...base, players: [], version: 0, can_edit: false };
  const unmount = await render({ signedIn: false });
  try {
    assert.match(document.body.textContent, /Qui joue \? Connectez-vous/);
    assert.ok([...document.querySelectorAll('a')].some(a => a.textContent === 'Créer un compte'));
  } finally { await unmount(); }
});

test('Membre : compo vide qui nomme le capitaine, puis liste avec Capitaine et Sans compte', async () => {
  lineup = { ...base, players: [], version: 0, can_edit: false };
  let unmount = await render();
  try {
    assert.match(document.body.textContent, /Compo pas encore saisie/);
    assert.match(document.body.textContent, /Romain Escaffre, capitaine, l’ajoutera ici avant la rencontre/);
    assert.equal(button('Choisir les joueurs'), undefined);
  } finally { await unmount(); }
  lineup = { ...base, version: 1, can_edit: false, players: [
    { id: 'p1', user_id: null, is_guest: false, prenom: 'Romain', nom: 'Escaffre', initials: 'RE', classement: '30', is_captain: true, is_me: false, sex: null },
    { id: 'p2', user_id: null, is_guest: true, prenom: 'Paul', nom: 'Girard', initials: 'PG', classement: null, is_captain: false, is_me: false, sex: null },
  ] };
  unmount = await render();
  try {
    assert.equal(document.querySelector('ul').getAttribute('aria-label'), 'Compo, 2 joueurs');
    assert.deepEqual([...document.querySelectorAll('li')].map(li => li.getAttribute('aria-label')),
      ['Romain Escaffre, Capitaine, 30', 'Paul Girard, Sans compte']);
    assert.equal(button('Modifier'), undefined);
  } finally { await unmount(); }
});

test('Capitaine : filtre Hommes, coche, invité sans compte, doublon refusé, enregistrement de toute la liste', async () => {
  lineup = { ...base, players: [], version: 0, can_edit: true };
  saved = []; saveError = null;
  const unmount = await render();
  try {
    assert.match(document.body.textContent, /Choisissez les joueurs dans tout le club/);
    await click(button('Choisir les joueurs')); await wait();
    // Compétition masculine : filtre Hommes présélectionné, Claire et Hugo cachés.
    assert.equal(document.querySelector('[role=radio][aria-checked=true]').textContent, 'Hommes 2');
    assert.ok(row('Romain Escaffre') && row('Julien Marty'));
    assert.equal(row('Claire Dupont'), undefined);
    assert.match(row('Romain Escaffre').getAttribute('aria-label'), /Capitaine/);
    assert.match(document.querySelector('[role=status]').textContent, /Il faut au moins 3 joueurs pour les 3 simples/);

    await click(row('Romain Escaffre'));
    await click(row('Julien Marty'));
    assert.equal(row('Julien Marty').getAttribute('aria-checked'), 'true');

    // Nom introuvable : carte « sans compte », sexe facultatif.
    await type('Paul Girard');
    assert.match(document.body.textContent, /Aucun membre du club ne s’appelle « Paul Girard »/);
    assert.match(document.body.textContent, /Ajouter Paul Girard, sans compte/);
    await click([...document.querySelectorAll('[role=radio]')].find(b => b.textContent === 'Homme'));
    await click(button('Ajouter'));
    assert.equal(row('Paul Girard').getAttribute('aria-checked'), 'true');
    assert.match(document.querySelector('[role=status]').textContent, /3 joueurs retenus · il en faut au moins 3 pour 3 simples/);

    // Même invité une seconde fois (casse et accents ignorés) : refusé.
    await type('paul GIRÂRD');
    await click(button('Ajouter'));
    assert.match(document.querySelector('[role=alert]').textContent, /Paul Girard est déjà dans la compo/);

    // Une recherche partielle liste les membres, puis propose l'ajout sans compte en dernier.
    await type('Mar');
    assert.ok(row('Julien Marty'));
    assert.ok(button('Ajouter « Mar » sans compte'));
    await type('');

    await click(button('Enregistrer la compo')); await wait();
    assert.deepEqual(saved[0].p_players, [{ user_id: 'u1' }, { user_id: 'u2' }, { prenom: 'Paul', nom: 'Girard', sex: 'male' }]);
    assert.equal(saved[0].p_version, 0);
    assert.match(document.body.textContent, /Compo enregistrée/);
    assert.equal(document.querySelector('dialog'), null);
  } finally { await unmount(); }
});

test('Capitaine : version périmée, abandon des changements', async () => {
  lineup = { ...base, version: 3, can_edit: true, players: [
    { id: 'p1', user_id: 'u1', is_guest: false, prenom: 'Romain', nom: 'Escaffre', initials: 'RE', classement: '30', is_captain: true, is_me: true, sex: 'male' },
    { id: 'g1', user_id: null, is_guest: true, prenom: 'Paul', nom: 'Girard', initials: 'PG', classement: null, is_captain: false, is_me: false, sex: 'male' },
  ] };
  saved = []; saveError = { message: 'COMPO_STALE', details: 'Romain', code: 'PT409' };
  const unmount = await render();
  try {
    await click(button('Modifier')); await wait();
    // Les retenus sont en tête ; décocher ne fait pas sauter la ligne.
    await click(row('Paul Girard'));
    assert.equal(row('Paul Girard').getAttribute('aria-checked'), 'false');
    await click(button('Enregistrer la compo')); await wait();
    assert.deepEqual(saved[0].p_players, [{ user_id: 'u1' }]);
    assert.match(document.querySelector('[role=alert]').textContent, /Romain vient de modifier la compo/);
    assert.ok(button('Recharger'));
    // Fermer avec des changements : confirmation.
    await click(document.querySelector('[aria-label=Fermer]'));
    assert.match(document.body.textContent, /Abandonner vos changements \?/);
    await click(button('Continuer à modifier'));
    assert.ok(row('Paul Girard'));
    await click(document.querySelector('[aria-label=Fermer]'));
    await click(button('Abandonner'));
    assert.equal(document.querySelector('dialog'), null);
    // Un invité gardé est renvoyé par son id.
    saveError = null; saved = [];
    await click(button('Modifier')); await wait();
    await click(button('Enregistrer la compo')); await wait();
    assert.deepEqual(saved[0].p_players, [{ user_id: 'u1' }, { id: 'g1' }]);
  } finally { await unmount(); }
});
