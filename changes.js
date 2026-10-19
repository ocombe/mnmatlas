// Geometry uses native map pixels, independent of Leaflet and account services.
(function(root){
 'use strict';
 const clone=v=>JSON.parse(JSON.stringify(v));
 function validate(s,c={width:Infinity,height:Infinity}){
  if(!s||typeof s!=='object'||Array.isArray(s)||!['area','path'].includes(s.kind))throw Error('Invalid shape: choose Area or Path.');
  const circle=s.kind==='area'&&s.form==='circle',rect=s.kind==='area'&&s.form==='rect',min=circle?1:s.kind==='path'?2:3;
  if(s.kind==='area'&&!['rect','circle','outline'].includes(s.form))throw Error('Invalid shape: choose Rectangle, Circle or Outline.');
  const keys=circle?['kind','form','points','r']:s.kind==='path'?['kind','points','loop']:['kind','form','points'];
  if(Object.keys(s).some(k=>!keys.includes(k))||!Array.isArray(s.points)||s.points.length<min||s.points.length>100||(circle&&s.points.length!==1)||(rect&&s.points.length!==4))throw Error('Invalid shape: use '+min+'–100 points (four for a rectangle, one for a circle).');
  if(!s.points.every(p=>Array.isArray(p)&&p.length===2&&p.every(Number.isInteger)&&p[0]>=0&&p[1]>=0&&p[0]<=c.width&&p[1]<=c.height))throw Error('Invalid shape: keep whole-pixel points inside the map.');
  if(circle){const [x,y]=s.points[0];if(!Number.isInteger(s.r)||s.r<=0||x-s.r<0||y-s.r<0||x+s.r>c.width||y+s.r>c.height)throw Error('Invalid shape: keep the circle and its radius inside the map.');}
  else {if(new Set(s.points.map(p=>p.join(','))).size!==s.points.length)throw Error('Invalid shape: points must be distinct.');if(s.kind==='path'&&typeof s.loop!=='boolean')throw Error('Invalid shape: Loops back must be true or false.');if(rect){const [a,b,d,e]=s.points;if(a[1]!==b[1]||b[0]!==d[0]||d[1]!==e[1]||e[0]!==a[0]||a[0]===b[0]||a[1]===e[1])throw Error('Invalid shape: a rectangle needs four ordered corners.');}if(s.kind==='area'&&!area(s.points))throw Error('Invalid shape: the area needs a nonzero outline.');}
  const at=anchor(s);if(!at.every(Number.isFinite)||at[0]<0||at[1]<0||at[0]>c.width||at[1]>c.height)throw Error('Invalid shape: its centre must be inside the map.');return clone(s);
 }
 const area=ps=>ps.reduce((v,p,i)=>{const q=ps[(i+1)%ps.length];return v+p[0]*q[1]-q[0]*p[1];},0);
 function anchor(s){if(s.kind==='path'||s.form==='circle')return s.points[0].slice();const a=area(s.points),sum=[0,0];s.points.forEach((p,i)=>{const q=s.points[(i+1)%s.points.length],v=p[0]*q[1]-q[0]*p[1];sum[0]+=(p[0]+q[0])*v;sum[1]+=(p[1]+q[1])*v;});return sum.map(v=>Math.round(v/(3*a)));}
 function translate(s,dx,dy,c){const out=clone(s);out.points=out.points.map(([x,y])=>[x+Math.round(dx),y+Math.round(dy)]);return c?validate(out,c):out;}
 const describe=s=>!s?'Pin':s.kind==='path'?'Path ('+s.points.length+' points'+(s.loop?', loop':'')+')':'Area ('+({rect:'rectangle',circle:'circle',outline:'outline, '+s.points.length+' points'}[s.form])+')';
 root.atlasShapes={validate,anchor,translate,describe};
})(typeof window==='object'?window:globalThis);
// The same field rules serve the review ledger and the publishing job.
(function(root){
 'use strict';
 const copy=v=>v===undefined?undefined:JSON.parse(JSON.stringify(v)),has=(v,k)=>Object.prototype.hasOwnProperty.call(v||{},k);
 const stable=v=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;
 const equal=(a,b)=>JSON.stringify(stable(a))===JSON.stringify(stable(b)),typeKeys=['category','trade','classes','vendor','sells'];
 const keysFor=p=>['category',...(p.category===undefined?['trade','classes','vendor','sells']:p.category==='Tradeskill'?['trade']:p.category==='Class trainer'?['classes']:p.category==='Vendor'?['vendor','sells']:[])];
 const editKeys=['name','note','color','level','kind','travel','arrow','toMap','toPlace','toLevel','toMarker','direction','switchOnClick','minZoom','approximate','tier','priority','building','levels','mobs','fish','way','oneWay','shape'];
 const value=(p,k)=>['shape','levels'].includes(k)?p?.[k]??null:['mobs','fish'].includes(k)?(p?.[k]?.length?p[k]:null):['name','note','wiki','wikiId'].includes(k)?p?.[k]||'':p?.[k];
 function fieldsOf(row){
  const p=row.payload||{},f=p.from||{},out=new Set();
  if(row.kind==='new-marker')return new Set(['added']);
  if(row.kind==='move-marker'||row.kind==='move-label')return new Set(['position',...(has(p,'shape')?['shape']:[])]);
  if(row.kind!=='edit-marker'&&row.kind!=='edit-label')return out;
  if(p.remove===true)return new Set(['removed']);
  for(const k of editKeys)if(has(p,k)&&!equal(value(p,k),value(f,k)))out.add(k);
  if((!out.has('shape')||p.shape===null)&&['x','y'].some(k=>has(p,k)&&!equal(p[k],f[k])))out.add('position');
  if(['wiki','wikiId'].some(k=>has(p,k)&&!equal(value(p,k),value(f,k))))out.add('wiki');
  // Phase 2 must send the full type base in from: category and all of its type keys.
  if(keysFor(p).some(k=>has(p,k)&&!equal(p[k]??null,f[k]??null)))out.add('type');
  return out;
 }
 function matchesFrom(row,state,field){
  const p=row.payload||{},f=p.from||{};if(!state)return false;
  if(field==='position'){const at=Array.isArray(f)?f:[f.x,f.y];return at.every(Number.isFinite)&&equal(at.map(Math.round),[state.x,state.y].map(Math.round))&&(!has(p,'fromShape')||equal(state.shape??null,p.fromShape??null));}
  if(field==='removed')return value(state,'name')===value(f,'name')&&(!has(f,'note')||value(state,'note')===value(f,'note'));
  if(field==='type')return keysFor(f).filter(k=>has(f,k)).every(k=>equal(state[k]??null,f[k]??null));
  if(field==='wiki')return ['wiki','wikiId'].filter(k=>has(p,k)&& (k==='wiki'||has(f,k))).every(k=>equal(value(state,k),value(f,k)));
  return equal(value(state,field),field==='shape'&&Array.isArray(f)?p.fromShape??null:value(f,field));
 }
 function conflicts(row,state,history){
  const out=new Set(),fields=fieldsOf(row);
  for(const h of history||[]){
   if(h.fields.has('removed')){out.add(h.id);continue;}
   for(const f of fields)if((!matchesFrom(row,state,f)||f==='type'&&h.fields.has('type')&&!keysFor(state||{}).every(k=>has(row.payload?.from,k)))&&(h.fields.has(f)||h.fields.has('added')||f==='shape'&&h.fields.has('position')||f==='position'&&h.fields.has('shape')||f==='removed'&&(h.fields.has('name')||has(row.payload?.from,'note')&&h.fields.has('note'))))out.add(h.id);
  }
  return [...out];
 }
 function applyTo(state,row){
  const p=row.payload||{},fields=fieldsOf(row),out=copy(state)||{};
  if(fields.has('added')){
   const label=['label','exit'].includes(p.noteType);Object.assign(out,{id:'community-'+row.id,community:true,name:p.name,note:p.note||'',x:Math.round(p.x),y:Math.round(p.y),...(row.level?{level:row.level}:{})});
   if(label){Object.assign(out,{kind:p.kind||(p.noteType==='exit'?'exit':'building'),priority:typeof p.priority==='number'?p.priority:50,minZoom:0});if(p.noteType==='exit'){if(p.arrow)out.arrow=p.arrow;if(p.toMap)out.toMap=p.toMap;}}
   else{out.category=p.category;for(const k of [...keysFor(p).slice(1),'color','wiki','wikiId'])if(has(p,k)&&p[k])out[k]=copy(p[k]);if(!out.wiki){delete out.wiki;delete out.wikiId;}}for(const k of editKeys.filter(k=>!['name','note','color','kind','priority'].includes(k)))if(has(p,k))out[k]=copy(p[k]);out.removed=false;
  }
  else for(const f of fields){
   if(f==='removed')out.removed=true;
   else if(f==='position'){const at=row.kind.startsWith('move-')?p.to:[p.x,p.y];if(!Array.isArray(at)||at.length!==2||!at.every(Number.isFinite))throw Error('The suggested position is missing or invalid');if(out.shape&&!fields.has('shape'))out.shape=root.atlasShapes.translate(out.shape,Math.round(at[0])-out.x,Math.round(at[1])-out.y);[out.x,out.y]=at.map(Math.round);if(has(p,'approximate'))out.approximate=p.approximate;}
   else if(f==='type'){if(has(p,'category'))for(const k of typeKeys)delete out[k];for(const k of keysFor(p))if(has(p,k)&&p[k]!==null&&p[k]!=='')out[k]=copy(p[k]);}
   else if(f==='wiki'){const changed=has(p,'wiki')&&p.wiki!==out.wiki;for(const k of ['wiki','wikiId'])if(has(p,k))out[k]=p[k];else if(k==='wikiId'&&changed)delete out[k];if(!out.wikiId)delete out.wikiId;if(!out.wiki){delete out.wiki;delete out.wikiId;}}
   else if(p[f]===null||p[f]==='')delete out[f];else out[f]=copy(p[f]);
  }
  if(out.shape){out.shape=root.atlasShapes.validate(out.shape);[out.x,out.y]=root.atlasShapes.anchor(out.shape);}
  if(!['Mob camp','Named mob'].includes(out.category))delete out.levels;if(out.category!=='Mob camp')delete out.mobs;if(out.category!=='Fishing spot')delete out.fish;if(out.category!=='Passage'){delete out.way;delete out.oneWay;}
  if(out.category==='Named mob'&&out.levels!=null&&!levelsOk(out.levels,out.category))throw Error('Choose a level from 1 to 99.');
  if(fields.size&&!fields.has('removed'))out.community=true;
  return out;
 }
 const whatOf=row=>row.kind==='new-marker'?'added':row.payload?.remove===true?'removed':row.kind.startsWith('move-')?'moved':fieldsOf(row).has('shape')?'reshaped':'edited';
 function buildChanges({mapId,levelId,markers=[],labels=[],trainers=[],publishedPositions,publishedLabelPositions,rows=[],includePending=false,normalise=row=>row,onError=null}){
  const all=new Map(),byRow=new Map(),newKinds=new Map(),fail=(row,error)=>{if(!onError)throw error;onError(row,error);};
  const here=p=>!levelId||!p.level||p.level===levelId||rows.some(r=>r.target_id===p.id&&r.level===p.level&&r.payload?.level===levelId),position=(points,id)=>points?.get?points.get(id):points?.[id];
  function target(kind,id,published=null,isNew=false){const key=kind+':'+id;if(!all.has(key))all.set(key,{key,kind,id,isNew,published,effective:copy(published)||{removed:false},proposed:copy(published)||{removed:false},rows:[],changed:new Set(),contributors:[],missing:!published&&!isNew});return all.get(key);}
  for(const [kind,list,points] of [['marker',markers,publishedPositions],['label',Array.isArray(labels)?labels:labels.labels||[],publishedLabelPositions],['chip',trainers,null]])for(const p of list)if(here(p)){
   const kept=copy(p);if(kind==='marker'){const chip=trainers.find(t=>t.id===p.id);if(chip?.building!==undefined)kept.building=chip.building;}const at=position(points,p.id);if(kind!=='chip'){delete kept.x;delete kept.y;if(at)[kept.x,kept.y]=copy(at);}else{kept.name=kept.name||kept.building||'';kept.category=kept.category||'Class trainer';}target(kind,p.id,kept);
  }
  const sorted=rows.map(row=>{try{return normalise(copy(row));}catch(error){fail(row,error);return null;}}).filter(Boolean).filter(r=>(!mapId||r.map===mapId)&&(!levelId||r.level===levelId||r.payload?.level===levelId)).slice().sort((a,b)=>Number(a.id)-Number(b.id));
  for(const row of sorted)if(row.kind==='new-marker')newKinds.set('community-'+row.id,['label','exit'].includes(row.payload?.noteType)?'label':'marker');
  for(const row of sorted){try{
   if(!['new-marker','move-marker','move-label','edit-marker','edit-label'].includes(row.kind))continue;
   const id=row.kind==='new-marker'?'community-'+row.id:row.target_id;
   let kind=row.kind.endsWith('label')?'label':newKinds.get(id)||'marker';if(kind==='label'&&!all.has('label:'+id)&&all.has('marker:'+id))kind='marker';if(kind==='marker'&&!all.has('marker:'+id)&&all.has('chip:'+id))kind='chip';
   const from=row.payload?.from,base=Array.isArray(from)?{x:from[0],y:from[1]}:copy(from)||{};
   const t=target(kind,id,null,newKinds.has(id)&&row.kind==='new-marker'&&row.status!=='published'),r={...copy(row),fields:fieldsOf(row),base,conflictsWith:[]};
   t.rows.push(r);byRow.set(String(r.id),t);t.contributors.push({user_id:r.user_id,author_name:r.author_name,credit:r.credit===true,what:whatOf(r),status:r.status,rowId:r.id});
  }catch(error){fail(row,error);}}
  for(const t of all.values()){
   const start=()=>({...copy(t.published),removed:false}),history=[],approvedHistory=[];let proposed=start(),effective=start();
   for(const r of t.rows){try{
    if(!['pending','approved'].includes(r.status))continue;
    r.conflictsWith=conflicts(r,proposed,history);if(r.status==='approved'&&!(r.fields.has('added')&&t.published)&&!conflicts(r,effective,approvedHistory).length){effective=applyTo(effective,r);approvedHistory.push(r);}if(r.conflictsWith.length)continue;
    // An unacknowledged addition never rebuilds a place already in the published file.
    if(r.fields.has('added')&&t.published)continue;
    proposed=applyTo(proposed,r);history.push(r);
    if(includePending)effective=copy(proposed);
    for(const f of r.fields)t.changed.add(f);
   }catch(error){fail(r,error);}}
   t.effective=effective;t.proposed=proposed;
  }
  return {get:key=>all.get(key)||null,targets:()=>[...all.values()].filter(t=>t.rows.some(r=>['pending','approved'].includes(r.status))),forRow:id=>byRow.get(String(id))||null};
 }
 function nextFrom(target,kind){const p=copy(target.effective);if(p.category)for(const k of keysFor(p))if(!has(p,k))p[k]=null;if(kind.startsWith('move-'))return [p.x,p.y];for(const k of ['id','community','removed'])delete p[k];return p;}
 function diffWords(a,b){
  const words=v=>String(v??'').match(/\s+|[^\s]+/g)||[],left=words(a),right=words(b),n=left.length,m=right.length,out=[];
  const lengths=Array.from({length:n+1},()=>new Uint32Array(m+1));
  for(let i=n-1;i>=0;i--)for(let j=m-1;j>=0;j--)lengths[i][j]=left[i]===right[j]?lengths[i+1][j+1]+1:Math.max(lengths[i+1][j],lengths[i][j+1]);
  const add=(op,text)=>{if(out.at(-1)?.op===op)out.at(-1).text+=text;else out.push({op,text});};
  let i=0,j=0;while(i<n||j<m){if(i<n&&j<m&&left[i]===right[j]){add('same',left[i++]);j++;}else if(i<n&&(j===m||lengths[i+1][j]>=lengths[i][j+1]))add('del',left[i++]);else add('ins',right[j++]);}
  return out;
 }
 root.atlasChanges={buildChanges,fieldsOf,diffWords,nextFrom,matchesFrom,conflicts,applyTo,whatOf,editKeys};
})(typeof window==='object'?window:globalThis);
