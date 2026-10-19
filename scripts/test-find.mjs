// Offline checks for find.js: how ?find=<text> and ?wiki=<id> pick places from data/find-index.json.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const context={};vm.createContext(context);vm.runInContext(await readFile(new URL('../find.js',import.meta.url),'utf8'),context);
const findPlaces=vm.runInContext('findPlaces',context);
const index=[{n:'Marshal Harding',m:'underdocks',p:'harding',k:'Notable NPC',l:'lower',w:'npc-marshal-harding'},{n:"Amarah Ith'vayen",m:'ail-vorith',p:'amarah',k:'Class trainer',c:['Enchanter'],w:'npc-amarah-ithvayen'},
 {n:'Elementalist / Wizard / Enchanter trainers',m:'underdocks',p:'ele',k:'Class trainer',c:['Elementalist','Wizard','Enchanter']},{n:'Bank — north-east quay',m:'underdocks',p:'bank-ne',k:'Bank'},{n:'Bank',m:'night-harbor',p:'bank',k:'Bank'},{n:'Keeper’s Bight',m:'keepers-bight',p:'kb',k:'Place name'}];
const ids=(...a)=>[...findPlaces(index,...a)].map(e=>e.p);
assert.deepEqual(ids('npc-marshal-harding'),['harding'],'A wiki id comes first');
assert.deepEqual(ids('  MARSHAL harding '),['harding'],'Names ignore case and spaces');
assert.deepEqual(ids("amarah ith’vayen"),['amarah'],'and the kind of apostrophe');
assert.deepEqual(ids('enchanter trainer'),['amarah','ele'],'A trainer answers to its classes');
assert.deepEqual(ids('bank'),['bank'],'An exact name wins over names that contain it');
assert.deepEqual(ids('bank','underdocks'),['bank-ne'],'map= keeps one map, then names that contain the text');
assert.deepEqual(ids("keeper's"),['kb']);assert.deepEqual(ids('zzqq'),[]);assert.deepEqual(ids(''),[]);
console.log('Find checks passed: wiki ids, exact names, trainer classes, contains, one map, nothing found.');
// Every class the maps use is on the shared class list with the abbreviation its chips show.
{const c={};vm.createContext(c);vm.runInContext(await readFile(new URL('../wiki-links.js',import.meta.url),'utf8'),c);const abbr=vm.runInContext('classAbbreviations',c),vendorKinds=vm.runInContext('vendorKindList',c);
 const {readdir}=await import('node:fs/promises'),files=[];const walk=async d=>{for(const e of await readdir(d,{withFileTypes:true}))e.isDirectory()?await walk(d+'/'+e.name):e.name.endsWith('.json')&&files.push(d+'/'+e.name);};await walk(new URL('../data',import.meta.url).pathname.replace(/^\/([A-Z]:)/,'$1'));
 for(const f of files){const data=JSON.parse(await readFile(f,'utf8'));
  for(const t of data?.trainers||[])(t.classes||[]).forEach((cl,i)=>{const name=cl==='Shadowknight'?'Shadow Knight':cl;assert(Object.hasOwn(abbr,name),f+': unknown class '+cl);assert.equal(abbr[name],t.abbreviations[i],f+': '+cl);});
  for(const m of Array.isArray(data)?data:[]){assert.notEqual(m.category,'Shady merchant',f+': shady merchants are vendors');for(const cl of m.classes||[])assert(Object.hasOwn(abbr,cl),f+': unknown class '+cl);if(m.vendor)assert(vendorKinds.includes(m.vendor),f+': stored vendor kind is current: '+m.vendor);}}
 // A trainer's class: the wiki's tags or class field win over the name; other NPCs' tags never make them trainers;
 // a guess is left out; the wiki's Warrior is Fighter. A trainer covered by a chip is on the map.
 const [tc,ict,onMap,chipClasses]=vm.runInContext('[trainerClasses,isClassTrainer,trainerOnMap,mapTrainerClasses]',c),list=v=>JSON.stringify(v);
 assert.equal(list(tc({name:'Master Khaila',role:'trainer',tags:'Human · Enchanter'})),'["Enchanter"]');
 assert.equal(list(tc({name:'A monk instructor',role:'merchant',tags:'Human · Wizard'})),'["Wizard"]','The tags win over the name');
 assert.equal(list(tc({name:'A monk instructor',role:'merchant',tags:'Human'})),'["Monk"]','else the name');
 assert.equal(list(tc({name:'Gorr',role:'named',tags:'Named · Bat · Fighter'})),'[]');assert(!ict({name:'Gorr',role:'named',tags:'Named · Bat · Fighter'}),'A named mob with a class is no trainer');
 assert.equal(list(tc({name:'Old Brin',role:'trainer',class:'Warrior',tags:'Shadow Knight?'})),'["Fighter"]');
 assert.equal(list(tc({name:'Chahaya Tam',role:'trainer',tags:null})),'[]');
 const chips=chipClasses([],[{abbreviations:['BST','SHM']},{classes:['Enchanter']}]);
 assert(onMap({name:'A beastmaster instructor'},chips)&&onMap({name:'Master Khaila',role:'trainer',tags:'Human · Enchanter'},chips)&&!onMap({name:'A monk instructor'},chips)&&!onMap({name:'Chahaya Tam',role:'trainer'},chips));
 console.log('Class checks passed: every class on the maps has its abbreviation; trainer classes from tags and chips.');}
// Every script the pages load must at least parse (a slip in one stops the whole atlas).
for(const f of ['app.js','community.js','wiki-links.js','find.js','place-labels.js','icons.js','hidden-areas.js','world-zones.js','sheet-edge.js'])new vm.Script(await readFile(new URL('../'+f,import.meta.url),'utf8'),{filename:f});
console.log('Script checks passed: every page script parses.');

// The wiki-built features show only where the Monsters and Memories Wiki may be linked: on the atlas itself and inside
// that wiki; not inside the other wikis, nor on unknown sites.
{const c={window:{},location:{},document:{}};vm.createContext(c);vm.runInContext(await readFile(new URL('../wiki-links.js',import.meta.url),'utf8'),c);
 const shown=vm.runInContext('wikiSiteShown',c);
 assert.equal(shown('mnm-wiki',null),true);assert.equal(shown('mnm-wiki','monstersandmemories.wiki'),true);assert.equal(shown('mnm-wiki','www.monstersandmemories.wiki'),true);
 assert.equal(shown('mnm-wiki','monstersandmemories.miraheze.org'),false);assert.equal(shown('old-wiki','monstersandmemories.miraheze.org'),true);
 assert.equal(shown('mnm-wiki','monme.no'),false);assert.equal(shown('mnm-wiki','example.com'),false);assert.equal(shown('mnm-wiki',''),false);
 console.log('Embed checks passed: wiki features follow the embed link rules.');}

