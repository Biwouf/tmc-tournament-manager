import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const code = ts.transpileModule(readFileSync(new URL('../pwa/src/lib/pwaUpdates.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const tick = () => new Promise(resolve => setImmediate(resolve));
function setup({ first = false, waiting = false, offline = false, fail = false } = {}) {
  const sw = new EventTarget();
  sw.controller = first ? null : {};
  const worker = Object.assign(new EventTarget(), { state: 'installing', messages: [], postMessage(m) { this.messages.push(m); } });
  const registration = Object.assign(new EventTarget(), {
    waiting: waiting ? worker : null, installing: null,
    async update() { checks++; if (fail) throw new Error('Network'); },
  });
  let checks = 0, registrations = 0, notices = 0, reloads = 0, now = 0;
  sw.register = async () => { registrations++; return registration; };
  const timers = new Map();
  let timerId = 0;
  const window = Object.assign(new EventTarget(), {
    location: { reload() { reloads++; } },
    setInterval(fn) { timers.set(++timerId, fn); return timerId; },
    clearInterval(id) { timers.delete(id); },
    setTimeout(fn) { timers.set(++timerId, fn); return timerId; },
    clearTimeout(id) { timers.delete(id); },
  });
  const document = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  const navigator = { serviceWorker: sw, onLine: !offline };
  const exports = {};
  vm.runInNewContext(code, { exports, window, document, navigator, Date: { now: () => now } });
  const manager = exports.startPwaUpdates(() => notices++);
  return { manager, sw, worker, registration, document, navigator, window, timers,
    stats: () => ({ checks, registrations, notices, reloads }),
    advance() { now += 31_000; },
  };
}

test('an installed update prompts; activation and reload require consent', async () => {
  const e = setup(); await tick();
  e.registration.installing = e.worker;
  e.registration.dispatchEvent(new Event('updatefound'));
  e.registration.waiting = e.worker;
  e.worker.state = 'installed'; e.worker.dispatchEvent(new Event('statechange'));
  assert.equal(e.stats().notices, 1); assert.equal(e.stats().reloads, 0);
  const pending = e.manager.applyUpdate().catch(() => {});
  assert.equal(e.worker.messages[0].type, 'SKIP_WAITING');
  assert.equal(e.stats().reloads, 0);
  e.sw.controller = {}; e.sw.dispatchEvent(new Event('controllerchange'));
  assert.equal(e.stats().reloads, 1);
  e.manager.dispose(); await pending;
});

test('an update already waiting is offered on startup', async () => {
  const e = setup({ waiting: true }); await tick();
  assert.equal(e.stats().notices, 1); assert.equal(e.stats().reloads, 0);
  e.manager.dispose();
});

test('first installation does not prompt or reload', async () => {
  const e = setup({ first: true, waiting: true }); await tick();
  e.sw.controller = {}; e.sw.dispatchEvent(new Event('controllerchange'));
  assert.equal(e.stats().notices, 0); assert.equal(e.stats().reloads, 0);
  e.manager.dispose();
});

test('another tab activating an update preserves this page until consent', async () => {
  const e = setup(); await tick();
  e.sw.controller = {}; e.sw.dispatchEvent(new Event('controllerchange'));
  assert.equal(e.stats().notices, 1); assert.equal(e.stats().reloads, 0);
  await e.manager.applyUpdate(); assert.equal(e.stats().reloads, 1);
  e.manager.dispose();
});

test('foreground checks are throttled, offline/background skipped, and disposed listeners removed', async () => {
  const e = setup(); await tick();
  e.window.dispatchEvent(new Event('focus')); await tick(); assert.equal(e.stats().checks, 1);
  e.advance(); e.document.visibilityState = 'hidden';
  e.document.dispatchEvent(new Event('visibilitychange')); await tick(); assert.equal(e.stats().checks, 1);
  e.document.visibilityState = 'visible'; e.document.dispatchEvent(new Event('visibilitychange'));
  await tick(); assert.equal(e.stats().checks, 2);
  e.advance(); e.navigator.onLine = false; e.window.dispatchEvent(new Event('focus'));
  await tick(); assert.equal(e.stats().checks, 2);
  e.navigator.onLine = true; e.window.dispatchEvent(new Event('online'));
  await tick(); assert.equal(e.stats().checks, 3);
  e.manager.dispose(); e.advance(); e.window.dispatchEvent(new Event('focus'));
  await tick(); assert.equal(e.stats().checks, 3); assert.equal(e.timers.size, 0);
});

test('offline startup recovers on reconnect; failures remain retryable', async () => {
  const e = setup({ offline: true, fail: true }); await tick();
  assert.equal(e.stats().registrations, 0);
  e.navigator.onLine = true; e.window.dispatchEvent(new Event('online')); await tick();
  assert.equal(e.stats().checks, 1);
  e.advance(); e.window.dispatchEvent(new Event('focus')); await tick();
  assert.equal(e.stats().checks, 2); e.manager.dispose();
});

test('activation timeout reports failure and cancels automatic reload consent', async () => {
  const e = setup({ waiting: true }); await tick();
  const pending = e.manager.applyUpdate();
  const rejected = assert.rejects(pending, /plus de temps/);
  [...e.timers.values()].at(-1)(); await rejected;
  e.sw.controller = {}; e.sw.dispatchEvent(new Event('controllerchange'));
  assert.equal(e.stats().reloads, 0);
  await e.manager.applyUpdate(); assert.equal(e.stats().reloads, 1);
  e.manager.dispose();
});


test('one accepted update reloads only once despite further controller changes or clicks', async () => {
  const e = setup({ waiting: true }); await tick();
  const pending = e.manager.applyUpdate().catch(() => {});
  e.sw.controller = {}; e.sw.dispatchEvent(new Event('controllerchange'));
  e.sw.controller = {}; e.sw.dispatchEvent(new Event('controllerchange'));
  await e.manager.applyUpdate();
  assert.equal(e.stats().reloads, 1);
  e.manager.dispose(); await pending;
});
