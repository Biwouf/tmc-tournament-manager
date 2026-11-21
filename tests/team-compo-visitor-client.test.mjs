import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { JSDOM } from 'jsdom';
import { freshnessLabel, previewNames, updatedLine } from '../shared/teamCompoCopy.mjs';
const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' });
globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; };
const req = createRequire(new URL('../pwa/package.json', import.meta.url));
const { createElement: h, act } = req('react'); const { createRoot } = req('react-dom/client');
const { QueryClient, QueryClientProvider } = req('@tanstack/react-query');
const { MemoryRouter, Routes, Route, useLocation } = req('react-router-dom');
const src = resolve(new URL('../pwa/src', import.meta.url).pathname);

let lineup; let signIns = [];
const mocks = {
  '/lib/supabase.ts': { supabase: {
    rpc: async name => ({ data: name === 'team_compo_get' ? lineup : [], error: null }),
    auth: { signInWithPassword: async creds => { signIns.push(creds); return { error: null }; } },
  } },
  '/contexts/ClubContext.tsx': { useClub: () => ({ club: { name: 'CAC Tennis' }, clubId: 'club' }) },
  '/hooks/useClubConfig.ts': { useClubConfig: () => ({ config: { brand: {} } }) },
};
const modules = new Map();
function load(file) {
  for (const [suffix, value] of Object.entries(mocks)) if (file.endsWith(suffix)) return value;
  if (file.endsWith('.css')) return {};
  if (modules.has(file)) return modules.get(file).exports;
  const module = { exports: {} }; modules.set(file, module);
  const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const require = name => { if (!name.startsWith('.')) return req(name); const path = resolve(dirname(file), name); return load([path, `${path}.ts`, `${path}.tsx`].find(existsSync)); };
  vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename: file })(require, module, module.exports);
  return module.exports;
}
const wait = () => act(async () => { await new Promise(r => setTimeout(r, 0)); });
const click = async target => act(async () => target.dispatchEvent(new window.MouseEvent('click', { bubbles: true })));
const button = text => [...document.querySelectorAll('button')].find(b => b.textContent.includes(text));

// Affiche le chemin et le state courants, pour vérifier où mène la navigation.
let seen = null;
function Probe() { const l = useLocation(); seen = { path: l.pathname + l.search, state: l.state }; return null; }
async function mount(element, { path = '/matches-equipes/r', state, route = '/matches-equipes/:id' } = {}) {
  const root = createRoot(document.getElementById('root'));
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: 0, retry: false } } });
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [{ pathname: path.split('?')[0], search: path.includes('?') ? `?${path.split('?')[1]}` : '', state }] },
    h(QueryClientProvider, { client }, h(Routes, null,
      h(Route, { path: route, element: h('div', null, element, h(Probe)) }),
      h(Route, { path: '*', element: h(Probe) }))))));
  await wait();
  return () => act(async () => root.unmount());
}

const P = (n, prenom, nom, o = {}) => ({ id: `p${n}`, user_id: null, is_guest: false, prenom, nom, initials: prenom[0] + nom[0], classement: null, is_captain: false, is_me: false, sex: null, ...o });
const base = { captains: [{ prenom: 'Claire', nom: 'Dupuy' }], version: 3, can_edit: false, min_players: 4, simples: 4, doubles: 2, format: '4S2D',
  updated_at: '2026-11-20T17:42:00Z', updated_by: { prenom: 'Claire', nom: 'Dupuy', role: 'capitaine' } };

test('Textes : fraîcheur en heure de Paris et résumé de carte', () => {
  const now = new Date('2026-11-21T15:00:00Z');
  assert.equal(freshnessLabel('2026-11-21T14:58:00Z', now), 'il y a 2 min');
  assert.equal(freshnessLabel('2026-11-21T12:50:00Z', now), 'il y a 2 h');
  assert.equal(freshnessLabel('2026-11-20T17:42:00Z', now), 'hier à 18h42');
  assert.equal(freshnessLabel('2026-11-12T08:00:00Z', now), 'le 12 nov. à 9h');
  assert.equal(updatedLine('2026-11-21T12:50:00Z', { prenom: 'Romain', nom: 'Escaffre', role: 'capitaine' }, now), 'Mise à jour il y a 2 h par Romain Escaffre, capitaine');
  assert.equal(previewNames(['Claire', 'Marie', 'Sophie'], 4), 'Claire, Marie, Sophie +1');
  assert.equal(previewNames(['Anaïs', 'Paula', 'Léa'], 3), 'Anaïs, Paula, Léa');
});

