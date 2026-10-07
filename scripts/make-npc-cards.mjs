// NPC wiki cards for marker popups: for each zone map, the markers linked to an NPC page on the Monsters and Memories
// Wiki get a short card (tags, level, race, class, location line, the wiki's short summary, the first loot items with
// their pages), written as npc-cards/<map-id>.json. GitHub builds them when publishing (.github/workflows/pages.yml)
// with the WIKI_API_KEY secret; locally the key file works as for wiki-reconcile.mjs. Cards the live atlas already has
// and that are less than a day old are kept as they are, so a publish only asks the wiki about NPCs newly linked and
// cards due for a refresh; those requests are paced (the wiki allows 120 a minute for the whole atlas, wiki searches
// included), and none are made per visitor. The wiki allows
// showing this with a link back to each NPC and item page and its credit; the full description is never kept.
// Without a key, or when the wiki fails, a map gets no cards this time and the publish goes on.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {key} from './wiki-reconcile.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),api='https://monstersandmemories.wiki/api/partner/v1/';
// Plain text only: no control characters or angle brackets, the wiki's bold/italic marks dropped, a length limit.
const text=(v,max)=>{if(typeof v==='number')v=String(v);if(typeof v!=='string')return '';const t=v.replace(/'{2,}/g,'').replace(/[\u0000-\u001f\u007f<>]/g,' ').replace(/\s+/g,' ').trim();return t.length>max?t.slice(0,max-1).replace(/\s+\S*$/,'')+'…':t;};
const page=(v,kind)=>{try{const u=new URL(String(v));return u.protocol==='https:'&&/(^|\.)monstersandmemories\.wiki$/.test(u.hostname)&&u.pathname.startsWith('/'+kind+'/')?u.href:'';}catch{return '';}};
// The wiki gives drop rates in percent already (0.5 is half a percent).
const rate=v=>typeof v==='number'&&Number.isFinite(v)&&v>0&&v<=100?Math.round(v*100)/100:null;
// About 85 requests a minute at most, leaving room for visitors' wiki searches on the same key.
const pace=700,fresh=24*3600000,site=process.env.CARDS_FROM||'https://www.mnmatlas.com/';
let last=0;
async function npc(id,secret){
 const wait=last+pace-Date.now();if(wait>0)await new Promise(r=>setTimeout(r,wait));last=Date.now();
 for(let attempt=0;;attempt++){
  const r=await fetch(api+'npc/'+encodeURIComponent(id),{headers:{Authorization:'Bearer '+secret,Accept:'application/json'}});
  if(r.status===429&&attempt<2){await new Promise(res=>setTimeout(res,30000));continue;}
  if(!r.ok)return null;const body=await r.json().catch(()=>null);return body?.npc||body;
 }
}
// What a card keeps: never the description, factions or quests.
export function card(n){
 const url=page(n?.url,'npcs');if(!url||typeof n?.name!=='string')return null;
 const loot=(Array.isArray(n.loot)?n.loot:[]).map(i=>({name:text(i?.name,80),url:page(i?.url,'items'),dropRate:rate(i?.dropRate)})).filter(i=>i.name&&i.url);
 // The likeliest drops first when the wiki has rates; otherwise its own order.
 const top=loot.map((i,k)=>({i,k})).sort((a,b)=>(b.i.dropRate??-1)-(a.i.dropRate??-1)||a.k-b.k).slice(0,5).map(x=>x.i);
 const c={name:text(n.name,100),url,tags:text(Array.isArray(n.tags)?n.tags.join(' · '):n.tags,120),level:text(n.level,20),race:text(n.race,40),class:text(n.class,40),location:text(n.location,160),summary:text(n.summary,220),loot:top.map(i=>i.dropRate==null?{name:i.name,url:i.url}:i),lootCount:loot.length};
 for(const k of Object.keys(c))if(c[k]===''||(Array.isArray(c[k])&&!c[k].length)||c[k]===0)delete c[k];
 return c;
}

async function main(){
 let secret;try{secret=await key();}catch{console.log('No wiki key: the NPC cards are not built this time.');return;}
 const registry=JSON.parse(await readFile(resolve(root,'data/maps.json'),'utf8'));let built=0,asked=0;
 await mkdir(resolve(root,'npc-cards'),{recursive:true});
 for(const c of registry.maps){
  if(c.zonesFile)continue;
  const ids=new Set();
  for(const f of new Set([c,...(c.levels||[])].map(l=>l.markersFile).filter(Boolean))){
   let markers=[];try{markers=JSON.parse(await readFile(resolve(root,f),'utf8'));}catch{}
   for(const m of Array.isArray(markers)?markers:[])if(typeof m?.wikiId==='string'&&/^npc-[a-z0-9-]{1,150}$/.test(m.wikiId))ids.add(m.wikiId);}
  if(!ids.size)continue;
  // The cards the published atlas has now, each with the time it was asked for.
  let before={};try{const r=await fetch(site+'npc-cards/'+encodeURIComponent(c.id)+'.json',{headers:{Accept:'application/json'}});if(r.ok){const b=await r.json();if(b&&b.cards&&typeof b.cards==='object')before=b.cards;}}catch{}
  const cards={};let failed=0,kept=0;
  for(const id of ids){
   const old=before[id];if(old&&typeof old==='object'&&Number.isFinite(old.at)&&Date.now()-old.at<fresh&&card({...old,loot:[]})){cards[id]=old;kept++;continue;}
   asked++;try{const n=await npc(id,secret),one=n&&card(n);if(one)cards[id]={...one,at:Date.now()};else if(old&&card({...old,loot:[]}))cards[id]=old;else failed++;}catch{if(old)cards[id]=old;else failed++;}}
  if(!Object.keys(cards).length){console.log(c.id+': no cards ('+failed+' lookups failed).');continue;}
  await writeFile(resolve(root,'npc-cards',c.id+'.json'),JSON.stringify({map:c.id,site:'mnm-wiki',built:new Date().toISOString(),cards})+'\n');
  built++;console.log(c.id+': '+Object.keys(cards).length+' cards ('+kept+' kept'+(failed?', '+failed+' not found':'')+').');
 }
 console.log('Wrote '+built+' NPC card files to npc-cards/ ('+asked+' wiki requests).');
}
if(process.argv[1]===fileURLToPath(import.meta.url))main().catch(e=>{console.log('NPC cards skipped: '+e.message);});
