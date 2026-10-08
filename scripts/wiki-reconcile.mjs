// Compare one map's NPC markers and place names with the Monsters and Memories Wiki, zone by zone.
//   node scripts/wiki-reconcile.mjs <map-id>                      writes <out>/<map-id>.md (to read) and .json (to approve)
//   node scripts/wiki-reconcile.mjs --apply <map-id> [--dry-run]  applies the rows marked "approve": true in <out>/<map-id>.json
// Only names, ids and page addresses come from the wiki (its terms allow lookups and tagging, not copying).
// The partner key is read from WIKI_API_KEY or from a local file outside the repository; it is never printed.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const api='https://monstersandmemories.wiki/api/partner/v1/';
// Marker types that stand for a person or a creature; other types (lifts, stairs, banks, tradeskill stations) are left alone.
export const npcCategories=new Set(['Named mob','Notable NPC','Vendor','Class trainer','Quest','Mob camp']);

// Same loose zone comparison as the wiki-search backend: case, accents, apostrophes and a leading "the" do not matter.
export const zoneKey=v=>String(v||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[’'`]/g,'').replace(/[^a-z0-9]+/g,' ').trim().replace(/^the /,'');
export const inZone=(row,zone)=>!zone||String(row.zone||'').split(',').some(z=>zoneKey(z)===zoneKey(zone));
// Names compared the same way, also without a leading "a"/"an", so "Bag merchant" is the wiki's "A bag merchant".
export const nameKey=v=>zoneKey(v).replace(/^(a|an) /,'');
// The part of our name that names someone: "Bank — north-east quay" asks for "Bank", "Cleric / Paladin" for "Cleric".
export const query=name=>String(name).split(/\s+[—–-]\s+|\s*\/\s*|\s*\(/)[0].trim();

function distance(a,b){const row=Array.from({length:b.length+1},(_,i)=>i);for(let i=1;i<=a.length;i++){let prev=row[0];row[0]=i;for(let j=1;j<=b.length;j++){const next=row[j];row[j]=Math.min(row[j]+1,row[j-1]+1,prev+(a[i-1]===b[j-1]?0:1));prev=next;}}return row[b.length];}
// One of a kind: "Crystallized skeletons" (a camp) is the wiki's "A crystallized skeleton".
const singular=v=>v.split(' ').map(w=>w.length<4?w:w.replace(/ies$/,'y').replace(/(s|x|ch|sh)es$/,'$1').replace(/([^s])s$/,'$1')).join(' ');
// exact: the same name; close: a near spelling (a letter or two), the plural of the wiki's name, or the wiki's name
// after a title ("Paymaster Elara Venn" is the wiki's "Elara Venn"); none otherwise.
// Several equally good answers make the row ambiguous: it is listed for a choice, never applied on its own.
export function match(name,results){
 const ours=nameKey(query(name));if(!ours)return {kind:'none',candidates:[]};
 const scored=results.map(r=>{const theirs=nameKey(r.name),d=distance(ours,theirs),near=d<=Math.max(1,Math.floor(Math.min(ours.length,theirs.length)/8)),plural=theirs!==ours&&singular(ours)===singular(theirs),titled=theirs.includes(' ')&&ours.endsWith(' '+theirs);
  return {r,kind:theirs===ours?'exact':near||plural||titled?'close':'none',d,plural};});
 for(const kind of ['exact','close']){const found=scored.filter(s=>s.kind===kind).sort((a,b)=>a.d-b.d);if(found.length)return {kind:found.length>1&&found[0].d===found[1].d?'ambiguous':kind,best:found[0].r,plural:found[0].plural,candidates:found.map(s=>s.r)};}
 return {kind:'none',candidates:[]};
}

async function json(path){return JSON.parse(await readFile(resolve(root,path),'utf8'));}
// Written back in the file's own layout (indent, line ends, final newline), and only when something changed.
export function layout(original,data){const spacing=original.match(/\r?\n([ \t]+)\S/),newline=original.includes('\r\n')?'\r\n':'\n';const text=JSON.stringify(data,null,spacing?spacing[1]:2).replace(/\n/g,newline);return /\r?\n$/.test(original)?text+newline:text;}
async function writeJson(path,data){const file=resolve(root,path),original=await readFile(file,'utf8');if(JSON.stringify(JSON.parse(original))===JSON.stringify(data))return false;await writeFile(file,layout(original,data));return true;}
// A map's feature files: the map's own and any a level adds.
async function features(c){
 const files=(key)=>[...new Set([c[key],...(c.levels||[]).map(l=>l[key])].filter(Boolean))];
 const markers=[],labels=[];
 for(const path of files('markersFile')){const data=await json(path);for(const m of data)markers.push({path,m});}
 for(const path of files('labelsFile')){const data=await json(path);for(const l of data.labels||[])labels.push({path,l});}
 return {markers,labels};
}

function settings(){
 const args=process.argv.slice(2),flag=f=>{const i=args.indexOf(f);if(i<0)return null;args.splice(i,1);return true;},value=f=>{const i=args.indexOf(f);if(i<0)return null;const v=args[i+1];args.splice(i,2);return v;};
 const apply=flag('--apply'),dryRun=flag('--dry-run'),out=value('--out')||resolve(root,'..','tools','wiki-reconcile');
 return {apply,dryRun,out,map:args[0]};
}
export async function key(){
 if(process.env.WIKI_API_KEY)return process.env.WIKI_API_KEY.trim();
 const file=process.env.WIKI_KEY_FILE||resolve(root,'..','secrets','wiki-api-key.txt');
 try{return (await readFile(file,'utf8')).trim();}catch{throw Error('No wiki key: set WIKI_API_KEY or save it in '+file+'.');}
}
// Answers are kept on disk, and new requests are paced at one a second (the wiki allows 120 a minute for the whole atlas).
let last=0;
// Every NPC the wiki files under a zone, in one request (kept on disk like the searches).
export const zoneSlug=name=>zoneKey(name).replace(/ /g,'-');
export async function zoneNpcs(zone,out,secret){
 const file=resolve(out,'cache','zone-'+zoneSlug(zone)+'.json');
 try{return JSON.parse(await readFile(file,'utf8')).npcs;}catch{}
 const r=await fetch(api+'zone/'+encodeURIComponent(zoneSlug(zone)),{headers:{Authorization:'Bearer '+secret,Accept:'application/json'}});
 if(r.status===404)return null;if(!r.ok)throw Error('Wiki zone list failed ('+r.status+') for '+zone+'.');
 const data=await r.json(),npcs=(Array.isArray(data?.npcs)?data.npcs:[]).filter(x=>x&&typeof x.id==='string'&&typeof x.name==='string'&&/^https:\/\/([a-z0-9-]+\.)*monstersandmemories\.wiki\//.test(String(x.url))).map(x=>({id:x.id,name:x.name,zone:String(x.zone||zone),url:x.url}));
 await mkdir(dirname(file),{recursive:true});await writeFile(file,JSON.stringify({zone,npcs}));return npcs;
}
export async function search(q,out,secret){
 const id=createHash('sha1').update('npc|'+q.toLowerCase()).digest('hex'),file=resolve(out,'cache',id+'.json');
 try{return JSON.parse(await readFile(file,'utf8')).results;}catch{}
 const wait=last+1000-Date.now();if(wait>0)await new Promise(r=>setTimeout(r,wait));last=Date.now();
 for(let attempt=0;;attempt++){
  const r=await fetch(api+'search?q='+encodeURIComponent(q)+'&type=npc',{headers:{Authorization:'Bearer '+secret,Accept:'application/json'}});
  if(r.status===429&&attempt<3){await new Promise(res=>setTimeout(res,30000));continue;}
  if(r.status===404){await mkdir(dirname(file),{recursive:true});await writeFile(file,JSON.stringify({q,results:[]}));return [];}
  if(!r.ok)throw Error('Wiki search failed ('+r.status+') for "'+q+'".');
  const data=await r.json(),results=(Array.isArray(data?.results)?data.results:[]).filter(x=>x&&x.type==='npc'&&typeof x.id==='string'&&typeof x.name==='string'&&/^https:\/\/([a-z0-9-]+\.)*monstersandmemories\.wiki\//.test(String(x.url))).map(x=>({id:x.id,name:x.name,zone:String(x.zone||''),url:x.url}));
  await mkdir(dirname(file),{recursive:true});await writeFile(file,JSON.stringify({q,results}));return results;
 }
}

// One row per NPC marker and per place name that could be someone; labels that match a wiki NPC are proposed as markers.
export function plan(c,{markers,labels},answers){
 const zone=c.zonesFile?'':c.wikiZone||c.title,rows=[];
 const add=(source,item,kind)=>{const q=query(item.name),all=answers.get(q)||[],results=all.filter(r=>inZone(r,zone));let found=match(item.name,results);
  // A trainer marker named after its class ("Necromancer / Shadow Knight") is not the wiki's "A necromancer": trainers need their own name.
  if(item.category==='Class trainer'&&found.best&&zoneKey(q)!==zoneKey(found.best.name))found={kind:'none',candidates:[]};
  const row={approve:false,source,path:item.path,id:item.id,kind,category:item.category||null,name:item.name,wiki:item.wiki||'',match:found.kind,candidates:found.candidates.slice(0,5)};
  // Only the name part takes the wiki's spelling: "Baron Bigtent (level 20)" keeps its level. A camp keeps its own name.
  if(found.best){row.wikiName=found.best.name;row.wikiUrl=found.best.url;row.wikiId=found.best.id;row.newName=found.plural||item.category==='Mob camp'?item.name:found.best.name+String(item.name).trim().slice(q.length);}
  // The same name filed under another zone only: shown for information, never proposed.
  else{const other=match(item.name,all.filter(r=>!inZone(r,zone)));if(other.kind==='exact'||other.kind==='ambiguous'&&nameKey(other.best.name)===nameKey(query(item.name)))row.elsewhere=other.candidates.slice(0,3).map(r=>({name:r.name,zone:r.zone,url:r.url}));}
  // A clear match is proposed (approve true); close and ambiguous ones wait for a decision.
  row.approve=found.kind==='exact'&&!(item.wiki&&item.wiki!==found.best.url);
  if(kind==='label'&&found.best)row.toCategory=c.extraCategories?.['Notable NPC']?'Notable NPC':'Named mob';
  rows.push(row);};
 for(const {path,m} of markers)if(npcCategories.has(m.category))add('marker',{...m,path},'marker');
 for(const {path,l} of labels)if(l.kind!=='exit')add('label',{...l,path},'label');
 return {map:c.id,zone:zone||'(every zone)',rows};
}
export const queries=(c,{markers,labels})=>[...new Set([...markers.filter(x=>npcCategories.has(x.m.category)).map(x=>query(x.m.name)),...labels.filter(x=>x.l.kind!=='exit').map(x=>query(x.l.name))].filter(q=>nameKey(q).length>=3))];

function report(p){
 const esc=v=>String(v??'').replace(/\|/g,'\\|'),rows=p.rows,count=k=>rows.filter(r=>r.match===k).length;
 const lines=['# '+p.map+' · wiki zone: '+p.zone,'',`${rows.length} entries: ${count('exact')} exact, ${count('close')} close, ${count('ambiguous')} ambiguous, ${count('none')} not found.`,'','Set "approve": true in '+p.map+'.json for each row to apply (exact matches are pre-approved), then run `node scripts/wiki-reconcile.mjs --apply '+p.map+'`.','',
  '| ok | what | our name | wiki name | match | proposal |','|---|---|---|---|---|---|'];
 for(const r of rows){
  const proposal=r.wikiName?[r.newName!==r.name?'rename to '+esc(r.newName):'',r.wiki!==r.wikiUrl?'link':'',r.toCategory?'make a '+r.toCategory+' marker':''].filter(Boolean).join(', ')||'already linked':r.candidates.length?'choose: '+r.candidates.map(x=>x.name).join(' / '):r.elsewhere?'only elsewhere: '+r.elsewhere.map(x=>`[${esc(x.name)}](${x.url}) (${esc(x.zone.replace(/\s+,/g,','))})`).join(', '):'';
  lines.push(`| ${r.approve?'✓':''} | ${r.source} ${esc(r.category||'')} | ${esc(r.name)} | ${r.wikiUrl?`[${esc(r.wikiName)}](${r.wikiUrl})`:''} | ${r.match} | ${esc(proposal)} |`);
 }
 return lines.join('\n')+'\n';
}

// Applies approved rows: the wiki's name, link and id; an approved place name becomes a marker with the same id, place and note.
export function applyRows(rows,files){
 const done=[];
 for(const r of rows.filter(r=>r.approve&&r.wikiUrl&&r.wikiId&&r.wikiName)){
  const data=files.get(r.path);if(!data)throw Error('Unknown file '+r.path);
  if(r.source==='marker'){const m=data.find(m=>m.id===r.id);if(!m)throw Error('Marker '+r.id+' is gone.');m.name=r.newName||r.wikiName;m.wiki=r.wikiUrl;m.wikiId=r.wikiId;done.push('linked '+r.id);continue;}
  const i=data.labels.findIndex(l=>l.id===r.id);if(i<0)throw Error('Place name '+r.id+' is gone.');const l=data.labels[i];
  if(!r.toCategory){done.push('skipped '+r.id+' (no marker type)');continue;}
  const target=r.markersPath&&files.get(r.markersPath);if(!target)throw Error('No markers file for '+r.id+'.');if(target.some(m=>m.id===l.id))throw Error('Marker id '+l.id+' already exists.');
  const m={id:l.id,name:r.newName||r.wikiName,category:r.toCategory,x:l.x,y:l.y,note:l.note||'',...(l.level?{level:l.level}:{}),...(l.approximate?{approximate:true}:{}),...(l.community?{community:true}:{}),wiki:r.wikiUrl,wikiId:r.wikiId};
  target.push(m);data.labels.splice(i,1);done.push('made marker '+r.id);
 }
 return done;
}

async function main(){
 const {apply,dryRun,out,map}=settings();if(!map)throw Error('Usage: node scripts/wiki-reconcile.mjs [--apply [--dry-run]] <map-id>');
 const registry=await json('data/maps.json'),c=registry.maps.find(m=>m.id===map);if(!c)throw Error('Unknown map '+map+'.');
 const found=await features(c);
 if(apply){
  const p=JSON.parse(await readFile(resolve(out,map+'.json'),'utf8')),files=new Map();
  for(const path of new Set([...found.markers.map(x=>x.path),...found.labels.map(x=>x.path)]))files.set(path,await json(path));
  // A place name becomes a marker in the markers file of its level (or the map's).
  for(const r of p.rows)if(r.source==='label'){const l=found.labels.find(x=>x.l.id===r.id)?.l,level=c.levels?.find(x=>x.id===l?.level);r.markersPath=level?.markersFile||c.markersFile;if(r.markersPath&&!files.has(r.markersPath))files.set(r.markersPath,await json(r.markersPath));}
  const done=applyRows(p.rows,files);
  if(!dryRun)for(const [path,data] of files)await writeJson(path,data);
  console.log((dryRun?'Dry run: ':'')+(done.length?done.join('\n'):'Nothing approved.'));return;
 }
 // A zone map is compared with the zone's whole NPC list; searches (ten answers at most, across zones) only fill in
 // the world map and the names the zone list does not have, to show where else the wiki files them.
 const secret=await key(),answers=new Map(),zone=c.zonesFile?'':c.wikiZone||c.title,listed=zone?await zoneNpcs(zone,out,secret):null;
 for(const q of queries(c,found)){const own=listed&&match(q,listed).kind!=='none';answers.set(q,own?listed:[...(listed||[]),...await search(q,out,secret)]);}
 const p=plan(c,found,answers);
 await mkdir(out,{recursive:true});await writeFile(resolve(out,map+'.json'),JSON.stringify(p,null,2)+'\n');await writeFile(resolve(out,map+'.md'),report(p));
 console.log('Wrote '+resolve(out,map+'.md')+' ('+p.rows.length+' entries).');
}
if(import.meta.url===pathToFileURL(process.argv[1]||'').href)main().catch(e=>{console.error(e.message);process.exit(1);});