test('Retour après inscription : seuls les cours et une fiche rencontre sont acceptés', () => {
  const { signupReturnTo, isRencontrePath } = load(resolve(src, 'lib/signup.ts'));
  assert.equal(signupReturnTo('/matches-equipes/1b2c-3d'), '/matches-equipes/1b2c-3d');
  for (const bad of ['//evil.test', 'https://evil.test', '/matches-equipes/a/b', '/matches-equipes/', '/matches-equipes/x?y=//evil'])
    assert.equal(signupReturnTo(bad), '/actu', bad);
  assert.equal(isRencontrePath('/matches-equipes/r'), true);
});

test('Carte de la liste : pastilles, « Vous jouez », compo à venir, cadenas, libellé accessible', async () => {
  const Summary = load(resolve(src, 'components/matchesEquipes/TeamCompoSummary.tsx')).default;
  const { compoCardLabel } = load(resolve(src, 'lib/teamLineup.ts'));
  const preview = [{ initials: 'CD', prenom: 'Claire', is_guest: false, is_me: false }, { initials: 'ML', prenom: 'Marie', is_guest: false, is_me: false }, { initials: 'PG', prenom: 'Paul', is_guest: true, is_me: false }];
  const cases = [
    [{ rencontre_id: 'r', count: 4, is_me: false, preview, updated_at: '' }, /CDMLPG\+1Claire, Marie, Paul \+1/, 'compo de 4 joueurs'],
    [{ rencontre_id: 'r', count: 5, is_me: true, preview: [{ ...preview[0], is_me: true }], updated_at: '' }, /Vous jouez5 joueurs/, 'Vous jouez, compo de 5 joueurs'],
    [null, /Compo à venir/, 'compo à venir'],
    ['locked', /Compo réservée aux connectés/, 'compo réservée aux personnes connectées'],
  ];
  for (const [compo, text, label] of cases) {
    const unmount = await mount(h(Summary, { compo }));
    try {
      assert.match(document.body.textContent, text);
      assert.equal(document.querySelector('[aria-hidden]').getAttribute('aria-hidden'), 'true', 'décoratif : la carte porte le libellé');
      assert.equal(compoCardLabel(compo), label);
    } finally { await unmount(); }
  }
});

test('Fiche : carte « Vous jouez », fraîcheur, 6 joueurs puis feuille groupée en mixte', async () => {
  const Section = load(resolve(src, 'components/teamMatches/TeamLineupSection.tsx')).default;
  lineup = { ...base, genre: 'mixte', players: [
    P(1, 'Claire', 'Dupuy', { sex: 'female', is_captain: true, classement: '15/2' }), P(2, 'Inès', 'Garcia', { sex: 'female', is_guest: true }),
    P(3, 'Marie', 'Lacoste', { sex: 'female' }), P(4, 'Sophie', 'Roux', { sex: 'female' }),
    P(5, 'Thomas', 'Delmas', { sex: 'male', is_me: true }), P(6, 'Nicolas', 'Fabre', { sex: 'male' }), P(7, 'Julien', 'Marty', { sex: 'male' }),
    P(8, 'Hugo', 'Daran', { sex: 'male' }), P(9, 'Paul', 'Rey', { sex: 'male' }), P(10, 'Alex', 'Vidal'),
  ] };
  const props = { clubId: 'club', rencontreId: 'r', signedIn: true, started: false, when: 'Dimanche 22 novembre · 9h · Au club', contextLabel: 'CAC – TC Grisolles 1, dimanche 22 novembre' };
  const unmount = await mount(h(Section, props));
  try {
    assert.match(document.body.textContent, /Vous jouez cette rencontreDimanche 22 novembre · 9h · Au club/);
    assert.match(document.body.textContent, /Mise à jour (hier à 18h42|le 20 nov\. à 18h42|il y a \d+ h) par Claire Dupuy, capitaine/);
    // Liste tronquée à 6, sans intertitres (leurs compteurs ne diraient pas ce qu'on voit).
    const section = document.querySelector('section');
    assert.equal(section.querySelectorAll('li').length, 6);
    assert.equal(section.querySelector('h3'), null);
    await click(button('Voir les 10 joueurs'));
    const sheet = document.querySelector('dialog');
    assert.equal(sheet.getAttribute('aria-label'), 'Compo · 10 joueurs');
    assert.deepEqual([...sheet.querySelectorAll('h3')].map(x => x.textContent), ['Dames · 4', 'Messieurs · 5', 'Sexe non précisé · 1']);
    assert.equal(sheet.querySelectorAll('li').length, 10);
  } finally { await unmount(); }
  // Au plus 6 joueurs : tout est dans la fiche, groupé en mixte.
  lineup = { ...lineup, players: lineup.players.slice(0, 5) };
  const again = await mount(h(Section, props));
  try {
    assert.equal(button('Voir les'), undefined);
    assert.deepEqual([...document.querySelectorAll('section h3')].map(x => x.textContent), ['Dames · 4', 'Messieurs · 1']);
  } finally { await again(); }
});