// An NPC wiki card keeps only the short facts, the wiki's summary and the first loot items with wiki pages (likeliest
// first), never the description; links must be wiki pages.
{const {card}=await import('./make-npc-cards.mjs');
 const c=card({name:'Night Terror',url:'https://monstersandmemories.wiki/npcs/night-terror',tags:'Named · Bat · Fighter',level:'8',race:'Bat',class:'Fighter',location:"'''Directions:''' by the loop",summary:'A bat.',description:'Long text',factions:[],quests:[{name:'Q',url:'https://monstersandmemories.wiki/quests/q'}],
  loot:[{name:'A',url:'https://monstersandmemories.wiki/items/a',dropRate:null},{name:'B',url:'https://monstersandmemories.wiki/items/b',dropRate:0.25},{name:'Evil',url:'https://evil.example/items/x',dropRate:.9},{name:'C',url:'https://monstersandmemories.wiki/items/c',dropRate:4},
   ...['d','e','f'].map(x=>({name:x.toUpperCase(),url:'https://monstersandmemories.wiki/items/'+x}))]});
 assert.equal(c.description,undefined);assert.equal(c.quests,undefined);assert.equal(c.location,'Directions: by the loop');
 assert.equal(JSON.stringify(c.loot.map(i=>i.name)),'["C","B","A","D","E"]');assert.equal(c.loot[0].dropRate,4);assert.equal(c.loot[1].dropRate,0.25,'Rates are percent already');assert.equal(c.lootCount,6);
 assert.equal(card({name:'X',url:'https://evil.example/npcs/x'}),null);
 console.log('Card checks passed: NPC cards keep short facts and wiki links only.');}

// Vendor kinds come from the wiki's merchants, in groups; a name says its kind, the longest words first.
{const c={};vm.createContext(c);vm.runInContext(await readFile(new URL('../wiki-links.js',import.meta.url),'utf8'),c);
 const [named,ok,group,now,legacy,types,sellsOk]=vm.runInContext('[vendorKindNamed,vendorKindOk,vendorGroupOf,vendorKindNow,vendorLegacy,sellTypes,sellsOk]',c);
 assert.equal(named('A bag merchant'),'Bag merchant');assert.equal(named('A used weapons dealer'),'Used weapons dealer');assert.equal(named('A reagent vendor (Wayfarers Hospice)'),'Reagent vendor');
 assert.equal(named('Butchers'),'Butcher');assert.equal(named('Marcus Aden'),'');assert.equal(group('Reagent vendor'),'Spells and reagents');
 assert(ok(undefined)&&ok('Bag merchant')&&!ok('Dragon seller'));
 for(const [old,current] of Object.entries(legacy)){assert(ok(old)&&ok(current));assert.equal(now(old),current);assert.equal(now(current),current);assert.equal(group(current),'Trade vendors');}
 assert.equal(Object.keys(legacy).length,16);assert.equal(now(undefined),undefined);assert.equal(now('Dye merchant'),'Dye merchant');assert.equal(now('Cobbler'),'Cobbler');assert.equal(now('Adventuring supplies'),'Adventuring supplies');
 assert(ok('Shady merchant'));assert.equal(group('Shady merchant'),'General goods');
 for(const name of ['A shady merchant','Fence','The black market'])assert.equal(named(name),'Shady merchant');
 assert(!ok(['Alchemy supplies'])&&!ok(null)&&!ok({}));
 for(const [name,kind] of [['A leatherworker','Leatherworking vendor'],['Leatherworking patterns','Leatherworking vendor'],['Leatherworking recipes','Leatherworking vendor'],['Blacksmithing schematics','Blacksmithing vendor'],['Tailoring patterns','Tailoring vendor'],['Tinkering schematics','Tinkering vendor']])assert.equal(named(name),kind);
 assert.equal(JSON.stringify(types),JSON.stringify(['Ammo','Armor','Bags','Food & drink','Jewelry','Materials','Mount gear','Quest items','Recipes','Shields','Spell scrolls','Weapons']));
 assert(sellsOk(undefined)&&sellsOk(['Recipes'])&&sellsOk(['Recipes','Materials'])&&sellsOk([...types]));
 for(const bad of [null,[],{},'Recipes',['recipes'],['Recipes','Recipes'],['Dragon eggs'],[1],[undefined],Array(1),Array(13).fill('Recipes')])assert(!sellsOk(bad),JSON.stringify(bad));
 console.log('Vendor checks passed: current and legacy kinds, recipe names, groups and Sells validation.');}

// Every copy of a note (its backup, its suggestion, the review bar) keeps the same optional fields for its kind.
{const c={};vm.createContext(c);vm.runInContext(await readFile(new URL('../wiki-links.js',import.meta.url),'utf8'),c);
 const extras=m=>JSON.parse(JSON.stringify(vm.runInContext('markerExtras',c)(m)));
 assert.deepEqual(extras({category:'Vendor',vendor:'Bag merchant',trade:'Cooking',classes:['Bard'],wiki:'https://monstersandmemories.wiki/npcs/x',wikiId:'npc-x'}),{wiki:'https://monstersandmemories.wiki/npcs/x',wikiId:'npc-x',vendor:'Bag merchant'});
 assert.deepEqual(extras({category:'Vendor',vendor:'Leatherworking supplies',sells:['Recipes','Materials']}),{vendor:'Leatherworking vendor',sells:['Materials','Recipes']});
 assert.deepEqual(extras({category:'Vendor',sells:[]}),{});assert.deepEqual(extras({category:'Vendor',sells:['Recipes']}),{sells:['Recipes']});
 assert.deepEqual(extras({category:'Class trainer',classes:['Cleric','Paladin'],vendor:'Baker',sells:['Recipes']}),{classes:['Cleric','Paladin']});
 assert.deepEqual(extras({category:'Tradeskill',trade:'Cooking',color:'#123456'}),{color:'#123456',trade:'Cooking'});
 assert.deepEqual(extras({category:'Vendor',noteType:'exit',arrow:'west',toMap:'scarwood',wiki:'https://monstersandmemories.wiki/npcs/x',vendor:'Baker',sells:['Recipes']}),{noteType:'exit',arrow:'west',toMap:'scarwood'});
 assert.deepEqual(extras({category:'Vendor',noteType:'label',arrow:'west',vendor:'Baker',sells:['Recipes']}),{noteType:'label'});
 for(const category of ['Personal','Bank','Tradeskill'])assert.deepEqual(extras({category,vendor:'Baker',sells:['Recipes']}),{});
 assert.deepEqual(extras({category:'Vendor',wikiId:'npc-x'}),{},'A wiki id only rides with its link');
 console.log('Marker field checks passed: each kind of note keeps its own fields.');}

