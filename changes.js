// The same field rules serve the review ledger and the publishing job.
(function(root){
 'use strict';
 const copy=v=>v===undefined?undefined:JSON.parse(JSON.stringify(v)),has=(v,k)=>Object.prototype.hasOwnProperty.call(v||{},k);
 const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b),typeKeys=['category','trade','classes','vendor','sells'];
 const keysFor=p=>['category',...(p.category===undefined?['trade','classes','vendor','sells']:p.category==='Tradeskill'?['trade']:p.category==='Class trainer'?['classes']:p.category==='Vendor'?['vendor','sells']:[])];
 const value=(p,k)=>['name','note','wiki','wikiId'].includes(k)?p?.[k]||'':p?.[k];
 function fieldsOf(row){
  const p=row.payload||{},f=p.from||{},out=new Set();
  if(row.kind==='new-marker')return new Set(['added']);
  if(row.kind==='move-marker'||row.kind==='move-label')return new Set(['position']);
  if(row.kind!=='edit-marker'&&row.kind!=='edit-label')return out;
  if(p.remove===true)return new Set(['removed']);
  for(const k of ['name','note','color','level','arrow','toMap'])if(has(p,k)&&!equal(value(p,k),value(f,k)))out.add(k);
  if(['wiki','wikiId'].some(k=>has(p,k)&&!equal(value(p,k),value(f,k))))out.add('wiki');
  // Phase 2 must send the full type base in from: category and all of its type keys.
  if(keysFor(p).some(k=>has(p,k)&&!equal(p[k],f[k])))out.add('type');
  return out;
 }
 function matchesFrom(row,state,field){
  const p=row.payload||{},f=p.from||{};if(!state)return false;
  if(field==='position')return Array.isArray(f)&&equal(f.map(Math.round),[state.x,state.y].map(Math.round));
  if(field==='removed')return value(state,'name')===value(f,'name')&&(!has(f,'note')||value(state,'note')===value(f,'note'));
  if(field==='type')return keysFor(f).filter(k=>has(f,k)).every(k=>equal(state[k],f[k]));
  if(field==='wiki')return ['wiki','wikiId'].filter(k=>has(p,k)&& (k==='wiki'||has(f,k))).every(k=>equal(value(state,k),value(f,k)));
  return equal(value(state,field),value(f,field));
 }
 function conflicts(row,state,history){
  const out=new Set(),fields=fieldsOf(row);
  for(const h of history||[]){
   if(h.fields.has('removed')){out.add(h.id);continue;}
   for(const f of fields)if((!matchesFrom(row,state,f)||f==='type'&&h.fields.has('type')&&!keysFor(state||{}).every(k=>has(row.payload?.from,k)))&&(h.fields.has(f)||h.fields.has('added')||f==='removed'&&(h.fields.has('name')||has(row.payload?.from,'note')&&h.fields.has('note'))))out.add(h.id);
  }
  return [...out];
 }
 function applyTo(state,row){
  const p=row.payload||{},fields=fieldsOf(row),out=copy(state)||{};
  if(fields.has('added')){
   const label=['label','exit'].includes(p.noteType);Object.assign(out,{id:'community-'+row.id,community:true,name:p.name,note:p.note||'',x:Math.round(p.x),y:Math.round(p.y),...(row.level?{level:row.level}:{})});
   if(label){Object.assign(out,{kind:p.noteType==='exit'?'exit':'building',priority:50,minZoom:0});if(p.noteType==='exit'){out.arrow=p.arrow||'east';if(p.toMap)out.toMap=p.toMap;}}
   else{out.category=p.category;for(const k of [...keysFor(p).slice(1),'color','wiki','wikiId'])if(has(p,k)&&p[k])out[k]=copy(p[k]);if(!out.wiki){delete out.wiki;delete out.wikiId;}}out.removed=false;
  }
  else for(const f of fields){
   if(f==='removed')out.removed=true;
   else if(f==='position')[out.x,out.y]=p.to.map(Math.round);
   else if(f==='type'){if(has(p,'category'))for(const k of typeKeys)delete out[k];for(const k of keysFor(p))if(has(p,k))out[k]=copy(p[k]);}
   else if(f==='wiki'){const changed=has(p,'wiki')&&p.wiki!==out.wiki;for(const k of ['wiki','wikiId'])if(has(p,k))out[k]=p[k];else if(k==='wikiId'&&changed)delete out[k];if(!out.wikiId)delete out.wikiId;if(!out.wiki){delete out.wiki;delete out.wikiId;}}
   else out[f]=copy(p[f]);
  }
  if(fields.size&&!fields.has('removed'))out.community=true;
  return out;
 }
 const whatOf=row=>row.kind==='new-marker'?'added':row.payload?.remove===true?'removed':row.kind.startsWith('move-')?'moved':'edited';
 function buildChanges({mapId,levelId,markers=[],labels=[],trainers=[],publishedPositions,publishedLabelPositions,rows=[],includePending=false,normalise=row=>row}){
  const all=new Map(),byRow=new Map(),newKinds=new Map();
  const here=p=>!levelId||!p.level||p.level===levelId,position=(points,id)=>points?.get?points.get(id):points?.[id];
  function target(kind,id,published=null,isNew=false){const key=kind+':'+id;if(!all.has(key))all.set(key,{key,kind,id,isNew,published,effective:copy(published)||{removed:false},proposed:copy(published)||{removed:false},rows:[],changed:new Set(),contributors:[],missing:!published&&!isNew});return all.get(key);}
  for(const [kind,list,points] of [['marker',markers,publishedPositions],['label',Array.isArray(labels)?labels:labels.labels||[],publishedLabelPositions],['chip',trainers,null]])for(const p of list)if(here(p)){
   const kept=copy(p),at=position(points,p.id);if(kind!=='chip'){delete kept.x;delete kept.y;if(at)[kept.x,kept.y]=copy(at);}else{kept.name=kept.name||kept.building||'';kept.category=kept.category||'Class trainer';}target(kind,p.id,kept);
  }
  const sorted=rows.map(row=>normalise(copy(row))).filter(Boolean).filter(r=>(!mapId||r.map===mapId)&&(!levelId||r.level===levelId)).slice().sort((a,b)=>Number(a.id)-Number(b.id));
  for(const row of sorted)if(row.kind==='new-marker')newKinds.set('community-'+row.id,['label','exit'].includes(row.payload?.noteType)?'label':'marker');
  for(const row of sorted){
   if(!['new-marker','move-marker','move-label','edit-marker','edit-label'].includes(row.kind))continue;
   const id=row.kind==='new-marker'?'community-'+row.id:row.target_id;
   let kind=row.kind.endsWith('label')?'label':newKinds.get(id)||'marker';if(kind==='marker'&&!all.has('marker:'+id)&&all.has('chip:'+id))kind='chip';
   const from=row.payload?.from,base=Array.isArray(from)?{x:from[0],y:from[1]}:copy(from)||{};
   const t=target(kind,id,null,newKinds.has(id)&&row.kind==='new-marker'&&row.status!=='published'),r={...copy(row),fields:fieldsOf(row),base,conflictsWith:[]};
   t.rows.push(r);byRow.set(String(r.id),t);t.contributors.push({user_id:r.user_id,author_name:r.author_name,credit:r.credit===true,what:whatOf(r),status:r.status,rowId:r.id});
  }
  for(const t of all.values()){
   const start=()=>({...copy(t.published),removed:false}),history=[];let proposed=start(),effective=start();
   for(const r of t.rows){
    if(!['pending','approved'].includes(r.status))continue;
    r.conflictsWith=conflicts(r,proposed,history);if(r.conflictsWith.length)continue;
    // An unacknowledged addition never rebuilds a place already in the published file.
    if(r.fields.has('added')&&t.published)continue;
    proposed=applyTo(proposed,r);history.push(r);
    if(r.status==='approved'||includePending)effective=applyTo(effective,r);
    for(const f of r.fields)t.changed.add(f);
   }
   t.effective=effective;t.proposed=proposed;
  }
  return {get:key=>all.get(key)||null,targets:()=>[...all.values()].filter(t=>t.rows.some(r=>['pending','approved'].includes(r.status))),forRow:id=>byRow.get(String(id))||null};
 }
 function nextFrom(target,kind){const p=copy(target.effective);if(kind.startsWith('move-'))return [p.x,p.y];for(const k of ['id','community','removed'])delete p[k];return p;}
 function diffWords(a,b){
  const words=v=>String(v??'').match(/\s+|[^\s]+/g)||[],left=words(a),right=words(b),n=left.length,m=right.length,out=[];
  const lengths=Array.from({length:n+1},()=>new Uint32Array(m+1));
  for(let i=n-1;i>=0;i--)for(let j=m-1;j>=0;j--)lengths[i][j]=left[i]===right[j]?lengths[i+1][j+1]+1:Math.max(lengths[i+1][j],lengths[i][j+1]);
  const add=(op,text)=>{if(out.at(-1)?.op===op)out.at(-1).text+=text;else out.push({op,text});};
  let i=0,j=0;while(i<n||j<m){if(i<n&&j<m&&left[i]===right[j]){add('same',left[i++]);j++;}else if(i<n&&(j===m||lengths[i+1][j]>=lengths[i][j+1]))add('del',left[i++]);else add('ins',right[j++]);}
  return out;
 }
 root.atlasChanges={buildChanges,fieldsOf,diffWords,nextFrom,matchesFrom,conflicts,applyTo,whatOf};
})(typeof window==='object'?window:globalThis);