test('Retour après connexion : toast, focus sur « Compo », marque retirée de l’historique', async () => {
  const Section = load(resolve(src, 'components/teamMatches/TeamLineupSection.tsx')).default;
  lineup = { ...base, genre: 'hommes', players: [P(1, 'Romain', 'Escaffre')] };
  const unmount = await mount(h(Section, { clubId: 'club', rencontreId: 'r', signedIn: true, started: false, when: '', contextLabel: '' }), { state: { welcome: 'compo', from: '/matches-equipes' } });
  try {
    await wait();
    assert.match(document.querySelector('[role=status]').textContent, /Vous êtes connecté\. Voici la compo\./);
    assert.equal(document.activeElement.id, 'compo-title');
    assert.deepEqual(seen.state, { from: '/matches-equipes' }, 'pas de toast au rechargement');
  } finally { await unmount(); }
});

test('Visiteur : la connexion garde le contexte et l’inscription le chemin de la rencontre', async () => {
  const Section = load(resolve(src, 'components/teamMatches/TeamLineupSection.tsx')).default;
  const unmount = await mount(h(Section, { clubId: 'club', rencontreId: 'r', signedIn: false, started: false, when: '', contextLabel: 'CAC – TC Grisolles 1, dimanche 22 novembre' }));
  try {
    const [login, signup] = document.querySelectorAll('a');
    assert.equal(signup.getAttribute('href'), '/inscription?returnTo=%2Fmatches-equipes%2Fr');
    assert.equal(signup.getAttribute('aria-describedby'), 'compo-login-return');
    await click(login); await wait();
    assert.equal(seen.path, '/login');
    assert.equal(seen.state.compoContext, 'CAC – TC Grisolles 1, dimanche 22 novembre');
    assert.equal(seen.state.from, '/matches-equipes/r');
  } finally { await unmount(); }
});