// The app reads legacy notes through current kinds; item tags narrow vendors without hiding other categories.
{const app=await readFile(new URL('../app.js',import.meta.url),'utf8'),c={};vm.createContext(c);vm.runInContext(await readFile(new URL('../wiki-links.js',import.meta.url),'utf8'),c);
 vm.runInContext(app.slice(app.indexOf('const az='),app.indexOf('const baseCategories=')),c);
 Object.assign(c,{privateNoteFor:()=>'',privateNoteBox(){},privateNoteLine(){}});vm.runInContext(app.slice(app.indexOf('const classesOf='),app.indexOf('function copyButton(')),c);
 const [title,subtitle,named,kind,search,shown]=vm.runInContext('[markerTitle,markerSubtitle,vendorNamed,vendorKindFor,markerText,vendorShown]',c),pick=value=>{c.filter=value;vm.runInContext('vendorGroup=filter',c);};
 const merchant={name:'Kaela',category:'Vendor',note:'By the gate',vendor:'Leatherworking supplies',sells:['Recipes','Materials']},plain={name:'A leatherworker',category:'Vendor',note:'',vendor:'Leatherworking supplies'};
 assert.equal(title(merchant),'Leatherworking vendor');assert.equal(subtitle(merchant),'Kaela');assert.equal(kind(merchant),'Leatherworking vendor');assert(named(plain));assert.equal(title(plain),'A leatherworker');
 assert(search(merchant).includes('recipes')&&search(merchant).includes('materials')&&search(merchant).includes('trade vendors'));assert(!search({...merchant,category:'Bank'}).includes('recipes'));
 for(const filter of ['','g:Trade vendors','k:Leatherworking vendor','s:Recipes','s:Materials']){pick(filter);assert(shown(merchant),filter);}
 for(const filter of ['g:Food and drink','k:Alchemy vendor','s:Weapons']){pick(filter);assert(!shown(merchant),filter);}
 pick('s:Recipes');assert(!shown(plain));assert(!shown({...plain,sells:[]}));assert(shown({category:'Bank'}));pick('k:Leatherworking vendor');assert(shown({...plain,vendor:undefined}),'Kinds can still be read from the name');
 // Run the actual filter setup, keeping its optgroup order and values under test.
 class Node{constructor(tag){this.tagName=tag;this.children=[];this.dataset={};this.style={setProperty(){}};this.classList={contains:()=>false,add(){}};this.listeners={};this.value='';}append(...nodes){for(const n of nodes)n.parentElement=this;this.children.push(...nodes);}replaceChildren(...nodes){this.children=[];this.append(...nodes);}insertBefore(node,before){if(node.parentElement)node.parentElement.children=node.parentElement.children.filter(n=>n!==node);node.parentElement=this;this.children.splice(this.children.indexOf(before),0,node);}querySelectorAll(tag){return this.children.flatMap(n=>[...(n.tagName===tag?[n]:[]),...n.querySelectorAll(tag)]);}addEventListener(k,fn){(this.listeners[k]??=[]).push(fn);}dispatchEvent(e){for(const fn of this.listeners[e.type]||[])fn({target:this});}setAttribute(k,v){this[k]=v;}showModal(){this.open=true;}focus(){}}
 const select=new Node('select');c.document={createElement:tag=>new Node(tag),getElementById:()=>select};c.drawMarkers=()=>{};
 vm.runInContext(app.slice(app.indexOf('const $='),app.indexOf('// Vendor kinds in their groups')),c);
 const start=app.indexOf(" {const pick=$('vendor-filter-select');");vm.runInContext(app.slice(start,app.indexOf('\n',start)),c);
 const sells=select.children.at(-1);assert.equal(sells.label,'Sells');assert.deepEqual(sells.children.map(o=>[o.textContent,o.value]),['Ammo','Armor','Bags','Food & drink','Jewelry','Materials','Mount gear','Quest items','Recipes','Shields','Spell scrolls','Weapons'].map(t=>[t,'s:'+t]));
 select.value='s:Recipes';select.onchange();assert(shown(merchant)&&!shown(plain));
 // Import and save validation reject malformed tag arrays while still accepting old kinds.
 Object.assign(c,{config:{width:100,height:100},registry:{maps:[]},categories:{Vendor:[]},tradePaths:{},pinColours:{},exitArrows:{},validLevel:v=>v===undefined});
 vm.runInContext(app.slice(app.indexOf('function valid('),app.indexOf('function persist(')),c);const valid=vm.runInContext('valid',c),note={...merchant,id:'personal-vendor',x:10,y:20};
 assert(valid(note));assert(valid({...note,sells:undefined}));assert(valid({...note,category:'Shady merchant',vendor:undefined}),'Old-category notes remain valid');for(const sells of [[],['Recipes','Recipes'],['Unknown'],null,'Recipes'])assert(!valid({...note,sells}));
 // Open and save through the editor's real handlers, including a second note and a category change.
 const elements=new Map(),get=id=>{if(!elements.has(id))elements.set(id,new Node('div'));return elements.get(id);};
 c.document.getElementById=get;c.document.querySelectorAll=()=>[];c.document.querySelector=s=>s.includes('note-type')?{value:c.noteType||'marker'}:null;
 Object.assign(c,{URL,personal:[],draft:null,window:{dispatchEvent(){}},CustomEvent:class{constructor(type,options){this.type=type;this.detail=options?.detail;}},registry:{maps:[]},categories:{Vendor:[],Personal:[]},enabled:new Set(),persist(rows){c.personal=rows;return true;},keepInSnapshot(){},closeEditor(){c.draft=null;},cancelPlacement(){},setupCategoryControls(){},buildPlaceIndex(){},refreshSearch(){},choose(){},status(){}});
 vm.runInContext(app.slice(app.indexOf('function noteTypeValue('),app.indexOf('function closeEditor(')),c);
 Object.assign(c,{structuredClone,Event:class{constructor(type){this.type=type;}},categoryChoices:()=>Object.keys(c.categories),travelKind:()=>'',travelSvg:()=>new Node('svg')});vm.runInContext(await readFile(new URL('../marker-fields.js',import.meta.url),'utf8'),c);
 c.noteFields=c.window.atlasFields.build(new Node('div'),{personal:true,mode:vm.runInContext('noteTypeValue',c),ids:{name:'name',category:'category',trade:'trade',classes:'trainer-class',vendor:'vendor-kind',sells:'sells-chips',note:'note',wiki:'wiki'}});
 for(const el of Object.values(c.noteFields.controls))elements.set(el.id,el);for(const [key,id] of [['sells','sells-field'],['vendor','vendor-field'],['trade','trade-field'],['classes','class-field'],['wiki','wiki-field']])elements.set(id,c.noteFields.boxes[key]);
 const saveStart=app.indexOf(" $('marker-form').onsubmit=");vm.runInContext(app.slice(saveStart,app.indexOf("\n $('delete').onclick=",saveStart)),c);
 const open=vm.runInContext('openEditor',c),save=()=>get('marker-form').onsubmit({preventDefault(){}}),tags=get('sells-chips').querySelectorAll('input');
 open(note);assert.equal(get('vendor-kind').value,'Leatherworking vendor');assert(!get('sells-field').hidden);assert.deepEqual(tags.filter(t=>t.checked).map(t=>t.value),['Materials','Recipes']);
 save();assert.equal(c.personal[0].vendor,'Leatherworking vendor');assert.equal(JSON.stringify(c.personal[0].sells),'["Materials","Recipes"]');
 open({...note,sells:undefined});assert(!tags.some(t=>t.checked),'Opening another note clears previous chips');save();assert(!Object.hasOwn(c.personal[0],'sells'));
 open({...note,category:'Shady merchant',vendor:undefined});assert.equal(get('category').value,'Vendor');assert.equal(get('vendor-kind').value,'Shady merchant');save();assert.equal(c.personal[0].category,'Vendor');assert.equal(c.personal[0].vendor,'Shady merchant');
 open(note);get('category').value='Personal';vm.runInContext('updateEditorFields()',c);assert(get('sells-field').hidden&&get('vendor-field').hidden);save();assert(!Object.hasOwn(c.personal[0],'vendor')&&!Object.hasOwn(c.personal[0],'sells'));
 c.noteType='label';open(note);assert(get('sells-field').hidden&&get('vendor-field').hidden);
 // A popup places the short Sells line below the kind and name, including with a wiki card.
 Object.assign(c,{npcCardFor:()=>null,noteKind:m=>m.category,wikiButton:()=>null,copyButton:()=>new Node('button'),alignmentPositions:{},singleMap:true,tidyActions:n=>n});
 c.matchMedia=()=>({matches:true});vm.runInContext(app.slice(app.indexOf('const markerHover='),app.indexOf('// NPC wiki cards')),c);
 const hover=vm.runInContext('markerHoverCard',c),values=n=>n.children.map(x=>x.textContent),publishedVendor={...note,id:'published'};
 assert.deepEqual(values(hover(publishedVendor)),['Vendor','Leatherworking vendor','Kaela','Sells: Materials · Recipes','By the gate']);
 assert.deepEqual(values(hover({id:'smith',name:'Master Khaila',category:'Tradeskill',trade:'Blacksmithing',note:'By the forge\nSecond line'})),['Tradeskill','Blacksmithing','Master Khaila','Blacksmithing','By the forge']);
 assert.deepEqual(values(hover({id:'trainer',name:'Rell',category:'Class trainer',classes:['Bard'],note:''})),['Class trainer','Bard trainer','Rell','Bard']);
 const long=hover({...publishedVendor,note:'x'.repeat(130)+'\nHidden line'}).children.find(n=>n.className==='hover-note');assert.equal(long.textContent,'x'.repeat(119)+'…');
 const waiting={rows:[{status:'pending',fields:new Set(['name'])}],proposed:{name:'New Kaela'}};
 assert.equal(values(hover(publishedVendor,waiting)).at(-1),'1 change waiting · Coming name: New Kaela');
 assert.equal(values(hover(publishedVendor,{rows:[{status:'approved'},{status:'approved'}]})).at(-1),'2 changes approved, not live yet');
 assert.equal(values(hover({...publishedVendor,vendor:'Shady merchant'}))[3],'Buys anything; sells what players have sold to it.');
 let lazy,stateCalls=0;const pin={bindTooltip(content,options){lazy=content;this.options=options;return this;}},bind=vm.runInContext('bindMarkerTooltip',c);
 bind(pin,publishedVendor,()=>{stateCalls++;return waiting;});assert.equal(stateCalls,0);assert.equal(typeof lazy,'function');assert.deepEqual(Array.from(pin.options.offset),[0,-23]);assert.equal(values(lazy()).at(-1),'1 change waiting · Coming name: New Kaela');assert.equal(stateCalls,1);
 vm.runInContext('markerHover.matches=false',c);assert.equal(lazy().textContent,'Leatherworking vendor');assert.equal(stateCalls,1,'Touch tooltips never look up change state');
 lazy=null;bind(pin,{...publishedVendor,noteType:'exit'});assert.equal(lazy,null);bind(pin,{...publishedVendor,noteType:'label'});assert.equal(lazy,null);
 console.log('Hover checks passed: vendor stock, trade and NPC name, trainer class, first-line limit, waiting rename, approved counts, lazy content and touch fallback.');
 vm.runInContext(app.slice(app.indexOf('function popup('),app.indexOf('function labelEditPopup(')),c);const popup=vm.runInContext('popup',c),published={...note,id:'published'};
 const card=popup(published);assert.equal(card.children[1].textContent,'Leatherworking vendor');assert.equal(card.children[2].textContent,'Kaela');assert.equal(card.children[3].textContent,'Sells: Materials · Recipes');
 assert(!popup({...published,sells:undefined}).children.some(n=>n.className==='marker-sells'));assert(!popup({...published,category:'Personal'}).children.some(n=>n.className==='marker-sells'));
 c.npcCardFor=()=>({url:'https://monstersandmemories.wiki/npcs/kaela'});c.titleLevel=name=>({name});c.npcCard=()=>new Node('section');assert.equal(popup(published).children[3].textContent,'Sells: Materials · Recipes');
 console.log('App vendor checks passed: legacy titles, tag search, kind and Sells filters, optgroups, validation, editor saves and popups.');}

