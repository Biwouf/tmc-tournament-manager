import { extract, validUrl } from './server.mjs';
const url = process.argv[2];
if (!validUrl(url)) throw new Error('Fournir une URL de rencontre Ten’Up complète.');
try {
  const sheet = await extract(url);
  console.log(JSON.stringify({ date: sheet.date, matches: sheet.lines.length, scores: sheet.scores }));
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
}
