// Vérifie le HTML statique produit par `npm run build` (à lancer avant `npm test`).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';

const dist = new URL('../dist/', import.meta.url);
const read = path => readFileSync(new URL(path, dist), 'utf8');
const text = html => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

test('le build existe', () => assert.ok(existsSync(new URL('index.html', dist)), 'lancer `npm run build` avant les tests'));

test('accueil : tout le texte est dans le HTML servi', () => {
  const body = text(read('index.html'));
  for (const fragment of [
    'Faites-les se sentir comme des pros.',
    'Le site et l’app de votre club de tennis, à ses couleurs',
    'actus, événements, rencontres Ten’Up, live et affiches.',
    'Retrouvez l’app de votre club',
    'Trois écrans. Une seule saisie : celle de Ten’Up.',
    'Une photo le matin. Une affiche le soir.',
    'Match en direct',
    'Anne Marchand remporte le 1er set 6/1 contre Claire Vidal',
    'En ligne avant la fin de l’échauffement.',
    'Les autres gèrent votre club. Nous, on le met en scène.',
    'Un prix. Toute la saison.',
    '250 €',
    'Soit 20,83 € par mois',
    '20 minutes en visio, sur les données de votre club',
    'Que se passe-t-il à la fin des 30 jours ?',
    'Offrez-leur le court central.',
    'C. Vidal',
  ]) assert.ok(body.includes(fragment), `texte absent : ${fragment}`);
});

test('accueil : un seul h1, langue, canonical, Open Graph', () => {
  const html = read('index.html');
  assert.equal(html.match(/<h1[\s>]/g)?.length, 1);
  assert.match(html, /<html lang="fr">/);
  assert.match(html, /<link rel="canonical" href="https:\/\/www\.feelike\.pro\/">/);
  assert.match(html, /<meta property="og:image" content="https:\/\/www\.feelike\.pro\/og\.png">/);
  assert.doesNotMatch(html, /name="robots" content="noindex"/);
});

test('accueil : JSON-LD Organization, SoftwareApplication (250 EUR) et FAQPage', () => {
  const html = read('index.html');
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m => JSON.parse(m[1]));
  const graph = blocks.flatMap(block => block['@graph'] ?? [block]);
  const types = graph.map(node => node['@type']);
  for (const type of ['Organization', 'SoftwareApplication', 'FAQPage']) assert.ok(types.includes(type), type);
  const software = graph.find(node => node['@type'] === 'SoftwareApplication');
  assert.ok(software.offers.some(offer => offer.price === '250' && offer.priceCurrency === 'EUR'));
  assert.equal(graph.find(node => node['@type'] === 'FAQPage').mainEntity.length, 8);
});

