// The Wanted board's lists: for each zone map, the NPCs the Monsters and Memories Wiki files under that zone that the
// map does not mark yet (plain mobs left out), as bounties/<map-id>.json. GitHub builds them when publishing
// (.github/workflows/pages.yml) with the WIKI_API_KEY secret; locally the key file works as for wiki-reconcile.mjs.
// One wiki request per zone per publish and none per visitor. Without a key, or if the wiki fails, it writes nothing
// for that zone and never fails the publish. Only ids, names, roles, levels and page addresses are kept.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {key,zoneSlug} from './wiki-reconcile.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),api='https://monstersandmemories.wiki/api/partner/v1/';
const context={};vm.createContext(context);vm.runInContext(await readFile(resolve(root,'wiki-links.js'),'utf8'),context);
const isClassTrainer=vm.runInContext('isClassTrainer',context);
// The same loose comparison as the board: our extra words after a dash or in brackets, a leading article, case and accents aside.
const looseName=v=>String(v??'').split(/\s+[—–-]\s+|\s*\(/)[0].normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[’'`]/g,'').replace(/[^a-z0-9]+/g,' ').trim().replace(/^(the|a|an) /,'');
export const placed=(row,places)=>{const name=looseName(row.name);return places.some(p=>p.wikiId===row.id||(name.length>=4&&(looseName(p.name)===name||(' '+looseName(p.name)+' ').includes(' '+name+' '))));};
const text=(v,max)=>typeof v==='string'?v.replace(/[\u0000-\u001f\u007f<>]/g,'').trim().slice(0,max):typeof v==='number'?String(v):'';

async function main(){
 let secret;try{secret=await key();}catch{console.log('No wiki key: the bounty lists are not built this time.');return;}
 const registry=JSON.parse(await readFile(resolve(root,'data/maps.json'),'utf8'));let built=0;
 await mkdir(resolve(root,'bounties'),{recursive:true});
 for(const c of registry.maps){
  if(c.zonesFile)continue;
  const zone=c.wikiZone||c.title,slug=c.wikiZoneSlug||zoneSlug(zone),files=[...new Set([c.markersFile,...(c.levels||[]).map(l=>l.markersFile)].filter(Boolean))],places=[];
  for(const f of files)for(const m of JSON.parse(await readFile(resolve(root,f),'utf8')))places.push({name:m.name,wikiId:m.wikiId});
  let data;
  try{const r=await fetch(api+'zone/'+encodeURIComponent(slug),{headers:{Authorization:'Bearer '+secret,Accept:'application/json'}});
   if(r.status===404)data={npcs:[]};else if(!r.ok){console.log(c.id+': the wiki answered '+r.status+'; no list this time.');continue;}else data=await r.json();}
  catch{console.log(c.id+': the wiki could not be reached; no list this time.');continue;}
  const rows=(Array.isArray(data?.npcs)?data.npcs:[]).map(n=>{let url='';try{const u=new URL(String(n.url));if(u.protocol==='https:'&&/(^|\.)monstersandmemories\.wiki$/.test(u.hostname))url=u.href;}catch{}
   return {id:text(n.id,160),name:text(n.name,100),role:text(n.role,20).toLowerCase(),level:text(n.level,20),url};})
   // Plain mobs, and creatures the wiki tags as named but that are a kind ("A Deepcut arsonist"), are not single NPCs to pin;
   // merchants, trainers and quest givers stay even when their name starts with "A" ("A bag merchant").
   .filter(n=>n.id&&n.name&&n.url&&n.role!=='mob'&&!(n.role==='named'&&/^(a|an) /i.test(n.name)&&!isClassTrainer(n))&&!placed(n,places))
   .map(n=>({...n,priority:isClassTrainer(n)||n.role==='merchant'}));
  await writeFile(resolve(root,'bounties',c.id+'.json'),JSON.stringify({map:c.id,zone,site:'mnm-wiki',built:new Date().toISOString(),rows})+'\n');
  built++;console.log(c.id+': '+rows.length+' bounties ('+rows.filter(r=>r.priority).length+' priority).');
  await new Promise(r=>setTimeout(r,700));
 }
 console.log('Wrote '+built+' bounty lists to bounties/.');
}
main().catch(e=>{console.log('Bounty lists skipped: '+e.message);});
