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
let lineup; let saved = []; let saveError = null; let candidatesError = null;
const mocks = {
  '/lib/supabase.ts': { supabase: { rpc: async (name, args) => {
    if (name === 'team_compo_get') return { data: lineup, error: null };
    if (name === 'team_compo_candidates') return candidatesError ? { data: null, error: candidatesError } : { data: candidates, error: null };
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
    assert.deepEqual([...document.querySelectorAll('a')].map(a => a.textContent), ['Se connecter', 'Créer un compte']);
    // « Vous reviendrez ici » ne décrit que la connexion (l'inscription ne ramène pas encore ici).
    const login = [...document.querySelectorAll('a')][0];
    assert.equal(document.getElementById(login.getAttribute('aria-describedby')).textContent, 'Vous reviendrez ici juste après.');
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
    assert.match(document.querySelector('section').textContent, /2 joueurs/);
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
    // Classement non renseigné : aucune pastille (NC est un vrai classement FFT).
    await click(button('Tous'));
    assert.equal(row('Hugo Daran').textContent, 'Hugo DaranClassement non renseigné');
    await click(button('Hommes'));
    assert.match(row('Romain Escaffre').getAttribute('aria-label'), /Capitaine/);
    assert.match(document.querySelector('[role=status]').textContent, /Il faut au moins 3 joueurs pour les 3 simples/);
    // Mention discrète du genre de la rencontre.
    assert.match(document.querySelector('dialog').textContent, /Tout le club · 3 simples, 1 double · Rencontre messieurs/);

    await click(row('Romain Escaffre'));
    await click(row('Julien Marty'));
    assert.equal(row('Julien Marty').getAttribute('aria-checked'), 'true');
    // Un joueur coché remonte dans les retenus ; l'en-tête suit le pied de la feuille.
    const groups = () => [...document.querySelectorAll('dialog ul')].map(ul => [...ul.querySelectorAll('[role=checkbox]')].map(r => r.getAttribute('aria-label').split(',')[0]));
    assert.deepEqual(groups()[0], ['Romain Escaffre', 'Julien Marty']);
    assert.equal([...document.querySelectorAll('h3')].find(x => x.textContent.startsWith('Retenus')).textContent, 'Retenus · 2');
    // Décoché, il reste à sa place jusqu'à la fermeture.
    await click(row('Julien Marty'));
    assert.deepEqual(groups()[0], ['Romain Escaffre', 'Julien Marty']);
    assert.equal([...document.querySelectorAll('h3')].find(x => x.textContent.startsWith('Retenus')).textContent, 'Retenus · 1');
    await click(row('Julien Marty'));
    // Une femme cochée dans une rencontre messieurs : mention, rien n'est bloqué.
    await click(button('Tous'));
    await click(row('Claire Dupont'));
    assert.match(row('Claire Dupont').getAttribute('aria-label'), /Femme · Rencontre messieurs/);
    await click(row('Claire Dupont'));
    await click(button('Hommes'));

    // Une recherche porte sur tout le club : la puce « Tous » le montre.
    await type('Paul Girard');
    assert.equal(document.querySelector('[role=radiogroup] [aria-checked=true]').textContent, 'Tous 4');
    // Sexe de l'invité prérempli selon la rencontre (messieurs → Homme).
    assert.equal([...document.querySelectorAll('[role=radio][aria-checked=true]')].at(-1).textContent, 'Homme');
    assert.match(document.body.textContent, /Aucun membre du club ne s’appelle « Paul Girard »/);
    assert.match(document.body.textContent, /Ajouter Paul Girard, sans compte/);
    await click([...document.querySelectorAll('[role=radio]')].find(b => b.textContent === 'Homme'));
    await click(button('Ajouter'));
    assert.equal(row('Paul Girard').getAttribute('aria-checked'), 'true');
    assert.match(document.querySelector('[role=status]').textContent, /3 joueurs retenus · il en faut au moins 3 pour 3 simples/);
    assert.equal([...document.querySelectorAll('h3')].find(x => x.textContent.startsWith('Retenus')).textContent, 'Retenus · 3');

    // Même invité une seconde fois (casse et accents ignorés) : plus proposé, sa ligne est là.
    await type('paul GIRÂRD');
    assert.equal(button('Ajouter'), undefined);
    assert.equal(row('Paul Girard').getAttribute('aria-checked'), 'true');

    // Une recherche partielle liste les membres, puis propose l'ajout sans compte en dernier.
    await type('Mar');
    assert.ok(row('Julien Marty'));
    assert.ok(button('Ajouter « Mar » sans compte'));
    await type('');

    await click(button('Enregistrer la compo')); await wait();
    assert.deepEqual(saved[0].p_players, [{ user_id: 'u1' }, { user_id: 'u2' }, { prenom: 'Paul', nom: 'Girard', sex: 'male' }]);
    // Le faux serveur renvoie une compo vide : le bouton d'ouverture est encore « Choisir les joueurs ».
    assert.equal(document.activeElement.textContent, 'Choisir les joueurs', 'le focus revient au bouton d’ouverture');
    assert.equal(saved[0].p_version, 0);
    assert.match(document.body.textContent, /Compo enregistrée/);
    assert.equal(document.querySelector('dialog'), null);
  } finally { await unmount(); }
});

test('Capitaine : échec du chargement des membres, sans faux compteurs', async () => {
  lineup = { ...base, players: [], version: 0, can_edit: true };
  candidatesError = { message: 'boom' };
  const unmount = await render();
  try {
    await click(button('Choisir les joueurs')); await wait();
    assert.match(document.querySelector('[role=alert]').textContent, /Impossible de charger les membres du club/);
    assert.equal(document.querySelector('[role=radiogroup]'), null, 'pas de puces « Tous 0 »');
    assert.match(button('Réessayer').className, /min-h-11/);
    assert.equal(document.querySelector('dialog [role=status]'), null, 'pas d’indication de nombre sans membres');
  } finally { candidatesError = null; await unmount(); }
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
    await click(document.querySelector('[aria-label=Fermer]')); await wait();
    assert.match(document.body.textContent, /Abandonner vos changements \?/);
    assert.equal(document.activeElement.textContent, 'Continuer à modifier', 'la confirmation reçoit le focus');
    await click(button('Continuer à modifier'));
    assert.ok(row('Paul Girard'));
    await click(document.querySelector('[aria-label=Fermer]'));
    await click(button('Abandonner')); await wait();
    assert.equal(document.querySelector('dialog'), null);
    assert.equal(document.activeElement.textContent, 'Modifier', 'Échap / Abandonner : focus sur « Modifier »');
    // Un invité gardé est renvoyé par son id.
    saveError = null; saved = [];
    await click(button('Modifier')); await wait();
    await click(button('Enregistrer la compo')); await wait();
    assert.deepEqual(saved[0].p_players, [{ user_id: 'u1' }, { id: 'g1' }]);
  } finally { await unmount(); }
});

