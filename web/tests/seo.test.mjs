import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';

const vite = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
after(() => vite.close());
const { renderRequest } = await vite.ssrLoadModule('/src/server/render.tsx');
const { publicConfig, isReadyForIndexing } = await vite.ssrLoadModule('/src/lib/site.ts');
const template = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const runtime = {
  appEnv: 'production', deploymentEnv: 'production', devSlug: 'alpha', previewHosts: ['preview.vercel.app'],
  supabaseUrl: 'https://database.example', anonKey: 'public-test-key',
};
function config(name) {
  return {
    brand: { name, city: `${name} Ville`, logo: `https://images.example/${name}.png` },
    home: { hero_title: `Bienvenue chez ${name}`, hero_subtitle: `Pratique du sport avec ${name}` },
    club: { president: { name: `Présidence ${name}`, quote: `Présentation du club ${name}` } },
    infra: { courts: [{ label: `Courts ${name}`, count: '2', image: `https://images.example/${name}-courts.jpg` }] },
    pricing: { season: '2026–2027', lessons: [{ name: `Cours ${name}`, price: 100 }] },
    contact: { address_street: `1 rue ${name}`, address_city: `${name} Ville`, address_postal_code: '12345',
      phone: '01 02 03 04 05', opening_hours: [{ day: 'Lundi', time: 'Sur rendez-vous' }] },
    social: { facebook_url: `https://www.facebook.com/${name}` },
    posters: { tmc_backgrounds: [{ name: 'BO_ONLY', image: 'https://images.example/private-poster.png' }] },
    unknown_group: { internal: 'UNKNOWN_ONLY' },
  };
}
function fixture() {
  const rows = ['alpha', 'beta'].map(slug => ({ id: `id-${slug}`, slug, name: slug, sport: 'tennis',
    status: 'active', custom_domain: null, club_settings: { config: config(slug) } }));
  const calls = [];
  const fetcher = async (input, options) => {
    const url = new URL(input); calls.push({ url, options });
    assert.equal(url.origin, runtime.supabaseUrl);
    assert.equal(options.cache, 'no-store');
    assert.equal(url.searchParams.get('select'), 'id,slug,name,sport,status,custom_domain,club_settings(config)');
    const key = url.searchParams.has('slug') ? 'slug' : 'custom_domain';
    const value = url.searchParams.get(key)?.slice(3);
    return Response.json(rows.filter(row => row[key] === value));
  };
  const request = (url = '/', host = 'alpha.feelike.app', env = runtime, method = 'GET') =>
    renderRequest({ url, host, method }, template, env, fetcher);
  return { rows, calls, fetcher, request };
}
const bootstrap = html => JSON.parse(html.match(/<script id="site-data" type="application\/json">(.*?)<\/script>/s)[1]);
const jsonld = html => JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1]);

