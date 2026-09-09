import { readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { renderRequest } from './render';
import { runtime } from './runtime';

const template = readFileSync(new URL('./template.html', import.meta.url), 'utf8');
export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const result = await renderRequest({ url: req.url || '/', host: req.headers.host || '', method: req.method }, template, runtime());
  res.writeHead(result.status, result.headers);
  res.end(req.method === 'HEAD' ? undefined : result.body);
}
