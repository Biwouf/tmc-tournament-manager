import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir, rm, readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { extractTenupPoolRound } from '../services/tenup-worker/parse-pool.mjs';
test('a unique configured club team is suggested, confirmation stays explicit and manual creation remains available', async () => {
  const dir = new URL('../node_modules/.tmp/pool-client/', import.meta.url);
  await mkdir(dir, { recursive: true });
  const out = new URL('ui.mjs', dir);
  await build({
    entryPoints: [
      new URL(
        '../src/components/teamMatches/CreateEquipeForm.tsx',
        import.meta.url
      ).pathname,
    ],
    outfile: out.pathname,
    bundle: true,
    packages: 'external',
    platform: 'node',
    format: 'esm',
    jsx: 'automatic',
    plugins: [
      {
        name: 'mock',
        setup(b) {
          b.onResolve({ filter: /lib\/supabase$/ }, () => ({
            path: 'api',
            namespace: 'mock',
          }));
          b.onResolve({ filter: /contexts\/ClubContext$/ }, () => ({
            path: 'club',
            namespace: 'mock',
          }));
          b.onResolve({ filter: /hooks\/useClubConfig$/ }, () => ({
            path: 'config',
            namespace: 'mock',
          }));
          b.onLoad({ filter: /.*/, namespace: 'mock' }, (a) => ({
            contents:
              a.path === 'config'
                ? 'export const useClubConfig=()=>({config:{brand:{name:"Castelsarrasin Athletic Club",city:"Castelsarrasin"}},loading:false})'
                : a.path === 'api'
                  ? 'export const supabase=globalThis.__teamApi'
                  : 'export const useClub=()=>({clubId:"club",club:{name:"CAC"}})',
          }));
        },
      },
    ],
  });
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' });
  const keys = [
    'window',
    'document',
    'navigator',
    'HTMLElement',
    'IS_REACT_ACT_ENVIRONMENT',
    '__teamApi',
  ];
  const originals = new Map(
    keys.map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)])
  );
  for (const k of keys.slice(0, -1))
    Object.defineProperty(globalThis, k, {
      configurable: true,
      writable: true,
      value: k === 'IS_REACT_ACT_ENVIRONMENT' ? true : dom.window[k],
    });
  const url =
    'https://tenup.fft.fr/championnat/82678463?division=144146&phase=233672&poule=513524';
  const { round, ...p } = extractTenupPoolRound(
    new JSDOM(
      await readFile(
        new URL('./fixtures/tenup-pool.html', import.meta.url),
        'utf8'
      )
    ).window.document
  );
  const pool = { ...p, rounds: [round] };
  const writes = [];
  let failed = false,
    created = 0,
    resolvePending,
    pending = null;
  globalThis.__teamApi = {
    functions: {
      invoke: async () => ({
        data: { id: 'snapshot', url, ...pool },
        error: null,
      }),
    },
    rpc: async (name, args) => {
      writes.push({ name, args });
      if (pending) await pending;
      return {
        data: 'team',
        error: failed ? { message: 'Erreur transaction' } : null,
      };
    },
  };
  const Form = (await import(out.href)).default;
  const root = createRoot(document.getElementById('root'));
  const props = {
    competitions: [
      {
        id: 'competition',
        nom: 'Challenge féminin',
        genre: 'femmes',
        categorie: 'seniors',
        tenup_url: url,
      },
    ],
    existingEquipes: [],
    defaultCompetitionId: 'competition',
    onClose: () => {},
    onCreated: () => created++,
  };
  const render = async (extra = {}) =>
    act(async () =>
      root.render(React.createElement(Form, { ...props, ...extra }))
    );
  const button = (text) =>
    [...document.querySelectorAll('button')].find(
      (b) => b.textContent === text
    );
  const click = async (el) => {
    assert.ok(el);
    await act(async () => el.click());
  };
  const change = async (id, value) => {
    const el = document.getElementById(id);
    await act(async () =>
      el[Object.keys(el).find((k) => k.startsWith('__reactProps'))].onChange({
        target: { value },
      })
    );
  };
  try {
    await render();
    await click(button('Lire les équipes et le calendrier'));
    assert.equal(writes.length, 0);
    assert.equal(document.getElementById('team-division').value, 'GROUPE B');
    assert.equal(
      document.getElementById('team-tenup-choice').value,
      '2474059',
      'the configured city suggests the unique club team despite different club labels'
    );
    await change('team-tenup-choice', '2474059');
    assert.match(document.body.textContent, /AUCAMVILLE/);
    assert.equal(button('Créer').disabled, true);
    await click(document.querySelector('input[type=checkbox]'));
    failed = true;
    await click(button('Créer'));
    assert.equal(created, 0);
    assert.match(
      document.querySelector('[role=alert]').textContent,
      /Erreur transaction/
    );
    failed = false;
    pending = new Promise((r) => (resolvePending = r));
    await click(button('Créer'));
    assert.equal(button('Chargement…').disabled, true);
    await act(async () => resolvePending());
    pending = null;
    assert.equal(created, 1);
    assert.deepEqual(writes.at(-1), {
      name: 'team_equipe_create',
      args: {
        p_club: 'club',
        p_competition: 'competition',
        p_numero: 1,
        p_division: 'GROUPE B',
        p_journees: 1,
        p_preview: 'snapshot',
        p_team_id: '2474059',
      },
    });
    await change('team-tenup-url', url);
    pool.teams.find((t) => t.id === '2476260').name =
      'CASTELSARRASIN TENNIS CLUB 2';
    await click(button('Lire les équipes et le calendrier'));
    assert.equal(
      document.getElementById('team-tenup-choice').value,
      '',
      'multiple club teams require a choice'
    );
    await change('team-tenup-choice', '2474059');
    await render({
      existingEquipes: [
        { competition_id: 'competition', numero: 1, tenup_team_id: '2474059' },
      ],
    });
    assert.equal(button('Créer').disabled, true);
    await change('team-tenup-choice', '2476260');
    assert.equal(document.querySelector('input[type=checkbox]').checked, false);
    await click(button('Passer à la saisie manuelle'));
    await change('team-division', 'Groupe personnalisé');
    await change('team-rounds', '3');
    await change('team-number', '2');
    await click(button('Créer'));
    assert.equal(writes.at(-1).args.p_preview, null);
    assert.equal(writes.at(-1).args.p_division, 'Groupe personnalisé');
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    for (const [k, v] of originals) {
      if (v) Object.defineProperty(globalThis, k, v);
      else delete globalThis[k];
    }
    await rm(dir, { recursive: true, force: true });
  }
});
