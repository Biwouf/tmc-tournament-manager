import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';
const vite = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
after(() => vite.close());
const { loadHomeFeeds } = await vite.ssrLoadModule('/src/server/feeds.ts');
const { renderRequest } = await vite.ssrLoadModule('/src/server/render.tsx');
const { publicConfig } = await vite.ssrLoadModule('/src/lib/site.ts');
const template = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const runtime = { appEnv: 'production', deploymentEnv: 'production', previewHosts: [], supabaseUrl: 'https://db.example', anonKey: 'anon-test' };
const now = new Date('2026-09-10T12:00:00Z');
const news = (club = 'alpha', extra = {}) => ({ id: `news-${club}`, club_id: club, titre: `Actu ${club}`, contenu: '**Bonjour** [club](https://example.com) ![photo](https://example.com/a.jpg)', published: true, published_at: '2026-09-09T23:30:00Z', image_urls: [], image_focal_points: [], ...extra });
const event = (club = 'alpha', extra = {}) => ({ id: `event-${club}`, club_id: club, titre: `Event ${club}`, type: 'Tournoi', description: 'Un rendez-vous', date_debut: '2099-09-10T12:00:00Z', date_fin: null, prix: null, ...extra });
function fixture(settings = {}) {
  const calls = [];
  const config = publicConfig({ home: { hero_title: 'Bienvenue' }, settings });
  const site = { club: { id: 'alpha', slug: 'alpha', name: 'Alpha', sport: 'tennis', status: 'active', custom_domain: null }, config, clubName: 'Alpha', origin: 'https://alpha.feelike.app' };
  const rows = { actus: [news()], events: [event()] };
  const fetcher = async (input, options) => {
    const url = new URL(input); calls.push({ url, options });
    if (url.pathname.endsWith('/clubs')) {
      const slug = url.searchParams.get('slug').slice(3);
      return Response.json([{ ...site.club, id: slug, slug, club_settings: { config } }]);
    }
    return Response.json(rows[url.pathname.split('/').at(-1)]);
  };
  const request = (path = '/', host = 'alpha.feelike.app', fetch = fetcher) => renderRequest({ url: path, host }, template, runtime, fetch);
  return { site, calls, rows, fetcher, request };
}
test('requêtes anon bornées et filtrées : publication, club et événements en cours', async () => {
  const f = fixture();
  f.rows.events = [event('alpha', { date_debut: '2026-09-09T12:00:00Z', date_fin: '2026-09-11T12:00:00Z' })];
  const result = await loadHomeFeeds(f.site, runtime, f.fetcher, now);
  assert.equal(result.news.length, 1); assert.equal(result.events.length, 1);
  assert.equal(result.news[0].excerpt, 'Bonjour club');
  for (const { url, options } of f.calls) {
    assert.equal(url.searchParams.get('club_id'), 'eq.alpha');
    assert.equal(options.headers.Authorization, 'Bearer anon-test');
    assert.equal(options.cache, 'no-store'); assert.ok(options.signal);
    assert.ok(!url.searchParams.get('select').includes('*'));
  }
  const [n, e] = f.calls.map(c => c.url.searchParams);
  assert.equal(n.get('published'), 'eq.true'); assert.equal(n.get('limit'), '2');
  assert.equal(n.get('order'), 'published_at.desc.nullslast,id.asc');
  assert.equal(e.get('limit'), '3'); assert.equal(e.get('order'), 'date_debut.asc,id.asc');
  assert.equal(e.get('or'), '(date_fin.gte.2026-09-10T12:00:00.000Z,and(date_fin.is.null,date_debut.gte.2026-09-10T12:00:00.000Z))');
});
test('aucune sérialisation des brouillons, autre club, champs BO ou événements passés', async () => {
  const f = fixture();
  f.rows.actus = [news('beta'), news('alpha', { published: false }), news('alpha', { image_captions: ['BO_SECRET'], contenu: 'OK', image_urls: ['javascript:alert(1)'] })];
  f.rows.events = [event('beta'), event('alpha', { date_debut: '2020-01-01T00:00:00Z' }), event('alpha')];
  const result = await loadHomeFeeds(f.site, runtime, f.fetcher, now);
  assert.equal(result.news.length, 1); assert.equal(result.events.length, 1);
  assert.equal(result.news[0].image, null);
  assert.doesNotMatch(JSON.stringify(result), /beta|BO_SECRET|javascript|club_id|contenu/);
});
test('flux masqués : aucune requête ; indépendance des deux réglages', async () => {
  for (const settings of [{ show_news: false, show_events: false }, { show_news: false }, { show_events: false }]) {
    const f = fixture(settings); const result = await loadHomeFeeds(f.site, runtime, f.fetcher, now);
    assert.equal(result.news.length, settings.show_news === false ? 0 : 1);
    assert.equal(result.events.length, settings.show_events === false ? 0 : 1);
    assert.equal(f.calls.length, result.news.length + result.events.length);
  }
});
test('erreur HTTP, réseau, JSON ou contrat : seul le flux indisponible disparaît', async () => {
  for (const fail of [async () => new Response('', { status: 500 }), async () => { throw new Error('timeout'); }, async () => new Response('{'), async () => Response.json({ invalid: true })]) {
    const f = fixture();
    const fetcher = (url, options) => new URL(url).pathname.endsWith('/actus') ? fail() : f.fetcher(url, options);
    const result = await f.request('/', undefined, fetcher);
    assert.equal(result.status, 200); assert.match(result.body, /Prochains rendez-vous/);
    assert.doesNotMatch(result.body, /Dernières actualités/);
  }
});
test('HTML initial et bootstrap identiques : dates Paris, prix et point d’intérêt', async () => {
  const f = fixture();
  f.rows.actus[0].image_urls = ['https://images.example/photo.jpg'];
  f.rows.actus[0].image_focal_points = [{ x: 75, y: 20 }];
  f.rows.events[0].prix = 0;
  const result = await f.request(); assert.equal(result.status, 200);
  const html = result.body.split('<script id="site-data"')[0];
  assert.match(html, /Dernières actualités/); assert.match(html, /Actu alpha/);
  assert.match(html, /10 septembre 2026/); assert.match(html, /object-position:75% 20%/);
  assert.match(html, /loading="lazy"/); assert.match(html, /Gratuit/);
  const data = JSON.parse(result.body.match(/<script id="site-data" type="application\/json">(.*?)<\/script>/s)[1]);
  assert.equal(data.feeds.news[0].titre, 'Actu alpha');
  assert.doesNotMatch(html, /\*\*Bonjour/);
});
test('flux vides, routes non accueil, club suspendu et redirections : pas de bloc ni requête superflue', async () => {
  const f = fixture(); f.rows.actus = []; f.rows.events = [];
  assert.doesNotMatch((await f.request()).body, /Dernières actualités|Prochains rendez-vous/);
  for (const path of ['/contact', '/robots.txt', '/sitemap.xml', '/club/']) {
    f.calls.length = 0; await f.request(path);
    assert.ok(f.calls.every(c => c.url.pathname.endsWith('/clubs')));
  }
  f.site.club.status = 'suspended'; f.calls.length = 0;
  assert.equal((await f.request()).status, 404); assert.equal(f.calls.length, 1);
});
test('requêtes concurrentes et fraîcheur : aucun contenu partagé entre clubs', async () => {
  const f = fixture();
  const fetcher = (url, options) => {
    const u = new URL(url);
    if (u.pathname.endsWith('/clubs')) return f.fetcher(url, options);
    const club = u.searchParams.get('club_id').slice(3);
    return Promise.resolve(Response.json(u.pathname.endsWith('/actus') ? [news(club)] : [event(club)]));
  };
  await Promise.all(['alpha', 'beta', 'alpha', 'beta'].map(async club => {
    const result = await f.request('/', `${club}.feelike.app`, fetcher);
    assert.equal(result.status, 200); assert.match(result.body, new RegExp(`Actu ${club}`));
    assert.doesNotMatch(result.body, new RegExp(`Actu ${club === 'alpha' ? 'beta' : 'alpha'}`));
  }));
  assert.match((await f.request()).body, /Actu alpha/);
  f.rows.actus = []; assert.doesNotMatch((await f.request()).body, /Actu alpha/);
});