// Older local notes and backups become Vendor notes without losing their fields or mutating the source.
{const app=await readFile(new URL('../app.js',import.meta.url),'utf8'),saved=new Map(),elements=new Map(),c={URL};vm.createContext(c);
 vm.runInContext(await readFile(new URL('../wiki-links.js',import.meta.url),'utf8'),c);vm.runInContext(await readFile(new URL('../icons.js',import.meta.url),'utf8'),c);
 vm.runInContext(app.slice(app.indexOf('const baseCategories='),app.indexOf('const mobileLayout=')),c);vm.runInContext('categories={...allCategories}',c);
 const normalise=vm.runInContext('normaliseMarker',c),old={id:'personal-shady',name:'Mira',category:'Shady merchant',note:'By the gate',x:10,y:20,approximate:true,wiki:'https://monstersandmemories.wiki/npcs/mira',wikiId:'npc-mira',sells:['Materials']},current=normalise(old);
 assert.deepEqual(JSON.parse(JSON.stringify(current)),{...old,category:'Vendor',vendor:'Shady merchant'});assert.equal(old.category,'Shady merchant');assert.equal(normalise(current),current);assert.equal(normalise(null),null);assert.equal(normalise(undefined),undefined);
 assert.equal(normalise({...old,vendor:'Baker'}).vendor,'Shady merchant','The old category determines its kind');assert(!vm.runInContext("Object.hasOwn(categories,'Shady merchant')||Object.hasOwn(categoryPaths,'Shady merchant')",c));
 Object.assign(c,{config:{id:'test-map',title:'Test map',tileRevision:'v1',width:100,height:100,levels:[{id:'lower'}],defaultLevel:'lower'},registry:{maps:[]},personal:[],publishedPositions:new Map(),publishedLabelPositions:new Map(),alignmentMode:false,editSnapshot:null,
  localStorage:{getItem:k=>saved.get(k)||null},storageKey:k=>k,validLevel:v=>v===undefined||v==='lower',restorePrivate(){},recoverPrivateTargets(){},migratePreviousStorage(){},applyOverrides(){},status(){},setupCategoryControls(){},buildPlaceIndex(){},drawMarkers(){},persist(rows){c.personal=rows;return true;},$:id=>{if(!elements.has(id))elements.set(id,{});return elements.get(id);}});
 vm.runInContext(app.slice(app.indexOf('function valid('),app.indexOf('function persist(')),c);vm.runInContext(app.slice(app.indexOf('function restoreStorage('),app.indexOf('let labelData=')),c);
 saved.set('notes',JSON.stringify([old]));vm.runInContext('restoreStorage()',c);assert.equal(c.personal.length,1);assert.deepEqual(JSON.parse(JSON.stringify(c.personal[0])),{...current,level:'lower'});
 vm.runInContext(app.slice(app.indexOf('async function importNotes('),app.indexOf('// The types a note')),c);
 await vm.runInContext('importNotes',c)({size:500,text:async()=>JSON.stringify({version:1,map:'test-map',tileRevision:'v1',markers:[{...old,id:'personal-backup'}]})});
 const imported=c.personal.find(m=>m.id==='personal-backup');assert.equal(imported.category,'Vendor');assert.equal(imported.vendor,'Shady merchant');assert.equal(imported.wikiId,old.wikiId);assert.equal(JSON.stringify(imported.sells),'["Materials"]');
 Object.assign(c,{privateNoteFor:()=>'',privateNoteBox(){},privateNoteLine(){}});vm.runInContext(app.slice(app.indexOf('const classesOf='),app.indexOf('function copyButton(')),c);c.m=current;
 assert.equal(vm.runInContext('markerTitle(m)',c),'Shady merchant');assert(vm.runInContext("markerText(m).includes('fence')&&markerText(m).includes('black market')",c));
 for(const filter of ['g:General goods','k:Shady merchant']){c.filter=filter;assert(vm.runInContext('vendorGroup=filter;vendorShown(m)',c));}
 c.filter='k:Baker';assert(!vm.runInContext('vendorGroup=filter;vendorShown(m)',c));
 vm.runInContext(app.slice(app.indexOf('const categoryChoices='),app.indexOf('function setupCategoryControls(')),c);assert(!vm.runInContext('categoryChoices()',c).includes('Shady merchant'));
 const node=()=>({children:[],style:{setProperty(k,v){this[k]=v;}},setAttribute(k,v){this[k]=v;},append(n){this.children.push(n);}});c.document={createElementNS:node};c.text=node;c.L={divIcon:options=>options};
 vm.runInContext(app.slice(app.indexOf('function pinIcon('),app.indexOf('function openMap(')),c);const pin=vm.runInContext('pinIcon(m)',c);
 assert.equal(pin.html.style['--pin'],vm.runInContext('categories.Vendor[1]',c));assert.equal(pin.html.children[0].children[0].d,vm.runInContext('categoryPaths.Vendor',c));
 console.log('Shady merchant checks passed: compatibility, local loading, backup import, editor, vocabulary, filters and Vendor appearance.');}

