import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = (await readFile(new URL('../pwa/src/lib/coursePush.ts', import.meta.url),'utf8'))
  .replace(/^import .*;$/gm, '').replace('import.meta.env.VITE_VAPID_PUBLIC_KEY', "'BAAA'");
const compiled = ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
}}).outputText;
function harness() {
  let active = true, userId = 'member', rpcError = false, unsubscribeError = false;
  let pauseSubscribe, prefs = { courses: false, live: false };
  const calls = [], storage = new Map(), rpcArgs = [];
  const subscription = {
    endpoint: 'https://fcm.googleapis.com/test',
    toJSON: () => ({ endpoint: subscription.endpoint, keys: { p256dh: 'public', auth: 'auth' } }),
    unsubscribe: async () => { calls.push('browser-unsubscribe'); if (unsubscribeError) throw Error(); active = false; return true; },
  };
  const registration = {
    pushManager: { getSubscription: async () => active ? subscription : null,
      subscribe: async () => { active = true; return subscription; } },
    getNotifications: async () => [{close: () => calls.push('close-notification')}],
  };
  const api = {};
  vm.runInNewContext(compiled, {
    exports: api, setTimeout, clearTimeout, Uint8Array, ArrayBuffer, atob,
    window: { PushManager: {}, Notification: {}, isSecureContext: true },
    navigator: { serviceWorker: { getRegistration: async () => registration, ready: Promise.resolve(registration) } },
    Notification: { permission: 'granted', requestPermission: () => { calls.push('permission'); return Promise.resolve('granted'); } },
    localStorage: { getItem: k => storage.get(k) || null, setItem: (k,v) => storage.set(k,v), removeItem: k => storage.delete(k) },
    supabase: { auth: { getSession: async () => ({data: {session: {user: {id: userId}}}}) },
      rpc: async (name, args) => {
        calls.push(name);
        if (name === 'push_subscribe' && pauseSubscribe) await pauseSubscribe;
        if (name === 'push_subscribe' && !rpcError) {
          prefs = { courses: args.p_courses ?? prefs.courses, live: args.p_live ?? prefs.live };
          rpcArgs.push(args);
          return { data: [{ notify_courses: prefs.courses, notify_live: prefs.live }], error: null };
        }
        return {error: rpcError ? Error('network') : null};
      } },
  });
  const bind = () => storage.set('course-push-binding',JSON.stringify({userId:'member',clubId:'club',endpoint:subscription.endpoint}));
  return { api, calls, storage, bind, rpcArgs, get active(){return active;},
    set user(value){userId=value;}, set rpcError(value){rpcError=value;},
    set unsubscribeError(value){unsubscribeError=value;}, set pauseSubscribe(value){pauseSubscribe=value;} };
}
test('permission is requested synchronously; existing permission does not opt in another account', async () => {
  const h=harness();
  assert.equal(await h.api.syncCoursePush('club','member'),false);
  const enabling=h.api.enableCoursePush('club','member');
  assert.equal(h.calls[0],'permission');
  await enabling;
  assert.equal(await h.api.syncCoursePush('club','other'),false);
  h.user='other'; await h.api.reconcileCoursePush('other');
  assert.equal(h.active,false);
  assert.equal(h.storage.size,0);
  assert.ok(h.calls.includes('close-notification'));
});
test('logout waits for an in-flight synchronization and cannot resurrect it', async () => {
  const h=harness(); h.bind();
  let release; h.pauseSubscribe=new Promise(resolve=>{release=resolve;});
  const sync=h.api.syncCoursePush('club','member');
  await new Promise(resolve=>setTimeout(resolve,0));
  const logout=h.api.disableCoursePush('club');
  release(); await Promise.all([sync,logout]);
  assert.equal(h.active,false);
  assert.equal(await h.api.syncCoursePush('club','member'),false);
  assert.ok(h.calls.indexOf('push_subscribe')>=0);
  assert.ok(h.calls.indexOf('course_push_unsubscribe')>h.calls.indexOf('push_subscribe'));
});
test('offline server revocation falls back to the browser; dual failure remains visible', async () => {
  const h=harness(); h.bind(); h.rpcError=true;
  await h.api.disableCoursePush('club'); assert.equal(h.active,false);
  const failed=harness(); failed.bind(); failed.rpcError=true; failed.unsubscribeError=true;
  await assert.rejects(failed.api.disableCoursePush('club'),/Impossible de désactiver/);
  assert.equal(failed.active,true);
  assert.equal(failed.storage.size,1);
});
test('failed registration revokes the browser subscription and keeps activation off', async () => {
  const h=harness(); h.rpcError=true;
  await assert.rejects(h.api.enableCoursePush('club','member'),/Impossible d’enregistrer/);
  assert.equal(h.active,false); assert.equal(h.storage.size,0);
});

