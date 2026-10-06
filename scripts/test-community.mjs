import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source=await readFile(new URL('../community.js',import.meta.url),'utf8');
class Node {
 constructor(tag,value='',cls=''){this.tagName=tag;this.textContent=value;this.className=cls;this.children=[];this.listeners={};this.hidden=false;this.value='';this.open=false;this.style={setProperty(){}};}
 append(...nodes){for(const n of nodes){if(n.parentElement)n.remove();n.parentElement=this;this.children.push(n);}}
 replaceChildren(...nodes){this.children=[];this.append(...nodes);}
 get lastChild(){return this.children.at(-1);}
 setAttribute(k,v){this[k]=v;}
 addEventListener(k,fn){(this.listeners[k]??=[]).push(fn);}
 fire(k){for(const fn of this.listeners[k]||[])fn({target:this});}
 remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(n=>n!==this);}
 showModal(){this.open=true;}
 close(){if(!this.open)return;this.open=false;setImmediate(()=>this.fire('close'));}
 querySelectorAll(tag){return this.children.flatMap(n=>[...(n.tagName===tag?[n]:[]),...n.querySelectorAll(tag)]);}
}
const settle=async()=>{for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve));};
function environment(settings={},hostname='atlas.example',session=null){
 const elements=new Map(),head=new Node('head'),body=new Node('body'),bottom=new Node('div'),formHint=new Node('p'),noteLine=new Node('p');let creations=0,timerId=0;
 for(const id of ['about-counts','search','about-community','editor','map-frame'])elements.set(id,new Node('div'));elements.get('editor').querySelector=()=>formHint;
 const timers=new Map(),listeners=new Map(),saved=new Map(),calls=[],counts=[],statuses=[],remote=[{id:'personal-remote',name:'Remote',category:'Personal',note:'',x:40,y:50},{id:'personal-local',name:'Older remote',category:'Personal',note:'',x:1,y:2}];
 const user=session?.user,suggestions=[],layers=[],banned=[];let authHandler,failNotes=false,failSuggestions=false;
 function result(table,request){
  calls.push({table,...request});
  if(table==='admins')return {data:user?.admin?{user_id:user.id}:null};
  if(table==='user_notes'){
   if(request.op==='select')return {data:{notes:structuredClone(remote)}};
   if(failNotes)return {error:Error('offline')};remote.splice(0,remote.length,...request.payload.notes);return {data:null};
  }
  if(table==='banned'){if(request.op==='insert'){banned.push(request.payload);return {data:null};}if(request.op==='delete'){banned.splice(banned.findIndex(r=>r.user_id===request.filters.user_id),1);return {data:null};}return {data:banned.map(r=>({...r,banned_at:new Date().toISOString()}))};}
  if(table==='suggestions'&&request.op==='update'&&request.filters.user_id){for(const row of suggestions)if(row.user_id===request.filters.user_id&&row.status===request.filters.status)Object.assign(row,request.payload);return {data:null};}
  if(table==='suggestions'){if(failSuggestions)return {error:Error('offline')};if(request.op==='insert')return {data:{id:1000+calls.length}};if(request.op==='update'){const row=suggestions.find(r=>r.id===request.filters.id);if(row)Object.assign(row,request.payload);return {data:[{id:request.filters.id}]};}return {data:request.op==='select'?suggestions.filter(r=>r.status==='pending'):[]};}
 }
 const client={rpc:async(name)=>{calls.push({rpc:name});return {error:null};},from(table){
  const request={op:'select',filters:{}},query={select(){return query;},eq(k,v){request.filters[k]=v;return query;},order(){return query;},range(){return query;},limit(){return query;},maybeSingle(){return query;},single(){return query;},upsert(payload){request.op='upsert';request.payload=payload;return query;},insert(payload){request.op='insert';request.payload=payload;return query;},update(payload){request.op='update';request.payload=payload;return query;},delete(){request.op='delete';return query;},then(done,reject){return Promise.resolve(result(table,request)).then(done,reject);}};return query;
 },auth:{onAuthStateChange(fn){authHandler=fn;},getSession:async()=>({data:{session}}),signInWithOAuth:async options=>{calls.push({oauth:options});return {};},signOut:async options=>{calls.push({signOut:options});authHandler('SIGNED_OUT',null);return {};}}};
 const descendants=node=>[node,...node.children.flatMap(descendants)];
 const document={head,body,hidden:false,createElement(tag){creations++;const n=new Node(tag);n.dataset={};return n;},getElementById(id){return elements.get(id)||[...descendants(body),...descendants(elements.get('map-frame'))].find(n=>n.id===id)||null;},querySelector(selector){return selector==='.journal-bottom'?bottom:{previousElementSibling:noteLine};},addEventListener(){}};
 const store=new Map(),context={document,URL,Date,Map,Set,JSON,console,embedded:false,localStorage:{getItem:k=>store.has(k)?store.get(k):null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k)},atlasConfig:{supabaseUrl:'',supabaseKey:'',goatcounter:'',...settings},location:{hostname,href:'https://atlas.example/?map=test-map#private'},config:{id:'test-map',tileRevision:'v1',title:'Test map',width:200,height:200,minZoom:0,levelId:'lower',levels:[{id:'lower'},{id:'upper'}]},map:{},loading:false,loadSerial:1,alignmentMode:false,pins:new Map(),originals:[{id:'published',name:'Bank',category:'Bank',note:'',x:12,y:22,level:'lower'}],personal:[{id:'personal-local',name:'Local wins',category:'Personal',note:'private note',x:10,y:20}],labelData:{labels:[]},publishedPositions:new Map([['published',[10,20]]]),publishedLabelPositions:new Map(),text:(...args)=>new Node(...args),status:message=>statuses.push(message),compact:()=>false,setPanel(){},choose(){},setupCategoryControls(){},buildPlaceIndex(){},valid:m=>!!m.id&&Number.isFinite(m.x)&&Number.isFinite(m.y),localStorage:{getItem:k=>saved.get(k)||null,setItem:(k,v)=>saved.set(k,v)},setTimeout(fn,ms){const id=++timerId;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id)};
 context.$=id=>document.getElementById(id);context.window={supabase:{createClient(...args){calls.push({createClient:args});return client;}},addEventListener(k,fn){if(!listeners.has(k))listeners.set(k,[]);listeners.get(k).push(fn);},dispatchEvent({type}){for(const fn of listeners.get(type)||[])fn();}};
 context.config.defaultView={placeZoom:3};context.map.fitBounds=()=>{};context.map.setView=()=>{};context.bounded=(x,y)=>Number.isFinite(x)&&Number.isFinite(y);context.locationOf=m=>[m.x,m.y];context.L={layerGroup(){const layer={items:[],addTo(){layers.push(layer);return layer;},addLayer(item){layer.items.push(item);},remove(){layer.removed=true;}};return layer;},circleMarker(where,options){return {where,options,bindTooltip(){return this;}};},polyline(where,options){return {where,options,getLatLngs(){return where;},setLatLngs(w){where=w;}};},marker(where,options){return {where,options,bindTooltip(){return this;},on(){return this;},setIcon(icon){this.options.icon=icon;},getLatLng(){return where;}};},latLngBounds:locations=>locations};context.structuredClone=structuredClone;context.categories={Personal:['P','#a04438'],Tradeskill:['T','#385f60'],Vendor:['V','#876036']};context.markerSymbol=()=>document.createElement('b');context.pinIcon=m=>({look:m});context.pixelsOf=where=>where;
 context.allMarkers=()=>[...context.originals,...context.personal];context.popup=m=>{const n=new Node('div');context.window.atlasCommunity?.popup(m,n);return n;};context.drawMarkers=()=>{for(const m of context.allMarkers())context.pins.set(m.id,{setPopupContent(){}});};
 context.persist=next=>{saved.set('notes',JSON.stringify(next));context.personal=next;context.window.dispatchEvent({type:'atlas:notes'});return true;};
 vm.runInNewContext(source,context,{filename:'community.js'});
 return {context,elements,head,body,bottom,calls,counts,statuses,remote,saved,suggestions,layers,banned,get creations(){return creations;},set failNotes(v){failNotes=v;},set failSuggestions(v){failSuggestions=v;},emit:type=>context.window.dispatchEvent({type}),async tick(ms){const jobs=[...timers].filter(([,t])=>t.ms===ms);for(const [id,t] of jobs){timers.delete(id);t.fn();}await settle();}};
}
for(const settings of [{},{supabaseUrl:'https://project.example'},{supabaseKey:'public-key'}]){const e=environment(settings);assert.equal(e.calls.length,0);assert.equal(e.creations,0);assert.equal(e.head.children.length,0);assert.equal(e.bottom.children.length,0);}
for(const hostname of ['localhost','127.0.0.1']){const e=environment({goatcounter:'counter'},hostname);assert.equal(e.head.children.length,0);}
{
 const e=environment({goatcounter:'counter'}),script=e.head.children[0];assert.equal(script.src,'https://gc.zgo.at/count.js');assert.equal(script.dataset.goatcounter,'https://counter.goatcounter.com/count');assert.equal(e.context.window.goatcounter.no_onload,true);
 e.context.window.goatcounter.count=row=>e.counts.push(row);script.onload();assert.equal(e.counts.length,1);assert.equal(e.counts[0].path,'/test-map/lower');assert.equal(e.counts[0].title,'Test map');assert.equal(e.counts[0].referrer,'');e.emit('atlas:loaded');assert.equal(e.counts.length,1);
 e.context.config.levelId='upper';e.context.loadSerial++;e.emit('atlas:loaded');assert.equal(e.counts[1].path,'/test-map/upper');
 e.elements.get('search').value='private query';e.elements.get('search').fire('input');e.elements.get('search').fire('input');await e.tick(650);assert.equal(e.counts.filter(r=>r.path==='search').length,1);e.emit('atlas:note-added');e.emit('atlas:positions');assert(!JSON.stringify(e.counts).includes('private'));
}
{
 const e=environment({supabaseUrl:'https://project.example',supabaseKey:'public-key'});await settle();assert.equal(e.bottom.children.length,1);
 const popup=e.context.popup(e.context.originals[0]),report=popup.children[0].children[1];assert.equal(report.textContent,'Report a problem');assert.equal(popup.children[0].children[0].textContent,'Suggest an edit');await report.onclick();assert(e.body.children.find(n=>n.id==='community-dialog').open);assert.equal(e.calls.filter(r=>r.table==='suggestions').length,0);
 const d=e.body.children.find(n=>n.id==='community-dialog'),sign=d.querySelectorAll('button').find(n=>n.textContent==='Sign in with Discord');await sign.onclick();assert.equal(e.calls.find(r=>r.oauth).oauth.options.redirectTo,'https://atlas.example/?map=test-map');
}
{
 const session={user:{id:'user-a',user_metadata:{full_name:'Atlas member'},admin:true}},e=environment({supabaseUrl:'https://project.example',supabaseKey:'public-key'},'atlas.example',session);await settle();
 assert.equal(e.context.personal.length,2);assert.equal(e.context.personal.find(m=>m.id==='personal-local').name,'Local wins');assert.equal(e.remote.find(m=>m.id==='personal-local').name,'Local wins');assert(e.bottom.children[0].querySelectorAll('button').some(n=>n.textContent==='Review suggestions'&&!n.hidden));
 const d=e.body.children.find(n=>n.id==='community-dialog');let p=e.context.popup(e.context.originals[0]);p.children[0].children[1].onclick();assert(d.open);const send=()=>d.querySelectorAll('button').find(n=>n.textContent==='Send report').onclick();
 await send();assert(d.open,'A reason is required');assert.equal(e.calls.filter(r=>r.table==='suggestions').length,0);
 e.failSuggestions=true;d.querySelectorAll('input').find(n=>n.value==='name').checked=true;await send();assert(d.open,'A failed report keeps the dialog open');e.failSuggestions=false;
 await send();assert(!d.open);let sent=e.calls.filter(r=>r.table==='suggestions'&&r.op==='insert').at(-1).payload;assert.equal(sent.kind,'report');assert.equal(sent.target_id,'published');assert.equal(JSON.stringify(sent.payload),JSON.stringify({name:'Bank',reason:'name',x:10,y:20}),'Reports use the published position');assert.equal(e.context.popup(e.context.originals[0]).children[0].children[1].textContent,'Reported, thanks');
 // A name or description edit keeps what the visitor saw, so a stale edit cannot overwrite a newer text.
 e.context.popup(e.context.originals[0]).children[0].children[0].onclick();assert(d.open);const field=id=>[...d.querySelectorAll('input'),...d.querySelectorAll('textarea')].find(n=>n.id===id),sendEdit=()=>d.querySelectorAll('button').find(n=>['Send for review','Publish'].includes(n.textContent)).onclick();
 await sendEdit();assert(d.open,'An unchanged edit is not sent');field('edit-name').value='  Bank   of the Bay ';field('edit-note').value='Open late';await sendEdit();assert(!d.open);sent=e.calls.filter(r=>r.table==='suggestions'&&r.op==='insert').at(-1).payload;assert.equal(sent.kind,'edit-marker');assert.equal(sent.credit,false,'Credit is opt-in');assert.equal(sent.status,undefined,'Suggestions are always inserted as pending');
 const approval=e.calls.filter(r=>r.table==='suggestions'&&r.op==='update').at(-1);assert.equal(approval.payload.status,'approved','An admin\'s own edit is approved right after it is saved');assert.equal(approval.filters.status,'pending');assert.equal(sent.target_id,'published');assert.equal(JSON.stringify(sent.payload),JSON.stringify({name:'Bank of the Bay',note:'Open late',from:{name:'Bank',note:''}}));assert.equal(e.context.popup(e.context.originals[0]).children[0].children[0].textContent,'Edit sent for review');
 e.emit('atlas:positions');assert(d.open);await d.querySelectorAll('button').find(n=>['Send for review','Publish'].includes(n.textContent)).onclick();assert(!d.open);assert.equal(e.calls.filter(r=>r.table==='suggestions'&&r.op==='insert'&&r.payload.kind==='move-marker').length,1);e.emit('atlas:positions');assert(!d.open);
 p=e.context.popup(e.context.personal[0]);await p.children.find(n=>n.textContent==='Share with everyone').onclick();await d.querySelectorAll('button').find(n=>['Send for review','Publish'].includes(n.textContent)).onclick();assert.equal(e.calls.filter(r=>r.table==='suggestions'&&r.op==='insert').at(-1).payload.kind,'new-marker');assert.equal(e.context.popup(e.context.personal[0]).children[0].textContent,'Shared for review');
 e.context.personal[0].note='Updated locally';e.emit('atlas:notes');await e.tick(2000);assert.equal(e.remote.find(m=>m.id===e.context.personal[0].id).note,'Updated locally');
 e.failNotes=true;e.context.personal[0].note='Offline local note';e.emit('atlas:notes');await e.tick(2000);assert.equal(e.context.personal[0].note,'Offline local note');assert(e.statuses.some(m=>m.includes('local notes are safe')));e.failNotes=false;e.emit('online');await settle();assert.equal(e.remote.find(m=>m.id===e.context.personal[0].id).note,'Offline local note');
 // A note deleted here while its push failed stays deleted at the next sync; a note added elsewhere still arrives.
 const gone=e.context.personal.find(m=>m.id==='personal-remote');assert(gone);e.failNotes=true;e.context.persist(e.context.personal.filter(m=>m!==gone));await e.tick(2000);e.failNotes=false;
 e.remote.push({id:'personal-elsewhere',name:'Elsewhere',category:'Personal',note:'',x:3,y:4});e.emit('atlas:loaded');await settle();await e.tick(2000);
 assert(!e.context.personal.some(m=>m.id==='personal-remote'),'A deleted note does not come back');assert(e.context.personal.some(m=>m.id==='personal-elsewhere'),'A note from another device arrives');assert(!e.remote.some(m=>m.id==='personal-remote'));
 e.suggestions.push({id:9,status:'pending',map:'test-map',level:'lower',kind:'move-marker',payload:{name:'Bank',from:[10,20],to:[30,40]},author_name:'Member',created_at:new Date().toISOString()});
 const reviewButton=e.bottom.children[0].querySelectorAll('button').find(n=>n.textContent==='Review suggestions');reviewButton.onclick();await settle();const review=e.body.children.find(n=>n.id==='community-review');assert(review.open);await review.querySelectorAll('button').find(n=>['Show on map','Review on map'].includes(n.textContent)).onclick();await settle();assert(!review.open);assert.equal(e.layers.at(-1).items.length,3);assert(!e.layers.at(-1).removed,'Closing the dialog must keep the new preview');
 const preview=e.context.$('community-preview');assert(preview);await preview.querySelectorAll('button').find(n=>n.textContent==='Approve').onclick();assert.equal(e.suggestions[0].status,'approved');assert(e.suggestions[0].reviewed_at);assert(e.layers.at(-1).removed);
 e.suggestions.push({id:10,status:'pending',map:'test-map',level:'lower',kind:'report',target_id:'published',payload:{name:'Bank',reason:'position',x:10,y:20},comment:'Across the bridge',author_name:'Member',created_at:new Date().toISOString()});
 reviewButton.onclick();await settle();assert(review.querySelectorAll('p').some(n=>n.textContent==='Wrong position'));assert(!review.querySelectorAll('button').some(n=>n.textContent==='Approve'));await review.querySelectorAll('button').find(n=>n.textContent==='Fixed').onclick();assert.equal(e.suggestions[1].status,'resolved');
 // A suggested marker can be renamed and given another type on the map before approval.
 e.suggestions.push({id:11,status:'pending',map:'test-map',level:'lower',kind:'new-marker',payload:{name:'Chef',x:5,y:6,category:'Tradeskill',trade:'Cooking'},author_name:'Member',created_at:new Date().toISOString()});
 reviewButton.onclick();await settle();await review.querySelectorAll('button').filter(n=>n.textContent==='Review on map').at(-1).onclick();await settle();
 {const bar=e.context.$('community-preview');bar.querySelectorAll('input')[0].value='Chef Arzya';bar.querySelectorAll('select')[0].value='Vendor';await bar.querySelectorAll('button').find(n=>n.textContent==='Approve').onclick();
 const approved=e.suggestions.find(r=>r.id===11);assert.equal(approved.status,'approved');assert.equal(approved.payload.name,'Chef Arzya');assert.equal(approved.payload.category,'Vendor');assert.equal(approved.payload.trade,undefined);}
 // Banning an author dismisses everything they have waiting and lists them for a later unban.
 for(const id of [11,12])e.suggestions.push({id,user_id:'spammer',status:'pending',map:'test-map',level:'lower',kind:'report',target_id:'published',payload:{name:'Spam '+id,reason:'other',x:1,y:1},author_name:'Spammer',created_at:new Date().toISOString()});
 reviewButton.onclick();await settle();assert(review.querySelectorAll('p').some(n=>n.textContent==='By Spammer (2 waiting)'));review.querySelectorAll('button').find(n=>n.textContent==='Ban author').onclick();
 const ban=e.body.children.find(n=>n.id==='community-dialog');assert(ban.open);await ban.querySelectorAll('button').find(n=>n.textContent==='Ban and dismiss').onclick();await settle();
 assert.equal(e.banned.length,1);assert.equal(e.banned[0].user_id,'spammer');assert(e.suggestions.filter(r=>r.user_id==='spammer').every(r=>r.status==='rejected'&&r.review_note==='Author banned'));
 const lift=review.querySelectorAll('button').find(n=>n.textContent==='Lift ban');assert(lift);await lift.onclick();await settle();assert.equal(e.banned.length,0);
 // Deleting the account calls the server once, signs out locally and drops pending note syncs.
 e.context.personal[0].note='Not synced';e.emit('atlas:notes');const del=e.bottom.children[0].querySelectorAll('button').find(n=>n.textContent==='Delete my account');del.onclick();const confirm=e.body.children.find(n=>n.id==='community-dialog');assert(confirm.open);
 await confirm.querySelectorAll('button').find(n=>n.textContent==='Delete my account'&&n.className==='danger').onclick();await settle();assert.equal(e.calls.filter(r=>r.rpc==='delete_my_account').length,1);assert.equal(e.calls.find(r=>r.signOut).signOut.scope,'local');
 assert(!e.bottom.children[0].querySelectorAll('button').some(n=>n.textContent==='Delete my account'));const writes=e.calls.filter(r=>r.table==='user_notes'&&r.op==='upsert').length;await e.tick(2000);assert.equal(e.calls.filter(r=>r.table==='user_notes'&&r.op==='upsert').length,writes,'No sync after deletion');
}
console.log('Client checks passed: banning, account deletion, disabled/partial config, localhost exclusion, private counters, sign-in redirect, problem reports, suggestions, shared notes, merge, offline sync and admin preview/approval.');
