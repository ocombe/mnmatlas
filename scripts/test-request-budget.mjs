import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {environment,settle} from './community-harness.mjs';
import {suite,plain} from './regression-harness.mjs';

const checks=suite(),app=await readFile(new URL('../app.js',import.meta.url),'utf8');
const reader=app.slice(app.indexOf('async function fetchData('),app.indexOf('function validateRegistry('));
const updates=app.slice(app.indexOf('const updateInterval='),app.indexOf('function watchForUpdates('));
const note=(id='seed')=>({id:'personal-'+id,name:id,category:'Personal',note:'',x:30,y:40,level:'lower',updated:10});
async function fixture({notes=[],personal=plain(notes),world=false}={}){
 const files=new Map(),downloads=[],maps=['test-map','map-b','map-c'].map(id=>{
  const levels=['lower','upper'].map(level=>({id:level,labelsFile:'data/'+id+'/'+level+'-labels.json'}));
  const conf={id,title:id,tileRevision:'v1',width:200,height:200,minZoom:0,defaultView:{placeZoom:3},markersFile:'data/'+id+'/markers.json',levels,defaultLevel:'lower'};
  files.set(conf.markersFile,[]);for(const l of levels)files.set(l.labelsFile,{labels:[{id:l.id+'-name',name:l.id,kind:'district',x:10,y:20}],trainers:[]});return conf;
 });
 let stamp='Tue, 20 Oct 2026 00:00:00 GMT',now=Date.now(),c;
 const e=environment({supabaseUrl:'http://fixture',supabaseKey:'test'},'atlas.example',{user:{id:'member'}},{expose:true,notes,personal,prepare(context){
  c=context;c.Date=class extends Date{static now(){return now;}};
  c.config={...maps[0],...maps[0].levels[0],id:maps[0].id,levelId:'lower',...(world?{zonesFile:'data/world/zones.json'}:{})};c.registry.maps=maps;
  c.localPath=p=>typeof p==='string'&&p.startsWith('data/');const notice=c.document.createElement('div');notice.id='update-notice';notice.hidden=true;c.document.body.append(notice);
  c.fetch=async(url,options={})=>{downloads.push({url,method:options.method||'GET',cache:options.cache||'default'});return {ok:true,status:200,headers:{get:()=>stamp},json:async()=>structuredClone(files.get(url)||(url==='data/changelog.json'||url==='data/publish-log.json'?[]:{}))};};
  vm.runInContext(reader+updates,c);c.checkForUpdate();
  c.fetchData(c.config.markersFile,[]);c.fetchData(c.config.labelsFile,{labels:[],trainers:[]});
 }});
 await settle();
 async function travel(id,level='lower'){
  const base=maps.find(m=>m.id===id),conf={...base,...base.levels.find(l=>l.id===level),id,levelId:level};
  const [markers,labels]=await Promise.all([c.fetchData(conf.markersFile,[]),c.fetchData(conf.labelsFile,{labels:[],trainers:[]})]);
  c.config=conf;c.originals=markers;c.labelData=labels;c.loadSerial++;e.emit('atlas:loaded');await settle();
 }
 const mark=()=>({calls:e.calls.length,files:downloads.length});
 function counts(start={calls:0,files:0}){
  const calls=e.calls.slice(start.calls),fetches=downloads.slice(start.files),reads=calls.filter(r=>r.table&&r.op==='select'),writes=calls.filter(r=>r.table&&r.op!=='select'),rpcs=calls.filter(r=>r.rpc);
  return {reads:reads.length,writes:writes.length,rpcs:rpcs.length,total:reads.length+writes.length+rpcs.length,notesReads:reads.filter(r=>r.table==='user_notes').length,notesWrites:writes.filter(r=>r.table==='user_notes').length,points:rpcs.filter(r=>r.rpc==='my_contribution_points').length,head:fetches.filter(r=>r.method==='HEAD').length,data:fetches.filter(r=>r.url.startsWith('data/'))};
 }
 return {e,c,downloads,files,maps,travel,mark,counts,advance:ms=>now+=ms,edition:()=>{stamp='Wed, 21 Oct 2026 00:00:00 GMT';}};
}
const f=await fixture();
async function step(name,run,budget,initial=false){
 const start=initial?undefined:f.mark();await run();await settle();const n=f.counts(start);
 console.log('REQUESTS '+JSON.stringify({step:name,...n,data:n.data.length,cache:n.data.map(r=>r.cache)}));
 await checks.test('B31',name,()=>{assert.equal(n.notesWrites,0,'Unchanged notes never write');budget(n);});
}
// Each sign-in and refresh includes one Messages read (feedback and reports with their conversations embedded).
await step('signed-in map load',async()=>{},n=>{assert.equal(n.reads,7);assert.equal(n.writes,0);assert.equal(n.rpcs,0);assert.equal(n.notesReads,1);assert.equal(n.head,1);assert.equal(n.data.length,6);},true);
await checks.test('B31','initial overlapping loads retain other-floor labels',()=>{assert(f.c.window.testCommunity.publishedLabels().some(p=>p.id==='upper-name'));});
await step('floor switch',()=>f.travel('test-map','upper'),n=>{assert.equal(n.total,0);assert.equal(n.head,0);assert.equal(n.data.length,2);});
for(const id of ['map-b','map-c'])await step('map switch '+id,()=>f.travel(id),n=>{assert.equal(n.reads,4);assert.equal(n.writes,0);assert.equal(n.rpcs,0);assert.equal(n.head,0);assert.equal(n.data.length,4);});
for(let i=0;i<3;i++)await step('focus '+(i+1),()=>{f.advance(60000);f.e.emit('blur');f.e.emit('focus');},n=>{assert.equal(n.reads,i?0:5);assert.equal(n.rpcs,0);assert.equal(n.data.length,0);assert.equal(n.head,0);});
await step('account menu',()=>f.e.bar.querySelector('.account-button').onclick(),n=>{assert.equal(n.reads,0);assert.equal(n.points,1);});
await step('bell opens on news',()=>f.e.bar.querySelector('.notices-bell').onclick(),n=>{assert.equal(n.reads,1);assert.equal(n.rpcs,0);});
await step('Your suggestions uses cached renown',()=>f.c.$('notices-panel').querySelectorAll('button').find(b=>b.textContent==='Your suggestions').onclick(),n=>{assert.equal(n.total,0);assert.equal(f.c.$('notices-panel').querySelector('.notices-footer').querySelector('span').textContent,'3 renown');});
await checks.test('B31','data readers revalidate; initial and unchanged update checks fetch only HEAD',async()=>{
 assert(f.downloads.filter(r=>r.url.startsWith('data/')&&!r.url.startsWith('data/credits/')).every(r=>r.cache==='no-cache'));
 let start=f.mark();f.advance(15*60000);await f.c.checkForUpdate();await settle();assert.equal(f.counts(start).head,1);assert.equal(f.counts(start).data.length,0);assert.equal(f.counts(start).total,0);
 start=f.mark();f.edition();await f.c.checkForUpdate();await settle();assert.equal(f.counts(start).head,1);assert.equal(f.downloads.slice(start.files).filter(r=>['data/changelog.json','data/publish-log.json'].includes(r.url)).length,2);assert.equal(f.c.$('update-notice').hidden,false);assert.equal(f.counts(start).reads,5);
});
await checks.test('B31','a focus needs an actual absence and visibility/focus share a five-minute gate',async()=>{
 const f=await fixture();let start=f.mark();f.e.emit('focus');await settle();assert.equal(f.counts(start).total,0);
 f.c.document.hidden=true;f.e.documentEmit('visibilitychange');f.c.document.hidden=false;f.e.documentEmit('visibilitychange');f.e.emit('focus');await settle();assert.equal(f.counts(start).reads,5);
 start=f.mark();f.advance(299999);f.e.emit('blur');f.e.emit('focus');await settle();assert.equal(f.counts(start).total,0);f.advance(1);f.e.emit('focus');await settle();assert.equal(f.counts(start).reads,5);
 start=f.mark();f.c.loading=true;f.advance(300000);f.e.emit('blur');f.e.emit('focus');await settle();assert.equal(f.counts(start).total,0);f.c.loading=false;f.e.emit('focus');await settle();assert.equal(f.counts(start).reads,5);
});
await checks.test('B31','renown is lazy, coalesced, expires and clears after an own change',async()=>{
 const f=await fixture(),account=f.e.bar.querySelector('.account-button'),bell=f.e.bar.querySelector('.notices-bell');let start=f.mark();bell.onclick();await settle();assert.equal(f.counts(start).points,0);
 const mine=()=>f.c.$('notices-panel').querySelectorAll('button').find(b=>b.textContent==='Your suggestions').onclick();mine();account.onclick();await settle();assert.equal(f.counts(start).points,1);assert.equal(f.e.bar.querySelector('.account-points').textContent,'Renown: 3');
 start=f.mark();f.advance(300000);account.onclick();account.onclick();await settle();assert.equal(f.counts(start).points,1);
 start=f.mark();f.e.recordInserts=true;await f.c.window.testCommunity.submitRow({map:'test-map',level:'lower',kind:'feedback',target_id:null,payload:{name:'New message',topic:'idea',note:'New message'},user_id:'member'},{receipt:true});account.onclick();account.onclick();await settle();assert.equal(f.counts(start).points,1);assert.equal(f.counts(start).reads,4);
 const lists=f.e.calls.filter(r=>r.table==='suggestions'&&r.filters.user_id&&r.range);assert(lists.length);assert(lists.every(r=>!r.columns.split(',').includes('*')&&!r.columns.split(',').includes('payload')));
});
await checks.test('B31','world maps never read or write notes, including local events',async()=>{
 const f=await fixture({world:true,notes:[note()]});assert.equal(f.counts().notesReads,0);assert.equal(f.counts().notesWrites,0);const before=plain(f.c.personal);f.e.emit('atlas:notes');f.e.emit('atlas:private-notes');f.e.emit('online');await f.e.tick(2000);assert.equal(f.counts().notesReads,0);assert.equal(f.counts().notesWrites,0);assert.deepEqual(plain(f.c.personal),before);
});
for(const kind of ['deletion','edit'])await checks.test('B31','a remote '+kind+' merges after an unchanged sync and skipped floor sync',async()=>{
 const f=await fixture({notes:[note()]}),base=f.c.window.testCommunity.readBase('member','test-map-v1');assert(base.has('personal-seed'));assert.equal(f.counts().notesWrites,0);
 let start=f.mark();await f.travel('test-map','upper');assert.equal(f.counts(start).notesReads,0);
 if(kind==='deletion')f.e.remote.splice(0);else f.e.remote[0]={...f.e.remote[0],note:'Elsewhere',updated:20};
 f.advance(300000);start=f.mark();await f.travel('test-map','lower');assert.equal(f.counts(start).notesReads,1);assert.equal(f.counts(start).notesWrites,0);
 assert.equal(f.c.personal.length,kind==='deletion'?0:1);if(kind==='edit')assert.equal(f.c.personal[0].note,'Elsewhere');
 assert.equal(f.c.window.testCommunity.readBase('member','test-map-v1').size,kind==='deletion'?0:1);
 f.c.persist([...f.c.personal,note('added')]);await f.e.tick(2000);assert.equal(f.e.remote.length,kind==='deletion'?1:2);
 if(kind==='edit')assert.equal(f.e.remote.find(n=>n.id==='personal-seed').note,'Elsewhere');
});
await checks.test('B31','local edits during a skipped floor sync still upload and merge remote changes',async()=>{
 const f=await fixture({notes:[note()]}),start=f.mark();await f.travel('test-map','upper');assert.equal(f.counts(start).total,0);
 f.e.remote.push(note('remote'));f.c.persist([{...f.c.personal[0],note:'Local edit'}]);await f.e.tick(2000);
 assert.equal(f.e.remote.length,2);assert.equal(f.e.remote.find(n=>n.id==='personal-seed').note,'Local edit');assert.equal(f.c.personal.length,2);
});
await checks.test('B31','a changed initial merge uses its combined read for the first write',async()=>{
 const f=await fixture({notes:[],personal:[note('local')]});assert.equal(f.counts().notesReads,1);assert.equal(f.counts().notesWrites,1);assert.equal(f.e.remote[0].id,'personal-local');
 const writes=f.e.calls.filter(r=>r.table==='user_notes'&&r.op==='update');assert.equal(writes.length,1);assert.equal(writes[0].filters.updated_at,'2026-10-20T08:00:00.000Z');
});
await checks.test('B31','a local save while the combined read is pending joins the upload',async()=>{
 const f=await fixture({notes:[note()]}),start=f.mark();let release;
 f.e.notesFault=(request,rows,state)=>request.in?new Promise(resolve=>{const data=request.in.values.map(map=>({map,notes:map.endsWith('#private')?[]:plain(rows),updated_at:state.updated_at}));release=()=>resolve({data});}):null;
 const syncing=f.c.window.testCommunity.onMap();await settle();assert(release);f.c.persist([...f.c.personal,note('during-read')]);release();await syncing;await settle();
 assert.equal(f.counts(start).notesReads,1);assert.equal(f.counts(start).notesWrites,1);assert.equal(f.e.remote.length,2);assert.deepEqual(plain(f.c.personal),plain(f.e.remote));
});
for(const failure of ['offline','invalid list','invalid notes','missing version'])await checks.test('B31','combined '+failure+' keeps local notes without writes',async()=>{
 const f=await fixture({notes:[note()]}),start=f.mark(),before=plain(f.c.personal),base=plain([...f.c.window.testCommunity.readBase('member','test-map-v1')]);
 f.e.notesFault=request=>request.in?failure==='offline'?{error:Error('offline')}:{data:failure==='invalid list'?null:[{map:'test-map-v1',notes:failure==='invalid notes'?null:[],updated_at:failure==='missing version'?null:'2026-10-20T08:00:00.000Z'}]}:null;
 await f.c.window.testCommunity.onMap();await settle();assert.deepEqual(plain(f.c.personal),before);assert.deepEqual(plain([...f.c.window.testCommunity.readBase('member','test-map-v1')]),base);assert.equal(f.counts(start).notesWrites,0);
});
await checks.test('B31','private notes saved during a skipped floor sync still upload',async()=>{
 const f=await fixture(),target={id:'bank',name:'Bank',category:'Bank',x:20,y:30};f.files.set(f.c.config.markersFile,[target]);await f.travel('test-map','upper');
 const start=f.mark();assert(f.c.savePrivateNote(target,'marker','My route'));await f.e.tick(2000);assert.equal(f.e.remotePrivate[0].note,'My route');assert.equal(f.counts(start).notesWrites,1);
});
await checks.test('B31','world discovery memoizes duplicate files and a new edition clears them',async()=>{
 const f=await fixture(),c=f.c;f.files.set('data/world/zones.json',{zones:[]});f.files.set('data/world/markers.json',[]);
 c.registry.maps=[{id:'world',entry:true,defaultLevel:'surface',zonesFile:'data/world/zones.json',markersFile:'data/world/markers.json',levels:[{id:'surface',zonesFile:'data/world/zones.json',markersFile:'data/world/markers.json'}]}];c.foldName=s=>s;
 vm.runInContext(app.slice(app.indexOf('const mapKinds='),app.indexOf('// Small round badges')),c);
 let start=f.mark();await c.loadMapKinds();await c.fetchData('data/world/zones.json');await c.fetchData('data/world/markers.json');assert.equal(f.counts(start).data.length,2);
 start=f.mark();f.e.emit('atlas:published');await settle();await c.fetchData('data/world/markers.json');assert.equal(f.downloads.slice(start.files).filter(r=>r.url==='data/world/markers.json').length,1);
});
checks.finish();