test('aucune ressource tierce : polices auto-hébergées, pas de Google Fonts', () => {
  for (const file of readdirSync(dist).filter(name => name.endsWith('.html'))) {
    const html = read(file);
    assert.doesNotMatch(html, /fonts\.(googleapis|gstatic)\.com/, file);
    // Sans PUBLIC_ANALYTICS_DOMAIN, aucun script externe.
    assert.doesNotMatch(html, /<script[^>]+src="https?:/, file);
  }
});

test('pages légales et 404 hors index, sitemap limité à l’accueil', () => {
  for (const file of ['mentions-legales.html', 'cgv.html', '404.html']) assert.match(read(file), /name="robots" content="noindex"/, file);
  const sitemap = read('sitemap.xml');
  assert.deepEqual([...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map(m => m[1]), ['https://www.feelike.pro/']);
});

test('robots.txt autorise les robots IA et déclare le sitemap', () => {
  const robots = read('robots.txt');
  for (const bot of ['GPTBot', 'OAI-SearchBot', 'ClaudeBot', 'PerplexityBot', 'Google-Extended']) assert.match(robots, new RegExp(`User-agent: ${bot}\\nAllow: /`));
  assert.match(robots, /Sitemap: https:\/\/www\.feelike\.pro\/sitemap\.xml/);
  assert.ok(existsSync(new URL('llms.txt', dist)));
});

test('sans tunnel d’inscription, les CTA d’essai deviennent « Demander un accès »', { skip: Boolean(process.env.PUBLIC_SIGNUP_URL) }, () => {
  const body = text(read('index.html'));
  assert.ok(body.includes('Demander un accès'));
  assert.ok(!body.includes('Essayer avec mon club'));
});

// Lancer aussi avec PUBLIC_SIGNUP_URL=https://admin.feelike.pro/inscription au build ET au test.
test('avec le tunnel, chaque CTA d’essai mène à l’inscription avec sa source', { skip: !process.env.PUBLIC_SIGNUP_URL }, () => {
  const html = read('index.html');
  const signup = new URL(process.env.PUBLIC_SIGNUP_URL);
  assert.doesNotMatch(html, /href="#parler"/);
  const links = [...html.matchAll(/<a\b[^>]*>/g)].map(m => m[0]).filter(tag => tag.includes('data-event="cta_trial_click"'));
  assert.ok(links.length >= 5, `${links.length} CTA d’essai`);
  const placements = links.map(tag => {
    const url = new URL(tag.match(/href="([^"]+)"/)[1].replaceAll('&amp;', '&'));
    assert.equal(url.origin + url.pathname, signup.origin + signup.pathname, tag);
    assert.equal(url.searchParams.get('utm_source'), 'landing', tag);
    return url.searchParams.get('utm_content');
  });
  const forms = [...html.matchAll(/<form class="tenup"[\s\S]*?<\/form>/g)].map(m => m[0]);
  assert.deepEqual(forms.map(form => form.match(/name="utm_content" value="([^"]+)"/)[1]), ['hero', 'echauffement', 'cta-final']);
  for (const form of forms) assert.ok(form.includes(`action="${signup.origin + signup.pathname}"`), form);
  const all = [...placements, 'hero', 'echauffement', 'cta-final'];
  assert.equal(new Set(all).size, all.length, `emplacements en double : ${all}`);
});

test('hero : champ Ten’Up vers le tunnel (avec PUBLIC_SIGNUP_URL), capture réelle, lien joueur', () => {
  const html = read('index.html');
  assert.match(html, /<a class="hero__player" href="https:\/\/app-cac-tennis\.feelike\.pro">/);
  assert.match(html, /<a class="nav__player" href="https:\/\/app-cac-tennis\.feelike\.pro">/);
  assert.match(html, /alt="Capture de l’app du CAC Tennis Club/);
  const hero = html.match(/<section id="top"[\s\S]*?<\/section>/)[0];
  assert.doesNotMatch(hero, /hachur|capture · /i, 'aucun emplacement factice dans le hero');
  const form = html.match(/<form class="tenup"[^>]*>[\s\S]*?<\/form>/)?.[0];
  if (!process.env.PUBLIC_SIGNUP_URL) { assert.equal(form, undefined, 'sans tunnel, pas de champ'); return; }
  const signup = new URL(process.env.PUBLIC_SIGNUP_URL);
  assert.ok(form, 'champ Ten’Up absent');
  assert.match(form, new RegExp(`action="${(signup.origin + signup.pathname).replace(/[.]/g, '\\.')}" method="get"`));
  assert.match(form, /<input name="tenup"[^>]*required/);
  assert.match(form, /name="utm_source" value="landing"/);
  assert.match(form, /name="utm_content" value="hero"/);
  assert.ok(text(form).includes('Voir mon club →'));
});

test('promesses alignées sur le produit', () => {
  const pages = [text(read('index.html')), read('llms.txt'), read('index.html')];
  // S9 (abonnement) n'existe pas encore ; le rôle Gestionnaire est retiré depuis le 26/10/2026.
  for (const page of pages) assert.doesNotMatch(page, /\bSEPA\b|prélèvement|lecture seule|facture automatique|en un clic|[Gg]estionnaire|lancement limitées/);
  assert.doesNotMatch(read('llms.txt'), /compositions/);
  for (const step of ['Collez le lien Ten’Up du club', '« C’est bien votre club ? »', 'Un e-mail, et c’est en ligne']) assert.ok(pages[0].includes(step), step);
  assert.ok(pages[0].includes('non affilié à la FFT'));
});

test('vraies captures, aucun emplacement factice', () => {
  const html = read('index.html');
  for (const alt of ['Capture du site du CAC Tennis Club', 'Capture de l’app du CAC Tennis Club : les rencontres', 'Capture du back-office du CAC Tennis Club', 'Écran « C’est bien votre club']) {
    assert.match(html.replaceAll('\u00a0', ' '), new RegExp(`<img[^>]+alt="${alt}|alt="${alt}[^>]*>`), alt);
  }
  assert.doesNotMatch(html, /repeating-linear-gradient|capture · /, 'emplacement hachuré');
  // Hors du hero, les images se chargent à la demande.
  assert.equal(html.match(/<img[^>]+loading="eager"/g).length, 2);
});

test('titres de FAQ et de cartes en casse normale', () => {
  const css = readdirSync(new URL('_astro/', dist)).filter(name => name.endsWith('.css')).map(name => read(`_astro/${name}`)).join('');
  for (const selector of ['.h3', '.faq__list h3']) {
    const rule = css.match(new RegExp(selector.replaceAll('.', '\\.') + '\\{[^}]*\\}'))?.[0] ?? (css + read('index.html')).match(new RegExp(selector.replaceAll('.', '\\.') + '\\{[^}]*\\}'))?.[0];
    assert.ok(rule, selector); assert.doesNotMatch(rule, /uppercase/);
  }
});

test('cinq fichiers de police au plus', () => {
  assert.ok(readdirSync(new URL('_astro/', dist)).filter(name => name.endsWith('.woff2')).length <= 5);
});

test('icônes servies à la racine', () => {
  for (const file of ['favicon.ico', 'favicon.svg', 'apple-touch-icon.png']) assert.ok(existsSync(new URL(file, dist)), file);
  assert.match(read('index.html'), /<link rel="apple-touch-icon" href="\/apple-touch-icon\.png">/);
});
