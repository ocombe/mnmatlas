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
{const c={};vm.createContext(c);vm.runInContext(await readFile(new URL('../wiki-links.js',import.meta.url),'utf8'),c);const abbr=vm.runInContext('classAbbreviations',c);
 const {readdir}=await import('node:fs/promises'),files=[];const walk=async d=>{for(const e of await readdir(d,{withFileTypes:true}))e.isDirectory()?await walk(d+'/'+e.name):e.name.endsWith('.json')&&files.push(d+'/'+e.name);};await walk(new URL('../data',import.meta.url).pathname.replace(/^\/([A-Z]:)/,'$1'));
 for(const f of files){const data=JSON.parse(await readFile(f,'utf8'));
  for(const t of data?.trainers||[])(t.classes||[]).forEach((cl,i)=>{const name=cl==='Shadowknight'?'Shadow Knight':cl;assert(Object.hasOwn(abbr,name),f+': unknown class '+cl);assert.equal(abbr[name],t.abbreviations[i],f+': '+cl);});
  for(const m of Array.isArray(data)?data:[])for(const cl of m.classes||[])assert(Object.hasOwn(abbr,cl),f+': unknown class '+cl);}
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
 const [named,ok,group]=vm.runInContext('[vendorKindNamed,vendorKindOk,vendorGroupOf]',c);
 assert.equal(named('A bag merchant'),'Bag merchant');assert.equal(named('A used weapons dealer'),'Used weapons dealer');assert.equal(named('A reagent vendor (Wayfarers Hospice)'),'Reagent vendor');
 assert.equal(named('Butchers'),'Butcher');assert.equal(named('Marcus Aden'),'');assert.equal(group('Reagent vendor'),'Spells and reagents');
 assert(ok(undefined)&&ok('Bag merchant')&&!ok('Dragon seller'));
 console.log('Vendor checks passed: kinds from names, groups, only listed kinds.');}

// Every copy of a note (its backup, its suggestion, the review bar) keeps the same optional fields for its kind.
{const c={};vm.createContext(c);vm.runInContext(await readFile(new URL('../wiki-links.js',import.meta.url),'utf8'),c);
 const extras=m=>JSON.parse(JSON.stringify(vm.runInContext('markerExtras',c)(m)));
 assert.deepEqual(extras({category:'Vendor',vendor:'Bag merchant',trade:'Cooking',classes:['Bard'],wiki:'https://monstersandmemories.wiki/npcs/x',wikiId:'npc-x'}),{wiki:'https://monstersandmemories.wiki/npcs/x',wikiId:'npc-x',vendor:'Bag merchant'});
 assert.deepEqual(extras({category:'Class trainer',classes:['Cleric','Paladin'],vendor:'Baker'}),{classes:['Cleric','Paladin']});
 assert.deepEqual(extras({category:'Tradeskill',trade:'Cooking',color:'#123456'}),{color:'#123456',trade:'Cooking'});
 assert.deepEqual(extras({category:'Personal',noteType:'exit',arrow:'west',toMap:'scarwood',wiki:'https://monstersandmemories.wiki/npcs/x'}),{noteType:'exit',arrow:'west',toMap:'scarwood'});
 assert.deepEqual(extras({category:'Personal',noteType:'label',arrow:'west'}),{noteType:'label'});
 assert.deepEqual(extras({category:'Vendor',wikiId:'npc-x'}),{},'A wiki id only rides with its link');
 console.log('Marker field checks passed: each kind of note keeps its own fields.');}
