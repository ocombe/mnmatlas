// "Looking for…": one pick under the search box shows only what answers it (a class trainer, a craft, a kind
// of vendor, what vendors sell, the way around, the bank and inn) and fits the view to it. Built from this floor's pins.
(()=>{
 const travel=['Exit','Lift','Stairs','Ladder','Bridge','Teleporter','Passage','Level connection'];
 const mobs=['Mob camp','Named mob','Ambush','Trap','Respawn point'];
 const services=['Bank','Inn','Stable','Guild'];
 let pick='',builtFor='',select=null;
 const lower=v=>String(v||'').toLocaleLowerCase();
 // Quest givers: Quest NPCs and anyone ticked "Gives quests" (trainers, vendors, other folk).
 const questGiver=m=>m.category==='Quest NPC'||!!globalThis.atlasMarkerSchema?.givesQuests?.(m);
 const tradesOf=m=>m.category==='Tradeskill'?String(m.trade||'').split('/').map(t=>t.trim()).filter(Boolean):[];
 // A spell seller is a vendor, but whoever looks for their class trainer wants the class's scribe too.
 const scribeFor=(m,cls)=>m.category==='Vendor'&&vendorKindFor(m)==='Spell scribe'&&lower(m.name+' '+(m.note||'')).includes(lower(cls));
 // Supplies for a craft: "Leatherworking vendor" sits with the leatherworking trainer.
 const suppliesFor=(m,trade)=>m.category==='Vendor'&&lower(vendorKindFor(m)).startsWith(lower(trade).split(' ')[0]);
 function shows(m){
  if(!pick)return true;
  const [kind,value]=[pick.slice(0,2),pick.slice(2)];
  if(pick==='travel')return travel.includes(m.category)||!!m.toLevel||!!m.toMap||mobs.includes(m.category);
  if(pick==='services')return services.includes(m.category);
  if(pick==='quests')return questGiver(m);
  if(kind==='c:')return classesOf(m).includes(value)||scribeFor(m,value);
  if(kind==='t:')return tradesOf(m).includes(value)||suppliesFor(m,value);
  if(kind==='v:')return vendorKindFor(m)===value;
  if(kind==='s:')return m.category==='Vendor'&&Array.isArray(m.sells)&&m.sells.includes(value);
  return true;
 }
 const az=list=>[...new Set(list)].filter(Boolean).sort((a,b)=>a.localeCompare(b));
 function options(){
  const here=allMarkers().filter(m=>atLevel(m)&&!m.id.startsWith('personal-')),items=[['Everything','']];
  if(here.some(m=>travel.includes(m.category)||m.toLevel||m.toMap||mobs.includes(m.category)))items.push(['Getting around: exits, travel and mobs','travel']);
  if(here.some(m=>services.includes(m.category)))items.push(['Bank, inn and stable','services']);
  if(here.some(questGiver))items.push(['Quest givers','quests']);
  const groups=[['Class trainer',az(here.flatMap(classesOf)),'c:'],['Crafting trainer',az(here.flatMap(tradesOf)),'t:'],['Vendor',az(here.map(vendorKindFor)),'v:'],['Vendors selling',az(here.flatMap(m=>m.category==='Vendor'&&Array.isArray(m.sells)?m.sells:[])),'s:']];
  for(const [label,values,prefix] of groups)if(values.length)items.push({label,options:values.map(v=>[v,prefix+v])});
  return items;
 }
 function build(){
  const box=$('search')?.closest('.search-box');if(!box)return;
  if(!select){
   const label=text('label','','vendor-filter look-for');label.append(text('span','Looking for'));
   select=document.createElement('select');select.id='look-for-select';select.setAttribute('aria-label','Looking for');label.append(select);box.after(label);
   select.onchange=()=>choosePick(select.value);
  }
  const key=config.id+'|'+(config.levelId||'');if(key===builtFor)return;builtFor=key;
  select.replaceChildren();fillSelect(select,options());
  if(![...select.options].some(o=>o.value===pick))pick='';select.value=pick;document.body.classList.toggle('looking-for',!!pick);
  // ?look=c:Ranger opens the map with that pick.
  const asked=new URLSearchParams(location.search).get('look');if(asked&&!pick&&[...select.options].some(o=>o.value===asked))setTimeout(()=>choosePick(asked));
 }
 function choosePick(value){
  pick=value;if(select)select.value=value;document.body.classList.toggle('looking-for',!!pick);
  map.closePopup();drawMarkers();
  if(!pick)return;
  const found=visibleMarkers();
  if(!found.length){status('Nothing for that on this floor.');return;}
  const bounds=L.latLngBounds(found.map(locationOf));
  map.fitBounds(bounds.pad(.15),{maxZoom:Math.max(map.getZoom(),config.defaultView.placeZoom-.5),animate:false});
  if(compact())setPanel(false);
 }
 // Turning a type on or off, or picking a vendor kind, goes back to the usual filters.
 function clear(){if(!pick)return;pick='';if(select)select.value='';document.body.classList.remove('looking-for');}
 document.addEventListener('click',e=>{if(e.target.closest?.('#categories button,#all-categories,#hide-pins'))clear();},true);
 document.addEventListener('change',e=>{if(e.target.id==='vendor-filter-select')clear();},true);
 window.atlasLookFor={shows,active:()=>!!pick,build,set:choosePick,clear};
})();