for (const path of ['/', '/club', '/infrastructures', '/tarifs', '/contact']) {
  test(`HTML initial : ${path}, contenu, H1, métadonnées et même club`, async () => {
    const { request } = fixture();
    const result = await request(path);
    assert.equal(result.status, 200);
    assert.match(result.body.split('</head>')[0], /<link rel="stylesheet" href="\/src\/index\.css"\s*\/>/);
    assert.match(result.body, /<h1[^>]*>[^<]+<\/h1>/);
    assert.match(result.body, /<meta name="description" content="[^"]+">/);
    assert.match(result.body, new RegExp(`<link rel="canonical" href="https://alpha.feelike.app${path}">`));
    assert.match(result.body, /<meta name="robots" content="index, follow">/);
    assert.doesNotMatch(result.body, /<!--site-|BO_ONLY|UNKNOWN_ONLY|beta/);
    assert.equal(bootstrap(result.body).club.slug, 'alpha');
    assert.equal(jsonld(result.body)['@graph'][0].name, 'alpha');
    assert.equal(jsonld(result.body)['@graph'][1].url, `https://alpha.feelike.app${path}`);
    assert.match(result.headers['Vercel-CDN-Cache-Control'], /no-store/);
  });
}
test('titres et descriptions propres à chaque route', async () => {
  const { request } = fixture();
  const pages = await Promise.all(['/', '/club', '/infrastructures', '/tarifs', '/contact'].map(p => request(p)));
  assert.equal(new Set(pages.map(p => p.body.match(/<title>(.*?)<\/title>/)[1])).size, 5);
  assert.equal(new Set(pages.map(p => p.body.match(/name="description" content="(.*?)"/)[1])).size, 5);
});
test('JSON-LD limité aux faits visibles, horaires libres non interprétés', async () => {
  const { request } = fixture(); const result = await request('/contact');
  const data = jsonld(result.body)['@graph'][0];
  assert.equal(data['@type'], 'SportsClub');
  for (const value of [data.name, data.telephone, data.address.streetAddress, data.address.addressLocality]) {
    assert.ok(result.body.split('<div id="root">')[1].split('<script id="site-data"')[0].includes(value));
  }
  assert.equal(data.openingHoursSpecification, undefined);
  assert.equal(data.geo, undefined); assert.equal(data.aggregateRating, undefined);
  assert.match(result.body, /Sur rendez-vous/);
});
test('404 réelles : routes inconnues, réservées, domaines arbitraires, clubs absents ou suspendus', async () => {
  const { request, rows } = fixture();
  for (const path of ['/inconnue', '/index.html', '/CLUB', '/site', '//evil.test/club']) assert.equal((await request(path)).status, 404);
  for (const host of ['unknown.feelike.app', 'admin.feelike.app', 'app-alpha.feelike.app', 'arbitrary.example', 'prod.vercel.app', 'alpha.feelike.app@evil.example']) {
    const result = await request('/', host); assert.equal(result.status, 404, host); assert.doesNotMatch(result.body, /Bienvenue/);
  }
  rows[0].status = 'suspended';
  for (const path of ['/', '/sitemap.xml', '/robots.txt']) assert.equal((await request(path)).status, 404);
});
test('config manquante, RLS muette, échec DB et timeout donnent 503 sans contenu obsolète', async () => {
  const { request, rows } = fixture(); rows[0].club_settings = null;
  assert.equal((await request()).status, 503);
  for (const fetcher of [async () => new Response('', { status: 503 }), async () => { throw new Error('timeout'); }, async () => new Response('invalid json')]) {
    const result = await renderRequest({ url: '/', host: 'alpha.feelike.app' }, template, runtime, fetcher);
    assert.equal(result.status, 503); assert.equal(result.headers['Retry-After'], '60');
    assert.doesNotMatch(result.body, /alpha/);
  }
});
test('config vide : accueil utile noindex, pages intérieures 404, sitemap vide', async () => {
  const { request, rows } = fixture(); rows[0].club_settings.config = {};
  const home = await request(); assert.equal(home.status, 200); assert.match(home.body, /<h1[^>]*>alpha<\/h1>/);
  assert.match(home.headers['X-Robots-Tag'], /noindex/);
  for (const path of ['/club', '/infrastructures', '/tarifs', '/contact']) assert.equal((await request(path)).status, 404);
  assert.doesNotMatch((await request('/sitemap.xml')).body, /<loc>/);
});
test('retrait de page : 404, liens et données retirés, sans modifier la configuration source', async () => {
  const { request, rows } = fixture(); const raw = rows[0].club_settings.config;
  raw.club.published = false; raw.club.page_title = 'HIDDEN_PAGE_TITLE'; raw.club.seo_description = 'HIDDEN_SEO_DESCRIPTION'; raw.home.school_teaser_cta = 'Voir les formules';
  const result = await request(); assert.doesNotMatch(result.body, /href="\/club"|Présentation du club alpha|HIDDEN_PAGE_TITLE|HIDDEN_SEO_DESCRIPTION/);
  assert.equal((await request('/club')).status, 404);
  assert.doesNotMatch((await request('/sitemap.xml')).body, /<loc>[^<]*\/club</);
  assert.equal(raw.club.president.quote, 'Présentation du club alpha');
  assert.equal(bootstrap(result.body).config.club.published, false);
});
test('config incomplète : le titre seul ne publie pas ; tarifs incomplets gardent le site noindex', async () => {
  const { request, rows } = fixture(); rows[0].club_settings.config.infra = { page_title: 'Nos installations' };
  assert.equal((await request('/infrastructures')).status, 404);
  delete rows[0].club_settings.config.pricing.lessons[0].price;
  assert.equal((await request('/tarifs')).status, 200);
  assert.match((await request()).headers['X-Robots-Tag'], /noindex/);
  assert.doesNotMatch((await request('/sitemap.xml')).body, /<loc>/);
});
test('publication des tarifs et contact, et interrupteur global, conditionnent l’indexation', () => {
  const raw = config('alpha'); assert.equal(isReadyForIndexing(publicConfig(raw)), true);
  for (const [group, key, value] of [['pricing', 'season', ''], ['pricing', 'published', false],
    ['contact', 'address_street', ''], ['contact', 'published', false], ['settings', 'search_indexing', false]]) {
    const next = structuredClone(raw); next[group] = { ...next[group], [key]: value };
    assert.equal(isReadyForIndexing(publicConfig(next)), false, `${group}.${key}`);
  }
});
test('sitemap et robots : types corrects, URLs canoniques publiées seulement', async () => {
  const { request } = fixture(); const sitemap = await request('/sitemap.xml');
  assert.match(sitemap.headers['Content-Type'], /application\/xml/);
  assert.equal((sitemap.body.match(/<loc>/g) || []).length, 5);
  assert.doesNotMatch(sitemap.body, /localhost|vercel.app/);
  const robots = await request('/robots.txt'); assert.match(robots.headers['Content-Type'], /text\/plain/);
  assert.equal(robots.body, 'User-agent: *\nAllow: /\nSitemap: https://alpha.feelike.app/sitemap.xml\n');
});
test('preview autorisée et dev : noindex sur tout, pas de sitemap indexable ni fallback arbitraire', async () => {
  const { request } = fixture();
  const preview = { ...runtime, deploymentEnv: 'preview' };
  for (const path of ['/', '/club', '/robots.txt', '/sitemap.xml']) {
    const result = await request(path, 'preview.vercel.app', preview);
    assert.equal(result.status, 200); assert.match(result.headers['X-Robots-Tag'], /noindex/);
    assert.doesNotMatch(result.body, /Disallow: \/|<loc>/);
  }
  assert.equal((await request('/', 'evil.vercel.app', preview)).status, 404);
  const local = { ...runtime, deploymentEnv: undefined, appEnv: 'development' };
  assert.equal((await request('/', 'localhost:5173', local)).status, 200);
  assert.equal((await request('/', 'localhost:5173', runtime)).status, 404);
  assert.match((await request('/', 'alpha.feelike.app', { ...runtime, appEnv: 'development' })).headers['X-Robots-Tag'], /noindex/);
});
test('domaine personnalisé vérifié et redirection de son alias, sans Host injecté', async () => {
  const { request, rows } = fixture(); rows[0].custom_domain = 'club-alpha.example';
  const custom = await request('/club', 'club-alpha.example'); assert.equal(custom.status, 200);
  assert.match(custom.body, /href="https:\/\/club-alpha.example\/club"/);
  const alias = await request('/club/?utm_source=test');
  assert.equal(alias.status, 308); assert.equal(alias.headers.Location, 'https://club-alpha.example/club?utm_source=test');
  assert.equal((await request('/', 'club-alpha.example.evil.test')).status, 404);
  rows[0].custom_domain = 'https://evil.test/path'; assert.equal((await request()).status, 503);
});
test('slash final, paramètres ignorés pour le tenant et canonical sans tracking', async () => {
  const { request } = fixture(); assert.equal((await request('/club/')).headers.Location, 'https://alpha.feelike.app/club');
  const page = await request('/club?club=beta&utm_source=test');
  assert.match(page.body, /href="https:\/\/alpha.feelike.app\/club"/); assert.doesNotMatch(page.body, /beta|utm_source/);
});
test('requêtes concurrentes : isolation des clubs, routes, canonical, JSON-LD et bootstrap', async () => {
  const { request, calls } = fixture();
  const results = await Promise.all(Array.from({ length: 20 }, (_, i) => {
    const slug = i % 2 ? 'beta' : 'alpha';
    return request(i % 3 ? '/club' : '/contact', `${slug}.feelike.app`).then(result => ({ slug, result }));
  }));
  for (const { slug, result } of results) {
    assert.equal(result.status, 200); assert.doesNotMatch(result.body, new RegExp(slug === 'alpha' ? 'beta' : 'alpha'));
    assert.equal(bootstrap(result.body).club.id, `id-${slug}`);
    assert.equal(jsonld(result.body)['@graph'][0]['@id'], `https://${slug}.feelike.app/#club`);
  }
  assert.equal(calls.length, 20);
});
test('enregistrement BO puis suspension visibles dès la requête suivante, sans cache', async () => {
  const { request, rows, calls } = fixture();
  assert.match((await request('/club')).body, /Présentation du club alpha/);
  rows[0].club_settings.config.club.president.quote = 'Texte actualisé';
  const updated = await request('/club'); assert.match(updated.body, /Texte actualisé/); assert.doesNotMatch(updated.body, /Présentation du club alpha/);
  rows[0].status = 'suspended'; const stopped = await request('/club'); assert.equal(stopped.status, 404);
  assert.doesNotMatch(stopped.body, /Texte actualisé/); assert.equal(calls.length, 3);
});
test('échappement HTML / JSON et surcharges facultatives', async () => {
  const { request, rows } = fixture(); const injection = '</script><script>alert("x")</script>';
  rows[0].club_settings.config.home.seo_title = injection;
  rows[0].club_settings.config.home.seo_description = 'Résumé "exact" & réel';
  const result = await request(); assert.doesNotMatch(result.body, /<script>alert/);
  assert.match(result.body, /Résumé &quot;exact&quot; &amp; réel/);
  assert.equal(bootstrap(result.body).config.home.seo_title, injection);
  assert.equal(jsonld(result.body)['@graph'][1].name, injection);
});
test('liens explorables et images : priorité du hero, lazy des photos sous le bandeau', async () => {
  const { request, rows } = fixture(); const raw = rows[0].club_settings.config;
  raw.home.hero_image = 'https://images.example/hero.jpg'; raw.home.school_teaser_cta = 'Voir les formules';
  const home = await request(); assert.match(home.body, /<a[^>]*href="\/club"/); assert.match(home.body, /<a[^>]*href="\/tarifs"/);
  assert.match(home.body, /<img[^>]*fetchPriority="high"[^>]*loading="eager"/);
  const infra = await request('/infrastructures'); assert.match(infra.body, /<img[^>]*loading="lazy"[^>]*alt="Courts alpha"/);
});
test('méthodes HTTP : HEAD accepte le rendu, POST refuse avec Allow', async () => {
  const { request } = fixture(); assert.equal((await request('/', undefined, undefined, 'HEAD')).status, 200);
  const post = await request('/', undefined, undefined, 'POST'); assert.equal(post.status, 405); assert.equal(post.headers.Allow, 'GET, HEAD');
});

