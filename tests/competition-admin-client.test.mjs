import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir, rm } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

test('admin creates a free name, edits existing names and reviews Tenup prefill before any write',async()=>{
 const dir=new URL('../node_modules/.tmp/competition-client/',import.meta.url);await mkdir(dir,{recursive:true});const out=new URL('ui.mjs',dir);
 await build({entryPoints:[new URL('../src/pages/TeamMatchesAdminPage.tsx',import.meta.url).pathname],outfile:out.pathname,bundle:true,packages:'external',platform:'node',format:'esm',jsx:'automatic',plugins:[{name:'app-mocks',setup(b){
  b.onResolve({filter:/lib\/supabase$/},()=>({path:'supabase',namespace:'mock'}));
  b.onResolve({filter:/contexts\/ClubContext$/},()=>({path:'club',namespace:'mock'}));
  b.onLoad({filter:/.*/,namespace:'mock'},args=>({contents:args.path==='supabase'?'export const supabase=globalThis.__competitionApi;':'export const useClub=()=>({clubId:"club-1"});'}));
 }}]});
 const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost'});
 const keys=['window','document','navigator','HTMLElement','IS_REACT_ACT_ENVIRONMENT','__competitionApi'];
 const descriptors=new Map(keys.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
 for(const key of keys.slice(0,-1)) Object.defineProperty(globalThis,key,{configurable:true,writable:true,value:key==='IS_REACT_ACT_ENVIRONMENT'?true:dom.window[key]});
 const writes=[],previews=[];let competitions=[],networkError=false,writeError=null,pendingWrite=null;
 const url='https://tenup.fft.fr/championnat/82678463?division=144146&phase=233672&poule=513524';
 globalThis.__competitionApi={from:table=>{
  let payload=null,mode='select';
  const chain={select:()=>chain,eq:()=>chain,in:()=>chain,order:()=>chain,
   insert:value=>{mode='insert';payload=value;return chain},update:value=>{mode='update';payload=value;return chain},
   then:async(resolve,reject)=>{try{
    if(mode==='select') return resolve({data:table==='team_saisons'?[{id:'season-1',label:'2026',actif:true}]:table==='team_competitions'?competitions:[],error:null});
    writes.push({table,mode,payload});if(pendingWrite)await pendingWrite;
    if(!writeError)competitions=[{id:'competition-1',...payload,terminee:false}];
    resolve({error:writeError});
   }catch(err){reject(err)}}};return chain;
 },functions:{invoke:async(name,options)=>{previews.push({name,...options});return networkError?{data:null,error:{context:Response.json({error:'Ten’Up indisponible.'},{status:502})}}:{data:{url,nom:'Challenge féminin',format:'3S1D2',singles_set3_format:'normal',warnings:[]},error:null}}}};
 const Page=(await import(out.href)).default;
 const root=createRoot(document.getElementById('root'));
 const button=text=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===text);
 const click=async el=>{assert.ok(el);await act(async()=>{el.click()})};
 const change=async(id,value)=>{const el=document.getElementById(id);assert.ok(el);await act(async()=>el[Object.keys(el).find(k=>k.startsWith('__reactProps'))].onChange({target:{value}}))};
 try {
  await act(async()=>root.render(React.createElement(MemoryRouter,null,React.createElement(Page))));
  await click(button('+ Compétition'));await click(button('Créer'));assert.equal(writes.length,0);assert.match(document.querySelector('[role=alert]').textContent,/nom/);
  await change('competition-name','  Championnat libre  ');await change('singles-set3-format','normal');await click(button('Créer'));
  assert.equal(writes.length,1);assert.equal(writes[0].payload.nom,'Championnat libre');assert.equal(writes[0].payload.tenup_url,null);
  await click([...document.querySelectorAll('button')].filter(b=>b.textContent.trim()==='Modifier').at(-1));assert.equal(document.getElementById('competition-name').value,'Championnat libre');await click(button('Annuler'));
  await click(button('+ Compétition'));await change('competition-tenup-url',url);await click(button('Préremplir depuis Ten’Up'));
  assert.equal(writes.length,1,'prefill never writes');assert.equal(previews[0].body.kind,'competition');
  assert.equal(document.getElementById('competition-name').value,'Challenge féminin');assert.equal(document.getElementById('competition-format').value,'3S1D2');
  await click(button('Créer'));assert.equal(writes.length,1,'genre and category must be filled explicitly');
  await change('competition-genre','femmes');await change('competition-categorie','seniors');
  writeError={code:'23505',message:'duplicate'};await click(button('Créer'));assert.match(document.querySelector('[role=alert]').textContent,/déjà associé/);
  writeError=null;let release;pendingWrite=new Promise(r=>{release=r});await click(button('Créer'));assert.equal(button('Enregistrement…').disabled,true);
  await act(async()=>release());pendingWrite=null;assert.equal(document.querySelector('[role=dialog]'),null);assert.equal(writes.at(-1).payload.tenup_url,url);
  await click(button('+ Compétition'));await change('competition-tenup-url','https://evil.test');await click(button('Préremplir depuis Ten’Up'));assert.equal(previews.length,1,'invalid links are rejected locally');
  await change('competition-tenup-url',url);networkError=true;await click(button('Préremplir depuis Ten’Up'));assert.match(document.querySelector('[role=alert]').textContent,/indisponible/);
  await change('competition-tenup-url','');await change('competition-name','Saisie manuelle après erreur');await change('singles-set3-format','normal');await click(button('Créer'));assert.equal(writes.at(-1).payload.nom,'Saisie manuelle après erreur');
 }finally{
  await act(async()=>root.unmount());dom.window.close();
  for(const [key,value]of descriptors) {if(value)Object.defineProperty(globalThis,key,value);else delete globalThis[key];}
  await rm(dir,{recursive:true,force:true});
 }
});
