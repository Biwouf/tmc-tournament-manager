// Contrôle sans navigateur ni écriture DB. Lancer après `npm run build` + `npm run preview`.
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { loadEnv } from 'vite';
const base = new URL(process.argv[2] || 'http://127.0.0.1:5173');
if (!['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)) throw new Error('Ce contrôle est réservé au serveur local.');
const env = loadEnv('development', process.cwd(), 'VITE_');
assert.equal(env.VITE_ENV, 'development', 'Utiliser uniquement la base de développement');
// Undici/fetch peut normaliser Host : node:http permet le contrôle explicite du tenant.
function withHost(host) {
  return new Promise((resolve, reject) => {
    const req = httpRequest(base, { headers: { Host: host } }, res => {
      let body = ''; res.setEncoding('utf8'); res.on('data', chunk => body += chunk);
      res.on('end', () => resolve({ status: res.statusCode, text: async () => body }));
    });
    req.on('error', reject); req.end();
  });
}
for (const path of ['/', '/club', '/infrastructures', '/tarifs', '/contact', '/inconnue', '/index.html', '/robots.txt', '/sitemap.xml']) {
  const response = await fetch(new URL(path, base));
  const html = await response.text();
  assert.match(response.headers.get('cache-control'), /no-store/);
  assert.match(response.headers.get('x-robots-tag'), /noindex/);
  if (['/inconnue', '/index.html'].includes(path)) assert.equal(response.status, 404);
  if (response.ok && response.headers.get('content-type').includes('text/html')) {
    assert.match(html, /<h1[^>]*>.+?<\/h1>/);
    assert.match(html, /<link rel="canonical" href="https:\/\//);
    const stylesheet = html.split('</head>')[0].match(/<link rel="stylesheet"[^>]*href="([^"]+)"/);
    assert.ok(stylesheet, 'La feuille de styles doit être présente dans le head initial');
    const css = await fetch(new URL(stylesheet[1], base), { headers: { Accept: 'text/css' } });
    assert.equal(css.status, 200);
    assert.match(css.headers.get('content-type'), /text\/css/);
    assert.match(await css.text(), /\.shell/);
    const site = JSON.parse(html.match(/<script id="site-data" type="application\/json">(.*?)<\/script>/s)[1]);
    const graph = JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1])['@graph'];
    assert.equal(graph[0].name, site.clubName);
    assert.equal(graph[1].url, site.origin + path);
  }
  console.log(`${path}: ${response.status} ${response.headers.get('content-type')} — ${html.match(/<title>(.*?)<\/title>/)?.[1] || 'document de découverte'}`);
}
const head = await fetch(base, { method: 'HEAD' }); assert.equal((await head.text()).length, 0);
const post = await fetch(base, { method: 'POST' }); assert.equal(post.status, 405);
const unknown = await withHost('unknown-club-seo.invalid'); assert.equal(unknown.status, 404);
// Deux clubs existants, lecture anon uniquement. Jamais de fixture écrite dans Supabase.
const url = new URL('/rest/v1/clubs', env.VITE_SUPABASE_URL);
url.searchParams.set('select', 'id,slug,status'); url.searchParams.set('status', 'eq.active');
const response = await fetch(url, { headers: { apikey: env.VITE_SUPABASE_ANON_KEY, Authorization: `Bearer ${env.VITE_SUPABASE_ANON_KEY}` } });
assert.equal(response.status, 200);
const clubs = (await response.json()).filter(c => !c.slug.startsWith('app-') && !['admin', 'www', 'api', 'app'].includes(c.slug)).slice(0, 2);
const results = await Promise.all(clubs.map(async club => {
  const response = await withHost(`${club.slug}.feelike.app`);
  const html = await response.text(); assert.equal(response.status, 200);
  const site = JSON.parse(html.match(/<script id="site-data" type="application\/json">(.*?)<\/script>/s)[1]);
  assert.equal(site.club.id, club.id); assert.equal(site.club.slug, club.slug);
  for (const other of clubs.filter(x => x.id !== club.id)) assert.ok(!html.includes(`"id":"${other.id}"`));
  return `${club.slug}: HTML et bootstrap isolés`;
}));
console.log(results.join('\n'));
if (clubs.length < 2) console.log('Un seul club actif disponible : isolation multi-club couverte par les fixtures locales.');
