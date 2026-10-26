// Itinerary: pick a start and a finish and the atlas draws the way between them, across floors and from one map to the
// next through their exits. Safer keeps away from named mobs, camps, ambushes and traps where it can; Shorter takes
// the most direct way. Maps opt in with "routes" in the registry.
(()=>{
 const LEVEL_KEY='mnmaps-route-level',MODE_KEY='mnmaps-route-mode';
 // How far each kind of danger reaches (game units) and how strongly Safer avoids it.
 const DANGER={'Named mob':[20,6],'Mob camp':[25,6],'Ambush':[30,10],'Trap':[6,40]};
 const read=k=>{try{return localStorage.getItem(k);}catch{return null;}},write=(k,v)=>{try{localStorage.setItem(k,v);}catch{}};
 let worker=null,serial=0,panel=null,layers=[],busy=false,run=0;
 const pending=new Map(),loaded=new Map(),loading=new Set(),data=new Map();
 // Both ways are worked out every time (like a map app's route options); mode picks the one drawn and listed.
 const state={from:null,to:null,mode:read(MODE_KEY)==='shorter'?'shorter':'safer',options:{},legs:null,error:''};
 const MODES=[['safer','Safer'],['shorter','Shorter']];
 const entry=id=>registry?.maps.find(c=>c.id===id);
 // Directions is in beta: shown only to signed-in contributors (one approved suggestion or more) and admins.
 // Features in beta this visitor can use; the chronicle hides news about the others.
 let beta=false;window.atlasBeta=new Set();
 const routable=id=>beta&&!!entry(id)?.routes;
 const mapTitle=id=>entry(id)?.title||id;
 const levelTitle=(id,mapId=config.id)=>entry(mapId)?.levels?.find(l=>l.id===id)?.title||id||'';
 const floorOrder=(id,mapId=config.id)=>entry(mapId)?.levels?entry(mapId).levels.findIndex(l=>l.id===id):0;
 // A floor change goes up when the way climbs (the route finder reports the rise); floor order is the fallback.
 const isUp=(c,mapId=config.id)=>c.rise?c.rise>0:floorOrder(c.to,mapId)<floorOrder(c.from,mapId);
 const ask=msg=>new Promise((resolve,reject)=>{const id=++serial;pending.set(id,{resolve,reject});worker.postMessage({...msg,id});});
 function startWorker(){
  if(worker)return;
  worker=new Worker('route-worker.js?v=route-15');
  worker.onmessage=e=>{const p=pending.get(e.data.id);if(!p)return;pending.delete(e.data.id);e.data.ok?p.resolve(e.data.result):p.reject(Error(e.data.error));};
 }
 // A map's ground, pins and place names, fetched once.
 // (The promise is kept, so two callers at once share one fetch.)
 function mapData(id){
  if(!data.has(id)){
   const c=entry(id),json=async(f,d)=>{if(!f)return d;const r=await fetch(f);return r.ok?r.json():d;};
   data.set(id,Promise.all([json(c.routes,null),json(c.markersFile,[]),json(c.labelsFile,{labels:[]})]).then(([meta,markers,labels])=>({meta,markers:Array.isArray(markers)?markers:[],labels:labels.labels||[]})).catch(e=>{data.delete(id);throw e;}));
  }
  return data.get(id);
 }
 // The route finder keeps the ground of the few maps used last (a big map takes tens of megabytes); older ones are
 // dropped and loaded again if needed.
 const KEEP_GROUNDS=6;
 async function ensureGround(id){
  const d=await mapData(id);if(!d.meta)throw Error('Routes are not available on '+mapTitle(id)+' yet.');
  startWorker();
  if(!loaded.has(id)){
   // While a map's route data loads, the panel says so (the first load of a big map takes a few seconds).
   loading.add(id);if(busy)showPanel();
   loaded.set(id,ask({type:'load',map:id,meta:d.meta,url:new URL(d.meta.file,document.baseURI).href}).catch(e=>{loaded.delete(id);throw e;}).finally(()=>{loading.delete(id);if(busy)showPanel();}));
  }
  const p=loaded.get(id);loaded.delete(id);loaded.set(id,p);
  for(const old of loaded.keys()){if(loaded.size<=KEEP_GROUNDS)break;if(old===config.id)continue;loaded.delete(old);ask({type:'drop',map:old}).catch(()=>{});}
  await p;return d;
 }
 const placeName=p=>p.kind==='spot'?'Spot on '+(entry(p.map)?.levels?levelTitle(p.level,p.map):mapTitle(p.map)):p.name;
 const exitName=l=>'Entrance from '+(mapTitle(l.toMap)||l.name.replace(/^to /,''));
 // A camp drawn as an area (mobs flying over a lake) can be reached at its edge when its pin is off the ground.
 const edge=m=>m?.shape?.points?.length>2?{edge:m.shape.points}:{};
 function places(){
  const exits=(labelData?.labels||[]).filter(l=>l.toMap&&l.kind==='exit').map(l=>({id:l.id,name:exitName(l),x:l.x,y:l.y,level:l.level,reach:260}));
  const pins=allMarkers().filter(m=>Number.isFinite(m.x)&&Number.isFinite(m.y)).map(m=>({id:m.id,name:markerTitle(m),x:m.x,y:m.y,level:m.level,...edge(m)}));
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
  // A pin with no floor to go to is a landing (where a drop or trap arrives), not a way back up.
  return markers.filter(m=>m.toMarker&&m.toLevel&&!m.toMap&&byId.has(m.toMarker)).map(m=>{const b=byId.get(m.toMarker),kind=kindOf(m);return {id:m.id,name:markerTitle(m),from:{x:m.x,y:m.y,level:m.level},to:{x:b.x,y:b.y,level:b.level},oneWay:true,kind,cost:COST[kind]};});
 }
 // Ways off a map: exit signs, boat docks (every stop of the boat's route), and lifts or teleporters that lead to
 // another map. Boats cost a wait; everything else is a step.
 function ways(d,id){
  const out=[],add=(p,to,place,how,cost=0,pin=false)=>{if(to!==id&&routable(to))out.push({id:p.id,x:p.x,y:p.y,level:p.level,name:p.name,to,place,how,cost,pin});};
  for(const l of d.labels){
   if(Array.isArray(l.route))for(const stop of l.route)add(l,stop.map,stop.place,'boat',300);
   else if(l.toMap)add(l,l.toMap,l.toPlace,'exit');
  }
  for(const m of d.markers)if(m.toMap)add(m,m.toMap,m.toPlace,m.category==='Teleporter'?'teleport':m.category==='Lift'?'lift':'exit',0,true);
  return out;
 }
 // Map pixels per metre, from a map's route projection (for straight-line guesses).
 const perMetre=meta=>{const {x:[ax,,az],y:[cx,,cz]}=(meta.projects||[meta.project])[0];return (Math.hypot(ax,cx)+Math.hypot(az,cz))/2;};
 // A guess at the walk between two spots of one map: its sign-to-sign table when both are signs, else the straight line
 // made a little longer for corners.
 function walkGuess(meta,p,q){
  const known=p.id&&q.id&&meta?.between?.[p.id]?.[q.id];if(known!==undefined)return known??Infinity;
  return meta?Math.hypot(p.x-q.x,p.y-q.y)/perMetre(meta)*1.3:Infinity;
 }
 // The chain of maps between two places with the least walking (a boat counts as its wait), through exits that lead
 // both ways. Each map's sign-to-sign walks are worked out when its route data is built (meta.between).
 async function mapPath(from,to,leave=false,banned=new Set(),mode='shorter'){
  const best=new Map(),open=[{cost:0,map:from.map,at:from,key:from.map+'|',hops:[]}];
  while(open.length){
   open.sort((x,y)=>x.cost-y.cost);const s=open.shift();
   if(s.end)return s.hops;
   if(best.has(s.key))continue;best.set(s.key,s.cost);
   const d=await mapData(s.map);
   // With leave set, the way must go out to another map first (a part of this map reached only from next door).
   if(s.map===to.map&&(!leave||s.hops.length)&&!banned.has(s.key+'>END')){open.push({...s,end:true,cost:s.cost+walkGuess(d.meta,s.at,to)});continue;}
   for(const w of ways(d,s.map)){
    // A map can close its door to one neighbour (the Ancient Crypt passage only leads out of the tomb).
    if(banned.has(s.key+'>'+w.id)||(await mapData(w.to)).meta?.closedEntries?.includes(s.map))continue;
    const hop={from:s.map,to:w.to,exit:w},land=await arrival(hop);if(!land)continue;
    const key=w.to+'|'+land.id;if(best.has(key))continue;
    const risk=mode==='safer'&&w.to!==to.map&&w.to!==from.map?await zoneRisk(w.to):0;
    open.push({cost:s.cost+walkGuess(d.meta,s.at,w)+w.cost+risk,map:w.to,at:land,key,hops:[...s.hops,hop]});
   }
  }
  return null;
 }
 // Where a way lands on the next map: the sign or pin it names, or the sign there that leads back.
 async function arrival(hop){
  const d=await mapData(hop.to),place=hop.exit.place;
  const l=d.labels.find(x=>x.id===place),m=!l&&d.markers.find(x=>x.id===place),back=!l&&!m&&d.labels.find(x=>x.toMap===hop.from);
  const p=l||m||back;if(!p)return null;
  // A lift, stair or bridge pin is taken exactly where it stands (it may land on a ledge cut off from the map's entrances).
  return {map:hop.to,name:l||back?exitName(p):markerTitle(p),x:p.x,y:p.y,level:p.level,reach:m?90:260,exact:!!m,kind:'exit',id:p.id};
 }
 async function leg(mapId,from,to,mode){
  const d=await ensureGround(mapId),list=dangers(d.markers);
  const result=await ask({type:'route',map:mapId,from,to,mode,dangers:list,links:links(d.markers)});
  if(result.points)flatten(result);
  return {map:mapId,from,to,result,dangerList:list,markers:d.markers};
 }
 // Where a room drawn on another sheet lies at the same height right beside the way (a cave mouth by a canyon path),
 // the way can dip onto that floor and back within a few steps. Such a dip, short and level, stays on the floor it left.
 function flatten(r){
  const ch=r.changes,pts=r.points;
  for(let k=0;k+1<ch.length;k++){
   const a=ch[k],b=ch[k+1];
   if(a.link||b.link||a.to!==b.from||b.to!==a.from||Math.abs(a.rise||0)>1.5||Math.abs(b.rise||0)>1.5)continue;
   if((pts[b.index]?.d??0)-(pts[a.index-1]?.d??0)>25)continue;
   for(let i=a.index;i<b.index;i++)pts[i].level=a.from;
   ch.splice(k,2);k--;
  }
 }
 async function plan(mode,from=state.from){
  let one=null;
  if(from.map===state.to.map){
   one=await leg(from.map,from,state.to,mode);
   if(!one.result.error)return [one];
  }
  // A part of the map reached only through a neighbour (a mesa you reach from the tree city above) goes out and back.
  // When a walk on the chosen chain turns out impossible, that step is ruled out and the next best chain is tried.
  const banned=new Set();
  for(let tries=0;tries<8;tries++){
   const hops=await mapPath(from,state.to,!!one,banned,mode);
   if(!hops){if(one)return [one];throw Error('No known way from '+mapTitle(from.map)+' to '+mapTitle(state.to.map)+' on the maps that have routes so far.');}
   const legs=[];let start=from,key=from.map+'|',failed=false;
   for(const hop of hops){
    const out={map:hop.from,name:hop.exit.name,x:hop.exit.x,y:hop.exit.y,level:hop.exit.level,reach:hop.exit.pin?90:260,exact:hop.exit.pin,kind:'exit'},land=await arrival(hop);
    if(!land)throw Error('The way into '+mapTitle(hop.to)+' is not marked yet.');
    const l=await leg(hop.from,start,out,mode);
    if(l.result.error){banned.add(key+'>'+hop.exit.id);failed=true;break;}
    l.next={map:hop.to,place:land.id,title:mapTitle(hop.to),how:hop.exit.how,wait:hop.exit.cost};legs.push(l);start=land;key=hop.to+'|'+land.id;
   }
   if(failed)continue;
   const last=await leg(state.to.map,start,state.to,mode);
   if(last.result.error){banned.add(key+'>END');continue;}
   legs.push(last);return legs;
  }
  if(one)return [one];
  throw Error('No known way from '+mapTitle(from.map)+' to '+mapTitle(state.to.map)+' on the maps that have routes so far.');
 }
 function pick(){const o=state.options[state.mode];state.legs=o?.legs||null;state.error=o?.error||'';}
 async function compute(){
  const mine=++run;
  if(!state.from||!state.to){state.options={};state.legs=null;state.error='';busy=false;draw();showPanel();return;}
  busy=true;showPanel();
  const options={};
  try{
   const hops=await landings().catch(()=>[]);
   for(const [mode] of MODES){
    try{const legs=await plan(mode),bad=legs.find(l=>l.result.error);options[mode]=bad?{error:(legs.length>1?mapTitle(bad.map)+': ':'')+bad.result.error}:{legs};}
    catch(e){options[mode]={error:e.message};}
    // A druid or wizard can cast to a landing first; that wins when its route costs less than walking (swims, waits
    // and danger counted as the route finder counts them) by more than the cast.
    for(const t of hops){
     if(mine!==run)return;
     try{const legs=await plan(mode,t.place);if(legs.some(l=>l.result.error))continue;
      const best=options[mode];if(!best.legs||TELEPORT_COST+effort(legs)<effort(best.legs)+(best.teleport?TELEPORT_COST:0))options[mode]={legs,teleport:t};}
     catch{}
    }
    if(mine!==run)return;
   }
   state.options=options;pick();
  }finally{if(mine===run)busy=false;}
  showPanel();draw(true);
  // On a phone the steps wait in the Search menu; the map says what was found.
  if(compact()&&state.legs)status('Route: about '+metres(total(state.legs))+'. Directions are in the Search menu.');
  else if(compact()&&state.error)status(state.error);
 }
 const total=legs=>legs.reduce((s,l)=>s+l.result.length,0);
 // What a route costs to follow: the finder's own cost per part (swims and danger weighted) plus boat waits.
 const effort=legs=>legs.reduce((s,l)=>s+(l.result.cost??l.result.length)+(l.next?.wait||0),0);
 // Teleports the walker can cast (Druid, Wizard), remembered in this browser. A cast counts as this many metres.
 const TP_KEY='mnmaps-route-teleport',TELEPORT_COST=60,CASTERS=['Druid','Wizard'],INVIS_KEY='mnmaps-route-invisible';
 // Zones above the walker's level: Safer avoids crossing them (not the start or finish zone) unless they can go
 // invisible; a city never counts. Each counts as up to this many extra metres, by how far it is above them.
 const ZONE_RISK=4000;let zoneLevels=null;
 async function zoneRisk(id){
  if(!zoneLevels)zoneLevels=await fetch('data/zone-levels.json').then(r=>r.ok?r.json():{zones:{}}).then(d=>d.zones||{}).catch(()=>({}));
  const level=Number(read(LEVEL_KEY))||0,z=zoneLevels[id];
  if(!level||!z||z.city||read(INVIS_KEY)==='1')return 0;
  const [lo,hi]=z.levels;return level>=hi?0:ZONE_RISK*Math.min(1,(hi-level)/Math.max(1,hi-lo));
 }
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
 // A start or finish box, like a map app's: type to search every map's places and zones; an empty box lists this
 // map's entrances and places, and the zones, each opening onto its own entrances and places.
 let findIndex=null;
 const findRows=()=>findIndex||(findIndex=fetch('data/find-index.json').then(r=>r.ok?r.json():[]).catch(()=>[]).then(rows=>Array.isArray(rows)?rows.filter(e=>e&&routable(e.m)&&typeof e.n==='string'):[]));
 const fold=v=>String(v??'').normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[’‘`]/g,"'").toLowerCase().trim();
 async function zonePlaces(id){
  const d=await mapData(id),levels=entry(id)?.levels;
  const exits=d.labels.filter(l=>l.toMap&&l.kind==='exit').map(l=>({map:id,id:l.id,name:'Entrance from '+(mapTitle(l.toMap)||l.name.replace(/^to /,'')),x:l.x,y:l.y,level:l.level,reach:260,sub:'Entrance'}));
  const pins=d.markers.filter(m=>Number.isFinite(m.x)&&Number.isFinite(m.y)&&m.name).map(m=>({map:id,id:m.id,name:markerTitle(m),x:m.x,y:m.y,level:m.level,...edge(m),sub:[m.category,levels&&m.level?levelTitle(m.level,id):''].filter(Boolean).join(' · ')}));
  return {exits,pins:pins.sort((a,b)=>a.name.localeCompare(b.name))};
 }
 function picker(which,label){
  const box=text('div','','route-pick'),input=document.createElement('input'),list=text('div','','route-suggest');
  input.type='search';input.id='route-'+which;input.autocomplete='off';input.spellcheck=false;input.placeholder=which==='from'?'Choose a start':'Choose a finish';
  input.setAttribute('aria-label',label);input.setAttribute('role','combobox');input.setAttribute('aria-expanded','false');list.hidden=true;list.setAttribute('role','listbox');
  box.append(input,list);let zone=null,serial=0,active=-1;
  const close=()=>{list.hidden=true;input.setAttribute('aria-expanded','false');zone=null;active=-1;};
  const choose=async place=>{close();input.blur();if(!place)return;const {sub,...p}=place;state[which]=p;state.options={};state.legs=null;fill(input,which);compute();};
  const head=t=>list.append(text('div',t,'route-suggest-head'));
  const item=(name,sub,run,cls='')=>{const b=button('',run,'route-suggest-item'+cls);b.setAttribute('role','option');b.tabIndex=-1;b.append(text('span',name,'route-suggest-name'));if(sub)b.append(text('span',sub,'route-suggest-sub'));b.onmousedown=e=>e.preventDefault();list.append(b);return b;};
  const zoneItem=id=>item(mapTitle(id)+' ›',id===config.id?'This map':'Zone',()=>{zone=id;show();},' zone');
  async function show(){
   const ticket=++serial,q=fold(input.value);list.replaceChildren();active=-1;
   if(zone){
    const z=zone;item('‹ All zones','',()=>{zone=null;input.focus();show();},' back');const {exits,pins}=await zonePlaces(z);if(ticket!==serial)return;
    head(mapTitle(z));for(const e of exits)item(e.name,e.sub,()=>choose(e));for(const m of pins)if(!q||fold(m.name).includes(q))item(m.name,m.sub,()=>choose(m));
   }else if(q.length<2){
    const zones=(registry?.maps||[]).filter(m=>m.routes&&!m.hidden).map(m=>m.id);
    if(routable(config.id)){head('On this map');zoneItem(config.id);}
    head('Zones');for(const id of zones.filter(id=>id!==config.id).sort((a,b)=>mapTitle(a).localeCompare(mapTitle(b))))zoneItem(id);
   }else{
    const zones=(registry?.maps||[]).filter(m=>m.routes&&(fold(m.title).includes(q)||q.includes(fold(m.title)))).map(m=>m.id);
    if(zones.length){head('Zones');for(const id of zones)zoneItem(id);}
    const rows=await findRows();if(ticket!==serial)return;
    // Every word typed must be in the place's name or its zone's ("bank night harbor").
    const words=q.split(/\s+/),hits=rows.filter(e=>{const t=fold(e.n+' '+mapTitle(e.m)+' '+(e.k||''));return words.every(w=>t.includes(w));}).sort((a,b)=>(b.m===config.id)-(a.m===config.id)||(fold(b.n).startsWith(q))-(fold(a.n).startsWith(q))||a.n.localeCompare(b.n)).slice(0,40);
    if(hits.length)head('Places');
    for(const e of hits)item(e.n,[e.k,mapTitle(e.m)+(e.l&&entry(e.m)?.levels?' · '+levelTitle(e.l,e.m):'')].filter(Boolean).join(' · '),async()=>{const p=await endFrom(e.m+':pin:'+e.p);choose(p);});
    if(!zones.length&&!hits.length)list.append(text('p','No place or zone by that name.','route-suggest-none'));
   }
   list.hidden=false;input.setAttribute('aria-expanded','true');
  }
  const move=d=>{const items=[...list.querySelectorAll('.route-suggest-item')];if(!items.length)return;active=(active+d+items.length)%items.length;items.forEach((b,i)=>b.classList.toggle('active',i===active));items[active].scrollIntoView({block:'nearest'});};
  input.onfocus=()=>{input.select();show();};input.oninput=()=>show();
  input.onkeydown=e=>{if(e.key==='ArrowDown'){e.preventDefault();if(list.hidden)show();else move(1);}else if(e.key==='ArrowUp'){e.preventDefault();move(-1);}
   else if(e.key==='Enter'){const items=[...list.querySelectorAll('.route-suggest-item')];const b=items[active>=0?active:0];if(b){e.preventDefault();b.click();}}
   else if(e.key==='Escape'){close();input.blur();}};
  input.onblur=()=>setTimeout(()=>{if(document.activeElement!==input){close();fill(input,which);}},150);
  return box;
 }
 function build(){
  const journal=$('journal'),box=$('search')?.closest('.search-box');if(!journal||!box)return;
  // The Directions button sits in the search field, the way map apps do it.
  if(!$('route-open')){const b=button('',()=>{openView();showPanel();},'route-open');b.id='route-open';b.title='Directions';b.setAttribute('aria-label','Directions');b.append(icon('directions','route-open-icon'),text('span','Directions','route-open-label'));box.append(b);}
  panel=document.createElement('section');panel.className='directions-view';panel.id='route-panel';panel.hidden=true;panel.setAttribute('aria-label','Directions');
  const head=text('div','','directions-head');
  head.append(button('‹ Search',()=>closeView(),'directions-back'),text('h2','Directions','directions-title'),text('span','Beta','directions-beta'));
  const row=(which,label)=>{const l=text('div','','route-field route-field-'+which);l.append(icon(which==='from'?'start':'arrive','route-end-icon'),picker(which,label));return l;};
  const swap=button('⇅',()=>{[state.from,state.to]=[state.to,state.from];compute();},'route-swap');swap.title='Swap start and finish';swap.setAttribute('aria-label','Swap start and finish');
  const fields=text('div','','route-fields');fields.append(row('from','Start'),row('to','Finish'),swap);
  const lvl=text('label','','route-level');lvl.append(text('span','Your level'));const input=document.createElement('input');input.type='number';input.min='1';input.max='99';input.inputMode='numeric';input.placeholder='Any';input.value=read(LEVEL_KEY)||'';input.onchange=()=>{write(LEVEL_KEY,input.value?String(Math.max(1,Math.min(99,Math.round(+input.value)))):'');input.value=read(LEVEL_KEY)||'';compute();};lvl.append(input);
  const hint=text('p','Type a place or a zone, on any map, or open a zone to pick from its list. You can also right-click (long-press) the map or use Directions on a card. A druid or wizard teleport is used when it saves time.','route-hint');
  const tp=text('div','','route-teleport');tp.append(text('span','I can teleport as'));
  for(const c of CASTERS){const l=text('label','','route-cast'),b=document.createElement('input');b.type='checkbox';b.value=c;b.checked=casts().includes(c);b.onchange=()=>{write(TP_KEY,JSON.stringify([...tp.querySelectorAll('input:checked')].map(x=>x.value)));compute();};l.append(b,text('span',c));tp.append(l);}
  const iv=text('label','','route-cast'),ib=document.createElement('input');ib.type='checkbox';ib.checked=read(INVIS_KEY)==='1';ib.onchange=()=>{write(INVIS_KEY,ib.checked?'1':'');compute();};iv.append(ib,text('span','I can go invisible'));const ivRow=text('div','','route-teleport');ivRow.append(iv);
  const fb=text('div','','route-feedback');
  fb.append(text('p','Directions is new. A wrong turn, a missing way, an idea?','route-hint'),button('Send feedback',()=>window.atlasCommunity?.feedback({title:'Directions feedback',prefix:'Directions: ',suffix:state.from&&state.to?'\n\nRoute: '+routeLink():''}),'primary route-feedback-button'));
  panel.append(head,fields,lvl,tp,ivRow,hint,fb,text('div','','route-options-list'),text('div','','route-result'));
  journal.querySelector('.journal-heading').after(panel);
 }
 function fill(input,which){
  if(!input||document.activeElement===input)return;const c=state[which];
  input.value=c?placeName(c)+(c.map!==config.id?' · '+mapTitle(c.map):''):'';
 }
 function findPlace(id){const {exits,pins}=places();return [...exits,...pins].find(p=>p.id===id)||null;}
 // The steps of one map's part: floor changes, swims, and the way on to the next map, each with the distance
 // walked since the step before.
 // Floor changes worth a step: an unnamed back-and-forth (a path dipping under a bridge, a ramp on the edge of two
 // floors) folds into one change, or none if it ends where it began; a bare same-floor "Passage" is no step at all.
 function tidyChanges(changes,pts){
  const out=[];
  for(const c of changes){
   if(c.link&&c.from===c.to&&/^passage$/i.test(c.link.name||''))continue;
   const prev=out[out.length-1];
   if(!c.link&&prev&&!prev.link&&(pts[c.index-1]?.d||0)-(pts[prev.index-1]?.d||0)<60){
    out.pop();if(prev.from!==c.to)out.push({...c,from:prev.from,rise:(prev.rise||0)+(c.rise||0)});continue;
   }
   out.push(c);
  }
  return out;
 }
 function legSteps(l,isFirst){
  const r=l.result,mapId=l.map,pts=r.points,events=[];
  const tp=isFirst&&state.options[state.mode]?.teleport;
  if(tp)events.push({i:0,kind:'teleport',title:'Teleport to '+tp.place.name,sub:tp.caster+' spell · '+mapTitle(mapId)});
  else if(isFirst)events.push({i:0,kind:'start',title:placeName(state.from),sub:mapTitle(mapId)});
  for(const c of tidyChanges(r.changes,pts)){const p=pts[c.index-1],up=isUp(c,mapId);const named=c.link?c.link.name:nearestTravelName(p,c,l.markers);
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
  if(busy){const note=text('div','','route-busy');note.append(text('p',loading.size?'Loading the routes of '+[...loading].map(mapTitle).join(', ')+'…':'Finding the way…','route-note'),text('div','','route-progress'));box.append(note);return;}
  if(!state.from||!state.to)return;
  // Route options, one card each, like a map app's choice of routes.
  for(const [mode,label] of MODES){
   const o=state.options[mode];if(!o)continue;
   const card=button('',()=>{state.mode=mode;write(MODE_KEY,mode);pick();showPanel();draw();},'route-option'+(mode===state.mode?' selected':''));card.setAttribute('aria-pressed',String(mode===state.mode));
   if(o.error){card.append(text('span',label,'route-option-name'),text('span',o.error,'route-option-sub'));opts.append(card);continue;}
   const legs=o.legs,dangerCount=legs.reduce((s,l)=>s+(l.result.passed?.length||0),0),swim=legs.reduce((s,l)=>s+(l.result.swim||0),0);
   const top=text('span','','route-option-top');top.append(text('span',label,'route-option-name'),text('span',metres(total(legs)),'route-option-length'));
   const bits=[o.teleport?'teleports as '+o.teleport.caster:'',new Set(legs.map(l=>l.map)).size>1?new Set(legs.map(l=>l.map)).size+' maps':'',swim?'swims '+metres(swim):'',dangerCount?'passes '+dangerCount+(dangerCount>1?' mobs':' mob'):'clear of known mobs'].filter(Boolean);
   card.append(top,text('span',bits.join(' · '),'route-option-sub'+(dangerCount?' warn':'')));opts.append(card);
  }
  if(state.error&&!state.legs){box.append(text('p',state.error,'route-error'),reportButton());return;}
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
  box.append(actions,reportButton());
 }
 // Report a problem with the route on screen: everything needed to run it again goes with the message.
 function reportButton(){return button('Report a problem with this route',()=>window.atlasCommunity?.feedback(routeReport()),'route-report');}
 function routeReport(){
  const summary=mode=>{const o=state.options[mode];if(!o)return 'not worked out';if(o.error)return o.error;const legs=o.legs,swim=legs.reduce((s,l)=>s+(l.result.swim||0),0);
   return metres(total(legs))+(swim?', swims '+metres(swim):'')+(o.teleport?', teleports as '+o.teleport.caster:'')+', through '+[...new Set(legs.map(l=>mapTitle(l.map)))].join(' → ');};
  const where=p=>placeName(p)+' ('+mapTitle(p.map)+(p.level&&entry(p.map)?.levels?', '+levelTitle(p.level,p.map):'')+')',lvl=read(LEVEL_KEY),c=casts(),link=routeLink();
  const lines=['From: '+where(state.from),'To: '+where(state.to),'Shown: '+(state.mode==='safer'?'Safer':'Shorter'),'Your level: '+(lvl||'any'),'Teleports: '+(c.length?c.join(', '):'none'),'Invisible: '+(read(INVIS_KEY)==='1'?'yes':'no'),
   ...MODES.map(([m,label])=>label+': '+summary(m)),'Route: '+link];
  return {title:'Report a problem with this route',topic:'bug',optional:true,hint:'Your start, finish, level, teleports and the routes found are sent with your message.',
   placeholder:'What went wrong? (a wall it walks through, a way it misses, a closed door...)',prefix:'Directions: ',suffix:'\n\n'+lines.join('\n'),
   payload:{route:{from:endCode(state.from),to:endCode(state.to),mode:state.mode,settings:settingsCode(),link}}};
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
  for(const l of layers)l.remove();layers=[];arrowRuns=[];drawArrows();syncAddress();
  const parts=(state.legs||[]).filter(x=>x.map===config.id);if(!parts.length||!map)return;
  const here=config.levelId,ll=p=>locationOf(p),onFloor=p=>!config.levels||p.level===here,seen=[];
  // The other route option shows as a pale line where it goes its own way on this floor, tagged with its name and
  // length at the point it strays furthest; clicking it picks it.
  const mine=parts.flatMap(l=>l.result.points.filter(onFloor));
  const near=(p,list)=>{let best=Infinity;for(let k=1;k<list.length;k++){const a=list[k-1],b=list[k],dx=b.x-a.x,dy=b.y-a.y,t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy||1)));best=Math.min(best,Math.hypot(a.x+dx*t-p.x,a.y+dy*t-p.y));}return best;};
  for(const [mode,label] of MODES){
   if(mode===state.mode)continue;const o=state.options[mode],theirs=(o?.legs||[]).filter(x=>x.map===config.id);if(!theirs.length)continue;
   let far=null,fd=0;for(const p of theirs.flatMap(l=>l.result.points.filter(onFloor))){const d=mine.length>1?near(p,mine):Infinity;if(d>fd){fd=d;far=p;}}
   if(fd<20)continue;
   for(const al of theirs){
    let seg=[];const lines=[];
    for(const p of al.result.points){if(onFloor(p))seg.push(ll(p));else{if(seg.length>1)lines.push(seg);seg=[];}}
    if(seg.length>1)lines.push(seg);
    for(const line of lines){const pl=L.polyline(line,{className:'route-alt'}).addTo(map);pl.on('click',()=>{state.mode=mode;write(MODE_KEY,mode);pick();showPanel();draw();});layers.push(pl);}
   }
   const tag=L.tooltip({permanent:true,direction:'center',className:'route-tag alt',interactive:false}).setLatLng(ll(far)).setContent(text('span',label+' · '+metres(total(o.legs))));tag.addTo(map);layers.push(tag);
  }
  for(const l of parts)drawPart(l,here,ll,onFloor,seen);
  // The chosen route's name and length ride on its line too.
  if(seen.length>1){const t=L.tooltip({permanent:true,direction:'center',className:'route-tag',interactive:false}).setLatLng(ll(seen[Math.floor(seen.length/2)])).setContent(text('span',MODES.find(m=>m[0]===state.mode)[1]+' · '+metres(total(state.legs))));t.addTo(map);layers.push(t);}
  drawArrows();
  if(fit&&seen.length)map.fitBounds(L.latLngBounds(seen.map(ll)),{padding:[60,60],maxZoom:config.defaultView.placeZoom});
 }
 // One map's part of the route: this floor's runs (swims in a blue dash, passes beneath a hall dotted), round seals
 // to the other floors, the A and B ends, and a seal on to the next map. Small arrows along the line show the way.
 function drawPart(l,here,ll,onFloor,seen){
  const r=l.result,pts=r.points,first=l===state.legs[0],last=l===state.legs[state.legs.length-1];
  seen.push(...pts.filter(onFloor));
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
   if(c.from===c.to)continue;
   if(a.level===here)layers.push(seal(a,c.to,isUp(c)));
   if(b.level===here&&a.level!==here)layers.push(seal(b,c.from,!isUp(c),true));}
  const end=(p,label,cls)=>{if(!onFloor(p))return;layers.push(L.marker(ll(p),{icon:L.divIcon({className:'route-end '+cls,html:'<span>'+label+'</span>',iconSize:[26,26],iconAnchor:[13,13]}),keyboard:false,interactive:false,zIndexOffset:900}).addTo(map));};
  if(first)end(pts[0],'A','route-start');
  if(last)end(pts[pts.length-1],'B','route-finish');
  // Where this map's part ends at an exit, a seal carries the route on to the next map.
  if(l.next){const p=pts[pts.length-1];if(onFloor(p)){const m=seal(p,null,false,false,'Continue in '+l.next.title,'→');m.off('click');m.on('click',()=>openNext(l));layers.push(m);}}
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
  m.bindTooltip(text('span',label),{direction:'top',offset:[0,-14]});
  if(toLevel)m.on('click',()=>changeLevel(toLevel,{x:p.x,y:p.y,id:'',quiet:true}));
  return m;
 }
 // ---- entry points
 window.atlasSpotActions=[...(window.atlasSpotActions||[]),
  {label:'Directions from here',shown:()=>routable(config.id),run:at=>set('from',{kind:'spot',id:'spot',x:at.x,y:at.y,level:at.level})},
  {label:'Directions to here',shown:()=>routable(config.id),run:at=>set('to',{kind:'spot',id:'spot',x:at.x,y:at.y,level:at.level})}];
 window.atlasPopupActions=[...(window.atlasPopupActions||[]),
  {label:'Directions',icon:'route',shown:m=>routable(config.id)&&!singleMap&&Number.isFinite(m.x),run:m=>{map.closePopup();set('to',{id:m.id,name:markerTitle(m),x:m.x,y:m.y,level:m.level,...edge(m)});}}];
 // Share links: ?route=<start>~<finish>~<mode>[~<settings>], each end "map:x,y[:floor]" or "map:pin:<id>"; settings
 // "L20.Druid.Wizard.invisible" carry what changes the plan (level, teleports, invisibility) to whoever opens it.
 // A personal pin is not public, so it travels as its spot.
 const endCode=p=>p.map+':'+(p.kind==='spot'||String(p.id).startsWith('personal-')?Math.round(p.x)+','+Math.round(p.y)+(p.level?':'+p.level:''):'pin:'+p.id);
 const settingsCode=()=>[read(LEVEL_KEY)?'L'+read(LEVEL_KEY):'',...casts(),read(INVIS_KEY)==='1'?'invisible':''].filter(Boolean).join('.');
 function applySettings(code){
  if(code===undefined)return;const bits=code.split('.'),lvl=bits.find(b=>/^L[0-9]{1,2}$/.test(b));
  write(LEVEL_KEY,lvl?lvl.slice(1):'');write(TP_KEY,JSON.stringify(CASTERS.filter(c=>bits.includes(c))));write(INVIS_KEY,bits.includes('invisible')?'1':'');
  if(panel){panel.remove();panel=null;build();}
 }
 // The address bar carries the route on screen (?route=...), so the page's own address can be shared or bookmarked.
 function syncAddress(){
  if(shared||typeof history==='undefined')return;const u=new URL(location.href),want=beta&&state.from&&state.to?endCode(state.from)+'~'+endCode(state.to)+'~'+state.mode+'~'+settingsCode():null;
  if((u.searchParams.get('route')||null)===want)return;if(want)u.searchParams.set('route',want);else u.searchParams.delete('route');history.replaceState(history.state,'',u);
 }
 function routeLink(){const url=mapLink(state.from?.map||config.id);url.searchParams.set('route',endCode(state.from)+'~'+endCode(state.to)+'~'+state.mode+'~'+settingsCode());return url.href;}
 async function endFrom(code){
  const [mapId,a,b,c]=code.split(':');if(!routable(mapId))return null;
  if(a==='pin'){const d=await mapData(mapId),l=d.labels.find(x=>x.id===b),m=d.markers.find(x=>x.id===b),p=l||m;
   return p?{map:mapId,id:b,name:l?(l.toMap?exitName(l):l.name):markerTitle(m),x:p.x,y:p.y,level:p.level,...(l?.toMap?{reach:260}:edge(m))}:null;}
  const [x,y]=String(a).split(',').map(Number);return Number.isFinite(x)&&Number.isFinite(y)?{map:mapId,kind:'spot',id:'spot',x,y,level:b||undefined}:null;
 }
 let shared=new URL(location.href).searchParams.get('route');
 // The route in the address is read once at start; from then on syncAddress keeps it in step with the screen.
 // A shared route waits until the account is known to be in the beta.
 async function openShared(){
  if(!shared||!beta)return;const [a,b,mode,settings]=shared.split('~');shared=null;const from=a&&await endFrom(a),to=b&&await endFrom(b);
  if(from&&to){applySettings(settings);state.from=from;state.to=to;if(mode==='shorter'||mode==='safer')state.mode=mode;openView();compute();}
 }
 async function checkBeta(){
  const c=window.atlasCommunity,uid=c?.userId?.();let ok=false;
  if(uid)ok=!!c.isAdmin?.()||((await c.points?.())?.points||0)>0;
  // A local preview of the site always has it, for checking before a publish.
  if(['localhost','127.0.0.1'].includes(location.hostname))ok=true;
  if(uid!==window.atlasCommunity?.userId?.()||ok===beta)return;
  beta=ok;window.atlasBeta=new Set(beta?['directions']:[]);window.dispatchEvent(new Event('atlas:beta'));if(!beta){state.from=state.to=null;state.options={};state.legs=null;closeView();}
  showPanel();draw();openShared();
 }
 window.addEventListener('atlas:account',()=>checkBeta().catch(()=>{}));
 if(['localhost','127.0.0.1'].includes(location.hostname))checkBeta().catch(()=>{});
 window.addEventListener('atlas:loaded',async()=>{
  if(!panel)build();showPanel();draw();
  openShared();
  // Route data loads only once someone opens Directions on this map (see openView).
  if(routable(config.id)&&panel&&!panel.hidden)ensureGround(config.id).catch(()=>{});
 });
})();
