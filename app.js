/* Static atlas. Registry and feature coordinates are local, native map pixels. */
'use strict';
const $=id=>document.getElementById(id);
const text=(tag,value,cls)=>{const n=document.createElement(tag);n.textContent=value;if(cls)n.className=cls;return n;};
const baseCategories={'Bank':['▣','#916c30'],'Inn':['☾','#9a543a'],'Stable':['♞','#665e3e'],'Shady merchant':['♧','#785268'],'Tradeskill':['⚒','#385f60'],'Class trainer':['◈','#4e4668'],'Personal':['✧','#a04438']};
// Additional marker types; a map's own extraCategories override these colours and glyphs.
const noteCategories={'Quest':['!','#b5861f'],'Mob camp':['⚔','#7a3328'],'Named mob':['☠','#46404f'],'Vendor':['◇','#876036'],'Herbs':['✿','#4f7a3a'],'Wood':['♣','#6b4f2e'],'Ore':['⛏','#55606b']};
let categories={...baseCategories},allCategories={...baseCategories,...noteCategories};
const mobileLayout=matchMedia('(max-width: 760px)');
let embedded=false;try{embedded=window.self!==window.top;}catch{embedded=true;}
const embedParam=new URLSearchParams(location.search).get('embed');
const isEmbed=embedded||embedParam==='1'||embedParam==='map';
// ?embed=map shows one map on its own (for wiki pages): no map picker, search menu or editing; other maps open the full atlas in a new tab.
const singleMap=isEmbed&&embedParam==='map';
document.body.classList.toggle('embed',isEmbed);document.body.classList.toggle('single-map',singleMap);
// Each map lives at its own address (<site>/<map-id>/); older ?map= links still open and are rewritten.
const siteRoot=new URL('./',document.currentScript?.src||document.baseURI);
// The entry view (the world map) lives at the site root; every other map at /<map-id>/.
function mapAddress(id){return registry?.maps.find(c=>c.id===id)?.entry?new URL(siteRoot.href):new URL(encodeURIComponent(id)+'/',siteRoot);}
// The address another map opens at from this page: inside the same embed, or the full atlas from a single-map embed.
function mapLink(id){const url=mapAddress(id);if(embedParam!==null&&!singleMap)url.searchParams.set('embed',embedParam);return url;}
function goToMap(id,url=mapLink(id)){if(singleMap){window.open(url.href,'_blank','noopener');return;}history.pushState({map:id},'',url);ownView=true;loadMap(id,new URL(url));}
function mapIdOf(url){const first=url.pathname.startsWith(siteRoot.pathname)?url.pathname.slice(siteRoot.pathname.length).split('/')[0].toLowerCase():'';return registry.maps.some(c=>c.id===first)?first:url.searchParams.get('map')||registry.defaultMap;}
const compact=()=>isEmbed||mobileLayout.matches;
let disposeZones=()=>{},disposeBackdrop=()=>{};
let registry,map,config,originals=[],personal=[],pins=new Map(),placeIndex=[],hiddenController;
let enabled=new Set(Object.keys(categories)),showPins=true,draftPin=null,draft=null,statusTimer;
let alignmentMode=false,editSnapshot=null,selectedAlignmentId=null,selectedAlignmentKind='marker',alignmentPositions={},alignmentLabelPositions={},publishedPositions=new Map(),publishedLabelPositions=new Map();
let desktopPanelOpen=true,disposeLabels=()=>{},loadSerial=0,loading=false,applyingView=false,urlTimer,activePlace=null,sharedPin=null;
const atLevel=row=>!config.levels||!row.level||row.level===config.levelId;
const validLevel=value=>value===undefined||!!config.levels?.some(l=>l.id===value);
const storageKey=kind=>`mnmaps-${config.id}-${kind}-${config.tileRevision}`;
function migratePreviousStorage(){
 if(!config.migratePreviousStorage)return;
 try{
  // Reuse a single previous edition's local drafts; never overwrite current data.
  const kinds=['notes','alignment','label-alignment','hidden-areas','place-names'];
  const savedKeys=Object.keys(localStorage);
  for(const kind of kinds){
   const key=storageKey(kind),prefix=`mnmaps-${config.id}-${kind}-`;
   if(localStorage.getItem(key)!==null)continue;
   const candidates=savedKeys.filter(k=>k.startsWith(prefix)&&k!==key&&k!==prefix+'v1'&&!k.startsWith(prefix+'previous-'));
   if(candidates.length!==1)continue;
   const value=localStorage.getItem(candidates[0]);
   if(kind==='notes'){const rows=JSON.parse(value);if(!Array.isArray(rows)||rows.length>2000||!rows.every(valid))continue;}
   else if(kind==='alignment'||kind==='label-alignment'){
    const rows=JSON.parse(value),positions=kind==='alignment'?publishedPositions:publishedLabelPositions;
    if(!rows||Array.isArray(rows)||typeof rows!=='object'||!Object.entries(rows).every(([id,p])=>positions.has(id)&&Array.isArray(p)&&p.length===2&&bounded(...p,config.minZoom)))continue;
   }else if(value!=='true'&&value!=='false')continue;
   localStorage.setItem(key,value);
  }
 }catch{status('Previous local settings could not be copied. Your saved data is still kept in this browser.',true);}
}
const slug=value=>value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
function status(message,sticky=false){clearTimeout(statusTimer);$('status').textContent=message;$('status').hidden=false;if(!sticky)statusTimer=setTimeout(()=>$('status').hidden=true,4500);}
function locationOf(m){return map.unproject([m.x,m.y],config.coordinateZoom);}
function pixelsOf(latlng){const p=map.project(latlng,config.coordinateZoom);return [Math.round(p.x),Math.round(p.y)];}
function bounded(x,y,z=map.getZoom()){return Number.isFinite(x)&&Number.isFinite(y)&&Number.isFinite(z)&&x>=0&&y>=0&&x<=config.width&&y<=config.height&&z>=config.minZoom&&z<=config.maxZoom;}
function valid(m){return m&&validLevel(m.level)&&(m.toMap===undefined||typeof m.toMap==='string'&&!!registry?.maps.some(c=>c.id===m.toMap))&&typeof m.id==='string'&&/^personal-[a-zA-Z0-9-]{1,80}$/.test(m.id)&&typeof m.name==='string'&&m.name.trim()&&m.name.length<=100&&typeof m.note==='string'&&m.note.length<=2000&&Object.hasOwn(categories,m.category)&&[undefined,'label','exit'].includes(m.noteType)&&(m.arrow===undefined||Object.hasOwn(exitArrows,m.arrow))&&(m.trade===undefined||Object.hasOwn(tradePaths,m.trade))&&(m.color===undefined||Object.values(pinColours).includes(m.color))&&Number.isFinite(m.x)&&m.x>=0&&m.x<=config.width&&Number.isFinite(m.y)&&m.y>=0&&m.y<=config.height;}
function persist(next){try{localStorage.setItem(storageKey('notes'),JSON.stringify(next));personal=next;window.dispatchEvent(new CustomEvent('atlas:notes'));return true;}catch{status('Your browser could not save this change. Free some storage and try again.',true);return false;}}
function download(data,name){const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'})),a=text('a','');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function allMarkers(){return [...originals,...personal];}
function visibleMarkers(){const terms=$('search').value.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);return allMarkers().filter(m=>atLevel(m)&&enabled.has(m.category)&&terms.every(t=>(m.name+' '+m.category+' '+m.note).toLocaleLowerCase().includes(t)));}
function refreshSearch(){$('clear-search').hidden=!$('search').value;drawMarkers();}
function copyButton(place){const b=text('button','Copy link','copy-place');b.type='button';b.onclick=()=>copyLink(place);return b;}
function switchAt(m){const destination=originals.find(row=>row.id===m.toMarker);if(destination)changeLevel(m.toLevel,{...destination,kind:'marker',quiet:m.switchOnClick&&!alignmentMode});}
// Arriving through a floor link: no popup, just a short glow on the landing marker.
function flashPin(id){const el=pins.get(id)?.getElement();if(!el)return;el.classList.remove('just-arrived');void el.offsetWidth;el.classList.add('just-arrived');setTimeout(()=>el.classList.remove('just-arrived'),1700);}
const noteKind=m=>m.noteType==='label'?'Area label':m.noteType==='exit'?'Zone exit':m.category;
function popup(m){const n=text('div','');n.append(text('div',noteKind(m)+(m.id.startsWith('personal-')?' · Your note':''),'tag'),text('h3',m.name));if(m.note)n.append(text('p',m.note));n.append(copyButton(m));if(m.toLevel){const b=text('button',m.direction==='up'?'Go up':'Go down','level-link');b.type='button';b.onclick=()=>switchAt(m);n.append(b);}const leads=m.noteType==='exit'&&!alignmentMode&&registry.maps.find(c=>c.id===m.toMap);if(leads){const go=text('button','Go to '+leads.title,'level-link');go.type='button';go.onclick=()=>openMap(leads.id);n.append(go);}
 if(m.id.startsWith('personal-')){const edit=text('button','Edit note');edit.onclick=()=>openEditor(m);const del=text('button','Delete','popup-delete');del.type='button';del.onclick=()=>confirmDelete(m);n.append(edit,del);}
 if(alignmentPositions[m.id]){n.append(text('p','Position moved in this browser.','moved-note'));if(alignmentMode){const reset=text('button','Reset position');reset.type='button';reset.onclick=()=>resetMarker(m.id);n.append(reset);}}
 if(m.community&&!m.id.startsWith('personal-'))n.append(text('p','Community contribution','community-note'));
 if(!singleMap)window.atlasCommunity?.popup(m,n);return n;}
