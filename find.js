/* ?find=<text> (and ?wiki=<wiki id>, its alias): looks a name up across every map.
   data/find-index.json, written with the map pages, lists every marker and place name as
   {n: name, m: map id, p: place id, k: kind, l: level (optional), w: wiki id (optional), c: trainer classes (optional)}. */
'use strict';
// Compared like the atlas search, also ignoring accents and the kind of apostrophe.
const findKey=v=>String(v??'').normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[’‘`]/g,"'").toLowerCase().replace(/\s+/g,' ').trim();
// The names a place answers to: its own and, for a class trainer, "<class> trainer" for each class it teaches.
const findNames=e=>[e.n,...(Array.isArray(e.c)?e.c:[]).map(c=>c+' trainer')].map(findKey);
// A wiki id first, then the exact name, then names that contain the text; mapId keeps one map's places only.
function findPlaces(index,text,mapId){
 const rows=(Array.isArray(index)?index:[]).filter(e=>e&&typeof e.n==='string'&&typeof e.m==='string'&&typeof e.p==='string'&&(!mapId||e.m===mapId));
 const raw=String(text??'').trim(),key=findKey(raw);if(!key)return [];
 const byId=rows.filter(e=>e.w===raw);if(byId.length)return byId;
 const exact=rows.filter(e=>findNames(e).includes(key));if(exact.length)return exact;
 return rows.filter(e=>findNames(e).some(n=>n.includes(key)));
}
