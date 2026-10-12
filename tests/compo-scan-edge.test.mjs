import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir, rm } from 'node:fs/promises';

test('compo-scan checks membership and quota before calling Claude, and only returns validated singles', async()=>{
 const dir=new URL('../node_modules/.tmp/compo-scan-edge/',import.meta.url);await mkdir(dir,{recursive:true});
 const out=new URL('edge.mjs',dir);
 await build({entryPoints:[new URL('../supabase/functions/compo-scan/index.ts',import.meta.url).pathname],outfile:out.pathname,bundle:true,platform:'node',format:'esm',
  plugins:[{name:'mocks',setup(b){
   b.onResolve({filter:/^https:/},()=>({path:'supabase',namespace:'mock'}));
   b.onResolve({filter:/^npm:@anthropic-ai\/sdk/},()=>({path:'anthropic',namespace:'mock'}));
   b.onLoad({filter:/^supabase$/,namespace:'mock'},()=>({contents:'export const createClient=(...args)=>globalThis.__scanClient(...args);'}));
   b.onLoad({filter:/^anthropic$/,namespace:'mock'},()=>({contents:`class RateLimitError extends Error {}
    export default class Anthropic { static RateLimitError=RateLimitError; constructor(options){ globalThis.__scanOptions=options; this.beta={messages:{create:p=>globalThis.__scanCreate(p)}}; } }`}));
  }}]});
 const previous={Deno:globalThis.Deno};
 let handler,user={id:'actor'},rpcError=null,rpcCalls=0,key='sk-secret',params=null;
 let reply={stop_reason:'end_turn',content:[{type:'thinking',thinking:''},{type:'text',text:JSON.stringify({joueurs:[
  {ordre:2,prenom:' Marie ',nom:'CALLOT',classement:'30/3'},
  {ordre:1,prenom:'Andrey',nom:'Guy',classement:'30/2'},
  {ordre:12,prenom:'Hors',nom:'Format',classement:null},
  {ordre:3,prenom:'',nom:'',classement:'30/5'},
  {ordre:4,prenom:'Lucie',nom:'Olive',classement:'99/9'},
 ]})}]};
 globalThis.Deno={serve:fn=>{handler=fn},env:{get:name=>name==='ANTHROPIC_API_KEY'?key:name}};
 globalThis.__scanClient=()=>({auth:{getUser:async()=>({data:{user},error:user?null:{message:'expired'}})},rpc:async(name,args)=>{rpcCalls++;assert.equal(name,'team_compo_scan_begin');assert.deepEqual(args,{p_club:body.club_id});return {error:rpcError};}});
 let created=0;
 globalThis.__scanCreate=async p=>{created++;params=p;if(reply instanceof Error)throw reply;return reply;};
 const body={club_id:'00000000-0000-0000-0000-000000000001',media_type:'image/jpeg',image:'/9j/4AAQSkZJRg=='};
 const request=(payload=body,auth=true)=>new Request('https://edge.example',{method:'POST',headers:auth?{Authorization:'Bearer user-token'}:{},body:typeof payload==='string'?payload:JSON.stringify(payload)});
 try {
  await import(out.href);
  assert.equal((await handler(request(body,false))).status,401);
  user=null;assert.equal((await handler(request())).status,401);user={id:'actor'};
  key=undefined;assert.equal((await handler(request())).status,503);key='sk-secret';
  assert.equal((await handler(request({...body,media_type:'image/gif'}))).status,400);
  assert.equal((await handler(request({...body,image:'<script>'}))).status,400);
  assert.equal((await handler(request('x'.repeat(1_500_001)))).status,413);
  assert.equal(rpcCalls,0);assert.equal(created,0,'nothing reaches Claude before identity and input are checked');
  rpcError={code:'42501',message:'Accès membre requis.'};assert.equal((await handler(request())).status,403);
  rpcError={code:'PT429',message:'Trop de lectures de feuille.'};
  const limited=await handler(request());assert.equal(limited.status,429);assert.match((await limited.json()).error,/Trop de lectures/);
  rpcError=null;assert.equal(created,0,'refused or over quota: no paid call');

  const response=await handler(request());assert.equal(response.status,200);
  assert.deepEqual((await response.json()).joueurs,[
   {ordre:2,prenom:'Marie',nom:'CALLOT',classement:'30/3'},
   {ordre:1,prenom:'Andrey',nom:'Guy',classement:'30/2'},
   {ordre:4,prenom:'Lucie',nom:'Olive',classement:null},
  ]);
  assert.equal(globalThis.__scanOptions.apiKey,'sk-secret');
  assert.equal(params.model,'claude-opus-5-5');
  assert.equal(params.output_config.format.type,'json_schema');
  assert.deepEqual(params.messages[0].content[0].source,{type:'base64',media_type:'image/jpeg',data:body.image});

  reply={stop_reason:'refusal',content:[]};
  const refused=await handler(request());assert.equal(refused.status,502);
  reply=new Error('upstream sk-secret');
  const failed=await handler(request());assert.equal(failed.status,502);assert.equal((await failed.text()).includes('sk-secret'),false);
 } finally {
  if(previous.Deno===undefined)delete globalThis.Deno;else globalThis.Deno=previous.Deno;
  delete globalThis.__scanClient;delete globalThis.__scanCreate;delete globalThis.__scanOptions;
  await rm(dir,{recursive:true,force:true});
 }
});
