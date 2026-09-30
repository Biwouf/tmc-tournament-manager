import chromium from '@sparticuz/chromium';
import { createHandler, extract } from '../server.mjs';

let handler;
export default async function vercelExtract(req, res) {
  const token = process.env.TENUP_WORKER_TOKEN;
  if (!token || token.length < 32) {
    res.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({ error: 'Service non configuré.' }));
  }
  handler ??= createHandler({ token, extract: async url => extract(url, {
    executablePath: await chromium.executablePath(),
    args: chromium.args.filter(arg => arg !== '--disable-web-security'),
    // Serverless Chromium relies on the hosting platform's isolation.
    // The standalone Docker entry point keeps Chromium's own sandbox enabled.
    chromiumSandbox: false,
    timeout: 10_000,
  }) });
  req.url = '/extract';
  return handler(req, res);
}
