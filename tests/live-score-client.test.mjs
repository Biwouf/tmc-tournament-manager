import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { JSDOM } from 'jsdom';
const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost/'});
globalThis.window=dom.window; globalThis.document=dom.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT=true;

for (const prefix of ['', 'pwa/']) {
  test(`${prefix || 'BO/'} Live: single flight, delayed events, takeover, network failure and recovery`, async () => {
    const req=createRequire(new URL(`../${prefix}package.json`,import.meta.url));
    const React=req('react'); const {act,createElement:h}=React;
    const {createRoot}=req('react-dom/client');
    const src=resolve(new URL(`../${prefix}src`,import.meta.url).pathname);
    let server={id:'match-a',club_id:'club-a',revision:1,scored_by:'user-a',status:'live',set1_j1:0};
    let nextReadError=null;
    let state;
    let callback;
    let writes=0;
    let pending;
    let appliedPatch;
    const supabase={
      from() {
        let operation='read';
        const filters={};
        return {
          select(){return this;}, eq(key,value){filters[key]=value; return this;}, abortSignal(){return this;},
          update(patch){operation='write'; appliedPatch=patch; return this;},
          single(){
            if(operation==='write'){
              writes++;
              assert.equal(filters.revision,server.revision,'CAS uses the confirmed version');
              return new Promise((resolve,reject)=>{pending={resolve,reject};});
            }
            return Promise.resolve({data:nextReadError ? null : {...server},error:nextReadError});
          },
        };
      },
      channel(){return {on(_name,_filter,cb){callback=cb;return this;},subscribe(){return this;}};},
      removeChannel(){},
    };
    const modules=new Map();
    function load(file){
      if(file.endsWith('/lib/supabase.ts')) return {supabase};
      if(modules.has(file)) return modules.get(file).exports;
      const module={exports:{}};modules.set(file,module);
      const code=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
      const require=name=>{
        if(!name.startsWith('.'))return req(name);
        const path=resolve(dirname(file),name);
        return load([path,`${path}.ts`,`${path}.tsx`].find(existsSync));
      };
      vm.runInThisContext(`(function(require,module,exports){${code}\n})`,{filename:file})(require,module,module.exports);
      return module.exports;
    }
    const {useLiveMatch}=load(resolve(src,'hooks/useLiveMatch.ts'));
    const {writeLiveMatch,deleteLiveMatch}=load(resolve(src,'lib/liveMatchWrites.ts'));
    function Screen({matchId='match-a'}){state=useLiveMatch(matchId,'club-a','user-a');return h('span',null,state.match?.set1_j1);}
    const root=createRoot(document.getElementById('root'));
    const flush=()=>act(async()=>{await Promise.resolve();});
    try{
      // Une page ouverte avant la migration peut encore transporter un match sans version.
      server={...server,revision:undefined};
      await act(async()=>root.render(h(Screen))); await flush();
      assert.match(state.error,/version du match est absente/);
      assert.equal(state.match,null);
      server={...server,revision:1};
      await act(async()=>{await state.reload();});
      assert.equal(state.match.revision,1);
      assert.equal(state.error,null,'a fresh read recovers after the schema is available');
      for (const revision of [undefined,null,'undefined',-1,1.5]) {
        const stale={...server,revision};
        await assert.rejects(writeLiveMatch(stale,'club-a',{status:'finished',retired_player:'j1',winner:'j2'}),/version du match est absente/);
        await assert.rejects(deleteLiveMatch(stale,'club-a'),/version du match est absente/);
      }
      assert.equal(writes,0,'invalid revisions never reach the write API');
      await act(async()=>callback({new:{...server,revision:undefined,set1_j1:9}}));
      assert.equal(state.match.revision,1,'incomplete realtime payload cannot poison the current match');
      let save;
      await act(async()=>{save=state.save({set1_j1:1}); void state.save({set1_j1:2});});
      assert.equal(writes,1,'same-tick double click produces only one write');
      assert.equal(state.saving,true);
      assert.equal(state.match.set1_j1,0,'unconfirmed score is not presented as saved');
      await act(async()=>callback({new:{...server,revision:0,set1_j1:9}}));
      assert.equal(state.match.set1_j1,0,'late event cannot revert the confirmed version');
      server={...server,...appliedPatch,revision:2};
      await act(async()=>{pending.resolve({data:{...server},error:null});await save;});
      assert.equal(state.match.set1_j1,1); assert.equal(state.saving,false);
      await act(async()=>{save=state.save({set1_j1:2});});
      const ownAck={...server,...appliedPatch,revision:3};
      server={...ownAck,revision:4,scored_by:'user-b'};
      await act(async()=>callback({new:{...server}}));
      await act(async()=>{pending.resolve({data:ownAck,error:null});await save;});
      assert.equal(state.match.scored_by,'user-b','ack cannot undo a takeover');
      assert.equal(state.match.revision,4);
      await act(async()=>{await state.save({set1_j1:5});});
      assert.equal(writes,2,'previous owner no longer writes');
      server={...server,revision:5,scored_by:'user-a'};
      await act(async()=>callback({new:{...server}}));
      await act(async()=>{save=state.save({set1_j1:3});});
      await act(async()=>{pending.reject(new Error('Network offline'));await save;});
      assert.match(state.savingError,/Network offline/);
      assert.equal(state.match.set1_j1,2); assert.equal(state.saving,false);
      await act(async()=>{await state.reload();});
      assert.equal(state.savingError,null);assert.equal(writes,3,'retry reads without replaying uncertain mutations');
      await act(async()=>{save=state.save({set1_j1:3});});
      nextReadError={message:'Not reachable'};
      await act(async()=>{pending.resolve({data:null,error:{code:'PGRST116'}});await save;});
      assert.match(state.savingError,/match a changé/); assert.equal(state.error,'Not reachable');
      nextReadError=null;
      await act(async()=>{await state.reload();});
      assert.equal(state.error,null);assert.equal(state.savingError,null);
      await act(async()=>{save=state.save({set1_j1:4});});
      const previous=pending;
      server={...server,id:'match-b',revision:1,set1_j1:0};
      await act(async()=>root.render(h(Screen,{matchId:'match-b'}))); await flush();
      await act(async()=>{previous.resolve({data:{...server,id:'match-a',revision:6,set1_j1:4},error:null});await save;});
      assert.equal(state.match.id,'match-b','old screen response cannot replace the new match');
      assert.equal(state.match.set1_j1,0);

      await act(async()=>{save=state.save({status:'finished',retired_player:'j1',winner:'j2'});});
      server={...server,...appliedPatch,revision:2};
      await act(async()=>{pending.resolve({data:{...server},error:null});await save;});
      assert.equal(state.match.status,'finished');
      assert.equal(state.match.retired_player,'j1');
      assert.equal(state.match.winner,'j2');
    }finally{await act(async()=>root.unmount());}
  });
}