test('détail : corps complet et images publiques, sans champs BO ni HTML exécutable', async () => {
  const f = fixture();
  const content = '## Un titre\n\n**Texte intégral** <u>souligné</u><script>alert(1)</script><iframe src="https://evil.example"></iframe>\n\n[lien](javascript:alert)';
  f.rows.actus[0] = news('alpha', { contenu: content, image_urls: ['https://images.example/1.jpg', 'https://images.example/2.jpg'], image_captions: ['SECRET_BO'] });
  const result = await loadHomeFeeds(f.site, runtime, f.fetcher, now);
  assert.equal(result.news[0].content, content);
  assert.equal(result.news[0].images.length, 2);
  assert.doesNotMatch(JSON.stringify(result), /SECRET_BO/);
  const { default: NewsDetail } = await vite.ssrLoadModule('/src/components/home/NewsDetail.tsx');
  const { createElement } = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const html = renderToStaticMarkup(createElement(NewsDetail, { item: result.news[0], onDismiss() {} }));
  assert.match(html, /<strong>Texte intégral<\/strong>/);
  assert.match(html, /<u>souligné<\/u>/);
  assert.match(html, /photo 2/);
  assert.doesNotMatch(html, /<script|<iframe|javascript:|SECRET_BO/);
  const page = await f.request();
  assert.equal(page.status, 200);
  assert.doesNotMatch(page.body, /<script>alert/);
  assert.match(page.body, /aria-haspopup="dialog"/);
});
