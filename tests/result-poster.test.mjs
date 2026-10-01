import test from 'node:test';
import assert from 'node:assert/strict';
import { finalResult, photoCrop, orderedResultLines, posterPlayerLabel } from '../src/components/teamMatches/poster/resultPoster.ts';

const rencontre = { score_club: 3, score_adverse: 1, wo: false };
const line = (type, winner) => ({ match_type: type, gagnant: winner });

test('No provisional result is shareable, even with a persisted running total', () => {
  assert.equal(finalResult(rencontre, [line('simple', 'club')], '3S1D'), null);
  assert.equal(finalResult(rencontre, [line('simple', 'club'), line('simple', 'club'), line('simple', null), line('double', 'adverse')], '3S1D'), null);
  assert.equal(finalResult({ ...rencontre, score_club: null }, [], '3S1D'), null);
});
test('Finished results respect double weighting and ignore stale persisted totals', () => {
  const lines = [line('simple', 'club'), line('simple', 'adverse'), line('simple', 'club'), line('double', 'club')];
  assert.deepEqual(finalResult(rencontre, lines, '3S1D2'), { club: 4, adverse: 1 });
  assert.deepEqual(finalResult(rencontre, lines, '3S1D'), { club: 3, adverse: 1 });
});
test('Manual results, ties, zero scores and encounter WO remain available', () => {
  assert.deepEqual(finalResult({ ...rencontre, score_club: 0, score_adverse: 0 }, [], '3S1D'), { club: 0, adverse: 0 });
  assert.deepEqual(finalResult({ ...rencontre, wo: true }, [line('simple', null)], '3S1D'), { club: 3, adverse: 1 });
});
test('Cover crop fills the frame and stays within landscape and portrait images at every extreme', () => {
  for (const [iw, ih] of [[2000, 1000], [1000, 2000]]) {
    for (const zoom of [1, 2, 3]) for (const x of [0, 50, 100]) for (const y of [0, 50, 100]) {
      const { sx, sy, sw, sh } = photoCrop(iw, ih, 1080, 1010, x, y, zoom);
      assert.ok(sx >= 0 && sy >= 0 && sx + sw <= iw + 1e-9 && sy + sh <= ih + 1e-9);
      assert.ok(Math.abs(sw / sh - 1080 / 1010) < 1e-9);
    }
  }
});

test('Poster order groups doubles last and retains the sporting slot order without mutating input', () => {
  const lines = [
    { id: 'd', match_type: 'double', slot: 1, ordre: 1 },
    { id: 's3', match_type: 'simple', slot: 3, ordre: 2 },
    { id: 's1', match_type: 'simple', slot: 1, ordre: 3 },
    { id: 's2', match_type: 'simple', slot: 2, ordre: 4 },
  ];
  assert.deepEqual(orderedResultLines(lines).map(line => line.id), ['s1', 's2', 's3', 'd']);
  assert.deepEqual(lines.map(line => line.id), ['d', 's3', 's1', 's2']);
});

test('Player labels preserve names and rankings for both sides, including NC', () => {
  assert.equal(posterPlayerLabel({ prenom: 'Nathalie', nom: 'GUIRAL', classement: '30/1' }), 'Nathalie GUIRAL (30/1)');
  assert.equal(posterPlayerLabel({ prenom: 'Alex', nom: null, classement: 'NC' }), 'Alex (NC)');
  assert.equal(posterPlayerLabel({ prenom: 'Alex', nom: null, classement: '' }), 'Alex (Classement non renseigné)');
});
test('The focus point is centered when possible and clamped at the photo edges', () => {
  const crop = photoCrop(2000, 2000, 1000, 1000, 50, 30, 2);
  assert.equal(crop.sx + crop.sw / 2, 1000);
  assert.equal(crop.sy + crop.sh / 2, 600);
  assert.equal(photoCrop(2000, 2000, 1000, 1000, 0, 0, 2).sy, 0);
});
