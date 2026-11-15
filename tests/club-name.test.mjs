// Onboarding Ten'Up d'abord (brief SAAS_11 §5.4, §5.5, décision 5) — nom formaté (`formatClubName`
// de `shared/formatClubName.ts`, réexporté), nom court et adresse courte, sur 20 noms Ten'Up réels relevés dans les fixtures (`tests/fixtures/`).
import test from 'node:test';
import assert from 'node:assert/strict';
import { formatClubName, shortNameFor, shortSlugCandidates } from '../shared/clubName.mjs';

// [nom Ten'Up, nom formaté, nom court proposé]
const REAL = [
  ['MOISSAC TENNIS CLUB', 'Moissac Tennis Club', 'Moissac TC'],
  ['BLAGNAC TENNIS CLUB', 'Blagnac Tennis Club', 'Blagnac TC'],
  ['ERMONT A.C.T.', 'Ermont A.C.T.', 'Ermont ACT'],
  ['CASTELSARRASIN TENNIS CLUB', 'Castelsarrasin Tennis Club', 'Castelsarras'],
  ['CASTELSARRASIN TENNIS CLUB OLYMPIQUE', 'Castelsarrasin Tennis Club Olympique', 'Castelsarras'],
  ['ASSOCIATION TENNIS MONTAUBAN A.T.M', 'Association Tennis Montauban A.T.M', 'Montauban'],
  ['LACROIX FALGARDE T.C', 'Lacroix Falgarde T.C', 'Lacroix'],
  ['SAINT CLAR T.C SAINT CLARAIS', 'Saint Clar T.C Saint Clarais', 'St Clar'],
  ['PORTET ETOILE PORTESIENNE TC', 'Portet Etoile Portesienne TC', 'Portet'],
  ['LAUNAGUET RACING TENNIS CLUB', 'Launaguet Racing Tennis Club', 'Launaguet'],
  ["VALENCE D'AGEN TENNIS CLUB", "Valence d'Agen Tennis Club", 'Valence'],
  ['TENNIS CLUB DU LAC', 'Tennis Club du Lac', 'TC du Lac'],
  ['TENNIS CLUB GRISOLLES', 'Tennis Club Grisolles', 'TC Grisolles'],
  ['TENNIS CLUB AUCAMVILLE', 'Tennis Club Aucamville', 'Aucamville'],
  ['GAILLAC TENNIS CLUB', 'Gaillac Tennis Club', 'Gaillac TC'],
  ['MURET TENNIS CLUB', 'Muret Tennis Club', 'Muret TC'],
  ['SAINT GIRONS TENNIS CLUB', 'Saint Girons Tennis Club', 'St Girons TC'],
  ['SAINT ETIENNE TENNIS CLUB', 'Saint Etienne Tennis Club', 'St Etienne'],
  ['BEAUMONT DE LOMAGNE TENNIS CLUB', 'Beaumont de Lomagne Tennis Club', 'Beaumont'],
  ['AVENIR MONTBETONNAIS TENNIS', 'Avenir Montbetonnais Tennis', 'Avenir'],
];

test('clubName: 20 real Ten\'Up names, formatted and shortened to 12 characters', () => {
  assert.equal(REAL.length, 20);
  for (const [raw, formatted, short] of REAL) {
    assert.equal(formatClubName(raw), formatted, raw);
    assert.equal(shortNameFor(raw), short, raw);
    assert.ok(short.length <= 12, short);
  }
});

test('clubName: formatting rules', () => {
  // Seuls les noms entièrement en capitales sont touchés.
  assert.equal(formatClubName('Tennis Club de Saint-Aubin'), 'Tennis Club de Saint-Aubin');
  assert.equal(formatClubName('  CAC  TENNIS '), 'CAC Tennis');
  assert.equal(formatClubName('LE TENNIS CLUB DE L’ISLE-JOURDAIN'), 'Le Tennis Club de l’Isle-Jourdain');
  assert.equal(formatClubName('SAINT-JEAN-DE-LUZ TENNIS'), 'Saint-Jean-de-Luz Tennis');
  assert.equal(formatClubName('ÉTOILE SPORTIVE DES CÉVENNES 2'), 'Étoile Sportive des Cévennes 2');
  assert.equal(formatClubName('AS TCM PARIS XV'), 'AS TCM Paris XV');
  assert.equal(formatClubName('TENNIS SUR MER ET LA PLAGE'), 'Tennis sur Mer et la Plage');
  assert.equal(formatClubName(null), '');
});

test('clubName: short name forms', () => {
  assert.equal(shortNameFor('TC MOISSAC'), 'TC Moissac', 'a name that fits is kept');
  assert.equal(shortNameFor('Moissac Tennis Club'), 'Moissac TC', 'already formatted');
  assert.equal(shortNameFor('ALBI TENNIS CLUB MUNICIPAL'), 'Albi TCM');
  assert.equal(shortNameFor('ASSOCIATION SPORTIVE DE RODEZ'), 'AS de Rodez');
  assert.equal(shortNameFor('UNION SPORTIVE COLOMIERS'), 'US Colomiers');
  assert.equal(shortNameFor('STADE NIORT TENNIS'), 'Stade Niort');
  assert.equal(shortNameFor('STADE TOULOUSAIN TENNIS'), 'Toulousain', 'too long with its form: first significant word');
  assert.equal(shortNameFor('ÉTOILE SPORTIVE DES CÉVENNES 2'), 'Étoile');
  assert.equal(shortNameFor("TENNIS CLUB DE L'ISLE-JOURDAIN"), 'Isle-Jourdai', 'cut at 12');
});

test('clubName: short address from the short name, then -town, -2, -3', () => {
  assert.deepEqual(shortSlugCandidates('Moissac TC', 'MOISSAC'), ['moissac-tc', 'moissac-tc-2', 'moissac-tc-3']);
  assert.deepEqual(shortSlugCandidates('TC du Lac', 'Moissac'), ['tc-lac', 'tc-lac-moissac', 'tc-lac-2', 'tc-lac-3']);
  assert.deepEqual(shortSlugCandidates('St Girons TC', 'Saint-Girons'), ['st-girons-tc', 'st-girons-tc-saint-girons', 'st-girons-tc-2', 'st-girons-tc-3']);
  // Trop court ou réservé : seules les variantes valides restent.
  assert.deepEqual(shortSlugCandidates('TC', 'Albi'), ['tc-albi', 'tc-2', 'tc-3']);
  assert.deepEqual(shortSlugCandidates('App', ''), [], 'app-* is reserved');
});