test('images adaptatives : source du club seulement, largeurs contrôlées, original gardé en local', async () => {
  const { responsiveImage, configImageUrl } = await vite.ssrLoadModule('/src/lib/configImage.ts');
  const src = configImageUrl('id-alpha/config/photo.jpg');
  const responsive = responsiveImage(src, 'id-alpha');
  assert.match(responsive.srcSet, /480w, .*768w, .*1200w, .*1920w/);
  assert.match(responsive.src, /w=1200&q=75$/);
  assert.deepEqual(responsiveImage(src, 'id-beta'), {});
  assert.deepEqual(responsiveImage('https://untrusted.example/photo.jpg', 'id-alpha'), {});
  assert.deepEqual(responsiveImage(configImageUrl('id-alpha/config/logo.svg'), 'id-alpha'), {});
  assert.match(responsiveImage(src, 'id-alpha', 44).srcSet, /96w, .*192w/);
});
test('contrats BO / vitrine synchronisés et nouveaux champs compatibles avec une config ancienne', async () => {
  const master = await readFile(new URL('../../src/lib/clubConfig.ts', import.meta.url), 'utf8');
  const copy = await readFile(new URL('../src/lib/clubConfig.ts', import.meta.url), 'utf8');
  assert.equal(copy.slice(copy.indexOf('// Multi-tenant — PR6a')), master);
  assert.equal(publicConfig({}).home.published, true);
  assert.equal(publicConfig({}).settings.search_indexing, true);
  assert.equal(publicConfig([]).home.published, true);
});

