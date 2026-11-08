import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRencontresTimeline, splitOpponent, dayParts, toAnimRencontre } from '../src/components/rencontresAnimation/timeline.ts';

let id = 0;
const r = (date, time, opponent, location = 'home', extra = {}) => ({
  id: String(++id), competitionName: 'Thénégal', gender: 'hommes', ageCategory: 'seniors', teamNumber: 1,
  opponent, location, date, time, ...extra,
});

test('Opponent names are split into town and club, as on the poster', () => {
  assert.deepEqual(splitOpponent('LAUNAGUET RACING TENNIS CLUB 1'), { name: 'LAUNAGUET', sub: 'RACING TENNIS CLUB 1' });
  assert.deepEqual(splitOpponent('TENNIS CLUB GRISOLLES 1'), { name: 'GRISOLLES', sub: 'TENNIS CLUB 1' });
  assert.deepEqual(splitOpponent('LACROIX FALGARDE T.C 1'), { name: 'LACROIX FALGARDE', sub: 'T.C 1' });
  assert.deepEqual(splitOpponent('Figeac Tennis Club'), { name: 'FIGEAC', sub: 'TENNIS CLUB' });
  assert.deepEqual(splitOpponent('TENNIS CLUB AUCAMVILLE 82 1'), { name: 'AUCAMVILLE 82', sub: 'TENNIS CLUB 1' });
  assert.deepEqual(splitOpponent('Villemur A.S Tennis 1'), { name: 'VILLEMUR', sub: 'A.S TENNIS 1' });
  assert.deepEqual(splitOpponent("VALENCE D'AGEN TENNIS CLUB 4"), { name: "VALENCE D'AGEN", sub: 'TENNIS CLUB 4' });
  assert.deepEqual(splitOpponent('  '), { name: 'À DÉTERMINER', sub: '' });
  assert.deepEqual(splitOpponent('TENNIS'), { name: 'TENNIS', sub: '' });
});

test('Dates read like the skill (1er for the first of the month)', () => {
  assert.deepEqual(dayParts('2026-11-01'), { day: 'DIMANCHE', num: '1er', month: 'NOVEMBRE', label: 'Dimanche 1er novembre' });
  assert.deepEqual(dayParts('2026-11-08'), { day: 'DIMANCHE', num: '8', month: 'NOVEMBRE', label: 'Dimanche 8 novembre' });
});

test('Card data: time, category tag, team and home/away', () => {
  const m = toAnimRencontre(r('2026-11-08', '09:00', 'MOISSAC TENNIS CLUB 1', 'away', { gender: 'femmes', ageCategory: '35_ans', teamNumber: 3 }));
  assert.deepEqual(m, { time: '9h', comp: 'Thénégal', tag: 'FEMMES · +35 ANS', team: 'ÉQUIPE 3', opp: { name: 'MOISSAC', sub: 'TENNIS CLUB 1' }, home: false });
});

test('Durations match the skill: 1 day / 1 match ≈ 12 s, 1 day / 3 matches ≈ 16 s, no recap on one screen', () => {
  const one = buildRencontresTimeline([r('2026-11-08', '09:00', 'A TC 1')]);
  assert.equal(one.total.toFixed(1), '12.4');
  assert.equal(one.recap, null);
  assert.deepEqual([one.W, one.H], [1080, 1920]);
  assert.equal(one.cards[0].CH, 400);

  const three = buildRencontresTimeline([r('2026-11-08', '09:00', 'A TC 1'), r('2026-11-08', '09:00', 'B TC 1', 'away'), r('2026-11-08', '14:00', 'C TC 1', 'away')]);
  assert.equal(three.total.toFixed(1), '16.4');
  assert.equal(three.recap, null);
  assert.deepEqual(three.cards.map((c) => c.CH), [320, 320, 320]);
  assert.equal(three.days[0].hours, '9h · 14h');
  assert.deepEqual([three.nHome, three.nAway], [1, 2]);
});

// Même formule que le gabarit de la skill (0,9 + 2 × (2,3 + 8,5) + récap 6,5 + clôture 4,7)
test('2 days / 6 matches: one screen per day, recap, 34.2 s', () => {
  const sat = ['09:00', '09:00', '14:00'].map((t, i) => r('2026-11-07', t, `S${i} TC 1`, i % 2 ? 'away' : 'home'));
  const sun = ['09:00', '09:00', '09:00'].map((t, i) => r('2026-11-08', t, `D${i} TC 1`));
  const tl = buildRencontresTimeline([...sat, ...sun]);
  assert.deepEqual(tl.days.map((d) => [d.label, d.matches.length]), [['Samedi 7 novembre', 3], ['Dimanche 8 novembre', 3]]);
  assert.ok(tl.recap);
  assert.equal(tl.total.toFixed(1), '34.2');
  // balayages : changement de jour, récap, écran final
  assert.equal(tl.wipes.length, 3);
});

test('4 matches on a day split 2 + 2, 5 split 3 + 2', () => {
  const day = (n) => buildRencontresTimeline(Array.from({ length: n }, (_, i) => r('2026-11-08', '09:00', `X${i} TC 1`)));
  assert.deepEqual(day(4).cards.map((c) => c.CH), [400, 400, 400, 400]);
  assert.ok(day(4).recap);
  assert.deepEqual(day(5).cards.map((c) => c.CH), [320, 320, 320, 400, 400]);
});

test('Recap of 8 matches on 3 days stays above the bottom safe zone', () => {
  const dates = ['2026-11-06', '2026-11-07', '2026-11-07', '2026-11-07', '2026-11-08', '2026-11-08', '2026-11-08', '2026-11-08'];
  const tl = buildRencontresTimeline(dates.map((d, i) => r(d, '09:00', `X${i} TC 1`)));
  const rows = tl.recap.items.filter((it) => it.type === 'row');
  assert.equal(rows.length, 8);
  assert.ok(rows.at(-1).y + tl.recap.rowH <= 1650, `dernière ligne à ${rows.at(-1).y + tl.recap.rowH}`);
  assert.ok(tl.recap.rowH >= 80);
});
