// Crowded pins (preview): pins that sit on top of each other merge into one pin with a count. The distance is measured
// on screen, so groups split again as you zoom in. Three looks to compare: 'type' (same type only), 'stack' (any type,
// stacked faces) and 'dots' (no groups; small dots for common types when zoomed out). Off by default.
(()=>{
 const modes=['type','stack','dots','off'],storeKey='mnmaps-preview-groups';
 const params=new URLSearchParams(location.search);
 let mode='off';try{mode=localStorage.getItem(storeKey)||'off';}catch{}
 if(modes.includes(params.get('groups')))mode=params.get('groups');
 if(!modes.includes(mode))mode='off';
 const radius={type:44,stack:44},custom=Number(params.get('groupRadius'));
 // Travel pins, trainers (their badges already move apart), shapes and your own notes always stay on their own.
 const groupable=['Personal','Vendor','Quest NPC','Notable NPC','Quest','Tradeskill','Forge','Bank','Inn','Guild','Stable','Mob camp','Named mob','Fishing spot','Herbs','Wood','Ore','Camping spot','Secret'];
 const minor=['Personal','Vendor','Quest NPC','Notable NPC','Quest','Tradeskill','Forge','Herbs','Wood','Ore'];
 const plural={'Vendor':'vendors','Quest NPC':'quest givers','Notable NPC':'notable NPCs','Quest':'quests','Tradeskill':'crafting stations','Forge':'forges','Bank':'banks','Inn':'inns','Guild':'guilds','Stable':'stables','Mob camp':'mob camps','Named mob':'named mobs','Fishing spot':'fishing spots','Secret':'secrets'};
 const nameOf=(c,n)=>n===1?c:(plural[c]||c.toLowerCase()+'s');
 let layer=null,signature='',grouped=new Set(),hooked=null;
 function eligible(pin,zoom){
  const m=pin.atlasMarker;
  if(!m||!groupable.includes(m.category)||m.id.startsWith('personal-')||m.toLevel||m.toMap||m.shape)return false;
  if(Number.isFinite(pin.atlasMinZoom)&&zoom<pin.atlasMinZoom)return false;
  // A pin whose card is open, or that has a change waiting for review, keeps its own place.
  if(pin.isPopupOpen?.()||window.atlasCommunity?.hoverState?.(m)?.rows?.length)return false;
  return true;
 }
 function clusters(entries,zoom){
  const r=Number.isFinite(custom)&&custom>0?custom:radius[mode],key=e=>mode==='stack'?'all':e.m.category;
  const pts=entries.map(pin=>({pin,m:pin.atlasMarker,p:map.project(pin.getLatLng(),zoom)}));
  for(const a of pts)a.n=pts.filter(b=>b!==a&&key(b)===key(a)&&a.p.distanceTo(b.p)<=r).length;
  // Densest spots first, so a group forms around the middle of a crowd rather than at its edge.
  pts.sort((a,b)=>b.n-a.n||String(a.m.id).localeCompare(String(b.m.id)));
  const out=[],taken=new Set();
  for(const seed of pts){
   if(taken.has(seed)||!seed.n)continue;
   const members=pts.filter(b=>!taken.has(b)&&key(b)===key(seed)&&seed.p.distanceTo(b.p)<=r);
   if(members.length<2)continue;for(const b of members)taken.add(b);
   // The group stands on its most central member, so it stays on a real building and not in the street or the sea.
   const centre=members.reduce((s,b)=>s.add(b.p),L.point(0,0)).divideBy(members.length);
   const anchor=members.reduce((best,b)=>b.p.distanceTo(centre)<best.p.distanceTo(centre)?b:best);
   out.push({members,anchor});
  }
  return out;
 }
 function kindsOf(members){const count=new Map();for(const b of members)count.set(b.m.category,(count.get(b.m.category)||0)+1);return [...count].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).map(([c,n])=>({c,n}));}
 function face(category,cls){const f=text(cls==='main'?'span':'i','',cls==='main'?'':'stack-face');f.style.setProperty('--pin',categories[category]?.[1]||'#365f59');if(cls==='main')f.append(markerSymbol({category,name:''}));return f;}
 function groupIcon(group){
  const kinds=kindsOf(group.members),wrap=text('div','','group-wrap');
  if(mode==='stack')for(const k of kinds.slice(1,3).reverse())wrap.append(face(k.c,'behind'));
  wrap.append(face(kinds[0].c,'main'),text('em',String(group.members.length),'group-count'));
  return L.divIcon({className:'pin marker-group'+(mode==='stack'&&kinds.length>1?' stacked s'+Math.min(3,kinds.length):''),html:wrap,iconSize:[25,25],iconAnchor:[12,25],popupAnchor:[0,-23]});
 }
 function title(group){const kinds=kindsOf(group.members);return kinds.length===1?group.members.length+' '+nameOf(kinds[0].c,group.members.length):group.members.length+' places';}
 function sorted(group){return group.members.slice().sort((a,b)=>kindsOf(group.members).findIndex(k=>k.c===a.m.category)-kindsOf(group.members).findIndex(k=>k.c===b.m.category)||markerTitle(a.m).localeCompare(markerTitle(b.m)));}
 function hoverCard(group){
  const n=text('div','','marker-hover group-hover'),rows=sorted(group),kinds=kindsOf(group.members);
  n.append(text('div',kinds.length===1?'Grouped':kinds.map(k=>k.n+' '+nameOf(k.c,k.n)).join(' · '),'tag'),text('h3',title(group)));
  const list=text('ul','','group-names');for(const b of rows.slice(0,8)){const li=text('li','');const who=markerSubtitle(b.m)||(b.m.category==='Tradeskill'?b.m.trade:'');li.append(text('span',markerTitle(b.m)));if(who)li.append(text('small',' · '+who));list.append(li);}
  n.append(list);if(rows.length>8)n.append(text('p','and '+(rows.length-8)+' more','hover-detail'));
  n.append(text('p','Click for the list, or zoom in to see each pin.','group-hint'));return n;
 }
 function card(group,marker){
  const n=text('div','','group-card'),rows=sorted(group),kinds=kindsOf(group.members);
  n.append(text('div',kinds.length===1?nameOf(kinds[0].c,2):'Places here','tag'),text('h3',title(group)));
  const list=text('div','','group-list');let last='';
  for(const b of rows){
   if(kinds.length>1&&b.m.category!==last){last=b.m.category;const k=kinds.find(k=>k.c===last);list.append(text('div',k.n+' '+nameOf(last,k.n),'group-sub'));}
   list.append(resultRow(markerTitle(b.m),[namedLevelText(b.m),markerSubtitle(b.m)].filter(Boolean).join(' · '),()=>{map.closePopup();choose(b.m);},b.m,'place group-row'));
  }
  n.append(list);
  const actions=text('div','','popup-actions');
  actions.append(button('Zoom in here',()=>{map.closePopup();const bounds=L.latLngBounds(group.members.map(b=>b.pin.getLatLng()));const z=Math.min(map.getMaxZoom(),Math.max(map.getZoom()+1.5,map.getBoundsZoom(bounds.pad(.6))));map.setView(bounds.getCenter(),z);},'','zoom'));
  n.append(actions);return n;
 }
 function update(fresh){
  if(typeof map==='undefined'||!map||typeof pins==='undefined')return;
  const zoom=map.getZoom(),el=map.getContainer();
  if(layer&&layer._map!==map){layer.remove();layer=null;signature='';}
  // A card opening on a grouped pin (search, a shared link) brings that pin out; closing it lets it rejoin.
  if(hooked!==map){hooked=map;map.on('popupopen popupclose',()=>setTimeout(()=>update()));}
  if(fresh){signature='';grouped=new Set();}
  const off=mode==='off'||mode==='dots'||!showPins||alignmentMode||window.atlasCommunity?.reviewOpen?.();
  // Dots: common types shrink to small dots below 60% zoom; banks, inns, stables and travel keep their pins.
  el.classList.toggle('pins-far',mode==='dots'&&zoom<config.coordinateZoom-.75&&!alignmentMode);
  if(mode==='dots')for(const pin of pins.values()){const m=pin.atlasMarker;if(!m||!minor.includes(m.category)||m.id.startsWith('personal-')||pin.atlasDotHook)continue;pin.atlasDotHook=true;const mark=()=>pin.getElement()?.classList.add('minor-pin');pin.on('add',mark);mark();}
  const groups=off?[]:clusters([...pins.values()].filter(pin=>eligible(pin,zoom)),zoom);
  const next=mode+'|'+groups.map(g=>g.members.map(b=>b.m.id).sort().join(',')).sort().join('|');
  if(next===signature&&(layer||!groups.length))return;
  signature=next;layer?.clearLayers();if(!layer&&groups.length)layer=L.layerGroup().addTo(map);
  const now=new Set(groups.flatMap(g=>g.members.map(b=>b.pin)));
  for(const pin of grouped)if(!now.has(pin)){pin.atlasGrouped=false;if(showPins&&!(Number.isFinite(pin.atlasMinZoom)&&zoom<pin.atlasMinZoom))pin.addTo(map);}
  for(const pin of now){pin.atlasGrouped=true;pin.remove();}
  grouped=now;
  for(const g of groups){
   const label=title(g)+': '+sorted(g).map(b=>markerTitle(b.m)).join(', ');
   const marker=L.marker(g.anchor.pin.getLatLng(),{icon:groupIcon(g),alt:label,keyboard:true,riseOnHover:true,zIndexOffset:200}).bindPopup(()=>card(g,marker),{autoPan:false,maxWidth:300});
   marker.on('add',()=>marker.getElement()?.setAttribute('aria-label',label));
   if(markerHover.matches)marker.bindTooltip(()=>hoverCard(g),{direction:'top',offset:[0,-23],className:'marker-card-tooltip'});
   layer.addLayer(marker);
  }
 }
 function setMode(next){mode=next;try{localStorage.setItem(storeKey,next);}catch{}for(const b of document.querySelectorAll('.group-switch button'))b.setAttribute('aria-pressed',String(b.dataset.mode===mode));map?.closePopup();update(true);if(mode!=='dots'){map?.getContainer().classList.remove('pins-far');}}
 // Preview switch, shown only on this preview branch when ?groups= is in the address or a look was picked before.
 function switcher(){
  if(document.querySelector('.group-switch')||!(params.has('groups')||mode!=='off'))return;
  const bar=text('div','','group-switch');bar.append(text('span','Crowded pins','group-switch-title'));
  for(const [id,label] of [['type','A · Same type'],['stack','B · Stacked'],['dots','C · Dots'],['off','Today']]){const b=button(label,()=>setMode(id));b.dataset.mode=id;b.setAttribute('aria-pressed',String(id===mode));bar.append(b);}
  document.body.append(bar);
 }
 window.atlasMarkerGroups={update,mode:()=>mode,setMode};
 // app.js (text, button) runs after this file, so the switch waits for the page.
 if(document.readyState==='complete')switcher();else document.addEventListener('DOMContentLoaded',switcher);
})();
