import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir, rm } from 'node:fs/promises';
test('championship edge authorizes before extraction, ignores client draft and never writes privileged records',async()=>{
 const dir=new URL('../node_modules/.tmp/competition-edge/',import.meta.url);await mkdir(dir,{recursive:true});
 const out=new URL('edge.mjs',dir);
 await build({entryPoints:[new URL('../supabase/functions/tenup-sync/index.ts',import.meta.url).pathname],outfile:out.pathname,bundle:true,platform:'node',format:'esm',plugins:[{name:'supabase-mock',setup(b){b.onResolve({filter:/^https:/},()=>({path:'supabase',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:'export const createClient=(...args)=>globalThis.__competitionClient(...args);'}));}}]});
 const previous={fetch:globalThis.fetch,Deno:globalThis.Deno,client:globalThis.__competitionClient};
 let handler,denied=false,authError=false,fetched=0,configured=true,payload={nom:'Challenge féminin',format:'3S1D2',singles_set3_format:'normal',warnings:[]};
 let workerEndpoint='https://worker.example', expectedWorkerUrl='https://worker.example/extract', bypassToken;
 const url='https://tenup.fft.fr/championnat/82678463?division=144146&phase=233672&poule=513524';
 const body={kind:'competition',club_id:'00000000-0000-0000-0000-000000000001',saison_id:'00000000-0000-0000-0000-000000000010',url,nom:'Client malicious',payload:{nom:'Client malicious'}};
 globalThis.Deno={serve:fn=>{handler=fn},env:{get:key=>key==='TENUP_WORKER_URL'?(configured?workerEndpoint:undefined):key==='TENUP_WORKER_TOKEN'?'secret-not-for-client':key==='TENUP_WORKER_BYPASS_TOKEN'?bypassToken:key}};
 globalThis.__competitionClient=(_url,key)=>{assert.notEqual(key,'SUPABASE_SERVICE_ROLE_KEY');return {auth:{getUser:async()=>({data:{user:authError?null:{id:'actor'}},error:authError})},rpc:async(name,args)=>{assert.equal(name,'team_tenup_competition_begin');assert.deepEqual(args,{p_club:body.club_id,p_saison:body.saison_id,p_url:url});return {data:true,error:denied?{code:'42501',message:'Administration requise.'}:null}},from:()=>{assert.fail('no records should be created by prefill');}}};
 globalThis.fetch=async(url,options)=>{fetched++;assert.equal(String(url),expectedWorkerUrl);assert.equal(options.headers['x-vercel-protection-bypass'],bypassToken);assert.deepEqual(JSON.parse(options.body),{kind:'competition',url:'https://tenup.fft.fr/championnat/82678463'});assert.equal(options.headers.Authorization,'Bearer secret-not-for-client');return Response.json(payload)};
 const request=(value=body,auth=true)=>new Request('https://edge.example',{method:'POST',headers:auth?{Authorization:'Bearer user-token'}:{},body:JSON.stringify(value)});
 try {
  await import(out.href);
  assert.equal((await handler(request(body,false))).status,401);assert.equal(fetched,0);
  authError=true;assert.equal((await handler(request())).status,401);authError=false;
  denied=true;assert.equal((await handler(request())).status,403);assert.equal(fetched,0);denied=false;
  assert.equal((await handler(request({...body,url:'https://evil.test'}))).status,400);assert.equal(fetched,0);
  assert.equal((await handler(request(null))).status,400);
  configured=false;assert.equal((await handler(request())).status,503);configured=true;
  const response=await handler(request());assert.equal(response.status,200);assert.deepEqual(await response.json(),{url,...payload});
  workerEndpoint='https://worker.example/api/extract';expectedWorkerUrl=workerEndpoint;bypassToken='server-only-vercel-bypass';
  const direct=await handler(request());assert.equal(direct.status,200);
  const directBody=await direct.text();assert.equal(directBody.includes(bypassToken),false);assert.equal(directBody.includes('secret-not-for-client'),false);
  payload={nom:'Error page',format:'nonsense',singles_set3_format:null,warnings:[]};assert.equal((await handler(request())).status,502);
  globalThis.fetch=async()=>{throw new Error('private network information');};
  const failed=await handler(request());assert.equal(failed.status,502);assert.equal((await failed.text()).includes('private network information'),false);
 }finally{
  globalThis.fetch=previous.fetch;
  for(const [name,value]of [['Deno',previous.Deno],['__competitionClient',previous.client]]) {if(value===undefined)delete globalThis[name];else globalThis[name]=value;}
  await rm(dir,{recursive:true,force:true});
 }
});