test('slash final en preview : redirection relative, sans divergence d’hydratation', async () => {
  const { request } = fixture();
  const response = await request('/club/?utm_source=test', 'preview.vercel.app', { ...runtime, deploymentEnv: 'preview' });
  assert.equal(response.status, 308);
  assert.equal(response.headers.Location, '/club?utm_source=test');
});

test('BO : publication booléenne et surcharges validées sans modifier les contenus', async () => {
  const { fileURLToPath } = await import('node:url');
  const { CLUB_CONFIG_GROUPS, groupValueFromConfig, validateClubConfigGroup } = await vite.ssrLoadModule(
    fileURLToPath(new URL('../../src/lib/clubConfigWrite.ts', import.meta.url)),
  );
  const raw = config('alpha');
  const original = structuredClone(raw);
  for (const group of CLUB_CONFIG_GROUPS.filter(x => ['home', 'club', 'infra', 'pricing', 'contact'].includes(x.key))) {
    const values = groupValueFromConfig(group, publicConfig(raw));
    const valid = validateClubConfigGroup(group, { ...values, published: false, seo_title: ' Titre choisi ', seo_description: '' });
    assert.equal(valid.valid, true, group.key);
    assert.equal(valid.value.published, false);
    assert.equal(valid.value.seo_title, 'Titre choisi');
    assert.equal(validateClubConfigGroup(group, { ...values, published: 'false' }).valid, false);
  }
  assert.deepEqual(raw, original);
});


