import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { JSDOM } from 'jsdom';
import { extractTenupPage } from '../services/tenup-worker/parse-page.mjs';
import { createHandler, validUrl } from '../services/tenup-worker/server.mjs';

// Reduced rendering of the October 2026 Ten'Up DOM, with fictitious names.
const badge = value => `<span data-slot="badge">${value}</span>`;
const row = (team, names, ranks, sets, css) => `<div class="${css}"><div><div>${names.map((name,i)=>`<div><span data-slot="avatar"><span data-slot="avatar-fallback">${name.split(' ').map(w=>w[0]).join('')}</span></span><div><span class="block truncate">${name}</span></div>${badge(ranks[i])}${badge('<svg></svg>')}</div>`).join('')}<p>Club ${team}</p></div></div><div>${sets.map(n=>`<span>${n}</span>`).join('')}</div></div>`;
const match = (type, slot, setsA=[6,6],setsB=[2,3]) => `<div><div><svg></svg><div><span>${type} ${slot}</span></div></div><div class="relative">${row('A',type==='Double'?['Anne MARTIN','Zoé DURAND']:['Anne MARTIN'],type==='Double'?['12','13']:['30'],setsA,'rounded-t-md')}${row('B',type==='Double'?['Jeanne DUPONT','Marie PERRIN']:['Jeanne DUPONT'],type==='Double'?['10','13']:['15/4'],setsB,'rounded-b-md')}${badge('<svg></svg>')}</div></div>`;
const team = (id, score) => `<div><div><div><div><a href="/championnat/1/equipe/${id}">Club ${id}</a><svg></svg></div></div></div><div><div><span>${score}</span></div></div></div>`;
const html = (matches=match('Simple',1)+match('Double',1)) => `<main><h1>Rencontre Club A / Club B du 27/09/2026</h1><div>${team('A',2)}${team('B',0)}</div><div role="tabpanel">${matches}</div></main>`;
const parse = text => extractTenupPage(new JSDOM(text).window.document);

test('extracts actual DOM structure, separates doubles weights from rankings', () => {
 const result=parse(html());
 assert.equal(result.date,'2026-09-27');assert.deepEqual(result.teams,['Club A','Club B']);assert.deepEqual(result.scores,[2,0]);
 assert.deepEqual(result.lines[0].players_a,[{prenom:'Anne',nom:'MARTIN',classement:'30'}]);
 assert.equal(result.lines[1].players_a[0].classement,'30');
 assert.equal(result.lines[1].players_a[0].poids_double,'12');
 assert.equal(result.lines[1].players_a[1].classement,'30/1','weight 13 without a single maps to 30/1');
 assert.equal(result.lines[1].players_b[1].poids_double,'13');
 const unknown=parse(html().replace(/>13</g,'>19<'));
 assert.equal(unknown.lines[1].players_a[1].classement,'Non renseigné','weight outside 1..18 (NC?) stays unknown');
 assert.deepEqual(result.lines[0].sets,[{a:6,b:2},{a:6,b:3}]);
 const ambiguous=parse(html(match('Simple',1)+match('Simple',2)+match('Double',1)));
 assert.equal(ambiguous.lines[2].players_a[0].classement,'30','same name in multiple singles is ambiguous: fall back to weight 12');
});
test('rejects queue, missing scores, unknown result kinds, duplicate slots and mismatched teams', () => {
 for(const page of ['<main>Queue</main>',html().replace('<span>6</span>','<span>—</span>'),html().replace('<p>Club B</p>','<p>Club B</p>'+badge('WO')),html().replace('<p>Club B</p>','<p>Club B</p><span>Abandon</span>'),html(match('Simple',1)+match('Simple',1)),html().replace('<p>Club A</p>','<p>Club C</p>'),html().replace(' du 27/09/2026',''),html().replace('<span>0</span>','<span>—</span>')]) {
  assert.throws(()=>parse(page),/incomplète/);
 }
});
test('does not confuse tie-break annotations with games; reads a super tie-break as third set', () => {
 assert.deepEqual(parse(html(match('Simple',1,[6,4,2],[1,6,10]))).lines[0].sets,[{a:6,b:1},{a:4,b:6},{a:2,b:10}]);
 const source=html(match('Simple',1,[7,6],[6,3])).replace('<span>7</span>','<span>7<sup>7</sup></span>').replace('<span>6</span><span>3</span>','<span>6<sup>5</sup></span><span>3</span>');
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

// Vercel may consume the request stream and provide an already parsed body.
test('worker accepts Vercel parsed bodies with the same authentication and size limits', async () => {
 const token='v'.repeat(32);
 const url='https://tenup.fft.fr/championnat/1/division/2/phase/3/poule/4/rencontre/5';
 let calls=0;
 const handler=createHandler({token,extract:async()=>{calls++;return {lines:[]};}});
 const request=async(body,auth=token)=>{
  let status;let result;
  await handler({method:'POST',url:'/extract',headers:{authorization:`Bearer ${auth}`},body},
   {writeHead:code=>{status=code;},end:body=>{result=JSON.parse(body);}});
  return {status,result};
 };
 assert.equal((await request({url},'wrong')).status,401);
 assert.equal((await request(null)).status,400);
 assert.equal((await request({url,extra:'é'.repeat(2048)})).status,413);
 assert.equal((await request({url})).status,200);
 assert.equal((await request(JSON.stringify({url}))).status,200);
 assert.equal(calls,1);
});

test('Vercel entry fails closed before launching Chromium when unconfigured or unauthenticated', async () => {
 const {default:handler}=await import('../services/tenup-worker/api/extract.mjs');
 const previous=process.env.TENUP_WORKER_TOKEN;
 const request=async()=>{
  let status;
  await handler({method:'POST',headers:{},body:{}},{writeHead:code=>{status=code;},end:()=>{}});
  return status;
 };
 try {
  delete process.env.TENUP_WORKER_TOKEN;
  assert.equal(await request(),503);
  process.env.TENUP_WORKER_TOKEN='t'.repeat(32);
  assert.equal(await request(),401);
 } finally {
  if(previous===undefined) delete process.env.TENUP_WORKER_TOKEN;
  else process.env.TENUP_WORKER_TOKEN=previous;
 }
});
