/* Static atlas. Registry and feature coordinates are local, native map pixels. */
'use strict';
const $=id=>document.getElementById(id);
const text=(tag,value,cls)=>{const n=document.createElement(tag);n.textContent=value;if(cls)n.className=cls;return n;};
// A plain button; icon names its small line icon when it ends a popup (actionPaths).
const button=(label,action,cls,icon)=>{const b=text('button',label,cls);b.type='button';b.onclick=action;if(icon)b.dataset.icon=icon;return b;};
// A link that opens in a new tab.
const externalLink=(label,href,cls)=>{const a=text('a',label,cls);a.href=href;a.target='_blank';a.rel='noopener';return a;};
// Fills a select: [label,value] pairs, and {label,options} for a group of them.
function fillSelect(select,items){for(const item of items){if(Array.isArray(item)){const o=text('option',item[0]);o.value=item[1];select.append(o);continue;}const set=document.createElement('optgroup');set.label=item.label;fillSelect(set,item.options);select.append(set);}return select;}
// Vendor kinds in their groups, both A to Z; withGroups also offers each whole group ("g:<group>", kinds then "k:<kind>").
const az=(a,b)=>a.localeCompare(b);
const vendorKindItems=withGroups=>Object.entries(vendorKinds).sort(([a],[b])=>az(a,b)).map(([label,kinds])=>({label,options:[...(withGroups?[['All '+label.toLowerCase(),'g:'+label]]:[]),...Object.keys(kinds).sort(az).map(k=>[k,withGroups?'k:'+k:k])]}));
const baseCategories={'Bank':['▣','#916c30'],'Inn':['☾','#9a543a'],'Stable':['♞','#665e3e'],'Shady merchant':['♧','#785268'],'Tradeskill':['⚒','#385f60'],'Class trainer':['◈','#4e4668'],'Personal':['✧','#a04438']};
// Additional marker types; a map's own extraCategories override these colours and glyphs.
const noteCategories={'Notable NPC':['●','#2388aa'],'Quest':['!','#b5861f'],'Mob camp':['⚔','#7a3328'],'Named mob':['☠','#46404f'],'Vendor':['◇','#876036'],'Herbs':['✿','#4f7a3a'],'Wood':['♣','#6b4f2e'],'Ore':['⛏','#55606b']};
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
function valid(m){return m&&validLevel(m.level)&&(m.toMap===undefined||typeof m.toMap==='string'&&!!registry?.maps.some(c=>c.id===m.toMap))&&typeof m.id==='string'&&/^personal-[a-zA-Z0-9-]{1,80}$/.test(m.id)&&typeof m.name==='string'&&m.name.trim()&&m.name.length<=100&&typeof m.note==='string'&&m.note.length<=2000&&Object.hasOwn(categories,m.category)&&[undefined,'label','exit'].includes(m.noteType)&&(m.arrow===undefined||Object.hasOwn(exitArrows,m.arrow))&&(m.trade===undefined||Object.hasOwn(tradePaths,m.trade))&&(m.color===undefined||Object.values(pinColours).includes(m.color))&&(m.wiki===undefined||typeof m.wiki==='string'&&m.wiki.length<=300)&&(m.wikiId===undefined||!!wikiIdOf(m.wikiId))&&classesOk(m.classes)&&vendorKindOk(m.vendor)&&Number.isFinite(m.x)&&m.x>=0&&m.x<=config.width&&Number.isFinite(m.y)&&m.y>=0&&m.y<=config.height;}
function persist(next){try{localStorage.setItem(storageKey('notes'),JSON.stringify(next));personal=next;window.dispatchEvent(new CustomEvent('atlas:notes'));return true;}catch{status('Your browser could not save this change. Free some storage and try again.',true);return false;}}
function download(data,name){const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'})),a=text('a','');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function allMarkers(){return [...originals,...personal];}
// A class trainer reads as its class first ("Enchanter trainer"), so the pin says what it is; the trainer's own name,
// when it names someone, sits underneath. Names that already spell out the classes ("Cleric / Paladin — Hospice") stay.
const classesOf=m=>m.category==='Class trainer'&&Array.isArray(m.classes)?m.classes.filter(c=>typeof c==='string'&&c.trim()):[];
const squash=v=>String(v).toLocaleLowerCase().replace(/[^a-z]/g,'');
// A vendor with a kind reads kind first ("Used weapons dealer"), like a trainer reads class first, unless its name
// already is just that kind ("A bag merchant", "Butchers").
const vendorNamed=m=>{const bare=String(m.name).toLowerCase().replace(/[^a-z ]+/g,' ').trim().replace(/^(a|an|the) /,'').replace(/s$/,''),forms=vendorKinds[vendorGroupOf(m.vendor)]?.[m.vendor]||[];return squash(bare)===squash(m.vendor)||forms.some(f=>squash(f)===squash(bare));};
function markerTitle(m){if(m.category==='Vendor'&&m.vendor&&!vendorNamed(m))return m.vendor;const c=classesOf(m);if(!c.length||c.every(x=>squash(m.name).includes(squash(x))))return m.name;return c.join(' / ')+(c.length>1?' trainers':' trainer');}
// The name under a class-first (or kind-first) title; nothing when the name is only class abbreviations ("NEC").
function markerSubtitle(m){
 return markerTitle(m)!==m.name&&!/^[A-Z]{2,4}(\s*[\/·,]\s*[A-Z]{2,4})*$/.test(m.name.trim())?m.name:'';}
// What a vendor sells: its kind, or the kind its name says ("A bag merchant"), for search and the vendor filter.
const vendorKindFor=m=>m.category==='Vendor'?m.vendor||vendorKindNamed(m.name):'';
const markerText=m=>(m.name+' '+m.category+' '+m.note+' '+classesOf(m).join(' ')+' '+vendorWords(vendorKindFor(m))).toLocaleLowerCase();
// Vendors can be narrowed to a group ("g:Food and drink") or one kind ("k:Bag merchant"); '' shows them all.
let vendorGroup='';
const vendorShown=m=>{if(!vendorGroup||m.category!=='Vendor')return true;const kind=vendorKindFor(m);return vendorGroup.startsWith('g:')?vendorGroupOf(kind)===vendorGroup.slice(2):kind===vendorGroup.slice(2);};
const searchTerms=()=>$('search').value.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
const shownMarker=(m,terms)=>enabled.has(m.category)&&vendorShown(m)&&terms.every(t=>markerText(m).includes(t));
function visibleMarkers(){const terms=searchTerms();return allMarkers().filter(m=>atLevel(m)&&shownMarker(m,terms));}
function refreshSearch(){$('clear-search').hidden=!$('search').value;drawMarkers();}
function copyButton(place){return button('Copy link',()=>copyLink(place),'copy-place','copy');}
function switchAt(m){const destination=originals.find(row=>row.id===m.toMarker);if(destination)changeLevel(m.toLevel,{...destination,kind:'marker',quiet:m.switchOnClick&&!alignmentMode});}
// Arriving through a floor link: no popup, just a short glow on the landing marker.
function flashPin(id){const el=pins.get(id)?.getElement();if(!el)return;el.classList.remove('just-arrived');void el.offsetWidth;el.classList.add('just-arrived');setTimeout(()=>el.classList.remove('just-arrived'),1700);}
// A marker's wiki page opens in a new tab; an embed on another site may hide it (wiki-links.js).
function wikiButton(m){const link=wikiLinkFor(m);return link?externalLink('Read on '+link.name+' ↗',link.href,'wiki-link'):null;}
const noteKind=m=>m.noteType==='label'?'Area label':m.noteType==='exit'?'Zone exit':m.category;
// NPC wiki cards (npc-cards/<map>.json, built when publishing): read once per map, when its first wiki-linked NPC pin is
// drawn; those pins' popups then get their card. Only where this page may link to the wiki (embed rules).
let npcCards={map:null,cards:null,loading:false};
function npcCardFor(m){
 if(typeof m?.wikiId!=='string'||!m.wikiId.startsWith('npc-')||wikiLinkFor(m)?.site!=='mnm-wiki'||!config)return null;
 if(npcCards.map!==config.id)npcCards={map:config.id,cards:null,loading:false};
 if(npcCards.cards)return npcCards.cards[m.wikiId]||null;
 if(!npcCards.loading){npcCards.loading=true;const mapId=config.id;
  fetch('npc-cards/'+encodeURIComponent(mapId)+'.json').then(r=>r.ok?r.json():null).catch(()=>null).then(body=>{
   if(npcCards.map!==mapId)return;npcCards.cards=body&&body.cards&&typeof body.cards==='object'?body.cards:{};
   const byId=new Map(allMarkers().map(x=>[x.id,x]));for(const [id,pin] of pins){const one=byId.get(id);if(one&&npcCards.cards[one.wikiId]){pin.setPopupContent(popup(one));if(pin.isPopupOpen())requestAnimationFrame(fitCardPopup);
    // A card makes a tall popup: it moves the map just enough to show it whole.
    // The top padding clears the map's title plate, wherever it sits on this screen.
    const p=pin.getPopup();if(p){Object.assign(p.options,{autoPan:true,autoPanPaddingBottomRight:L.point(16,16)});Object.defineProperty(p.options,'autoPanPaddingTopLeft',{configurable:true,get:()=>{const plate=document.querySelector('.map-title'),box=map.getContainer().getBoundingClientRect(),below=plate&&plate.offsetParent?plate.getBoundingClientRect().bottom-box.top+10:0;return L.point(16,Math.max(16,below));}});}}}});}
 return null;
}
// A popup with a card is tall: once open (by a click, a search, a shared or ?wiki= link), the map moves just enough that
// it shows whole, below the map's title plate.
function fitCardPopup(){
 const el=map&&document.querySelector('.leaflet-popup');if(!el||!el.querySelector('.npc-card'))return;
 const box=map.getContainer().getBoundingClientRect(),plate=document.querySelector('.map-title'),top=Math.max(box.top+16,plate&&plate.offsetParent?plate.getBoundingClientRect().bottom+10:0),dy=top-el.getBoundingClientRect().top;
 if(dy>1)map.panBy([0,-dy],{animate:false});
}
// A popup's own buttons (copy, edit, delete, share, suggest, report) end it as one tidy list; ways to move on (a floor,
// another map) stay in the body.
// Each action button gets a small line icon above its label, like the map's own tools.
const actionPaths={
 copy:'M10 8h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2z M5 16H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1',
 edit:'M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z M15 5l4 4',
 report:'M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z M12 9v4 M12 17h.01',
 delete:'M3 6h18 M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6 M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2 M10 11v6 M14 11v6',
 share:'M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8 M16 6l-4-4-4 4 M12 2v13',
 reset:'M3 12a9 9 0 1 0 3-6.7L3 8 M3 3v5h5'};
function actionIcon(b){
 const kind=b.dataset.icon;if(!Object.hasOwn(actionPaths,kind||'')||b.querySelector('svg'))return;
 const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg'),path=document.createElementNS(ns,'path');
 for(const [k,v] of Object.entries({viewBox:'0 0 24 24',width:'16',height:'16','aria-hidden':'true',fill:'none',stroke:'currentColor','stroke-width':'1.8','stroke-linecap':'round','stroke-linejoin':'round'}))svg.setAttribute(k,v);
 path.setAttribute('d',actionPaths[kind]);svg.append(path);b.prepend(svg);
}
function tidyActions(n){
 const actions=text('div','','popup-actions');
 for(const el of [...n.children]){if(el.matches('button:not(.level-link)'))actions.append(el);else if(el.matches('.community-actions')){actions.append(...el.children);el.remove();}}
 for(const b of actions.querySelectorAll('button'))actionIcon(b);
 if(actions.children.length)n.append(actions);return n;
}
// A short card in the wiki's own order: its tag line, level, location, race and class, the first loot items, the start
// of its summary, each linking back to the wiki, with its credit.
// "Ebon Scholar Myrddin (levels 51–53)": the name, and the level our title gives, apart.
function titleLevel(t){const found=/^(.*?)\s*\((levels?\s[^)]*)\)\s*$/i.exec(t);return found?{name:found[1],level:found[2]}:{name:t,level:''};}
function npcCard(c,m){
 // The tag line keeps what the rows below do not already say ("Named · Human · Wizard" over a Human · Wizard row).
 // A named mob's kind already says Named; our title's level ("(levels 51–53)") leads the line instead of sitting in the name.
 const shown=[c.race,c.class,/named/i.test(noteKind(m))?'named':''].filter(Boolean).map(v=>v.toLowerCase()),level=titleLevel(markerTitle(m)).level;
 const tags=[level&&level[0].toUpperCase()+level.slice(1),...String(c.tags||'').split(' · ').filter(t=>t&&!shown.includes(t.toLowerCase()))].filter(Boolean).join(' · ');
 // One band across the popup holds everything from the wiki: the tag line and facts, then loot and the wiki's own words
 // as sections under small headings, then its credit.
 const box=text('div','','npc-card');if(tags)box.append(text('p',tags,'npc-tags'));
 const rows=document.createElement('dl'),row=(term,value)=>{if(value)rows.append(text('dt',term),text('dd',value));};
 // Our title may already give a level ("levels 51–53"): then the wiki's is left out rather than shown beside it.
 if(!level)row('Level',c.level);row(c.race&&c.class?'Race · Class':c.class?'Class':'Race',[c.race,c.class].filter(Boolean).join(' · '));row('Location',c.location);
 if(rows.children.length)box.append(rows);
 const section=(heading,cls)=>{const s=text('section','','npc-section '+cls),h=text('h4',heading,'npc-heading');s.append(h);box.append(s);return [s,h];};
 if(Array.isArray(c.loot)&&c.loot.length){const [loot,head]=section('Notable loot','npc-loot'),list=document.createElement('ul');if(c.lootCount>c.loot.length)head.append(text('small',c.lootCount+' known'));
  for(const i of c.loot){const li=document.createElement('li');li.append(externalLink(i.name,i.url));if(typeof i.dropRate==='number')li.append(text('span',i.dropRate+'%','npc-rate'));list.append(li);}
  loot.append(list);const more=(c.lootCount||0)-c.loot.length;if(more>0)loot.append(externalLink('+'+more+' more on the wiki',c.url,'npc-more'));}
 if(c.summary){const [about]=section('From the wiki','npc-about');about.append(text('p',c.summary,'npc-summary'),externalLink('Read more on the wiki ↗',c.url,'npc-read'));}
 box.append(externalLink('Data from the Monsters and Memories Wiki','https://monstersandmemories.wiki/','npc-credit'));
 return box;
}
function popup(m){const n=text('div',''),card=npcCardFor(m),title=text('h3',card?'':markerTitle(m));if(card)title.append(externalLink(titleLevel(markerTitle(m)).name,card.url,'npc-name'));n.append(text('div',noteKind(m)+(m.id.startsWith('personal-')?' · Your note':''),'tag'),title);{const who=markerSubtitle(m);if(who)n.append(text('p',who,'marker-who'));}
 // With a wiki card the wiki comes first; the atlas's own note and actions follow.
 if(card)n.append(npcCard(card,m));if(m.note){if(card){const ours=text('section','','npc-section npc-ours');ours.append(text('h4','Atlas note','npc-heading'),text('p',m.note));n.append(ours);}else n.append(text('p',m.note));}const wiki=!card&&wikiButton(m);if(wiki)n.append(wiki);n.append(copyButton(m));if(m.toLevel)n.append(button(m.direction==='up'?'Go up':'Go down',()=>switchAt(m),'level-link'));const leads=m.noteType==='exit'&&!alignmentMode&&registry.maps.find(c=>c.id===m.toMap);if(leads)n.append(button('Go to '+leads.title,()=>openMap(leads.id),'level-link'));
 if(m.id.startsWith('personal-'))n.append(button('Edit note',()=>openEditor(m),'','edit'),button('Delete',()=>confirmDelete(m),'popup-delete','delete'));
 if(alignmentPositions[m.id]){n.append(text('p','Position moved in this browser.','moved-note'));if(alignmentMode)n.append(button('Reset position',()=>resetMarker(m.id),'','reset'));}
 if(m.community&&!m.id.startsWith('personal-'))n.append(text('p','Community contribution','community-note'));
 if(!singleMap)window.atlasCommunity?.popup(m,n);return tidyActions(n);}