test('alias Vercel de production : club configuré, noindex et aucune redirection vers feelike', async () => {
  const { request, calls } = fixture();
  const host = 'web-eight-kappa-94.vercel.app';
  const prod = { ...runtime, productionHost: host };
  for (const path of ['/', '/club', '/contact', '/robots.txt', '/sitemap.xml']) {
    const response = await request(path, host, prod);
    assert.equal(response.status, 200, path);
    assert.match(response.headers['X-Robots-Tag'], /noindex/);
    assert.equal(response.headers.Location, undefined);
    if (path === '/sitemap.xml') assert.doesNotMatch(response.body, /<loc>/);
    if (path === '/robots.txt') assert.doesNotMatch(response.body, /Sitemap:/);
    if (path === '/') {
      assert.match(response.body, /Bienvenue chez alpha/);
      assert.match(response.body, /<meta name="robots" content="noindex, follow"/);
    }
  }
  const redirect = await request('/club/?utm_source=test', host, prod);
  assert.equal(redirect.status, 308);
  assert.equal(redirect.headers.Location, '/club?utm_source=test');
  const selected = await request('/?club=beta', host, prod);
  assert.equal(bootstrap(selected.body).club.slug, 'alpha');
  assert.equal((await request('/inconnue', host, prod)).status, 404);
  for (const invalidHost of ['evil.vercel.app', 'web-eight-kappa-94.vercel.app.evil.test']) {
    assert.equal((await request('/', invalidHost, prod)).status, 404);
  }
  assert.equal((await request('/', host, { ...prod, deploymentEnv: 'preview' })).status, 404);
  for (const devSlug of [undefined, '', 'admin', 'missing']) {
    assert.equal((await request('/', host, { ...prod, devSlug })).status, 404);
  }
  assert.ok(calls.length > 0);
});

test('alias Vercel : statut et publication conservés, domaines canoniques inchangés', async () => {
  const { request, rows } = fixture();
  const host = 'web-eight-kappa-94.vercel.app';
  const prod = { ...runtime, productionHost: host };
  rows[0].custom_domain = 'club-alpha.example';
  assert.equal((await request('/', host, prod)).status, 200);
  assert.equal((await request('/', 'alpha.feelike.app', prod)).headers.Location, 'https://club-alpha.example/');
  const canonical = await request('/', 'club-alpha.example', prod);
  assert.equal(canonical.status, 200);
  assert.equal(canonical.headers['X-Robots-Tag'], undefined);
  rows[0].club_settings.config.club.published = false;
  assert.equal((await request('/club', host, prod)).status, 404);
  rows[0].status = 'suspended';
  assert.equal((await request('/', host, prod)).status, 404);
});
