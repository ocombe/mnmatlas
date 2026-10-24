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
 const state={from:null,to:null,mode:read(MODE_KEY)==='shorter'?'shorter':'safer',legs:null,error:''};
 const entry=id=>registry?.maps.find(c=>c.id===id);
 const routable=id=>!!entry(id)?.routes;
 const mapTitle=id=>entry(id)?.title||id;
 const levelTitle=(id,mapId=config.id)=>entry(mapId)?.levels?.find(l=>l.id===id)?.title||id||'';
 const floorOrder=(id,mapId=config.id)=>entry(mapId)?.levels?entry(mapId).levels.findIndex(l=>l.id===id):0;
 const ask=msg=>new Promise((resolve,reject)=>{const id=++serial;pending.set(id,{resolve,reject});worker.postMessage({...msg,id});});
 function startWorker(){
  if(worker)return;
  worker=new Worker('route-worker.js?v=route-5');
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
  const exits=(labelData?.labels||[]).filter(l=>l.toMap&&l.kind==='exit').map(l=>({id:'label:'+l.id,name:exitName(l),x:l.x,y:l.y,level:l.level,reach:260}));
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
  return markers.filter(m=>m.toMarker&&m.toLevel&&byId.has(m.toMarker)).map(m=>{const b=byId.get(m.toMarker);return {id:m.id,name:markerTitle(m),from:{x:m.x,y:m.y,level:m.level},to:{x:b.x,y:b.y,level:b.level},oneWay:true,kind:m.category==='Trap'?'trap':/\bdrop\b/i.test(m.name)?'drop':'stairs',cost:m.category==='Trap'?2:4};});
 }
 // The maps between two maps, through exits that lead both ways: fewest maps first.
 async function mapPath(a,b){
  const prev=new Map([[a,null]]),queue=[a];
  while(queue.length){
   const id=queue.shift();if(id===b)break;
   const d=await mapData(id);
   for(const l of d.labels){
    if(!l.toMap||!routable(l.toMap)||prev.has(l.toMap))continue;
    prev.set(l.toMap,{from:id,exit:l});queue.push(l.toMap);
   }
  }
  if(!prev.has(b))return null;
  const hops=[];for(let id=b;prev.get(id);id=prev.get(id).from)hops.unshift({...prev.get(id),to:id});
  return hops;
 }
 // Where an exit lands on the next map: the sign it names, or the sign there that leads back.
 async function arrival(hop){
  const d=await mapData(hop.to),l=d.labels.find(x=>x.id===hop.exit.toPlace)||d.labels.find(x=>x.toMap===hop.from);
  return l?{map:hop.to,name:exitName(l),x:l.x,y:l.y,level:l.level,reach:260,kind:'exit',id:'label:'+l.id}:null;
 }
 async function leg(mapId,from,to){
  const d=await ensureGround(mapId),list=dangers(d.markers);
  const result=await ask({type:'route',map:mapId,from,to,mode:state.mode,dangers:list,links:links(d.markers)});
  return {map:mapId,from,to,result,dangerList:list,markers:d.markers};
 }
 async function compute(){
  const mine=++run;
  if(!state.from||!state.to){state.legs=null;state.error='';draw();showPanel();return;}
  busy=true;showPanel();
  try{
   let legs;
   if(state.from.map===state.to.map)legs=[await leg(state.from.map,state.from,state.to)];
   else{
    const hops=await mapPath(state.from.map,state.to.map);
    if(!hops)throw Error('No known way from '+mapTitle(state.from.map)+' to '+mapTitle(state.to.map)+' on the maps that have routes so far.');
    legs=[];let start=state.from;
    for(const hop of hops){
     const out={map:hop.from,name:hop.exit.name,x:hop.exit.x,y:hop.exit.y,level:hop.exit.level,reach:260,kind:'exit'},land=await arrival(hop);
     if(!land)throw Error('The way into '+mapTitle(hop.to)+' is not marked yet.');
     const l=await leg(hop.from,start,out);l.next={map:hop.to,place:land.id.slice(6),title:mapTitle(hop.to)};legs.push(l);start=land;
    }
    legs.push(await leg(state.to.map,start,state.to));
   }
   if(mine!==run)return;
   const bad=legs.find(l=>l.result.error);
   state.legs=bad?null:legs;state.error=bad?(legs.length>1?mapTitle(bad.map)+': ':'')+bad.result.error:'';
  }catch(e){if(mine!==run)return;state.legs=null;state.error=e.message;}
  busy=false;showPanel();draw(true);
  // On a phone the steps wait in the Search menu; the map says what was found.
  if(compact()&&state.legs){const t=state.legs.reduce((s,l)=>s+l.result.length,0);status('Route: about '+t+' m'+(state.legs.length>1?' over '+state.legs.length+' maps':'')+'. Steps are in the Search menu.');}
  else if(compact()&&state.error)status(state.error);
 }
 function set(which,place){
  state[which]={...place,map:config.id};
  if(!panel)build();if(panel)panel.open=true;
  // On a phone the map stays in view; the Search menu holds the steps.
  if(!compact())setPanel(true);compute();
 }
 // ---- the panel in the Search menu
 function build(){
  const after=$('look-for-select')?.closest('label')||$('search')?.closest('.search-box');if(!after)return;
  panel=document.createElement('details');panel.className='route-panel';panel.id='route-panel';
  const summary=text('summary','','route-summary');summary.append(text('span','Find a route','route-heading'));panel.append(summary);
  const body=text('div','','route-body');
  const row=(which,label)=>{const l=text('label','','route-field');l.append(text('span',label));const s=document.createElement('select');s.id='route-'+which;s.setAttribute('aria-label',label);s.onchange=()=>{const v=s.value;if(v==='keep')return;const p=findPlace(v);state[which]=p?{...p,map:config.id}:null;compute();};l.append(s);return l;};
  const swap=button('⇅',()=>{[state.from,state.to]=[state.to,state.from];compute();},'route-swap');swap.title='Swap start and finish';swap.setAttribute('aria-label','Swap start and finish');
  const fields=text('div','','route-fields');fields.append(row('from','From'),row('to','To'),swap);
  const mode=text('div','','segmented route-mode');mode.setAttribute('role','radiogroup');mode.setAttribute('aria-label','Route');
  for(const [value,label] of [['safer','Safer'],['shorter','Shorter']]){const l=document.createElement('label'),r=document.createElement('input');r.type='radio';r.name='route-mode';r.value=value;r.onchange=()=>{state.mode=value;write(MODE_KEY,value);compute();};l.append(r,text('span',label));mode.append(l);}
  const lvl=text('label','','route-level');lvl.append(text('span','Your level'));const input=document.createElement('input');input.type='number';input.min='1';input.max='99';input.inputMode='numeric';input.placeholder='Any';input.value=read(LEVEL_KEY)||'';input.onchange=()=>{write(LEVEL_KEY,input.value?String(Math.max(1,Math.min(99,Math.round(+input.value)))):'');input.value=read(LEVEL_KEY)||'';if(state.mode==='safer')compute();};lvl.append(input);
  const options=text('div','','route-options');options.append(mode,lvl);
  const hint=text('p','Right-click (or long-press) the map for "Route from here" and "Route to here", or pick places below. The start and the finish can be on different maps.','route-hint');
  body.append(hint,fields,options,text('div','','route-result'));panel.append(body);
  after.after(panel);
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
 function showPanel(){
  if(!panel)return;
  const on=routable(config.id);panel.hidden=!on;if(!on)return;
  fill($('route-from'),'from');fill($('route-to'),'to');
  for(const r of panel.querySelectorAll('input[name=route-mode]'))r.checked=r.value===state.mode;
  const box=panel.querySelector('.route-result');box.replaceChildren();
  if(busy){box.append(text('p','Finding the way…','route-note'));return;}
  if(state.error){box.append(text('p',state.error,'route-error'));return;}
  const legs=state.legs;if(!legs)return;
  const total=legs.reduce((s,l)=>s+l.result.length,0),swim=legs.reduce((s,l)=>s+(l.result.swim||0),0),floors=legs.length===1?new Set(legs[0].result.points.map(p=>p.level)).size:0;
  box.append(text('p','About '+total+' m'+(legs.length>1?' across '+legs.length+' maps':floors>1?' over '+floors+' floors':'')+(state.mode==='safer'?' · safer way':' · shortest way'),'route-total'));
  if(swim)box.append(text('p','Swimming about '+swim+' m of it (blue dashes).','route-note'));
  const steps=text('ol','','route-steps');
  const step=(label,action)=>{const li=text('li','');li.append(button(label,action,'route-step'));steps.append(li);};
  legs.forEach((l,i)=>{
   const r=l.result,mapId=l.map,at=p=>()=>show(p,mapId);
   if(i===0)step('Start: '+placeName(state.from)+(legs.length>1?' ('+mapTitle(mapId)+')':''),at(r.points[0]));
   for(const c of r.changes){const p=r.points[c.index-1],up=floorOrder(c.to,mapId)<floorOrder(c.from,mapId);const named=c.link?c.link.name:nearestTravelName(p,c,l.markers);step(named?(/ to /i.test(named)?named:named+' → '+levelTitle(c.to,mapId)):(up?'Go up':'Go down')+' to '+levelTitle(c.to,mapId),at(p));}
   if(l.next)step('Take the exit to '+l.next.title+' (about '+r.length+' m on '+mapTitle(mapId)+')',()=>openNext(l));
   else step('Arrive: '+placeName(state.to),at(r.points[r.points.length-1]));
  });
  box.append(steps);
  if(legs.some(l=>l.result.points.some(p=>p.under)))box.append(text('p','Dotted parts pass beneath a hall or bridge drawn above them.','route-note'));
  const passed=legs.flatMap(l=>(l.result.passed||[]).map(p=>l.dangerList[p.index]?.name)).filter(Boolean);
  if(passed.length){const near=text('p','','route-danger');near.append(text('strong',state.mode==='safer'?'Still passes close to: ':'Passes close to: '),document.createTextNode(passed.join(', ')));box.append(near);}
  else if(state.mode==='safer')box.append(text('p','Keeps clear of the known named mobs, camps and traps.','route-note'));
  box.append(button('Clear route',()=>{state.from=state.to=state.legs=null;state.error='';draw();showPanel();},'route-clear'));
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
  {label:'Route from here',shown:()=>routable(config.id),run:at=>set('from',{kind:'spot',id:'spot',x:at.x,y:at.y,level:at.level})},
  {label:'Route to here',shown:()=>routable(config.id),run:at=>set('to',{kind:'spot',id:'spot',x:at.x,y:at.y,level:at.level})}];
 window.atlasPopupActions=[...(window.atlasPopupActions||[]),
  {label:'Route to here',icon:'route',shown:m=>routable(config.id)&&!singleMap&&Number.isFinite(m.x),run:m=>{map.closePopup();set('to',{id:m.id,name:markerTitle(m),x:m.x,y:m.y,level:m.level});}}];
 window.addEventListener('atlas:loaded',()=>{
  if(!panel)build();showPanel();draw();
  if(routable(config.id))ensureGround(config.id).catch(()=>{});
 });
})();
