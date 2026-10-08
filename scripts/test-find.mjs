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
  for(const m of Array.isArray(data)?data:[]){for(const cl of m.classes||[])assert(Object.hasOwn(abbr,cl),f+': unknown class '+cl);if(m.vendor)assert(vendorKinds.includes(m.vendor),f+': stored vendor kind is current: '+m.vendor);}}
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
 vm.runInContext(app.slice(app.indexOf('const classesOf='),app.indexOf('function copyButton(')),c);
 const [title,subtitle,named,kind,search,shown]=vm.runInContext('[markerTitle,markerSubtitle,vendorNamed,vendorKindFor,markerText,vendorShown]',c),pick=value=>{c.filter=value;vm.runInContext('vendorGroup=filter',c);};
 const merchant={name:'Kaela',category:'Vendor',note:'By the gate',vendor:'Leatherworking supplies',sells:['Recipes','Materials']},plain={name:'A leatherworker',category:'Vendor',note:'',vendor:'Leatherworking supplies'};
 assert.equal(title(merchant),'Leatherworking vendor');assert.equal(subtitle(merchant),'Kaela');assert.equal(kind(merchant),'Leatherworking vendor');assert(named(plain));assert.equal(title(plain),'A leatherworker');
 assert(search(merchant).includes('recipes')&&search(merchant).includes('materials')&&search(merchant).includes('trade vendors'));assert(!search({...merchant,category:'Bank'}).includes('recipes'));
 for(const filter of ['','g:Trade vendors','k:Leatherworking vendor','s:Recipes','s:Materials']){pick(filter);assert(shown(merchant),filter);}
 for(const filter of ['g:Food and drink','k:Alchemy vendor','s:Weapons']){pick(filter);assert(!shown(merchant),filter);}
 pick('s:Recipes');assert(!shown(plain));assert(!shown({...plain,sells:[]}));assert(shown({category:'Bank'}));pick('k:Leatherworking vendor');assert(shown({...plain,vendor:undefined}),'Kinds can still be read from the name');
 // Run the actual filter setup, keeping its optgroup order and values under test.
 class Node{constructor(tag){this.tagName=tag;this.children=[];this.dataset={};this.style={setProperty(){}};this.classList={contains:()=>false};this.value='';}append(...nodes){for(const n of nodes)n.parentElement=this;this.children.push(...nodes);}replaceChildren(...nodes){this.children=[];this.append(...nodes);}querySelectorAll(tag){return this.children.flatMap(n=>[...(n.tagName===tag?[n]:[]),...n.querySelectorAll(tag)]);}setAttribute(k,v){this[k]=v;}showModal(){this.open=true;}focus(){}}
 const select=new Node('select');c.document={createElement:tag=>new Node(tag),getElementById:()=>select};c.drawMarkers=()=>{};
 vm.runInContext(app.slice(app.indexOf('const $='),app.indexOf('// Vendor kinds in their groups')),c);
 const start=app.indexOf(" {const pick=$('vendor-filter-select');");vm.runInContext(app.slice(start,app.indexOf('\n',start)),c);
 const sells=select.children.at(-1);assert.equal(sells.label,'Sells');assert.deepEqual(sells.children.map(o=>[o.textContent,o.value]),['Ammo','Armor','Bags','Food & drink','Jewelry','Materials','Mount gear','Quest items','Recipes','Shields','Spell scrolls','Weapons'].map(t=>[t,'s:'+t]));
 select.value='s:Recipes';select.onchange();assert(shown(merchant)&&!shown(plain));
 // Import and save validation reject malformed tag arrays while still accepting old kinds.
 Object.assign(c,{config:{width:100,height:100},registry:{maps:[]},categories:{Vendor:[]},tradePaths:{},pinColours:{},exitArrows:{},validLevel:v=>v===undefined});
 vm.runInContext(app.slice(app.indexOf('function valid('),app.indexOf('function persist(')),c);const valid=vm.runInContext('valid',c),note={...merchant,id:'personal-vendor',x:10,y:20};
 assert(valid(note));assert(valid({...note,sells:undefined}));for(const sells of [[],['Recipes','Recipes'],['Unknown'],null,'Recipes'])assert(!valid({...note,sells}));
 // Open and save through the editor's real handlers, including a second note and a category change.
 const elements=new Map(),get=id=>{if(!elements.has(id))elements.set(id,new Node('div'));return elements.get(id);};
 c.document.getElementById=get;c.document.querySelectorAll=()=>[];c.document.querySelector=s=>s.includes('note-type')?{value:c.noteType||'marker'}:null;
 Object.assign(c,{URL,personal:[],draft:null,window:{dispatchEvent(){}},CustomEvent:class{constructor(type,options){this.type=type;this.detail=options?.detail;}},registry:{maps:[]},categories:{Vendor:[],Personal:[]},enabled:new Set(),persist(rows){c.personal=rows;return true;},keepInSnapshot(){},closeEditor(){c.draft=null;},cancelPlacement(){},setupCategoryControls(){},buildPlaceIndex(){},refreshSearch(){},choose(){},status(){}});
 vm.runInContext(app.slice(app.indexOf('function noteTypeValue('),app.indexOf('function closeEditor(')),c);
 vm.runInContext("sellsChips($('sells-chips'));",c);
 const saveStart=app.indexOf(" $('marker-form').onsubmit=");vm.runInContext(app.slice(saveStart,app.indexOf("\n $('delete').onclick=",saveStart)),c);
 const open=vm.runInContext('openEditor',c),save=()=>get('marker-form').onsubmit({preventDefault(){}}),tags=get('sells-chips').querySelectorAll('input');
 open(note);assert.equal(get('vendor-kind').value,'Leatherworking vendor');assert(!get('sells-field').hidden);assert.deepEqual(tags.filter(t=>t.checked).map(t=>t.value),['Materials','Recipes']);
 save();assert.equal(c.personal[0].vendor,'Leatherworking vendor');assert.equal(JSON.stringify(c.personal[0].sells),'["Materials","Recipes"]');
 open({...note,sells:undefined});assert(!tags.some(t=>t.checked),'Opening another note clears previous chips');save();assert(!Object.hasOwn(c.personal[0],'sells'));
 open(note);get('category').value='Personal';vm.runInContext('updateEditorFields()',c);assert(get('sells-field').hidden&&get('vendor-field').hidden);save();assert(!Object.hasOwn(c.personal[0],'vendor')&&!Object.hasOwn(c.personal[0],'sells'));
 c.noteType='label';open(note);assert(get('sells-field').hidden&&get('vendor-field').hidden);
 // A popup places the short Sells line below the kind and name, including with a wiki card.
 Object.assign(c,{npcCardFor:()=>null,noteKind:m=>m.category,wikiButton:()=>null,copyButton:()=>new Node('button'),alignmentPositions:{},singleMap:true,tidyActions:n=>n});
 vm.runInContext(app.slice(app.indexOf('function popup('),app.indexOf('function labelEditPopup(')),c);const popup=vm.runInContext('popup',c),published={...note,id:'published'};
 const card=popup(published);assert.equal(card.children[1].textContent,'Leatherworking vendor');assert.equal(card.children[2].textContent,'Kaela');assert.equal(card.children[3].textContent,'Sells: Materials · Recipes');
 assert(!popup({...published,sells:undefined}).children.some(n=>n.className==='marker-sells'));assert(!popup({...published,category:'Personal'}).children.some(n=>n.className==='marker-sells'));
 c.npcCardFor=()=>({url:'https://monstersandmemories.wiki/npcs/kaela'});c.titleLevel=name=>({name});c.npcCard=()=>new Node('section');assert.equal(popup(published).children[3].textContent,'Sells: Materials · Recipes');
 console.log('App vendor checks passed: legacy titles, tag search, kind and Sells filters, optgroups, validation, editor saves and popups.');}
