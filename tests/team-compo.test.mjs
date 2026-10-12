import test from 'node:test';
import assert from 'node:assert/strict';
import { matchMember } from '../pwa/src/lib/teamCompo.ts';

test('Members are matched despite accents, case, order and small reading errors', () => {
  const roster = [
    { id: 'a', prenom: 'Audrey', nom: 'Guy', classement: '30/1' },
    { id: 'm', prenom: 'Marie', nom: 'Callot', classement: '30/4' },
    { id: 'c', prenom: 'Charlène', nom: 'Chéron', classement: '30/4' },
    { id: 'l1', prenom: 'Lucie', nom: 'Martin', classement: '30' },
    { id: 'l2', prenom: 'Lucie', nom: 'Martin', classement: '15/4' },
  ];
  assert.equal(matchMember({ prenom: 'Andrey', nom: 'Guy', classement: '30/2' }, roster)?.id, 'a');
  assert.equal(matchMember({ prenom: 'Marie', nom: 'CALLOT', classement: '30/3' }, roster)?.id, 'm');
  assert.equal(matchMember({ prenom: 'CHERON', nom: 'Charlene', classement: null }, roster)?.id, 'c');
  assert.equal(matchMember({ prenom: 'Lucie', nom: 'Martin', classement: '15/4' }, roster)?.id, 'l2', 'ranking breaks a tie');
  assert.equal(matchMember({ prenom: 'Lucie', nom: 'Martin', classement: null }, roster), null, 'homonyms are never guessed');
  assert.equal(matchMember({ prenom: 'Mélo', nom: '', classement: null }, roster), null);
  assert.equal(matchMember({ prenom: 'Paul', nom: 'Inconnu', classement: null }, roster), null);
});
