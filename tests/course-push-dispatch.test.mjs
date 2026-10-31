import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import ts from 'typescript';
import { readFile } from 'node:fs/promises';
const source = (await readFile(new URL('../supabase/functions/course-push-dispatch/index.ts',import.meta.url),'utf8')).replace(/^import .*;$/gm,'');
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
function harness({code,attempts=1,missing=false,finishError=false,endpoint='https://web.push.apple.com/endpoint',live=[],liveError=false,news=[]}={}) {
 let handler, claims=0; const sends=[], updates=[], deletes=[], tables=[];
 const secret='dedicated-push-cron-secret-32-characters';
 const env={COURSE_PUSH_CRON_SECRET:secret,SUPABASE_URL:'https://example.test',SUPABASE_SERVICE_ROLE_KEY:'runtime-key',
   VAPID_PUBLIC_KEY:'public',VAPID_PRIVATE_KEY:'private',VAPID_SUBJECT:'mailto:contact@example.test'};
 if(missing) delete env.VAPID_PRIVATE_KEY;
 const db={rpc:async(name)=>{claims++;if(name==='live_push_claim')return liveError?{error:{message:'missing'}}:{data:live};if(name==='content_push_claim')return {data:news};return {data:[{id:'job',claim_token:'lease',subscription_id:'sub',endpoint,
   p256dh:'key',auth_secret:'auth',title:'Cours',body:'Accepté',url:'/cours?course=42',attempts}]};},
   from:table=>({update:value=>{updates.push(value);tables.push(table);return {eq:()=>({eq:async()=>({error:finishError})})};},
     delete:()=>({eq:async(_,id)=>{deletes.push(id);return {error:null};}})})};
 vm.runInNewContext(compiled,{Deno:{env:{get:k=>env[k]},serve:fn=>{handler=fn;}},createClient:()=>db,
   webpush:{setVapidDetails(){},sendNotification:async(sub,payload,options)=>{sends.push({sub,payload:JSON.parse(payload),options});
     if(code)throw Object.assign(Error('provider error'),{statusCode:code});}},
   URL,Response,console:{error(){}}});
 return {sends,updates,deletes,tables,get claims(){return claims;},run:(auth=secret)=>handler(new Request('https://example.test',
   {method:'POST',headers:{'x-course-push-secret':auth,authorization:'Bearer gateway-jwt'}}))};
}
test('push requires dedicated cron authentication and valid configuration before claiming',async()=>{
 const h=harness(); assert.equal((await h.run('runtime-key')).status,401); assert.equal(h.claims,0);
 const absent=harness({missing:true}); assert.equal((await absent.run()).status,503); assert.equal(absent.claims,0);
});
test('push sends persisted payload with delivery identity and a bounded request timeout',async()=>{
 const h=harness(); assert.equal((await h.run()).status,200);
 assert.equal(h.sends[0].payload.id,'job'); assert.equal(h.sends[0].options.timeout,10000);
 assert.equal(h.updates[0].status,'sent');
});
test('provider failures retry, expire subscriptions, or terminate at the attempt limit',async()=>{
 for(const code of [429,500,403]){const h=harness({code});await h.run();assert.equal(h.updates[0].status,'pending');}
 for(const code of [404,410]){const h=harness({code});await h.run();assert.deepEqual(h.deletes,['sub']);}
 for(const options of [{code:400},{code:413},{code:500,attempts:5}]){const h=harness(options);await h.run();assert.equal(h.updates[0].status,'failed');}
});
test('unsupported endpoints never cause outbound requests and finish failures surface as HTTP 500',async()=>{
 for(const endpoint of ['https://127.0.0.1/private','https://fcm.googleapis.com.evil.example/push','http://web.push.apple.com/path']){
   const h=harness({endpoint});await h.run();assert.equal(h.sends.length,0);assert.equal(h.updates[0].status,'failed');
 }
 const h=harness({finishError:true});assert.equal((await h.run()).status,500);
});
test('live deliveries go first, carry tag and lifetime, and a live claim failure keeps courses flowing',async()=>{
 const live=Array.from({length:25},(_,i)=>({id:`live-${i}`,claim_token:'lease',subscription_id:'sub',endpoint:'https://fcm.googleapis.com/fcm/send/x',
   p256dh:'key',auth_secret:'auth',title:'Fin du 1er set',body:'Dupont 6-4 Martin',url:'/matches/1',tag:'live-1',ttl:900,attempts:1}));
 const h=harness({live}); const response=await h.run(); assert.equal(response.status,200);
 assert.deepEqual(await response.json(),{claimed:26,sent:26,failed:0});
 assert.equal(h.sends[0].payload.tag,'live-1'); assert.equal(h.sends[0].options.TTL,900);
 assert.equal(h.tables.filter(t=>t==='live_push_deliveries').length,25);
 assert.equal(h.tables.at(-1),'course_push_deliveries'); assert.equal(h.sends.at(-1).options.TTL,3600);
 const broken=harness({liveError:true}); assert.equal((await broken.run()).status,500);
 assert.equal(broken.sends.length,1); assert.equal(broken.updates[0].status,'sent');
});
test('news deliveries are sent after Live and before courses, with their tag and lifetime',async()=>{
 const news=[{id:'news-1',claim_token:'lease',subscription_id:'sub',endpoint:'https://fcm.googleapis.com/fcm/send/x',
   p256dh:'key',auth_secret:'auth',title:'Nouvelle actu',body:'Assemblée générale',url:'/actus/1',tag:'actu-1',ttl:86400,attempts:1}];
 const h=harness({news}); const response=await h.run(); assert.equal(response.status,200);
 assert.deepEqual(await response.json(),{claimed:2,sent:2,failed:0});
 assert.deepEqual(h.tables,['content_push_deliveries','course_push_deliveries']);
 assert.equal(h.sends[0].payload.url,'/actus/1'); assert.equal(h.sends[0].payload.tag,'actu-1');
 assert.equal(h.sends[0].options.TTL,86400);
});
