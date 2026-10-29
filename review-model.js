/* Queue and notice rules shared by the desk and travellers' notices. */
'use strict';
window.atlasReview=(()=>{
 const closedKind=r=>r.kind==='report'||r.kind==='feedback';
 const jobNote=value=>/^(Not published:|Published as approved on |Approved on sending \(admin\)|Correction made\b)/.test(value||''),authorNote=row=>jobNote(row.review_note)?'':row.review_note||'';
 const spotReasons={art:'Map drawn wrong',missing:'Something missing',other:'Something else'},topics={idea:'An idea for the atlas',bug:'Something is not working',other:'Something else'};
 const title=r=>r.kind==='feedback'?'Feedback: '+(r.payload?.name||'A message'):r.kind==='report'?'Report: '+(r.target_id==null?spotReasons[r.payload?.reason]||'Something else':r.payload?.name||'A place'):r.payload?.name||'A discovery';
 const decision=(r,status)=>closedKind(r)&&status==='approved'?'resolved':status;
 function spotLink(r){const url=mapLink(r.map),base=registry.maps.find(c=>c.id===r.map),floor=base?.levels?.find(l=>l.id===r.level),view=floor?.defaultView||base?.defaultView;for(const k of ['place','x','y','z','level'])url.searchParams.delete(k);if([r.payload?.x,r.payload?.y].every(Number.isFinite)){for(const k of ['x','y'])url.searchParams.set(k,String(r.payload[k]));url.searchParams.set('z',String(Number.isFinite(r.payload.z)?r.payload.z:view?.placeZoom??base?.maxZoom??0));}if(r.level)url.searchParams.set('level',r.level);return url;}
 const target=r=>r.kind==='new-marker'?'community-'+r.id:r.target_id;
 const targetKind=r=>r.kind?.endsWith('label')||['label','exit'].includes(r.payload?.noteType)?'label':'marker';
 const point=r=>r.kind?.startsWith('move-')?(Array.isArray(r.payload?.to)?r.payload.to:[undefined,undefined]):[r.payload?.x??r.payload?.from?.x,r.payload?.y??r.payload?.from?.y];
 function group(rows,{locate=point,mapName=id=>id,floorOrder=()=>0,spot=true}={}){
  const buckets=new Map();
  for(const r of rows){const level=r.payload?.level||r.level||'',key=r.map+'\0'+level;if(!buckets.has(key))buckets.set(key,{map:r.map,level,rows:[]});buckets.get(key).rows.push(r);}
  const groups=[];
  for(const b of [...buckets.values()].sort((a,b)=>mapName(a.map).localeCompare(mapName(b.map))||a.map.localeCompare(b.map)||floorOrder(a.map,a.level)-floorOrder(b.map,b.level)||a.level.localeCompare(b.level))){
   const sorted=b.rows.sort((a,b)=>Number(a.id)-Number(b.id)),parents=sorted.map((_,i)=>i),find=i=>parents[i]===i?i:parents[i]=find(parents[i]);
   // Connected neighbours make one place cluster, even when a third row bridges two spots.
   // Each row is located once: locating can be costly, and pairs grow with the square of the queue.
   if(spot){const at=sorted.map(r=>{const p=locate(r);return p?.every(Number.isFinite)?p:null;}),ids=sorted.map(target),kinds=sorted.map(targetKind);
    for(let i=0;i<sorted.length;i++)for(let j=0;j<i;j++){const a=at[i],c=at[j];if(ids[i]&&kinds[i]===kinds[j]&&ids[i]===ids[j]||a&&c&&Math.hypot(a[0]-c[0],a[1]-c[1])<=15)parents[find(i)]=find(j);}}
   const clusters=new Map();for(let i=0;i<sorted.length;i++){const key=spot?find(i):0;if(!clusters.has(key))clusters.set(key,[]);clusters.get(key).push(sorted[i]);}
   for(const cluster of clusters.values())groups.push({...b,rows:cluster});
  }
  return groups;
 }
 function keyAction(e){if(e.defaultPrevented||e.repeat||e.ctrlKey||e.metaKey||e.altKey||/^(input|textarea|select)$/i.test(e.target?.tagName)||e.target?.isContentEditable||e.target?.closest?.('[contenteditable=true],.wiki-results'))return null;return {a:'approve',s:'save',r:'reject',j:'next',k:'previous',ArrowRight:'next',ArrowLeft:'previous',Escape:'close'}[e.key.length===1?e.key.toLowerCase():e.key]||null;}
 const stamp=r=>r.updated_at||r.reviewed_at||r.created_at||'';
 const ownRows=(rows,uid)=>rows.filter(r=>uid&&r.user_id===uid).slice().sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||''))||Number(b.id)-Number(a.id));
 const unread=(rows,seen,key=r=>String(r.id),version=stamp)=>rows.filter(r=>seen[key(r)]!==version(r));
 const state=r=>closedKind(r)&&r.status==='rejected'?'Dismissed':r.kind==='feedback'&&r.status==='resolved'?'Done':({published:'On the map',approved:'Approved · next edition',pending:'Waiting for review',rejected:'Set aside',resolved:'Fixed'}[r.status]||'Waiting for review');
 return {group,target,targetKind,point,keyAction,stamp,ownRows,unread,state,closedKind,spotReasons,topics,title,decision,spotLink,jobNote,authorNote};
})();
