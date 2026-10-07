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
 console.log('Class checks passed: every class on the maps has its abbreviation.');}
