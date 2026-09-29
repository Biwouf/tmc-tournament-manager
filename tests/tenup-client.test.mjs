import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir, rm } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

const players=[{prenom:'Anne',nom:'MARTIN',classement:'30'}];
const other=[{prenom:'Jeanne',nom:'DUPONT',classement:'15/4'}];
const sheet={id:'preview',url:'https://tenup.fft.fr/championnat/1/division/2/phase/3/poule/4/rencontre/5',date:'2026-09-27',teams:['Club A','Club B'],scores:[1,0],lines:[{match_type:'simple',slot:1,players_a:players,players_b:other,sets:[{a:6,b:2},{a:6,b:4}]}]};

test('shared BO/PWA flow requires side and review, handles protected scores, errors and retry', async()=>{
 const dir=new URL('../node_modules/.tmp/tenup-client/',import.meta.url);
 await mkdir(dir,{recursive:true});
 const output=new URL('ui.mjs',dir);
 await build({entryPoints:[new URL('../shared/TenupSync.tsx',import.meta.url).pathname],outfile:output.pathname,bundle:true,packages:'external',platform:'node',format:'esm',jsx:'automatic'});
 const {default:TenupSync}=await import(output.href);
 const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost'});
 const keys=['window','document','navigator','HTMLElement','IS_REACT_ACT_ENVIRONMENT'];
 const descriptors=new Map(keys.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
 for(const key of keys) Object.defineProperty(globalThis,key,{configurable:true,writable:true,value:key==='IS_REACT_ACT_ENVIRONMENT'?true:dom.window[key]});
 const root=createRoot(document.getElementById('root'));let applyCalls=0;let reloads=0;
 const props={sourceUrl:sheet.url,clubName:'Club B',opponent:'Club A',date:'2026-09-27T09:00:00+02:00',lines:[],preview:async()=>sheet,apply:async(id,side)=>{applyCalls++;assert.equal(id,'preview');assert.equal(side,1);if(applyCalls===1)throw new Error('La rencontre a changé.');return {imported:1,preserved:0,confirmed:true};},onSynced:()=>reloads++};
 const button=(text)=>[...document.querySelectorAll('button')].find(b=>b.textContent.includes(text));
 const click=async el=>{assert.ok(el);await act(async()=>{el.click();});};
 const submit=async()=>{await act(async()=>{document.querySelector('form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));});};
 try {
  await act(async()=>root.render(React.createElement(TenupSync,props)));
  await click(button('Synchroniser depuis'));
  await submit();
  assert.equal(button('Importer les résultats'),undefined,'no import before choosing team');
  await click(document.querySelectorAll('input[type=radio]')[1]);
  assert.ok(document.body.textContent.includes('2-6 4-6'),'away scores are reversed');
  assert.equal(button('Importer les résultats').disabled,true);
  await click(document.querySelector('input[type=checkbox]'));
  await click(button('Importer les résultats'));
  assert.match(document.querySelector('[role=alert]').textContent,/a changé/);
  assert.equal(reloads,0);
  await click(button('Importer les résultats'));
  assert.equal(reloads,1);assert.equal(applyCalls,2);
  assert.match(document.querySelector('[role=status]').textContent,/1 résultat.*Rencontre confirmée/);
  await click(button('Synchroniser depuis'));
  await act(async()=>root.render(React.createElement(TenupSync,{...props,lines:[{match_type:'simple',slot:1,score:'3-6 4-6',gagnant:'adverse',live_match_id:null,confirmed_at:'date',joueurs_club:other,joueurs_adverse:players}]})));
  await submit();await click(document.querySelectorAll('input[type=radio]')[1]);
  assert.match(document.body.textContent,/Résultat existant : 3-6 4-6/);
  assert.match(button('Importer les résultats').textContent,/\(0\)/);
  await act(async()=>root.render(React.createElement(TenupSync,{...props,date:'2026-09-28T09:00:00+02:00'})));
  assert.match(document.querySelector('[role=alert]').textContent,/dates diffèrent/);
  assert.equal(button('Importer les résultats').disabled,true);
 } finally {
  await act(async()=>root.unmount());dom.window.close();
  for(const [key,value] of descriptors) { if(value)Object.defineProperty(globalThis,key,value);else delete globalThis[key]; }
  await rm(dir,{recursive:true,force:true});
 }
});