test('Garde-fou : un membre reçu sans user_id bloque l’édition au lieu d’effacer la compo', async () => {
  lineup = { ...base, version: 2, can_edit: true, players: [
    { id: 'p1', user_id: null, is_guest: false, prenom: 'Romain', nom: 'Escaffre', initials: 'RE', classement: '30', is_captain: true, is_me: false, sex: 'male' },
  ] };
  saved = []; saveError = null;
  const unmount = await render();
  try {
    await click(button('Modifier')); await wait();
    assert.equal(document.querySelector('dialog'), null, 'la feuille ne s’ouvre pas');
    assert.match(document.querySelector('[role=alert]').textContent, /La compo ne peut pas être modifiée pour l’instant/);
    assert.equal(saved.length, 0);
  } finally { await unmount(); }
});

test('Joueur sorti du club : nommé, rien n’est envoyé', async () => {
  lineup = { ...base, version: 2, can_edit: true, players: [
    { id: 'p9', user_id: 'u9', is_guest: false, prenom: 'Léa', nom: 'Partie', initials: 'LP', classement: null, is_captain: false, is_me: false, sex: 'male' },
  ] };
  saved = []; saveError = null;
  const unmount = await render();
  try {
    await click(button('Modifier')); await wait();
    assert.match(row('Léa Partie').getAttribute('aria-label'), /N’est plus membre du club/);
    await click(button('Enregistrer la compo')); await wait();
    assert.equal(saved.length, 0);
    assert.match(document.querySelector('dialog [role=alert]').textContent, /Léa Partie ne fait plus partie du club\. Retirez-le de la compo\./);
  } finally { await unmount(); }
});

test('Mention de genre : dans la fiche (si le sexe est reçu) et avec « Capitaine » dans la feuille', async () => {
  lineup = { ...base, genre: 'femmes', version: 1, can_edit: true, players: [
    { id: 'p1', user_id: 'u1', is_guest: false, prenom: 'Romain', nom: 'Escaffre', initials: 'RE', classement: '30', is_captain: true, is_me: false, sex: 'male' },
    { id: 'p3', user_id: 'u3', is_guest: false, prenom: 'Claire', nom: 'Dupont', initials: 'CD', classement: null, is_captain: false, is_me: false, sex: 'female' },
  ] };
  const unmount = await render();
  try {
    const lines = [...document.querySelectorAll('section li')].map(li => li.getAttribute('aria-label'));
    assert.deepEqual(lines, ['Romain Escaffre, Capitaine, Homme · Rencontre dames, 30', 'Claire Dupont']);
    assert.match(document.querySelector('section').textContent, /Homme · Rencontre dames/);
    await click(button('Modifier')); await wait();
    assert.equal(row('Romain Escaffre').getAttribute('aria-label'), 'Romain Escaffre, Capitaine · Homme · Rencontre dames');
  } finally { await unmount(); }
  // Lecteur simple, compétition non mixte : le sexe n'est pas reçu, aucune mention.
  lineup = { ...lineup, can_edit: false, players: lineup.players.map(p => ({ ...p, user_id: null, sex: null })) };
  const again = await render();
  try {
    assert.doesNotMatch(document.querySelector('section').textContent, /Rencontre dames/);
  } finally { await again(); }
});
