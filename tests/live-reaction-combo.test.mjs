import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextReaction } from '../pwa/src/preview/reactionCombo.ts';

test('four consecutive identical reactions within two seconds make one combo', () => {
  let streak = null;
  for (let i = 0; i < 8; i++) {
    const result = nextReaction(streak, '👏', i * 200);
    assert.equal(result.combo, i === 3 || i === 7);
    streak = result.streak;
  }
});
test('different emoji breaks the streak', () => {
  let streak = null;
  for (const [i, emoji] of ['👏', '👏', '❤️', '👏'].entries()) {
    const result = nextReaction(streak, emoji, i * 100);
    assert.equal(result.combo, false);
    streak = result.streak;
  }
  assert.equal(streak.count, 1);
});
test('the window covers the entire streak, not only adjacent taps', () => {
  let streak = null;
  for (const time of [0, 700, 1400, 2000]) {
    const result = nextReaction(streak, '🔥', time);
    assert.equal(result.combo, false);
    streak = result.streak;
  }
  assert.equal(streak.count, 1);
});
