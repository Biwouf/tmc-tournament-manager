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
globalThis.navigator ??= dom.window.navigator;
const req = createRequire(new URL('../package.json', import.meta.url));
const { createElement: h, act } = req('react'); const { createRoot } = req('react-dom/client');
const src = resolve(new URL('../src', import.meta.url).pathname);

const candidates = [
  { id: 'u1', prenom: 'Romain', nom: 'Escaffre', classement: '30', sex: 'male', is_captain: true },
  { id: 'u2', prenom: 'Julien', nom: 'Marty', classement: '15/3', sex: 'male', is_captain: false },
  { id: 'u3', prenom: 'Claire', nom: 'Dupont', classement: null, sex: 'female', is_captain: false },
  { id: 'u4', prenom: 'Hugo', nom: 'Daran', classement: null, sex: 'male', is_captain: false },
];
const base = { captains: [{ prenom: 'Romain', nom: 'Escaffre' }], updated_at: null, updated_by: null, min_players: 3, simples: 3, doubles: 1, format: '3S1D', genre: 'hommes' };
let lineup; let saved = []; let saveError = null;
const mocks = {
  '/lib/supabase.ts': { supabase: { rpc: async (name, args) => {
    if (name === 'team_compo_get') return { data: lineup, error: null };
    if (name === 'team_compo_candidates') return { data: candidates, error: null };
    if (name === 'team_compo_save') {
      saved.push(args);
      if (saveError) return { data: null, error: saveError };
      lineup = { ...lineup, version: lineup.version + 1, players: args.p_players.map((e, i) => e.user_id
        ? { id: `p${i}`, user_id: e.user_id, is_guest: false, ...candidates.find(c => c.id === e.user_id), initials: '', is_me: false }
        : e.id ? lineup.players.find(p => p.id === e.id) : { id: `g${i}`, user_id: null, is_guest: true, prenom: e.prenom, nom: e.nom, sex: e.sex, initials: '', classement: null, is_captain: false, is_me: false }) };
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
const Panel = load(resolve(src, 'components/teamMatches/TeamLineupPanel.tsx')).default;
const wait = () => act(async () => { await new Promise(r => setTimeout(r, 0)); });
const click = async target => act(async () => target.dispatchEvent(new window.MouseEvent('click', { bubbles: true })));
const button = text => [...document.querySelectorAll('button')].find(b => b.textContent.includes(text) || b.getAttribute('aria-label') === text);
const box = name => [...document.querySelectorAll('input[type=checkbox]')].find(b => b.getAttribute('aria-label').startsWith(name));
const setValue = async (el, value) => act(async () => {
  const proto = el.tagName === 'SELECT' ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
  el.dispatchEvent(new window.Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
});
async function render() {
  const root = createRoot(document.getElementById('root'));
  await act(async () => root.render(h(Panel, { clubId: 'club', rencontreId: 'r' })));
  await wait(); await wait();
  return () => act(async () => root.unmount());
}

test('BO : coche des membres, invité sans compte, mêmes règles et un seul enregistrement', async () => {
  lineup = { ...base, players: [], version: 0, can_edit: true };
  saved = []; saveError = null;
  const unmount = await render();
  try {
    assert.match(document.body.textContent, /3 simples, 1 double · Rencontre messieurs/);
    // Filtre Hommes présélectionné ; pas de pastille « NC » pour un classement non renseigné.
    assert.equal(document.querySelector('[role=radio][aria-checked=true]').textContent, 'Hommes 3');
    assert.equal(box('Claire Dupont'), undefined);
    assert.match(box('Hugo Daran').closest('tr').textContent, /^Hugo Daran · classement non renseigné—?H$/);
    assert.match(document.querySelector('[role=status]').textContent, /Il faut au moins 3 joueurs pour les 3 simples/);

    await click(box('Romain Escaffre'));
    await click(box('Julien Marty'));
    assert.match(document.body.textContent, /Non enregistrée/);

    // Invité : sexe prérempli selon la rencontre ; un nom de membre renvoie vers la case à cocher.
    const [name] = document.querySelectorAll('input[placeholder="Prénom et nom"]');
    assert.equal(document.querySelector('select').value, 'male');
    await setValue(name, 'julien marty'); await click(button('Ajouter'));
    assert.match(document.querySelector('[role=alert]').textContent, /Julien Marty est membre du club : cochez-le dans la liste\./);
    await setValue(name, 'Paul Girard'); await click(button('Ajouter'));
    await setValue(name, 'PAUL girard'); await click(button('Ajouter'));
    assert.match(document.querySelector('[role=alert]').textContent, /Paul Girard est déjà dans la compo\./);
    assert.deepEqual([...document.querySelectorAll('ul[aria-label] li')].map(li => li.querySelector('.font-medium').textContent), ['Romain Escaffre', 'Paul Girard', 'Julien Marty'].sort((a, b) => a.split(' ')[1].localeCompare(b.split(' ')[1])));
    assert.match(document.querySelector('[role=status]').textContent, /3 joueurs retenus · il en faut au moins 3 pour 3 simples/);

    // Une femme cochée dans une rencontre messieurs : mention, rien n'est bloqué.
    await click(button('Tous'));
    await click(box('Claire Dupont'));
    assert.match(box('Claire Dupont').getAttribute('aria-label'), /Femme · Rencontre messieurs/);
    await click(button('Retirer Claire Dupont'));

    await click(button('Enregistrer la compo')); await wait();
    assert.deepEqual(saved[0].p_players, [{ user_id: 'u1' }, { user_id: 'u2' }, { prenom: 'Paul', nom: 'Girard', sex: 'male' }]);
    assert.equal(saved[0].p_version, 0);
    assert.match(document.body.textContent, /Compo enregistrée/);
    assert.doesNotMatch(document.body.textContent, /Non enregistrée/);
  } finally { await unmount(); }
});

test('BO : version périmée avec « Recharger », annulation, joueur sorti du club, garde-fou user_id', async () => {
  lineup = { ...base, version: 2, can_edit: true, players: [
    { id: 'p1', user_id: 'u1', is_guest: false, prenom: 'Romain', nom: 'Escaffre', initials: 'RE', classement: '30', is_captain: true, is_me: false, sex: 'male' },
    { id: 'p9', user_id: 'u9', is_guest: false, prenom: 'Léa', nom: 'Partie', initials: 'LP', classement: null, is_captain: false, is_me: false, sex: 'male' },
  ] };
  saved = []; saveError = { message: 'COMPO_STALE', details: 'Romain', code: 'PT409' };
  const unmount = await render();
  try {
    assert.match(document.body.textContent, /N’est plus membre du club/);
    await click(button('Enregistrer la compo')); await wait();
    assert.equal(saved.length, 0, 'rien n’est envoyé');
    assert.match(document.querySelector('[role=alert]').textContent, /Léa Partie ne fait plus partie du club\. Retirez-le de la compo\./);
    await click(button('Retirer Léa Partie'));
    await click(button('Enregistrer la compo')); await wait();
    assert.match(document.querySelector('[role=alert]').textContent, /Romain vient de modifier la compo/);
    assert.ok(button('Recharger'));
    await click(button('Annuler les changements'));
    assert.match(document.body.textContent, /Léa Partie/);
  } finally { await unmount(); }
  // Membre reçu sans user_id : l'enregistrement est refusé au lieu d'effacer la compo.
  lineup = { ...lineup, players: [{ ...lineup.players[0], user_id: null }] };
  saved = []; saveError = null;
  const again = await render();
  try {
    await click(button('Enregistrer la compo')); await wait();
    assert.equal(saved.length, 0);
    assert.match(document.querySelector('[role=alert]').textContent, /La compo ne peut pas être modifiée pour l’instant/);
  } finally { await again(); }
});

test('BO : lecture seule sans droit de compo', async () => {
  lineup = { ...base, version: 1, can_edit: false, players: [
    { id: 'p1', user_id: null, is_guest: false, prenom: 'Romain', nom: 'Escaffre', initials: 'RE', classement: '30', is_captain: true, is_me: false, sex: null },
  ] };
  const unmount = await render();
  try {
    assert.match(document.body.textContent, /Seuls le capitaine de l’équipe et les administrateurs peuvent modifier la compo\./);
    assert.match(document.body.textContent, /Romain Escaffre · Capitaine30/);
    assert.equal(button('Enregistrer la compo'), undefined);
  } finally { await unmount(); }
});
