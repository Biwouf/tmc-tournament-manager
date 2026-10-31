import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTimeline, splitScreens, formatHeure, formatDateLabel } from '../src/components/programmeAnimation/timeline.ts';

const CLUB = 'CASTELSARRASIN TENNIS CLUB';
const m = (heure, cat, a, b) => ({
  heure, type_tournoi: cat,
  j1_prenom: a[0], j1_nom: a[1], j1_classement: a[2], j1_club: a[3],
  j2_prenom: b[0], j2_nom: b[1], j2_classement: b[2], j2_club: b[3],
});

// Affiche du mardi 13 octobre 2026, celle qui a servi à mettre au point la skill
// `tournoi-animation-facebook` (7 matchs, créneau de 18h à 3 matchs, ~20 s en story, ~23 s en carré).
const OCT13 = [
  m('18:00', '4eme serie SD Senior', ['Elodie', 'CHAUBET', '30/5', CLUB], ['Cecile', 'BOUCHARD', '30/2', 'GARONNE TENNIS']),
  m('18:00', 'Nc 30/2 SM Senior', ['Jean', 'LEMOUZY', '30/2', CLUB], ['Michel', 'BLARET', '30/2', 'GARONNE TENNIS']),
  m('18:00', '30/1 SM Senior', ['Jeremy', 'RAIMONDI', '30/1', CLUB], ['Jean luc', 'BARATTO', '30/1', 'SAINT CLAR T.C SAINT CLARAIS']),
  m('19:30', '30/1 SM Senior', ['Nils', 'TOULOUZAN', '30/2', 'CAHORS TENNIS CLUB'], ['Benoit', 'CUSTODY', '30/1', CLUB]),
  m('19:30', '30/1 SM Senior', ['Antoine', 'PORRO', '30/2', 'MOISSAC TENNIS CLUB'], ['Titouan', 'ALVAREZ', '30/1', 'MONTECH TENNIS CLUB']),
  m('21:00', '4eme serie SM 35 ans', ['Antoine', 'PORRO', '30/2', 'MOISSAC TENNIS CLUB'], ['Lionel', 'PARISE', '30/2', 'SAINT ETIENNE TENNIS CLUB']),
  m('21:00', '30/1 SM Senior', ['Raphael', 'ACHOU', '30/1', CLUB], ['Thibault', 'VACHER', '30/1', 'AVENIR MONTBETONNAIS TENNIS']),
];

test('Screens are balanced: story 4 → 2+2, 5 → 3+2 ; square 3 → 2+1, 4 → 2+2, 5 → 2+2+1', () => {
  const sizes = (n, max) => splitScreens([{ time: '18h', matches: Array.from({ length: n }, (_, i) => i) }], max).map((s) => s.matches.length);
  assert.deepEqual(sizes(3, 3), [3]);
  assert.deepEqual(sizes(4, 3), [2, 2]);
  assert.deepEqual(sizes(5, 3), [3, 2]);
  assert.deepEqual(sizes(3, 2), [2, 1]);
  assert.deepEqual(sizes(4, 2), [2, 2]);
  assert.deepEqual(sizes(5, 2), [2, 2, 1]);
});

test('The 13/10 poster gives the same screens and durations as the skill', () => {
  const story = buildTimeline(OCT13, CLUB, 'story');
  assert.deepEqual(story.slots.map((s) => [s.time, s.matches.length]), [['18h', 3], ['19h30', 2], ['21h', 2]]);
  assert.equal(story.total, 20.25);
  assert.deepEqual([story.W, story.H], [1080, 1920]);

  const carre = buildTimeline(OCT13, CLUB, 'carre');
  assert.deepEqual(carre.slots.map((s) => [s.time, s.matches.length]), [['18h', 2], ['18h', 1], ['19h30', 2], ['21h', 2]]);
  assert.equal(carre.total, 23.25);
  assert.deepEqual([carre.W, carre.H], [1080, 1080]);
  assert.equal(carre.cards.length, 7);
});

test('Banner: JOUEUSE for a ladies draw, JOUEUR otherwise, DERBY when both players are from the club', () => {
  const tl = buildTimeline(OCT13, CLUB, 'story');
  const banners = tl.slots.flatMap((s) => s.matches.map((x) => x.banner));
  assert.deepEqual(banners, ['JOUEUSE DU CLUB', 'JOUEUR DU CLUB', 'JOUEUR DU CLUB', 'JOUEUR DU CLUB', null, null, 'JOUEUR DU CLUB']);
  assert.equal(tl.homeCount, 5);

  const derby = buildTimeline([m('10:00', 'SM', ['A', 'X', '30', CLUB], ['B', 'Y', '30', 'castelsarrasin tennis club '])], CLUB, 'story');
  const [match] = derby.slots[0].matches;
  assert.equal(match.derby, true);
  assert.equal(match.banner, 'DERBY · CASTELSARRASIN TENNIS CLUB');
  assert.equal(derby.slots[0].derby, true);
  // l'écran derby s'ouvre sur 1,5 s de mot DERBY : 1 + 1 + (1,5 + 3 + 0,5) + (3 + 0,25) + 1
  assert.equal(derby.total, 11.25);
});

test('No highlighted club: no home player, no banner, no derby', () => {
  const tl = buildTimeline(OCT13, null, 'story');
  assert.equal(tl.homeCount, 0);
  assert.ok(tl.slots.every((s) => !s.derby && s.matches.every((x) => !x.a.home && !x.b.home && x.banner === null)));
});

test('An incomplete match keeps its card with a placeholder opponent', () => {
  const tl = buildTimeline([m('09:00', 'SM', ['Jean', 'Dupont', '15/4', CLUB], ['', '', '', ''])], CLUB, 'carre');
  const [match] = tl.slots[0].matches;
  assert.equal(match.a.last, 'DUPONT');
  assert.equal(match.b.last, 'À DÉTERMINER');
  assert.equal(match.b.home, false);
});

test('Labels match the poster', () => {
  assert.equal(formatHeure('18:00'), '18h');
  assert.equal(formatHeure('19:30'), '19h30');
  assert.equal(formatHeure('09:00'), '9h');
  assert.equal(formatDateLabel('2026-10-13'), 'mardi 13 octobre');
});
