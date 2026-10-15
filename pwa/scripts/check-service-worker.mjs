import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Exercise the generated worker with no external runtime available, as after
// an old deployment has disappeared. Startup must still register its handlers.
const code = await readFile(new URL('../dist/sw.js', import.meta.url), 'utf8');
assert.ok(!(await readdir(new URL('../dist/', import.meta.url))).some(name => /^workbox-.*\.js$/.test(name)));
const handlers = new Map();
const location = new URL('https://pwa.example/sw.js');
const self = {
  location,
  registration: { scope: 'https://pwa.example/' },
  addEventListener(type, callback) { handlers.set(type, callback); },
  skipWaiting() {},
};
const context = vm.createContext({
  self, location, URL, console, Request, Response, Headers,
  importScripts(...paths) {
    for (const path of paths) {
      // The local push extension is intentional; a split Workbox runtime is not.
      assert.equal(path, '/course-push-sw.js', 'Unexpected external worker script');
      const extension = readFileSync(new URL('../dist/course-push-sw.js', import.meta.url), 'utf8');
      vm.runInContext(extension, context);
    }
  },
});
vm.runInContext(code, context);
for (const type of ['install', 'activate', 'fetch', 'message', 'push', 'notificationclick']) assert.ok(handlers.has(type), type);

// Vercel must keep deep links working but never return index.html for a
// missing Workbox runtime or JavaScript asset.
const { routes } = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
const fallback = routes.slice(routes.findIndex(route => route.handle === 'filesystem') + 1);
const match = path => fallback.find(route => new RegExp(`^(?:${route.src})$`).test(path));
for (const path of ['/workbox-01ded3f8.js', '/assets/missing.js', '/sw.js', '/course-push-sw.js']) assert.equal(match(path).status, 404, path);
for (const path of ['/cours', '/reset-password', '/']) assert.equal(match(path).dest, '/index.html', path);
console.log('Worker starts without an external Workbox runtime; missing assets return 404; deep links retain SPA fallback.');
