import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const production = process.argv.includes('--production');
const portIndex = process.argv.indexOf('--port');
const port = Number(portIndex >= 0 ? process.argv[portIndex + 1] : process.env.PORT || 5173);
const server = createServer((req, res) => {
  // Pas de template brut même lorsqu'on demande explicitement /index.html.
  if (vite && !['/', '/index.html'].includes(new URL(req.url, 'http://local.invalid').pathname)) {
    vite.middlewares(req, res, () => void serve(req, res));
  } else void serve(req, res);
});
const vite = production ? null : await (await import('vite')).createServer({ root, server: { middlewareMode: true, hmr: { server } }, appType: 'custom' });
if (vite) {
  const { loadEnv } = await import('vite');
  if (loadEnv('development', root, '').VITE_ENV !== 'development') throw new Error('VITE_ENV=development requis en local.');
}
const handler = production ? (await import('./dist/server/entry.js')).default : null;
const types = { '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
async function serve(req, res) {
  try {
    if (production) {
      const path = new URL(req.url, 'http://local.invalid').pathname;
      if (path.startsWith('/assets/')) {
        const asset = resolve(root, 'dist/client', '.' + decodeURIComponent(path));
        if (!asset.startsWith(resolve(root, 'dist/client/assets') + sep)) { res.writeHead(404); res.end(); return; }
        try {
          const data = await readFile(asset);
          const ext = asset.slice(asset.lastIndexOf('.'));
          res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream', 'Cache-Control': 'public, max-age=31536000, immutable' });
          res.end(req.method === 'HEAD' ? undefined : data); return;
        } catch { res.writeHead(404); res.end(); return; }
      }
      await handler(req, res); return;
    }
    const template = await vite.transformIndexHtml(req.url, await readFile(resolve(root, 'index.html'), 'utf8'));
    const { renderRequest } = await vite.ssrLoadModule('/src/server/render.tsx');
    const { runtime } = await vite.ssrLoadModule('/src/server/runtime.ts');
    const result = await renderRequest({ url: req.url, host: req.headers.host || '', method: req.method }, template, runtime());
    res.writeHead(result.status, result.headers); res.end(req.method === 'HEAD' ? undefined : result.body);
  } catch (error) {
    if (vite) vite.ssrFixStacktrace(error);
    console.error('Échec du serveur SSR', error.message);
    res.writeHead(503, { 'X-Robots-Tag': 'noindex', 'Cache-Control': 'no-store' }); res.end('Site temporairement indisponible');
  }
}
server.listen(port, '127.0.0.1', () => console.log(`Vitrine SSR : http://127.0.0.1:${server.address().port}`));
