import { build, loadEnv } from 'vite';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';

// Build Output API : seuls les assets sont statiques, jamais un index.html de secours.
await build();
await build({ build: { ssr: 'src/server/entry.ts', outDir: 'dist/server',
  rollupOptions: { output: { entryFileNames: 'entry.js' } } }, ssr: { noExternal: true } });
const output = new URL('../.vercel/output/', import.meta.url);
await rm(output, { recursive: true, force: true });
const fn = new URL('functions/site.func/', output);
await mkdir(fn, { recursive: true });
await cp(new URL('../dist/client/', import.meta.url), new URL('static/', output), { recursive: true });
await rm(new URL('static/index.html', output));
await cp(new URL('../dist/server/', import.meta.url), fn, { recursive: true });
await cp(new URL('../dist/client/index.html', import.meta.url), new URL('template.html', fn));
await cp(new URL('../dist/client/index.html', import.meta.url), new URL('../dist/server/template.html', import.meta.url));
await writeFile(new URL('package.json', fn), JSON.stringify({ type: 'module' }));
await writeFile(new URL('.vc-config.json', fn), JSON.stringify({ runtime: 'nodejs22.x', handler: 'entry.js', launcherType: 'Nodejs', maxDuration: 30 }));
const env = loadEnv('production', process.cwd(), 'VITE_');
const storage = new URL(env.VITE_SUPABASE_URL);
const escapedHostname = storage.hostname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
await writeFile(new URL('config.json', output), JSON.stringify({ version: 3,
  images: {
    sizes: [96, 192, 480, 768, 1200, 1920], domains: [], localPatterns: [], qualities: [75],
    formats: ['image/webp'], minimumCacheTTL: 3600,
    remotePatterns: [{ protocol: storage.protocol.slice(0, -1), hostname: `^${escapedHostname}$`,
      port: storage.port, pathname: '^/storage/v1/object/public/content-images/.*$', search: '' }],
  },
  routes: [
  { src: '/assets/(.*)', headers: { 'Cache-Control': 'public, max-age=31536000, immutable' }, continue: true },
  { handle: 'filesystem' },
  { src: '/(.*)', dest: '/site' },
] }, null, 2));
const template = await readFile(new URL('template.html', fn), 'utf8');
for (const marker of ['site-head', 'site-style', 'site-app', 'site-data']) {
  if (!template.includes(`<!--${marker}-->`)) throw new Error(`Marqueur SSR manquant : ${marker}`);
}
console.log('Build SSR prêt : .vercel/output (Node 22), aucun HTML public statique.');
