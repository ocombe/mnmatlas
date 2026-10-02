'use strict';
(()=>{
 const settings=typeof atlasConfig==='object'?atlasConfig:{},localHost=['localhost','127.0.0.1','[::1]'].includes(location.hostname);
 const counting=!!settings.goatcounter&&!localHost&&/^[a-z0-9-]+$/i.test(settings.goatcounter);
 let countQueue=[],countReady=false,countFailed=false,lastLoad=0,searchTimer;
 function count(path,title,event=false){if(!counting||countFailed)return;const row={path,title,event,referrer:''};if(countReady){try{window.goatcounter.count(row);}catch{}}else countQueue.push(row);}
 const event=name=>count(name,name,true);
 function pageview(){if(!map||loading||lastLoad===loadSerial)return;lastLoad=loadSerial;count('/'+config.id+(config.levelId?'/'+config.levelId:''),config.title);}
 if(counting){
  window.goatcounter={no_onload:true,allow_frame:true};
  const script=document.createElement('script');script.async=true;script.src='https://gc.zgo.at/count.js';script.referrerPolicy='no-referrer';script.dataset.goatcounter='https://'+settings.goatcounter+'.goatcounter.com/count';
  script.onload=()=>{countReady=typeof window.goatcounter.count==='function';countFailed=!countReady;if(countReady)for(const row of countQueue){try{window.goatcounter.count(row);}catch{}}countQueue=[];};script.onerror=()=>{countFailed=true;countQueue=[];};document.head.append(script);
  $('about-counts').textContent='Visit counts are anonymous and use no cookies.';$('about-counts').hidden=false;
  $('search').addEventListener('input',()=>{clearTimeout(searchTimer);if($('search').value.trim())searchTimer=setTimeout(()=>event('search'),650);});
  window.addEventListener('atlas:loaded',()=>{clearTimeout(searchTimer);pageview();});
  window.addEventListener('atlas:note-added',()=>event('note-added'));window.addEventListener('atlas:positions',()=>event('positions-saved'));pageview();
 }
 if(!settings.supabaseUrl||!settings.supabaseKey)return;
 let client;
 try{client=window.supabase.createClient(settings.supabaseUrl,settings.supabaseKey);}catch{status('Accounts could not start. Your local notes are safe.');return;}
 let user=null,admin=false,authSerial=0,mapSerial=0,totalsLoad=0,currentMap='',totals=new Map(),myVotes=new Map(),votesReady=false,voteBusy=new Set(),reviewLayer=null,syncing=false,syncReady='',syncTimer,reviewSerial=0;
 const totalsCache=new Map(),syncJobs=new Map(),sentKey='mnmaps-community-sent',sharedKey='mnmaps-community-shared';
 const scope=()=>config.id+'-'+config.tileRevision,displayName=u=>String(u?.user_metadata?.full_name||u?.user_metadata?.name||u?.user_metadata?.preferred_username||'Discord member').slice(0,80);
 function readSet(key){try{const rows=JSON.parse(localStorage.getItem(key)||'[]');return new Set(Array.isArray(rows)?rows.filter(r=>typeof r==='string'):[]);}catch{return new Set();}}
 function remember(key,values){try{const rows=readSet(key);for(const value of values)rows.add(value);localStorage.setItem(key,JSON.stringify([...rows]));}catch{status('Sent successfully, but this browser could not remember it.');}}
 const button=(label,action,cls)=>{const b=text('button',label,cls);b.type='button';b.onclick=action;return b;};
 const account=text('section','','community-account');account.setAttribute('aria-label','Account');document.querySelector('.journal-bottom').append(account);
 const syncLine=text('p','','community-sync');syncLine.setAttribute('role','status');syncLine.setAttribute('aria-live','polite');
 const reviewButton=button('Review suggestions',()=>openReview());reviewButton.hidden=true;
 const dialog=text('dialog','','community-dialog');dialog.id='community-dialog';dialog.setAttribute('aria-labelledby','community-title');document.body.append(dialog);
 const review=text('dialog','','community-review');review.id='community-review';review.setAttribute('aria-labelledby','review-title');document.body.append(review);
 function quiet(message){syncLine.textContent=message;if(message)status(message);}
 function accountUI(){
  account.replaceChildren(text('strong','Account'));
  if(user){
   // Discord's own avatar, only from its image host.
   const who=text('p','','community-who'),src=String(user.user_metadata?.avatar_url||'');
   if(/^https:\/\/cdn\.discordapp\.com\/[a-zA-Z0-9_./-]+$/.test(src)){const img=document.createElement('img');img.src=src;img.alt='';img.width=img.height=28;img.referrerPolicy='no-referrer';img.onerror=()=>img.remove();who.append(img);}
   who.append(text('span','Signed in as '+displayName(user)));account.append(who,button('Sign out',signOut));
  }
  else account.append(button('Sign in with Discord',signIn));
  account.append(text('p','Signing in lets you vote, suggest fixes and keep your notes on every device.'),syncLine,reviewButton);reviewButton.hidden=!admin;
 }
 $('about-community').textContent='Optional Discord sign-in stores your Discord name and id, your suggestions, your votes and, if you sign in, your notes, so they follow you between devices.';$('about-community').hidden=false;
 const localNoteLine=document.querySelector('.journal-bottom>.backup').previousElementSibling;localNoteLine.textContent='Notes stay in this browser; sign in to sync them.';
 $('editor').querySelector('.form-hint').textContent='Saved on this device. Sign in to sync notes, and export a backup.';
 async function signIn(){
  try{const url=new URL(location.href);url.hash='';event('sign-in');const {error}=await client.auth.signInWithOAuth({provider:'discord',options:{redirectTo:url.href}});if(error)throw error;}
  catch{status('Discord sign-in could not start. Please try again.');}
 }
 async function signOut(){try{await pushJobs();const {error}=await client.auth.signOut();if(error)throw error;}catch{status('Sign-out could not finish. Please try again.');}}
 function showDialog(title){dialog.replaceChildren();const heading=text('h2',title);heading.id='community-title';dialog.append(heading);if(!dialog.open)dialog.showModal();return dialog;}
 function signInDialog(){const d=showDialog('Sign in to contribute');d.append(text('p','Sign in with Discord to vote or send suggestions for review. Your positions and notes remain saved in this browser.'));const actions=text('div','','dialog-actions');actions.append(button('Close',()=>d.close()),button('Sign in with Discord',signIn,'primary'));d.append(actions);}
 function freshPopup(){if(!map||loading)return;for(const m of allMarkers()){const pin=pins.get(m.id);if(pin)pin.setPopupContent(popup(m));}}
 async function loadTotals(id,force=false){
  if(force)totalsCache.delete(id);
  if(!totalsCache.has(id))totalsCache.set(id,(async()=>{const {data,error}=await client.rpc('vote_totals',{p_map:id});if(error)throw error;return new Map((data||[]).map(r=>[r.target_id,{up:Number(r.up),down:Number(r.down)}]));})());
  try{return await totalsCache.get(id);}catch(e){totalsCache.delete(id);throw e;}
 }
 async function loadVotes(id,serial,uid){
  if(!uid)return;
  try{const {data,error}=await client.from('votes').select('target_id,value').eq('map',id).eq('user_id',uid);if(error)throw error;if(serial!==mapSerial||user?.id!==uid)return;myVotes=new Map((data||[]).map(r=>[r.target_id,r.value]));votesReady=true;freshPopup();}
  catch{status('Your votes could not load. Please try again.');}
 }
 // A "looks wrong" vote asks what is wrong, so the report can be acted on.
 const reasons={position:'Wrong position',name:'Wrong name',type:'Wrong type or icon',missing:'Not there in the game',other:'Something else'};
 function reasonDialog(m){
  const d=showDialog('What looks wrong?');d.append(text('p',m.name,'form-hint'));
  const list=text('div','','community-choices'),radios=[];
  for(const [key,label] of Object.entries(reasons)){const row=text('label',''),r=document.createElement('input');r.type='radio';r.name='vote-reason';r.value=key;row.append(r,text('span',label));list.append(row);radios.push(r);}
  d.append(list);
  const hint=text('p','Tip: in ✎ Edit positions you can drag the marker to the right spot and send it for review.','form-hint');hint.hidden=true;d.append(hint);
  for(const r of radios)r.onchange=()=>{hint.hidden=r.value!=='position'||!r.checked;};
  const label=text('label','Details (optional)');label.htmlFor='vote-comment';const comment=document.createElement('textarea');comment.id='vote-comment';comment.maxLength=300;comment.rows=3;comment.placeholder='For example: it is on the other side of the bridge.';d.append(label,comment);
  const actions=text('div','','dialog-actions'),send=button('Send report',()=>{const picked=radios.find(r=>r.checked);if(!picked){status('Choose what looks wrong.');return;}d.close();vote(m,-1,{reason:picked.value,comment:comment.value.trim()||null});},'primary');
  actions.append(button('Cancel',()=>d.close()),send);d.append(actions);
 }
 async function vote(m,value,details=null){
  if(!user){signInDialog();return;}
  if(value===-1&&!details&&myVotes.get(m.id)!==-1){reasonDialog(m);return;}const id=currentMap,uid=user.id,serial=mapSerial,key=id+':'+m.id;if(voteBusy.has(key))return;
  if(!votesReady){await loadVotes(id,mapSerial,uid);if(!votesReady||currentMap!==id||user?.id!==uid)return;}
  if(voteBusy.has(key))return;
  voteBusy.add(key);
  const previous=myVotes.get(m.id)||0,next=previous===value?0:value,before={...(totals.get(m.id)||{up:0,down:0})},after={...before};
  if(previous)after[previous===1?'up':'down']=Math.max(0,after[previous===1?'up':'down']-1);if(next)after[next===1?'up':'down']++;
  totals.set(m.id,after);if(next)myVotes.set(m.id,next);else myVotes.delete(m.id);freshPopup();
  try{let request=client.from('votes');request=next?request.upsert({user_id:uid,map:id,target_id:m.id,value:next,reason:next===-1?details?.reason||'other':null,comment:next===-1?details?.comment||null:null},{onConflict:'user_id,map,target_id'}):request.delete().eq('user_id',uid).eq('map',id).eq('target_id',m.id);const {error}=await request;if(error)throw error;event('vote');}
  catch{if(serial===mapSerial&&currentMap===id&&user?.id===uid){totals.set(m.id,before);if(previous)myVotes.set(m.id,previous);else myVotes.delete(m.id);freshPopup();}status('Vote could not be saved. Please try again.');}
  finally{voteBusy.delete(key);freshPopup();}
 }
 const sharedToken=m=>scope()+':'+m.id;
 window.atlasCommunity={popup(m,n){
  if(m.id.startsWith('personal-')){if(alignmentMode)return;const shared=readSet(sharedKey).has(sharedToken(m));n.append(shared?text('p','Shared for review','moved-note'):button('Share with everyone',()=>shareNote(m)));return;}
  const counts=totals.get(m.id)||{up:0,down:0},row=text('div','','community-votes');
  for(const [value,label,key] of [[1,'Looks right ✓','up'],[-1,'Looks wrong ✗','down']]){const b=button(label+' '+counts[key],()=>vote(m,value));b.setAttribute('aria-pressed',String(myVotes.get(m.id)===value));b.disabled=voteBusy.has(currentMap+':'+m.id);row.append(b);}n.append(row);
 }};
 function movedItems(){
  const sent=readSet(sentKey),rows=[];
  for(const [kind,items,positions] of [['move-marker',originals,publishedPositions],['move-label',labelData.labels,publishedLabelPositions]])for(const m of items){
   const from=positions.get(m.id),to=[m.x,m.y];if(!from||from.every((v,i)=>v===to[i]))continue;
   const token=JSON.stringify([scope(),m.level||config.levelId||'',kind,m.id,...to]);if(sent.has(token))continue;
   rows.push({token,name:m.name,kind,target_id:m.id,map:config.id,level:m.level||config.levelId||null,payload:{from,to,name:m.name}});
  }return rows;
 }
 function offerPositions(){const rows=movedItems();if(!rows.length)return;sendDialog('Suggest positions',rows,false);}
 function shareNote(m){
  const payload={x:m.x,y:m.y,name:m.name,category:m.category,note:m.note};for(const key of ['noteType','arrow','trade','color'])if(m[key])payload[key]=m[key];
  sendDialog('Share a personal note',[{token:sharedToken(m),name:m.name,map:config.id,level:m.level||config.levelId||null,kind:'new-marker',target_id:null,payload}],true);
 }
 function sendDialog(title,rows,sharing){
  const d=showDialog(title);d.append(text('p',sharing?'Send this note for review before it appears in the community atlas.':'Your positions are saved locally. Choose the changes to send for review.'));
  const list=text('div','','community-choices'),checks=[];
  for(const row of rows){const label=text('label',''),check=document.createElement('input');check.type='checkbox';check.checked=true;label.append(check,text('span',row.name));list.append(label);checks.push(check);}d.append(list);
  const label=text('label','Optional comment');label.htmlFor='suggestion-comment';const comment=document.createElement('textarea');comment.id='suggestion-comment';comment.maxLength=500;comment.rows=3;d.append(label,comment);
  const actions=text('div','','dialog-actions'),send=button(user?'Send for review':'Sign in with Discord',async()=>{
   if(!user){await signIn();return;}const selected=rows.filter((_,i)=>checks[i].checked&&!checks[i].disabled);if(!selected.length){status('Choose at least one item.');return;}
   send.disabled=true;let done=0;
   try{
    // Separate inserts let the daily limit apply to every row; partial success is remembered.
    for(const row of selected){const {token,name,...suggestion}=row;const {error}=await client.from('suggestions').insert({...suggestion,user_id:user.id,author_name:displayName(user),comment:comment.value.trim()||null});if(error)throw error;remember(sharing?sharedKey:sentKey,[token]);checks[rows.indexOf(row)].disabled=true;checks[rows.indexOf(row)].checked=false;done++;}
    if(done){freshPopup();d.close();status('Thanks! Your suggestion is waiting for review.');}
   }catch{status('Some suggestions could not be sent. Unsent items remain selected; your local notes and positions are safe.');freshPopup();}
   finally{if(done)event('suggestion-sent');send.disabled=false;}
  },'primary');actions.append(button('Not now',()=>d.close()),send);d.append(actions);
 }
 function syncIdentity(){return user?user.id+':'+scope():'';}
 function scheduleSync(){
  if(syncing||!user||!config||syncReady!==syncIdentity())return;
  const job={uid:user.id,map:scope(),notes:personal.map(m=>({...m}))};syncJobs.set(job.uid+':'+job.map,job);clearTimeout(syncTimer);syncTimer=setTimeout(()=>pushJobs(),2000);
 }
 let pushing=false;
 async function pushJobs(){
  if(pushing)return;pushing=true;let failed=false;
  try{for(const [key,job] of syncJobs){if(user?.id!==job.uid){syncJobs.delete(key);continue;}
   try{const {error}=await client.from('user_notes').upsert({user_id:job.uid,map:job.map,notes:job.notes,updated_at:new Date().toISOString()},{onConflict:'user_id,map'});if(error)throw error;if(syncJobs.get(key)===job)syncJobs.delete(key);quiet('Notes synced.');}
   catch{failed=true;quiet('Notes could not sync. Your local notes are safe.');}
  }}finally{pushing=false;if(!failed&&syncJobs.size){clearTimeout(syncTimer);syncTimer=setTimeout(()=>pushJobs(),2000);}}
 }
 async function syncNotes(serial){
  if(!user||!map||loading||alignmentMode)return;const uid=user.id,key=scope(),identity=uid+':'+key;syncReady='';
  try{const {data,error}=await client.from('user_notes').select('notes').eq('user_id',uid).eq('map',key).maybeSingle();if(error)throw error;if(serial!==mapSerial||user?.id!==uid||key!==scope()||alignmentMode)return;
   const remote=data?.notes||[];if(!Array.isArray(remote)||remote.length>2000||!remote.every(valid))throw Error();
   const merged=new Map(remote.map(m=>[m.id,m]));for(const m of personal)merged.set(m.id,m);if(merged.size>2000)throw Error();
   syncing=true;const saved=persist([...merged.values()]);syncing=false;if(!saved)return;
   syncReady=identity;setupCategoryControls();buildPlaceIndex();drawMarkers();scheduleSync();await pushJobs();
  }catch{syncing=false;quiet('Notes could not sync. Your local notes are safe.');}
 }
 async function onMap(){
  if(!map||loading)return;const serial=++mapSerial,id=config.id,uid=user?.id;currentMap=id;syncReady='';myVotes=new Map();votesReady=false;totals=new Map();clearPreview();if(review.open)review.close();
  if(totalsLoad!==loadSerial){totalsLoad=loadSerial;totalsCache.clear();}
  await Promise.all([(async()=>{try{const rows=await loadTotals(id);if(serial!==mapSerial)return;totals=rows;freshPopup();}catch{status('Marker votes could not load. The map is still available.');}})(),loadVotes(id,serial,uid),syncNotes(serial)]);
 }
 async function authChanged(session){
  const next=session?.user||null;if(next?.id===user?.id)return;
  const serial=++authSerial;user=next;admin=false;syncReady='';myVotes=new Map();votesReady=false;accountUI();if(review.open)review.close();clearPreview();freshPopup();
  if(user){const uid=user.id;try{const {data,error}=await client.from('admins').select('user_id').eq('user_id',uid).maybeSingle();if(error)throw error;if(serial!==authSerial)return;admin=!!data;accountUI();}catch{status('Account permissions could not load. Please try again.');}}
  if(serial===authSerial)await onMap();
 }
 function clearPreview(){reviewLayer?.remove();reviewLayer=null;$('community-preview')?.remove();}
 review.addEventListener('close',()=>{reviewSerial++;});
 function reviewShell(){
  review.replaceChildren();const title=text('h2','Review suggestions');title.id='review-title';review.append(title);
  const tabs=text('div','','community-tabs');tabs.append(button('Pending',()=>pendingTab()),button('Most reported',()=>reportedTab()));review.append(tabs);
  const content=text('div','','review-content');content.id='review-content';review.append(content);const actions=text('div','','dialog-actions');actions.append(button('Close',()=>review.close()));review.append(actions);
 }
 function openReview(){if(!admin)return;if(!map||loading){status('The map is still loading.');return;}reviewShell();review.showModal();pendingTab();}
 async function pendingTab(all=false,offset=0){
  clearPreview();const serial=++reviewSerial,content=$('review-content');content.replaceChildren();
  const toggle=text('label','','community-check'),check=document.createElement('input');check.type='checkbox';check.checked=all;check.onchange=()=>pendingTab(check.checked);toggle.append(check,text('span','All maps'));content.append(toggle,text('p','Loading suggestions…','form-hint'));
  try{let request=client.from('suggestions').select('*').eq('status','pending').order('created_at',{ascending:false}).order('id',{ascending:false});if(!all)request=request.eq('map',config.id);const {data,error}=await request.range(offset,offset+199);if(error)throw error;if(serial!==reviewSerial||!admin)return;content.lastChild.remove();
   if(!data.length)content.append(text('p','No pending suggestions. Suggestions come from Edit positions and Share with everyone; Looks wrong reports are under Most reported.','form-hint'));
   for(const row of data){const card=text('article','','review-card');card.append(text('strong',row.payload.name),text('p',row.kind+' · '+row.map+(row.level?' / '+row.level:'')+' · '+(row.author_name||'Discord member')+' · '+new Date(row.created_at).toLocaleString(),'form-hint'));if(row.comment)card.append(text('p',row.comment));
    if(row.kind==='new-marker'){card.append(text('p',row.payload.noteType||row.payload.category,'form-hint'));if(row.payload.note)card.append(text('p',row.payload.note));}
    const label=text('label','Optional review note'),note=document.createElement('textarea');note.rows=2;note.maxLength=500;label.append(note);card.append(label);
    const actions=text('div','','dialog-actions');actions.append(button('Show on map',()=>preview(row)),button('Reject',()=>reviewAction(row,'rejected',note.value,card)),button('Approve',()=>reviewAction(row,'approved',note.value,card),'primary'));card.append(actions);content.append(card);
   }
   const pages=text('div','','dialog-actions');if(offset)pages.append(button('Newer',()=>pendingTab(all,Math.max(0,offset-200))));if(data.length===200)pages.append(button('Older',()=>pendingTab(all,offset+200)));content.append(pages);
  }catch{if(serial===reviewSerial){content.lastChild?.remove();content.append(text('p','Suggestions could not load. Try again.','form-hint'));}status('Suggestions could not load. Please try again.');}
 }
 async function reviewAction(row,state,note,card){
  for(const b of card.querySelectorAll('button'))b.disabled=true;
  try{const {data,error}=await client.from('suggestions').update({status:state,reviewed_at:new Date().toISOString(),review_note:note.trim()||null}).eq('id',row.id).eq('status','pending').select('id');if(error||!data?.length)throw error||Error();card.remove();clearPreview();status(state==='approved'?'Suggestion approved for publishing.':'Suggestion rejected.');}
  catch{status('Review could not be saved. Please refresh the list.');for(const b of card.querySelectorAll('button'))b.disabled=false;}
 }
 async function preview(row){
  try{
   review.close();const url=new URL(location.href);url.searchParams.set('map',row.map);for(const k of ['place','x','y','z'])url.searchParams.delete(k);if(row.level)url.searchParams.set('level',row.level);else url.searchParams.delete('level');
   if(config.id!==row.map||(row.level&&config.levelId!==row.level))await loadMap(row.map,url);
   if(config.id!==row.map||(row.level&&config.levelId!==row.level)||loading)throw Error();
   clearPreview();reviewLayer=L.layerGroup().addTo(map);const p=row.payload,points=row.kind==='new-marker'?[[p.x,p.y]]:[p.from,p.to];
   const locations=points.map(xy=>{if(!Array.isArray(xy)||xy.length!==2||!bounded(...xy,config.minZoom))throw Error();return locationOf({x:xy[0],y:xy[1]});});
   locations.forEach((where,i)=>{const suggested=points.length===1||i,label=points.length===1?'Suggested marker':i?'Suggested position':'Published position';const marker=L.circleMarker(where,{radius:suggested?9:6,color:suggested?'#b5861f':'#2f6f9a',fillColor:suggested?'#b5861f':'#2f6f9a',fillOpacity:.75,weight:3}).bindTooltip(()=>text('span',label+' · '+p.name),{permanent:true,direction:suggested?'bottom':'top'});reviewLayer.addLayer(marker);});
   if(locations.length===2)reviewLayer.addLayer(L.polyline(locations,{color:'#b5861f',weight:2,dashArray:'6 6'}));
   const bar=text('section','','community-preview');bar.id='community-preview';bar.setAttribute('aria-label','Review selected suggestion');bar.append(text('strong',p.name));const note=document.createElement('input');note.placeholder='Optional review note';note.setAttribute('aria-label','Optional review note');note.maxLength=500;bar.append(note);const actions=text('div','','dialog-actions');actions.append(button('Close',clearPreview),button('Reject',()=>reviewAction(row,'rejected',note.value,bar)),button('Approve',()=>reviewAction(row,'approved',note.value,bar),'primary'));bar.append(actions);$('map-frame').append(bar);
   if(locations.length===2)map.fitBounds(L.latLngBounds(locations),{padding:[60,60],maxZoom:config.defaultView.placeZoom+1});else map.setView(locations[0],config.defaultView.placeZoom);if(compact())setPanel(false);status(locations.length===2?'Blue: published position. Amber: suggested position.':'Amber: suggested marker.');
  }catch{clearPreview();status('This suggestion could not be shown on the map.');}
 }
 async function reportedTab(){
  clearPreview();const serial=++reviewSerial,content=$('review-content');content.replaceChildren(text('p','Loading reports…','form-hint'));
  try{const rows=await loadTotals(config.id,true);if(serial!==reviewSerial)return;totals=rows;freshPopup();content.replaceChildren();const markers=originals.filter(m=>rows.has(m.id)).sort((a,b)=>rows.get(b.id).down-rows.get(a.id).down||rows.get(b.id).up-rows.get(a.id).up);
   if(!markers.length)content.append(text('p','No marker votes yet.','form-hint'));
   // Reasons and details of "looks wrong" votes; only admins can read them.
   const {data:reports,error}=await client.from('votes').select('target_id,reason,comment,created_at').eq('map',config.id).eq('value',-1).order('created_at',{ascending:false});if(error)throw error;if(serial!==reviewSerial)return;
   for(const m of markers){const counts=rows.get(m.id),card=text('div','','reported-card');card.append(button(m.name+' · ✗ '+counts.down+' · ✓ '+counts.up,()=>{review.close();choose(m);},'reported-marker'));
    for(const r of (reports||[]).filter(r=>r.target_id===m.id))card.append(text('p',(reasons[r.reason]||'No reason given')+(r.comment?' · '+r.comment:''),'reported-reason'));content.append(card);}
  }catch{status('Reports could not load. Please try again.');}
 }
 accountUI();client.auth.onAuthStateChange((eventName,session)=>{setTimeout(()=>authChanged(session).catch(()=>status('Account could not refresh. Your local notes are safe.')),0);});
 client.auth.getSession().then(({data,error})=>{if(error)throw error;return authChanged(data.session);}).catch(()=>status('Account could not load. Your local notes are safe.'));
 window.addEventListener('atlas:loaded',()=>onMap().catch(()=>status('Community data could not load.')));
 window.addEventListener('atlas:notes',scheduleSync);window.addEventListener('atlas:positions',offerPositions);
 window.addEventListener('atlas:edit-ended',()=>{if(user&&syncReady!==syncIdentity())syncNotes(mapSerial);});
 window.addEventListener('online',()=>{pushJobs();if(user&&map&&!loading&&syncReady!==syncIdentity())syncNotes(mapSerial);});
 document.addEventListener('visibilitychange',()=>{if(document.hidden)pushJobs();});
 if(map&&!loading)onMap();
})();