const plain = (value) => JSON.parse(JSON.stringify(value));
test('categories share one device subscription: turning one off keeps the other and the device', async () => {
  const h=harness(); const seen=[];
  h.api.onPushPreferences(p=>seen.push(p));
  assert.deepEqual(plain(await h.api.enablePush('club','member',{live:true})),{courses:false,live:true});
  assert.equal(h.rpcArgs[0].p_courses,null);
  await h.api.enableCoursePush('club','member');
  assert.deepEqual(plain(await h.api.syncPush('club','member')),{courses:true,live:true});
  assert.deepEqual(plain(await h.api.disablePushCategory('club','member',{live:false})),{courses:true,live:false});
  assert.equal(h.active,true);
  assert.equal(await h.api.disablePushCategory('club','other',{live:false}),null);
  // Empty patch: subscribe the device for followed matches without touching preferences.
  assert.deepEqual(plain(await h.api.enablePush('club','member',{})),{courses:true,live:false});
  await h.api.disableCoursePush('club');
  assert.equal(h.active,false); assert.equal(seen.at(-1),null);
});
test('a failed preference change never revokes a device already in use', async () => {
  const h=harness();
  await h.api.enablePush('club','member',{live:true});
  h.rpcError=true;
  await assert.rejects(h.api.enablePush('club','member',{courses:true}),/Impossible d’enregistrer/);
  assert.equal(h.active,true); assert.equal(h.storage.size,1);
});

const worker = await readFile(new URL('../pwa/public/course-push-sw.js',import.meta.url),'utf8');
test('worker displays stable delivery tags, opens the course, and rejects foreign click targets', async () => {
  const handlers=new Map(), notifications=[], opened=[];
  const self={location:{origin:'https://club.example'},
    addEventListener:(kind,fn)=>handlers.set(kind,fn),
    registration:{showNotification:async(title,options)=>notifications.push({title,...options})},
    clients:{matchAll:async()=>[],openWindow:async url=>opened.push(url)},
  };
  vm.runInNewContext(worker,{self,URL});
  const run=async(kind,event)=>{let work; handlers.get(kind)({...event,waitUntil:p=>{work=p;}}); await work;};
  await run('push',{data:{json:()=>({id:'delivery',title:'Cours',body:'Accepté',url:'/cours?course=42'})}});
  assert.equal(notifications[0].tag,'course-delivery');
  await run('notificationclick',{notification:{data:notifications[0].data,close(){}}});
  assert.equal(opened[0],'https://club.example/cours?course=42');
  await run('notificationclick',{notification:{data:{url:'https://evil.example'},close(){}}});
  assert.equal(opened[1],'https://club.example/cours');
});
test('worker opens Live alerts on the match and groups feed alerts per match', async () => {
  const handlers=new Map(), notifications=[], opened=[];
  const self={location:{origin:'https://club.example'},
    addEventListener:(kind,fn)=>handlers.set(kind,fn),
    registration:{showNotification:async(title,options)=>notifications.push({title,...options})},
    clients:{matchAll:async()=>[],openWindow:async url=>opened.push(url)},
  };
  vm.runInNewContext(worker,{self,URL});
  const run=async(kind,event)=>{let work; handlers.get(kind)({...event,waitUntil:p=>{work=p;}}); await work;};
  const match='00000000-0000-0000-0000-000000000020';
  await run('push',{data:{json:()=>({id:'d1',title:'Dupont – Martin',body:'Allez !',url:`/matches/${match}`,tag:`live-post-${match}`})}});
  assert.equal(notifications[0].tag,`live-post-${match}`); assert.equal(notifications[0].renotify,true);
  await run('push',{data:{json:()=>({id:'d2',title:'Fin du 1er set',body:'6-4',url:`/matches/${match}`,tag:'bad tag!'})}});
  assert.equal(notifications[1].tag,'live-d2'); assert.equal(notifications[1].renotify,false);
  await run('notificationclick',{notification:{data:notifications[1].data,close(){}}});
  assert.equal(opened[0],`https://club.example/matches/${match}`);
  await run('push',{data:{json:()=>({id:'d3',title:'x',body:'y',url:'/matches/../admin'})}});
  assert.equal(notifications[2].data.url,'/cours');
});
