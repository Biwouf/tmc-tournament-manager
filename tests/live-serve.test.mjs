import test from 'node:test';
import assert from 'node:assert/strict';
import { firstServerFor, getServer } from '../pwa/src/liveScoreRules.ts';

const base = {
  status: 'live', first_server: 'j1', set3_format: null,
  set1_j1: null, set1_j2: null, set1_tb_j1: null, set1_tb_j2: null,
  set2_j1: null, set2_j2: null, set2_tb_j1: null, set2_tb_j2: null,
  set3_j1: null, set3_j2: null, set3_tb_j1: null, set3_tb_j2: null,
};
const at = (patch) => getServer({ ...base, ...patch });

test('Unknown first server, pending or finished match: no indicator', () => {
  assert.equal(at({ first_server: null }), null);
  assert.equal(at({ status: 'pending' }), null);
  assert.equal(at({ status: 'finished' }), null);
});

test('Serve alternates every game across sets', () => {
  assert.equal(at({}), 'j1');
  assert.equal(at({ set1_j1: 1, set1_j2: 0 }), 'j2');
  assert.equal(at({ set1_j1: 3, set1_j2: 2 }), 'j2');
  assert.equal(at({ first_server: 'j2', set1_j1: 2, set1_j2: 2 }), 'j2');
  // 6-3 = 9 jeux : le receveur du dernier jeu sert le 1er jeu du set 2.
  assert.equal(at({ set1_j1: 6, set1_j2: 3, set2_j1: 0, set2_j2: 0 }), 'j2');
  assert.equal(at({ set1_j1: 6, set1_j2: 4, set2_j1: 1, set2_j2: 0 }), 'j2');
});

test('Tie-break: next in rotation serves 1 point, then every 2 points', () => {
  const tb = (a, b) => at({ set1_j1: 6, set1_j2: 6, set1_tb_j1: a, set1_tb_j2: b });
  assert.equal(tb(0, 0), 'j1');
  assert.equal(tb(1, 0), 'j2');
  assert.equal(tb(1, 1), 'j2');
  assert.equal(tb(2, 1), 'j1');
  assert.equal(tb(2, 2), 'j1');
  assert.equal(tb(3, 2), 'j2');
  // Le tie-break compte pour un jeu : celui qui l'a commencé reçoit au set suivant.
  assert.equal(at({ set1_j1: 7, set1_j2: 6, set1_tb_j1: 7, set1_tb_j2: 4 }), 'j2');
});

test('Deciding set, classic or super tie-break', () => {
  const split = { set1_j1: 6, set1_j2: 4, set2_j1: 3, set2_j2: 6 }; // 19 jeux
  assert.equal(at({ ...split }), 'j2', 'format not chosen yet: next in rotation');
  assert.equal(at({ ...split, set3_format: 'normal', set3_j1: 1, set3_j2: 0 }), 'j1');
  assert.equal(at({ ...split, set3_format: 'super_tiebreak', set3_j1: 0, set3_j2: 0 }), 'j2');
  assert.equal(at({ ...split, set3_format: 'super_tiebreak', set3_j1: 1, set3_j2: 0 }), 'j1');
  assert.equal(at({ ...split, set3_format: 'super_tiebreak', set3_j1: 4, set3_j2: 3 }), 'j2');
});

test('First server deduced from who serves now', () => {
  const now = (patch, current) => {
    const first = firstServerFor({ ...base, ...patch, first_server: null }, current);
    assert.equal(at({ ...patch, first_server: first }), current);
    return first;
  };
  assert.equal(now({}, 'j2'), 'j2');
  assert.equal(now({ set1_j1: 3, set1_j2: 2 }, 'j2'), 'j1');
  assert.equal(now({ set1_j1: 6, set1_j2: 3, set2_j1: 2, set2_j2: 2 }, 'j1'), 'j2');
  assert.equal(now({ set1_j1: 6, set1_j2: 6, set1_tb_j1: 2, set1_tb_j2: 1 }, 'j2'), 'j2');
  const split = { set1_j1: 6, set1_j2: 4, set2_j1: 3, set2_j2: 6 };
  assert.equal(now({ ...split, set3_format: 'super_tiebreak', set3_j1: 4, set3_j2: 3 }, 'j1'), 'j2');
  // Calculé même avant le passage en live (démarrage avec score existant).
  assert.equal(firstServerFor({ ...base, status: 'pending', set1_j1: 1, set1_j2: 0 }, 'j1'), 'j2');
});
