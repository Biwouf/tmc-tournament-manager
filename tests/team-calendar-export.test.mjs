import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTeamCalendar } from '../shared/teamCalendar.ts';
import { formatWeekLabel, weekRange } from '../src/components/teamMatches/weekend.ts';

const col = (key, sortKey = key) => ({ key, title: key, subtitle: '', sortKey });
const r = (id, date_heure, column, extra = {}) =>
  ({ id, date_heure, club_adverse: `Adv ${id}`, domicile: true, wo: false, column, ...extra });

test('calendrier : seulement le jour et l’avenir, hors WO, groupé par mois puis par jour', () => {
  const now = new Date(2026, 9, 26, 15, 0);
  const a = col('A', '2'), b = col('B', '1');
  const cal = buildTeamCalendar([
    r('passe', new Date(2026, 9, 25, 9).toISOString(), a),
    r('ce-matin', new Date(2026, 9, 26, 9).toISOString(), a),
    r('wo', new Date(2026, 10, 1, 9).toISOString(), a, { wo: true }),
    r('nov-a', new Date(2026, 10, 1, 9).toISOString(), a, { domicile: false }),
    r('nov-b', new Date(2026, 10, 1, 14, 30).toISOString(), b),
    r('mercredi', new Date(2026, 10, 11, 0, 0).toISOString(), b),
  ], now);

  assert.equal(cal.count, 4);
  assert.deepEqual(cal.columns.map((c) => c.key), ['B', 'A']);
  assert.deepEqual(cal.months.map((m) => m.rows.length), [1, 2]);
  const [oct, nov] = cal.months;
  assert.equal(oct.rows[0].cells.get('A')[0].id, 'ce-matin');
  const premier = nov.rows[0];
  assert.equal(premier.cells.get('A')[0].domicile, false);
  assert.equal(premier.cells.get('A')[0].heure, '9h');
  assert.equal(premier.cells.get('B')[0].heure, '14h30');
  // Minuit = heure non renseignée.
  assert.equal(nov.rows[1].cells.get('B')[0].heure, null);
});

test('semaine de l’agenda : lundi → dimanche, à cheval sur deux mois', () => {
  const range = weekRange(new Date(2026, 9, 28, 12)); // mercredi 28 octobre
  assert.equal(range.start.getTime(), new Date(2026, 9, 26).getTime());
  assert.equal(range.end.getTime(), new Date(2026, 10, 1, 23, 59, 59, 999).getTime());
  assert.equal(formatWeekLabel(range), '26 octobre – 1 novembre');
  // Un dimanche appartient à la semaine qui se termine ce jour-là.
  assert.equal(weekRange(new Date(2026, 10, 15, 9)).start.getTime(), new Date(2026, 10, 9).getTime());
  assert.equal(formatWeekLabel(weekRange(new Date(2026, 10, 11))), '9 – 15 novembre');
});
