import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
const output = new URL('../.vercel/output/', import.meta.url);
const config = JSON.parse(await readFile(new URL('config.json', output), 'utf8'));
assert.equal(config.version, 3);
assert.ok(config.routes.some(route => route.dest === '/site'));
await assert.rejects(access(new URL('static/index.html', output)));
const fn = new URL('functions/site.func/', output);
const manifest = JSON.parse(await readFile(new URL('.vc-config.json', fn), 'utf8'));
assert.equal(manifest.runtime, 'nodejs22.x');
assert.equal(manifest.launcherType, 'Nodejs');
assert.deepEqual(config.images.sizes, [96, 192, 480, 768, 1200, 1920]);
const pattern = config.images.remotePatterns[0];
assert.ok(pattern.hostname.startsWith('^') && pattern.hostname.endsWith('$'));
assert.ok(!new RegExp(pattern.hostname).test('attacker.example'));
assert.equal(pattern.pathname, '^/storage/v1/object/public/content-images/.*$');

// Exécute le bundle EXACT de la fonction, avec données locales (aucun accès DB).
const originalFetch = globalThis.fetch;
const previous = { env: process.env.VERCEL_ENV, url: process.env.VERCEL_URL, productionUrl: process.env.VERCEL_PROJECT_PRODUCTION_URL };
process.env.VERCEL_ENV = 'preview'; process.env.VERCEL_URL = 'build-check.vercel.app';
let queries = 0;
globalThis.fetch = async url => {
  if (new URL(url).pathname !== '/rest/v1/clubs') return Response.json([]);
  queries++;
  const slug = new URL(url).searchParams.get('slug').slice(3);
  return Response.json([{ id: 'build-club', slug, name: 'Club du build', status: 'active', sport: 'tennis', custom_domain: null,
    club_settings: { config: { home: { hero_title: 'Accueil du build' }, club: { president: { quote: 'Texte du bundle SSR' } } } } }]);
};
try {
  const handler = (await import(new URL(manifest.handler, fn))).default;
  for (const [url, method, status] of [['/', 'GET', 200], ['/club', 'GET', 200], ['/tarifs', 'GET', 404], ['/missing', 'GET', 404], ['/robots.txt', 'GET', 200], ['/sitemap.xml', 'GET', 200], ['/club', 'HEAD', 200]]) {
    let result;
    await handler({ url, method, headers: { host: 'build-check.vercel.app' } }, {
      writeHead(code, headers) { result = { code, headers }; }, end(body) { result.body = body; },
    });
    assert.equal(result.code, status, url);
    assert.match(result.headers['X-Robots-Tag'], /noindex/);
    if (method === 'HEAD') assert.equal(result.body, undefined);
    if (url === '/club' && method === 'GET') {
      assert.match(result.body, /Texte du bundle SSR/);
      assert.match(result.body, /<h1[^>]*>/);
      const asset = result.body.match(/src="(\/assets\/[^\"]+\.js)"/)[1];
      await access(new URL(`static${asset}`, output));
      const head = result.body.split('</head>')[0];
      const stylesheet = head.match(/<link rel="stylesheet"[^>]*href="(\/assets\/[^\"]+\.css)"/);
      assert.ok(stylesheet, 'CSS disponible avant le rendu, sans exécuter le JavaScript');
      const css = await readFile(new URL(`static${stylesheet[1]}`, output), 'utf8');
      assert.match(css, /\.shell/);
      assert.match(head, /<style>html:root\{--brand:/, 'Les couleurs du club priment sur les valeurs CSS de repli');
    }
  }
  assert.equal(queries, 6);
  process.env.VERCEL_ENV = 'production';
  process.env.VERCEL_PROJECT_PRODUCTION_URL = 'web-eight-kappa-94.vercel.app';
  for (const [host, url, status] of [
    ['web-eight-kappa-94.vercel.app', '/', 200],
    ['web-eight-kappa-94.vercel.app', '/club', 200],
    ['web-eight-kappa-94.vercel.app', '/club/', 308],
    ['web-eight-kappa-94.vercel.app', '/sitemap.xml', 200],
    ['unknown.vercel.app', '/', 404],
  ]) {
    let result;
    await handler({ url, method: 'GET', headers: { host } }, {
      writeHead(code, headers) { result = { code, headers }; }, end(body) { result.body = body; },
    });
    assert.equal(result.code, status, `${host}${url}`);
    assert.match(result.headers['X-Robots-Tag'], /noindex/);
    if (status === 308) assert.equal(result.headers.Location, '/club');
    if (status === 200) assert.equal(result.headers.Location, undefined);
    if (url === '/sitemap.xml') assert.doesNotMatch(result.body, /<loc>/);
  }
  console.log('Bundle Vercel autonome : HTML, HEAD, 404, previews, sitemap, robots et assets vérifiés.');
} finally {
  globalThis.fetch = originalFetch;
  for (const [key, value] of [['VERCEL_ENV', previous.env], ['VERCEL_URL', previous.url], ['VERCEL_PROJECT_PRODUCTION_URL', previous.productionUrl]]) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
}
