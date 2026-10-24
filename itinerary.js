// Itinerary: pick a start and a finish and the atlas draws the way between them, across floors. Safer keeps away from
// named mobs, camps, ambushes and traps where it can; Shorter takes the most direct way. Maps opt in with "routes".
(()=>{
 const LEVEL_KEY='mnmaps-route-level',MODE_KEY='mnmaps-route-mode';
 // How far each kind of danger reaches (game units) and how strongly Safer avoids it.
 const DANGER={'Named mob':[20,6],'Mob camp':[25,6],'Ambush':[30,10],'Trap':[6,40]};
 const read=k=>{try{return localStorage.getItem(k);}catch{return null;}},write=(k,v)=>{try{localStorage.setItem(k,v);}catch{}};
 let worker=null,serial=0,loadedFor='',meta=null,panel=null,layers=[],busy=false;
 const pending=new Map();
 const state={map:'',from:null,to:null,mode:read(MODE_KEY)==='shorter'?'shorter':'safer',result:null,error:''};
 const routesFile=()=>registry?.maps.find(c=>c.id===config?.id)?.routes||'';
 const levelTitle=id=>config.levels?.find(l=>l.id===id)?.title||id||'';
 const ask=msg=>new Promise((resolve,reject)=>{const id=++serial;pending.set(id,{resolve,reject});worker.postMessage({...msg,id});});
 function startWorker(){
  if(worker)return;
  worker=new Worker('route-worker.js?v=route-3');
  worker.onmessage=e=>{const p=pending.get(e.data.id);if(!p)return;pending.delete(e.data.id);e.data.ok?p.resolve(e.data.result):p.reject(Error(e.data.error));};
 }
 async function ensureData(){
  const file=routesFile();if(!file)return false;if(loadedFor===file)return true;
  startWorker();meta=await (await fetch(file)).json();await ask({type:'load',meta,url:new URL(meta.file,document.baseURI).href});loadedFor=file;return true;
 }
 const placeName=p=>p.kind==='spot'?'Spot on '+levelTitle(p.level):p.name;
 function places(){
  const exits=(labelData?.labels||[]).filter(l=>l.toMap&&l.kind==='exit').map(l=>({id:'label:'+l.id,name:'Entrance from '+(registry.maps.find(c=>c.id===l.toMap)?.title||l.name.replace(/^to /,'')),x:l.x,y:l.y,level:l.level}));
  const pins=allMarkers().filter(m=>Number.isFinite(m.x)&&Number.isFinite(m.y)).map(m=>({id:m.id,name:markerTitle(m),x:m.x,y:m.y,level:m.level}));
  return {exits,pins};
 }
 function dangers(){
  const level=Number(read(LEVEL_KEY))||0;
  return allMarkers().filter(m=>{
   if(!DANGER[m.category])return false;
   // A trap's landing pin is where you arrive, not a trap.
   if(m.category==='Trap'&&m.toMarker&&!m.toLevel)return false;
   const v=m.category==='Named mob'?namedLevels(m):campLevels(m);
   // Mobs well below the walker's level leave them alone.
   return !(level&&v&&v[1]!==null&&v[1]<=level-4);
  }).map(m=>({id:m.id,name:markerTitle(m),x:m.x,y:m.y,level:m.level,radius:DANGER[m.category][0],weight:DANGER[m.category][1]}));
 }
 // Paired level pins (stairs, ladders, drops, pit traps) also join floors; each pin is the way from its own side.
 function links(){
  const all=allMarkers(),byId=new Map(all.map(m=>[m.id,m]));
  return all.filter(m=>m.toMarker&&m.toLevel&&byId.has(m.toMarker)).map(m=>{const b=byId.get(m.toMarker);return {id:m.id,name:markerTitle(m),from:{x:m.x,y:m.y,level:m.level},to:{x:b.x,y:b.y,level:b.level},oneWay:true,kind:m.category==='Trap'?'trap':/\bdrop\b/i.test(m.name)?'drop':'stairs',cost:m.category==='Trap'?2:4};});
 }
 async function compute(){
  if(!state.from||!state.to){state.result=null;state.error='';draw();showPanel();return;}
  busy=true;showPanel();
  try{
   if(!await ensureData())throw Error('Routes are not available on this map yet.');
   const res=await ask({type:'route',from:state.from,to:state.to,mode:state.mode,dangers:dangers(),links:links()});
   state.result=res.error?null:res;state.error=res.error||'';state.dangerList=dangers();
  }catch(e){state.result=null;state.error=e.message;}
  busy=false;showPanel();draw(true);
  // On a phone the steps wait in the Search menu; the map says what was found.
  if(compact()&&state.result){const n=new Set(state.result.points.map(p=>p.level)).size;status('Route: about '+state.result.length+' m'+(n>1?' over '+n+' floors, follow the round arrows':'')+'. Steps are in the Search menu.');}
  else if(compact()&&state.error)status(state.error);
 }
 function set(which,place){
  state.map=config.id;state[which]=place;
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
  const row=(which,label)=>{const l=text('label','','route-field');l.append(text('span',label));const s=document.createElement('select');s.id='route-'+which;s.setAttribute('aria-label',label);s.onchange=()=>{const v=s.value;if(v==='spot')return;const p=findPlace(v);state.map=config.id;state[which]=p;compute();};l.append(s);return l;};
  const swap=button('⇅',()=>{[state.from,state.to]=[state.to,state.from];compute();},'route-swap');swap.title='Swap start and finish';swap.setAttribute('aria-label','Swap start and finish');
  const fields=text('div','','route-fields');fields.append(row('from','From'),row('to','To'),swap);
  const mode=text('div','','segmented route-mode');mode.setAttribute('role','radiogroup');mode.setAttribute('aria-label','Route');
  for(const [value,label] of [['safer','Safer'],['shorter','Shorter']]){const l=document.createElement('label'),r=document.createElement('input');r.type='radio';r.name='route-mode';r.value=value;r.onchange=()=>{state.mode=value;write(MODE_KEY,value);compute();};l.append(r,text('span',label));mode.append(l);}
  const lvl=text('label','','route-level');lvl.append(text('span','Your level'));const input=document.createElement('input');input.type='number';input.min='1';input.max='99';input.inputMode='numeric';input.placeholder='Any';input.value=read(LEVEL_KEY)||'';input.onchange=()=>{write(LEVEL_KEY,input.value?String(Math.max(1,Math.min(99,Math.round(+input.value)))):'');input.value=read(LEVEL_KEY)||'';if(state.mode==='safer')compute();};lvl.append(input);
  const options=text('div','','route-options');options.append(mode,lvl);
  const hint=text('p','Right-click (or long-press) the map for "Route from here" and "Route to here", or pick places below. Every card also has Route to here.','route-hint');
  body.append(hint,fields,options,text('div','','route-result'));panel.append(body);
  after.after(panel);
 }
 function fill(select,which){
  const current=state[which];select.replaceChildren();
  const {exits,pins}=places(),az=(a,b)=>a.name.localeCompare(b.name);
  const first=text('option',which==='from'?'Choose a start':'Choose a finish');first.value='';select.append(first);
  if(current?.kind==='spot'){const o=text('option',placeName(current));o.value='spot';select.append(o);}
  const group=(label,list)=>{if(!list.length)return;const g=document.createElement('optgroup');g.label=label;for(const p of list.sort(az)){const o=text('option',p.name);o.value=p.id;g.append(o);}select.append(g);};
  group('Entrances',exits);
  for(const l of config.levels||[{id:undefined,title:'Places'}])group(l.title,pins.filter(p=>(p.level||undefined)===l.id||!config.levels));
  select.value=current?(current.kind==='spot'?'spot':current.id):'';
 }
 function findPlace(id){const {exits,pins}=places();return [...exits,...pins].find(p=>p.id===id)||null;}
 function showPanel(){
  if(!panel)return;
  const on=!!routesFile();panel.hidden=!on;if(!on)return;
  fill($('route-from'),'from');fill($('route-to'),'to');
  for(const r of panel.querySelectorAll('input[name=route-mode]'))r.checked=r.value===state.mode;
  const box=panel.querySelector('.route-result');box.replaceChildren();
  if(busy){box.append(text('p','Finding the way…','route-note'));return;}
  if(state.error){box.append(text('p',state.error,'route-error'));return;}
  const r=state.result;if(!r){return;}
  const floors=[...new Set(r.points.map(p=>p.level))];
  box.append(text('p','About '+r.length+' m'+(floors.length>1?' over '+floors.length+' floors':'')+(state.mode==='safer'?' · safer way':' · shortest way'),'route-total'));
  if(r.swim)box.append(text('p','Swimming about '+r.swim+' m of it (blue dashes).','route-note'));
  const steps=text('ol','','route-steps');
  const step=(label,at)=>{const li=text('li','');const b=button(label,()=>show(at),'route-step');li.append(b);steps.append(li);};
  step('Start: '+placeName(state.from),r.points[0]);
  for(const c of r.changes){const at=r.points[c.index-1],up=floorOrder(c.to)<floorOrder(c.from);const named=c.link?c.link.name:nearestTravelName(at,c);step(named?(/ to /i.test(named)?named:named+' → '+levelTitle(c.to)):(up?'Go up':'Go down')+' to '+levelTitle(c.to),at);}
  step('Arrive: '+placeName(state.to),r.points[r.points.length-1]);
  box.append(steps);
  if(r.points.some(p=>p.under))box.append(text('p','Dotted parts pass beneath a hall or bridge drawn above them.','route-note'));
  if(r.passed?.length){const list=state.dangerList||[];const near=text('p','','route-danger');near.append(text('strong',state.mode==='safer'?'Still passes close to: ':'Passes close to: '),document.createTextNode(r.passed.map(p=>list[p.index]?.name).filter(Boolean).join(', ')));box.append(near);}
  else if(state.mode==='safer')box.append(text('p','Keeps clear of the known named mobs, camps and traps.','route-note'));
  const clear=button('Clear route',()=>{state.from=state.to=state.result=null;state.error='';draw();showPanel();},'route-clear');box.append(clear);
 }
 const floorOrder=id=>config.levels?config.levels.findIndex(l=>l.id===id):0;
 // A floor change on open ground is named after the stairs pin beside it, when there is one.
 function nearestTravelName(at,c){
  let best=null,bd=140;
  for(const m of allMarkers()){if(!m.toLevel||m.level!==c.from||m.toLevel!==c.to)continue;const d=Math.hypot(m.x-at.x,m.y-at.y);if(d<bd){bd=d;best=m;}}
  return best?markerTitle(best):'';
 }
 function show(at){
  if(!at)return;
  if(at.level&&at.level!==config.levelId){changeLevel(at.level,{x:at.x,y:at.y,id:'',quiet:true});return;}
  map.setView(locationOf(at),Math.max(map.getZoom(),config.defaultView.placeZoom-1));
 }
 // ---- the line on the map
 function draw(fit=false){
  for(const l of layers)l.remove();layers=[];
  const r=state.result;if(!r||!map||state.map!==config.id)return;
  const here=config.levelId,pts=r.points,ll=p=>locationOf(p);
  // Runs on this floor are inked (swims in a wavy blue dash, passes beneath a hall dotted); the parts on other floors
  // show faintly so you can see where the way goes.
  const kind=(a,b)=>a.level!==here&&config.levels?'ghost':a.under&&b.under?'under':a.swim&&b.swim?'swim':'ink';
  let run=[pts[0]],current='';
  const flush=()=>{if(run.length>1){const line=run.map(ll);
    if(current==='ink'||current==='swim')layers.push(L.polyline(line,{className:'route-halo',interactive:false}).addTo(map));
    layers.push(L.polyline(line,{className:'route-'+current,interactive:false}).addTo(map));}
   run=[run[run.length-1]];};
  for(let k=1;k<pts.length;k++){const a=pts[k-1],b=pts[k];
   if(a.level!==b.level){flush();run=[b];current='';continue;}
   const t=kind(a,b);if(t!==current&&current)flush();current=t;run.push(b);}
  flush();
  for(const c of r.changes){const a=pts[c.index-1],b=pts[c.index];
   if(a.level===here)layers.push(seal(a,c.to,floorOrder(c.to)<floorOrder(c.from)));
   if(b.level===here&&a.level!==here)layers.push(seal(b,c.from,floorOrder(c.from)<floorOrder(c.to),true));}
  const end=(p,label,cls)=>{if(config.levels&&p.level!==here)return;layers.push(L.marker(ll(p),{icon:L.divIcon({className:'route-end '+cls,html:'<span>'+label+'</span>',iconSize:[26,26],iconAnchor:[13,13]}),keyboard:false,interactive:false,zIndexOffset:900}).addTo(map));};
  end(pts[0],'A','route-start');end(pts[pts.length-1],'B','route-finish');
  if(fit){const mine=pts.filter(p=>!config.levels||p.level===here);if(mine.length)map.fitBounds(L.latLngBounds(mine.map(ll)),{padding:[60,60],maxZoom:config.defaultView.placeZoom});}
 }
 function seal(p,toLevel,up,back=false){
  const icon=L.divIcon({className:'route-floor',html:'',iconSize:[30,30],iconAnchor:[15,15]});
  const m=L.marker(locationOf(p),{icon,keyboard:true,zIndexOffset:950,title:''}).addTo(map);
  const el=m.getElement();el.append(text('span',up?'↑':'↓','route-floor-arrow'));el.setAttribute('aria-label',(back?'Back ':up?'Up ':'Down ')+'to '+levelTitle(toLevel));
  m.bindTooltip((back?'Came from ':up?'Go up to ':'Go down to ')+levelTitle(toLevel),{direction:'top',offset:[0,-14]});
  m.on('click',()=>changeLevel(toLevel,{x:p.x,y:p.y,id:'',quiet:true}));
  return m;
 }
 // ---- entry points
 window.atlasSpotActions=[...(window.atlasSpotActions||[]),
  {label:'Route from here',shown:()=>!!routesFile(),run:at=>set('from',{kind:'spot',id:'spot',x:at.x,y:at.y,level:at.level})},
  {label:'Route to here',shown:()=>!!routesFile(),run:at=>set('to',{kind:'spot',id:'spot',x:at.x,y:at.y,level:at.level})}];
 window.atlasPopupActions=[...(window.atlasPopupActions||[]),
  {label:'Route to here',icon:'route',shown:m=>!!routesFile()&&!singleMap&&Number.isFinite(m.x),run:m=>{map.closePopup();set('to',{id:m.id,name:markerTitle(m),x:m.x,y:m.y,level:m.level});}}];
 window.addEventListener('atlas:loaded',()=>{
  if(state.map&&state.map!==config.id){state.from=state.to=state.result=null;state.error='';state.map='';}
  if(!panel)build();showPanel();draw();
  if(routesFile())ensureData().catch(()=>{});
 });
})();
