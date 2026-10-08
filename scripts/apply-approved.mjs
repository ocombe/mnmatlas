import {readFile,writeFile,rename} from 'node:fs/promises';
import {resolve,relative,dirname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),dryRun=process.argv.includes('--dry-run');
const args=process.argv.slice(2),url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_KEY;
const fail=message=>{throw new Error(message);};
if(args.some(a=>a!=='--dry-run'))fail('Usage: node scripts/apply-approved.mjs [--dry-run]');
if(!url||!key)fail('Set SUPABASE_URL and SUPABASE_SERVICE_KEY in your environment.');
const endpoint=new URL(url);if(!['https:','http:'].includes(endpoint.protocol))fail('Invalid project URL.');
const headers={apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'};
async function request(path,options={}){
 const response=await fetch(new URL('rest/v1/'+path,endpoint.href.replace(/\/$/,'')+'/'),{...options,headers:{...headers,...options.headers}});
 if(!response.ok)fail('Backend request failed (HTTP '+response.status+').');
 const body=await response.text();return body?JSON.parse(body):null;
}
const files=new Map();
function dataPath(path){
 if(typeof path!=='string'||!/^data\/[a-zA-Z0-9_./-]+\.json$/.test(path)||path.split('/').includes('..')||path.split('/').includes('tiles'))fail('Invalid data file in map registry.');
 const absolute=resolve(root,path),local=relative(root,absolute);if(local.startsWith('..'+sep)||local==='..')fail('Data file is outside the atlas.');return absolute;
}
async function file(path,empty){
 if(!files.has(path)){let original;try{original=await readFile(dataPath(path),'utf8');}catch(e){if(empty===undefined||e.code!=='ENOENT')throw e;original=JSON.stringify(empty,null,2)+'\n';}const spacing=original.match(/\r?\n([ \t]+)\S/);files.set(path,{data:JSON.parse(original),original,indent:spacing?spacing[1]:2,newline:original.includes('\r\n')?'\r\n':'\n',trailing:/\r?\n$/.test(original),changed:false});}
 return files.get(path);
}
const registry=JSON.parse(await readFile(resolve(root,'data/maps.json'),'utf8'));
// Reuse the site's supported categories, trades, arrows and colour palette.
const context=vm.createContext({URL});
const app=await readFile(resolve(root,'app.js'),'utf8'),icons=await readFile(resolve(root,'icons.js'),'utf8'),wikiLinks=await readFile(resolve(root,'wiki-links.js'),'utf8');
vm.runInContext(app.slice(app.indexOf('const baseCategories='),app.indexOf('const mobileLayout=')),context);
vm.runInContext(icons,context);
// Wiki links: only pages on the sites the atlas knows, in the same stored form the site writes.
vm.runInContext(wikiLinks,context);const wikiAddress=vm.runInContext('wikiAddress',context),wikiIdOf=vm.runInContext('wikiIdOf',context),classesOk=vm.runInContext('classesOk',context),vendorKindOk=vm.runInContext('vendorKindOk',context),vendorKindNow=vm.runInContext('vendorKindNow',context),sellsOk=vm.runInContext('sellsOk',context),sellTypes=vm.runInContext('sellTypes',context),normaliseMarker=vm.runInContext('normaliseMarker',context),classAbbreviations=vm.runInContext('classAbbreviations',context);
const base=vm.runInContext('Object.keys(allCategories)',context),supported=vm.runInContext('({categories:Object.keys(allCategories),trades:Object.keys(tradePaths),arrows:Object.keys(exitArrows),colours:Object.values(pinColours)})',context);
for(const map of registry.maps)for(const extra of [map.extraCategories,...(map.levels||[]).map(l=>l.extraCategories)])for(const category of Object.keys(extra||{}))if(!supported.categories.includes(category))supported.categories.push(category);
function configuration(row){
 const base=registry.maps.find(m=>m.id===row.map);if(!base)fail('Unknown map for suggestion '+row.id+'.');
 if(!base.levels){if(row.level)fail('Unexpected level for suggestion '+row.id+'.');return base;}
 const level=base.levels.find(l=>l.id===row.level);if(!level)fail('A valid level is required for suggestion '+row.id+'.');return {...base,...level,id:base.id,levelId:level.id};
}
// Names and notes are shown as plain text; this also drops invisible characters that could disguise text.
const hidden=new RegExp('['+[[0x0,0x8],[0xB,0x1F],[0x7F,0x9F],[0xAD],[0x61C],[0x180E],[0x200B,0x200F],[0x202A,0x202E],[0x2060,0x2069],[0xFEFF]].map(([a,b=a])=>String.fromCharCode(a)+'-'+String.fromCharCode(b)).join('')+']','g');
function clean(value,multiline){const t=String(value).normalize('NFC').replace(/\r\n?/g,'\n').replace(hidden,'').replace(/[<>]/g,'');return multiline?t.replace(/[ \t]+\n/g,'\n').replace(/\n{3,}/g,'\n\n').trim():t.replace(/\s+/g,' ').trim();}
function point(p,c,id){if(!Array.isArray(p)||p.length!==2||!p.every(Number.isFinite)||p[0]<0||p[1]<0||p[0]>c.width||p[1]>c.height)fail('Invalid position for suggestion '+id+'.');return p.map(Math.round);}
function wikiOf(value,id){const link=wikiAddress(value);if(link===null)fail('Unsupported wiki link for suggestion '+id+'.');return link;}
// The wiki's id for the linked entry, kept beside the link it was picked with.
function wikiIdFrom(p,id){const wikiId=wikiIdOf(p.wikiId);if(wikiId===null)fail('Invalid wiki id for suggestion '+id+'.');return wikiId;}
function validatePayload(row,c){
 const p=normaliseMarker(row.payload);if(!p||Array.isArray(p)||typeof p!=='object'||typeof p.name!=='string'||!clean(p.name)||p.name.length>100||Buffer.byteLength(JSON.stringify(p))>=4096)fail('Invalid payload for suggestion '+row.id+'.');
 if(!['move-marker','move-label','new-marker','edit-marker','edit-label'].includes(row.kind))fail('Invalid kind for suggestion '+row.id+'.');
 if(p.remove!==undefined&&(p.remove!==true||row.kind!=='edit-marker'||p.reason!==undefined&&!['duplicate','missing','other'].includes(p.reason)))fail('Invalid removal for suggestion '+row.id+'.');
 if((row.kind==='edit-marker'||row.kind==='edit-label')&&(!p.from||typeof p.from!=='object'||typeof p.from.name!=='string'||typeof (p.note??'')!=='string'||(p.note||'').length>2000))fail('Invalid edit for suggestion '+row.id+'.');
 if(row.kind==='new-marker'){
  // Only categories the atlas can draw: every map's page knows every map's types (app.js merges them at start, as the
  // note form offers them), so a "Notable NPC" may stand on any zone map. An unknown one would break the map for everyone.
  if(!supported.categories.includes(p.category)||typeof (p.note??'')!=='string'||(p.note||'').length>2000||![undefined,'marker','label','exit'].includes(p.noteType)||p.trade!==undefined&&!supported.trades.includes(p.trade)||p.color!==undefined&&!supported.colours.includes(p.color)||p.arrow!==undefined&&!supported.arrows.includes(p.arrow))fail('Unsupported marker fields for suggestion '+row.id+'.');
 }else if(typeof row.target_id!=='string'||!row.target_id)fail('Missing target for suggestion '+row.id+'.');
 // A marker edit may change the type too (set while reviewing): the same check as a new marker's type.
 if(row.kind==='edit-marker'&&p.category!==undefined&&(!supported.categories.includes(p.category)||p.category==='Personal'||p.trade!==undefined&&!supported.trades.includes(p.trade)))fail('Unsupported marker fields for suggestion '+row.id+'.');
 return p;
}
// Published state before this run touched a marker: several approved changes to one marker apply in order.
const original=new Map();
function before(path,m){const key=path+'#'+m.id;if(!original.has(key))original.set(key,{x:Math.round(m.x),y:Math.round(m.y),name:clean(m.name),note:clean(m.note||'',true),wiki:m.wiki||'',category:m.category});return original.get(key);}
// A type's own fields: a tradeskill's trade, a trainer's classes (from the atlas's class list only), a vendor's kind and
// Sells tags (old suggestions may still say supplies).
const typeKeys=['trade','classes','vendor','sells'];
function typeFields(m,p,id){
 if(p.trade&&p.category==='Tradeskill')m.trade=p.trade;
 if(p.category==='Class trainer'&&p.classes!==undefined){if(!classesOk(p.classes))fail('Unsupported classes for suggestion '+id+'.');m.classes=[...p.classes];}
 if(p.category==='Vendor'){if(p.vendor!==undefined){if(typeof p.vendor!=='string'||!vendorKindOk(p.vendor))fail('Unsupported vendor kind for suggestion '+id+'.');m.vendor=vendorKindNow(p.vendor);}
  if(!sellsOk(p.sells))fail('Unsupported Sells tags for suggestion '+id+'.');if(p.sells)m.sells=[...p.sells].sort((a,b)=>sellTypes.indexOf(a)-sellTypes.indexOf(b));}
 return m;
}
const typeOf=m=>JSON.stringify([m.category,...typeKeys.map(k=>m[k])]);
async function apply(row){
 const c=configuration(row),p=validatePayload(row,c),id='community-'+row.id;
 if(row.kind==='new-marker'){
  const [x,y]=point([p.x,p.y],c,row.id),label=p.noteType==='label'||p.noteType==='exit',path=label?c.labelsFile:c.markersFile,f=await file(path),rows=label?f.data.labels:f.data;
  if(!Array.isArray(rows))fail('Invalid feature file for suggestion '+row.id+'.');
  if(rows.some(m=>m.id===id))return 'already present';
  const m={id,community:true,name:clean(p.name),...(label?{kind:p.noteType==='exit'?'exit':'building',priority:50,minZoom:0}:{category:p.category}),note:clean(p.note||'',true),x,y,...(c.levels?{level:c.levelId}:{})};
  if(label&&p.noteType==='exit'){m.arrow=p.arrow||'east';if(typeof p.toMap==='string'&&registry.maps.some(r=>r.id===p.toMap))m.toMap=p.toMap;}
  if(!label){typeFields(m,p,row.id);if(p.color)m.color=p.color;const wiki=wikiOf(p.wiki,row.id),wikiId=wikiIdFrom(p,row.id);if(wiki){m.wiki=wiki;if(wikiId)m.wikiId=wikiId;}}
  rows.push(m);f.changed=true;return label?'place name added':'marker added';
 }
 // Text edits only apply while the published text is still what the visitor saw.
 if(row.kind==='edit-marker'||row.kind==='edit-label'){
  const label=row.kind==='edit-label',f=await file(label?c.labelsFile:c.markersFile),rows=label?f.data?.labels:f.data;
  if(!Array.isArray(rows))fail('Invalid feature file for suggestion '+row.id+'.');
  const m=rows.find(m=>m.id===row.target_id&&(!c.levels||!m.level||m.level===c.levelId));
  // An edit an admin approved as a removal takes the marker off the map, with the trainer chip of the same id.
  if(!label&&p.remove===true){
   if(m){rows.splice(rows.indexOf(m),1);f.changed=true;}
   if(c.labelsFile){const lf=await file(c.labelsFile),chips=lf.data?.trainers;if(Array.isArray(chips)){const i=chips.findIndex(t=>t.id===row.target_id);if(i>=0){chips.splice(i,1);lf.changed=true;}}}
   return m?'marker removed':'already removed';
  }
  if(!m)fail('Target missing for suggestion '+row.id+'.');
  // A marker edit may also set or clear the wiki link; older edits without one leave it as it is.
  const linked=!label&&p.wiki!==undefined,wiki=linked?wikiOf(p.wiki,row.id):'',seenWiki=linked?wikiOf(p.from.wiki,row.id):'';
  const name=clean(p.name),note=clean(p.note||'',true),was=before(label?c.labelsFile:c.markersFile,m),seen={name:clean(p.from.name),note:clean(p.from.note||'',true)};
  const now={name:clean(m.name),note:clean(m.note||'',true),wiki:m.wiki||''},same=(a,b)=>a.name===b.name&&a.note===b.note&&(!linked||a.wiki===b.wiki);
  // A new type (set while reviewing) applies while the published type is still the one the edit started from.
  const typed=!label&&p.category!==undefined?typeFields({category:p.category},p,row.id):null,retype=typed&&typeOf(m)!==typeOf(typed);
  if(same(now,{name,note,wiki})&&!retype)return 'already edited';
  if(!same(now,{name,note,wiki})&&!same(now,{...seen,wiki:seenWiki})&&!same(was,{...seen,wiki:seenWiki}))fail('The published text changed after this was sent; check it again.');
  if(retype&&typeof p.from.category==='string'&&m.category!==p.from.category&&m.category!==typed.category&&was.category!==p.from.category)fail('The published type changed after this was sent; check it again.');
  if(retype){m.category=typed.category;for(const k of typeKeys)if(Object.hasOwn(typed,k))m[k]=typed[k];else delete m[k];
   // Its trainer chip follows: gone when it is no longer a trainer, otherwise showing the classes it teaches now.
   if(c.labelsFile){const lf=await file(c.labelsFile),chips=lf.data?.trainers,i=Array.isArray(chips)?chips.findIndex(t=>t.id===m.id):-1;
    if(i>=0&&m.category!=='Class trainer'){chips.splice(i,1);lf.changed=true;}
    else if(i>=0&&m.classes?.length){chips[i].classes=[...m.classes];chips[i].abbreviations=m.classes.map(k=>classAbbreviations[k]);lf.changed=true;}}}
  m.name=name;if(note||Object.hasOwn(m,'note'))m.note=note;if(linked){const wikiId=wikiIdFrom(p,row.id);if(wikiId)m.wikiId=wikiId;else if(wiki!==(m.wiki||''))delete m.wikiId;if(wiki)m.wiki=wiki;else{delete m.wiki;delete m.wikiId;}}m.community=true;f.changed=true;return label?'place name edited':'marker edited';
 }
 const path=row.kind==='move-label'?c.labelsFile:c.markersFile,f=await file(path),rows=row.kind==='move-label'?f.data.labels:f.data;
 if(!Array.isArray(rows))fail('Invalid feature file for suggestion '+row.id+'.');
 const m=rows.find(m=>m.id===row.target_id&&(!c.levels||!m.level||m.level===c.levelId));if(!m)fail('Target missing for suggestion '+row.id+'.');
 const [x,y]=point(p.to,c,row.id),from=point(p.from,c,row.id),was=before(path,m);
 if(Math.round(m.x)===x&&Math.round(m.y)===y)return 'already positioned';
 if(!(Math.round(m.x)===from[0]&&Math.round(m.y)===from[1])&&!(was.x===from[0]&&was.y===from[1]))fail('The published position changed after this was sent; check it again.');
 m.x=x;m.y=y;m.community=true;f.changed=true;
 if(row.kind==='move-marker'&&c.labelsFile){const labels=await file(c.labelsFile),trainer=labels.data.trainers?.find(t=>t.id===m.id);if(trainer){trainer.x=x;trainer.y=y;labels.changed=true;}}
 return 'position moved';
}
// Credits are kept in the database so a deleted account's rows lose their user and show as Anonymous;
// the public list is rebuilt from them on every run, also when nothing new was approved.
async function updateContributors(credited){
 let log=[];
 try{
  if(!dryRun&&credited.length)await request('credits?on_conflict=suggestion_id',{method:'POST',headers:{Prefer:'resolution=ignore-duplicates,return=minimal'},body:JSON.stringify(credited)});
  for(let offset=0;;offset+=1000){const page=await request('credits?select=suggestion_id,user_id,name&order=suggestion_id.asc&limit=1000&offset='+offset);if(!Array.isArray(page))fail('Invalid credits response.');log.push(...page);if(page.length<1000)break;}
 }catch(e){console.warn('Contributors not updated: '+e.message);return;}
 if(dryRun)for(const c of credited)if(!log.some(r=>r.suggestion_id===c.suggestion_id))log.push(c);
 const people=new Map();
 for(const r of log){const key=r.user_id||'anonymous',p=people.get(key)||{name:'',count:0};p.count++;if(r.user_id)p.name=clean(r.name||'').slice(0,80)||p.name;people.set(key,p);}
 const list=[...people].map(([key,p])=>({name:key==='anonymous'||!p.name?'Anonymous':p.name,count:p.count})).reduce((all,p)=>{const same=p.name==='Anonymous'&&all.find(r=>r.name==='Anonymous');if(same)same.count+=p.count;else all.push(p);return all;},[]).sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name));
 const f=await file('data/contributors.json',{contributors:[]});
 if(JSON.stringify(f.data.contributors||[])!==JSON.stringify(list)){f.data={contributors:list};f.changed=true;console.log((dryRun?'Would list ':'Listing ')+list.length+' contributors.');}
}
async function main(){
 const rows=[];let after='0';
 while(true){const batch=await request('suggestions?status=eq.approved&select=*&order=id.asc&id=gt.'+after+'&limit=1000');if(!Array.isArray(batch))fail('Invalid suggestions response.');rows.push(...batch);if(batch.length<1000)break;after=batch.at(-1).id;}
 if(!rows.length)console.log('No approved suggestions.');
 // A suggestion that cannot apply goes back to the review queue with the reason; the others still publish.
 const applied=[],credited=[],held=[];
 for(const row of rows){if(!/^\d+$/.test(String(row.id)))fail('Invalid suggestion id.');let result;
  try{result=await apply(row);}catch(e){held.push({id:row.id,note:'Not published: '+String(e.message).slice(0,480)});console.log((process.env.GITHUB_ACTIONS?'::warning::':'')+'Suggestion '+row.id+' goes back to review: '+e.message);continue;}
  applied.push(row.id);console.log((dryRun?'Would apply ':'Ready to apply ')+row.id+': '+result+'.');
  // Credits count published changes from people who ticked "Credit me as a contributor".
  const who=row.credit===true&&typeof row.author_name==='string'?clean(row.author_name).slice(0,80):'';if(who&&row.user_id&&!result.startsWith('already'))credited.push({suggestion_id:row.id,user_id:row.user_id,name:who});}
 await updateContributors(credited);
 const changed=[...files].filter(([,f])=>f.changed);
 if(!dryRun){
  for(const [path,f] of changed){let content=JSON.stringify(f.data,null,f.indent).replace(/\n/g,f.newline);if(f.trailing)content+=f.newline;const target=dataPath(path),temporary=target+'.tmp';await writeFile(temporary,content,'utf8');await rename(temporary,target);}
  for(const h of held)await request('suggestions?status=eq.approved&id=eq.'+h.id,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({status:'pending',review_note:h.note})});
  for(let offset=0;offset<applied.length;offset+=100){const ids=applied.slice(offset,offset+100).join(',');await request('suggestions?status=eq.approved&id=in.('+ids+')',{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify({status:'published'})});}
 }
 console.log((dryRun?'Dry run: ':'Complete: ')+applied.length+' suggestions, '+(held.length?held.length+' back to review, ':'')+changed.length+' data files'+(dryRun?' would change.':' changed.'));
}
main().catch(e=>{console.error(e.message==='fetch failed'?'Backend could not be reached.':e.message);process.exitCode=1;});