// Camp displays combine the known cards only, with page identity, rates and every source.
{
 const app=await readFile(new URL('../app.js',import.meta.url),'utf8'),c={URL,window:{},location:{},document:{},config:{id:'camp'},structuredClone,matchMedia:()=>({matches:true})};vm.createContext(c);vm.runInContext(await readFile(new URL('../wiki-links.js',import.meta.url),'utf8'),c);
 vm.runInContext(app.slice(app.indexOf('function titleLevel('),app.indexOf('function npcCard(c')),c);vm.runInContext(app.slice(app.indexOf('function campLoot('),app.indexOf('function popup(m)')),c);
 const [range,caption,loot]=vm.runInContext('[campLevels,levelsText,campLoot]',c),plain=v=>JSON.parse(JSON.stringify(v));
 for(const [name,wanted] of [['Goblins (levels 11–15)',[11,15]],['Orcs (level 20+)',[20,null]],['Rats (level 3)',[3,3]],['Rats (levels 0–100)',null],['Camp',null]])assert.deepEqual(plain(range({name})),wanted);
 assert.equal(caption([20,null]),'Levels 20+');assert.deepEqual(plain(range({name:'Camp (level 8)',levels:[12,16]})),[12,16]);
 const mob=(name,id)=>({name,wikiId:'npc-'+id,wiki:'https://monstersandmemories.wiki/npcs/'+id}),m={category:'Mob camp',name:'Goblin camp',mobs:[mob('Goblin','g'),mob('Shaman','s'),mob('Missing','m')]},item=(id,rate)=>({name:id.toUpperCase(),url:'https://monstersandmemories.wiki/items/'+id,...(rate===undefined?{}:{dropRate:rate})});
 const cards={'npc-g':{loot:[item('a',4),item('unknown'),...Array.from({length:8},(_,i)=>item('item-'+i,i))]},'npc-s':{loot:[item('a',12),item('other',.5),{...item('a',8),url:'https://monstersandmemories.wiki/items/a#loot'}, {...item('evil',100),url:'https://evil.example/items/evil'}]}};
 const all=plain(loot(m,cards,null));assert.equal(all.length,11);assert.equal(all[0].name,'A');assert.equal(all[0].dropRate,12);assert.deepEqual(all[0].mobs.map(x=>x.name),['Goblin','Shaman']);assert.equal(all.at(-1).name,'UNKNOWN');assert.deepEqual(plain(loot(m,cards,'monme.no')),[]);assert.deepEqual(plain(loot(m,null,null)),[]);
 class Node{constructor(tag,value='',cls=''){this.tag=tag;this.textContent=value;this.className=cls;this.children=[];}append(...v){this.children.push(...v);}}
 const nodes=n=>[n,...n.children.flatMap(nodes)];Object.assign(c,{text:(...a)=>new Node(...a),externalLink:(name,href,cls)=>Object.assign(new Node('a',name,cls),{href}),npcCardFor:()=>null,npcCards:{map:'camp',cards},document:{createElement:tag=>new Node(tag)}});
 const card=vm.runInContext('campCard',c)({...m,levels:[11,15]}),parts=nodes(card);assert(parts.some(x=>x.textContent==='Levels 11–15'));assert.equal(parts.filter(x=>x.className==='camp-drop').length,5);assert(parts.some(x=>x.textContent==='+6 more'));assert(!parts.some(x=>x.className==='camp-sources'),'Camp loot lists what the camp drops, not which mob drops it');assert(parts.some(x=>x.textContent==='Data from the Monsters and Memories Wiki'));assert(parts.some(x=>x.textContent==='Goblin'&&x.href===m.mobs[0].wiki));
 Object.assign(c,{privateNoteFor:()=>'',privateNoteBox(){},privateNoteLine(){}});vm.runInContext(app.slice(app.indexOf('const classesOf='),app.indexOf('function copyButton(')),c);assert(vm.runInContext('markerText',c)(m).includes('shaman'));assert.equal(vm.runInContext('markerTitle',c)({...m,name:'Goblins (levels 11–15)'}),'Goblins');assert.equal(vm.runInContext('markerSubtitle',c)(m),'');
 // Both actual surfaces use the same camp card; opening the first card loads the local cache once.
 Object.assign(c,{singleMap:true,registry:{maps:[]},alignmentPositions:{},button:(name,action,cls)=>new Node('button',name,cls),copyButton:()=>new Node('button','Copy link'),wikiButton:()=>null,tidyActions:n=>n,noteKind:x=>x.category});
 vm.runInContext(app.slice(app.indexOf('const markerHover='),app.indexOf('// NPC wiki cards')),c);vm.runInContext(app.slice(app.indexOf('function popup(m)'),app.indexOf('function labelEditPopup(')),c);
 const look={...m,id:'camp-pin',levels:[11,15]},popup=vm.runInContext('popup',c)(look),hover=vm.runInContext('markerHoverCard',c)(look);for(const surface of [popup,hover])assert(nodes(surface).some(x=>x.textContent==='Levels 11\u201315'));assert(nodes(popup).some(x=>x.textContent==='Loot'));assert(!nodes(hover).some(x=>x.textContent==='Loot'),'The hover card stays short: loot is in the popup');assert(nodes(hover).some(x=>x.textContent==='Click for all mobs and their loot.'));
 const named={id:'named-pin',category:'Named mob',name:'Captain',note:'',levels:[8,8]},[namedRange,namedText,ok]=vm.runInContext('[namedLevels,namedLevelText,levelsOk]',c);
 for(const [name,wanted] of [['Captain (level 8)',[8,8]],['Captain (level 4 or 5)',[4,5]],['Captain (levels 4–5)',[4,5]],['Captain (level 100)',null],['Captain (level 0)',null],['Captain',null]]){const legacy={...named,name};delete legacy.levels;const before=JSON.stringify(legacy);assert.deepEqual(plain(namedRange(legacy)),wanted);assert.equal(JSON.stringify(legacy),before,'Name parsing never writes levels');if(wanted)assert.equal(namedText(legacy),'Level '+wanted[0]+(wanted[0]===wanted[1]?'':'–'+wanted[1]));}
 assert.deepEqual(plain(namedRange({...named,name:'Captain (level 4)'})),[8,8]);assert(ok([1,1],'Named mob')&&ok([99,99],'Named mob'));for(const v of [[8,9],[8,null],[0,0],[100,100],[8.5,8.5],[8],'8'])assert(!ok(v,'Named mob'));
 assert.deepEqual(plain(vm.runInContext('markerExtras',c)({...named,mobs:m.mobs})),{levels:[8,8]});assert.deepEqual(plain(vm.runInContext('markerExtras',c)({...named,noteType:'label'})),{noteType:'label'});assert.deepEqual(plain(vm.runInContext('normaliseChange',c)({kind:'new-marker',payload:{...named,x:10,y:20}}).payload.levels),[8,8]);
 vm.runInContext(app.slice(app.indexOf('const markerDetail='),app.indexOf('function drawMarkers(')),c);
 for(const one of [named,{...named,name:'Captain (level 4 or 5)',levels:undefined}]){const level=namedText(one);for(const surface of [vm.runInContext('popup',c)(one),vm.runInContext('markerHoverCard',c)(one)])assert(nodes(surface).some(x=>x.textContent===level));assert(vm.runInContext('markerText',c)(one).includes(level.toLowerCase()));assert(vm.runInContext('markerDetail',c)(one).includes(level));assert.equal(vm.runInContext('markerTitle',c)(one),'Captain');assert.equal(vm.runInContext('markerSubtitle',c)(one),'');}
 vm.runInContext(app.slice(app.indexOf('function npcCard(c,m)'),app.indexOf('// Camp loot')),c);c.npcCardFor=()=>({url:'https://monstersandmemories.wiki/npcs/captain',level:'20',tags:'Named · Human',race:'Human'});const wikiPopup=vm.runInContext('popup',c)(named);assert(nodes(wikiPopup).some(x=>x.textContent==='Level 8'));assert(!nodes(wikiPopup).some(x=>x.textContent==='20'),'Stored level takes priority over wiki cards');c.npcCardFor=()=>null;
 console.log('Named mob display checks passed: legacy suffixes, alternatives, fixed levels, popup, hover, search, wiki priority and unchanged data.');
 let calls=0,refreshed=null;c.fetch=async url=>{assert.equal(url,'npc-cards/camp.json');calls++;return {ok:true,json:async()=>({cards})};};c.allMarkers=()=>[look];c.pins=new Map([['camp-pin',{setPopupContent(){},isPopupOpen:()=>false,getPopup:()=>null,getTooltip:()=>({isOpen:()=>true}),setTooltipContent:n=>refreshed=n}]]);c.fixtureCards=cards;
 vm.runInContext(app.slice(app.indexOf('let npcCards='),app.indexOf('// A popup with a card')),c);vm.runInContext('npcCardFor',c)(look);vm.runInContext('npcCardFor',c)(look);for(let i=0;i<6;i++)await Promise.resolve();assert.equal(calls,1);assert(refreshed&&nodes(refreshed).some(x=>/^Levels 11/.test(x.textContent)),'An open hover card is refreshed when the cards arrive');assert.equal(vm.runInContext('npcCardFor',c)(look),null,'A camp never becomes one NPC card');

 const water={id:'water',name:'Fishing',category:'Fishing spot',note:'',fish:[{name:'Thorn Sturgeon',wikiId:'item-thorn-sturgeon',wiki:'https://monstersandmemories.wiki/items/thorn-sturgeon'},{name:'Basa'},{name:'Grouper'},{name:'Whitefish'}]};
 const fishCard=nodes(vm.runInContext('campCard',c)(water));assert(fishCard.some(x=>x.textContent==='Fish'));assert(fishCard.some(x=>x.textContent==='Basa'&&x.tag==='span'));assert(fishCard.some(x=>x.textContent==='Thorn Sturgeon'&&x.href===water.fish[0].wiki));assert(!fishCard.some(x=>x.textContent==='Loot'));assert(vm.runInContext('markerText',c)(water).includes('thorn sturgeon'));
 const short=nodes(vm.runInContext('markerHoverCard',c)(water));assert(short.some(x=>x.textContent==='Thorn Sturgeon, Basa, Grouper and 1 more'));assert(nodes(vm.runInContext('popup',c)(water)).some(x=>x.textContent==='Fish'));
 assert.equal(vm.runInContext('markerSubtitle',c)({category:'Passage',way:'Swim',oneWay:true}),'Passage'+String.fromCharCode(0x20,0xb7,0x20)+'Swim'+String.fromCharCode(0x20,0xb7,0x20)+'One way');
 console.log('Fishing display checks passed: linked/plain fish roster, no loot, hover limit, popup and local search.');

 console.log('Camp display checks passed: parsed ranges, mob-name search, shared loot pages, highest rates, sources, eight items, more count and embed rules.');
}
// Card publishing follows camp mob ids through the same cache and paced requests, with a fake wiki.
{
 const {mkdtemp,mkdir,writeFile,rm}=await import('node:fs/promises'),{resolve,relative,sep}=await import('node:path'),{fileURLToPath}=await import('node:url'),{buildCards}=await import('./make-npc-cards.mjs');
 const root=fileURLToPath(new URL('..',import.meta.url)),folder=await mkdtemp(resolve(root,'scripts/.camp-cards-test-'));try{
  await mkdir(resolve(folder,'data'));await writeFile(resolve(folder,'data/maps.json'),JSON.stringify({maps:[{id:'camp',markersFile:'data/markers.json'}]}));await writeFile(resolve(folder,'data/markers.json'),JSON.stringify([{wikiId:'npc-one',category:'Named mob'},{category:'Mob camp',mobs:[{wikiId:'npc-two'},{wikiId:'npc-one'},{wikiId:'npc-cached'},{wikiId:'bad'}]}]));
  const asks=[],waits=[],cached={name:'Cached mob',url:'https://monstersandmemories.wiki/npcs/cached',level:'20',at:Date.now(),loot:[{name:'Sword',url:'https://monstersandmemories.wiki/items/sword',dropRate:5}]};
  const fetcher=async url=>{asks.push(url);if(url==='http://fixture/npc-cards/camp.json')return {ok:true,json:async()=>({cards:{'npc-cached':cached}})};assert(url.startsWith('https://monstersandmemories.wiki/api/partner/v1/npc/'));const id=url.split('/').at(-1);return {ok:true,json:async()=>({npc:{name:id,url:'https://monstersandmemories.wiki/npcs/'+id,level:'12–15',loot:[{name:'Sword',url:'https://monstersandmemories.wiki/items/sword',dropRate:8}]}})};};
  await buildCards({root:folder,secret:'fixture',fetcher,sleep:async ms=>waits.push(ms),site:'http://fixture/'});const result=JSON.parse(await readFile(resolve(folder,'npc-cards/camp.json'),'utf8'));assert.deepEqual(Object.keys(result.cards),['npc-one','npc-two','npc-cached']);assert.deepEqual(result.cards['npc-cached'],cached);assert.equal(result.cards['npc-two'].level,'12–15');assert.equal(result.cards['npc-two'].loot[0].dropRate,8);assert.equal(asks.length,3);assert(waits.length&&waits.every(ms=>ms>0&&ms<=700));
 }finally{assert(relative(root,folder).startsWith('scripts'+sep+'.camp-cards-test-'));await rm(folder,{recursive:true,force:true});}
 console.log('Camp card fetch checks passed: additional ids, duplicate ids, shared pacing, fresh cache and fake wiki cards.');
}

