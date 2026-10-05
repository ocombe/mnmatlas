/* Hidden rooms and passages. */
'use strict';
function setupHiddenAreas(map,config,data){
 const toggle=document.getElementById('hidden-toggle'),details=document.getElementById('hidden-details');
 const key=storageKey('hidden-areas'),primary=config.hiddenPrimaryStack;
 let group=null,active=primary?.lower,levelStacks=[];
 const layers=new Map(),stack=new Set(primary?[primary.lower,primary.upper]:[]);
 const swap=document.getElementById('hidden-swap');
 const label=value=>text('span',value);
 const position=xy=>map.unproject(xy,config.coordinateZoom);
 const isStacked=id=>stack.has(id)||levelStacks.some(s=>s.upperAreas.includes(id)||s.lowerAreas.includes(id));
 const isInactive=id=>(stack.has(id)&&id!==active)||levelStacks.some(s=>(s.active==='upper'?s.lowerAreas:s.upperAreas).includes(id));
 function paint(){
  for(const [id,layer] of layers){
   const inactive=isInactive(id);
   // The inactive floor keeps a dark, heavier dashed outline so it stays visible on textured caves.
   layer.setStyle({color:inactive?'#1d160d':layer.options.baseColor,opacity:inactive?.9:1,fillOpacity:inactive?.1:.46,weight:inactive?2.6:1.25,dashArray:inactive?'7 5':null});
   const el=layer.getElement();if(el){el.dataset.active=String(!inactive);if(isStacked(id))el.setAttribute('aria-pressed',String(!inactive));}
   if(!inactive)layer.bringToFront();
  }
  // A skeleton remains clickable above the solid floor, also on touch screens.
  for(const [id,layer] of layers)if(isInactive(id))layer.bringToFront();
  swap.hidden=!primary;if(primary)swap.textContent='Bring '+(active===primary.upper?primary.lowerLabel:primary.upperLabel)+' forward';
  swap.setAttribute('aria-pressed',String(!!primary&&active===primary.upper&&!isInactive(active)));
  for(const s of levelStacks){s.button.textContent='Bring '+(s.active==='upper'?s.lowerLabel:s.upperLabel)+' forward';s.button.setAttribute('aria-pressed',String(s.active==='lower'));}
 }
 const inRing=(p,ring)=>{let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a.lat>p.lat)!==(b.lat>p.lat)&&p.lng<(b.lng-a.lng)*(p.lat-a.lat)/(b.lat-a.lat)+a.lng)inside=!inside;}return inside;};
 const contains=(layer,p)=>{let hit=false;for(const ring of layer.getLatLngs())for(const r of (Array.isArray(ring[0])?ring:[ring]))if(inRing(p,r))hit=!hit;return hit;};
 const partners=id=>stack.has(id)?[...stack]:levelStacks.filter(s=>s.upperAreas.includes(id)||s.lowerAreas.includes(id)).flatMap(s=>[...s.upperAreas,...s.lowerAreas]);
 const activeUnder=(id,p)=>partners(id).some(other=>other!==id&&!isInactive(other)&&layers.has(other)&&contains(layers.get(other),p));
 function setActive(id){
  if(stack.has(id))active=id;
  for(const s of levelStacks){if(s.upperAreas.includes(id))s.active='upper';if(s.lowerAreas.includes(id))s.active='lower';}
  paint();
 }
 function load(){
  group=L.layerGroup();
  const pathPane=map.getPane('paths')||map.createPane('paths');pathPane.style.zIndex='440';
  for(const old of details.querySelectorAll('[data-level-swap]'))old.remove();
  levelStacks=(data.levelStacks||[]).map(s=>{
   const button=document.createElement('button');button.type='button';button.dataset.levelSwap=s.id;
   button.style.cssText='width:100%;font-size:11px;min-height:44px;margin-top:5px;';
   const state={...s,active:s.default||'upper',button};
   button.onclick=()=>{state.active=state.active==='upper'?'lower':'upper';paint();};details.append(button);return state;
  });
  for(const area of [...data.areas,...(data.additionalAreas||[])]){
   const baseColor=area.color==='#eee57c'?'#756328':'#275877';
   const layer=L.polygon(area.rings.map(r=>r.map(position)),{color:baseColor,baseColor,fillColor:area.color,fillRule:'evenodd',smoothFactor:0,bubblingMouseEvents:false,className:'hidden-area'});
   const title=area.name+' · Hidden area'+(area.approximate?' · Approximate outline':'');
   layer.bindTooltip(()=>label(title),{sticky:true});
   // Stacked floors also switch on hover, but only where the pointer is outside the floor already shown, so overlaps never flicker.
   layer.on('mouseover',e=>{if(isStacked(area.id)&&isInactive(area.id)&&!activeUnder(area.id,e.latlng))setActive(area.id);});
   layer.on('click',()=>{if(isStacked(area.id))setActive(area.id);const p=findPlace(area.id);if(p)openPlace(p,Math.max(map.getZoom(),config.defaultView.placeZoom));});
   layer.on('add',()=>{
    const el=layer.getElement();el.dataset.area=area.id;el.setAttribute('aria-label',title);
    if(isStacked(area.id)){el.setAttribute('tabindex','0');el.setAttribute('role','button');el.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();e.stopPropagation();setActive(area.id);}};}
   });
   layers.set(area.id,layer);group.addLayer(layer);
  }
  for(const route of data.routes){
   if(route.presentation!=='undrawn-route')continue;
   for(const endpoint of route.endpoints){
    const face=label(String(route.marker_number));
    const icon=L.divIcon({className:'hidden-route',html:face,iconSize:[24,24],iconAnchor:[12,12]});
    group.addLayer(L.marker(position(endpoint.xy),{icon,alt:'Route '+route.marker_number}).bindTooltip(()=>label('Route '+route.marker_number+' · Hidden area')));
   }
  }
  for(const connection of data.connections||[]){
   if(!Array.isArray(connection.path)||connection.path.length<2)continue;
   const line=L.polyline(connection.path.map(position),{pane:'paths',color:connection.color||'#62432a',weight:connection.width||2,dashArray:connection.dashed===false?null:'4 5',opacity:connection.dashed===false?.55:.85,interactive:!!connection.name,className:'area-path'});if(connection.name)line.bindTooltip(()=>label(connection.name),{sticky:true});group.addLayer(line);
  }
  for(const destination of data.destinations||[]){
   // The exit sign at this spot carries the arrow; the connector only ends in a small dot drawn beneath it.
   const icon=L.divIcon({className:'hidden-end',iconSize:[9,9],iconAnchor:[4.5,4.5]});
   group.addLayer(L.marker(position(destination.xy),{icon,pane:'paths',alt:destination.name}).bindTooltip(()=>label(destination.name),{direction:'right',offset:[8,0]}));
  }
 }
 function update(){
  details.hidden=!toggle.checked;
  try{
   if(toggle.checked){if(!group)load();group.addTo(map);paint();}
   else group?.remove();
   try{localStorage.setItem(key,String(toggle.checked));}catch{}
  }catch{group=null;toggle.checked=false;details.hidden=true;status('Hidden areas could not load. Try the toggle again.',true);}
 }
 swap.onclick=()=>{if(primary)setActive(active===primary.lower?primary.upper:primary.lower);};
 toggle.onchange=update;
 try{const saved=localStorage.getItem(key);toggle.checked=(saved??(config.legacyStorage?.hiddenKey?localStorage.getItem(config.legacyStorage.hiddenKey):null))==='true';}catch{toggle.checked=false;}
 update();
 return {show(id){toggle.checked=true;update();if(isStacked(id))setActive(id);},dispose(){group?.remove();for(const b of details.querySelectorAll('[data-level-swap]'))b.remove();}};
}
