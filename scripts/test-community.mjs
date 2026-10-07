import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source=await readFile(new URL('../community.js',import.meta.url),'utf8'),wikiLinks=await readFile(new URL('../wiki-links.js',import.meta.url),'utf8');
class Node {
 constructor(tag,value='',cls=''){this.tagName=tag;this.textContent=value;this.className=cls;this.children=[];this.listeners={};this.hidden=false;this.value='';this.open=false;this.style={setProperty(){}};this.classList={add(){},remove(){}};}
 append(...nodes){for(const n of nodes){if(n.parentElement)n.remove();n.parentElement=this;this.children.push(n);}}
 replaceChildren(...nodes){this.children=[];this.append(...nodes);}
 get lastChild(){return this.children.at(-1);}
 setAttribute(k,v){this[k]=v;}
 removeAttribute(k){delete this[k];}
 after(...nodes){const parent=this.parentElement;for(const n of nodes){if(n.parentElement)n.remove();n.parentElement=parent;parent.children.splice(parent.children.indexOf(this)+1,0,n);}}
 insertAdjacentHTML(){}
 focus(){}
 contains(n){for(;n;n=n.parentElement)if(n===this)return true;return false;}
 querySelector(tag){return this.querySelectorAll(tag)[0]||null;}
 addEventListener(k,fn){(this.listeners[k]??=[]).push(fn);}
 fire(k){for(const fn of this.listeners[k]||[])fn({target:this});}
 dispatchEvent(event){this.fire(event.type);}
 remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(n=>n!==this);}
 showModal(){this.open=true;}
 close(){if(!this.open)return;this.open=false;setImmediate(()=>this.fire('close'));}
 querySelectorAll(tag){return this.children.flatMap(n=>[...(n.tagName===tag?[n]:[]),...n.querySelectorAll(tag)]);}
}
const settle=async()=>{for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve));};
function environment(settings={},hostname='atlas.example',session=null){
 const elements=new Map(),head=new Node('head'),body=new Node('body'),bottom=new Node('div'),bar=new Node('header'),formHint=new Node('p'),noteLine=new Node('p');let creations=0,timerId=0;
 for(const id of ['about-counts','search','about-community','editor','map-frame','wiki-field','wiki','name','category','note'])elements.set(id,Object.assign(new Node('div'),{dataset:{},value:''}));{const form=new Node('form');form.append(elements.get('name'));for(const id of ['suggest-on-save','suggest-check'])elements.set(id,Object.assign(new Node(id==='suggest-check'?'input':'div'),{dataset:{},checked:false}));const credit=Object.assign(new Node('input'),{checked:false}),row=new Node('label');row.append(credit);elements.set('suggest-credit',credit);}elements.get('category').options=['Personal','Vendor','Quest','Mob camp','Named mob','Class trainer'].map(value=>({value}));elements.get('editor').querySelector=()=>formHint;
 const panelButton=new Node('button','Search menu');bar.append(panelButton);elements.set('toggle-panel',panelButton);
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
  if(table==='suggestions'){if(failSuggestions)return {error:Error('offline')};if(request.op==='insert')return {data:{id:1000+calls.length}};if(request.op==='update'){const row=suggestions.find(r=>r.id===request.filters.id);if(row)Object.assign(row,request.payload);return {data:[{id:request.filters.id}]};}if(request.op==='select'&&request.filters.id!==undefined)return {data:suggestions.find(r=>r.id===request.filters.id)||null};return {data:request.op==='select'?suggestions.filter(r=>r.status==='pending'):[]};}
 }
 const client={rpc:async(name)=>{calls.push({rpc:name});return {error:null};},from(table){
  const request={op:'select',filters:{}},query={select(){return query;},eq(k,v){request.filters[k]=v;return query;},order(){return query;},range(){return query;},limit(){return query;},maybeSingle(){return query;},single(){return query;},upsert(payload){request.op='upsert';request.payload=payload;return query;},insert(payload){request.op='insert';request.payload=payload;return query;},update(payload){request.op='update';request.payload=payload;return query;},delete(){request.op='delete';return query;},then(done,reject){return Promise.resolve(result(table,request)).then(done,reject);}};return query;
 },auth:{onAuthStateChange(fn){authHandler=fn;},getSession:async()=>({data:{session}}),signInWithOAuth:async options=>{calls.push({oauth:options});return {};},signOut:async options=>{calls.push({signOut:options});authHandler('SIGNED_OUT',null);return {};}}};
 const descendants=node=>[node,...node.children.flatMap(descendants)];
 const document={head,body,hidden:false,createElement(tag){creations++;const n=new Node(tag);n.dataset={};return n;},getElementById(id){return elements.get(id)||[...descendants(body),...descendants(elements.get('map-frame'))].find(n=>n.id===id)||null;},querySelector(selector){return selector==='.journal-bottom'?bottom:{previousElementSibling:noteLine};},addEventListener(){}};
 const store=new Map(),wikiRequests=[],context={document,URL,Date,Map,Set,JSON,console,AbortController,Event:class{constructor(type){this.type=type;}},fetch:async(url,options)=>{wikiRequests.push({url,options});return {ok:true,status:200,json:async()=>({results:[{id:'npc-banker',type:'npc',name:'Banker',zone:'Night Harbor',url:'https://monstersandmemories.wiki/npcs/banker'},{id:'bank-note',type:'item',name:'Bank note',zone:'Night Harbor',url:'https://monstersandmemories.wiki/items/bank-note'}]})};},embedded:false,localStorage:{getItem:k=>store.has(k)?store.get(k):null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k)},atlasConfig:{supabaseUrl:'',supabaseKey:'',goatcounter:'',...settings},location:{hostname,href:'https://atlas.example/?map=test-map#private'},config:{id:'test-map',tileRevision:'v1',title:'Test map',width:200,height:200,minZoom:0,levelId:'lower',levels:[{id:'lower'},{id:'upper'}]},map:{},loading:false,loadSerial:1,alignmentMode:false,pins:new Map(),originals:[{id:'published',name:'Bank',category:'Bank',note:'',x:12,y:22,level:'lower'}],personal:[{id:'personal-local',name:'Local wins',category:'Personal',note:'private note',x:10,y:20}],labelData:{labels:[]},publishedPositions:new Map([['published',[10,20]]]),publishedLabelPositions:new Map(),text:(...args)=>new Node(...args),status:message=>statuses.push(message),compact:()=>false,setPanel(){},choose(){},setupCategoryControls(){},buildPlaceIndex(){},valid:m=>!!m.id&&Number.isFinite(m.x)&&Number.isFinite(m.y),localStorage:{getItem:k=>saved.get(k)||null,setItem:(k,v)=>saved.set(k,v)},setTimeout(fn,ms){const id=++timerId;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id)};
 context.$=id=>document.getElementById(id);context.window={supabase:{createClient(...args){calls.push({createClient:args});return client;}},addEventListener(k,fn){if(!listeners.has(k))listeners.set(k,[]);listeners.get(k).push(fn);},dispatchEvent(event){for(const fn of listeners.get(event.type)||[])fn(event);}};
 context.config.defaultView={placeZoom:3};context.map.fitBounds=()=>{};context.map.setView=()=>{};context.bounded=(x,y)=>Number.isFinite(x)&&Number.isFinite(y);context.locationOf=m=>[m.x,m.y];context.L={layerGroup(){const layer={items:[],addTo(){layers.push(layer);return layer;},addLayer(item){layer.items.push(item);},remove(){layer.removed=true;}};return layer;},circleMarker(where,options){return {where,options,bindTooltip(){return this;}};},polyline(where,options){return {where,options,getLatLngs(){return where;},setLatLngs(w){where=w;}};},marker(where,options){return {where,options,bindTooltip(){return this;},on(){return this;},setIcon(icon){this.options.icon=icon;},getLatLng(){return where;}};},latLngBounds:locations=>locations};context.structuredClone=structuredClone;context.categories={Personal:['P','#a04438'],Tradeskill:['T','#385f60'],Vendor:['V','#876036']};context.markerSymbol=()=>document.createElement('b');context.pinIcon=m=>({look:m});context.pixelsOf=where=>where;
 context.allMarkers=()=>[...context.originals,...context.personal];context.popup=m=>{const n=new Node('div');context.window.atlasCommunity?.popup(m,n);return n;};context.drawMarkers=()=>{for(const m of context.allMarkers())context.pins.set(m.id,{setPopupContent(){}});};
 context.persist=next=>{saved.set('notes',JSON.stringify(next));context.personal=next;context.window.dispatchEvent({type:'atlas:notes'});return true;};
 vm.createContext(context);vm.runInContext(wikiLinks,context,{filename:'wiki-links.js'});vm.runInContext(source,context,{filename:'community.js'});
 return {context,wikiRequests,elements,head,body,bottom,bar,calls,counts,statuses,remote,saved,suggestions,layers,banned,get creations(){return creations;},set failNotes(v){failNotes=v;},set failSuggestions(v){failSuggestions=v;},emit:type=>context.window.dispatchEvent({type}),async tick(ms){const jobs=[...timers].filter(([,t])=>t.ms===ms);for(const [id,t] of jobs){timers.delete(id);t.fn();}await settle();}};
}
for(const settings of [{},{supabaseUrl:'https://project.example'},{supabaseKey:'public-key'}]){const e=environment(settings);assert.equal(e.calls.length,0);assert.equal(e.creations,0);assert.equal(e.head.children.length,0);assert.equal(e.bottom.children.length,0);assert.equal(e.bar.children.length,1);}
for(const hostname of ['localhost','127.0.0.1']){const e=environment({goatcounter:'counter'},hostname);assert.equal(e.head.children.length,0);}
{
 const e=environment({goatcounter:'counter'}),script=e.head.children[0];assert.equal(script.src,'https://gc.zgo.at/count.js');assert.equal(script.dataset.goatcounter,'https://counter.goatcounter.com/count');assert.equal(e.context.window.goatcounter.no_onload,true);
 e.context.window.goatcounter.count=row=>e.counts.push(row);script.onload();assert.equal(e.counts.length,1);assert.equal(e.counts[0].path,'/test-map/lower');assert.equal(e.counts[0].title,'Test map');assert.equal(e.counts[0].referrer,'');e.emit('atlas:loaded');assert.equal(e.counts.length,1);
 e.context.config.levelId='upper';e.context.loadSerial++;e.emit('atlas:loaded');assert.equal(e.counts[1].path,'/test-map/upper');
 e.elements.get('search').value='private query';e.elements.get('search').fire('input');e.elements.get('search').fire('input');await e.tick(650);assert.equal(e.counts.filter(r=>r.path==='search').length,1);e.emit('atlas:note-added');e.emit('atlas:positions');assert(!JSON.stringify(e.counts).includes('private'));
}
{
 const e=environment({supabaseUrl:'https://project.example',supabaseKey:'public-key'});await settle();assert.equal(e.bar.children.length,2);assert.equal(e.bar.children[1].className,'account');assert.equal(e.bar.children[1].children[0].children[0].textContent,'Sign in');
 const popup=e.context.popup(e.context.originals[0]),report=popup.children[0].children[1];assert.equal(report.textContent,'Report a problem');assert.equal(popup.children[0].children[0].textContent,'Suggest an edit');await report.onclick();assert(e.body.children.find(n=>n.id==='community-dialog').open);assert.equal(e.calls.filter(r=>r.table==='suggestions').length,0);
 const d=e.body.children.find(n=>n.id==='community-dialog'),sign=d.querySelectorAll('button').find(n=>n.textContent==='Sign in with Discord');await sign.onclick();assert.equal(e.calls.find(r=>r.oauth).oauth.options.redirectTo,'https://atlas.example/?map=test-map');
}
{
 const session={access_token:'header.payload.signature',user:{id:'user-a',user_metadata:{full_name:'Atlas member'},admin:true}},e=environment({supabaseUrl:'https://project.example',supabaseKey:'public-key'},'atlas.example',session);await settle();
 assert.equal(e.context.personal.length,2);assert.equal(e.context.personal.find(m=>m.id==='personal-local').name,'Local wins');assert.equal(e.remote.find(m=>m.id==='personal-local').name,'Local wins');const menu=e.bar.children[1].children[1];assert(menu.hidden,'The account menu starts closed');e.bar.children[1].children[0].onclick();assert(!menu.hidden);assert.equal(menu.children[0].children[1].children[0].textContent,'Atlas member');assert(menu.querySelectorAll('button').some(n=>n.textContent==='Review suggestions'&&!n.hidden));
 const d=e.body.children.find(n=>n.id==='community-dialog');let p=e.context.popup(e.context.originals[0]);p.children[0].children[1].onclick();assert(d.open);const send=()=>d.querySelectorAll('button').find(n=>n.textContent==='Send report').onclick();
 await send();assert(d.open,'A reason is required');assert.equal(e.calls.filter(r=>r.table==='suggestions'&&r.op!=='select').length,0,'Only the waiting count was read');
 e.failSuggestions=true;d.querySelectorAll('input').find(n=>n.value==='name').checked=true;await send();assert(d.open,'A failed report keeps the dialog open');e.failSuggestions=false;
 await send();assert(!d.open);let sent=e.calls.filter(r=>r.table==='suggestions'&&r.op==='insert').at(-1).payload;assert.equal(sent.kind,'report');assert.equal(sent.target_id,'published');assert.equal(JSON.stringify(sent.payload),JSON.stringify({name:'Bank',reason:'name',x:10,y:20}),'Reports use the published position');assert.equal(e.context.popup(e.context.originals[0]).children[0].children[1].textContent,'Reported, thanks');
 // A name or description edit keeps what the visitor saw, so a stale edit cannot overwrite a newer text.
 e.context.popup(e.context.originals[0]).children[0].children[0].onclick();assert(d.open);const field=id=>[...d.querySelectorAll('input'),...d.querySelectorAll('textarea')].find(n=>n.id===id),sendEdit=()=>d.querySelectorAll('button').find(n=>['Send for review','Publish'].includes(n.textContent)).onclick();
 await sendEdit();assert(d.open,'An unchanged edit is not sent');field('edit-name').value='  Bank   of the Bay ';field('edit-note').value='Open late';field('edit-wiki').value='https://wiki.example/bank';await sendEdit();assert(d.open,'A link to an unknown site is refused');assert(e.statuses.at(-1).startsWith('A wiki link must be'));{const search=field('edit-name');assert.equal(search.placeholder,'Type a name to search the wiki, or any name','Signed in, the Name field searches the wiki');search.value='bank';search.fire('input');await e.tick(600);
  const request=e.wikiRequests.at(-1);assert.equal(request.url,'https://project.example/functions/v1/wiki-search?q=bank&type=npc&zone=Test%20map','Only NPCs from this map zone are asked for');assert.equal(request.options.headers.Authorization,'Bearer header.payload.signature');assert(!JSON.stringify(request).includes('mnmp_'),'The wiki key never reaches the browser');
  const asked=e.wikiRequests.length;search.value=' BANK ';search.fire('input');await e.tick(600);assert.equal(e.wikiRequests.length,asked,'A repeated search is answered from this browser');
  const pick=d.querySelectorAll('button').find(n=>n.className==='wiki-result');assert(pick,'Results are listed');assert.equal(d.querySelectorAll('button').filter(n=>n.className==='wiki-result').length,1,'Items are not listed');assert(d.querySelectorAll('p').some(n=>n.textContent==='Wiki NPCs in Test map'),'The list says which zone it covers');assert(d.querySelectorAll('a').some(a=>a.textContent==='Data from the Monsters and Memories Wiki'&&a.href==='https://monstersandmemories.wiki/'),'Wiki data is credited with a link to that wiki');pick.onclick();assert.equal(field('edit-wiki').value,'https://monstersandmemories.wiki/npcs/banker');assert.equal(field('edit-name').value,'Banker','A pick takes the wiki’s name');field('edit-name').value='  Bank   of the Bay ';
  const {wikiIdFor,wikiIdOf}=e.context,input=field('edit-wiki');assert.equal(wikiIdFor(input,'https://monstersandmemories.wiki/npcs/banker'),'npc-banker');assert.equal(wikiIdFor(input,'https://monstersandmemories.wiki/npcs/other'),'');assert.equal(wikiIdFor(input,''),'');
  assert.equal(wikiIdOf('npc:12'),'npc:12');assert.equal(wikiIdOf(''),'');for(const bad of ['<b>',' x','x'.repeat(161),7])assert.equal(wikiIdOf(bad),null);
  // In the note editor the Name field searches the wiki: a pick fills the name and link and the empty type and note;
  // typing on without picking keeps what was typed.
  const $=e.context.$,name=$('name'),finder=name.parentElement.children.find(n=>n.className==='wiki-finder'),pickFirst=()=>finder.querySelectorAll('button').find(n=>n.className.split(' ').includes('wiki-result')).onclick();
  const key=k=>{let stopped=false,prevented=false;for(const fn of name.listeners.keydown||[])fn({key:k,preventDefault(){prevented=true;},stopPropagation(){stopped=true;}});return {stopped,prevented};};
  let changed=0;$('category').addEventListener('change',()=>changed++);$('category').value='Personal';name.value='banker';name.fire('input');await e.tick(600);
  assert.equal(name.value,'banker','Suggestions do not change what was typed');pickFirst();
  assert.equal(name.value,'Banker');assert.equal($('category').value,'Personal','An NPC without a role keeps the category');assert.equal(wikiIdFor($('wiki'),'https://monstersandmemories.wiki/npcs/banker'),'npc-banker');
  e.context.fetch=async()=>({ok:true,status:200,json:async()=>({results:[{id:'npc-ring-seller',type:'npc',name:'Ring seller',zone:'Test map',url:'https://monstersandmemories.wiki/npcs/ring-seller'},{id:'npc-ring-maker',type:'npc',name:'Ring maker',zone:'Test map',url:'https://monstersandmemories.wiki/npcs/ring-maker'}]})});
  // Keyboard: down and down again picks the second suggestion with Enter; Escape closes the list without closing the form.
  name.value='ring';name.fire('input');await e.tick(600);key('ArrowDown');key('ArrowDown');assert(key('Enter').prevented);
  assert.equal(name.value,'Ring maker');assert.equal($('wiki').value,'https://monstersandmemories.wiki/npcs/ring-maker');
  name.value='ring s';name.fire('input');await e.tick(600);assert(key('Escape').stopped,'Escape stays in the list');assert(!finder.querySelectorAll('button').some(n=>n.className.split(' ').includes('wiki-result')));
  assert.equal(name.value,'ring s','A name the wiki does not have stays as typed');assert.equal(changed,0);
  // The wiki's role, level and short location line fill a new note's empty fields, and the wiki is credited.
  e.context.fetch=async()=>({ok:true,status:200,json:async()=>({results:[{id:'npc-a-fishmonger',type:'npc',name:'A fishmonger',zone:'Test map',url:'https://monstersandmemories.wiki/npcs/a-fishmonger',role:'merchant',level:'8-10',location:'Under the east dock'}]})});
  $('note').value='';name.value='fishmonger';name.fire('input');await e.tick(600);pickFirst();
  assert.equal(name.value,'A fishmonger (levels 8–10)');assert.equal($('category').value,'Vendor');assert.equal(changed,1);assert.equal($('note').value,'Under the east dock');
  assert(finder.querySelectorAll('a').some(a=>a.textContent==='Filled from the wiki · Data from the Monsters and Memories Wiki'),'The filled data is credited');
  $('category').value='Personal';$('note').value='My own words';name.value='fish monger';name.fire('input');await e.tick(600);pickFirst();
  assert.equal($('note').value,'My own words','A typed note is kept');
  // A trainer is a merchant on the wiki; its name makes it a Class trainer that keeps its class.
  e.context.fetch=async()=>({ok:true,status:200,json:async()=>({results:[{id:'npc-a-beastmaster-instructor',type:'npc',name:'A beastmaster instructor',zone:'Test map',url:'https://monstersandmemories.wiki/npcs/a-beastmaster-instructor',role:'merchant',level:40,location:''}]})});
  $('category').value='Personal';name.value='beastmaster';name.fire('input');await e.tick(600);pickFirst();
  assert.equal($('category').value,'Class trainer');assert.equal(name.value,'A beastmaster instructor (level 40)');assert.equal($('wiki').dataset.wikiClasses,'["Beastmaster"]');
  // On the world map the search covers every zone.
  let worldUrl='';e.context.fetch=async url=>{worldUrl=url;return {ok:true,status:200,json:async()=>({results:[]})};};
  e.context.config.zonesFile='data/world/zones.json';e.emit('atlas:loaded');await settle();name.value='smith';name.fire('input');await e.tick(600);
  assert.equal(worldUrl,'https://project.example/functions/v1/wiki-search?q=smith&type=npc');assert(finder.querySelectorAll('p').some(n=>n.textContent==='No wiki NPC with that name.'));delete e.context.config.zonesFile;
  // While the wiki is asked a spinner runs and the list is busy; a newer search cancels the older request,
  // the same words again do not search twice, and an answer kept in this browser shows without the spinner.
  const spinner=finder.children.find(n=>n.className==='wiki-searching'),results=finder.children.find(n=>n.className==='wiki-results'),pending=[];
  e.context.fetch=(url,options)=>new Promise((resolve,reject)=>{pending.push({url,options,done:()=>resolve({ok:true,status:200,json:async()=>({results:[]})})});options.signal.addEventListener('abort',()=>reject(Error('aborted')));});
  assert(spinner.hidden);name.value='guard';name.fire('input');await e.tick(600);assert.equal(pending.length,1);assert(!spinner.hidden,'The spinner runs during the request');assert.equal(results['aria-busy'],'true');
  name.value='guards';name.fire('input');assert(pending[0].options.signal.aborted,'A newer search cancels the request before it');assert(spinner.hidden);await e.tick(600);assert.equal(pending.length,2);
  name.value=' Guards ';name.fire('input');await e.tick(600);assert.equal(pending.length,2,'The same words do not search twice');
  pending[1].done();await settle();assert(spinner.hidden,'The spinner stops with the answer');assert.equal(results['aria-busy'],'false');
  name.value='banker';name.fire('input');await e.tick(600);assert.equal(pending.length,2,'A kept answer needs no request');assert(spinner.hidden,'A kept answer shows without the spinner');}
 await sendEdit();assert(!d.open);sent=e.calls.filter(r=>r.table==='suggestions'&&r.op==='insert').at(-1).payload;assert.equal(sent.kind,'edit-marker');assert.equal(sent.credit,false,'Credit is opt-in');assert.equal(sent.status,undefined,'Suggestions are always inserted as pending');
 const approval=e.calls.filter(r=>r.table==='suggestions'&&r.op==='update').at(-1);assert.equal(approval.payload.status,'approved','An admin\'s own edit is approved right after it is saved');assert.equal(approval.filters.status,'pending');assert.equal(sent.target_id,'published');assert.equal(JSON.stringify(sent.payload),JSON.stringify({name:'Bank of the Bay',note:'Open late',wiki:'https://monstersandmemories.wiki/npcs/banker',wikiId:'npc-banker',from:{name:'Bank',note:'',wiki:''}}));assert.equal(e.context.popup(e.context.originals[0]).children[0].children[0].textContent,'Edit sent for review');
 e.emit('atlas:positions');assert(d.open);await d.querySelectorAll('button').find(n=>['Send for review','Publish'].includes(n.textContent)).onclick();assert(!d.open);assert.equal(e.calls.filter(r=>r.table==='suggestions'&&r.op==='insert'&&r.payload.kind==='move-marker').length,1);e.emit('atlas:positions');assert(!d.open);
 // A note kept on the world map cannot be shared as a new marker there.
 e.context.config.zonesFile='data/world/zones.json';assert(!e.context.popup(e.context.personal[0]).children.some(n=>n.textContent==='Share with everyone'));delete e.context.config.zonesFile;
 p=e.context.popup(e.context.personal[0]);await p.children.find(n=>n.textContent==='Share with everyone').onclick();await d.querySelectorAll('button').find(n=>['Send for review','Publish'].includes(n.textContent)).onclick();assert.equal(e.calls.filter(r=>r.table==='suggestions'&&r.op==='insert').at(-1).payload.kind,'new-marker');assert.equal(e.context.popup(e.context.personal[0]).children[0].textContent,'Shared for review');
 e.context.personal[0].note='Updated locally';e.emit('atlas:notes');await e.tick(2000);assert.equal(e.remote.find(m=>m.id===e.context.personal[0].id).note,'Updated locally');
 e.failNotes=true;e.context.personal[0].note='Offline local note';e.emit('atlas:notes');await e.tick(2000);assert.equal(e.context.personal[0].note,'Offline local note');assert(e.statuses.some(m=>m.includes('local notes are safe')));e.failNotes=false;e.emit('online');await settle();assert.equal(e.remote.find(m=>m.id===e.context.personal[0].id).note,'Offline local note');
 // A note deleted here while its push failed stays deleted at the next sync; a note added elsewhere still arrives.
 const gone=e.context.personal.find(m=>m.id==='personal-remote');assert(gone);e.failNotes=true;e.context.persist(e.context.personal.filter(m=>m!==gone));await e.tick(2000);e.failNotes=false;
 e.remote.push({id:'personal-elsewhere',name:'Elsewhere',category:'Personal',note:'',x:3,y:4});e.emit('atlas:loaded');await settle();await e.tick(2000);
 assert(!e.context.personal.some(m=>m.id==='personal-remote'),'A deleted note does not come back');assert(e.context.personal.some(m=>m.id==='personal-elsewhere'),'A note from another device arrives');assert(!e.remote.some(m=>m.id==='personal-remote'));
 e.suggestions.push({id:9,status:'pending',map:'test-map',level:'lower',kind:'move-marker',payload:{name:'Bank',from:[10,20],to:[30,40]},author_name:'Member',created_at:new Date().toISOString()});
 const reviewButton=menu.querySelectorAll('button').find(n=>n.textContent==='Review suggestions');reviewButton.onclick();await settle();const review=e.body.children.find(n=>n.id==='community-review');assert(review.open);await review.querySelectorAll('button').find(n=>['Show on map','Review on map'].includes(n.textContent)).onclick();await settle();assert(!review.open);assert.equal(e.layers.at(-1).items.length,3);assert(!e.layers.at(-1).removed,'Closing the dialog must keep the new preview');
 const preview=e.context.$('community-preview');assert(preview);await preview.querySelectorAll('button').find(n=>n.textContent==='Approve').onclick();assert.equal(e.suggestions[0].status,'approved');assert(e.suggestions[0].reviewed_at);assert(e.layers.at(-1).removed);
 e.suggestions.push({id:10,status:'pending',map:'test-map',level:'lower',kind:'report',target_id:'published',payload:{name:'Bank',reason:'position',x:10,y:20},comment:'Across the bridge',author_name:'Member',created_at:new Date().toISOString()});
 reviewButton.onclick();await settle();assert(review.querySelectorAll('p').some(n=>n.textContent==='Wrong position'));assert(!review.querySelectorAll('button').some(n=>n.textContent==='Approve'));await review.querySelectorAll('button').find(n=>n.textContent==='Fixed').onclick();assert.equal(e.suggestions[1].status,'resolved');
 // A suggested marker can be renamed and given another type on the map before approval.
 e.suggestions.push({id:11,status:'pending',map:'test-map',level:'lower',kind:'new-marker',payload:{name:'Chef',x:5,y:6,category:'Tradeskill',trade:'Cooking'},author_name:'Member',created_at:new Date().toISOString()});
 reviewButton.onclick();await settle();await review.querySelectorAll('button').filter(n=>n.textContent==='Review on map').at(-1).onclick();await settle();
 {const bar=e.context.$('community-preview');bar.querySelectorAll('input')[0].value='Chef Arzya';bar.querySelectorAll('select')[0].value='Vendor';await bar.querySelectorAll('button').find(n=>n.textContent==='Approve').onclick();
 const approved=e.suggestions.find(r=>r.id===11);assert.equal(approved.status,'approved');assert.equal(approved.payload.name,'Chef Arzya');assert.equal(approved.payload.category,'Vendor');assert.equal(approved.payload.trade,undefined);}
 // On the map, picking the NPC from the wiki fixes the suggestion's name and sets its link and id before approval.
 e.context.fetch=async()=>({ok:true,status:200,json:async()=>({results:[{id:'npc-chef-arzya',type:'npc',name:'Chef Arzya the Bold',zone:'Test map',url:'https://monstersandmemories.wiki/npcs/chef-arzya'}]})});
 e.suggestions.push({id:14,status:'pending',map:'test-map',level:'lower',kind:'new-marker',payload:{name:'chef arzya',x:5,y:6,category:'Vendor'},author_name:'Member',created_at:new Date().toISOString()});
 reviewButton.onclick();await settle();await review.querySelectorAll('button').filter(n=>n.textContent==='Review on map').at(-1).onclick();await settle();
 {const bar=e.context.$('community-preview'),find=bar.querySelectorAll('input')[0];assert.equal(find.placeholder,'Type a name to search the wiki, or any name','The review bar’s Name field searches the wiki');find.value='arzya';find.fire('input');await e.tick(600);
 bar.querySelectorAll('button').find(n=>n.className==='wiki-result').onclick();assert.equal(bar.querySelectorAll('input')[0].value,'Chef Arzya the Bold');
 await bar.querySelectorAll('button').find(n=>n.textContent==='Approve').onclick();const approved=e.suggestions.find(r=>r.id===14);
 assert.equal(approved.payload.name,'Chef Arzya the Bold');assert.equal(approved.payload.wiki,'https://monstersandmemories.wiki/npcs/chef-arzya');assert.equal(approved.payload.wikiId,'npc-chef-arzya');}
 // Saving a note with "Also suggest this for the public map" ticked sends it at once; the note then follows its
 // suggestion: a move while it is pending updates it, and an edit once approved becomes an edit of the new marker.
 {const ctx=e.context,$=ctx.$,check=$('suggest-check'),credit=$('suggest-credit'),inserts=()=>e.calls.filter(c=>c.table==='suggestions'&&c.op==='insert');
  assert(!$('suggest-on-save').hidden,'The note form offers to suggest the note');check.checked=true;check.fire('change');assert(!credit.parentElement.hidden,'The credit choice shows with it');credit.checked=false;
  const note={id:'personal-follow',name:'Lamp post',category:'Personal',note:'',x:10,y:12},before=inserts().length;
  ctx.window.dispatchEvent({type:'atlas:note-saved',detail:{note}});await settle();
  assert.equal(inserts().length,before+1);const sent=inserts().at(-1).payload;assert.equal(sent.kind,'new-marker');assert.equal(sent.payload.name,'Lamp post');assert.equal(sent.credit,false);
  const id=Object.values(JSON.parse(ctx.localStorage.getItem('mnmaps-suggested-notes'))).at(-1).id;e.suggestions.push({id,status:'pending',user_id:'user-1',kind:'new-marker',map:'test-map',payload:sent.payload});
  ctx.window.dispatchEvent({type:'atlas:note-saved',detail:{note:{...note,x:20},moved:true}});await settle();
  const moved=e.calls.filter(c=>c.table==='suggestions'&&c.op==='update').at(-1);assert.equal(moved.filters.id,id);assert.equal(moved.payload.payload.x,20,'A pending suggestion moves with its note');assert.equal(inserts().length,before+1,'and nothing new is sent');
  e.suggestions.find(r=>r.id===id).status='approved';
  ctx.window.dispatchEvent({type:'atlas:note-saved',detail:{note:{...note,x:20,name:'Old lamp post'}}});await settle();
  const edit=inserts().at(-1).payload;assert.equal(edit.kind,'edit-marker');assert.equal(edit.target_id,'community-'+id);assert.equal(edit.payload.from.name,'Lamp post');assert.equal(edit.payload.name,'Old lamp post');
  ctx.window.dispatchEvent({type:'atlas:note-saved',detail:{note:{...note,x:30,y:12,name:'Old lamp post'},moved:true}});await settle();
  const move=inserts().at(-1).payload;assert.equal(move.kind,'move-marker');assert.equal(JSON.stringify(move.payload.from),'[20,12]');assert.equal(JSON.stringify(move.payload.to),'[30,12]');
  e.suggestions.splice(e.suggestions.findIndex(r=>r.id===id),1);check.checked=false;check.fire('change');}
 // A note placed from a bounty is claimed as it is saved, whatever the suggest box says; the bounty is then marked
 // claimed on this device. A claim that fails keeps the note private and offers to try again.
 {const ctx=e.context,inserts=()=>e.calls.filter(c=>c.table==='suggestions'&&c.op==='insert');
  ctx.localStorage.setItem('mnmaps-bounty-notes',JSON.stringify({'personal-bounty':{bounty:'npc-wanted',priority:true,map:'test-map'},'personal-bounty-2':{bounty:'npc-other',priority:false,map:'test-map'}}));
  const note={id:'personal-bounty',name:'Wanted man',category:'Vendor',note:'',x:5,y:6,wiki:'https://monstersandmemories.wiki/npcs/wanted-man',wikiId:'npc-wanted'},before=inserts().length;
  ctx.window.dispatchEvent({type:'atlas:note-saved',detail:{note}});await settle();
  assert.equal(inserts().length,before+1,'Saving a bounty note claims it with the suggest box unticked');const claim=inserts().at(-1).payload;
  assert.equal(claim.payload.bounty,'npc-wanted');assert.equal(claim.payload.priority,true);
  assert(JSON.parse(ctx.localStorage.getItem('mnmaps-claimed-bounties'))['test-map']['npc-wanted'],'The bounty is claimed on this device at once');
  e.failSuggestions=true;const other={...note,id:'personal-bounty-2',name:'Other man',wikiId:'npc-other',wiki:'https://monstersandmemories.wiki/npcs/other-man'};
  ctx.window.dispatchEvent({type:'atlas:note-saved',detail:{note:other}});await settle();e.failSuggestions=false;
  const failed=e.body.children.find(n=>n.id==='community-dialog');assert(failed.open&&failed.querySelectorAll('button').some(n=>n.textContent==='Try again'),'A failed claim offers to try again');
  assert(!JSON.parse(ctx.localStorage.getItem('mnmaps-claimed-bounties'))['test-map']['npc-other'],'Nothing is marked claimed until the claim is accepted');
  await failed.querySelectorAll('button').find(n=>n.textContent==='Try again').onclick();await settle();
  assert.equal(inserts().at(-1).payload.payload.bounty,'npc-other');assert(JSON.parse(ctx.localStorage.getItem('mnmaps-claimed-bounties'))['test-map']['npc-other']);}
 // Banning an author dismisses everything they have waiting and lists them for a later unban.
 for(const id of [11,12])e.suggestions.push({id,user_id:'spammer',status:'pending',map:'test-map',level:'lower',kind:'report',target_id:'published',payload:{name:'Spam '+id,reason:'other',x:1,y:1},author_name:'Spammer',created_at:new Date().toISOString()});
 reviewButton.onclick();await settle();assert(review.querySelectorAll('p').some(n=>n.textContent==='By Spammer (2 waiting)'));review.querySelectorAll('button').find(n=>n.textContent==='Ban author').onclick();
 const ban=e.body.children.find(n=>n.id==='community-dialog');assert(ban.open);await ban.querySelectorAll('button').find(n=>n.textContent==='Ban and dismiss').onclick();await settle();
 assert.equal(e.banned.length,1);assert.equal(e.banned[0].user_id,'spammer');assert(e.suggestions.filter(r=>r.user_id==='spammer').every(r=>r.status==='rejected'&&r.review_note==='Author banned'));
 const lift=review.querySelectorAll('button').find(n=>n.textContent==='Lift ban');assert(lift);await lift.onclick();await settle();assert.equal(e.banned.length,0);
 // Deleting the account calls the server once, signs out locally and drops pending note syncs.
 e.context.personal[0].note='Not synced';e.emit('atlas:notes');const del=menu.querySelectorAll('button').find(n=>n.textContent==='Delete my account…');del.onclick();const confirm=e.body.children.find(n=>n.id==='community-dialog');assert(confirm.open);
 await confirm.querySelectorAll('button').find(n=>n.textContent==='Delete my account'&&n.className==='danger').onclick();await settle();assert.equal(e.calls.filter(r=>r.rpc==='delete_my_account').length,1);assert.equal(e.calls.find(r=>r.signOut).signOut.scope,'local');
 assert(!menu.querySelectorAll('button').some(n=>n.textContent==='Delete my account…'));assert(menu.hidden,'The menu closes for the confirm dialog');const writes=e.calls.filter(r=>r.table==='user_notes'&&r.op==='upsert').length;await e.tick(2000);assert.equal(e.calls.filter(r=>r.table==='user_notes'&&r.op==='upsert').length,writes,'No sync after deletion');
}
console.log('Client checks passed: top-bar account menu, banning, account deletion, disabled/partial config, localhost exclusion, private counters, sign-in redirect, problem reports, suggestions, shared notes, merge, offline sync and admin preview/approval.');
