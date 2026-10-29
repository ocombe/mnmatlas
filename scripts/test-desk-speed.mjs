import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {browser, suite, suggestion, settle, openDesk, selectRow, cardAction} from './regression-harness.mjs';

const checks=suite(),app=await readFile(new URL('../app.js',import.meta.url),'utf8');
async function fixture(){
 const e=await browser(true),c=e.context,files=new Map(),downloads=[];
 c.registry.maps=Array.from({length:5},(_,i)=>{
  const id=i?'map-'+i:'test-map',base={id,title:'Map '+i,width:200,height:200,defaultView:{placeZoom:3},tileRevision:'v1'};
  const floors=i%2===0?['lower','upper']:['lower'];
  const levels=floors.map(level=>{const markersFile='data/'+id+'/'+level+'/markers.json',labelsFile='data/'+id+'/'+level+'/labels.json';files.set(markersFile,[]);files.set(labelsFile,{labels:[],trainers:[]});return {id:level,markersFile,labelsFile};});
  return {...base,...levels[0],id,...(levels.length>1?{levels,defaultLevel:'lower'}:{})};
 });
 c.config={...c.registry.maps[0],levelId:'lower'};c.originals=[];
 c.localPath=p=>typeof p==='string'&&p.startsWith('data/');
 c.fetch=async(url,options)=>{downloads.push({url,options});return {ok:true,status:200,headers:{get:()=> 'Tue, 20 Oct 2026 00:00:00 GMT'},json:async()=>structuredClone(files.get(url)||{})};};
 vm.runInContext(app.slice(app.indexOf('async function fetchData('),app.indexOf('function validateRegistry(')),c);
 // Travel fixture keeps the actual data reader, community map event and notes sync.
 c.loadMap=async(id,url,push,token)=>{
  const base=c.registry.maps.find(m=>m.id===id),floor=base.levels?.find(l=>l.id===url.searchParams.get('level'))||base;
  const conf={...base,...floor,id,levelId:url.searchParams.get('level')||'lower'};
  const [markers,labels]=await Promise.all([c.fetchData(conf.markersFile,[]),c.fetchData(conf.labelsFile,{labels:[],trainers:[]})]);
  c.config=conf;c.originals=markers;c.labelData=labels;c.loadSerial++;
  c.window.dispatchEvent(new c.CustomEvent('atlas:loaded',{detail:{reviewToken:token??null}}));
  await settle();
 };
 for(let i=0;i<60;i++)e.suggestions.push(suggestion(i+1,'new-marker',{name:'Place '+i,category:'Bank',x:10+i,y:20},
  {status:i<50?'pending':i<55?'approved':'rejected',map:c.registry.maps[Math.floor(i/12)].id,level:'lower',updated_at:'2026-10-20T10:00:00.'+String(i).padStart(3,'0')+'Z'}));
 return {e,c,downloads,files};
}
const {e,c,downloads}=await fixture(),measurements=[];
async function step(name,run,budget){
 const start=e.calls.length,files=downloads.length;await run();await settle();
 const calls=e.calls.slice(start),reads=calls.filter(q=>q.table==='suggestions'&&q.op==='select'&&!q.selectOptions?.head),queue=reads.filter(q=>!q.filters.map&&!q.filters.user_id&&!q.filters.id);
 const count={step:name,supabase:calls.filter(q=>q.table||q.rpc).length,suggestions:reads.length,queue:queue.length,full:queue.filter(q=>!q.since).length,data:downloads.slice(files).filter(q=>q.url.startsWith('data/')).length};
 measurements.push(count);console.log('REQUESTS '+JSON.stringify(count));
 await checks.test('B30',name,()=>budget(count,queue));
}
await step('open',()=>openDesk(e),(n,q)=>{assert.equal(n.queue,1);assert.equal(n.full,1);assert(n.supabase<=3);assert(n.data<=16);});
for(const [i,id] of [2,3,13,14,25,26,37,38,49,50].entries()){
 const same=e.context.window.testReviewDesk.selected?.map===e.suggestions.find(r=>r.id===id).map;
 await step('card '+(i+1)+(same?' same map':' other map'),()=>selectRow(e,id),n=>{if(same){assert.equal(n.supabase,0);assert.equal(n.suggestions,0);assert.equal(n.data,0);}else{assert(n.supabase<=10);assert(n.suggestions<=4);assert(n.data<=4);}});
}
await selectRow(e,2);
for(let i=0;i<3;i++)await step('approve '+(i+1),()=>cardAction(e,'Approve'),(n,q)=>{assert(n.supabase<=4);assert(n.data<=4);assert.equal(n.queue,1);assert.equal(n.full,0);assert.equal(n.suggestions,1);assert(q[0].since);});
await step('reject',()=>cardAction(e,'Reject'),n=>{assert(n.supabase<=4);assert.equal(n.suggestions,1);assert.equal(n.full,0);assert.equal(n.data,0);});
await step('undo',async()=>{const undo=c.$('status').querySelectorAll('button').find(b=>b.textContent==='Undo');assert(undo);await undo.onclick();},n=>{assert(n.supabase<=4);assert.equal(n.suggestions,1);assert.equal(n.full,0);assert.equal(n.data,0);});
await step('focus 1',()=>e.emit('focus'),n=>{assert(n.supabase<=5);assert(n.queue<=1);assert.equal(n.full,0);assert.equal(n.data,0);});
await step('focus 2',()=>e.emit('focus'),n=>{assert.equal(n.supabase,0);assert.equal(n.data,0);});
await checks.test('B30','map files use conditional validation',()=>{assert(downloads.some(q=>q.url.endsWith('markers.json')));assert(downloads.filter(q=>q.url.startsWith('data/')&&!q.url.startsWith('data/credits/')).every(q=>q.options?.cache==='no-cache'));});
const queueReads=(e,start=0)=>e.calls.slice(start).filter(q=>q.table==='suggestions'&&q.op==='select'&&q.range&&!q.filters.map&&!q.filters.user_id);
await checks.test('B30','incremental refresh merges arrivals, tied versions and published departures',async()=>{
 const {e,c}=await fixture();await openDesk(e);const desk=c.window.testReviewDesk,start=e.calls.length;
 const changed=e.suggestions.find(r=>r.id===2);changed.status='published';changed.updated_at='2026-10-21T12:00:00.000001Z';
 e.suggestions.push(suggestion(61,'new-marker',{name:'Arrival',category:'Bank',x:12,y:24},{status:'pending',updated_at:changed.updated_at}));
 await desk.refresh();assert.equal(queueReads(e,start).length,1);assert(!c.$('desk-list').querySelectorAll('.desk-item').some(n=>n.dataset.row==='2'));
 await selectRow(e,61);assert.equal(desk.selected.payload.name,'Arrival');
 // Another transaction can land on the exact boundary, including sub-millisecond precision.
 e.suggestions.push(suggestion(62,'new-marker',{name:'Tied arrival',category:'Bank',x:14,y:24},{status:'pending',updated_at:changed.updated_at}));
 await desk.refresh();await selectRow(e,62);assert.equal(desk.selected.payload.name,'Tied arrival');
 assert.equal(queueReads(e).at(-1).since.value,changed.updated_at);assert(!queueReads(e).at(-1).in);
 desk.close();const reopened=e.calls.length;await openDesk(e);assert.equal(queueReads(e,reopened).length,1);assert(!queueReads(e,reopened)[0].since);
});
for(const failure of ['missing column','read error','missing row version'])await checks.test('B30','full fallback after '+failure,async()=>{
 const {e,c}=await fixture();await openDesk(e);const start=e.calls.length;let failed=false;
 e.suggestionFault=request=>{if(!request.since||request.filters.map||failed)return;failed=true;return failure==='missing row version'?{data:[{...e.suggestions[0],updated_at:null}]}:{error:Error(failure==='missing column'?'column suggestions.updated_at does not exist':'offline')};};
 e.suggestions[1].payload.name='Fresh after fallback';await c.window.testReviewDesk.refresh();
 const reads=queueReads(e,start);assert.equal(reads.length,2);assert(reads[0].since);assert(!reads[1].since);await selectRow(e,2);assert.equal(c.window.testReviewDesk.selected.payload.name,'Fresh after fallback');
});
await checks.test('B30','missing versions keep refreshes full and failed reads keep local decisions',async()=>{
 const {e,c}=await fixture();delete e.suggestions[0].updated_at;await openDesk(e);let start=e.calls.length;await c.window.testReviewDesk.refresh();assert(!queueReads(e,start)[0].since);
 e.failSuggestions=true;c.console={...console,error(){}};await cardAction(e,'Reject');assert.equal(e.suggestions[0].status,'pending','Failed writes leave the row intact');e.failSuggestions=false;
 e.suggestionFault=request=>request.op==='select'&&request.range?{error:Error('offline')}:null;
 await cardAction(e,'Reject');assert.equal(e.suggestions[0].status,'rejected');assert(!c.$('desk-list').querySelectorAll('.desk-item').some(n=>n.dataset.row==='1'));
});
await checks.test('B30','stale approvals still refuse a newer server version',async()=>{
 const {e,c}=await fixture();await openDesk(e);e.suggestions[0].updated_at='2028-01-01T00:00:00.000Z';e.suggestions[0].payload.name='Changed elsewhere';
 await cardAction(e,'Approve');assert.equal(e.suggestions[0].status,'pending');assert(e.statuses.some(s=>s.startsWith('Changed since you opened it')));assert.equal(c.$('review-name').value,'Changed elsewhere');
});
await checks.test('B30','full and incremental reads paginate beyond 500 rows',async()=>{
 const {e,c}=await fixture();for(let i=61;i<=565;i++)e.suggestions.push(suggestion(i,'new-marker',{name:'Place '+i,category:'Bank',x:10,y:20},{status:'pending',updated_at:'2026-10-20T11:00:00.000Z'}));
 let start=e.calls.length;await openDesk(e);assert.equal(queueReads(e,start).length,2);await selectRow(e,565);assert.equal(c.window.testReviewDesk.selected.id,565);
 for(const row of e.suggestions)row.updated_at='2028-01-01T00:00:00.000Z';e.suggestions[0].status='published';start=e.calls.length;await c.window.testReviewDesk.refresh();assert.equal(queueReads(e,start).length,2);assert(!c.$('desk-list').querySelectorAll('.desk-item').some(n=>n.dataset.row==='1'));
});
await checks.test('B30','all floors start fetching in parallel',async()=>{
 const {e,c}=await fixture(),waiting=[];c.fetchData=file=>new Promise(resolve=>waiting.push(()=>resolve(file.endsWith('labels.json')?{labels:[],trainers:[]}:[])));
 const loading=c.window.testCommunity.reviewLocations(e.suggestions);await settle();assert.equal(waiting.length,16);waiting.forEach(release=>release());await loading;
});
await checks.test('B30','queue updates preserve the edition boundary for rejected map pins',async()=>{
 const {e,c}=await fixture();e.suggestions[55].reviewed_at='2028-01-01T00:00:00.000Z';e.suggestions[56].reviewed_at='2020-01-01T00:00:00.000Z';
 await openDesk(e);await selectRow(e,49);c.window.testReviewDesk.close();
 const names=e.layers.filter(l=>!l.removed).flatMap(l=>l.items).map(i=>i.options?.icon?.look?.name);
 assert(names.includes(e.suggestions[55].payload.name));assert(!names.includes(e.suggestions[56].payload.name));
});
await checks.test('B30','approved reads coalesce, expire and invalidate during a flight',async()=>{
 const {e,c}=await fixture(),api=c.window.testCommunity;let now=Date.now();c.Date=class extends Date{static now(){return now;}};
 const reads=()=>e.calls.filter(q=>q.table==='suggestions'&&q.op==='select'&&q.filters.map).length;
 api.invalidateApproved();let start=reads();await Promise.all([api.loadApproved(),api.loadApproved(),api.loadApproved()]);assert.equal(reads()-start,4);
 start=reads();await api.loadApproved();assert.equal(reads(),start);now+=10001;await api.loadApproved();assert.equal(reads()-start,4);
 let release,held=false;e.suggestionFault=request=>{if(request.op==='select'&&request.filters.status==='approved'&&!held){held=true;return new Promise(resolve=>release=()=>resolve({data:[]}));}};
 api.invalidateApproved();const old=api.loadApproved();await settle();assert(release);api.invalidateApproved();start=reads();await api.loadApproved();assert.equal(reads()-start,4);release();await old;start=reads();await api.loadApproved();assert.equal(reads(),start,'Older completion cannot replace the newer cache');
});
await checks.test('B30','review travel keeps notes sync and defers note retirement to normal travel',async()=>{
 const {e,c}=await fixture();await openDesk(e);let start=e.calls.length;await selectRow(e,13);let calls=e.calls.slice(start);
 assert(calls.some(q=>q.table==='user_notes'));assert(!calls.some(q=>q.table==='suggestions'&&q.columns==='id,level,payload,note_id'));
 c.window.testReviewDesk.close();start=e.calls.length;await c.loadMap('test-map',new URL('https://atlas.example/?level=lower'));
 assert(e.calls.slice(start).some(q=>q.table==='suggestions'&&q.columns==='id,level,payload,note_id'));
});
await checks.test('B30','focus refreshes again after one minute without refetching queue map files',async()=>{
 const {e,c,downloads}=await fixture();let now=Date.now();c.Date=class extends Date{static now(){return now;}};await openDesk(e);e.emit('focus');await settle();
 const dataCount=()=>downloads.filter(q=>q.url.startsWith('data/')).length;let start=e.calls.length,files=dataCount();now+=59999;e.emit('focus');await settle();assert.equal(e.calls.length,start);now++;e.emit('focus');await settle();assert.equal(queueReads(e,start).length,1);assert.equal(dataCount(),files);
});
checks.finish();