{
 const c={URL,structuredClone};vm.createContext(c);vm.runInContext(await readFile(new URL('../wiki-links.js',import.meta.url),'utf8'),c);const [fishOk,wayOk,extras,normal]=vm.runInContext('[fishOk,wayOk,markerExtras,normaliseChange]',c),plain=v=>JSON.parse(JSON.stringify(v));
 const item={name:'Thorn Sturgeon',wikiId:'item-thorn-sturgeon',wiki:'https://monstersandmemories.wiki/items/thorn-sturgeon'};
 assert(fishOk([])&&fishOk([{name:'Basa'}])&&fishOk([item])&&fishOk([{name:'Basa',wikiId:'item-basa'}])&&fishOk([{name:'Basa',wiki:item.wiki}]));assert(fishOk(Array.from({length:12},(_,i)=>({name:'Fish '+i}))));
 for(const bad of [null,{},'Basa',Array(1),Array.from({length:13},(_,i)=>({name:'Fish '+i})),[{name:''}],[{name:' '.repeat(3)}],[{name:'x'.repeat(101)}],[{name:'Basa',extra:true}],[{...item,wikiId:'npc-fish'}],[{...item,wikiId:''}],[{...item,wikiId:null}],[{...item,wiki:'https://evil.example/items/fish'}],[{...item,wiki:'https://monstersandmemories.wiki/npcs/fish'}],[item,{...item,name:'Other'}],[{name:'Basa'},{name:'bAsA'}]])assert(!fishOk(bad),JSON.stringify(bad));
 for(const way of ['Tunnel','Swim','Climb','Drop','Secret'])assert(wayOk(way));for(const bad of ['',null,1,'Walk','swim'])assert(!wayOk(bad));
 assert.deepEqual(plain(extras({category:'Fishing spot',fish:[item],way:'Swim',oneWay:true})),{fish:[item]});assert.deepEqual(plain(extras({category:'Passage',fish:[item],way:'Swim',oneWay:false})),{way:'Swim',oneWay:false});assert.deepEqual(plain(extras({category:'Vendor',fish:[item],way:'Swim',oneWay:true})),{});
 const cleaned=normal({kind:'new-marker',payload:{name:'Water',category:'Fishing spot',fish:[{name:' Basa <fish> '+String.fromCharCode(0x200b)}],x:1,y:2}});assert.deepEqual(plain(cleaned.payload.fish),[{name:'Basa fish'}]);
 index.push({n:'Fishing',m:'shaded-dunes',p:'water-1',k:'Fishing spot',f:['Thorn Sturgeon','Basa']},{n:'Fishing',m:'shaded-dunes',p:'water-2',k:'Fishing spot',f:['Thorn Sturgeon']});assert.deepEqual(ids('Thorn Sturgeon'),['water-1','water-2']);assert.deepEqual(ids('sturgeon'),['water-1','water-2']);
 const builder=await readFile(new URL('./make-share-pages.mjs',import.meta.url),'utf8'),block=builder.slice(builder.indexOf('{const index=[]'),builder.indexOf('const template=')),built=[],maps={maps:[{id:'waters',markersFile:'water.json'}]};
 await vm.runInNewContext('(async()=>'+block+')()', {registry:maps,root:'',resolve:(r,f)=>f,readFile:async()=>JSON.stringify([{id:'water',name:'Fishing',category:'Fishing spot',fish:[item]}]),writeFile:async(f,v)=>built.push(...JSON.parse(v)),console:{log(){}}});assert.deepEqual([...built[0].f],['Thorn Sturgeon']);
 console.log('Fishing and Passage checks passed: fish validation, optional item links, limits, duplicates, cleaning, type fields and fish-name find index.');
}