function labelEditPopup(row){
 const n=text('div','');n.append(text('div','Place name','tag'),text('h3',row.name));
 if(alignmentLabelPositions[row.id])n.append(text('p','Position moved in this browser.','moved-note'),button('Reset position',()=>resetLabel(row.id),'','reset'));
 window.atlasCommunity?.placePopup?.({...row,kind:'label'},n);
 L.popup({autoPan:false,offset:[0,-8]}).setLatLng(locationOf(row)).setContent(n).openOn(map);
}
function placePopup(p){const n=text('div','');n.append(text('div',p.kind==='hidden'?'Hidden area':'Place name','tag'),text('h3',p.name));if(p.note)n.append(text('p',p.note));const wiki=wikiButton(p);if(wiki)n.append(wiki);if(p.community)n.append(text('p','Community contribution','community-note'));n.append(copyButton(p));if(!singleMap)window.atlasCommunity?.placePopup?.(p,n);return tidyActions(n);}
// Makes a marker shown on the map again: its type on, pins shown, no search or vendor filter hiding it.
function revealMarker(m){enabled.add(m.category);showPins=true;$('search').value='';$('clear-search').hidden=true;setVendorGroup('');updateCategoryButtons();drawMarkers();}
function setVendorGroup(value){vendorGroup=value;const pick=$('vendor-filter-select');if(pick)pick.value=value;}
function choose(m){
 if(alignmentMode&&!m.id.startsWith('personal-'))selectAlignment(m,'marker');
 if(!enabled.has(m.category)||!pins.has(m.id)||!showPins)revealMarker(m);
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
// One line of the search results: an optional icon, the title and a small line under it.
function resultRow(title,detail,onClick,symbolOf,cls='place'){
 const b=text('button','',cls),label=text('span','');b.type='button';
 if(symbolOf){const glyph=text('span','','symbol');glyph.append(markerSymbol(symbolOf));b.append(glyph);}
 label.append(text('strong',title),text('small',detail));b.append(label);b.onclick=onClick;return b;
}
const markerDetail=(m,...more)=>[noteKind(m),markerSubtitle(m),...more].filter(Boolean).join(' · ');
function drawMarkers(){
 {const box=$('vendor-filter');if(box){const has=allMarkers().some(m=>m.category==='Vendor'&&atLevel(m));box.hidden=!has||!enabled.has('Vendor');if(box.hidden&&vendorGroup)setVendorGroup('');}}
 for(const pin of pins.values())pin.remove();pins.clear();const list=$('results');list.replaceChildren();
 const matches=visibleMarkers();$('count').textContent=matches.length+' places';
 for(const m of matches){
  const own=m.id.startsWith('personal-');
  const pin=L.marker(locationOf(m),{icon:pinIcon(m),alt:[markerTitle(m),markerSubtitle(m)].filter(Boolean).join(', '),keyboard:true,riseOnHover:true,draggable:alignmentMode}).bindPopup(popup(m),{autoPan:false});
  pin.atlasMinZoom=m.minZoom;
  // The hover tooltip shows the name; an aria-label (not a title) keeps it accessible without a second browser tooltip.
  pin.on('add',()=>pin.getElement()?.setAttribute('aria-label',[markerTitle(m),markerSubtitle(m)].filter(Boolean).join(', ')));
  // A marker that stands for another published map (a dungeon entrance on the world map) opens that map.
  // Personal zone exits keep their popup (Go to, Edit note) instead.
  const opens=!own&&!alignmentMode&&typeof m.toMap==='string'&&registry.maps.find(c=>c.id===m.toMap);
  pin.on('click',()=>opens?openMap(opens.id):m.switchOnClick&&!alignmentMode?switchAt(m):choose(m));if(opens)pin.unbindPopup();
  // A floor link switches floor straight away; its details stay in the search menu list.
  if(m.switchOnClick&&!alignmentMode)pin.unbindPopup();
  if(alignmentMode){pin.on('dragstart',()=>{map.closePopup();if(!own)selectAlignment(m,'marker');});pin.on('dragend',()=>(own?movePersonal:moveAlignedMarker)(m.id,pin.getLatLng()));}
  if(!m.noteType)pin.bindTooltip(()=>text('span',markerTitle(m)),{direction:'top',offset:[0,-23]});if(showPins)pin.addTo(map);pins.set(m.id,pin);
  list.append(resultRow(markerTitle(m),markerDetail(m,own?'Personal note':''),()=>opens?openMap(opens.id):choose(m),m));
 }
 // Place names and hidden areas can be found even when their visual layer hides.
 const terms=searchTerms();
 // A search also lists matching markers from the other levels; choosing one opens its level at the marker.
 const otherLevel=p=>config.levels&&p.level&&!atLevel(p)?' · '+(config.levels.find(l=>l.id===p.level)?.title||p.level):'';
 if(terms.length&&config.levels)for(const m of allMarkers().filter(m=>!atLevel(m)&&shownMarker(m,terms)))list.append(resultRow(markerTitle(m),markerDetail(m)+otherLevel(m),()=>openPlace({...m,kind:'marker'},Math.max(map.getZoom(),config.defaultView.placeZoom)),m));
 if(terms.length)for(const p of placeIndex.filter(p=>p.kind!=='marker'&&terms.every(t=>p.name.toLocaleLowerCase().includes(t))))list.append(resultRow(p.name,(p.kind==='hidden'?'Hidden area':'Place name')+otherLevel(p),()=>openPlace(p,Math.max(config.defaultView.placeZoom,p.minZoom||0))));
 $('count').textContent=list.childElementCount+' places';
 // NPCs on this map's Wanted board (not on the map yet) that match: choosing one opens its notice on the board.
 const wanted=terms.length&&window.atlasWantedMatches?window.atlasWantedMatches(terms):[];
 if(wanted.length){list.append(text('p','Wanted: not on the map yet','find-heading'));
  for(const w of wanted)list.append(resultRow(w.name,['Wanted',w.kind,w.claimed?'claimed, awaiting review':''].filter(Boolean).join(' · '),()=>window.atlasOpenBounty?.(w.id),{category:w.category,name:w.name},'place wanted-result'));}
 // Matches of a ?find= link on other maps, while its text is still in the search box.
 if(findState&&$('search').value.trim()===findState.text){
  const away=findState.hits.filter(e=>e.m!==config.id);
  if(away.length)list.append(text('p','On other maps','find-heading'));
  for(const e of away){const where=registry.maps.find(c=>c.id===e.m),as={name:e.n,category:e.k,classes:e.c};
   list.append(resultRow(markerTitle(as),[e.k,markerSubtitle(as),where?.title].filter(Boolean).join(' · '),()=>{const url=mapLink(e.m);url.searchParams.set('place',e.p);if(e.l)url.searchParams.set('level',e.l);goToMap(e.m,url);}));}
  if(!findState.hits.length)list.append(text('p','Nothing on the atlas matches “'+findState.text+'” yet.','empty'));
 }
 if(!list.childElementCount)list.append(text('p','No places found. Try another name or enable more categories.','empty'));
 schedulePlaceLabels();
}
function setPanel(open){if(!compact())desktopPanelOpen=open;$('journal').classList.toggle('closed',!open);$('toggle-panel').setAttribute('aria-expanded',String(open));map?.invalidateSize({pan:true,animate:false});}
// The link beside Show on map hides every type when all are shown, and shows them all otherwise.
const allTypesShown=()=>[...$('categories').children].every(b=>enabled.has(b.dataset.category))&&showPins;
function updateCategoryButtons(){for(const b of $('categories').children)b.setAttribute('aria-pressed',String(enabled.has(b.dataset.category)));$('hide-pins').setAttribute('aria-pressed',String(showPins));
 const all=allTypesShown();$('all-categories').textContent=all?'Hide all':'Show all';$('all-categories').setAttribute('aria-label',all?'Hide every marker type':'Show every marker type');}
function cancelPlacement(){if(draftPin)$('status').hidden=true;draftPin?.remove();draftPin=null;document.body.classList.remove('placing');$('cancel-place').hidden=true;}
// The world map (the one with zone outlines) takes no new notes: places belong on their zone's map. Notes saved there earlier stay.
const takesNotes=()=>!config.zonesFile;
window.atlasPlaceNote=start=>startPlacement(start);
// A bounty dragged from the Wanted board: the note opens where it was dropped, on the floor in view, if that is on the map.
window.atlasPlaceNoteAt=(given,clientX,clientY)=>{
 if(!takesNotes()||!map)return false;const box=map.getContainer().getBoundingClientRect();if(clientX<box.left||clientX>box.right||clientY<box.top||clientY>box.bottom)return false;
 const spot=map.mouseEventToLatLng({clientX,clientY}),[x,y]=pixelsOf(spot);if(!bounded(x,y))return false;
 startPlacement(given);if(!draftPin)return false;draftPin.setLatLng(spot);draftPin.fire('click');return true;
};
// New notes start at the centre of the view; dropping the pin opens the editor there. A bounty from the Wanted board
// passes what the note starts with (name, type, wiki link…); a button click passes its event, which is ignored.
function startPlacement(given){
 const prefill=given&&typeof given==='object'&&typeof given.name==='string'?given:null;
 map.closePopup();cancelPlacement();if(!takesNotes())return;
 const [cx,cy]=pixelsOf(map.getCenter()),start={x:Math.max(0,Math.min(config.width,cx)),y:Math.max(0,Math.min(config.height,cy)),category:'Personal',name:''};
 draftPin=L.marker(locationOf(start),{icon:pinIcon(start),alt:'New personal note',keyboard:true,draggable:true,zIndexOffset:1000}).addTo(map);
 draftPin.getElement()?.classList.add('draft-pin');
 const drop=()=>{const [x,y]=pixelsOf(draftPin.getLatLng());if(!bounded(x,y)){status('Drag the note inside '+config.title+'.',true);return;}openEditor({id:'personal-'+crypto.randomUUID(),name:'',note:'',category:'Personal',...prefill,x,y,...(config.levels?{level:config.levelId}:{})});};
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
 const gone=personal.find(p=>p.id===id);if(!persist(personal.filter(p=>p.id!==id)))return false;
 if(editSnapshot)editSnapshot.personal=editSnapshot.personal.filter(p=>p.id!==id);
 map.closePopup();setupCategoryControls();buildPlaceIndex();drawMarkers();status('Personal note deleted.');
 // A note that carries a suggestion (a bounty claim) withdraws it too (community.js).
 if(gone)window.dispatchEvent(new CustomEvent('atlas:note-deleted',{detail:{note:gone}}));return true;
}
// A small question with its answers ([label, action, class]); any answer closes it.
function confirmDialog(id,title,message,answers){
 let d=$(id);if(!d){d=document.createElement('dialog');d.id=id;d.setAttribute('aria-labelledby',id+'-title');document.body.append(d);}
 const heading=text('h2',title),actions=text('div','','dialog-actions');heading.id=id+'-title';
 actions.append(...answers.map(([label,fn,cls])=>button(label,()=>{d.close();fn();},cls)));
 d.replaceChildren(heading,text('p',message),actions);d.showModal();
}
// A note can be deleted straight from its popup, after a small confirmation.
function confirmDelete(m){
 const also=window.atlasCommunity?.deleteNotice?.(m);
 confirmDialog('delete-confirm','Delete this note?','"'+m.name+'" will be removed from your notes'+(document.querySelector('.community-who')?' on every device you sync.':'.')+(also?' '+also:''),[['Cancel',()=>{}],['Delete',()=>deleteNote(m.id),'danger']]);
}
function askFinishEdit(){
 if(!editChanged()){finishEdit(true);return;}
 confirmDialog('edit-confirm','Save your changes?','You moved markers or names while editing. Save keeps the new positions in this browser; Discard puts everything back.',[['Keep editing',()=>{}],['Discard',()=>finishEdit(false)],['Save',()=>finishEdit(true),'primary']]);
}
function finishEdit(save){
 if(!alignmentMode)return;
 // Notes moved while editing are announced once saved, so a suggestion sent for one can follow it.
 const moved=save?personal.filter(p=>{const was=editSnapshot.personal.find(o=>o.id===p.id);return was&&(was.x!==p.x||was.y!==p.y);}):[];
 if(save){if(!saveEdits())return;}
 else{alignmentPositions=editSnapshot.positions;alignmentLabelPositions=editSnapshot.labels;applyOverrides();persist(editSnapshot.personal);}
 editSnapshot=null;buildPlaceIndex();setEditing(false);status(save?'Changes saved in this browser.':'Changes cancelled.');
 if(save)window.dispatchEvent(new CustomEvent('atlas:positions'));for(const m of moved)window.dispatchEvent(new CustomEvent('atlas:note-saved',{detail:{note:m,moved:true}}));
 window.dispatchEvent(new CustomEvent('atlas:edit-ended'));
}
function noteTypeValue(){return document.querySelector('input[name="note-type"]:checked')?.value||'marker';}
// Each category has its own pin colour, so types stay recognisable on the map; only Personal notes pick one.
// The dot beside Category shows the colour the pin will have.
function updateEditorFields(){const type=noteTypeValue(),own=categories[$('category').value]?.[1]||'#a04438',picked=document.querySelector('input[name="pin-colour"]:checked')?.value;$('default-colour').style.setProperty('--swatch',own);$('pin-colours').hidden=$('category').value!=='Personal';$('pin-preview').hidden=$('category').value==='Personal';$('pin-preview').style.setProperty('--swatch',$('category').value==='Personal'&&picked?picked:draft?.color||own);$('marker-fields').hidden=type!=='marker';$('trade-field').hidden=type!=='marker'||$('category').value!=='Tradeskill';$('exit-fields').hidden=type!=='exit';$('exit-target-field').hidden=type!=='exit';$('wiki-field').hidden=type!=='marker';$('class-field').hidden=type!=='marker'||$('category').value!=='Class trainer';$('vendor-field').hidden=type!=='marker'||$('category').value!=='Vendor';guessTrade();guessVendor();}
// A class trainer's classes ride on the wiki field (a wiki pick may give two); the Class menu shows a single one and
// sets it. Every change goes through pickClasses, so the two never disagree.
function pickedClasses(){try{const v=JSON.parse($('wiki').dataset.wikiClasses||'[]');return classesOk(v)?v:[];}catch{return [];}}
function pickClasses(list){const v=Array.isArray(list)?list.filter(c=>atlasClasses.includes(c)):[];$('wiki').dataset.wikiClasses=JSON.stringify(v);$('trainer-class').value=v.length===1?v[0]:'';}
// A vendor named for what it sells ("A bag merchant") starts on that kind; a chosen kind stays.
function guessVendor(){if($('category').value!=='Vendor'||$('vendor-kind').value)return;const kind=vendorKindNamed($('name').value+' '+$('note').value);if(kind)$('vendor-kind').value=kind;}
// A Tradeskill named in its name or note ("an enchanting trainer") starts on that trade; a chosen trade stays.
function guessTrade(){if($('category').value!=='Tradeskill'||$('trade').value)return;const trade=tradeNamed($('name').value+' '+$('note').value,Object.keys(tradePaths));if(trade)$('trade').value=trade;}
function openEditor(m){draft={...m};$('editor-title').textContent=personal.some(p=>p.id===m.id)?'Your discovery':'A new discovery';$('name').value=m.name;$('category').value=m.category;$('note').value=m.note;$('wiki').value=m.wiki||'';setWikiPick($('wiki'),m.wiki,m.wikiId);pickClasses(m.classes);$('vendor-kind').value=m.vendor||'';
 for(const r of document.querySelectorAll('input[name="note-type"]'))r.checked=r.value===(m.noteType||'marker');$('trade').value=m.trade||'';
 for(const r of document.querySelectorAll('input[name="exit-arrow"]'))r.checked=r.value===(m.arrow||'north');
 for(const r of document.querySelectorAll('input[name="pin-colour"]'))r.checked=r.value===(m.color||'');
 {const target=$('exit-target');target.replaceChildren(Object.assign(text('option','Not set'),{value:''}));for(const c of registry.maps.filter(c=>c.id!==config.id).sort((a,b)=>a.title.localeCompare(b.title))){const o=text('option',c.title);o.value=c.id;target.append(o);}target.value=m.toMap||'';}
updateEditorFields();$('delete').hidden=!personal.some(p=>p.id===m.id);window.dispatchEvent(new CustomEvent('atlas:editor-open',{detail:{note:m}}));$('editor').showModal();$('name').focus();}
function closeEditor(){draft=null;$('editor').close();cancelPlacement();}
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
 const readMoves=(kind,published)=>{try{const saved=JSON.parse(localStorage.getItem(storageKey(kind))||'{}');if(!saved||Array.isArray(saved)||typeof saved!=='object')return {};// A move that has since been published matches the published spot and is dropped.
  return Object.fromEntries(Object.entries(saved).filter(([id,p])=>published.has(id)&&Array.isArray(p)&&p.length===2&&bounded(...p,config.minZoom)&&!(published.get(id)[0]===p[0]&&published.get(id)[1]===p[1])));}catch{return {};}};
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
 if(await copyText(url.href))status('Link copied. Personal notes are not included.');
 else{$('link-value').value=url.href;$('link-dialog').showModal();$('link-value').select();}
}
// Copies to the clipboard where this page may; false when it cannot (an iframe without clipboard-write).
async function copyText(value){
 try{const policy=document.permissionsPolicy||document.featurePolicy;if(!navigator.clipboard?.writeText||(policy&&!policy.allowsFeature('clipboard-write')))return false;await navigator.clipboard.writeText(value);return true;}catch{return false;}
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
// A marker can also be shown as a small still image of its spot (built with the site, see scripts/make-mini-maps.py)
// that links to the atlas: plain HTML with no iframe or script, light enough for every page of a wiki.
function miniImage(m){
 const link=m.wikiId?new URL(siteRoot.href):mapAddress(config.id);if(m.wikiId)link.searchParams.set('find',m.wikiId);else{link.searchParams.set('place',m.id);if(config.levels&&m.level)link.searchParams.set('level',m.level);}
 return {link,image:new URL(m.wikiId?'mini/'+encodeURIComponent(m.wikiId)+'.webp':'mini/'+encodeURIComponent(config.id)+'/'+encodeURIComponent(m.id)+'.webp',siteRoot)};
}
function updateEmbed(){
 const mini=embedPlace?.kind==='marker'&&$('embed-place').checked&&$('embed-mini').checked;$('embed-height').hidden=$('embed-height-label').hidden=mini;
 if(mini){const {link,image}=miniImage(embedPlace);$('embed-address').value=image.href;$('embed-preview').href=link.href;
  $('embed-code').value=`<a href="${htmlAttr(link.href)}" title="Open in MnM Atlas"><img src="${htmlAttr(image.href)}" width="320" height="200" alt="${htmlAttr(markerTitle(embedPlace)+' on MnM Atlas')}" loading="lazy" style="border:0"></a>`;return;}
 const url=embedAddress();$('embed-address').value=url.href;$('embed-preview').href=url.href;
 $('embed-code').value=`<iframe src="${htmlAttr(url.href)}" title="${htmlAttr(config.title+' · MnM Atlas')}" width="100%" height="${$('embed-height').value}" style="border:0" loading="lazy" allow="fullscreen; clipboard-write" allowfullscreen></iframe>`;
}
function openEmbed(){
 if(!config)return;embedPlace=activePlace&&!activePlace.id.startsWith('personal-')?activePlace:null;
 $('embed-map-name').textContent=config.title;
 $('embed-level-row').hidden=!config.levels;$('embed-level-name').textContent=config.levelTitle||'';$('embed-level').checked=true;
 $('embed-place-row').hidden=!embedPlace;$('embed-place-name').textContent=embedPlace?markerTitle(embedPlace):'';$('embed-place').checked=true;
 $('embed-mini-row').hidden=embedPlace?.kind!=='marker';$('embed-mini').checked=false;
 updateEmbed();$('embed-dialog').showModal();$('embed-code').select();
}
async function copyEmbed(field){
 if(await copyText($(field).value))status(field==='embed-code'?'Embed code copied.':'Map address copied.');
 else{$(field).focus();$(field).select();status('Press Ctrl+C (or ⌘C) to copy.');}
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
 if(wanted){const p=findPlace(wanted);if(p){if(p.kind==='marker')revealMarker(p);const z=Number.isFinite(values[2])&&values[2]>=config.minZoom&&values[2]<=config.maxZoom?values[2]:config.defaultView.placeZoom;openPlace(p,z);applyingView=false;return;}warning='That place was not found on this map.';}
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
 // A source or licence never breaks inside ("CC BY-SA 4.0" stays whole); separators go only between items.
 let first=true;for(const [title,href] of [[a.sourceTitle,a.sourceUrl],[a.license,a.licenseUrl]]){if(!href)continue;if(!first)parent.append(text('span',' · '));parent.append(externalLink(title,href,'credit-item'));first=false;}
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
  map.on('popupopen',()=>requestAnimationFrame(fitCardPopup));
  const bounds=mapBounds();map.setMaxBounds(bounds);
  sheetTileLayer(config,config.frame||{x:0,y:0,width:config.width,height:config.height},config.tilePath+'?v='+encodeURIComponent(config.tileRevision),{tileSize:config.tileSize,minZoom:config.minZoom,maxZoom:config.maxZoom,maxNativeZoom:config.maxNativeZoom,noWrap:true,bounds,keepBuffer:1,attribution:text('span',config.attribution.map).outerHTML}).on('tileerror',()=>status('A map tile could not load. Please reload.')).addTo(map);
  const currentHidden={...hiddenData};for(const key of ['areas','additionalAreas','routes','connections','destinations','levelStacks'])if(Array.isArray(hiddenData[key]))currentHidden[key]=hiddenData[key].filter(atLevel);
  fitMap();wheelAfterClick();map.on('resize',()=>{limitZoomOut();updateZoom();});disposeBackdrop=setupSheetEdge(map,config,config.frame||{x:0,y:0,width:config.width,height:config.height});disposeLabels=setupPlaceLabels(labelData);hiddenController=setupHiddenAreas(map,config,currentHidden);if(zonesData)disposeZones=setupWorldZones(map,config,zonesData);
  buildPlaceIndex();refreshSearch();setPanel(!compact()&&desktopPanelOpen&&!config.entry);$('hidden-controls').hidden=!config.hiddenAreasFile||!(currentHidden.areas.length||(currentHidden.additionalAreas||[]).length);$('alignment-tools').hidden=true;$('add').hidden=!takesNotes();if($('add-note'))$('add-note').hidden=!takesNotes();$('edit-positions').hidden=false;updateAlignmentStatus();
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
 const imported=data.markers.map(m=>({id:m.id,name:m.name.trim(),category:m.category,note:m.note,x:m.x,y:m.y,...markerExtras(m),...(config.levels?{level:m.level||config.defaultLevel}:{})}));
 const merged=new Map(personal.map(m=>[m.id,m]));for(const m of imported)merged.set(m.id,m);
 // Imported while editing: Cancel only undoes moves, so the imported notes stay.
 if(merged.size>2000)throw Error('The combined notes exceed 2,000 markers.');if(persist([...merged.values()])){if(editSnapshot)editSnapshot.personal=[...editSnapshot.personal.filter(p=>!imported.some(m=>m.id===p.id)),...imported];setupCategoryControls();buildPlaceIndex();drawMarkers();status('Notes imported. Matching IDs updated; other notes kept.');}
}
// The types a note (or a suggestion under review) can take: Personal first, then the others A to Z.
const categoryChoices=()=>['Personal',...Object.keys(categories).filter(k=>k!=='Personal').sort((a,b)=>a.localeCompare(b))];
function setupCategoryControls(){
 // Filters list this map's categories plus any your notes use, A to Z with Personal last; notes may use every type.
 const own={...baseCategories,...(config.extraCategories||{})},used=new Set(allMarkers().map(m=>m.category));
 const filters=Object.keys(categories).filter(k=>k!=='Personal'&&(Object.hasOwn(own,k)||used.has(k))).sort((a,b)=>(a==='Class trainer'?'Class trainers':a).localeCompare(b==='Class trainer'?'Class trainers':b)).concat('Personal');
 $('categories').replaceChildren();
 for(const kind of filters){const b=text('button','');b.dataset.category=kind;b.append(markerSymbol({category:kind,name:''}),text('span',kind==='Class trainer'?'Class trainers':kind));b.onclick=()=>{enabled.has(kind)?enabled.delete(kind):enabled.add(kind);updateCategoryButtons();drawMarkers();};$('categories').append(b);}
 updateCategoryButtons();
 const select=$('category'),current=select.value;select.replaceChildren();
 fillSelect(select,categoryChoices().map(k=>[k,k]));
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

 $('all-categories').onclick=()=>{if(allTypesShown())for(const b of $('categories').children)enabled.delete(b.dataset.category);else{enabled=new Set(Object.keys(categories));showPins=true;setVendorGroup('');}updateCategoryButtons();drawMarkers();};
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
 // A class trainer's class: picked here, or filled from the wiki pick; it rides with the note as its classes.
 fillSelect($('trainer-class'),atlasClasses.map(c=>[c,c]));
 $('trainer-class').onchange=()=>pickClasses($('trainer-class').value?[$('trainer-class').value]:[]);
 fillSelect($('vendor-kind'),vendorKindItems(false));
 for(const id of ['name','note'])$(id).addEventListener('input',()=>{guessTrade();guessVendor();});
 {const pick=$('vendor-filter-select');fillSelect(pick,vendorKindItems(true));pick.onchange=()=>{vendorGroup=pick.value;drawMarkers();};}
 fillSelect($('trade'),Object.keys(tradePaths).sort((a,b)=>a.localeCompare(b)).map(t=>[t,t]));
 for(const r of document.querySelectorAll('input[name="note-type"],input[name="pin-colour"]'))r.onchange=updateEditorFields;$('category').onchange=updateEditorFields;
 $('cancel-place').onclick=cancelPlacement;document.addEventListener('keydown',e=>{if(e.key==='Escape'){cancelPlacement();if(compact())setPanel(false);}});
 // Closing the editor without saving also drops a new note's pin; a saved note has already ended placement.
 $('cancel-edit').onclick=closeEditor;$('editor').addEventListener('close',()=>{draft=null;cancelPlacement();});
 $('marker-form').onsubmit=e=>{e.preventDefault();if(!draft)return;
  {const sharing=!!$('suggest-check')?.checked&&!$('suggest-on-save')?.hidden&&!$('suggest-check').parentElement.hidden,type=noteTypeValue(),kind=$('category').value;
   if(sharing&&type==='marker'&&kind==='Tradeskill'&&!$('trade').value){status('Choose the trade before suggesting it for the public map.');$('trade').focus();return;}
   if(sharing&&type==='marker'&&kind==='Class trainer'&&!$('marker-form').classList.contains('bounty-mode')&&!pickedClasses().length){status('Choose the class they teach before suggesting it for the public map.');$('trainer-class').focus();return;}}
  // What the form says, then only the fields this kind of note keeps (markerExtras).
  const type=noteTypeValue(),category=type==='marker'?$('category').value:'Personal',wiki=type==='marker'?wikiAddress($('wiki').value):'';
  if(wiki===null){status(wikiHint);$('wiki').focus();return;}
  const colour=document.querySelector('input[name="pin-colour"]:checked')?.value,base={...draft};for(const k of markerExtraKeys)delete base[k];
  const m={...base,name:$('name').value.trim(),note:$('note').value,category,...markerExtras({category,noteType:type==='marker'?undefined:type,
   arrow:document.querySelector('input[name="exit-arrow"]:checked')?.value||'north',toMap:$('exit-target').value,trade:$('trade').value,vendor:$('vendor-kind').value,
   color:colour&&(category==='Personal'||colour===draft.color)?colour:'',wiki,wikiId:wiki?wikiIdFor($('wiki'),wiki):'',
   // A trainer picked from the wiki keeps its classes, so it reads class first ("Beastmaster trainer").
   classes:pickedClasses()})};
  if(!valid(m)){status('This note could not be saved: check its name and fields.');return;}if(personal.length>=2000&&!personal.some(p=>p.id===m.id)){status('You have reached the 2,000-note limit. Export and remove older notes.');return;}const added=!personal.some(p=>p.id===m.id);if(persist([...personal.filter(p=>p.id!==m.id),m])){keepInSnapshot(m);closeEditor();cancelPlacement();enabled.add(m.category);setupCategoryControls();$('search').value='';buildPlaceIndex();refreshSearch();choose(m);status('Saved to your field notes.');if(added)window.dispatchEvent(new CustomEvent('atlas:note-added'));window.dispatchEvent(new CustomEvent('atlas:note-saved',{detail:{note:m}}));}};
 $('delete').onclick=()=>{if(draft&&deleteNote(draft.id))closeEditor();};
 $('export').onclick=()=>download({version:1,map:config.id,tileRevision:config.tileRevision,markers:personal},`${config.id}-field-notes.json`);
 $('import').onclick=()=>$('import-file').click();$('import-file').onchange=async e=>{try{if(e.target.files[0])await importNotes(e.target.files[0]);}catch(e){status('Import failed: '+e.message,true);}finally{$('import-file').value='';}};
 $('share').onclick=()=>singleMap?openInAtlas():copyLink();$('close-link').onclick=()=>$('link-dialog').close();
 if(singleMap){const share=$('share');share.title='Open in MnM Atlas';share.setAttribute('aria-label','Open this view in MnM Atlas');}
 $('embed').onclick=openEmbed;$('close-embed').onclick=()=>$('embed-dialog').close();
 for(const id of ['embed-level','embed-place','embed-height','embed-mini'])$(id).onchange=updateEmbed;
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
// ?find=<text> (or ?wiki=<wiki id>), for links from other sites: one match opens its map on that place; several, or none,
// open the Search menu with the text, listing matches on other maps; &map=<id> looks on that map only. Embed settings are kept.
let findState=null;
// The address of a map for a ?find= link, keeping its other settings (embed and the like).
function findTarget(url,id){const next=mapAddress(id);for(const [k,v] of url.searchParams)if(!['find','wiki','map','place','level','x','y','z'].includes(k))next.searchParams.set(k,v);return next;}
async function findArrival(url){
 const asked=(url.searchParams.get('find')??url.searchParams.get('wiki')??'').trim().slice(0,100);if(!asked)return null;
 const only=registry.maps.some(c=>c.id===url.searchParams.get('map'))?url.searchParams.get('map'):'';
 let index=[];try{index=await fetchData('data/find-index.json',[]);}catch{}
 const hits=findPlaces(index,asked,only).filter(e=>registry.maps.some(c=>c.id===e.m)),maps=[...new Set(hits.map(e=>e.m))];
 const target=maps.length===1?maps[0]:only||registry.defaultMap,next=findTarget(url,target);
 if(hits.length===1){next.searchParams.set('place',hits[0].p);if(hits[0].l)next.searchParams.set('level',hits[0].l);}
 // Not on the atlas yet: an NPC on a Wanted board (by wiki id, else exact name) opens its map with the board on its notice.
 if(!hits.length){let wanted=[];try{wanted=await fetchData('bounties/index.json',[]);}catch{}
  const rows=(Array.isArray(wanted)?wanted:[]).filter(e=>e&&typeof e.w==='string'&&typeof e.n==='string'&&registry.maps.some(c=>c.id===e.m)&&(!only||e.m===only));
  const found=rows.filter(e=>e.w===asked),named=found.length?found:rows.filter(e=>findKey(e.n)===findKey(asked));
  if(named.length===1){const there=findTarget(url,named[0].m);history.replaceState({map:named[0].m},'',there);return {map:named[0].m,url:there,text:asked,hits:null,bounty:named[0].w};}}
 history.replaceState({map:target},'',next);
 return {map:target,url:next,text:asked,hits:hits.length===1?null:hits};
}
async function init(){try{registry=validateRegistry(await fetchData('data/maps.json'));for(const c of registry.maps)for(const extra of [c.extraCategories,...(c.levels||[]).map(l=>l.extraCategories)])for(const [k,v] of Object.entries(extra||{}))if(!Object.hasOwn(allCategories,k))allCategories[k]=v;setupControls();watchForUpdates();const arrival=await findArrival(new URL(location.href));await loadMap(arrival?.map||mapIdOf(new URL(location.href)),arrival?.url);if(arrival?.hits){findState={text:arrival.text,hits:arrival.hits};$('search').value=arrival.text;setPanel(true);refreshSearch();}if(arrival?.bounty)window.atlasOpenBounty?.(arrival.bounty);watchForHandover();}catch(e){status('The atlas could not load. '+e.message,true);}}
document.addEventListener('DOMContentLoaded',init,{once:true});
