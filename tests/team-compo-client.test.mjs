import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { JSDOM } from 'jsdom';
const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost/'});
globalThis.window=dom.window;globalThis.document=dom.window.document;globalThis.IS_REACT_ACT_ENVIRONMENT=true;
dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
const req=createRequire(new URL('../pwa/package.json',import.meta.url));
const {createElement:h,act}=req('react');const {createRoot}=req('react-dom/client');
const {QueryClient,QueryClientProvider}=req('@tanstack/react-query');
const src=resolve(new URL('../pwa/src',import.meta.url).pathname);
const roster=[{id:'m1',prenom:'Marie',nom:'Callot',classement:'30/4'},{id:'m2',prenom:'Audrey',nom:'Guy',classement:'30/2'}];
let composed=null;let scanned=[];
const mocks={
 '/lib/supabase.ts':{supabase:{rpc:async name=>({data:name==='team_member_roster'?roster:[],error:null})}},
 '/lib/compoScan.ts':{scanCompoPhoto:async(club,file)=>{scanned.push([club,file.name]);if(file.name==='floue.jpg')throw new Error('La feuille n’a pas pu être lue.');
  return file.name==='eux.jpg'?[{ordre:1,prenom:'Melodie',nom:'RABOT',classement:'30/3'},{ordre:2,prenom:'Charlène',nom:'CHÉRON',classement:'30/4'}]
   :[{ordre:1,prenom:'Andrey',nom:'Guy',classement:'30/2'},{ordre:2,prenom:'Marie',nom:'CALLOT',classement:'30/3'},{ordre:3,prenom:'Lucie',nom:'Olive',classement:'30/5'}];}},
 '/hooks/useTeamAction.ts':{useTeamAction:()=>({busy:false,error:'',compose:async data=>{composed=data;return {ids:['a','b']};}})},
};
const modules=new Map();
function load(file){
 for(const [suffix,value] of Object.entries(mocks))if(file.endsWith(suffix))return value;
 if(modules.has(file))return modules.get(file).exports;
 const module={exports:{}};modules.set(file,module);
 const code=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 const require=name=>{if(!name.startsWith('.'))return req(name);const path=resolve(dirname(file),name);return load([path,`${path}.ts`,`${path}.tsx`].find(existsSync));};
 vm.runInThisContext(`(function(require,module,exports){${code}\n})`,{filename:file})(require,module,module.exports);
 return module.exports;
}
const button=text=>[...document.querySelectorAll('button')].find(b=>b.textContent.includes(text));
const click=async target=>act(async()=>target.dispatchEvent(new window.MouseEvent('click',{bubbles:true})));
const photo=async(name,index=0)=>act(async()=>{const el=document.querySelectorAll('input[type=file]')[index];Object.defineProperty(el,'files',{configurable:true,value:[new window.File(['x'],name,{type:'image/jpeg'})]});el.dispatchEvent(new window.Event('change',{bubbles:true}));});
const selects=()=>[...document.querySelectorAll('select')];
const wait=()=>act(async()=>{await new Promise(r=>setTimeout(r,0));});

test('The sheet explains both photos, fills the free singles, then the compo is checked and validated',async()=>{
 const Component=load(resolve(src,'components/teamMatches/TeamCompoSheet.tsx')).default;
 const root=createRoot(document.getElementById('root'));
 let closed=false;
 const client=new QueryClient({defaultOptions:{queries:{gcTime:0,retry:false}}});
 try {
  const detail={rencontre:{id:'r',club_adverse:'TC Voisin'}};
  await act(async()=>root.render(h(QueryClientProvider,{client},h(Component,{detail,clubId:'club',slots:[1,2],onClose:()=>{closed=true;}}))));
  assert.deepEqual([...document.querySelectorAll('li')].map(li=>li.textContent),['1Photo de notre compo','2Photo de la compo de TC Voisin','3Vérification']);
  assert.match(document.body.textContent,/Commencez par photographier la feuille de notre équipe, puis vous photographierez celle de l’adversaire/);
  assert.equal(scanned.length,0,'nothing is read before the user takes a photo');
  assert.match(document.body.textContent,/Photographier notre compo/);
  await photo('floue.jpg');await wait();
  assert.match(document.body.textContent,/La feuille n’a pas pu être lue/);
  assert.equal(document.querySelector('textarea'),null,'no manual entry in the photo flow');
  assert.match(document.body.textContent,/Reprendre la photo/);
  await photo('nous.jpg');await wait();
  assert.match(document.body.textContent,/Photographiez maintenant la feuille de TC Voisin/);
  assert.match(document.querySelector('li').textContent,/✓Photo de notre compo · 2\/2 joueurs lus/);
  assert.equal(document.querySelector('[aria-current=step]').textContent,'2Photo de la compo de TC Voisin');
  assert.equal(selects().length,0,'nothing to edit before both sheets are read');
  await photo('eux.jpg');await wait();
  assert.match(document.body.textContent,/Vérifiez chaque simple/);
  assert.equal(document.querySelector('[aria-current=step]').textContent,'3Vérification');
  assert.deepEqual(selects().map(s=>s.value),['m2','30/2','30/3','m1','30/3','30/4'],'members preselected, sheet rankings kept');
  assert.match(document.body.textContent,/Mettre à jour la fiche du membre : 30\/4 → 30\/3/);
  assert.equal(document.querySelectorAll('input[type=checkbox]').length,1);
  await photo('nous.jpg',0);await wait();
  assert.match(document.body.textContent,/Vérifiez chaque simple/,'retaking a sheet stays on the review');
  assert.deepEqual(scanned.map(s=>s[1]),['floue.jpg','nous.jpg','eux.jpg','nous.jpg']);
  assert.ok(scanned.every(s=>s[0]==='club'));
  await click(button('Valider la compo'));
  assert.deepEqual(composed,{simples:[
   {slot:1,joueur_club:{prenom:'Audrey',nom:'Guy',classement:'30/2',member_id:'m2'},joueur_adverse:{prenom:'Melodie',nom:'RABOT',classement:'30/3'},update_classement:false},
   {slot:2,joueur_club:{prenom:'Marie',nom:'Callot',classement:'30/3',member_id:'m1'},joueur_adverse:{prenom:'Charlène',nom:'CHÉRON',classement:'30/4'},update_classement:true},
  ]});
  assert.equal(closed,true);
 } finally {await act(async()=>root.unmount());client.clear();}
});
