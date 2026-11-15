import test from 'node:test';
import assert from 'node:assert/strict';
import { isUserFacing, uiMessage } from '../pwa/src/lib/uiMessage.ts';

const FALLBACK = 'Repli.';

test('uiMessage : messages français du projet gardés', () => {
  for (const m of ['Match introuvable.', 'Connectez-vous pour participer.', 'Marqueur invalide.',
    'Seuls les membres de ce club peuvent gérer ce live.', 'Envoi de la photo impossible.',
    'Le match a changé ou n’est plus accessible. Rechargez-le avant de réessayer.'])
    assert.equal(uiMessage(new Error(m), FALLBACK), m);
  assert.equal(uiMessage({ message: 'Créer un match en attente avant de le démarrer.', code: 'P0001' }, FALLBACK),
    'Créer un match en attente avant de le démarrer.');
});

test('uiMessage : anglais technique et codes remplacés par le repli', () => {
  for (const m of ['JWT expired', 'new row violates row-level security policy for table "live_posts"',
    'permission denied for table live_matches', 'duplicate key value violates unique constraint "x"',
    'Request failed with status code 500', 'SECTION_FULL', '', 'canceling statement due to statement timeout'])
    assert.equal(uiMessage(new Error(m), FALLBACK), FALLBACK, m);
  assert.equal(uiMessage(null, FALLBACK), FALLBACK);
  assert.equal(uiMessage(42, FALLBACK), FALLBACK);
});

test('uiMessage : réseau coupé ou délai dépassé', () => {
  assert.match(uiMessage(new TypeError('Failed to fetch'), FALLBACK), /Vérifiez votre connexion internet/);
  assert.match(uiMessage(new DOMException('signal is aborted without reason', 'AbortError'), FALLBACK), /connexion internet/);
  assert.match(uiMessage(new DOMException('The operation timed out.', 'TimeoutError'), FALLBACK), /connexion internet/);
  assert.equal(isUserFacing('Load failed'), false);
});
