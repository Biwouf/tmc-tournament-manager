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
const src=resolve(new URL('../pwa/src',import.meta.url).pathname);
let commands=[];let closed=false;
const mocks={
 '/lib/supabase.ts':{supabase:{rpc:async()=>({data:[],error:null})}},
 '/hooks/useTeamAction.ts':{useTeamAction:()=>({busy:false,error:'',run:async(operation,data)=>{commands.push({operation,data});return {id:'a'};}})},
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
const {resultWinner}=load(resolve(src,'lib/teamMatches.ts'));
const rules=load(resolve(src,'liveScoreRules.ts'));
const line={id:'a',rencontre_id:'r',match_type:'simple',slot:1,revision:2,set3_format:'super_tiebreak',sets:[],score:null,gagnant:null,result_kind:null,confirmed_at:null,
 joueurs_club:[{prenom:'Camille',nom:'Club',classement:'30'}],joueurs_adverse:[{prenom:'Alex',nom:'Adverse',classement:'NC'}]};
const live={id:'live-a',revision:4,team_match_line_id:'a',team_rencontre_id:'r',scored_by:'user',status:'finished',match_type:'simple',j1_prenom:'Camille',j1_nom:'Club',j2_prenom:'Alex',j2_nom:'Adverse',
 set1_j1:6,set1_j2:4,set1_tb_j1:null,set1_tb_j2:null,set2_j1:6,set2_j2:3,set2_tb_j1:null,set2_tb_j2:null,set3_j1:null,set3_j2:null,set3_tb_j1:null,set3_tb_j2:null,set3_format:'super_tiebreak',winner:'j1',retired_player:null};
const button=text=>[...document.querySelectorAll('button')].find(b=>b.textContent.includes(text));
const click=async target=>act(async()=>target.dispatchEvent(new window.MouseEvent('click',{bubbles:true})));
const input=async(el,value)=>act(async()=>{Object.getOwnPropertyDescriptor(el instanceof window.HTMLSelectElement?window.HTMLSelectElement.prototype:window.HTMLInputElement.prototype,'value').set.call(el,value);el.dispatchEvent(new window.Event(el instanceof window.HTMLSelectElement?'change':'input',{bubbles:true}));});

test('Score rules accept direct 7-6 without invented tie-break points and reject incomplete/extra sets',()=>{
 assert.equal(resultWinner([{club:7,adverse:6},{club:6,adverse:4}],'super_tiebreak'),'club');
 assert.equal(resultWinner([{club:6,adverse:4},{club:3,adverse:6},{club:12,adverse:10}],'super_tiebreak'),'club');
 assert.equal(resultWinner([{club:6,adverse:4},{club:3,adverse:6},{club:10,adverse:9}],'super_tiebreak'),null);
 assert.equal(resultWinner([{club:6,adverse:4},{club:6,adverse:2},{club:6,adverse:0}],'normal'),null);
 assert.equal(resultWinner([{club:6,adverse:4},{club:3,adverse:6},{club:11,adverse:2}],'super_tiebreak'),null);
 const set={j1:7,j2:6,tb_j1:null,tb_j2:null};
 assert.equal(rules.getNormalSetWinner(set),'j1');
 assert.deepEqual(rules.decrementNormal(set,'j1'),{j1:6,j2:6,tb_j1:0,tb_j2:0});
});

test('Linked Live opens the prescribed super tie-break without asking for a format',async()=>{
 const Component=load(resolve(src,'components/matches/LiveScoreEntry.tsx')).default;
 const root=createRoot(document.getElementById('root'));
 try {
  await act(async()=>root.render(h(Component,{match:{...live,status:'live',set2_j1:4,set2_j2:6},onPatch:()=>{}})));
  assert.match(document.body.textContent,/Set 3 — Super Tiebreak/);
  assert.doesNotMatch(document.body.textContent,/choisir le format/);
  await act(async()=>root.render(h(Component,{match:{...live,team_match_line_id:null,status:'live',set2_j1:4,set2_j2:6,set3_format:null},onPatch:()=>{}})));
  assert.match(document.body.textContent,/choisir le format/,'independent lives retain their manual choice');
 } finally {await act(async()=>root.unmount());}
});

test('Result confirmation is prefilled and retains the opened revisions despite background updates',async()=>{
 commands=[];closed=false;
 const Component=load(resolve(src,'components/teamMatches/TeamResultSheet.tsx')).default;
 const root=createRoot(document.getElementById('root'));
 try {
  const props={line,live,clubId:'club',userId:'user',onClose:()=>{closed=true;}};
  await act(async()=>root.render(h(Component,props)));
  assert.deepEqual([...document.querySelectorAll('input[type=number]')].map(i=>i.value),['6','4','6','3']);
  assert.equal(button('Confirmer le résultat').disabled,false);
  await act(async()=>root.render(h(Component,{...props,line:{...line,revision:99},live:{...live,revision:99,set1_j1:7}})));
  await click(button('Confirmer le résultat'));
  assert.equal(commands.length,1);assert.equal(commands[0].data.revision,2);assert.equal(commands[0].data.live_revision,4);
  assert.equal(commands[0].data.winner,'club');assert.equal(closed,true);
 } finally {await act(async()=>root.unmount());}
});

test('Creation wizard respects occupied slots, keeps NC and supports free names',async()=>{
 commands=[];closed=false;
 const Component=load(resolve(src,'components/teamMatches/CreateTeamMatch.tsx')).default;
 const root=createRoot(document.getElementById('root'));
 try {
  const detail={rencontre:{id:'r'},competition:{format:'2S1D',singles_set3_format:'super_tiebreak'},lines:[line]};
  await act(async()=>root.render(h(Component,{detail,clubId:'club',onClose:()=>{closed=true;}})));
  assert.equal(button('Simple 1').disabled,true);await click(button('Simple 2'));await click(button('Continuer'));
  assert.equal(button('NC').getAttribute('aria-pressed'),'true');
  await input(document.querySelector('input[type=text],input:not([type])'),'Camille Libre');
  await click(button('Continuer'));
  await input(document.querySelector('input[type=text],input:not([type])'),'Alex Adverse');
  await click(button('Créer le match'));
  assert.equal(commands.length,1);assert.equal(commands[0].operation,'create');
  assert.equal(commands[0].data.slot,2);assert.equal(commands[0].data.joueurs_club[0].classement,'NC');
  assert.equal(commands[0].data.joueurs_club[0].prenom,'Camille Libre');assert.equal(closed,true);
 } finally {await act(async()=>root.unmount());}
});