function labelEditPopup(row){
 const n=text('div','');n.append(text('div','Place name','tag'),text('h3',row.name));
 if(alignmentLabelPositions[row.id]){n.append(text('p','Position moved in this browser.','moved-note'));const reset=text('button','Reset position');reset.type='button';reset.onclick=()=>resetLabel(row.id);n.append(reset);}
 window.atlasCommunity?.placePopup?.({...row,kind:'label'},n);
 L.popup({autoPan:false,offset:[0,-8]}).setLatLng(locationOf(row)).setContent(n).openOn(map);
}
function placePopup(p){const n=text('div','');n.append(text('div',p.kind==='hidden'?'Hidden area':'Place name','tag'),text('h3',p.name));if(p.note)n.append(text('p',p.note));if(p.community)n.append(text('p','Community contribution','community-note'));n.append(copyButton(p));if(!singleMap)window.atlasCommunity?.placePopup?.(p,n);return n;}
function choose(m){
 if(alignmentMode&&!m.id.startsWith('personal-'))selectAlignment(m,'marker');
 if(!enabled.has(m.category)||!pins.has(m.id)||!showPins){enabled.add(m.category);showPins=true;$('search').value='';updateCategoryButtons();drawMarkers();}
 openPlace({...m,kind:'marker'},Math.max(map.getZoom(),config.defaultView.placeZoom));
}
function openPlace(p,zoom=config.defaultView.placeZoom){
 if(!atLevel(p)){changeLevel(p.level,p,zoom);return;}
 if(alignmentMode&&p.kind==='label')selectAlignment(p,'label');
 sharedPin?.remove();sharedPin=null;
 applyingView=true;activePlace=p;
 map.setView(locationOf(p),zoom,{animate:false});
 if(p.kind==='marker'){const pin=pins.get(p.id);if(pin&&!map.hasLayer(pin))pin.addTo(map);pin?.openPopup();}
 else {if(p.kind==='hidden')hiddenController?.show(p.id);L.popup({autoPan:false}).setLatLng(locationOf(p)).setContent(placePopup(p)).openOn(map);}
 activePlace=p;applyingView=false;if(compact())setPanel(false);scheduleUrl();
}
function pinIcon(m){
 // Personal area labels and zone exits are lettering, drawn like the map's own names.
 if(m.noteType){
  // Personal zone exits are the same signboard as the map's own exits.
  const face=text('span',m.noteType==='exit'?'':m.name,'personal-label '+(m.noteType==='exit'?'exit':'district'));
  if(m.noteType==='exit')face.append(text('b',exitArrows[m.arrow]||'→','exit-arrow'),text('span',' '+m.name,'exit-name'));
  return L.divIcon({className:'personal-label-anchor',html:face,iconSize:[0,0],iconAnchor:[0,0],popupAnchor:[0,-14]});
 }
 if(m.category==='Class trainer')return trainerIcon(m);
 const face=text('span','');face.style.setProperty('--pin',m.color||categories[m.category][1]);face.append(markerSymbol(m));
 // Ways up and down (ladders, stairs, lifts, passages) are round seals centred on the spot, like the exit signs' arrows.
 if(m.toLevel||['Ladder','Stairs','Lift','Passage','Level connection'].includes(m.category))return L.divIcon({className:'pin level-pin',html:face,iconSize:[26,26],iconAnchor:[13,13],popupAnchor:[0,-13]});
 return L.divIcon({className:'pin',html:face,iconSize:[25,25],iconAnchor:[12,25],popupAnchor:[0,-23]});
}
function openMap(id){goToMap(id);}
function drawMarkers(){
 for(const pin of pins.values())pin.remove();pins.clear();const list=$('results');list.replaceChildren();
 const matches=visibleMarkers();$('count').textContent=matches.length+' places';
 for(const m of matches){
  const own=m.id.startsWith('personal-');
  const pin=L.marker(locationOf(m),{icon:pinIcon(m),alt:m.name,keyboard:true,riseOnHover:true,draggable:alignmentMode}).bindPopup(popup(m),{autoPan:false});
  pin.atlasMinZoom=m.minZoom;
  // The hover tooltip shows the name; an aria-label (not a title) keeps it accessible without a second browser tooltip.
  pin.on('add',()=>pin.getElement()?.setAttribute('aria-label',m.name));
  // A marker that stands for another published map (a dungeon entrance on the world map) opens that map.
  // Personal zone exits keep their popup (Go to, Edit note) instead.
  const opens=!own&&!alignmentMode&&typeof m.toMap==='string'&&registry.maps.find(c=>c.id===m.toMap);
  pin.on('click',()=>opens?openMap(opens.id):m.switchOnClick&&!alignmentMode?switchAt(m):choose(m));if(opens)pin.unbindPopup();
  // A floor link switches floor straight away; its details stay in the search menu list.
  if(m.switchOnClick&&!alignmentMode)pin.unbindPopup();
  if(alignmentMode){pin.on('dragstart',()=>{map.closePopup();if(!own)selectAlignment(m,'marker');});pin.on('dragend',()=>(own?movePersonal:moveAlignedMarker)(m.id,pin.getLatLng()));}
  if(!m.noteType)pin.bindTooltip(()=>text('span',m.name),{direction:'top',offset:[0,-23]});if(showPins)pin.addTo(map);pins.set(m.id,pin);
  const b=text('button','','place'),glyph=text('span','','symbol');glyph.append(markerSymbol(m));b.append(glyph);
  const label=text('span','');label.append(text('strong',m.name),text('small',noteKind(m)+(m.id.startsWith('personal-')?' · Personal note':'')));b.append(label);b.onclick=()=>opens?openMap(opens.id):choose(m);list.append(b);
 }
 // Place names and hidden areas can be found even when their visual layer hides.
 const terms=$('search').value.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
 // A search also lists matching markers from the other levels; choosing one opens its level at the marker.
 const otherLevel=p=>config.levels&&p.level&&!atLevel(p)?' · '+(config.levels.find(l=>l.id===p.level)?.title||p.level):'';
 if(terms.length&&config.levels){for(const m of allMarkers().filter(m=>!atLevel(m)&&enabled.has(m.category)&&terms.every(t=>(m.name+' '+m.category+' '+m.note).toLocaleLowerCase().includes(t)))){const b=text('button','','place'),glyph=text('span','','symbol');glyph.append(markerSymbol(m));b.append(glyph);const label=text('span','');label.append(text('strong',m.name),text('small',noteKind(m)+otherLevel(m)));b.append(label);b.onclick=()=>openPlace({...m,kind:'marker'},Math.max(map.getZoom(),config.defaultView.placeZoom));list.append(b);}}
 if(terms.length){for(const p of placeIndex.filter(p=>p.kind!=='marker'&&terms.every(t=>p.name.toLocaleLowerCase().includes(t)))){const b=text('button','','place');const label=text('span','');label.append(text('strong',p.name),text('small',(p.kind==='hidden'?'Hidden area':'Place name')+otherLevel(p)));b.append(label);b.onclick=()=>openPlace(p,Math.max(config.defaultView.placeZoom,p.minZoom||0));list.append(b);}}
 $('count').textContent=list.childElementCount+' places';
 if(!list.childElementCount)list.append(text('p','No places found. Try another name or enable more categories.','empty'));
 schedulePlaceLabels();
}
function setPanel(open){if(!compact())desktopPanelOpen=open;$('journal').classList.toggle('closed',!open);$('toggle-panel').setAttribute('aria-expanded',String(open));map?.invalidateSize({pan:true,animate:false});}
function updateCategoryButtons(){for(const b of $('categories').children)b.setAttribute('aria-pressed',String(enabled.has(b.dataset.category)));$('hide-pins').setAttribute('aria-pressed',String(showPins));}
function cancelPlacement(){if(draftPin)$('status').hidden=true;draftPin?.remove();draftPin=null;document.body.classList.remove('placing');$('cancel-place').hidden=true;}
// New notes start at the centre of the view; dropping the pin opens the editor there.
function startPlacement(){
 map.closePopup();cancelPlacement();
 const [cx,cy]=pixelsOf(map.getCenter()),start={x:Math.max(0,Math.min(config.width,cx)),y:Math.max(0,Math.min(config.height,cy)),category:'Personal',name:''};
 draftPin=L.marker(locationOf(start),{icon:pinIcon(start),alt:'New personal note',keyboard:true,draggable:true,zIndexOffset:1000}).addTo(map);
 draftPin.getElement()?.classList.add('draft-pin');
 const drop=()=>{const [x,y]=pixelsOf(draftPin.getLatLng());if(!bounded(x,y)){status('Drag the note inside '+config.title+'.',true);return;}openEditor({id:'personal-'+crypto.randomUUID(),name:'',note:'',category:'Personal',x,y,...(config.levels?{level:config.levelId}:{})});};
 draftPin.on('dragend',drop);draftPin.on('click',drop);
 document.body.classList.add('placing');$('cancel-place').hidden=false;status('Drag the new note to its place, then let go.',true);if(compact())setPanel(false);
}
// Edit mode keeps moves in memory: Done saves them, Cancel puts back the positions from when editing began.
function movePersonal(id,latlng){
 const point=pixelsOf(latlng);
 if(bounded(...point))personal=personal.map(p=>p.id===id?{...p,x:point[0],y:point[1]}:p);else status('Choose a point inside the illustration.');
 buildPlaceIndex();drawMarkers();
}
function applyOverrides(){
 for(const m of originals)[m.x,m.y]=alignmentPositions[m.id]||publishedPositions.get(m.id);
 for(const row of labelData.labels)[row.x,row.y]=alignmentLabelPositions[row.id]||publishedLabelPositions.get(row.id);
}
function setEditing(on){
 alignmentMode=on;selectedAlignmentId=null;selectedAlignmentKind='marker';document.body.classList.toggle('aligning',on);
 $('edit-bar').hidden=!on;$('alignment-tools').hidden=!on;$('edit-positions').hidden=on;
 const toggle=$('edit-toggle');toggle.title=on?'Finish editing':'Edit';toggle.setAttribute('aria-label',toggle.title);toggle.classList.toggle('active',on);
 map.closePopup();disposeLabels();disposeLabels=setupPlaceLabels(labelData);drawMarkers();updateAlignmentStatus();
}
function enterEdit(){
 if(alignmentMode||!map||singleMap)return;cancelPlacement();
 editSnapshot={positions:{...alignmentPositions},labels:{...alignmentLabelPositions},personal:personal.map(p=>({...p}))};
 setEditing(true);if(compact())setPanel(false);
}
function saveEdits(){
 try{localStorage.setItem(storageKey('alignment'),JSON.stringify(alignmentPositions));localStorage.setItem(storageKey('label-alignment'),JSON.stringify(alignmentLabelPositions));}
 catch{status('Your browser could not save these positions. Free some storage and try again.',true);return false;}
 return persist(personal);
}
// A note's text saved while editing survives Cancel; only its unsaved move is undone.
function keepInSnapshot(m){if(!editSnapshot)return;const before=editSnapshot.personal.find(p=>p.id===m.id);editSnapshot.personal=[...editSnapshot.personal.filter(p=>p.id!==m.id),before?{...m,x:before.x,y:before.y}:m];}
// Leaving Edit with the pen asks before saving moves, rather than saving them silently.
function editChanged(){
 if(!editSnapshot)return false;const spots=list=>JSON.stringify(list.map(p=>[p.id,p.x,p.y]).sort());
 return JSON.stringify(alignmentPositions)!==JSON.stringify(editSnapshot.positions)||JSON.stringify(alignmentLabelPositions)!==JSON.stringify(editSnapshot.labels)||spots(personal)!==spots(editSnapshot.personal);
}
function deleteNote(id){
 if(!persist(personal.filter(p=>p.id!==id)))return false;
 if(editSnapshot)editSnapshot.personal=editSnapshot.personal.filter(p=>p.id!==id);
 map.closePopup();setupCategoryControls();buildPlaceIndex();drawMarkers();status('Personal note deleted.');return true;
}
// A note can be deleted straight from its popup, after a small confirmation.
function confirmDelete(m){
 let d=$('delete-confirm');if(!d){d=document.createElement('dialog');d.id='delete-confirm';d.setAttribute('aria-labelledby','delete-confirm-title');document.body.append(d);}
 const title=text('h2','Delete this note?');title.id='delete-confirm-title';const actions=text('div','','dialog-actions');
 const act=(label,fn,cls)=>{const b=text('button',label,cls);b.type='button';b.onclick=()=>{d.close();fn();};return b;};
 actions.append(act('Cancel',()=>{}),act('Delete',()=>deleteNote(m.id),'danger'));
 d.replaceChildren(title,text('p','"'+m.name+'" will be removed from your notes'+(document.querySelector('.community-who')?' on every device you sync.':'.')),actions);d.showModal();
}
function askFinishEdit(){
 if(!editChanged()){finishEdit(true);return;}
 let d=$('edit-confirm');if(!d){d=document.createElement('dialog');d.id='edit-confirm';d.setAttribute('aria-labelledby','edit-confirm-title');document.body.append(d);}
 const title=text('h2','Save your changes?');title.id='edit-confirm-title';const actions=text('div','','dialog-actions');
 const act=(label,fn,cls)=>{const b=text('button',label,cls);b.type='button';b.onclick=()=>{d.close();fn();};return b;};
 actions.append(act('Keep editing',()=>{}),act('Discard',()=>finishEdit(false)),act('Save',()=>finishEdit(true),'primary'));
 d.replaceChildren(title,text('p','You moved markers or names while editing. Save keeps the new positions in this browser; Discard puts everything back.'),actions);d.showModal();
}
function finishEdit(save){
 if(!alignmentMode)return;
 if(save){if(!saveEdits())return;}
 else{alignmentPositions=editSnapshot.positions;alignmentLabelPositions=editSnapshot.labels;applyOverrides();persist(editSnapshot.personal);}
 editSnapshot=null;buildPlaceIndex();setEditing(false);status(save?'Changes saved in this browser.':'Changes cancelled.');
 if(save)window.dispatchEvent(new CustomEvent('atlas:positions'));
 window.dispatchEvent(new CustomEvent('atlas:edit-ended'));
}
function noteTypeValue(){return document.querySelector('input[name="note-type"]:checked')?.value||'marker';}
function updateEditorFields(){const type=noteTypeValue();$('default-colour').style.setProperty('--swatch',categories[$('category').value]?.[1]||'#a04438');$('marker-fields').hidden=type!=='marker';$('trade-field').hidden=type!=='marker'||$('category').value!=='Tradeskill';$('exit-fields').hidden=type!=='exit';$('exit-target-field').hidden=type!=='exit';}
function openEditor(m){draft={...m};$('editor-title').textContent=personal.some(p=>p.id===m.id)?'Your discovery':'A new discovery';$('name').value=m.name;$('category').value=m.category;$('note').value=m.note;
 for(const r of document.querySelectorAll('input[name="note-type"]'))r.checked=r.value===(m.noteType||'marker');$('trade').value=m.trade||'';
 for(const r of document.querySelectorAll('input[name="exit-arrow"]'))r.checked=r.value===(m.arrow||'north');
 for(const r of document.querySelectorAll('input[name="pin-colour"]'))r.checked=r.value===(m.color||'');
 {const target=$('exit-target');target.replaceChildren(Object.assign(text('option','Not set'),{value:''}));for(const c of registry.maps.filter(c=>c.id!==config.id).sort((a,b)=>a.title.localeCompare(b.title))){const o=text('option',c.title);o.value=c.id;target.append(o);}target.value=m.toMap||'';}
updateEditorFields();$('delete').hidden=!personal.some(p=>p.id===m.id);$('editor').showModal();$('name').focus();}
function closeEditor(){draft=null;$('editor').close();}
function selectAlignment(row,kind){selectedAlignmentId=row.id;selectedAlignmentKind=kind;schedulePlaceLabels();}
function updateAlignmentStatus(){$('alignment-count').textContent=`${Object.keys(alignmentPositions).length} of ${originals.length} markers · ${Object.keys(alignmentLabelPositions).length} of ${labelData.labels.length} place names moved`;}
function moveAlignedLabel(id,latlng){
 const row=labelData.labels.find(r=>r.id===id);if(!row)return;
 const point=pixelsOf(latlng);
 if(!bounded(...point)){labelPins.get(id)?.setLatLng(locationOf(row));status('Choose a point inside the illustration.');return;}
 alignmentLabelPositions={...alignmentLabelPositions,[id]:point};
 [row.x,row.y]=point;labelPins.get(id)?.setLatLng(locationOf(row));selectAlignment(row,'label');map.closePopup();updateAlignmentStatus();buildPlaceIndex();schedulePlaceLabels();scheduleUrl();
}
function moveAlignedMarker(id,latlng){
 const point=pixelsOf(latlng),m=originals.find(m=>m.id===id);if(!m)return;
 if(bounded(...point)){alignmentPositions={...alignmentPositions,[id]:point};[m.x,m.y]=point;}else status('Choose a point inside the illustration.');
 updateAlignmentStatus();buildPlaceIndex();drawMarkers();scheduleUrl();
}
function resetMarker(id){
 const m=originals.find(m=>m.id===id);if(!m)return;
 const next={...alignmentPositions};delete next[id];alignmentPositions=next;[m.x,m.y]=publishedPositions.get(id);
 map.closePopup();updateAlignmentStatus();buildPlaceIndex();drawMarkers();status(`${m.name} is back at its published position.`);
}
function resetLabel(id){
 const row=labelData.labels.find(r=>r.id===id);if(!row)return;
 const next={...alignmentLabelPositions};delete next[id];alignmentLabelPositions=next;[row.x,row.y]=publishedLabelPositions.get(id);
 labelPins.get(id)?.setLatLng(locationOf(row));map.closePopup();updateAlignmentStatus();buildPlaceIndex();schedulePlaceLabels();status(`${row.name} is back at its published position.`);
}
function exportAlignment(){download({version:1,map:config.id,tileRevision:config.tileRevision,positions:alignmentPositions,labels:alignmentLabelPositions},`${config.id}-alignment.json`);}
function restoreStorage(){
 migratePreviousStorage();
 personal=[];alignmentPositions={};alignmentLabelPositions={};selectedAlignmentId=null;selectedAlignmentKind='marker';$('legacy-notes').hidden=true;
 try{const saved=JSON.parse(localStorage.getItem(storageKey('notes'))||'[]');if(!Array.isArray(saved)||saved.length>2000||!saved.every(valid))throw Error();personal=saved.map(m=>config.levels&&!m.level?{...m,level:config.defaultLevel}:m);}catch{status('Saved notes could not be read. Import a valid backup to recover them.',true);}
 // Positions moved in this browser apply everywhere; entries for markers no longer published are dropped.
 const readMoves=(kind,published)=>{try{const saved=JSON.parse(localStorage.getItem(storageKey(kind))||'{}');if(!saved||Array.isArray(saved)||typeof saved!=='object')return {};return Object.fromEntries(Object.entries(saved).filter(([id,p])=>published.has(id)&&Array.isArray(p)&&p.length===2&&bounded(...p,config.minZoom)));}catch{return {};}};
 alignmentPositions=readMoves('alignment',publishedPositions);alignmentLabelPositions=readMoves('label-alignment',publishedLabelPositions);applyOverrides();
 const legacy=config.legacyStorage;
 if(legacy?.notesKey){try{const saved=JSON.parse(localStorage.getItem(legacy.notesKey)||'[]');if(Array.isArray(saved)&&saved.length){$('legacy-notes').hidden=false;$('legacy-export').onclick=()=>download({version:1,map:config.id,tileRevision:legacy.notesRevision,markers:saved},`${config.id}-${legacy.notesRevision}-field-notes.json`);}}catch{}}
}
let labelData={labels:[],trainers:[]},hiddenData={areas:[],routes:[]};
function buildPlaceIndex(){
 placeIndex=[...allMarkers().map(m=>({...m,kind:'marker'})),...labelData.labels.map(p=>({...p,note:p.note||'',kind:'label'}))];
 for(const a of [...hiddenData.areas,...(hiddenData.additionalAreas||[])]){
  const points=a.rings.flat();if(!points.length)continue;
  const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);
  placeIndex.push({id:a.id,name:a.name,slug:a.slug,level:a.level,x:(Math.min(...xs)+Math.max(...xs))/2,y:(Math.min(...ys)+Math.max(...ys))/2,kind:'hidden',note:a.approximate?'Approximate outline.':''});
 }
 for(const p of hiddenData.destinations||[])placeIndex.push({...p,x:p.xy[0],y:p.xy[1],kind:'hidden'});
}
function findPlace(value){buildPlaceIndex();const p=placeIndex.find(p=>p.id===value)||placeIndex.find(p=>p.slug===value||slug(p.name)===value);return p?.labelId?placeIndex.find(row=>row.id===p.labelId)||p:p;}
function viewUrl(place=activePlace){
 const url=mapAddress(config.id),c=map.project(map.getCenter(),config.coordinateZoom);url.search=location.search;url.searchParams.delete('map');url.searchParams.delete('align');
 if(config.levels)url.searchParams.set('level',config.levelId);else url.searchParams.delete('level');
 url.searchParams.set('x',String(Math.round(Math.max(0,Math.min(config.width,c.x))*100)/100));url.searchParams.set('y',String(Math.round(Math.max(0,Math.min(config.height,c.y))*100)/100));url.searchParams.set('z',String(Math.round(map.getZoom()*100)/100));
 if(place&&!place.id.startsWith('personal-'))url.searchParams.set('place',place.id);else url.searchParams.delete('place');
 return url;
}
function syncUrl(){if(!map||loading)return;const url=viewUrl();history.replaceState({map:config.id},'',url);document.querySelector('meta[property="og:url"]').content=url.href;}
function scheduleUrl(){clearTimeout(urlTimer);if(!loading)urlTimer=setTimeout(syncUrl,250);}
async function copyLink(place){
 const url=viewUrl(place===undefined?activePlace:place);
 if(place){url.searchParams.set('x',String(place.x));url.searchParams.set('y',String(place.y));url.searchParams.set('z',String(Math.max(map.getZoom(),config.defaultView.placeZoom)));}
 // Alignment drafts are local editing state, not part of a shared destination; a single-map embed shares the full atlas.
 url.searchParams.delete('align');if(singleMap)url.searchParams.delete('embed');
 try{const policy=document.permissionsPolicy||document.featurePolicy;if(!navigator.clipboard?.writeText||(policy&&!policy.allowsFeature('clipboard-write')))throw Error('Clipboard unavailable');await navigator.clipboard.writeText(url.href);status('Link copied. Personal notes are not included.');}
 catch{$('link-value').value=url.href;$('link-dialog').showModal();$('link-value').select();}
}
// A single-map embed links back to the same view in the full atlas, in a new tab.
function openInAtlas(){const url=viewUrl();url.searchParams.delete('embed');window.open(url.href,'_blank','noopener');}
// The Embed dialog writes an iframe that shows this map on its own, at the current level and selected place when ticked.
let embedPlace=null;
// Ampersands stay plain so the address reads (and pastes into wiki templates) as it is.
const htmlAttr=value=>String(value).replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
function embedAddress(){
 const url=mapAddress(config.id);url.searchParams.set('embed','map');
 if(config.levels&&$('embed-level').checked)url.searchParams.set('level',config.levelId);
 if(embedPlace&&$('embed-place').checked)url.searchParams.set('place',embedPlace.id);
 return url;
}
function updateEmbed(){
 const url=embedAddress();$('embed-address').value=url.href;$('embed-preview').href=url.href;
 $('embed-code').value=`<iframe src="${htmlAttr(url.href)}" title="${htmlAttr(config.title+' · MnM Atlas')}" width="100%" height="${$('embed-height').value}" style="border:0" loading="lazy" allow="fullscreen; clipboard-write" allowfullscreen></iframe>`;
}
function openEmbed(){
 embedPlace=activePlace&&!activePlace.id.startsWith('personal-')?activePlace:null;
 $('embed-map-name').textContent=config.title;
 $('embed-level-row').hidden=!config.levels;$('embed-level-name').textContent=config.levelTitle||'';$('embed-level').checked=true;
 $('embed-place-row').hidden=!embedPlace;$('embed-place-name').textContent=embedPlace?.name||'';$('embed-place').checked=true;
 updateEmbed();$('embed-dialog').showModal();$('embed-code').select();
}
async function copyEmbed(field){
 try{const policy=document.permissionsPolicy||document.featurePolicy;if(!navigator.clipboard?.writeText||(policy&&!policy.allowsFeature('clipboard-write')))throw Error('Clipboard unavailable');await navigator.clipboard.writeText($(field).value);status(field==='embed-code'?'Embed code copied.':'Map address copied.');}
 catch{$(field).focus();$(field).select();status('Press Ctrl+C (or ⌘C) to copy.');}
}
// In a single-map embed the scroll wheel scrolls the page until the map is clicked, and again once the pointer leaves it.
function wheelAfterClick(){
 if(!singleMap)return;map.scrollWheelZoom.disable();let hinted=false;const box=map.getContainer();
 box.addEventListener('pointerdown',()=>map.scrollWheelZoom.enable());box.addEventListener('pointerleave',()=>map.scrollWheelZoom.disable());
 box.addEventListener('wheel',()=>{if(!map.scrollWheelZoom.enabled()&&!hinted){hinted=true;status('Click the map, then scroll to zoom.');}},{passive:true});
}
function applyLocation(url){
 applyingView=true;activePlace=null;sharedPin?.remove();sharedPin=null;map.closePopup();
 const q=url.searchParams,wanted=q.get('place');let warning='';
 const values=['x','y','z'].map(k=>q.has(k)&&q.get(k).trim()!==''?Number(q.get(k)):NaN);
 if(wanted){const p=findPlace(wanted);if(p){if(p.kind==='marker'){enabled.add(p.category);showPins=true;$('search').value='';updateCategoryButtons();drawMarkers();}const z=Number.isFinite(values[2])&&values[2]>=config.minZoom&&values[2]<=config.maxZoom?values[2]:config.defaultView.placeZoom;openPlace(p,z);applyingView=false;return;}warning='That place was not found on this map.';}
 if(bounded(...values)){map.setView(locationOf({x:values[0],y:values[1]}),values[2],{animate:false});if(!ownView)sharedPin=L.circleMarker(locationOf({x:values[0],y:values[1]}),{radius:6,color:'rgb(113,61,25)',weight:2,fillColor:'#fff1cb',fillOpacity:.8,interactive:false}).addTo(map);}
 else{
  const legacy=('#'+(url.href.split('#')[1]||'')).match(/^#view=([\d.]+),(-?[\d.]+),(-?[\d.]+)$/),p=legacy?.slice(1).map(Number);
  if(p&&bounded(p[1],p[2],p[0]))map.setView(locationOf({x:p[1],y:p[2]}),p[0],{animate:false});
  else{fitMap();if(['x','y','z'].some(k=>q.has(k)))warning='Invalid map coordinates; showing the default view.';}
 }
 applyingView=false;if(warning)status(warning);scheduleUrl();
}
function fitMap(){activePlace=null;map.invalidateSize({pan:false});limitZoomOut();const d=config.defaultView;if(d.mode==='point')map.setView(locationOf(d),d.z,{animate:false});else map.setView(mapBounds().getCenter(),fitZoom(),{animate:false});}
// The whole map fits the view at this zoom (unsnapped, so it fills the view exactly); zooming out stops there.
function fitZoom(){const f=config.frame||{width:config.width,height:config.height},pad=2*(config.defaultView.padding||0),size=map.getSize();if(!size.x||!size.y)return config.minZoom;return Math.min(config.maxZoom,Math.max(config.minZoom,map.getScaleZoom(Math.min((size.x-pad)/f.width,(size.y-pad)/f.height),config.coordinateZoom)));}
function limitZoomOut(){const atFit=map.getZoom()<=map.getMinZoom()+.01;map.setMinZoom(fitZoom());if(atFit&&map.getZoom()>map.getMinZoom())map.setView(mapBounds().getCenter(),map.getMinZoom(),{animate:false});}
// A shared x/y link gets a small spot marker, but not when the view comes from this page itself (level switch, reload, back/forward).
let ownView=['reload','back_forward'].includes(performance.getEntriesByType?.('navigation')[0]?.type);
async function changeLevel(id,place=null,zoom=map.getZoom()){
 if(!config.levels?.some(l=>l.id===id)||id===config.levelId)return;
 const base=registry.maps.find(c=>c.id===config.id),target=levelConfig(base,base.levels.find(l=>l.id===id));
 const url=viewUrl(null),center=place?[place.x,place.y]:pixelsOf(map.getCenter());url.searchParams.set('level',id);url.searchParams.set('x',String(center[0]));url.searchParams.set('y',String(center[1]));url.searchParams.set('z',String(zoom));
 if(!levelsAligned(target,config))for(const k of ['x','y','z'])url.searchParams.delete(k);
 if(place&&!place.quiet)url.searchParams.set('place',place.id);else url.searchParams.delete('place');
 history.pushState({map:config.id,level:id},'',url);ownView=true;await loadMap(config.id,url);
 if(place?.quiet)flashPin(place.id);
}
// An optional frame trims the drawn area inside the pixel grid; coordinates stay the same.
function mapBounds(){const f=config.frame||{x:0,y:0,width:config.width,height:config.height};return L.latLngBounds(map.unproject([f.x,f.y+f.height],config.coordinateZoom),map.unproject([f.x+f.width,f.y],config.coordinateZoom));}
function appendAttributionLinks(parent,a){
 for(const [title,href] of [[a.sourceTitle,a.sourceUrl],[a.license,a.licenseUrl]]){if(!href)continue;const link=text('a',title);link.href=href;link.target='_blank';link.rel='noopener';parent.append(link,text('span',' · '));}
}
function updateTitles(){
 document.title=config.title+' · MnM Atlas';document.querySelector('meta[name="description"]').content=config.description;
 document.querySelector('meta[property="og:title"]').content=document.title;document.querySelector('meta[property="og:description"]').content=config.description;
 $('breadcrumb').textContent=config.breadcrumb;$('cartouche-kicker').textContent=config.cartoucheKicker;$('map-name').textContent=config.title;$('map-subtitle').textContent=config.levelSubtitle||config.levelTitle||config.subtitle;
 document.body.classList.toggle('has-view-note',!!config.viewNote);
 for(const [id,anchor] of [['map-view-note',$('map-frame')],['guide-view-note',document.querySelector('.journal-heading')],['about-view-note',$('about-attribution')]]){
  let note=$(id);if(!note){note=text('p','');note.id=id;if(id==='map-view-note')anchor.append(note);else anchor.after(note);}
  note.textContent=config.viewNote||'';note.hidden=!config.viewNote;
 }
 // A page cached from before levels existed lacks this container; create it rather than failing to load.
 let controls=$('level-controls');if(!controls){controls=document.createElement('div');controls.id='level-controls';controls.className='level-controls';controls.setAttribute('role','group');controls.setAttribute('aria-label','Map level');$('map-frame').append(controls);}
 // Separate maps of one place stacked vertically (Evershade Weald under Faelindral) get the same quick switch as levels.
 const linked=!singleMap&&!config.levels&&Array.isArray(config.linkedMaps)?config.linkedMaps.filter(l=>registry.maps.some(c=>c.id===l.map)):[];
 controls.replaceChildren();controls.hidden=!config.levels&&!linked.length;document.body.classList.toggle('has-levels',!!config.levels||!!linked.length);
 for(const level of config.levels||[]){const b=text('button',level.title);b.type='button';b.dataset.level=level.id;b.setAttribute('aria-pressed',String(level.id===config.levelId));b.onclick=()=>changeLevel(level.id);controls.append(b);}
 for(const l of linked){const b=text('button',l.title);b.type='button';b.dataset.map=l.map;b.setAttribute('aria-pressed',String(l.map===config.id));b.onclick=()=>{if(l.map!==config.id)goToMap(l.map);};controls.append(b);}
 $('map-frame').setAttribute('aria-label',config.title+' illustrated map');
 setPickerMap(config.id);
 const a=config.attribution,footer=$('map-attribution');footer.replaceChildren(text('span',a.text+' '));
 appendAttributionLinks(footer,a);
 $('about-attribution').textContent=a.changes||a.text;
 const credits=$('about-map-links');credits.replaceChildren();
 appendAttributionLinks(credits,a);
 let artwork=$('about-artwork-credits');if(!artwork){artwork=text('p','');artwork.id='about-artwork-credits';credits.after(artwork);}
 artwork.replaceChildren();artwork.hidden=!config.artworkCredits?.length;
 for(const credit of config.artworkCredits||[]){artwork.append(text('span',credit.text+' '));appendAttributionLinks(artwork,credit);}
}
const localPath=p=>typeof p==='string'&&/^[a-zA-Z0-9_./{}-]+$/.test(p)&&!p.startsWith('/')&&!p.split('/').includes('..');
const levelConfig=(base,level)=>level?{...base,...level,id:base.id,title:base.title,levelId:level.id,levelTitle:level.title}:base;
const levelsAligned=(a,b)=>a.width===b.width&&a.height===b.height&&a.coordinateZoom===b.coordinateZoom&&(a.alignmentGroup||'shared')===(b.alignmentGroup||'shared');
async function fetchData(path,empty){if(path===null)return empty;if(!localPath(path))throw Error('Invalid local data path');const r=await fetch(path,{cache:'no-store'});if(!r.ok)throw Error('Map data unavailable: '+path);return r.json();}
function validateRegistry(data){
 if(data.version!==1||!Array.isArray(data.maps)||!data.maps.length||!data.maps.some(m=>m.id===data.defaultMap)||new Set(data.maps.map(m=>m.id)).size!==data.maps.length)throw Error('Invalid map registry');
 for(const c of data.maps){if(!/^[a-z0-9-]+$/.test(c.id)||!c.title||!c.description||![c.width,c.height,c.coordinateZoom,c.minZoom,c.maxZoom,c.maxNativeZoom,c.tileSize].every(Number.isFinite)||c.width<=0||c.height<=0||c.maxZoom<c.minZoom||!localPath(c.tilePath)||!localPath(c.markersFile)||(c.zonesFile!=null&&!localPath(c.zonesFile))||(c.colourTilePath!=null&&!localPath(c.colourTilePath))||!c.defaultView)throw Error('Invalid map configuration');}
 for(const c of data.maps)if(c.levels){if(!Array.isArray(c.levels)||!c.levels.length||new Set(c.levels.map(l=>l.id)).size!==c.levels.length||!c.levels.some(l=>l.id===c.defaultLevel)||!c.levels.every(l=>/^[a-z0-9-]+$/.test(l.id)&&l.title&&localPath(l.tilePath)))throw Error('Invalid map levels');}
 for(const base of data.maps)for(const level of base.levels||[]){const c=levelConfig(base,level);if(![c.width,c.height,c.coordinateZoom,c.minZoom,c.maxZoom,c.maxNativeZoom,c.tileSize].every(Number.isFinite)||c.width<=0||c.height<=0||c.minZoom>c.maxNativeZoom||c.maxNativeZoom>c.maxZoom||!['markersFile','labelsFile','hiddenAreasFile'].every(k=>c[k]==null||localPath(c[k])))throw Error('Invalid level configuration');}
 return data;
}
async function loadMap(id,url=new URL(location.href),push=false){
 const serial=++loadSerial;clearTimeout(urlTimer);loading=true;document.body.dataset.ready='false';
 const requested=registry.maps.find(c=>c.id===id),base=requested||registry.maps.find(c=>c.id===registry.defaultMap);let next=base;
 if(push)url.searchParams.delete('level');
 for(const p of pickers)p.busy(true);
 try{
  let [markers,labels,hidden]=await Promise.all([fetchData(next.markersFile,[]),fetchData(next.labelsFile,{labels:[],trainers:[]}),fetchData(next.hiddenAreasFile,{areas:[],routes:[]})]);
  if(serial!==loadSerial)return;
  if(!Array.isArray(markers)||!Array.isArray(labels.labels)||!Array.isArray(labels.trainers)||!Array.isArray(hidden.areas))throw Error('Invalid map feature data');
  const wanted=url.searchParams.get('place'),dest=[...markers,...labels.labels,...hidden.areas,...(hidden.additionalAreas||[]),...(hidden.destinations||[])].find(p=>wanted&&(p.id===wanted||p.slug===wanted||slug(p.name)===wanted));
  if(base.levels){const level=base.levels.find(l=>l.id===(!push&&dest?.level?dest.level:url.searchParams.get('level')))||base.levels.find(l=>l.id===base.defaultLevel);next=levelConfig(base,level);}
  [markers,labels,hidden]=await Promise.all([
   next.markersFile===base.markersFile?markers:fetchData(next.markersFile,[]),
   next.labelsFile===base.labelsFile?labels:fetchData(next.labelsFile,{labels:[],trainers:[]}),
   next.hiddenAreasFile===base.hiddenAreasFile?hidden:fetchData(next.hiddenAreasFile,{areas:[],routes:[]})]);
  if(serial!==loadSerial)return;
  if(!Array.isArray(markers)||!Array.isArray(labels.labels)||!Array.isArray(labels.trainers)||!Array.isArray(hidden.areas))throw Error('Invalid map feature data');
  const zonesData=next.zonesFile?await fetchData(next.zonesFile,{zones:[],borders:[]}):null;
  if(serial!==loadSerial)return;
  const keepEditing=alignmentMode||(!map&&url.searchParams.has('align'));if(alignmentMode)saveEdits();alignmentMode=false;editSnapshot=null;
  disposeLabels();hiddenController?.dispose();disposeZones();disposeZones=()=>{};disposeBackdrop();disposeBackdrop=()=>{};map?.remove();pins.clear();map=null;
  config=next;categories={...allCategories,...(config.extraCategories||{})};originals=markers;labelData=labels;hiddenData=hidden;publishedPositions=new Map(originals.map(m=>[m.id,[m.x,m.y]]));publishedLabelPositions=new Map(labels.labels.map(r=>[r.id,[r.x,r.y]]));
  activePlace=null;sharedPin=null;cancelPlacement();if($('editor').open)closeEditor();$('search').value='';enabled=new Set(Object.keys(categories));showPins=true;updateCategoryButtons();
  document.body.classList.remove('aligning');$('edit-bar').hidden=true;restoreStorage();setupCategoryControls();updateTitles();
  map=L.map('map',{crs:L.CRS.Simple,minZoom:config.minZoom,maxZoom:config.maxZoom,zoomSnap:0,zoomDelta:.5,zoomControl:false,attributionControl:true,maxBoundsViscosity:1});
  const bounds=mapBounds();map.setMaxBounds(bounds);
  sheetTileLayer(config,config.frame||{x:0,y:0,width:config.width,height:config.height},config.tilePath+'?v='+encodeURIComponent(config.tileRevision),{tileSize:config.tileSize,minZoom:config.minZoom,maxZoom:config.maxZoom,maxNativeZoom:config.maxNativeZoom,noWrap:true,bounds,keepBuffer:1,attribution:text('span',config.attribution.map).outerHTML}).on('tileerror',()=>status('A map tile could not load. Please reload.')).addTo(map);
  const currentHidden={...hiddenData};for(const key of ['areas','additionalAreas','routes','connections','destinations','levelStacks'])if(Array.isArray(hiddenData[key]))currentHidden[key]=hiddenData[key].filter(atLevel);
  fitMap();wheelAfterClick();map.on('resize',()=>{limitZoomOut();updateZoom();});disposeBackdrop=setupSheetEdge(map,config,config.frame||{x:0,y:0,width:config.width,height:config.height});disposeLabels=setupPlaceLabels(labelData);hiddenController=setupHiddenAreas(map,config,currentHidden);if(zonesData)disposeZones=setupWorldZones(map,config,zonesData);
  buildPlaceIndex();refreshSearch();setPanel(!compact()&&desktopPanelOpen&&!config.entry);$('hidden-controls').hidden=!config.hiddenAreasFile||!(currentHidden.areas.length||(currentHidden.additionalAreas||[]).length);$('alignment-tools').hidden=true;$('add').hidden=false;$('edit-positions').hidden=false;updateAlignmentStatus();
  map.on('movestart',()=>{if(!applyingView){activePlace=null;sharedPin?.remove();sharedPin=null;}});
  map.on('moveend zoomend',()=>{updateZoom();scheduleUrl();});
  map.on('popupclose',()=>{if(!applyingView){activePlace=null;scheduleUrl();}});
  if(push){const next=mapAddress(config.id);next.search=url.search;for(const k of ['map','place','x','y','z','level'])next.searchParams.delete(k);url=next;history.pushState({map:config.id},'',url);}
  applyLocation(url);ownView=false;updateZoom();if(keepEditing)enterEdit();loading=false;document.body.dataset.ready='true';syncUrl();
  window.dispatchEvent(new CustomEvent('atlas:loaded'));
  if(!requested&&id)status('Unknown map; showing '+config.title+'.');
 }catch(e){if(serial!==loadSerial)return;loading=false;document.body.dataset.ready=map?'true':'false';status('The atlas could not load. '+e.message,true);if(map)syncUrl();}
 finally{if(serial===loadSerial){for(const p of pickers)p.busy(false);if(config)setPickerMap(config.id);}}
}
function updateZoom(){$('zoom-label').textContent=Math.round(2**(map.getZoom()-config.coordinateZoom)*100)+'% · '+config.title;$('zoom-in').disabled=map.getZoom()>=config.maxZoom;$('zoom-out').disabled=map.getZoom()<=map.getMinZoom()+.01;}
// Saved data handed over from the atlas's previous address, by its moved page or as a downloaded file.
// Existing entries win; notes merge by id and moved positions merge by marker.
const previousOrigin='https://ocombe.github.io';
function mergeBrowserData(items){
 if(!items||typeof items!=='object'||Array.isArray(items))throw Error('Not a valid data file.');
 let changed=0;
 for(const [key,value] of Object.entries(items)){
  if(!/^mnmaps-[a-zA-Z0-9-]{1,120}$/.test(key)||typeof value!=='string'||value.length>5000000)continue;
  const current=localStorage.getItem(key);let next=value;
  if(current!==null){
   try{
    const mine=JSON.parse(current),theirs=JSON.parse(value);
    if(Array.isArray(mine)&&Array.isArray(theirs)){const merged=new Map(theirs.map(m=>[m?.id,m]));for(const m of mine)merged.set(m?.id,m);next=JSON.stringify([...merged.values()]);}
    else if(mine&&theirs&&typeof mine==='object'&&typeof theirs==='object')next=JSON.stringify({...theirs,...mine});
    else continue;
   }catch{continue;}
  }
  if(next!==current){localStorage.setItem(key,next);changed++;}
 }
 return changed;
}
async function receiveBrowserData(items){
 const changed=mergeBrowserData(items);
 if(changed){const url=new URL(location.href);ownView=true;await loadMap(config.id,url);}
 status(changed?'Your notes and positions from the previous address are now here.':'Nothing new to bring over; your data was already here.',true);
 return changed;
}
function watchForHandover(){
 window.addEventListener('message',async e=>{
  if(e.origin!==previousOrigin||e.data?.type!=='mnmaps-data')return;
  try{const changed=await receiveBrowserData(e.data.items);e.source?.postMessage({type:'mnmaps-received',changed},previousOrigin);}
  catch{status('Your data could not be brought over. Use Download my data on the previous address, then Import notes here.',true);}
 });
 try{window.opener?.postMessage({type:'mnmaps-ready'},previousOrigin);}catch{}
}
async function importNotes(file){
 if(file.size>5000000)throw Error('File exceeds 5 MB.');const data=JSON.parse(await file.text());
 if(data.type==='mnmaps-browser-data'&&data.version===1){await receiveBrowserData(data.items);return;}
 if(data.tileRevision!==config.tileRevision)throw Error('These notes use another map revision. Keep the backup and reposition them on this edition.');
 if(data.version!==1||data.map!==config.id||!Array.isArray(data.markers)||!data.markers.every(valid))throw Error('Not a valid '+config.title+' field-notes file.');
 const merged=new Map(personal.map(m=>[m.id,m]));for(const m of data.markers)merged.set(m.id,{id:m.id,name:m.name.trim(),category:m.category,note:m.note,x:m.x,y:m.y,...(m.noteType?{noteType:m.noteType}:{}),...(m.arrow?{arrow:m.arrow}:{}),...(m.toMap?{toMap:m.toMap}:{}),...(m.trade?{trade:m.trade}:{}),...(m.color?{color:m.color}:{}),...(config.levels?{level:m.level||config.defaultLevel}:{})});
 if(merged.size>2000)throw Error('The combined notes exceed 2,000 markers.');if(persist([...merged.values()])){setupCategoryControls();buildPlaceIndex();drawMarkers();status('Notes imported. Matching IDs updated; other notes kept.');}
}
function setupCategoryControls(){
 // Filters list this map's categories plus any your notes use; notes may use every type.
 const own={...baseCategories,...(config.extraCategories||{})},used=new Set(allMarkers().map(m=>m.category));
 const filters=Object.keys(categories).filter(k=>k!=='Personal'&&(Object.hasOwn(own,k)||used.has(k))).concat('Personal');
 $('categories').replaceChildren();
 for(const kind of filters){const b=text('button','');b.dataset.category=kind;b.append(markerSymbol({category:kind,name:''}),text('span',kind==='Class trainer'?'Class trainers':kind));b.onclick=()=>{enabled.has(kind)?enabled.delete(kind):enabled.add(kind);updateCategoryButtons();drawMarkers();};$('categories').append(b);}
 updateCategoryButtons();
 const select=$('category'),current=select.value;select.replaceChildren();
 for(const kind of ['Personal',...Object.keys(categories).filter(k=>k!=='Personal').sort((a,b)=>a.localeCompare(b))]){const option=text('option',kind);option.value=kind;select.append(option);}
 if(current)select.value=current;
}
// People who asked to be credited for published suggestions, kept in the site data by the publishing job.
async function showContributors(){
 try{const data=await fetchData('data/contributors.json',{contributors:[]}),rows=Array.isArray(data.contributors)?data.contributors.filter(r=>typeof r?.name==='string'&&r.name.trim()):[];
  $('about-contributors').textContent=rows.length?'Community contributors: '+rows.map(r=>r.name+(r.count>1?' ('+r.count+')':'')).join(', ')+'.':'';$('about-contributors').hidden=!rows.length;}
 catch{$('about-contributors').hidden=true;}
}
// Toolbar buttons show their name at once in the atlas's own tooltip, not the browser's delayed one.
function instantTips(){
 const sync=b=>{if(b.title){b.dataset.tip=b.title;b.removeAttribute('title');}};
 const watch=new MutationObserver(list=>{for(const m of list)sync(m.target);});
 for(const b of document.querySelectorAll('.map-tools button')){sync(b);watch.observe(b,{attributes:true,attributeFilter:['title']});}
}
// Map picker: the world map first, then the zone maps A to Z, with a type-to-filter box (no letter shortcuts, so any keyboard layout works).
const pickers=[],mapOrder=new Intl.Collator('en',{sensitivity:'base',ignorePunctuation:true});
const foldName=v=>v.normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[’'`]/g,'').toLowerCase();
function setPickerMap(id){for(const p of pickers)p.set(id);}
function buildMapPicker(host){
 const uid=host.id,button=document.createElement('button'),value=text('span','','map-select-value'),menu=document.createElement('div'),box=document.createElement('div'),input=document.createElement('input'),list=document.createElement('div'),empty=text('p','','map-menu-empty');
 button.type='button';button.className='map-select';button.setAttribute('aria-haspopup','listbox');button.setAttribute('aria-expanded','false');button.setAttribute('aria-controls',uid+'-menu');
 button.append(value);button.insertAdjacentHTML('beforeend','<svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4.5 6 7.5 9 4.5"/></svg>');
 menu.className='map-menu';menu.id=uid+'-menu';menu.hidden=true;box.className='search-box';box.append(text('span','⌕'));box.firstChild.setAttribute('aria-hidden','true');
 input.type='search';input.placeholder='Search maps…';input.autocomplete='off';input.spellcheck=false;input.setAttribute('aria-label','Search maps');input.setAttribute('role','combobox');input.setAttribute('aria-autocomplete','list');input.setAttribute('aria-expanded','true');input.setAttribute('aria-controls',uid+'-list');
 list.className='map-menu-list';list.id=uid+'-list';list.setAttribute('role','listbox');list.setAttribute('aria-label','Maps');empty.hidden=true;
 const options=[],group=document.createElement('div'),heading=text('div','Zone maps','map-menu-group');heading.id=uid+'-zones';group.setAttribute('role','group');group.setAttribute('aria-labelledby',heading.id);group.append(heading);
 let current=null,active=null,shown=[],loadingMap=false;
 const option=c=>{const o=text('div',c.title,'map-option');o.id=uid+'-'+c.id;o.setAttribute('role','option');o.setAttribute('aria-selected','false');o.dataset.map=c.id;o.dataset.key=foldName(c.title);
  o.onmousedown=e=>e.preventDefault();o.onclick=()=>choose(c.id);o.onpointermove=()=>{if(active!==o)setActive(o,false);};options.push(o);return o;};
 for(const c of registry.maps.filter(c=>c.entry))list.append(option(c));
 for(const c of registry.maps.filter(c=>!c.entry).sort((a,b)=>mapOrder.compare(a.title,b.title)))group.append(option(c));
 list.append(group);box.append(input);menu.append(box,list,empty);host.replaceChildren(button,menu);
 function setActive(o,scroll=true){active?.classList.remove('active');active=o;if(o){o.classList.add('active');input.setAttribute('aria-activedescendant',o.id);if(scroll)o.scrollIntoView({block:'nearest'});}else input.removeAttribute('aria-activedescendant');}
 function filter(){const words=foldName(input.value).split(/\s+/).filter(Boolean);shown=[];
  for(const o of options){const hit=words.every(w=>o.dataset.key.includes(w));o.hidden=!hit;if(hit)shown.push(o);}
  heading.hidden=!shown.some(o=>group.contains(o));empty.hidden=shown.length>0;if(!shown.length)empty.textContent='No map matches “'+input.value.trim()+'”.';
  setActive((!words.length&&shown.find(o=>o.dataset.map===current))||shown[0]||null);}
 function open(focus){if(!menu.hidden||loadingMap)return;menu.hidden=false;host.classList.add('open');button.setAttribute('aria-expanded','true');input.value='';filter();if(focus)input.focus({preventScroll:true});}
 function close(refocus){if(menu.hidden)return;menu.hidden=true;host.classList.remove('open');button.setAttribute('aria-expanded','false');if(refocus)button.focus({preventScroll:true});}
 function choose(id){close(true);if(id!==current&&!loadingMap)loadMap(id,new URL(location.href),true);}
 function move(step){if(!shown.length)return;const i=shown.indexOf(active);setActive(shown[i<0?0:Math.abs(step)>1?Math.max(0,Math.min(shown.length-1,i+step)):(i+step+shown.length)%shown.length]);}
 button.onclick=e=>menu.hidden?open(e.pointerType!=='touch'):close(false);
 button.onkeydown=e=>{if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();open(true);}else if(e.key.length===1&&e.key!==' '&&!e.ctrlKey&&!e.metaKey){e.preventDefault();open(true);input.value=e.key;filter();}else if(e.key==='Escape'&&!menu.hidden){e.stopPropagation();close(true);}};
 input.oninput=filter;
 input.onkeydown=e=>{const k=e.key;
  if(k==='ArrowDown'||k==='ArrowUp'){e.preventDefault();move(k==='ArrowDown'?1:-1);}
  else if(k==='PageDown'||k==='PageUp'){e.preventDefault();move(k==='PageDown'?6:-6);}
  else if(k==='Enter'){e.preventDefault();if(active)choose(active.dataset.map);}
  else if(k==='Escape'){e.preventDefault();e.stopPropagation();if(input.value){input.value='';filter();}else close(true);}
  else if(k==='Tab')close(false);};
 host.addEventListener('focusout',e=>{if(e.relatedTarget&&!host.contains(e.relatedTarget))close(false);});
 document.addEventListener('pointerdown',e=>{if(!host.contains(e.target))close(false);});
 // While a map loads the button stays focusable (aria-disabled), so keyboard users keep their place.
 return {busy(on){loadingMap=on;button.setAttribute('aria-disabled',String(on));if(on)close(false);},set(id){current=id;const c=registry.maps.find(m=>m.id===id);value.textContent=c?c.title:'';button.setAttribute('aria-label','Choose map: '+(c?c.title:''));for(const o of options)o.setAttribute('aria-selected',String(o.dataset.map===id));}};
}
function setupControls(){
 instantTips();
 $('about').onclick=()=>{$('about-dialog').showModal();showContributors();};$('close-about').onclick=()=>$('about-dialog').close();

 $('all-categories').onclick=()=>{enabled=new Set(Object.keys(categories));updateCategoryButtons();drawMarkers();};
 $('search').oninput=refreshSearch;$('clear-search').onclick=()=>{$('search').value='';refreshSearch();$('search').focus();};
 $('zoom-in').onclick=()=>map.zoomIn();$('zoom-out').onclick=()=>map.zoomOut();$('fit').onclick=fitMap;
 $('hide-pins').onclick=()=>{showPins=!showPins;updateCategoryButtons();drawMarkers();};
 $('toggle-panel').onclick=()=>{const open=$('journal').classList.contains('closed');setPanel(open);if(open&&isEmbed)$('close-guide').focus();};
 $('close-guide').onclick=()=>{setPanel(false);$('toggle-panel').focus();};
 mobileLayout.addEventListener('change',()=>setPanel(compact()?false:desktopPanelOpen));
 $('alignment-export').onclick=exportAlignment;
 $('edit-toggle').onclick=()=>alignmentMode?askFinishEdit():enterEdit();$('edit-positions').onclick=enterEdit;$('edit-done').onclick=()=>finishEdit(true);$('edit-cancel').onclick=()=>finishEdit(false);
 $('add').onclick=startPlacement;if($('add-note'))$('add-note').onclick=startPlacement;
 for(const [name,hex] of Object.entries(pinColours)){const label=text('label','');label.title=name;const input=text('input','');input.type='radio';input.name='pin-colour';input.value=hex;input.setAttribute('aria-label',name);const swatch=text('span','');swatch.style.setProperty('--swatch',hex);label.append(input,swatch);$('colour-swatches').append(label);}
 for(const tradeName of Object.keys(tradePaths).sort((a,b)=>a.localeCompare(b))){const option=text('option',tradeName);option.value=tradeName;$('trade').append(option);}
 for(const r of document.querySelectorAll('input[name="note-type"]'))r.onchange=updateEditorFields;$('category').onchange=updateEditorFields;
 $('cancel-place').onclick=cancelPlacement;document.addEventListener('keydown',e=>{if(e.key==='Escape'){cancelPlacement();if(compact())setPanel(false);}});
 $('cancel-edit').onclick=closeEditor;$('editor').addEventListener('close',()=>draft=null);
 $('marker-form').onsubmit=e=>{e.preventDefault();if(!draft)return;const type=noteTypeValue(),m={...draft,name:$('name').value.trim(),note:$('note').value,category:type==='marker'?$('category').value:'Personal'};
  delete m.noteType;delete m.arrow;delete m.trade;delete m.color;delete m.toMap;
  if(type!=='marker')m.noteType=type;if(type==='exit'){m.arrow=document.querySelector('input[name="exit-arrow"]:checked')?.value||'north';if($('exit-target').value)m.toMap=$('exit-target').value;}if(type==='marker'&&m.category==='Tradeskill'&&$('trade').value)m.trade=$('trade').value;
  const colour=document.querySelector('input[name="pin-colour"]:checked')?.value;if(type==='marker'&&colour&&m.category!=='Class trainer')m.color=colour;
  if(!valid(m))return;if(personal.length>=2000&&!personal.some(p=>p.id===m.id)){status('You have reached the 2,000-note limit. Export and remove older notes.');return;}const added=!personal.some(p=>p.id===m.id);if(persist([...personal.filter(p=>p.id!==m.id),m])){keepInSnapshot(m);closeEditor();cancelPlacement();enabled.add(m.category);setupCategoryControls();$('search').value='';buildPlaceIndex();refreshSearch();choose(m);status('Saved to your field notes.');if(added)window.dispatchEvent(new CustomEvent('atlas:note-added'));}};
 $('delete').onclick=()=>{if(draft&&deleteNote(draft.id))closeEditor();};
 $('export').onclick=()=>download({version:1,map:config.id,tileRevision:config.tileRevision,markers:personal},`${config.id}-field-notes.json`);
 $('import').onclick=()=>$('import-file').click();$('import-file').onchange=async e=>{try{if(e.target.files[0])await importNotes(e.target.files[0]);}catch(e){status('Import failed: '+e.message,true);}finally{$('import-file').value='';}};
 $('share').onclick=()=>singleMap?openInAtlas():copyLink();$('close-link').onclick=()=>$('link-dialog').close();
 if(singleMap){const share=$('share');share.title='Open in MnM Atlas';share.setAttribute('aria-label','Open this view in MnM Atlas');}
 $('embed').onclick=openEmbed;$('close-embed').onclick=()=>$('embed-dialog').close();
 for(const id of ['embed-level','embed-place','embed-height'])$(id).onchange=updateEmbed;
 $('copy-embed').onclick=()=>copyEmbed('embed-code');$('copy-embed-address').onclick=()=>copyEmbed('embed-address');
 $('fullscreen').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{status('Fullscreen is unavailable. Open the atlas in its own tab, or allow fullscreen on the iframe.');}};
 document.addEventListener('fullscreenchange',()=>{$('fullscreen').setAttribute('aria-label',document.fullscreenElement?'Exit fullscreen':'Enter fullscreen');$('fullscreen').title=document.fullscreenElement?'Exit fullscreen':'Enter fullscreen';map?.invalidateSize({pan:true,animate:false});});
 for(const host of document.querySelectorAll('.map-combo'))pickers.push(buildMapPicker(host));
 window.addEventListener('popstate',()=>{const url=new URL(location.href);ownView=true;loadMap(mapIdOf(url),url);});
}
// Every publish refreshes each file's Last-Modified, so one small HEAD request spots a newer edition.
const updateInterval=15*60*1000;let updateStamp=null,updateCheckedAt=0;
async function checkForUpdate(){
 if((document.hidden&&updateStamp!==null)||!$('update-notice').hidden)return;updateCheckedAt=Date.now();
 try{const r=await fetch('site.webmanifest',{method:'HEAD',cache:'no-store'}),stamp=r.ok&&(r.headers.get('last-modified')||r.headers.get('etag'));if(!stamp)return;if(updateStamp===null)updateStamp=stamp;else if(stamp!==updateStamp){updateStamp=stamp;$('update-notice').hidden=false;}}catch{}
}
function watchForUpdates(){
 $('update-reload').onclick=()=>location.reload();$('update-dismiss').onclick=()=>$('update-notice').hidden=true;
 const due=()=>Date.now()-updateCheckedAt>=updateInterval&&checkForUpdate();
 checkForUpdate();setInterval(due,60000);document.addEventListener('visibilitychange',due);
}
async function init(){try{registry=validateRegistry(await fetchData('data/maps.json'));for(const c of registry.maps)for(const extra of [c.extraCategories,...(c.levels||[]).map(l=>l.extraCategories)])for(const [k,v] of Object.entries(extra||{}))if(!Object.hasOwn(allCategories,k))allCategories[k]=v;setupControls();watchForUpdates();await loadMap(mapIdOf(new URL(location.href)));watchForHandover();}catch(e){status('The atlas could not load. '+e.message,true);}}
document.addEventListener('DOMContentLoaded',init,{once:true});
