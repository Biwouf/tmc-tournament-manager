import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { extractTenupCompetition } from '../services/tenup-worker/parse-competition.mjs';
import { createHandler } from '../services/tenup-worker/server.mjs';
import { normalizeTenupCompetitionUrl } from '../shared/tenupCompetitionUrl.mjs';
// Reduced public championship rendering observed on September 30, 2026.
const html = `<main><h2>Challenge Féminin Max Espiaut de Valence d'Agen</h2><h3>Format</h3>
<p><span>Simple : </span>1 - 3 sets à 6 jeux</p>
<p><span>Double : </span>4 - 2 sets à 6 jeux ; pt décisif ; 3ème set = SJD à 10 pts</p>
<p><span>Rencontres : </span>3 simples / 1 double</p>
<p><span>Double supplémentaire en cas d'égalité : </span>Non</p>
<h3>Points par match</h3><p><span>Nombre de points pour un simple : </span>1 point</p>
<p><span>Nombre de points pour un double : </span>2 points</p>
<p><span>Point de bonus pour les deux doubles gagnés : </span>Non</p></main>`;
const parse = value => extractTenupCompetition(new JSDOM(value).window.document);
test('championship links normalize query ordering and reject unsafe or incomplete links', () => {
 const base='https://tenup.fft.fr/championnat/82678463';
 assert.equal(normalizeTenupCompetitionUrl(base),base);
 assert.equal(normalizeTenupCompetitionUrl(` ${base}/?poule=513524&division=144146&phase=233672 `),`${base}?division=144146&phase=233672&poule=513524`);
 for (const value of [null,'https://evil.test/championnat/1',base+'?division=1',base+'?division=1&phase=2&poule=3&division=4',base+'?division=1&phase=2&poule=x',base+'?redirect=https://evil.test',base+'#fragment',base.replace('https:','http:'),base.replace('tenup.fft.fr','a:b@tenup.fft.fr'),base+'/rencontre/1']) assert.throws(()=>normalizeTenupCompetitionUrl(value),/Lien|lien/);
});
test('public championship prefill reads name and rules; unknown rules require manual review', () => {
 const result=parse(html);
 assert.equal(result.nom,"Challenge Féminin Max Espiaut de Valence d'Agen");
 assert.equal(result.format,'3S1D2');assert.equal(result.singles_set3_format,'normal');assert.deepEqual(result.warnings,[]);
 assert.equal(parse(html.replace('2 points','1 point')).format,'3S1D');
 assert.equal(parse(html.replace('1 - 3 sets à 6 jeux','2 - 2 sets à 6 jeux ; 3ème set = SJD à 10 pts')).singles_set3_format,'super_tiebreak');
 const unsupported=parse(html.replace('3 simples','5 simples').replace('1 - 3 sets à 6 jeux','Format inconnu'));
 assert.equal(unsupported.format,null);assert.equal(unsupported.singles_set3_format,null);assert.equal(unsupported.warnings.length,2);
 assert.equal(parse(html.replace('égalité : </span>Non','égalité : </span>Oui')).format,null);
 assert.equal(parse(html.replace('Double : </span>4','Double : </span>9')).format,null);
 assert.equal(parse(html.replace('3 simples / 1 double','inconnu')).format,null);
 assert.equal(parse(html.replace('2 points','3 points')).format,null);
 for(const value of ['<main><h2>Faute !</h2>500</main>',html.replace('<h3>Format</h3>','')]) assert.throws(()=>parse(value),/incomplète/);
});
test('worker accepts only public championship URLs for the competition mode', async () => {
 const calls=[];
 const handler=createHandler({token:'t'.repeat(32),extract:async(...args)=>{calls.push(args);return parse(html);}});
 const request=async input=>{
  let status,payload;
  await handler({method:'POST',url:'/extract',headers:{authorization:`Bearer ${'t'.repeat(32)}`},body:input},{writeHead:s=>{status=s},end:b=>{payload=JSON.parse(b)}});
  return {status,payload};
 };
 const url='https://tenup.fft.fr/championnat/82678463';
 assert.equal((await request({url,kind:'competition'})).status,200);
 assert.deepEqual(calls,[[url,'competition']]);
 assert.equal((await request({url,kind:'competition'})).status,200);assert.equal(calls.length,1);
 for(const input of [{url},{url,kind:'other'},{url:url+'?division=1',kind:'competition'},{url:'http://localhost',kind:'competition'}]) assert.equal((await request(input)).status,400);
});
