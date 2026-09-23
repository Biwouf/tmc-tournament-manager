import test from 'node:test';
import assert from 'node:assert/strict';
import { renderEmail, clubSlugForEmail } from '../supabase/functions/_shared/email-template.ts';
import { authEmails } from '../supabase/functions/_shared/auth-email.ts';

test('identité club, texte brut, échappement et bouton contrasté', () => {
  const { html, text } = renderEmail({ name: 'Club <test>', color: '#fff', logo: 'javascript:alert(1)' }, { title: 'Bonjour', paragraphs: ['<img src=x onerror=alert(1)>'], action: { label: 'Ouvrir', url: 'https://example.com/?a=1&b=2' } });
  assert.match(html, /border-top:6px solid #ffffff/);
  assert.match(html, /color:#000000/);
  assert.match(html, /Club &lt;test&gt;/);
  assert.doesNotMatch(html, /<img|javascript:/);
  assert.match(html, /&amp;b=2/);
  assert.match(text, /https:\/\/example.com/);
});
test('couleur et liens malformés ne deviennent pas du HTML actif', () => {
  const { html } = renderEmail({ name: 'Club', color: 'red;position:fixed', logo: 'https://img.example/logo.png' }, { title: 'Test', paragraphs: [], action: { label: 'Non', url: 'javascript:alert(1)' } });
  assert.match(html, /#334155/); assert.match(html, /<img/); assert.doesNotMatch(html, /position:fixed|<a /);
});
test('résolution stricte du club, BO central neutre et alias serveur', () => {
  assert.equal(clubSlugForEmail('https://app-tennis.feelike.pro/reset-password'), 'tennis');
  assert.equal(clubSlugForEmail('https://app-tennis.feelike.pro.evil.test/'), null);
  assert.equal(clubSlugForEmail('http://app-tennis.feelike.pro/'), null);
  assert.equal(clubSlugForEmail('https://admin.feelike.pro/', { 'admin.feelike.pro': 'tennis' }), null);
  assert.equal(clubSlugForEmail('https://preview.example/reset-password', { 'preview.example': 'tennis' }), 'tennis');
});
const payload = type => ({ user: { email: 'old@example.com', new_email: 'new@example.com' }, email_data: { email_action_type: type, token: '123456', token_hash: 'hash', redirect_to: 'https://app-tennis.feelike.pro/reset-password?a=1&b=2' } });
for (const type of ['recovery', 'invite', 'signup', 'magiclink']) test(`${type} conserve le token et la redirection Supabase`, () => {
  const [mail] = authEmails(payload(type), 'https://project.supabase.co');
  const url = new URL(mail.content.action.url);
  assert.equal(url.pathname, '/auth/v1/verify'); assert.equal(url.searchParams.get('type'), type);
  assert.equal(url.searchParams.get('token'), 'hash'); assert.equal(url.searchParams.get('redirect_to'), payload(type).email_data.redirect_to);
  assert.equal(mail.to, 'old@example.com');
});
test('changement email sécurisé : chaque hash rejoint la bonne adresse', () => {
  const p = payload('email_change'); p.email_data.token_hash_new = 'old-hash';
  const mails = authEmails(p, 'https://project.supabase.co');
  assert.deepEqual(mails.map(m => [m.to, new URL(m.content.action.url).searchParams.get('token')]), [['old@example.com', 'old-hash'], ['new@example.com', 'hash']]);
  delete p.email_data.token_hash_new;
  assert.deepEqual(authEmails(p, 'https://project.supabase.co').map(m => m.to), ['new@example.com']);
});
test('réauthentification par code et refus des actions inconnues', () => {
  const [mail] = authEmails(payload('reauthentication'), 'https://project.supabase.co');
  assert.equal(mail.content.code, '123456'); assert.equal(mail.content.action, undefined);
  assert.throws(() => authEmails(payload('unknown'), 'https://project.supabase.co'));
  const p = payload('recovery'); delete p.email_data.token_hash;
  assert.throws(() => authEmails(p, 'https://project.supabase.co'));
});
