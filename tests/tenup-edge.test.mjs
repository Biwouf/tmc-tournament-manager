import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir, rm } from 'node:fs/promises';

test('edge verifies identity before worker access and never accepts client-provided scores', async()=>{
 const dir=new URL('../node_modules/.tmp/tenup-edge/',import.meta.url);await mkdir(dir,{recursive:true});
 const out=new URL('edge.mjs',dir);
 await build({entryPoints:[new URL('../supabase/functions/tenup-sync/index.ts',import.meta.url).pathname],outfile:out.pathname,bundle:true,platform:'node',format:'esm',plugins:[{name:'supabase-mock',setup(b){b.onResolve({filter:/^https:/},()=>({path:'supabase',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:'export const createClient=(...args)=>globalThis.__tenupClient(...args);'}));}}]});
 const previous={fetch:globalThis.fetch,Deno:globalThis.Deno,client:globalThis.__tenupClient};
 let handler, authError=false, rpcError=null, configured=true, fetched=0, stored=null;
 let workerEndpoint='https://worker.example', expectedWorkerUrl='https://worker.example/extract', bypassToken;
 const payload={date:'2026-09-27',teams:['Club A','Club B'],scores:[3,1],lines:[]};
 globalThis.Deno={serve:fn=>{handler=fn},env:{get:key=>key==='TENUP_WORKER_URL'?(configured?workerEndpoint:undefined):key==='TENUP_WORKER_TOKEN'?'secret-not-for-client':key==='TENUP_WORKER_BYPASS_TOKEN'?bypassToken:key}};
 globalThis.__tenupClient=()=>({auth:{getUser:async()=>({data:{user:authError?null:{id:'actor'}},error:authError})},rpc:async()=>({data:{id:'server-preview'},error:rpcError}),from:()=>({update:value=>{stored=value;return {eq:()=>({eq:async()=>({error:null})})};}})});
 globalThis.fetch=async(url,options)=>{fetched++;assert.equal(String(url),expectedWorkerUrl);assert.equal(options.headers['x-vercel-protection-bypass'],bypassToken);assert.equal(options.headers.Authorization,'Bearer secret-not-for-client');return Response.json(payload);};
 const body={club_id:'00000000-0000-0000-0000-000000000001',rencontre_id:'00000000-0000-0000-0000-000000000002',url:'https://tenup.fft.fr/championnat/1/division/2/phase/3/poule/4/rencontre/5',payload:{scores:[99,0]}};
 const request=(withAuth=true)=>new Request('https://edge.example',{method:'POST',headers:withAuth?{Authorization:'Bearer user-token'}:{},body:JSON.stringify(body)});
 try {
  await import(out.href);
  assert.equal((await handler(request(false))).status,401);assert.equal(fetched,0);
  authError=true;assert.equal((await handler(request())).status,401);assert.equal(fetched,0);authError=false;
  configured=false;assert.equal((await handler(request())).status,503);configured=true;
  rpcError={code:'42501',message:'Accès membre requis.'};assert.equal((await handler(request())).status,403);assert.equal(fetched,0);rpcError=null;
  const response=await handler(request());assert.equal(response.status,200);
  const result=await response.json();assert.equal(result.id,'server-preview');assert.deepEqual(stored,{payload});assert.deepEqual(result.scores,[3,1]);assert.equal(JSON.stringify(result).includes('secret-not-for-client'),false);
  workerEndpoint='https://worker.example/api/extract';expectedWorkerUrl=workerEndpoint;bypassToken='server-only-vercel-bypass';
  const direct=await handler(request());assert.equal(direct.status,200);
  const directBody=await direct.text();assert.equal(directBody.includes(bypassToken),false);assert.equal(directBody.includes('secret-not-for-client'),false);
  globalThis.fetch=async()=>{throw new Error('network secret');};
  const failed=await handler(request());assert.equal(failed.status,502);assert.equal((await failed.text()).includes('network secret'),false);
 } finally {
  globalThis.fetch=previous.fetch;
  if(previous.Deno===undefined)delete globalThis.Deno;else globalThis.Deno=previous.Deno;
  if(previous.client===undefined)delete globalThis.__tenupClient;else globalThis.__tenupClient=previous.client;
  await rm(dir,{recursive:true,force:true});
 }
});
