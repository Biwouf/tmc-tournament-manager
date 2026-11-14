import test from 'node:test';
import assert from 'node:assert/strict';
import { formatClubName } from '../shared/formatClubName.ts';

const cases = [
  ['ASSOCIATION TENNIS MONTAUBAN A.T.M 2', 'Association Tennis Montauban A.T.M 2'],
  ['LACROIX FALGARDE T.C 1', 'Lacroix Falgarde T.C 1'],
  ['SAINT ETIENNE TENNIS CLUB 1', 'Saint Etienne Tennis Club 1'],
  ['TENNIS CLUB DE GRISOLLES 1', 'Tennis Club de Grisolles 1'],
  ["VALENCE D'AGEN TENNIS CLUB 1", "Valence d'Agen Tennis Club 1"],
  ['SAINT-ÉTIENNE TENNIS CLUB 1', 'Saint-Étienne Tennis Club 1'],
  ["L'UNION TENNIS CLUB", "L'Union Tennis Club"],
  ["TENNIS CLUB DE L'UNION 1", "Tennis Club de l'Union 1"],
  ['ASPTT TOULOUSE 1', 'ASPTT Toulouse 1'],
  ['CAC TENNIS CLUB', 'CAC Tennis Club'],
  ['CAC Tennis Club', 'CAC Tennis Club'],
];

test('formatClubName : tableau du brief', () => {
  for (const [source, expected] of cases) assert.equal(formatClubName(source), expected, source);
});

test('formatClubName : vide ou nul', () => {
  assert.equal(formatClubName(''), '');
  assert.equal(formatClubName(null), '');
  assert.equal(formatClubName(undefined), '');
});

test('formatClubName : casse mixte, apostrophe typographique, sigle consonne, espaces', () => {
  assert.equal(formatClubName('Tennis Club de Grisolles 1'), 'Tennis Club de Grisolles 1');
  assert.equal(formatClubName('VALENCE D’AGEN TC 2'), 'Valence d’Agen TC 2');
  assert.equal(formatClubName('  LE  TC   DE  BLAGNAC  12 '), 'Le TC de Blagnac 12');
  assert.equal(formatClubName('ÉTOILE SPORTIVE DES ÉCUREUILS'), 'Étoile Sportive des Écureuils');
  assert.equal(formatClubName('AS. MURET 3'), 'AS. Muret 3');
  assert.equal(formatClubName('123'), '123');
});