test('Connexion : texte de contexte, retour sur la rencontre avec le toast, ?returnTo= au rechargement', async () => {
  const Login = load(resolve(src, 'pages/LoginPage.tsx')).default;
  signIns = [];
  let unmount = await mount(h(Login), { path: '/login', route: '/login', state: { from: '/matches-equipes/r', compoContext: 'CAC – TC Grisolles 1, dimanche 22 novembre' } });
  try {
    assert.match(document.body.textContent, /Connectez-vous pour voir la compo de CAC – TC Grisolles 1, dimanche 22 novembre\. Vous reviendrez ensuite sur la rencontre\./);
    assert.equal([...document.querySelectorAll('a')].find(a => a.textContent.includes('Créer un compte')).getAttribute('href'), '/inscription?returnTo=%2Fmatches-equipes%2Fr');
    const set = (id, value) => act(async () => { const el = document.getElementById(id); el[Object.keys(el).find(k => k.startsWith('__reactProps'))].onChange({ target: { value } }); });
    await set('login-email', 'a@example.com'); await set('login-password', 'secret');
    await act(async () => document.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })));
    await wait();
    assert.equal(signIns.length, 1);
    assert.equal(seen.path, '/matches-equipes/r');
    assert.deepEqual(seen.state, { welcome: 'compo' });
  } finally { await unmount(); }
  // Rechargement : le state est perdu, ?returnTo= garde la rencontre (texte générique).
  unmount = await mount(h(Login), { path: '/login?returnTo=%2Fmatches-equipes%2Fr', route: '/login' });
  try {
    assert.match(document.body.textContent, /Connectez-vous pour voir la compo\. Vous reviendrez ensuite sur la rencontre\./);
  } finally { await unmount(); }
  // Un chemin externe est ignoré.
  unmount = await mount(h(Login), { path: '/login?returnTo=%2F%2Fevil.test', route: '/login' });
  try {
    assert.doesNotMatch(document.body.textContent, /voir la compo/);
  } finally { await unmount(); }
});

test('Fiche : avant la rencontre la compo prime, après son heure la photo des feuilles de match', async () => {
  // Détail de rencontre simulé : aucune ligne, format 3S1D, règle du 3e set connue.
  const detail = date => ({ rencontre: { id: 'r', club_adverse: 'TC GRISOLLES 1', date_heure: date, domicile: true, wo: false, score_club: null, score_adverse: null, confirmed_at: null, revision: 0, photo_urls: [] },
    competition: { nom: 'GAN 35', format: '3S1D', singles_set3_format: 'normal' }, equipe: { numero: 1 }, lines: [], lives: [] });
  let current;
  const real = load(resolve(src, 'lib/teamMatches.ts'));
  Object.assign(mocks, {
    '/lib/teamMatches.ts': { ...real, fetchTeamDetail: async () => current },
    '/hooks/useAuth.ts': { useAuth: () => ({ user: { id: 'u1' }, loading: false }) },
    '/hooks/useCourses.ts': { useCourseContext: () => ({ data: { is_member: true, can_manage: false }, isError: false }) },
    '/hooks/useLiveTopic.ts': { LIVE_SAFETY_POLL: 120000, useLiveTopic: () => false },
    '/hooks/useTeamAction.ts': { useTeamAction: () => ({ busy: false, error: '', clearError() {}, run: async () => null }) },
    '/components/teamMatches/TeamPhotos.tsx': { default: () => null },
  });
  mocks['/lib/supabase.ts'].supabase.rpc = async name => ({ data: name === 'team_compo_get' ? lineup : name === 'team_can_reschedule' ? true : [], error: null });
  lineup = { ...base, genre: 'hommes', can_edit: true, players: [] };
  const Page = load(resolve(src, 'pages/TeamRencontrePage.tsx')).default;
  const order = () => [...document.querySelectorAll('h2')].map(x => x.textContent).filter(t => t === 'Compo' || t === 'Matchs');
  const photo = () => button('Photographier les feuilles de match');

  current = detail(new Date(Date.now() + 3 * 86400000).toISOString());
  let unmount = await mount(h(Page)); await wait();
  try {
    assert.deepEqual(order(), ['Compo', 'Matchs']);
    assert.match(button('Choisir les joueurs').className, /bg-primary/);
    assert.doesNotMatch(photo().className, /bg-primary/, 'la photo reste secondaire avant la rencontre');
  } finally { await unmount(); }

  current = detail(new Date(Date.now() - 3600000).toISOString());
  unmount = await mount(h(Page)); await wait();
  try {
    assert.deepEqual(order(), ['Matchs', 'Compo'], 'la compo passe sous les matchs');
    assert.match(photo().className, /bg-primary/, 'la photo devient l’action principale');
    assert.doesNotMatch(button('Choisir les joueurs').className, /bg-primary/);
    assert.match(document.body.textContent, /Photographiez les feuilles de match des deux équipes, ou ajoutez les matchs à la main\./);
  } finally { await unmount(); }
});
