import test from 'node:test';
import assert from 'node:assert/strict';
import { renderEmail, clubSlugForEmail } from '../supabase/functions/_shared/email-template.ts';
import { authEmails } from '../supabase/functions/_shared/auth-email.ts';

test('identité club, texte brut, échappement et bouton contrasté', () => {
  const { html, text } = renderEmail({ name: 'Club <test>', color: '#fff', logo: 'javascript:alert(1)' }, { title: 'Bonjour', paragraphs: ['<img src=x onerror=alert(1)>'], action: { label: 'Ouvrir', url: 'https://example.com/?a=1&b=2' } });
  assert.match(html, /background-color:#ffffff;padding:26px 28px/);
  assert.match(html, /color:#000000/);
  assert.match(html, />CT<\/td>/, 'initiales sans les caractères spéciaux');
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

test('localhost requires an explicit origin including the port', () => {
  const aliases = { 'http://localhost:5173': 'cac-tennis', localhost: 'wrong-club' };
  assert.equal(clubSlugForEmail('http://localhost:5173/reset-password', aliases), 'cac-tennis');
  assert.equal(clubSlugForEmail('http://localhost:5174/reset-password', aliases), null);
  assert.equal(clubSlugForEmail('http://localhost:5173/reset-password'), null);
  assert.equal(clubSlugForEmail('https://localhost:5173/reset-password', aliases), null);
  assert.equal(clubSlugForEmail('http://localhost.evil.test:5173/reset-password', aliases), null);
  assert.equal(clubSlugForEmail('http://app-cac-tennis.feelike.pro/reset-password', { 'http://app-cac-tennis.feelike.pro': 'cac-tennis' }), null);
  assert.equal(clubSlugForEmail('http://user@localhost:5173/reset-password', aliases), null);
});

test('dynamic local branding follows the request and never the previous fixed club', () => {
  const origins = ['http://localhost:5173'];
  const legacy = { 'http://localhost:5173': 'cac-tennis' };
  for (const slug of ['cac-tennis', 'tc-moissac']) {
    assert.equal(clubSlugForEmail(`http://localhost:5173/reset-password?club_slug=${slug}`, legacy, origins), slug);
  }
  for (const query of ['', '?club_slug=', '?club_slug=../cac-tennis', '?club_slug=admin', '?club_slug=cac-tennis&club_slug=tc-moissac']) {
    assert.equal(clubSlugForEmail(`http://localhost:5173/reset-password${query}`, legacy, origins), null);
  }
  assert.equal(clubSlugForEmail('http://localhost:5174/reset-password?club_slug=tc-moissac', {}, origins), null);
  assert.equal(clubSlugForEmail('https://unknown.example/reset-password?club_slug=tc-moissac', {}, origins), null);
  assert.equal(clubSlugForEmail('https://app-cac-tennis.feelike.pro/reset-password?club_slug=tc-moissac', {}, origins), 'cac-tennis');
  assert.equal(clubSlugForEmail('https://admin.feelike.pro/reset-password?club_slug=tc-moissac', {}, origins), null);
});

// W2 (brief SAAS_11 §13.3) — gabarit clair/sombre, VML, contraste, alt stylé, échappement.
import { buttonColor, contrastRatio, inkOn, emailBrandFromConfig, platformBrand } from '../supabase/functions/_shared/email-template.ts';
import { signupSender, signupSubject, headerName } from '../supabase/functions/_shared/auth-email.ts';

const moissac = { name: 'Moissac TC', color: '#f26524', logo: 'https://store.example/c/config/logo/1-email-128.png', logoDisc: true, eyebrow: 'Votre app de club' };
const linkContent = { title: 'Gardez votre club', paragraphs: ['Bonjour'], action: { label: 'Garder mon club', url: 'https://project.supabase.co/auth/v1/verify?token=h&type=magiclink' }, preheader: 'Votre app moissac-tc.feelike.pro est prête.', notes: ['Le nom, le logo et la couleur viennent de la fiche publique Ten’Up du club.'] };

test('W2 : clair et sombre, pré-en-tête caché, bandeau et VML Outlook', () => {
  const { html, text } = renderEmail(moissac, linkContent);
  assert.match(html, /<meta name="color-scheme" content="light dark">/);
  assert.match(html, /<meta name="supported-color-schemes" content="light dark">/);
  assert.match(html, /@media \(prefers-color-scheme:dark\)/);
  assert.match(html, /\[data-ogsc\] \.fl-card/);
  assert.match(html, /<div style="display:none;[^"]*mso-hide:all">Votre app moissac-tc\.feelike\.pro est prête\./);
  assert.match(html, /background-color:#f26524;padding:26px 28px/);
  assert.match(html, /Votre app de club<\/div>/);
  assert.match(html, /<!--\[if mso\]><v:roundrect [^>]*href="https:\/\/project\.supabase\.co\/auth\/v1\/verify\?token=h&amp;type=magiclink"[^>]*fillcolor="#[0-9a-f]{6}"/);
  assert.match(html, /<!--\[if !mso\]><!-->.*Garder mon club<\/a>.*<!--<!\[endif\]-->/s);
  assert.ok(text.includes('Le nom, le logo et la couleur viennent de la fiche publique Ten’Up du club.'));
  assert.ok(text.includes('https://project.supabase.co/auth/v1/verify?token=h&type=magiclink'), 'texte brut : même lien');
  assert.doesNotMatch(text, /</);
});

test('W2 : bouton blanc sur couleur assombrie ≥ 4,5:1, bandeau ≥ 4,5:1, quelle que soit la couleur', () => {
  assert.equal(buttonColor('#f26524'), '#c6531e');
  for (let i = 0; i < 4096; i += 7) {
    const color = '#' + [i >> 8, (i >> 4) & 15, i & 15].map(v => (v * 17).toString(16).padStart(2, '0')).join('');
    assert.ok(contrastRatio(buttonColor(color), '#ffffff') >= 4.5, color);
    assert.ok(contrastRatio(color, inkOn(color)) >= 4.5, color);
  }
  const { html } = renderEmail(moissac, linkContent);
  assert.match(html, /background-color:#c6531e"><a [^>]*color:#ffffff/);
  assert.match(html, /fillcolor="#c6531e"/);
  assert.match(html, /font-size:22px[^"]*color:#000000">Moissac TC</, 'encre noire sur l’orange');
});

test('W2 : logo PNG dans un disque, alt stylé ; sans logo ou en WebP → initiales HTML', () => {
  const { html } = renderEmail(moissac, linkContent);
  assert.match(html, /<img src="https:\/\/store\.example\/c\/config\/logo\/1-email-128\.png" width="64" height="64" alt="Moissac TC" style="[^"]*border-radius:32px;background-color:#ffffff;text-align:center;font-family:[^"]*font-size:13px;font-weight:bold;[^"]*color:#c6531e"/);
  for (const logo of [undefined, 'https://store.example/logo.webp', 'https://store.example/logo.WEBP?v=2']) {
    const { html: h } = renderEmail({ ...moissac, logo, logoDisc: false }, linkContent);
    assert.doesNotMatch(h, /<img/);
    assert.match(h, /border-radius:32px;background-color:#ffffff;[^"]*color:#c6531e">MT<\/td>/);
  }
  // Logo carré ordinaire (clubs actifs) : inscrit dans le disque blanc.
  const { html: square } = renderEmail({ name: 'CAC Tennis Club', color: '#333dcc', logo: 'https://store.example/logo.png' }, linkContent);
  assert.match(square, /background-color:#ffffff"><img src="https:\/\/store\.example\/logo\.png" width="46" alt="CAC Tennis Club"/);
  // Marque Feelike : ni logo ni initiales.
  const { html: feelike } = renderEmail(platformBrand, linkContent);
  assert.doesNotMatch(feelike, /border-radius:32px/);
});

test('W2 : nom hostile échappé partout (corps, alt, titre, initiales)', () => {
  const name = '"><script>alert(1)</script>';
  const { html, text } = renderEmail({ ...moissac, name }, { ...linkContent, title: name, paragraphs: [name], notes: [name], preheader: name });
  assert.doesNotMatch(html, /<script|"><s/);
  assert.match(html, /alt="&quot;&gt;&lt;script&gt;alert\(1\)&lt;\/script&gt;"/);
  assert.ok(text.includes(name), 'le texte brut garde le nom tel quel');
});

test('W2 : code à 34 px, chasse fixe, mention sous le code (prêt pour P2)', () => {
  const { html, text } = renderEmail(moissac, { ...linkContent, action: undefined, code: '482913', codeNote: 'Valable 10 minutes. Ne le communiquez à personne : Feelike ne vous le demandera jamais.' });
  assert.match(html, /font-family:'Courier New',Courier,monospace;font-size:34px;[^"]*letter-spacing:10px[^"]*">482913</);
  assert.match(html, /Feelike ne vous le demandera jamais\.<\/p>/);
  assert.ok(text.includes('482913') && text.includes('Valable 10 minutes.'));
});

test('W2 : variante email-128 seulement quand le logo retouché est choisi', () => {
  const variants = { 'clean-1024': 'https://s/clean.png', 'email-128': 'https://s/email.png' };
  assert.deepEqual(emailBrandFromConfig('M', { color: '#f26524', logo: 'https://s/clean.png', logo_variants: variants }), { name: 'M', color: '#f26524', logo: 'https://s/email.png', logoDisc: true });
  assert.deepEqual(emailBrandFromConfig('M', { color: '#f26524', logo: 'https://s/orig.jpg', logo_variants: variants }), { name: 'M', color: '#f26524', logo: 'https://s/orig.jpg' });
  assert.deepEqual(emailBrandFromConfig('CAC', { color: '#333dcc', logo: 'https://s/cac.png' }), { name: 'CAC', color: '#333dcc', logo: 'https://s/cac.png' });
  assert.deepEqual(emailBrandFromConfig('X', undefined), { name: 'X', color: undefined, logo: undefined });
});

const signupPayload = { user: { id: 'u', email: 'admin@example.invalid' }, email_data: { email_action_type: 'magiclink', token_hash: 'hash', redirect_to: 'https://admin.feelike.pro/?inscription=moissac-tc' } };
test('W2 : contenu Ten’Up vs manuel, expéditeur et objet', () => {
  const [tenup] = authEmails(signupPayload, 'https://project.supabase.co', { name: 'Moissac TC', slug: 'moissac-tc', tenup: true });
  assert.equal(tenup.content.title, 'Gardez votre club');
  assert.equal(tenup.content.action.label, 'Garder mon club');
  assert.equal(tenup.content.preheader, 'Votre app moissac-tc.feelike.pro est prête.');
  assert.match(tenup.content.footer, /l’espace du club Moissac TC sur Feelike[^]*supprimé dans 7 jours/);
  assert.deepEqual(tenup.content.notes, ['Feelike · l’app des clubs de tennis · feelike.pro', 'Le nom, le logo et la couleur viennent de la fiche publique Ten’Up du club.']);
  const [manual] = authEmails(signupPayload, 'https://project.supabase.co', { name: 'Service client Banque', slug: 'banque' });
  assert.match(manual.content.paragraphs[0], /« Service client Banque »/);
  assert.deepEqual(manual.content.notes, ['Feelike · l’app des clubs de tennis · feelike.pro']);
  assert.equal(signupSender('Moissac TC'), 'Moissac TC via Feelike');
  assert.equal(signupSubject('Moissac TC'), 'Gardez Moissac TC sur Feelike');
  assert.equal(signupSubject('Moissac TC', '482913'), '482 913 : votre code pour garder Moissac TC');
  assert.equal(headerName('Moissac\r\nBcc: x@y TC'), 'Moissac Bcc: x@y TC');
});