{
 class Node{constructor(tag,value='',cls=''){this.tagName=tag;this.textContent=value;this.className=cls;this.children=[];this.attrs={};this.style={setProperty:(k,v)=>this.attrs[k]=v};}append(...v){this.children.push(...v);}setAttribute(k,v){this.attrs[k]=v;}}
 const app=await readFile(new URL('../app.js',import.meta.url),'utf8'),c={URL,structuredClone,text:(...v)=>new Node(...v),document:{createElementNS:(ns,tag)=>new Node(tag)},L:{divIcon:v=>v},window:{},config:{width:100,height:100},registry:{maps:[]},validLevel:v=>v===undefined};vm.createContext(c);
 for(const name of ['wiki-links.js','icons.js','changes.js'])vm.runInContext(await readFile(new URL('../'+name,import.meta.url),'utf8'),c);vm.runInContext(app.slice(app.indexOf('const baseCategories='),app.indexOf('const mobileLayout=')),c);vm.runInContext('categories={...allCategories}',c);
 vm.runInContext(app.slice(app.indexOf('function pinIcon('),app.indexOf('function openMap(')),c);vm.runInContext(app.slice(app.indexOf('function valid('),app.indexOf('function persist(')),c);
 const [symbol,pin,valid,paths]=vm.runInContext('[markerSymbol,pinIcon,valid,passagePaths]',c);assert.equal(new Set(Object.values(paths)).size,6);
 for(const way of [undefined,'Tunnel','Swim','Climb','Drop','Secret']){const m={id:'personal-passage',name:'Passage',category:'Passage',note:'',x:10,y:20,...(way?{way}:{})},face=symbol(m),seal=pin(m);assert.equal(face.children[0].tagName,'svg');assert.equal(face.children[0].attrs['stroke-width'],'2');assert.equal(face.children[0].children[0].attrs.d,paths[way||'Passage']);assert(seal.className.includes('level-pin'));assert.equal(seal.html.attrs['--pin'],'#64795b');assert(valid(m));}
 const m={category:'Passage',oneWay:true};assert.equal(symbol(m).children[1].textContent,String.fromCharCode(0x2192));assert.equal(symbol({...m,direction:'east'}).children[1].textContent,String.fromCharCode(0x2192));assert.equal(symbol({...m,toLevel:'lower',direction:'down'}).children[1].textContent,String.fromCharCode(0x2913));
 const base={id:'personal-fishing',name:'Fishing',category:'Fishing spot',note:'',x:20,y:20,fish:[{name:'Basa'}],shape:{kind:'area',form:'rect',points:[[10,10],[30,10],[30,30],[10,30]]}};assert(valid(base));assert(!valid({...base,category:'Bank'}));assert(!valid({...base,noteType:'label'}));assert(!valid({...base,fish:[{name:''}]}));
 const passage={...base,category:'Passage',fish:undefined,way:'Swim',oneWay:true};assert(valid(passage));for(const bad of [{way:'Walk'},{oneWay:'yes'},{category:'Bank'},{noteType:'exit'}])assert(!valid({...passage,...bad}));
 assert(!vm.runInContext("privateOnlyCategories.has('Fishing spot')",c));assert.equal(vm.runInContext("categoryPaths['Fishing spot']===tradePaths.Fishing",c),true);
 console.log('Passage symbol checks passed: six pictograms, green seals, compass/fallback arrows, floor direction and personal field validation.');
}
