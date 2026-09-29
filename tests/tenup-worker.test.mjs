import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { JSDOM } from 'jsdom';
import { extractTenupPage } from '../services/tenup-worker/parse-page.mjs';
import { createHandler, validUrl } from '../services/tenup-worker/server.mjs';

// Reduced rendering of the September 2026 Ten'Up DOM, with fictitious names.
const row = (team, names, ranks, sets, css) => `<div class="${css}" type-resultat="S"><div>${names.map((name,i)=>`<div><p><span>${name}</span></p><span class="ring-tu-primary-dark">${ranks[i]}</span></div>`).join('')}<a href="/championnat/1/equipe/${team}">Club ${team}</a></div><div>${sets.map(n=>`<span>${n} <!----></span>`).join('')}</div></div>`;
const match = (type, slot, setsA=[6,6],setsB=[2,3]) => `<div><div><div><span>${type} ${slot}</span></div></div><div>${row('A',type==='Double'?['Anne MARTIN','Zoé DURAND']:['Anne MARTIN'],type==='Double'?['12','13']:['30'],setsA,'rounded-t-md')}${row('B',type==='Double'?['Jeanne DUPONT','Marie PERRIN']:['Jeanne DUPONT'],type==='Double'?['10','13']:['15/4'],setsB,'rounded-b-md')}</div></div>`;
const html = (matches=match('Simple',1)+match('Double',1)) => `<main><div capitaine><a href="/equipe/A">Club A</a></div><div capitaine><span>2</span></div><div capitaine><a href="/equipe/B">Club B</a></div><div capitaine><span>0</span></div><p>Date de la rencontre</p><p>27/09/2026</p><p>Équipe 1</p><p>Club A</p><p>Équipe 2</p><p>Club B</p>${matches}</main>`;
const parse = text => extractTenupPage(new JSDOM(text).window.document);

test('extracts actual DOM structure, separates doubles weights from rankings', () => {
 const result=parse(html());
 assert.equal(result.date,'2026-09-27');assert.deepEqual(result.teams,['Club A','Club B']);assert.deepEqual(result.scores,[2,0]);
 assert.deepEqual(result.lines[0].players_a,[{prenom:'Anne',nom:'MARTIN',classement:'30'}]);
 assert.equal(result.lines[1].players_a[0].classement,'30');
 assert.equal(result.lines[1].players_a[0].poids_double,'12');
 assert.equal(result.lines[1].players_a[1].classement,'Non renseigné');
 assert.deepEqual(result.lines[0].sets,[{a:6,b:2},{a:6,b:3}]);
 const ambiguous=parse(html(match('Simple',1)+match('Simple',2)+match('Double',1)));
 assert.equal(ambiguous.lines[2].players_a[0].classement,'Non renseigné','same name in multiple singles is ambiguous');
});
test('rejects queue, missing scores, unknown result kinds, duplicate slots and mismatched teams', () => {
 for(const page of ['<main>Queue</main>',html().replace('6 <!---->','—'),html().replace('type-resultat="S"','type-resultat="WO"'),html(match('Simple',1)+match('Simple',1)),html().replace('>Club A</a></div><div><span>6','>Club C</a></div><div><span>6')]) {
  assert.throws(()=>parse(page),/incomplète/);
 }
});
test('does not confuse tie-break annotations with games; reads a super tie-break as third set', () => {
 assert.deepEqual(parse(html(match('Simple',1,[6,4,2],[1,6,10]))).lines[0].sets,[{a:6,b:1},{a:4,b:6},{a:2,b:10}]);
 const source=html(match('Simple',1,[7,6],[6,3])).replace('7 <!---->','7 <sup>7</sup>').replace('6 <!----></span><span>3','6 <sup>5</sup></span><span>3');
 assert.deepEqual(parse(source).lines[0].sets[0],{a:7,b:6,tb_a:7,tb_b:5});
});
test('worker authenticates, restricts URLs, caches and bounds concurrency', async () => {
 const token='x'.repeat(32);let calls=0;let release;
 const server=createServer(createHandler({token,extract:async()=>{calls++;await new Promise(r=>{release=r});return {lines:[]};}}));
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const endpoint=`http://127.0.0.1:${server.address().port}/extract`;
 const url='https://tenup.fft.fr/championnat/1/division/2/phase/3/poule/4/rencontre/5';
 const req=(body,auth=token)=>fetch(endpoint,{method:'POST',headers:{Authorization:`Bearer ${auth}`},body:JSON.stringify(body)});
 try {
  assert.equal((await req({url},'wrong')).status,401);
  for(const value of ['http://localhost',url+'?x=y',url.replace('tenup.fft.fr','tenup.fft.fr.evil.test'),url.replace('https://','https://a:b@')]) {
   assert.equal(validUrl(value),false);assert.equal((await req({url:value})).status,400);
  }
  const first=req({url});
  while(!release) await new Promise(r=>setTimeout(r,5));
  assert.equal((await req({url})).status,429);release();assert.equal((await first).status,200);
  assert.equal((await req({url})).status,200);assert.equal(calls,1);
 } finally { await new Promise(r=>server.close(r)); }
});
