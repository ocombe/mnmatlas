// Keeps Directions in step with the published pins, after community changes are applied.
// For each map with routes it works out, with the site's own route finder (route-worker.js):
// - the walking distances between the signs and pins that lead to another map ("between" in data/<map>/routes.json),
//   which the site uses to choose a way across several maps;
// - a reach check: from the map's first entrance to every pin and back. The pins no route reaches are kept in
//   routes.json ("unreached"); a pin newly in that list is reported (a GitHub warning in the job, and
//   .publish/route-reach.json). Nothing else is changed for it.
// A map is worked out again only when its signs, exits or floor links changed since the last time (betweenKey in
// routes.json), or with --force. The walking ground itself is not touched here.
// Usage: node scripts/route-refresh.mjs [--force] [map-id ...]   (default: every map with routes)
import fs from 'fs';import vm from 'vm';import path from 'path';import {fileURLToPath} from 'url';
const site=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2),force=args.includes('--force'),only=args.filter(a=>!a.startsWith('--'));
const read=f=>JSON.parse(fs.readFileSync(path.join(site,f),'utf8'));
const github=!!process.env.GITHUB_ACTIONS;

// Floor links from a map's pins, exactly as itinerary.js builds them (keep the two in step).
export function floorLinks(markers){
 const byId=new Map(markers.map(m=>[m.id,m]));
 const kindOf=m=>m.category==='Trap'?'trap':m.category==='Teleporter'?'teleport':m.category==='Lift'?'lift':/(^| )drop( |$)/i.test(m.name)?'drop':'stairs';
 const COST={trap:2,teleport:2,lift:6,drop:2,stairs:4};
 return markers.filter(m=>m.toMarker&&m.toLevel&&!m.toMap&&byId.has(m.toMarker)).map(m=>{const b=byId.get(m.toMarker),kind=kindOf(m);return {id:m.id,name:m.name,from:{x:m.x,y:m.y,level:m.level},to:{x:b.x,y:b.y,level:b.level},oneWay:true,kind,cost:COST[kind]};});
}
// A short stamp of a text (FNV-1a, twice with different seeds), to notice when a map's inputs change.
const stamp=s=>[2166136261,374761393].map(seed=>{let h=seed;for(let i=0;i<s.length;i++)h=Math.imul(h^s.charCodeAt(i),16777619)>>>0;return String(h).padStart(10,'0');}).join('-');
// A camp drawn as an area is reached at the nearest ground inside it (as the site does).
const edge=m=>m.shape?.points?.length>2?{edge:m.shape.points}:{};

async function finder(map,meta){
 let reply;const ctx={self:{postMessage:m=>reply=m},fetch:async u=>new Response(fs.readFileSync(path.join(site,u))),Response,DecompressionStream,DataView,Uint8Array,Uint16Array,Uint32Array,Int32Array,Float32Array,Float64Array,performance,Math,Map,Set,Array,Error,console,Infinity};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(site,'route-worker.js'),'utf8'),ctx);
 const call=async m=>{reply=null;await ctx.self.onmessage({data:{...m,map}});if(reply?.error)throw Error(reply.error);return reply?.result;};
 await call({id:1,type:'load',meta,url:meta.file});
 return (from,to,links)=>call({id:2,type:'route',from,to,mode:'shorter',dangers:[],links});
}

const maps=read('data/maps.json').maps.filter(m=>m.routes&&(!only.length||only.includes(m.id)));
const problems=[];let changed=0;
for(const reg of maps){
 const map=reg.id,file=path.join(site,`data/${map}/routes.json`);if(!fs.existsSync(file))continue;
 const meta=JSON.parse(fs.readFileSync(file,'utf8')),markers=read(reg.markersFile),labels=(read(reg.labelsFile).labels||[]).filter(l=>(l.map||map)===map);
 const links=floorLinks(markers);
 // Signs snap within 260 px; lift and stair pins that lead to another map are taken exactly where they stand.
 const doors=[...labels.filter(l=>l.toMap||Array.isArray(l.route)).map(p=>({id:p.id,x:p.x,y:p.y,level:p.level,reach:260})),...markers.filter(m=>m.toMap&&Number.isFinite(m.x)).map(p=>({id:p.id,x:p.x,y:p.y,level:p.level,reach:90,exact:true}))];
 const pins=markers.filter(m=>Number.isFinite(m.x)).map(m=>({id:m.id,name:m.name,x:m.x,y:m.y,level:m.level,...edge(m)}));
 const key=stamp(JSON.stringify([meta.file,doors,links,pins.map(p=>[p.id,p.x,p.y,p.level,p.edge||null])]));
 if(!force&&meta.betweenKey===key)continue;
 const route=await finder(map,meta),t=Date.now();
 const between={};
 for(const a of doors)for(const b of doors){
  if(a===b)continue;const r=await route(a,b,links);
  // null: no walk between them on this map (the site then looks for a way through other maps).
  (between[a.id]??={})[b.id]=r.error?null:Math.round(r.length);
 }
 // Reach check from the first entrance (a sign, or else a pin leading to another map).
 let exits=labels.filter(l=>l.toMap&&(l.kind==='exit'||l.route));if(!exits.length)exits=markers.filter(m=>m.toMap&&Number.isFinite(m.x));
 let bad=0;const unreached=[];
 if(exits.length){
  const start={x:exits[0].x,y:exits[0].y,level:exits[0].level,reach:260};
  for(const p of pins){
   const go=await route(start,p,links),back=await route(p,start,links);
   if(go.error||back.error){bad++;unreached.push(p.id);if(!(meta.unreached||[]).includes(p.id))problems.push({map,id:p.id,name:p.name,level:p.level||null,in:go.error||null,out:back.error||null});}
  }
 }
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
