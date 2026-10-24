// Itinerary: pick a start and a finish and the atlas draws the way between them, across floors and from one map to the
// next through their exits. Safer keeps away from named mobs, camps, ambushes and traps where it can; Shorter takes
// the most direct way. Maps opt in with "routes" in the registry.
(()=>{
 const LEVEL_KEY='mnmaps-route-level',MODE_KEY='mnmaps-route-mode';
 // How far each kind of danger reaches (game units) and how strongly Safer avoids it.
 const DANGER={'Named mob':[20,6],'Mob camp':[25,6],'Ambush':[30,10],'Trap':[6,40]};
 const read=k=>{try{return localStorage.getItem(k);}catch{return null;}},write=(k,v)=>{try{localStorage.setItem(k,v);}catch{}};
 let worker=null,serial=0,panel=null,layers=[],busy=false,run=0;
 const pending=new Map(),loaded=new Set(),data=new Map();
 // Both ways are worked out every time (like a map app's route options); mode picks the one drawn and listed.
 const state={from:null,to:null,mode:read(MODE_KEY)==='shorter'?'shorter':'safer',options:{},legs:null,error:''};
 const MODES=[['safer','Safer'],['shorter','Shorter']];
 const entry=id=>registry?.maps.find(c=>c.id===id);
 const routable=id=>!!entry(id)?.routes;
 const mapTitle=id=>entry(id)?.title||id;
 const levelTitle=(id,mapId=config.id)=>entry(mapId)?.levels?.find(l=>l.id===id)?.title||id||'';
 const floorOrder=(id,mapId=config.id)=>entry(mapId)?.levels?entry(mapId).levels.findIndex(l=>l.id===id):0;
 const ask=msg=>new Promise((resolve,reject)=>{const id=++serial;pending.set(id,{resolve,reject});worker.postMessage({...msg,id});});
 function startWorker(){
  if(worker)return;
  worker=new Worker('route-worker.js?v=route-10');
  worker.onmessage=e=>{const p=pending.get(e.data.id);if(!p)return;pending.delete(e.data.id);e.data.ok?p.resolve(e.data.result):p.reject(Error(e.data.error));};
 }
 // A map's ground, pins and place names, fetched once.
 async function mapData(id){
  if(data.has(id))return data.get(id);
  const c=entry(id),json=async(f,d)=>{if(!f)return d;const r=await fetch(f);return r.ok?r.json():d;};
  const [meta,markers,labels]=await Promise.all([json(c.routes,null),json(c.markersFile,[]),json(c.labelsFile,{labels:[]})]);
  const d={meta,markers:Array.isArray(markers)?markers:[],labels:labels.labels||[]};data.set(id,d);return d;
 }
 async function ensureGround(id){
  const d=await mapData(id);if(!d.meta)throw Error('Routes are not available on '+mapTitle(id)+' yet.');
  startWorker();if(!loaded.has(id)){await ask({type:'load',map:id,meta:d.meta,url:new URL(d.meta.file,document.baseURI).href});loaded.add(id);}
  return d;
 }
 const placeName=p=>p.kind==='spot'?'Spot on '+(entry(p.map)?.levels?levelTitle(p.level,p.map):mapTitle(p.map)):p.name;
 const exitName=(l,mapId)=>'Entrance from '+(mapTitle(l.toMap)||l.name.replace(/^to /,''));
 function places(){
  const exits=(labelData?.labels||[]).filter(l=>l.toMap&&l.kind==='exit').map(l=>({id:l.id,name:exitName(l),x:l.x,y:l.y,level:l.level,reach:260}));
  const pins=allMarkers().filter(m=>Number.isFinite(m.x)&&Number.isFinite(m.y)).map(m=>({id:m.id,name:markerTitle(m),x:m.x,y:m.y,level:m.level}));
  return {exits,pins};
 }
 function dangers(markers){
  const level=Number(read(LEVEL_KEY))||0;
  return markers.filter(m=>{
   if(!DANGER[m.category])return false;
   // A trap's landing pin is where you arrive, not a trap.
   if(m.category==='Trap'&&m.toMarker&&!m.toLevel)return false;
   const v=m.category==='Named mob'?namedLevels(m):campLevels(m);
   // Mobs well below the walker's level leave them alone.
   return !(level&&v&&v[1]!==null&&v[1]<=level-4);
  }).map(m=>({id:m.id,name:markerTitle(m),x:m.x,y:m.y,level:m.level,radius:DANGER[m.category][0],weight:DANGER[m.category][1]}));
 }
 // Paired level pins (stairs, ladders, drops, pit traps) also join floors; each pin is the way from its own side.
 function links(markers){
  const byId=new Map(markers.map(m=>[m.id,m]));
  const kindOf=m=>m.category==='Trap'?'trap':m.category==='Teleporter'?'teleport':m.category==='Lift'?'lift':/(^| )drop( |$)/i.test(m.name)?'drop':'stairs';
  const COST={trap:2,teleport:2,lift:6,drop:2,stairs:4};
  return markers.filter(m=>m.toMarker&&!m.toMap&&byId.has(m.toMarker)).map(m=>{const b=byId.get(m.toMarker),kind=kindOf(m);return {id:m.id,name:markerTitle(m),from:{x:m.x,y:m.y,level:m.level},to:{x:b.x,y:b.y,level:b.level},oneWay:true,kind,cost:COST[kind]};});
 }
 // Ways off a map: exit signs, boat docks (every stop of the boat's route), and lifts or teleporters that lead to
 // another map. Boats cost a wait; everything else is a step.
 function ways(d,id){
  const out=[],add=(p,to,place,how,cost=0)=>{if(to!==id&&routable(to))out.push({x:p.x,y:p.y,level:p.level,name:p.name,to,place,how,cost});};
  for(const l of d.labels){
   if(Array.isArray(l.route))for(const stop of l.route)add(l,stop.map,stop.place,'boat',300);
   else if(l.toMap)add(l,l.toMap,l.toPlace,'exit');
  }
  for(const m of d.markers)if(m.toMap)add(m,m.toMap,m.toPlace,m.category==='Teleporter'?'teleport':m.category==='Lift'?'lift':'exit');
  return out;
 }
 // The maps between two maps, through exits that lead both ways: fewest maps first.
 async function mapPath(a,b){
  const prev=new Map([[a,null]]),queue=[a];
  while(queue.length){
   const id=queue.shift();if(id===b)break;
   for(const w of ways(await mapData(id),id)){
    // A map can close its door to one neighbour (the Ancient Crypt passage only leads out of the tomb).
    if(prev.has(w.to)||(await mapData(w.to)).meta?.closedEntries?.includes(id))continue;prev.set(w.to,{from:id,exit:w});queue.push(w.to);}
  }
  if(!prev.has(b))return null;
  const hops=[];for(let id=b;prev.get(id);id=prev.get(id).from)hops.unshift({...prev.get(id),to:id});
  return hops;
 }
 // Where a way lands on the next map: the sign or pin it names, or the sign there that leads back.
 async function arrival(hop){
  const d=await mapData(hop.to),place=hop.exit.place;
  const l=d.labels.find(x=>x.id===place),m=!l&&d.markers.find(x=>x.id===place),back=!l&&!m&&d.labels.find(x=>x.toMap===hop.from);
  const p=l||m||back;if(!p)return null;
  return {map:hop.to,name:l||back?exitName(p):markerTitle(p),x:p.x,y:p.y,level:p.level,reach:260,kind:'exit',id:p.id};
 }
 async function leg(mapId,from,to,mode){
  const d=await ensureGround(mapId),list=dangers(d.markers);
  const result=await ask({type:'route',map:mapId,from,to,mode,dangers:list,links:links(d.markers)});
  return {map:mapId,from,to,result,dangerList:list,markers:d.markers};
 }
 async function plan(mode,from=state.from){
  if(from.map===state.to.map)return [await leg(from.map,from,state.to,mode)];
  const hops=await mapPath(from.map,state.to.map);
  if(!hops)throw Error('No known way from '+mapTitle(from.map)+' to '+mapTitle(state.to.map)+' on the maps that have routes so far.');
  const legs=[];let start=from;
  for(const hop of hops){
   const out={map:hop.from,name:hop.exit.name,x:hop.exit.x,y:hop.exit.y,level:hop.exit.level,reach:260,kind:'exit'},land=await arrival(hop);
   if(!land)throw Error('The way into '+mapTitle(hop.to)+' is not marked yet.');
   const l=await leg(hop.from,start,out,mode);l.next={map:hop.to,place:land.id,title:mapTitle(hop.to),how:hop.exit.how,wait:hop.exit.cost};legs.push(l);start=land;
  }
  legs.push(await leg(state.to.map,start,state.to,mode));
  return legs;
 }
 function pick(){const o=state.options[state.mode];state.legs=o?.legs||null;state.error=o?.error||'';}
 async function compute(){
  const mine=++run;
  if(!state.from||!state.to){state.options={};state.legs=null;state.error='';draw();showPanel();return;}
  busy=true;showPanel();
  const options={};
  const hops=await landings();
  for(const [mode] of MODES){
   try{const legs=await plan(mode),bad=legs.find(l=>l.result.error);options[mode]=bad?{error:(legs.length>1?mapTitle(bad.map)+': ':'')+bad.result.error}:{legs};}
   catch(e){options[mode]={error:e.message};}
   // A druid or wizard can cast to a landing first; that wins when the walk from the landing is shorter by more
   // than the cost of the cast.
   for(const t of hops){
    try{const legs=await plan(mode,t.place),cost=TELEPORT_COST+total(legs);if(legs.some(l=>l.result.error))continue;
     const best=options[mode];if(!best.legs||cost<total(best.legs)+(best.teleport?TELEPORT_COST:0))options[mode]={legs,teleport:t};}
    catch{}
   }
   if(mine!==run)return;
  }
  state.options=options;pick();busy=false;showPanel();draw(true);
  // On a phone the steps wait in the Search menu; the map says what was found.
  if(compact()&&state.legs)status('Route: about '+total(state.legs)+' m. Directions are in the Search menu.');
  else if(compact()&&state.error)status(state.error);
 }
 const total=legs=>legs.reduce((s,l)=>s+l.result.length,0);
 // Teleports the walker can cast (Druid, Wizard), remembered in this browser. A cast counts as this many metres.
 const TP_KEY='mnmaps-route-teleport',TELEPORT_COST=60,CASTERS=['Druid','Wizard'];
 const casts=()=>{try{const v=JSON.parse(read(TP_KEY)||'[]');return Array.isArray(v)?v.filter(c=>CASTERS.includes(c)):[];}catch{return [];}};
 // Landings are the Teleporter pins named after the spell's arrival point ("Druid Portal", "Wizard Portal Landing").
 async function landings(){
  const want=casts();if(!want.length)return [];
  const out=[];
  for(const c of registry.maps){
   if(!routable(c.id))continue;const d=await mapData(c.id);
   for(const m of d.markers){
    if(m.category!=='Teleporter')continue;const by=want.find(k=>new RegExp(k+' (portal|ring)','i').test(m.name));
    if(by)out.push({caster:by,place:{map:c.id,id:m.id,name:markerTitle(m),x:m.x,y:m.y,level:m.level}});
   }
  }
  return out;
 }
 function set(which,place){
  state[which]={...place,map:config.id};
  openView();
  // On a phone the map stays in view; the Search menu holds the steps.
  if(!compact())setPanel(true);compute();
 }
 // ---- the Directions view of the Search menu
 const ICON={start:'',arrive:'M12 21s-6-5.5-6-11a6 6 0 0 1 12 0c0 5.5-6 11-6 11z M12 10h.01',
  up:'M12 19V5 M5 12l7-7 7 7',down:'M12 5v14 M5 12l7 7 7-7',
  swim:'M2 10c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2 M2 16c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2',
  exit:'M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4 M10 17l5-5-5-5 M15 12H3',
  boat:'M2 20c2 1 4 1 6 0s4-1 6 0 4 1 6 0 M4 16l2-6h12l2 6 M12 10V3l5 4-5 1',
  lift:'M7 3h10v18H7z M10 9l2-2 2 2 M10 15l2 2 2-2',
  teleport:'M12 3v3 M12 18v3 M3 12h3 M18 12h3 M5.6 5.6l2.1 2.1 M16.3 16.3l2.1 2.1 M5.6 18.4l2.1-2.1 M16.3 7.7l2.1-2.1',
  danger:'M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z M12 9v4 M12 17h.01',
  directions:'M3 12 12 3l9 9-9 9z M9 14v-3h5 M12 8.5l2.5 2.5-2.5 2.5'};
 function icon(kind,cls='route-icon'){
  const box=text('span','',cls+' route-icon-'+kind),d=ICON[kind];if(!d)return box;
  const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg'),path=document.createElementNS(ns,'path');
  for(const [k,v] of Object.entries({viewBox:'0 0 24 24',width:'16',height:'16','aria-hidden':'true',fill:'none',stroke:'currentColor','stroke-width':'2','stroke-linecap':'round','stroke-linejoin':'round'}))svg.setAttribute(k,v);
  path.setAttribute('d',d);svg.append(path);box.append(svg);return box;
 }
 const metres=v=>v>=1000?(Math.round(v/100)/10)+' km':Math.max(1,Math.round(v))+' m';
 function openView(){
  if(!panel)build();if(!panel)return;
  $('journal').classList.add('directions-mode');panel.hidden=false;
  if(!compact())setPanel(true);
  // Nothing about routes is fetched until here: the ground file starts loading as Directions opens.
  if(routable(config.id))ensureGround(config.id).catch(()=>{});
 }
 function closeView(){$('journal')?.classList.remove('directions-mode');if(panel)panel.hidden=true;}
 function build(){
  const journal=$('journal'),box=$('search')?.closest('.search-box');if(!journal||!box)return;
  // The Directions button sits in the search field, the way map apps do it.
  if(!$('route-open')){const b=button('',()=>{openView();showPanel();},'route-open');b.id='route-open';b.title='Directions';b.setAttribute('aria-label','Directions');b.append(icon('directions','route-open-icon'));box.append(b);}
  panel=document.createElement('section');panel.className='directions-view';panel.id='route-panel';panel.hidden=true;panel.setAttribute('aria-label','Directions');
  const head=text('div','','directions-head');
  head.append(button('‹ Search',()=>closeView(),'directions-back'),text('h2','Directions','directions-title'));
  const row=(which,label)=>{const l=text('label','','route-field route-field-'+which);l.append(icon(which==='from'?'start':'arrive','route-end-icon'));const s=document.createElement('select');s.id='route-'+which;s.setAttribute('aria-label',label);s.onchange=()=>{const v=s.value;if(v==='keep')return;const p=findPlace(v);state[which]=p?{...p,map:config.id}:null;compute();};l.append(s);return l;};
  const swap=button('⇅',()=>{[state.from,state.to]=[state.to,state.from];compute();},'route-swap');swap.title='Swap start and finish';swap.setAttribute('aria-label','Swap start and finish');
  const fields=text('div','','route-fields');fields.append(row('from','Start'),row('to','Finish'),swap);
  const lvl=text('label','','route-level');lvl.append(text('span','Your level'));const input=document.createElement('input');input.type='number';input.min='1';input.max='99';input.inputMode='numeric';input.placeholder='Any';input.value=read(LEVEL_KEY)||'';input.onchange=()=>{write(LEVEL_KEY,input.value?String(Math.max(1,Math.min(99,Math.round(+input.value)))):'');input.value=read(LEVEL_KEY)||'';compute();};lvl.append(input);
  const hint=text('p','Pick a start and a finish here, right-click (long-press) the map, or use Directions on a card. The finish can be on another map; a druid or wizard teleport is used when it saves time.','route-hint');
  const tp=text('div','','route-teleport');tp.append(text('span','I can teleport as'));
  for(const c of CASTERS){const l=text('label','','route-cast'),b=document.createElement('input');b.type='checkbox';b.value=c;b.checked=casts().includes(c);b.onchange=()=>{write(TP_KEY,JSON.stringify([...tp.querySelectorAll('input:checked')].map(x=>x.value)));compute();};l.append(b,text('span',c));tp.append(l);}
  panel.append(head,fields,lvl,tp,hint,text('div','','route-options-list'),text('div','','route-result'));
  journal.querySelector('.journal-heading').after(panel);
 }
 function fill(select,which){
  const current=state[which];select.replaceChildren();
  const {exits,pins}=places(),az=(a,b)=>a.name.localeCompare(b.name);
  const first=text('option',which==='from'?'Choose a start':'Choose a finish');first.value='';select.append(first);
  const elsewhere=current&&current.map!==config.id;
  if(current&&(current.kind==='spot'||elsewhere)){const o=text('option',placeName(current)+(elsewhere?' ('+mapTitle(current.map)+')':''));o.value='keep';select.append(o);}
  const group=(label,list)=>{if(!list.length)return;const g=document.createElement('optgroup');g.label=label;for(const p of list.sort(az)){const o=text('option',p.name);o.value=p.id;g.append(o);}select.append(g);};
  group('Entrances',exits);
  for(const l of config.levels||[{id:undefined,title:'Places'}])group(l.title,pins.filter(p=>(p.level||undefined)===l.id||!config.levels));
  select.value=!current?'':current.kind==='spot'||elsewhere?'keep':current.id;
 }
 function findPlace(id){const {exits,pins}=places();return [...exits,...pins].find(p=>p.id===id)||null;}
 // The steps of one map's part: floor changes, swims, and the way on to the next map, each with the distance
 // walked since the step before.
 function legSteps(l,isFirst){
  const r=l.result,mapId=l.map,pts=r.points,events=[];
  const tp=isFirst&&state.options[state.mode]?.teleport;
  if(tp)events.push({i:0,kind:'teleport',title:'Teleport to '+tp.place.name,sub:tp.caster+' spell · '+mapTitle(mapId)});
  else if(isFirst)events.push({i:0,kind:'start',title:placeName(state.from),sub:mapTitle(mapId)});
  for(const c of r.changes){const p=pts[c.index-1],up=floorOrder(c.to,mapId)<floorOrder(c.from,mapId);const named=c.link?c.link.name:nearestTravelName(p,c,l.markers);
   events.push({i:c.index-1,kind:up?'up':'down',title:named?(/ to /i.test(named)?named:named+' → '+levelTitle(c.to,mapId)):(up?'Go up':'Go down')+' to '+levelTitle(c.to,mapId)});}
  for(let k=1;k<pts.length;k++){if(pts[k].swim&&!pts[k-1].swim){let j=k;while(j+1<pts.length&&pts[j+1].swim)j++;const len=pts[j].d-pts[k].d;if(len>=8)events.push({i:k,kind:'swim',title:'Swim about '+metres(len)});}}
  const end=pts.length-1;
  if(l.next)events.push({i:end,kind:l.next.how in ICON?l.next.how:'exit',title:({boat:'Take the boat to ',lift:'Take the lift to ',teleport:'Take the teleporter to '}[l.next.how]||'Take the exit to ')+l.next.title,sub:l.next.how==='boat'?'Check the times on the dock card':'',next:true});
  else events.push({i:end,kind:'arrive',title:placeName(state.to),sub:'Arrive'});
  events.sort((a,b)=>a.i-b.i);let last=0;
  for(const e of events){e.walk=(pts[e.i].d||0)-last;last=pts[e.i].d||0;e.at=pts[e.i];e.map=mapId;}
  return events;
 }
 function showPanel(){
  const btn=$('route-open');if(btn)btn.hidden=!routable(config.id);
  if(!panel)return;
  if(!routable(config.id)){closeView();return;}
  fill($('route-from'),'from');fill($('route-to'),'to');
  const opts=panel.querySelector('.route-options-list'),box=panel.querySelector('.route-result');opts.replaceChildren();box.replaceChildren();
  if(busy){box.append(text('p','Finding the way…','route-note'));return;}
  if(!state.from||!state.to)return;
  // Route options, one card each, like a map app's choice of routes.
  for(const [mode,label] of MODES){
   const o=state.options[mode];if(!o)continue;
   const card=button('',()=>{state.mode=mode;write(MODE_KEY,mode);pick();showPanel();draw();},'route-option'+(mode===state.mode?' selected':''));card.setAttribute('aria-pressed',String(mode===state.mode));
   if(o.error){card.append(text('span',label,'route-option-name'),text('span',o.error,'route-option-sub'));opts.append(card);continue;}
   const legs=o.legs,dangerCount=legs.reduce((s,l)=>s+(l.result.passed?.length||0),0),swim=legs.reduce((s,l)=>s+(l.result.swim||0),0);
   const top=text('span','','route-option-top');top.append(text('span',label,'route-option-name'),text('span',metres(total(legs)),'route-option-length'));
   const bits=[o.teleport?'teleports as '+o.teleport.caster:'',legs.length>1?legs.length+' maps':'',swim?'swims '+metres(swim):'',dangerCount?'passes '+dangerCount+(dangerCount>1?' mobs':' mob'):'clear of known mobs'].filter(Boolean);
   card.append(top,text('span',bits.join(' · '),'route-option-sub'+(dangerCount?' warn':'')));opts.append(card);
  }
  if(state.error&&!state.legs){box.append(text('p',state.error,'route-error'));return;}
  const legs=state.legs;if(!legs)return;
  const steps=text('ol','','route-steps');
  legs.forEach((l,i)=>{
   if(legs.length>1)steps.append(text('li',mapTitle(l.map),'route-step-map'));
   for(const e of legSteps(l,i===0)){
    const li=text('li','','route-step-row');
    if(e.walk>=5&&e.kind!=='start')li.append(text('span','Walk '+metres(e.walk),'route-step-walk'));
    const b=button('',e.next?()=>openNext(l):()=>show(e.at,e.map),'route-step');b.append(icon(e.kind),text('span',e.title,'route-step-title'));if(e.sub)b.append(text('span',e.sub,'route-step-sub'));
    li.append(b);steps.append(li);
   }
  });
  box.append(steps);
  const passed=legs.flatMap(l=>(l.result.passed||[]).map(p=>l.dangerList[p.index]?.name)).filter(Boolean);
  if(passed.length){const near=text('p','','route-danger');near.append(icon('danger'),text('span',(state.mode==='safer'?'Still passes close to ':'Passes close to ')+passed.join(', ')));box.append(near);}
  if(legs.some(l=>l.result.points.some(p=>p.under)))box.append(text('p','Dotted parts of the line pass beneath a hall or bridge drawn above them.','route-note'));
  const actions=text('div','','route-actions');
  actions.append(button('Copy route link',async()=>{const url=routeLink();if(await copyText(url))status('Route link copied.');else{const d=$('link-dialog'),h=d.querySelector('h2'),was=h.textContent;h.textContent='Share this route';d.addEventListener('close',()=>{h.textContent=was;},{once:true});$('link-value').value=url;d.showModal();$('link-value').select();}},'route-clear'),
   button('Clear',()=>{state.from=state.to=state.legs=null;state.options={};state.error='';draw();showPanel();},'route-clear'));
  box.append(actions);
 }
 // A floor change on open ground is named after the stairs pin beside it, when there is one.
 function nearestTravelName(at,c,markers){
  let best=null,bd=140;
  for(const m of markers){if(!m.toLevel||m.level!==c.from||m.toLevel!==c.to)continue;const d=Math.hypot(m.x-at.x,m.y-at.y);if(d<bd){bd=d;best=m;}}
  return best?markerTitle(best):'';
 }
 function show(at,mapId=config.id){
  if(!at)return;
  if(mapId!==config.id){const url=mapLink(mapId);if(at.level&&entry(mapId).levels)url.searchParams.set('level',at.level);url.searchParams.set('x',String(at.x));url.searchParams.set('y',String(at.y));url.searchParams.set('z',String(entry(mapId).defaultView.placeZoom-1));goToMap(mapId,url);return;}
  if(at.level&&at.level!==config.levelId){changeLevel(at.level,{x:at.x,y:at.y,id:'',quiet:true});return;}
  map.setView(locationOf(at),Math.max(map.getZoom(),config.defaultView.placeZoom-1));
 }
 function openNext(l){const url=mapLink(l.next.map);url.searchParams.set('place',l.next.place);goToMap(l.next.map,url,{quiet:true});}
 // ---- the line on the map
 function draw(fit=false){
  for(const l of layers)l.remove();layers=[];arrowRuns=[];drawArrows();
  const l=state.legs?.find(x=>x.map===config.id);if(!l||!map)return;
  const r=l.result,here=config.levelId,pts=r.points,ll=p=>locationOf(p),first=l===state.legs[0],last=l===state.legs[state.legs.length-1];
  // The other route option shows as a pale line where it goes its own way on this floor, tagged with its name and
  // length at the point it strays furthest; clicking it picks it.
  const near=(p,list)=>{let best=Infinity;for(let k=1;k<list.length;k++){const a=list[k-1],b=list[k],dx=b.x-a.x,dy=b.y-a.y,t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy||1)));best=Math.min(best,Math.hypot(a.x+dx*t-p.x,a.y+dy*t-p.y));}return best;};
  const mine=pts.filter(p=>!config.levels||p.level===here);
  for(const [mode,label] of MODES){
   if(mode===state.mode)continue;const o=state.options[mode],al=o?.legs?.find(x=>x.map===config.id);if(!al)continue;
   const theirs=al.result.points.filter(p=>!config.levels||p.level===here);if(theirs.length<2)continue;
   let far=null,fd=0;for(const p of theirs){const d=mine.length>1?near(p,mine):Infinity;if(d>fd){fd=d;far=p;}}
   if(fd<20)continue;
   let seg=[];const lines=[];
   for(const p of al.result.points){if(!config.levels||p.level===here)seg.push(ll(p));else{if(seg.length>1)lines.push(seg);seg=[];}}
   if(seg.length>1)lines.push(seg);
   for(const line of lines){const pl=L.polyline(line,{className:'route-alt'}).addTo(map);pl.on('click',()=>{state.mode=mode;write(MODE_KEY,mode);pick();showPanel();draw();});layers.push(pl);}
   const tag=L.tooltip({permanent:true,direction:'center',className:'route-tag alt',interactive:false}).setLatLng(ll(far)).setContent(text('span',label+' · '+metres(total(o.legs))));tag.addTo(map);layers.push(tag);
  }
  // Only this floor's runs are drawn (swims in a blue dash, passes beneath a hall dotted); the round arrows lead to
  // the other floors. Small arrows along the line show which way to go.
  const kind=(a,b)=>a.level!==here&&config.levels?'':a.under&&b.under?'under':a.swim&&b.swim?'swim':'ink';
  let run_=[pts[0]],current='';
  const flush=()=>{if(run_.length>1&&current){const line=run_.map(ll);
    if(current==='ink'||current==='swim')layers.push(L.polyline(line,{className:'route-halo',interactive:false}).addTo(map));
    layers.push(L.polyline(line,{className:'route-'+current,interactive:false}).addTo(map));arrowRuns.push(line);}
   run_=[run_[run_.length-1]];};
  for(let k=1;k<pts.length;k++){const a=pts[k-1],b=pts[k];
   if(a.level!==b.level){flush();run_=[b];current='';continue;}
   const t=kind(a,b);if(t!==current&&current)flush();current=t;run_.push(b);}
  flush();
  for(const c of r.changes){const a=pts[c.index-1],b=pts[c.index];
   if(a.level===here)layers.push(seal(a,c.to,floorOrder(c.to)<floorOrder(c.from)));
   if(b.level===here&&a.level!==here)layers.push(seal(b,c.from,floorOrder(c.from)<floorOrder(c.to),true));}
  const end=(p,label,cls)=>{if(config.levels&&p.level!==here)return;layers.push(L.marker(ll(p),{icon:L.divIcon({className:'route-end '+cls,html:'<span>'+label+'</span>',iconSize:[26,26],iconAnchor:[13,13]}),keyboard:false,interactive:false,zIndexOffset:900}).addTo(map));};
  if(first)end(pts[0],'A','route-start');
  if(last)end(pts[pts.length-1],'B','route-finish');
  // Where this map's part ends at an exit, a seal carries the route on to the next map.
  if(l.next){const p=pts[pts.length-1];if(!config.levels||p.level===here){const m=seal(p,null,false,false,'Continue in '+l.next.title,'→');m.off('click');m.on('click',()=>openNext(l));layers.push(m);}}
  // The chosen route's name and length ride on its line too.
  {const mid=pts.filter(p=>!config.levels||p.level===here);if(mid.length>1){const t=L.tooltip({permanent:true,direction:'center',className:'route-tag',interactive:false}).setLatLng(ll(mid[Math.floor(mid.length/2)])).setContent(text('span',MODES.find(m=>m[0]===state.mode)[1]+' · '+metres(total(state.legs))));t.addTo(map);layers.push(t);}}
  drawArrows();
  if(fit){const mine=pts.filter(p=>!config.levels||p.level===here);if(mine.length)map.fitBounds(L.latLngBounds(mine.map(ll)),{padding:[60,60],maxZoom:config.defaultView.placeZoom});}
 }
 // Direction arrows every ARROW_GAP screen pixels along the drawn runs, placed again after each zoom.
 const ARROW_GAP=120;let arrowRuns=[],arrows=[],arrowMap=null;
 function drawArrows(){
  for(const a of arrows)a.remove();arrows=[];
  if(!map)return;
  if(arrowMap!==map){arrowMap=map;map.on('zoomend',drawArrows);}
  for(const line of arrowRuns){
   const pts=line.map(x=>map.latLngToLayerPoint(x));let carry=ARROW_GAP/2;
   for(let k=1;k<pts.length;k++){
    const a=pts[k-1],b=pts[k],len=a.distanceTo(b),angle=Math.atan2(b.y-a.y,b.x-a.x)*180/Math.PI;
    for(let d=carry;d<len;d+=ARROW_GAP){
     const at=map.layerPointToLatLng(L.point(a.x+(b.x-a.x)*d/len,a.y+(b.y-a.y)*d/len));
     const m=L.marker(at,{icon:L.divIcon({className:'route-arrow',html:'',iconSize:[18,18],iconAnchor:[9,9]}),interactive:false,keyboard:false,zIndexOffset:800}).addTo(map);
     const tip=document.createElement('span');tip.style.transform='rotate('+angle.toFixed(1)+'deg)';m.getElement().append(tip);arrows.push(m);
    }
    carry=(carry-len)%ARROW_GAP;if(carry<0)carry+=ARROW_GAP;
   }
  }
 }
 function seal(p,toLevel,up,back=false,tip='',arrow=''){
  const icon=L.divIcon({className:'route-floor',html:'',iconSize:[30,30],iconAnchor:[15,15]});
  const m=L.marker(locationOf(p),{icon,keyboard:true,zIndexOffset:950,title:''}).addTo(map);
  const label=tip||(back?'Came from ':up?'Go up to ':'Go down to ')+levelTitle(toLevel);
  const el=m.getElement();el.append(text('span',arrow||(up?'↑':'↓'),'route-floor-arrow'));el.setAttribute('aria-label',label);
  m.bindTooltip(label,{direction:'top',offset:[0,-14]});
  if(toLevel)m.on('click',()=>changeLevel(toLevel,{x:p.x,y:p.y,id:'',quiet:true}));
  return m;
 }
 // ---- entry points
 window.atlasSpotActions=[...(window.atlasSpotActions||[]),
  {label:'Directions from here',shown:()=>routable(config.id),run:at=>set('from',{kind:'spot',id:'spot',x:at.x,y:at.y,level:at.level})},
  {label:'Directions to here',shown:()=>routable(config.id),run:at=>set('to',{kind:'spot',id:'spot',x:at.x,y:at.y,level:at.level})}];
 window.atlasPopupActions=[...(window.atlasPopupActions||[]),
  {label:'Directions',icon:'route',shown:m=>routable(config.id)&&!singleMap&&Number.isFinite(m.x),run:m=>{map.closePopup();set('to',{id:m.id,name:markerTitle(m),x:m.x,y:m.y,level:m.level});}}];
 // Share links: ?route=<start>~<finish>~<mode>, each end "map:x,y[:floor]" or "map:pin:<id>".
 const endCode=p=>p.map+':'+(p.kind==='spot'?Math.round(p.x)+','+Math.round(p.y)+(p.level?':'+p.level:''):'pin:'+p.id);
 function routeLink(){const url=mapLink(state.from?.map||config.id);url.searchParams.set('route',endCode(state.from)+'~'+endCode(state.to)+'~'+state.mode);return url.href;}
 async function endFrom(code){
  const [mapId,a,b,c]=code.split(':');if(!routable(mapId))return null;
  if(a==='pin'){const d=await mapData(mapId),l=d.labels.find(x=>x.id===b),m=d.markers.find(x=>x.id===b),p=l||m;
   return p?{map:mapId,id:b,name:l?(l.toMap?exitName(l):l.name):markerTitle(m),x:p.x,y:p.y,level:p.level,...(l?.toMap?{reach:260}:{})}:null;}
  const [x,y]=String(a).split(',').map(Number);return Number.isFinite(x)&&Number.isFinite(y)?{map:mapId,kind:'spot',id:'spot',x,y,level:b||undefined}:null;
 }
 let shared=new URL(location.href).searchParams.get('route');
 // The route is read once; the address then goes back to an ordinary map address.
 if(shared){const u=new URL(location.href);u.searchParams.delete('route');history.replaceState(history.state,'',u);}
 window.addEventListener('atlas:loaded',async()=>{
  if(!panel)build();showPanel();draw();
  if(shared){const [a,b,mode]=shared.split('~');shared=null;const from=a&&await endFrom(a),to=b&&await endFrom(b);
   if(from&&to){state.from=from;state.to=to;if(mode==='shorter'||mode==='safer')state.mode=mode;openView();compute();}}
  // Route data loads only once someone opens Directions on this map (see openView).
  if(routable(config.id)&&panel&&!panel.hidden)ensureGround(config.id).catch(()=>{});
 });
})();
