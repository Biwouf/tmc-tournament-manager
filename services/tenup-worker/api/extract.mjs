import chromium from '@sparticuz/chromium';
import { createHandler, extract } from '../server.mjs';

// Same lookup as `waitUntil` in @vercel/functions, without its dependencies.
const waitUntil = (promise) => globalThis[Symbol.for('@vercel/request-context')]?.get?.()?.waitUntil?.(promise);

let handler;
export default async function vercelExtract(req, res) {
  const token = process.env.TENUP_WORKER_TOKEN;
  if (!token || token.length < 32) {
    res.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({ error: 'Service non configuré.' }));
  }
  // A wedged or saturated Chromium leaves orphan processes in this instance: exit once the reply
  // is sent, so Vercel serves the next call from a fresh instance instead of failing it.
  // `waitUntil` keeps the instance running after the reply; without it the exit only ran when
  // the next call thawed the instance, and killed that call (13/11/2026).
  // The promise must settle: Fluid compute stops a process only once its invocations are done,
  // and a pending one kept the instance alive until the 60 s timeout, serving the next reads
  // with the same saturated Chromium (14/11/2026).
  handler ??= createHandler({ token, onFatal: (message) => {
    console.error('[tenup-worker] recycling instance', { reason: message.slice(0, 200) });
    waitUntil(new Promise((resolve) => setTimeout(() => { resolve(); process.exit(1); }, 100)));
  }, extract: async (url, kind) => extract(url, {
    executablePath: await chromium.executablePath(),
    args: chromium.args.filter(arg => arg !== '--disable-web-security'),
    // Serverless Chromium relies on the hosting platform's isolation.
    // The standalone Docker entry point keeps Chromium's own sandbox enabled.
    chromiumSandbox: false,
    timeout: 10_000,
  }, kind) });
  req.url = '/extract';
  return handler(req, res);
}
