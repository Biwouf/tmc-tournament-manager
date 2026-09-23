import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
const shared = {};
const template = await readFile(new URL('../supabase/functions/_shared/email-template.ts', import.meta.url), 'utf8');
vm.runInNewContext(ts.transpileModule(template, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, { exports: shared, URL });
const source = (await readFile(new URL('../supabase/functions/course-email-dispatch/index.ts',import.meta.url),'utf8'))
  .replace(/^import .*;$/gm,'');
function harness({ code=201, attempts=1, missing=false, network=false, lookup=false, body='Votre place est confirmée.', settingsError=false, deliveryError=false, brand={ color:'#123456', logo:'https://club.example/logo.png' }, cronSecret='dedicated-cron-secret-at-least-32-characters' }={}) {
 let handler; let claims=0; const updates=[]; const sends=[]; const reads=[];
 const env={COURSE_EMAIL_CRON_SECRET:cronSecret,SUPABASE_SERVICE_ROLE_KEY:'server-secret',SUPABASE_URL:'https://example.test',
  BREVO_API_KEY:'brevo-secret',CONTACT_FROM_EMAIL:'sender@example.test'};
 if(missing) delete env.BREVO_API_KEY;
 const db={rpc:async()=>{claims++;return {data:[{id:'job',claim_token:'token',user_id:'member',
  title:'Place accordée',body,club_name:'Club',attempts}]};},
 auth:{admin:{getUserById:async()=>({data:{user:{email:'member@example.test'}},error:lookup?new Error():null})}},
 from:(table)=>({
  select:(columns)=>{
   const filters={};
   const result=()=>{reads.push({table,columns,filters});return table==='course_email_deliveries'
    ? {data:{club_id:'club-from-job'},error:deliveryError?new Error():null}
    : {data:brand===null?null:{config:{brand}},error:settingsError?new Error():null};};
   const query={eq:(key,value)=>{filters[key]=value;return query;},single:async()=>result(),maybeSingle:async()=>result()};
   return query;
  },
  update:(value)=>{updates.push(value);return {eq:()=>({eq:async()=>({error:null})})};}
 })};
 vm.runInNewContext(source,{Deno:{env:{get:key=>env[key]},serve:fn=>{handler=fn;}},
  renderEmail:shared.renderEmail, createClient:()=>db,Response,AbortSignal,console:{error(){}},
  fetch:async(url,options)=>{sends.push({url,body:JSON.parse(options.body)});
   if(network)throw new Error('timeout'); return new Response('',{status:code});}});
 return {run:(auth='dedicated-cron-secret-at-least-32-characters',method='POST')=>handler(new Request('https://example.test',{
  method,headers:{authorization:'Bearer independently-validated-gateway-jwt','x-course-email-secret':auth}})),updates,sends,reads,get claims(){return claims;}};
}
test('dispatcher rejects callers and missing configuration before claiming',async()=>{
 const h=harness(); assert.equal((await h.run('user-token')).status,401);
 assert.equal((await h.run('server-secret','GET')).status,405); assert.equal(h.claims,0);
 const missing=harness({missing:true}); assert.equal((await missing.run()).status,503); assert.equal(missing.claims,0);
});
test('dispatcher uses server recipient and records Brevo acceptance',async()=>{
 const h=harness(); assert.equal((await h.run()).status,200);
 assert.equal(h.sends[0].body.to[0].email,'member@example.test');
 assert.equal(h.sends[0].body.sender.email,'sender@example.test');
 assert.equal(h.updates[0].status,'sent'); assert.ok(h.updates[0].sent_at);
});
test('dispatcher retries transient failures and stops at its retry limit',async()=>{
 for(const options of [{code:429},{code:503},{network:true},{lookup:true}]){
  const h=harness(options); await h.run(); assert.equal(h.updates[0].status,'pending');
 }
 const exhausted=harness({network:true,attempts:5}); await exhausted.run(); assert.equal(exhausted.updates[0].status,'failed');
 const permanent=harness({code:400}); await permanent.run(); assert.equal(permanent.updates[0].status,'failed');
});

test('cron authentication is independent of the runtime service key and fails closed',async()=>{
 const h=harness();
 assert.equal((await h.run('server-secret')).status,401);
 assert.equal((await h.run('')).status,401);
 assert.equal(h.claims,0);
 assert.equal((await h.run()).status,200);
 for(const cronSecret of ['', 'short']){
  const missing=harness({cronSecret});
  assert.equal((await missing.run()).status,503);
  assert.equal(missing.claims,0);
 }
});

test('course HTML uses the claimed club identity and preserves plain text',async()=>{
 const h=harness(); await h.run();
 const body=h.sends[0].body;
 assert.equal(body.subject,'Place accordée');
 assert.equal(body.textContent,'Votre place est confirmée.');
 assert.match(body.htmlContent,/#123456/);
 assert.match(body.htmlContent,/https:\/\/club.example\/logo.png/);
 assert.match(body.htmlContent,/Votre place est confirmée/);
 assert.equal(h.reads[0].filters.id,'job');
 assert.equal(h.reads[0].filters.claim_token,'token');
 assert.equal(h.reads[1].filters.club_id,'club-from-job');
});
test('missing club settings falls back to a neutral template',async()=>{
 const h=harness({brand:null}); await h.run();
 assert.equal(h.updates[0].status,'sent');
 assert.match(h.sends[0].body.htmlContent,/#334155/);
 assert.doesNotMatch(h.sends[0].body.htmlContent,/<img/);
});
test('identity lookup failures retry without sending an unbranded email',async()=>{
 for(const options of [{settingsError:true},{deliveryError:true}]){
  const h=harness(options); await h.run();
  assert.equal(h.updates[0].status,'pending'); assert.equal(h.sends.length,0);
 }
});

test('refusal reason survives the branded HTML and plain text with safe line breaks',async()=>{
 const body='Votre demande a été refusée.\n\nMotif du refus : Groupe complet & niveau <avancé>\nAutre créneau conseillé.\n\nConnectez-vous à l’application du club.';
 const h=harness({body}); await h.run();
 assert.equal(h.updates[0].status,'sent');
 assert.equal(h.sends[0].body.textContent,body);
 assert.match(h.sends[0].body.htmlContent,/Motif du refus : Groupe complet &amp; niveau &lt;avancé&gt;<br>Autre créneau conseillé/);
 assert.doesNotMatch(h.sends[0].body.htmlContent,/<avancé>/);
});
