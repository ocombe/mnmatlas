import {readFile,writeFile,rename,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,relative,dirname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),dryRun=process.argv.includes('--dry-run');
const args=process.argv.slice(2),url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_KEY;
const fail=message=>{throw new Error(message);},warning=message=>console.log('::warning::'+String(message).replace(/[\r\n]/g,' '));
const parse=text=>JSON.parse(text.replace(/^\uFEFF/,''));
const mark=args[0]==='--mark-published'?args[1]:null;
if(mark?args.length!==2:args.some(a=>a!=='--dry-run'))fail('Usage: node scripts/apply-approved.mjs [--dry-run | --mark-published <file>]');
if(!url||!key)fail('Set SUPABASE_URL and SUPABASE_SERVICE_KEY in your environment.');
const endpoint=new URL(url);if(!['https:','http:'].includes(endpoint.protocol))fail('Invalid project URL.');
const headers={apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'};
async function request(path,options={}){
 const response=await fetch(new URL('rest/v1/'+path,endpoint.href.replace(/\/$/,'')+'/'),{...options,headers:{...headers,...options.headers}});
 if(!response.ok)fail('Backend request failed (HTTP '+response.status+').');
 const body=await response.text();return body?JSON.parse(body):null;
}
const files=new Map();let staged=null;
function dataPath(path){
 if(typeof path!=='string'||!/^data\/[a-zA-Z0-9_./-]+\.json$/.test(path)||path.split('/').includes('..')||path.split('/').includes('tiles'))fail('Invalid data file in map registry.');
 const absolute=resolve(root,path),local=relative(root,absolute);if(local.startsWith('..'+sep)||local==='..')fail('Data file is outside the atlas.');return absolute;
}
async function file(path,empty){
 if(!files.has(path)){let original;try{original=await readFile(dataPath(path),'utf8');}catch(e){if(empty===undefined||e.code!=='ENOENT')throw e;original=JSON.stringify(empty,null,2)+'\n';}const spacing=original.match(/\r?\n([ \t]+)\S/);files.set(path,{data:parse(original),original,indent:spacing?spacing[1]:2,newline:original.includes('\r\n')?'\r\n':'\n',trailing:/\r?\n$/.test(original),changed:false});}
 if(staged){if(!staged.has(path))staged.set(path,{...files.get(path),data:structuredClone(files.get(path).data)});return staged.get(path);}return files.get(path);
}
const registry=parse(await readFile(resolve(root,'data/maps.json'),'utf8'));
// Reuse the site's supported categories, trades, arrows and colour palette.
const context=vm.createContext({URL});
const app=await readFile(resolve(root,'app.js'),'utf8'),icons=await readFile(resolve(root,'icons.js'),'utf8'),wikiLinks=await readFile(resolve(root,'wiki-links.js'),'utf8');
vm.runInContext(app.slice(app.indexOf('const baseCategories='),app.indexOf('const mobileLayout=')),context);
vm.runInContext(icons,context);
vm.runInContext(await readFile(resolve(root,'changes.js'),'utf8'),context);const {buildChanges,fieldsOf,matchesFrom,conflicts,applyTo,whatOf}=context.atlasChanges;
// Wiki links: only pages on the sites the atlas knows, in the same stored form the site writes.
vm.runInContext(wikiLinks,context);const wikiAddress=vm.runInContext('wikiAddress',context),wikiIdOf=vm.runInContext('wikiIdOf',context),classesOk=vm.runInContext('classesOk',context),vendorKindOk=vm.runInContext('vendorKindOk',context),vendorKindNow=vm.runInContext('vendorKindNow',context),sellsOk=vm.runInContext('sellsOk',context),sellTypes=vm.runInContext('sellTypes',context),normaliseChange=vm.runInContext('normaliseChange',context),normaliseMarker=vm.runInContext('normaliseMarker',context),classAbbreviations=vm.runInContext('classAbbreviations',context);
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
 const p=normaliseMarker(structuredClone(row.payload));if(!p||Array.isArray(p)||typeof p!=='object'||typeof p.name!=='string'||!clean(p.name)||p.name.length>100||Buffer.byteLength(JSON.stringify(p))>=4096)fail('Invalid payload for suggestion '+row.id+'.');
 if(!['move-marker','move-label','new-marker','edit-marker','edit-label'].includes(row.kind))fail('Invalid kind for suggestion '+row.id+'.');
 if(p.remove!==undefined&&(p.remove!==true||!['edit-marker','edit-label'].includes(row.kind)||p.reason!==undefined&&!['duplicate','missing','other'].includes(p.reason)))fail('Invalid removal for suggestion '+row.id+'.');
 if(row.kind!=='new-marker'&&(Object.hasOwn(p,'bounty')||Object.hasOwn(p,'priority')))fail('Bounty flags need a new marker.');
 if((row.kind==='edit-marker'||row.kind==='edit-label')&&(!p.from||typeof p.from!=='object'||typeof p.from.name!=='string'||typeof (p.note??'')!=='string'||(p.note||'').length>2000))fail('Invalid edit for suggestion '+row.id+'.');
 if(row.kind==='new-marker'){
  // Only categories the atlas can draw: every map's page knows every map's types (app.js merges them at start, as the
  // note form offers them), so a "Notable NPC" may stand on any zone map. An unknown one would break the map for everyone.
  if(!supported.categories.includes(p.category)||typeof (p.note??'')!=='string'||(p.note||'').length>2000||![undefined,'marker','label','exit'].includes(p.noteType)||p.trade!==undefined&&!supported.trades.includes(p.trade)||p.color!==undefined&&!supported.colours.includes(p.color)||p.arrow!==undefined&&!supported.arrows.includes(p.arrow))fail('Unsupported marker fields for suggestion '+row.id+'.');
 }else if(typeof row.target_id!=='string'||!row.target_id)fail('Missing target for suggestion '+row.id+'.');
 // A marker edit may change the type too (set while reviewing): the same check as a new marker's type.
 if(row.kind==='edit-marker'&&p.category!==undefined&&(!supported.categories.includes(p.category)||p.category==='Personal'||p.trade!==undefined&&!supported.trades.includes(p.trade)))fail('Unsupported marker fields for suggestion '+row.id+'.');
 p.name=clean(p.name);if(p.note!==undefined)p.note=clean(p.note,true);
 if(p.from&&!Array.isArray(p.from))p.from={...p.from,name:clean(p.from.name),...(p.from.note!==undefined?{note:clean(p.from.note,true)}:{})};
 if(row.kind==='new-marker')point([p.x,p.y],c,row.id);else if(row.kind.startsWith('move-')){point(p.from,c,row.id);point(p.to,c,row.id);}
 return normaliseChange({...row,payload:p}).payload;
}
// Every row works on private file copies; a refused row never leaves part of its change behind.
const original=new Map(),history=new Map();let batch=[],past=null,heldIds=new Set(),missingVersion=false;
function before(path,m,row){const key=path+'#'+runKey(row);if(!original.has(key))original.set(key,structuredClone(m));return original.get(key);}
const typeKeys=['trade','classes','vendor','sells'];
function typeFields(m,p,id){
 if(p.trade&&p.category==='Tradeskill')m.trade=p.trade;
 if(p.category==='Class trainer'&&p.classes!==undefined){if(!classesOk(p.classes))fail('Unsupported classes for suggestion '+id+'.');m.classes=[...p.classes];}
 if(p.category==='Vendor'){if(p.vendor!==undefined){if(typeof p.vendor!=='string'||!vendorKindOk(p.vendor))fail('Unsupported vendor kind for suggestion '+id+'.');m.vendor=vendorKindNow(p.vendor);}
  if(!sellsOk(p.sells))fail('Unsupported Sells tags for suggestion '+id+'.');if(p.sells)m.sells=[...p.sells].sort((a,b)=>sellTypes.indexOf(a)-sellTypes.indexOf(b));}
 return m;
}
const targetKind=row=>row.kind.endsWith('label')||row.kind==='new-marker'&&['label','exit'].includes(row.payload?.noteType)?'label':'marker';
const runKey=row=>row.runKey||row.map+'#'+targetKind(row)+'#'+(row.kind==='new-marker'?'community-'+row.id:row.target_id);
// Validate the whole run before any retry can use a later row as a link in its chain.
async function prepare(row){
 const c=configuration(row),p=validatePayload(row,c),label=targetKind({...row,payload:p})==='label';
 if(row.kind==='new-marker')[p.x,p.y]=point([p.x,p.y],c,row.id);
 else if(row.kind.startsWith('move-')){p.from=point(p.from,c,row.id);p.to=point(p.to,c,row.id);}
 const f=await file(label?c.labelsFile:c.markersFile),rows=label?f.data?.labels:f.data;
 if(!Array.isArray(rows))fail('Invalid feature file for suggestion '+row.id+'.');
 const m=rows.find(m=>m.id===row.target_id),chip=!label&&c.labelsFile?(await file(c.labelsFile)).data?.trainers?.find(m=>m.id===row.target_id):null;
 const category=p.category||p.from?.category||m?.category||(chip?'Class trainer':undefined);
 if(!label&&!row.kind.startsWith('move-')){
  if(!category&&p.classes!==undefined&&!classesOk(p.classes))fail('Unsupported classes for suggestion '+row.id+'.');
  if(p.wiki!==undefined||row.kind==='new-marker')p.wiki=wikiOf(p.wiki,row.id);
  if(p.wikiId!==undefined||row.kind==='new-marker')p.wikiId=wikiIdFrom(p,row.id);
  if(p.wiki!==undefined&&p.from?.wiki!==undefined)p.from.wiki=wikiOf(p.from.wiki,row.id);
  const typed=typeFields({category},{...p,category},row.id);for(const k of typeKeys)if(Object.hasOwn(p,k)){if(Object.hasOwn(typed,k))p[k]=typed[k];else delete p[k];}
  if(p.from&&!Array.isArray(p.from)){p.from=normaliseMarker(p.from);if(p.from.vendor!==undefined)p.from.vendor=vendorKindNow(p.from.vendor);if(Array.isArray(p.from.sells))p.from.sells=[...p.from.sells].sort((a,b)=>sellTypes.indexOf(a)-sellTypes.indexOf(b));}
 }
 if(row.kind.startsWith('edit-'))for(const k of ['color','level','arrow','toMap'])if(p[k]!==undefined&&(k==='color'&&!supported.colours.includes(p[k])||k==='level'&&!(c.levels||[]).some(l=>l.id===p[k])||k==='arrow'&&!supported.arrows.includes(p[k])||k==='toMap'&&!registry.maps.some(r=>r.id===p[k])))fail('Unsupported marker fields for suggestion '+row.id+'.');
 const added=batch.find(r=>r.kind==='new-marker'&&r.map===row.map&&'community-'+r.id===row.target_id),level=(label?row.level:(row.kind==='new-marker'?c.levelId:(m||chip)?.level||added?.level))?'#'+(row.level||''):'';
 return {...row,payload:p,runKey:row.map+'#'+targetKind({...row,payload:p})+'#'+(row.kind==='new-marker'?'community-'+row.id:row.target_id)+level};
}
function laterState(row,state){
 let next=state,chained=false;const changed=new Set(),log=[{id:row.id,fields:fieldsOf(row)}];
 for(const later of batch){if(heldIds.has(String(later.id))||Number(later.id)<=Number(row.id)||runKey(later)!==runKey(row))continue;
  const r=later,touched=fieldsOf(r);
  if(conflicts(r,next,log).length||![...touched].every(f=>matchesFrom(r,next,f)))continue;chained=true;for(const f of touched)changed.add(f);next=applyTo(next,r);log.push({id:r.id,fields:touched});
 }
 return {next,chained,changed};
}
// A retry may see the last link of a chain already live. Its earlier links still earned their credit.
function superseded(row,m){
 const fields=fieldsOf(row);if(!fields.size||fields.has('added')||fields.has('removed'))return false;
 const base=Array.isArray(row.payload.from)?{...m,name:row.payload.name,x:row.payload.from[0],y:row.payload.from[1]}:{...m,...row.payload.from};
 const {next,chained,changed}=laterState(row,applyTo(base,row));
 if(!chained||![...changed].some(f=>fields.has(f)||f==='removed'))return false;if(next.removed)return !m;
 return !!m&&[...fields].every(f=>matchesFrom({...row,payload:{...row.payload,from:f==='position'?[next.x,next.y]:next}},m,f));
}
function check(row,m,path){
 const log=history.get(runKey(row))||[],hits=conflicts(row,m,log);if(hits.length)fail('conflicts with #'+hits.join(', #'));
 if(!m)return;
 const was=before(path,m,row);
 for(const field of fieldsOf(row))if(field!=='added'&&!matchesFrom(row,m,field)&&!matchesFrom(row,was,field)){
  if(field==='position')fail('The published position changed after this was sent; check it again.');
  if(field==='type')fail('The published type changed after this was sent; check it again.');
  fail('The published text changed after this was sent; check it again.');
 }
}
async function applyRow(row){
 const c=configuration(row),p=row.payload,id='community-'+row.id;
 row={...row,payload:p};
 if(row.kind==='new-marker'){
  const [x,y]=point([p.x,p.y],c,row.id),label=['label','exit'].includes(p.noteType),path=label?c.labelsFile:c.markersFile,f=await file(path),rows=label?f.data.labels:f.data;
  if(!Array.isArray(rows))fail('Invalid feature file for suggestion '+row.id+'.');
  const existing=rows.find(m=>m.id===id);
  if(existing)return 'already present';
  if((await publishedSuggestions()).some(r=>r.payload?.remove===true&&r.map===row.map&&targetKind(r)===targetKind(row)&&r.target_id===id)||(history.get(runKey(row))||[]).some(r=>r.fields.has('removed')))return 'already removed';
  const m={id,community:true,name:clean(p.name),...(label?{kind:p.noteType==='exit'?'exit':'building',priority:50,minZoom:0}:{category:p.category}),note:clean(p.note||'',true),x,y,...(c.levels?{level:c.levelId}:{})};
  if(label&&p.noteType==='exit'){m.arrow=p.arrow||'east';if(typeof p.toMap==='string'&&registry.maps.some(r=>r.id===p.toMap))m.toMap=p.toMap;}
  if(!label){typeFields(m,p,row.id);if(p.color)m.color=p.color;const wiki=wikiOf(p.wiki,row.id),wikiId=wikiIdFrom(p,row.id);if(wiki){m.wiki=wiki;if(wikiId)m.wikiId=wikiId;}}
  rows.push(m);f.changed=true;return label?'place name added':'marker added';
 }
 const label=row.kind.endsWith('label'),path=label?c.labelsFile:c.markersFile,f=await file(path),rows=label?f.data?.labels:f.data;
 if(!Array.isArray(rows))fail('Invalid feature file for suggestion '+row.id+'.');
 let m=rows.find(m=>m.id===row.target_id&&(fieldsOf(row).has('level')||!c.levels||!m.level||m.level===c.levelId)),mf=f,mrows=rows;
 const lf=c.labelsFile?await file(c.labelsFile):null,chips=lf?.data?.trainers,chip=chips?.find(t=>t.id===row.target_id&&(fieldsOf(row).has('level')||!c.levels||!t.level||t.level===c.levelId));
 if(!m&&!label&&chip){m=chip;mf=lf;mrows=chips;}
 const live=m&&m===chip?{...m,name:m.name||m.building||'',category:m.category||'Class trainer'}:m;
 const edit=row.kind.startsWith('edit-'),fields=fieldsOf(row);
 if(edit){
  // Validate even an unchanged link or type before deciding that a retry is already live.
  const linked=!label&&p.wiki!==undefined,wiki=linked?wikiOf(p.wiki,row.id):m?.wiki||'',wikiId=linked||p.wikiId!==undefined?wikiIdFrom(p,row.id):'';
  if(linked)wikiOf(p.from.wiki,row.id);
  const category=p.category||m?.category||(m&&m===chip?'Class trainer':undefined),validated=typeFields({category},{...p,category},row.id),typed=fields.has('type')?validated:null;
  for(const k of ['color','level','arrow','toMap'])if(p[k]!==undefined&&(k==='color'&&!supported.colours.includes(p[k])||k==='level'&&!(c.levels||[]).some(l=>l.id===p[k])||k==='arrow'&&!supported.arrows.includes(p[k])||k==='toMap'&&!registry.maps.some(r=>r.id===p[k])))fail('Unsupported marker fields for suggestion '+row.id+'.');
  if(!conflicts(row,live,history.get(runKey(row))||[]).length&&superseded(row,live))return 'already superseded';
  if(!m){check(row,null,path);if(p.remove)return 'already removed';fail('Target missing for suggestion '+row.id+'.');}
  const next=structuredClone(m);
  if(p.remove){check(row,live,path);mrows.splice(mrows.indexOf(m),1);mf.changed=true;if(chip&&chip!==m){chips.splice(chips.indexOf(chip),1);lf.changed=true;}return label?'place name removed':'marker removed';}
  if(fields.has('name'))next.name=clean(p.name);
  if(fields.has('note'))next.note=clean(p.note||'',true);
  if(typed){next.category=typed.category;for(const k of typeKeys)if(Object.hasOwn(typed,k))next[k]=typed[k];else delete next[k];}
  if(fields.has('wiki')){if(wiki){next.wiki=wiki;if(wikiId)next.wikiId=wikiId;else if(p.wikiId!==undefined||wiki!==m.wiki)delete next.wikiId;}else{delete next.wiki;delete next.wikiId;}}
  for(const k of ['color','level','arrow','toMap'])if(fields.has(k))next[k]=p[k];
  // Retries after a successful push can find the desired values already on the map.
  const hits=conflicts(row,live,history.get(runKey(row))||[]);if(hits.length)fail('conflicts with #'+hits.join(', #'));
  if(JSON.stringify(next)===JSON.stringify(m))return 'already edited';
  check(row,live,path);next.community=true;mrows[mrows.indexOf(m)]=next;mf.changed=true;
  if(chip&&chip!==m){if(typed&&next.category!=='Class trainer')chips.splice(chips.indexOf(chip),1);else{const updated=structuredClone(chip);if(fields.has('name'))updated.name=next.name;if(fields.has('note'))updated.note=next.note;if(next.classes?.length){updated.classes=[...next.classes];updated.abbreviations=next.classes.map(k=>classAbbreviations[k]);}chips[chips.indexOf(chip)]=updated;}lf.changed=true;}
  else if(m===chip&&next.classes?.length)next.abbreviations=next.classes.map(k=>classAbbreviations[k]);
  return label?'place name edited':'marker edited';
 }
 const [x,y]=point(p.to,c,row.id);point(p.from,c,row.id);
 const hits=conflicts(row,live,history.get(runKey(row))||[]);if(hits.length)fail('conflicts with #'+hits.join(', #'));
 if(superseded(row,live))return 'already superseded';
 if(!m)fail('Target missing for suggestion '+row.id+'.');
 if(Math.round(m.x)===x&&Math.round(m.y)===y)return 'already positioned';
 check(row,live,path);m.x=x;m.y=y;m.community=true;mf.changed=true;
 if(!label&&chip&&chip!==m){chip.x=x;chip.y=y;lf.changed=true;}return 'position moved';
}
async function apply(row){
 staged=new Map();try{const result=await applyRow(row);for(const [path,f] of staged)files.set(path,f);
  const key=runKey(row),log=history.get(key)||[];log.push({id:row.id,fields:result==='already superseded'||row.kind==='new-marker'&&['already present','already removed'].includes(result)?new Set():fieldsOf(row)});history.set(key,log);return result;
 }finally{staged=null;}
}
// Credits are kept in the database so a deleted account's rows lose their user and show as Anonymous;
// the public list is rebuilt from them on every run, also when nothing new was approved.
async function updateContributors(credited,applied){
 let log=[];
 try{
  if(!dryRun&&credited.length)await request('credits?on_conflict=suggestion_id',{method:'POST',headers:{Prefer:'resolution=ignore-duplicates,return=minimal'},body:JSON.stringify(credited)});
  for(let offset=0;;offset+=1000){const page=await request('credits?select=suggestion_id,user_id,name&order=suggestion_id.asc&limit=1000&offset='+offset);if(!Array.isArray(page))fail('Invalid credits response.');log.push(...page);if(page.length<1000)break;}
 }catch(e){fail('Contributors not updated: '+e.message);}
 for(const c of credited)if(!log.some(r=>r.suggestion_id===c.suggestion_id))log.push(c);
 const live=new Set([...(await publishedSuggestions()).map(r=>String(r.id)),...applied.map(r=>String(r.id))]),people=new Map();
 for(const r of log){if(!live.has(String(r.suggestion_id)))continue;const key=r.user_id||'anonymous',p=people.get(key)||{name:'',count:0};p.count++;if(r.user_id)p.name=clean(r.name||'').slice(0,80)||p.name;people.set(key,p);}
 const list=[...people].map(([key,p])=>({name:key==='anonymous'||!p.name?'Anonymous':p.name,count:p.count})).reduce((all,p)=>{const same=p.name==='Anonymous'&&all.find(r=>r.name==='Anonymous');if(same)same.count+=p.count;else all.push(p);return all;},[]).sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name));
 const f=await file('data/contributors.json',{contributors:[]});
 if(JSON.stringify(f.data.contributors||[])!==JSON.stringify(list)){f.data={contributors:list};f.changed=true;console.log((dryRun?'Would list ':'Listing ')+list.length+' contributors.');}
 return log;
}
// Hash sorted keys so the database's JSON key order cannot change the version we applied.
function hash(payload){const stable=v=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;return createHash('sha256').update(JSON.stringify(stable(payload))).digest('hex');}
function versionWarning(row){if(!row.updated_at&&!missingVersion){missingVersion=true;warning('Suggestion version column is missing; checking payload hashes before status updates.');}}
async function guardedPatch(row,body){
 versionWarning(row);
 if(!row.updated_at){const latest=(await request('suggestions?id=eq.'+row.id+'&select=*'))?.[0];if(!latest||latest.status!==row.status||hash(latest.payload)!==hash(row.payload))return false;
  // Truth also wins for a later rejection: restore approved under its current status guard first.
  if(row.status!=='approved'&&body.status==='published'){
   const restored=await request('suggestions?id=eq.'+row.id+'&status=eq.'+encodeURIComponent(row.status),{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify({status:'approved'})});
   if(!restored?.length)return false;return guardedPatch({...row,status:'approved'},body);
  }
 }
 const result=await request('suggestions?id=eq.'+row.id+(row.updated_at?'&updated_at=eq.'+encodeURIComponent(row.updated_at):'&status=eq.'+encodeURIComponent(row.status)),{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify(body)});
 return Array.isArray(result)&&result.length>0;
}
async function liveTarget(row){
 const c=configuration(row),label=targetKind(row)==='label',f=await file(label?c.labelsFile:c.markersFile),id=row.kind==='new-marker'?'community-'+row.id:row.target_id;
 const here=m=>m.id===id&&(!c.levels||!m.level||m.level===row.level||row.payload?.level===m.level);
 return (label?f.data.labels:f.data).find(here)||(!label&&c.labelsFile?(await file(c.labelsFile)).data.trainers?.find(here):null);
}
const publicValues=m=>Object.fromEntries(['name','note','wiki','wikiId','category',...typeKeys,'color','level','arrow','toMap'].filter(k=>Object.hasOwn(m||{},k)).map(k=>[k,m[k]]));
async function recoverVersion(row,a){
 const same=hash(row.payload)===a.payloadHash,m=same?null:await liveTarget(row),payload=structuredClone(row.payload),credit=(await request('credits?select=suggestion_id,user_id,name&suggestion_id=eq.'+row.id))?.find(c=>String(c.suggestion_id)===String(row.id));
 if(m){
  if(row.kind.startsWith('move-'))payload.to=[m.x,m.y];
  else {for(const k of ['name','note','wiki','wikiId','category',...typeKeys,'color','level','arrow','toMap'])if(Object.hasOwn(payload,k)){if(Object.hasOwn(m,k))payload[k]=m[k];else if(['note','wiki','wikiId'].includes(k))payload[k]='';else delete payload[k];}if(row.kind==='new-marker'){payload.x=m.x;payload.y=m.y;}}
 }
 return {...row,payload,credit:!!credit,...(credit?{user_id:credit.user_id,author_name:credit.name}:{})};
}
async function correctionRows(row,version,appliedHash){
 if(row.status==='rejected'||hash(row.payload)===appliedHash)return [];
 const live=await liveTarget(version),p=structuredClone(row.payload),base=live?publicValues(live):publicValues(version.payload),label=targetKind(version)==='label',meta=Object.fromEntries(['user_id','author_name','credit','map','level'].filter(k=>Object.hasOwn(row,k)).map(k=>[k,row[k]]));
 const make=(kind,payload)=>({...meta,status:'approved',kind,target_id:version.kind==='new-marker'?'community-'+row.id:row.target_id,payload,review_note:'Correction made after publishing (#'+row.id+')'});
 if(row.kind.startsWith('move-'))return [make(row.kind,{...p,from:live?[live.x,live.y]:version.payload.to})];
 if(row.kind!=='new-marker')return [make(row.kind,{...p,from:base})];
 const out=[],text={...p,from:base};for(const k of ['x','y','bounty','priority','noteType',...(label?['category',...typeKeys]:[])])delete text[k];
 if([...fieldsOf({kind:label?'edit-label':'edit-marker',payload:text})].length)out.push(make(label?'edit-label':'edit-marker',text));
 if(live&&(Math.round(p.x)!==live.x||Math.round(p.y)!==live.y))out.push(make(label?'move-label':'move-marker',{name:p.name,from:[live.x,live.y],to:[p.x,p.y]}));return out;
}
async function acknowledge(applied){
 for(const a of applied){
  if(!/^\d+$/.test(String(a.id))||!/^[a-f0-9]{64}$/.test(a.payloadHash))fail('Invalid applied entry.');
  try{
   const row=(await request('suggestions?id=eq.'+a.id+'&select=*'))?.[0];if(!row||row.status==='published')continue;versionWarning(row);
   const version=a.version?{...row,...a.version}:await recoverVersion(row,a),corrections=await correctionRows(row,version,a.payloadHash),same=hash(row.payload)===a.payloadHash&&row.updated_at===(a.updated_at??a.updatedAt??undefined)&&row.status==='approved',body={status:'published'};
   if(!same){
    body.review_note='Published as approved on '+(a.appliedAt||new Date().toISOString())+'; a later change was not included.'+(corrections.length?' The correction returns to the review queue.':'');
   }
   for(const k of ['map','level','kind','target_id','payload','credit','author_name'])if(Object.hasOwn(version,k))body[k]=version[k];
   if(row.user_id===null)body.author_name=null;
   // Save the correction first: a lost acknowledgement can retry without losing the traveller's change.
   if(!dryRun)for(const correction of corrections){
    const existing=await request('suggestions?select=*&review_note=eq.'+encodeURIComponent(correction.review_note));
    if(!existing.some(r=>r.review_note===correction.review_note&&r.kind===correction.kind&&hash(r.payload)===hash(correction.payload)))await request('suggestions',{method:'POST',body:JSON.stringify(correction)});
   }
   if(!dryRun)await guardedPatch(row,body);
  }catch(e){warning('Suggestion '+a.id+' could not be acknowledged: '+e.message);}
 }
 past=null;
}
async function markPublished(path){const applied=parse(await readFile(resolve(root,path),'utf8'));if(!Array.isArray(applied))fail('Invalid applied list.');await acknowledge(applied);}
async function updateCredits(applied,log){
 const published=await publishedSuggestions();
 const rows=new Map(published.map(r=>[String(r.id),r]));for(const r of applied)rows.set(String(r.id),r);
 const names=new Map(log.map(r=>[String(r.suggestion_id),r])),maps=new Map(registry.maps.map(m=>[m.id,{}]));
 for(const r of [...rows.values()].sort((a,b)=>Number(a.id)-Number(b.id))){
  if(r.kind==='report'||!maps.has(r.map))continue;const id=r.kind==='new-marker'?'community-'+r.id:r.target_id;if(!id)continue;
  const credit=names.get(String(r.id)),name=r.credit===true&&r.user_id&&credit?.user_id?clean(credit.name||'').slice(0,80)||null:null;
  const map=maps.get(r.map),key=targetKind(r)+':'+id+(targetKind(r)==='label'&&r.level?'#'+r.level:'');if(!Object.hasOwn(map,key))Object.defineProperty(map,key,{value:[],enumerable:true});map[key].push({name,what:whatOf(r)});
 }
 for(const [map,data] of maps){const f=await file('data/credits/'+map+'.json',{});if(JSON.stringify(f.data)!==JSON.stringify(data)){f.data=data;f.changed=true;}}
}
async function publishedSuggestions(){
 if(past)return past;const rows=[];let after='0';
 while(true){const page=await request('suggestions?status=eq.published&select=*&order=id.asc&id=gt.'+after+'&limit=1000');if(!Array.isArray(page))fail('Invalid published suggestions response.');rows.push(...page);if(page.length<1000)break;after=page.at(-1).id;}
 past=rows;return rows;
}
// Reuse the text of unchanged entries, including decimal spelling and line endings.
function keepRows(f){
 const text=f.original;let at=0;
 function node(){while(/\s/.test(text[at]||''))at++;const start=at,children=[];
  if(text[at]==='['||text[at]==='{'){const object=text[at++]==='{',end=object?'}':']';while(true){while(/\s/.test(text[at]||''))at++;if(text[at]===end){at++;break;}let key;
    if(object){const k=node();key=JSON.parse(text.slice(k.start,k.end));while(/\s/.test(text[at]||''))at++;at++;}
    const child=node();children.push({key,...child});while(/\s/.test(text[at]||''))at++;if(text[at]===',')at++;
   }
  }else if(text[at]==='"'){at++;while(at<text.length){if(text[at]==='\\'){at+=2;continue;}if(text[at++]==='"')break;}}
  else while(at<text.length&&!/[\s,}\]]/.test(text[at]))at++;
  return {start,end:at,children,value:JSON.parse(text.slice(start,at))};
 }
 const tree=node(),indent=typeof f.indent==='number'?' '.repeat(f.indent):f.indent;
 const fresh=(v,depth)=>JSON.stringify(v,null,indent).replace(/\n/g,f.newline+indent.repeat(depth));
 function render(n,v,depth){
  if(JSON.stringify(n.value)===JSON.stringify(v))return text.slice(n.start,n.end);
  if(Array.isArray(v)&&Array.isArray(n.value)){
   if(!v.length)return '[]';const byId=new Map(n.children.filter(c=>c.value?.id!==undefined).map(c=>[c.value.id,c]));
   return '['+f.newline+v.map((x,i)=>indent.repeat(depth+1)+(byId.get(x?.id)?render(byId.get(x.id),x,depth+1):n.children[i]&&x?.id===undefined?render(n.children[i],x,depth+1):fresh(x,depth+1))).join(','+f.newline)+f.newline+indent.repeat(depth)+']';
  }
  if(v&&typeof v==='object'&&!Array.isArray(v)&&n.value&&typeof n.value==='object'&&!Array.isArray(n.value)&&JSON.stringify(Object.keys(v))===JSON.stringify(Object.keys(n.value))){
   let out='',end=n.start;for(const c of n.children){out+=text.slice(end,c.start)+render(c,v[c.key],depth+1);end=c.end;}return out+text.slice(end,n.end);
  }
  return fresh(v,depth);
 }
 return text.slice(0,tree.start)+render(tree,f.data,0)+text.slice(tree.end);
}
async function main(){
 const publishLog=await file('data/publish-log.json',[]);if(!Array.isArray(publishLog.data))fail('Invalid publish log.');
 await acknowledge(publishLog.data.flatMap(run=>run.rows.map(row=>({...row,appliedAt:run.at}))));
 const rows=[];let after='0';
 while(true){const batch=await request('suggestions?status=eq.approved&select=*&order=id.asc&id=gt.'+after+'&limit=1000');if(!Array.isArray(batch))fail('Invalid suggestions response.');rows.push(...batch);if(batch.length<1000)break;after=batch.at(-1).id;}
 if(!rows.length)console.log('No approved suggestions.');
 // A suggestion that cannot apply goes back to the review queue with the reason; the others still publish.
 batch=[...(await publishedSuggestions()),...rows];
 const applied=[],credited=[],held=[],ready=new Map(),hold=(row,e)=>{if(heldIds.has(String(row.id)))return;heldIds.add(String(row.id));held.push({id:row.id,note:'Not published: '+String(e.message).slice(0,480)});warning('Suggestion '+row.id+' goes back to review: '+e.message);};
 for(const row of rows){versionWarning(row);if(!/^\d+$/.test(String(row.id)))fail('Invalid suggestion id.');try{ready.set(String(row.id),await prepare(row));}catch(e){hold(row,e);}}
 // The ledger accepts the same validated rows as the job; invalid rows have already been held.
 const ledger=buildChanges({rows,normalise:row=>ready.get(String(row.id))||null});
 batch=ledger.targets().flatMap(t=>t.rows);batch.sort((a,b)=>Number(a.id)-Number(b.id));
 // Each dry pass starts from the edition on disk; held rows never re-enter a chain.
 const snapshot=new Map([...files].map(([path,f])=>[path,{...f,data:structuredClone(f.data)}]));
 const rewind=()=>{files.clear();for(const [path,f] of snapshot)files.set(path,{...f,data:structuredClone(f.data)});original.clear();history.clear();};
 for(let pass=0;pass<rows.length;pass++){
  rewind();const size=heldIds.size;
  for(const row of rows){const prepared=ready.get(String(row.id));if(!prepared||heldIds.has(String(row.id)))continue;try{await apply(prepared);}catch(e){hold(row,e);}}
  if(heldIds.size===size)break;
 }
 rewind();
 for(const row of rows){const prepared=ready.get(String(row.id));if(!prepared||heldIds.has(String(row.id)))continue;let result;
  try{result=await apply(prepared);}catch(e){hold(row,e);batch=batch.filter(r=>String(r.id)!==String(row.id));continue;}
  applied.push({id:row.id,note:result,payloadHash:hash(row.payload),...(row.updated_at?{updated_at:row.updated_at}:{}),appliedAt:new Date().toISOString(),version:Object.fromEntries(['user_id','map','level','kind','target_id','payload','credit','author_name'].filter(k=>Object.hasOwn(row,k)).map(k=>[k,row[k]]))});console.log((dryRun?'Would apply ':'Ready to apply ')+row.id+': '+result+'.');
  // Credits count published changes from people who ticked "Credit me as a contributor".
  const who=row.credit===true&&typeof row.author_name==='string'?clean(row.author_name).slice(0,80):'';if(who&&row.user_id)credited.push({suggestion_id:row.id,user_id:row.user_id,name:who});}
 const log=await updateContributors(credited,applied);
 await updateCredits(rows.filter(r=>applied.some(a=>String(a.id)===String(r.id))),log||[]);
 {const runLog=await file('data/publish-log.json');runLog.data=[...runLog.data,{at:new Date().toISOString(),rows:applied.map(a=>({id:a.id,payloadHash:a.payloadHash,updatedAt:a.updated_at??null}))}].slice(-20);runLog.changed=true;}
 held.sort((a,b)=>Number(a.id)-Number(b.id));
 const changed=[...files].filter(([,f])=>f.changed);
 if(!dryRun){
  for(const [path,f] of changed){const content=keepRows(f),target=dataPath(path),temporary=target+'.tmp';await mkdir(dirname(target),{recursive:true});await writeFile(temporary,content,'utf8');await rename(temporary,target);}
  await mkdir(resolve(root,'.publish'),{recursive:true});
  await writeFile(resolve(root,'.publish/applied.json'),JSON.stringify(applied,null,2)+'\n');
  await writeFile(resolve(root,'.publish/held.json'),JSON.stringify(held,null,2)+'\n');
  for(const h of held){const row=rows.find(r=>r.id===h.id);try{await guardedPatch(row,{status:'pending',review_note:h.note});}catch(e){warning('Suggestion '+h.id+' could not be sent back to review: '+e.message);}}

 }
 console.log((dryRun?'Dry run: ':'Complete: ')+applied.length+' suggestions, '+(held.length?held.length+' back to review, ':'')+changed.length+' data files'+(dryRun?' would change.':' changed.'));
}
(mark?markPublished(mark):main()).catch(e=>{console.error(e.message==='fetch failed'?'Backend could not be reached.':e.message);process.exitCode=1;});
