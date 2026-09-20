import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<div id="root"></div>', {url:'https://club.example/inscription'});
globalThis.window=dom.window;globalThis.document=dom.window.document;globalThis.HTMLElement=dom.window.HTMLElement;globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const base=resolve(new URL('..',import.meta.url).pathname);
const req=createRequire(resolve(base,'pwa/package.json'));
const {act,createElement:h}=req('react');const {createRoot}=req('react-dom/client');const {MemoryRouter}=req('react-router-dom');
function fixture() {
 const calls=[];let failure=null;let rpcFailure=null;let pending=null;let hasSession=true;let root;let destination;
 const api={auth:{async signUp(...args){calls.push(['signup',...args]);if(pending)await pending;return {data:{user:{identities:[{}]},session:hasSession?{}:null},error:failure};}},async rpc(...args){calls.push(['rpc',...args]);return {error:rpcFailure};}};
 const cache=new Map();
 function load(file) {
  if(file.endsWith('/lib/supabase.ts'))return {supabase:api};
  if(file.endsWith('/hooks/useAuth.ts'))return {useAuth:()=>({user:null,loading:false})};
  if(file.endsWith('/contexts/ClubContext.tsx'))return {useClub:()=>({clubId:'club-1'})};
  if(cache.has(file))return cache.get(file).exports;
  const module={exports:{}};cache.set(file,module);
  const code=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  const require=name=>{if(name==='@tanstack/react-query')return {useQueryClient:()=>({invalidateQueries:async()=>{calls.push(['invalidate']);}})};
   if(name==='react-router-dom')return {...req(name),useNavigate:()=>path=>{destination=path;}};
   if(!name.startsWith('.'))return req(name);const p=resolve(dirname(file),name);return load([p,p+'.ts',p+'.tsx'].find(existsSync));};
  vm.runInThisContext(`(function(require,module,exports){${code}\n})`,{filename:file})(require,module,module.exports);return module.exports;
 }
 const helper=load(resolve(base,'pwa/src/lib/signup.ts'));const Page=load(resolve(base,'pwa/src/pages/SignupPage.tsx')).default;
 return {calls,helper,get destination(){return destination;},set failure(x){failure=x;},set rpcFailure(x){rpcFailure=x;},set pending(x){pending=x;},set hasSession(x){hasSession=x;},
 async mount(path='/inscription'){await act(async()=>{root=createRoot(document.getElementById('root'));root.render(h(MemoryRouter,{initialEntries:[path]},h(Page)));});},
 async close(){await act(async()=>root.unmount());},
 async change(id,value){const el=document.getElementById('signup-'+id);await act(async()=>el[Object.keys(el).find(k=>k.startsWith('__reactProps'))].onChange({target:{value}}));},
 async fill(){for(const [key,value]of Object.entries({prenom:' Alice ',nom:' Dupont ',email:'alice@example.test',sex:'female',password:'password123',confirm:'password123',classement:'3/6'}))await this.change(key,value);},
 async submit(){await act(async()=>document.querySelector('form').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true})));}
 };
}
test('signup client: validation before network, single submission, signUp → RPC → navigation',async()=>{
 const f=fixture();await f.mount('/inscription?returnTo=%2Fcours%3Fview%3Dmine');try {
  await f.submit();assert.equal(f.calls.length,0);await f.fill();
  await f.change('confirm','wrong');await f.submit();assert.equal(f.calls.length,0);assert.match(document.body.textContent,/ne correspondent pas/);await f.change('confirm','password123');
  let release;f.pending=new Promise(r=>{release=r;});await f.submit();await f.submit();assert.equal(f.calls.length,1);assert.equal(document.querySelector('form').getAttribute('aria-busy'),'true');
  await act(async()=>{release();});assert.deepEqual(f.calls.map(x=>x[0]),['signup','rpc','invalidate']);assert.equal(f.calls[0][1].options.data.club_signup.prenom,'Alice');assert.equal(f.calls[1][2].p_classement,'3/6');assert.equal(f.destination,'/cours?view=mine');
 }finally{await f.close();}
});
test('signup client: RPC retry does not recreate Auth account; email confirmation fallback and errors',async()=>{
 const f=fixture();await f.mount();try{
  await f.fill();f.rpcFailure={status:503};await f.submit();assert.equal(f.destination,undefined);const key=f.calls[1][2].p_request_id;
  f.rpcFailure=null;await f.submit();assert.equal(f.calls.filter(x=>x[0]==='signup').length,1);assert.equal(f.calls[2][2].p_request_id,key);assert.equal(f.destination,'/actu');
 }finally{await f.close();}
 const g=fixture();g.hasSession=false;await g.mount();try{await g.fill();await g.submit();assert.match(document.body.textContent,/Vérifiez votre boîte mail/);assert.equal(g.calls.length,1);}finally{await g.close();}
 for(const [failure,pattern]of [[{code:'weak_password'},/trop faible/],[{status:429},/Trop de demandes/],[{code:'user_already_exists'},/déjà un compte/],[{status:503},/Connexion impossible/]]){
  const f=fixture();f.failure=failure;await f.mount();try{await f.fill();await f.submit();assert.match(document.body.textContent,pattern);assert.equal(f.calls.length,1);}finally{await f.close();}
 }
});
test('signup client: shared ranking order and safe returnTo',()=>{
 const f=fixture();assert.deepEqual([...f.helper.TENNIS_RANKINGS],['NC','40','30/5','30/4','30/3','30/2','30/1','30','15/5','15/4','15/3','15/2','15/1','15','5/6','4/6','3/6','2/6','1/6','0','-2/6','-4/6','-15']);
 for(const path of ['//evil.test','https://evil.test','/cours/evil','/coursx',null])assert.equal(f.helper.signupReturnTo(path),'/actu');
});
