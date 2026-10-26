// Keeps Directions in step with the published pins, after community changes are applied.
// For each map with routes it works out, with the site's own route finder (route-worker.js):
// - the walking cost between the signs and pins that lead to another map ("between" in data/<map>/routes.json),
//   which the site uses to choose a way across several maps;
// - a reach check: from the map's first entrance to every pin and back. The pins no route reaches are kept in
//   routes.json ("unreached"); a pin newly in that list is reported (a GitHub warning in the job, and
//   .publish/route-reach.json). Nothing else is changed for it.
// A map is worked out again only when its signs, exits or floor links changed since the last time (betweenKey in
// routes.json), or with --force. The walking ground itself is not touched here.
// Usage: node scripts/route-refresh.mjs [--force] [--report <dir>] [map-id ...]   (default: every map with routes)
// --report writes every pin's walk in and out to <dir>/<map>/review/reach.json (for checks while building route data).
import fs from 'fs';import path from 'path';import {fileURLToPath} from 'url';import {rules,finder} from './route-common.mjs';
const site=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2),force=args.includes('--force'),reportAt=args.includes('--report')?args[args.indexOf('--report')+1]:null;
const only=args.filter((a,i)=>!a.startsWith('--')&&args[i-1]!=='--report');
const read=f=>JSON.parse(fs.readFileSync(path.join(site,f),'utf8'));
const github=!!process.env.GITHUB_ACTIONS;

// A short stamp of a text (FNV-1a, twice with different seeds), to notice when a map's inputs change.
const stamp=s=>[2166136261,374761393].map(seed=>{let h=seed;for(let i=0;i<s.length;i++)h=Math.imul(h^s.charCodeAt(i),16777619)>>>0;return String(h).padStart(10,'0');}).join('-');
const {floorLinks,edge}=rules(site);

const maps=read('data/maps.json').maps.filter(m=>m.routes&&(!only.length||only.includes(m.id)));
const problems=[];let changed=0;
for(const reg of maps){
 const map=reg.id,file=path.join(site,`data/${map}/routes.json`);if(!fs.existsSync(file))continue;
 const meta=JSON.parse(fs.readFileSync(file,'utf8')),markers=read(reg.markersFile),labels=(read(reg.labelsFile).labels||[]).filter(l=>(l.map||map)===map);
 const links=floorLinks(markers);
 // Signs snap within 260 px (a boat dock to its pier, not the water); lift and stair pins that lead to another map are taken exactly where they stand.
 const doors=[...labels.filter(l=>l.toMap||Array.isArray(l.route)).map(p=>({id:p.id,x:p.x,y:p.y,level:p.level,reach:260,...(Array.isArray(p.route)?{dry:true}:{})})),...markers.filter(m=>m.toMap&&Number.isFinite(m.x)).map(p=>({id:p.id,x:p.x,y:p.y,level:p.level,reach:90,exact:true}))];
 const pins=markers.filter(m=>Number.isFinite(m.x)).map(m=>({id:m.id,name:m.name,x:m.x,y:m.y,level:m.level,...edge(m)}));
 const key=stamp(JSON.stringify([meta.file,doors,links,pins.map(p=>[p.id,p.x,p.y,p.level,p.edge||null])]));
 if(!force&&meta.betweenKey===key)continue;
 const route=await finder(site,map,meta),t=Date.now();
 const between={};
 for(const a of doors)for(const b of doors){
  if(a===b)continue;const r=await route(a,b,links);
  // null: no walk between them on this map (the site then looks for a way through other maps).
  // The finder's cost (swims and off-road stretches weighted as it weighs them), so a chain of maps is chosen the way a
  // single route would be: a sign reached only by a long swim loses to one reached by road.
  (between[a.id]??={})[b.id]=r.error?null:Math.round(r.cost??r.length);
 }
 // Reach check from the first entrance (a sign, or else a pin leading to another map).
 let exits=labels.filter(l=>l.toMap&&(l.kind==='exit'||l.route));if(!exits.length)exits=markers.filter(m=>m.toMap&&Number.isFinite(m.x));
 let bad=0;const unreached=[],rows=[];
 if(exits.length){
  const start={x:exits[0].x,y:exits[0].y,level:exits[0].level,reach:260};
  for(const p of pins){
   const go=await route(start,p,links),back=await route(p,start,links);rows.push({id:p.id,name:p.name,level:p.level,x:p.x,y:p.y,in:go.error||go.length,out:back.error||back.length});
   if(go.error||back.error){bad++;unreached.push(p.id);if(!(meta.unreached||[]).includes(p.id))problems.push({map,id:p.id,name:p.name,level:p.level||null,in:go.error||null,out:back.error||null});}
  }
 }
 if(reportAt){const dir=path.join(reportAt,map,'review');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'reach.json'),JSON.stringify({map,from:exits[0]?.id||null,checked:rows.length,problems:rows.filter(r=>typeof r.in==='string'||typeof r.out==='string'),rows},null,1));}
 meta.between=between;meta.betweenKey=key;meta.unreached=unreached;fs.writeFileSync(file,JSON.stringify(meta,null,1)+'\n');changed++;
 console.log(`${map}: ${doors.length} signs, ${pins.length} pins checked, ${bad} not reached (${Math.round((Date.now()-t)/1000)} s)`);
}
fs.mkdirSync(path.join(site,'.publish'),{recursive:true});
fs.writeFileSync(path.join(site,'.publish/route-reach.json'),JSON.stringify(problems,null,1));
for(const p of problems){
 const line=`${p.name} (${p.map}${p.level?', '+p.level:''}): ${p.in||p.out}`;
 console.log(github?`::warning title=Directions::${line}`:'  not reached: '+line);
}
console.log(changed?`Directions: ${changed} map(s) worked out again, ${problems.length} new pin(s) not reached.`:'Directions: no map changed.');
