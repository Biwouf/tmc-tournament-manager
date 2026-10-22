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
    'Même victoire. Pas le même dimanche soir.',
    'Votre club, trois courts couverts.',
    'Les autres gèrent votre club. Nous, on le met en scène.',
    'Chaque match, traité comme une finale.',
    'Votre club en ligne avant la fin de l’échauffement.',
    'Un prix. Toute la saison.',
    '250 €',
    'Soit 20,83 € par mois',
    'Que se passe-t-il à la fin des 30 jours ?',
    'Offrez-leur le court central.',
    'C. Durand',
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
  assert.equal(graph.find(node => node['@type'] === 'FAQPage').mainEntity.length, 7);
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
