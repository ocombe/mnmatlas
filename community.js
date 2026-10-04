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
 let user=null,admin=false,authSerial=0,mapSerial=0,reviewLayer=null,syncing=false,syncReady='',syncTimer,reviewSerial=0;
 // Reports sent in this visit; nothing is kept per marker, so a fixed marker starts clean.
 const reportedNow=new Set(),syncJobs=new Map(),sentKey='mnmaps-community-sent',sharedKey='mnmaps-community-shared';
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
  account.append(text('p','Signing in lets you report problems, suggest fixes and keep your notes on every device.'),syncLine,reviewButton);reviewButton.hidden=!admin;
  if(user)account.append(button('Delete my account',deleteDialog,'community-delete'));
 }
 $('about-community').textContent='Optional Discord sign-in stores your Discord name and id, your suggestions and reports and, if you sign in, your notes, so they follow you between devices. Delete my account removes all of it.';$('about-community').hidden=false;
 const localNoteLine=document.querySelector('.journal-bottom>.backup').previousElementSibling;localNoteLine.textContent='Notes stay in this browser; sign in to sync them.';
 $('editor').querySelector('.form-hint').textContent='Saved on this device. Sign in to sync notes, and export a backup.';
 async function signIn(){
  try{const url=new URL(location.href);url.hash='';event('sign-in');const {error}=await client.auth.signInWithOAuth({provider:'discord',options:{redirectTo:url.href}});if(error)throw error;}
  catch{status('Discord sign-in could not start. Please try again.');}
 }
 async function signOut(){try{await pushJobs();const {error}=await client.auth.signOut();if(error)throw error;}catch{status('Sign-out could not finish. Please try again.');}}
 // Deletes the sign-in and everything stored with it on the server; notes saved in this browser stay here.
 function deleteDialog(){
  const d=showDialog('Delete your account?');
  d.append(text('p','This permanently deletes your sign-in and everything stored with it: your synced notes, your suggestions and reports, including ones not reviewed yet.'),text('p','Notes saved in this browser stay here until you delete them. Markers already added to the atlas from your suggestions stay, without your name.','form-hint'));
  const actions=text('div','','dialog-actions'),go=button('Delete my account',async()=>{
   go.disabled=true;clearTimeout(syncTimer);syncJobs.clear();syncReady='';
   try{const {error}=await client.rpc('delete_my_account');if(error)throw error;}
   catch{go.disabled=false;status('Your account could not be deleted. Please try again.');return;}
   d.close();try{await client.auth.signOut({scope:'local'});}catch{}authChanged(null);status('Your account and its data have been deleted.');event('account-deleted');
  },'danger');
  actions.append(button('Cancel',()=>d.close()),go);d.append(actions);
 }
 function showDialog(title){dialog.replaceChildren();const heading=text('h2',title);heading.id='community-title';dialog.append(heading);if(!dialog.open)dialog.showModal();return dialog;}
 function signInDialog(){const d=showDialog('Sign in to contribute');d.append(text('p','Sign in with Discord to report problems or send suggestions for review. Your positions and notes remain saved in this browser.'));const actions=text('div','','dialog-actions');actions.append(button('Close',()=>d.close()),button('Sign in with Discord',signIn,'primary'));d.append(actions);}
 function freshPopup(){if(!map||loading)return;for(const m of allMarkers()){const pin=pins.get(m.id);if(pin)pin.setPopupContent(popup(m));}}
 // A report says what is wrong, so it can be acted on; it waits in review until fixed or dismissed.
 const reasons={position:'Wrong position',name:'Wrong name',type:'Wrong type or icon',missing:'Not there in the game',other:'Something else'};
 const turnedOff=e=>String(e?.message||'').includes('turned off for this account');
 const reportToken=m=>config.id+':'+m.id;
 function reportDialog(m){
  if(!user){signInDialog();return;}
  const d=showDialog('Report a problem');d.append(text('p',m.name,'form-hint'));
  const list=text('div','','community-choices'),radios=[];
  for(const [key,label] of Object.entries(reasons)){const row=text('label',''),r=document.createElement('input');r.type='radio';r.name='report-reason';r.value=key;row.append(r,text('span',label));list.append(row);radios.push(r);}
  d.append(list);
  const hint=text('p','Tip: in ✎ Edit positions you can drag the marker to the right spot and send it for review.','form-hint');hint.hidden=true;d.append(hint);
  for(const r of radios)r.onchange=()=>{hint.hidden=r.value!=='position'||!r.checked;};
  const label=text('label','Details (optional)');label.htmlFor='report-comment';const comment=document.createElement('textarea');comment.id='report-comment';comment.maxLength=500;comment.rows=3;comment.placeholder='For example: it is on the other side of the bridge.';d.append(label,comment);
  const actions=text('div','','dialog-actions'),send=button('Send report',async()=>{
   const picked=radios.find(r=>r.checked);if(!picked){status('Choose what is wrong.');return;}if(!user){signInDialog();return;}
   send.disabled=true;const [x,y]=publishedPositions.get(m.id)||[m.x,m.y];
   try{const {error}=await client.from('suggestions').insert({user_id:user.id,author_name:displayName(user),map:config.id,level:m.level||config.levelId||null,kind:'report',target_id:m.id,payload:{name:m.name,reason:picked.value,x,y},comment:comment.value.trim()||null});if(error)throw error;
    reportedNow.add(reportToken(m));d.close();freshPopup();status('Thanks! Your report is waiting for review.');event('report-sent');}
   catch(e){status(turnedOff(e)?'Your account can no longer send reports.':'The report could not be sent. Please try again.');}
   finally{send.disabled=false;}
  },'primary');
  actions.append(button('Cancel',()=>d.close()),send);d.append(actions);
 }
 // A published marker's or place name's text can be corrected; the change waits in review like any suggestion.
 const editedNow=new Set(),editToken=(kind,id)=>config.id+':'+kind+':'+id;
 function editDialog(target,kind){
  if(!user){signInDialog();return;}
  const d=showDialog(kind==='edit-label'?'Suggest a better place name':'Suggest an edit');
  d.append(text('p','Fix the name or the description. Your change waits for review before it appears on the map.','form-hint'));
  const field=(label,id,el)=>{const l=text('label',label);l.htmlFor=id;el.id=id;d.append(l,el);return el;};
  const name=field('Name','edit-name',document.createElement('input'));name.maxLength=100;name.required=true;name.value=target.name;
  const note=field('Description','edit-note',document.createElement('textarea'));note.maxLength=2000;note.rows=4;note.value=target.note||'';note.placeholder='What players should know about this place.';
  const why=field('Why (optional)','edit-comment',document.createElement('textarea'));why.maxLength=500;why.rows=2;why.placeholder='For example: the vendor was renamed in the last patch.';
  const actions=text('div','','dialog-actions'),send=button('Send for review',async()=>{
   const newName=name.value.replace(/\s+/g,' ').trim(),newNote=note.value.trim(),oldNote=(target.note||'').trim();
   if(!newName){status('Give it a name.');name.focus?.();return;}
   if(newName===target.name&&newNote===oldNote){status('Change the name or the description first.');return;}
   if(!user){signInDialog();return;}send.disabled=true;
   try{const {error}=await client.from('suggestions').insert({user_id:user.id,author_name:displayName(user),map:config.id,level:target.level||config.levelId||null,kind,target_id:target.id,payload:{name:newName,note:newNote,from:{name:target.name,note:target.note||''}},comment:why.value.trim()||null});if(error)throw error;
    editedNow.add(editToken(kind,target.id));d.close();freshPopup();map.closePopup();status('Thanks! Your edit is waiting for review.');event('edit-sent');}
   catch(e){status(turnedOff(e)?'Your account can no longer send suggestions.':'The edit could not be sent. Please try again.');}
   finally{send.disabled=false;}
  },'primary');
  actions.append(button('Cancel',()=>d.close()),send);d.append(actions);name.focus?.();
 }
 const editButton=(target,kind)=>editedNow.has(editToken(kind,target.id))?text('p','Edit sent for review','moved-note'):button('Suggest an edit',()=>editDialog(target,kind),'community-edit');
 const sharedToken=m=>scope()+':'+m.id;
 window.atlasCommunity={popup(m,n){
  if(m.id.startsWith('personal-')){if(alignmentMode)return;const shared=readSet(sharedKey).has(sharedToken(m));n.append(shared?text('p','Shared for review','moved-note'):button('Share with everyone',()=>shareNote(m)));return;}
  const row=text('div','','community-actions');row.append(editButton(m,'edit-marker'),reportedNow.has(reportToken(m))?text('p','Reported, thanks','moved-note'):button('Report a problem',()=>reportDialog(m),'community-report'));n.append(row);
 },placePopup(p,n){
  if(p.kind!=='label'||!labelData.labels.some(l=>l.id===p.id))return;
  n.append(editButton(labelData.labels.find(l=>l.id===p.id),'edit-label'));
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
   }catch(e){if(turnedOff(e)){status('Your account can no longer send suggestions. Your local notes and positions are safe.');freshPopup();return;}status('Some suggestions could not be sent. Unsent items remain selected; your local notes and positions are safe.');freshPopup();}
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
  if(!map||loading)return;const serial=++mapSerial;syncReady='';clearPreview();if(review.open)review.close();
  await syncNotes(serial);
 }
 async function authChanged(session){
  const next=session?.user||null;if(next?.id===user?.id)return;
  const serial=++authSerial;user=next;admin=false;syncReady='';accountUI();if(review.open)review.close();clearPreview();freshPopup();
  if(user){const uid=user.id;try{const {data,error}=await client.from('admins').select('user_id').eq('user_id',uid).maybeSingle();if(error)throw error;if(serial!==authSerial)return;admin=!!data;accountUI();}catch{status('Account permissions could not load. Please try again.');}}
  if(serial===authSerial)await onMap();
 }
 function clearPreview(){reviewLayer?.remove();reviewLayer=null;$('community-preview')?.remove();}
 review.addEventListener('close',()=>{reviewSerial++;});
 function reviewShell(){
  review.replaceChildren();const title=text('h2','Review suggestions');title.id='review-title';review.append(title);
  const content=text('div','','review-content');content.id='review-content';review.append(content);const actions=text('div','','dialog-actions');actions.append(button('Close',()=>review.close()));review.append(actions);
 }
 function openReview(){if(!admin)return;if(!map||loading){status('The map is still loading.');return;}reviewShell();review.showModal();pendingTab();}
 async function pendingTab(all=false,offset=0){
  clearPreview();const serial=++reviewSerial,content=$('review-content');content.replaceChildren();
  const toggle=text('label','','community-check'),check=document.createElement('input');check.type='checkbox';check.checked=all;check.onchange=()=>pendingTab(check.checked);toggle.append(check,text('span','All maps'));content.append(toggle,text('p','Loading…','form-hint'));
  try{let request=client.from('suggestions').select('*').eq('status','pending').order('created_at',{ascending:false}).order('id',{ascending:false});if(!all)request=request.eq('map',config.id);const {data,error}=await request.range(offset,offset+199);if(error)throw error;if(serial!==reviewSerial||!admin)return;content.lastChild.remove();
   if(!data.length)content.append(text('p','Nothing to review. Reports come from Report a problem on a marker; suggestions from Edit positions and Share with everyone.','form-hint'));
   const perAuthor=new Map();for(const row of data)perAuthor.set(row.user_id,(perAuthor.get(row.user_id)||0)+1);
   for(const row of data){const card=text('article','','review-card'),count=perAuthor.get(row.user_id);card.append(text('strong',row.payload.name),text('p','By '+(row.author_name||'Discord member')+(count>1?' ('+count+' waiting)':''),'review-author'),text('p',(kinds[row.kind]||row.kind)+' · '+row.map+(row.level?' / '+row.level:'')+' · '+new Date(row.created_at).toLocaleString(),'form-hint'));if(row.comment)card.append(text('p',row.comment));
    if(row.kind==='report')card.append(text('p',reasons[row.payload.reason]||'Something else','reported-reason'));
    if(row.kind==='edit-marker'||row.kind==='edit-label'){const f=row.payload.from||{},was=v=>v||'(none)';if(f.name!==row.payload.name)card.append(text('p','Name: '+was(f.name)+' → '+row.payload.name,'review-change'));if((f.note||'')!==(row.payload.note||''))card.append(text('p','Description: '+was(f.note)+'\n→ '+was(row.payload.note),'review-change'));}
    if(row.kind==='new-marker'){card.append(text('p',row.payload.noteType||row.payload.category,'form-hint'));if(row.payload.note)card.append(text('p',row.payload.note));}
    const label=text('label','Optional review note'),note=document.createElement('textarea');note.rows=2;note.maxLength=500;label.append(note);card.append(label);
    const actions=text('div','','dialog-actions');if(row.user_id!==user?.id)actions.append(button('Ban author',()=>banDialog(row,all),'review-ban'));actions.append(button('Show on map',()=>preview(row)),...decisions(row,()=>note.value,card));card.append(actions);content.append(card);
   }
   const pages=text('div','','dialog-actions');if(offset)pages.append(button('Newer',()=>pendingTab(all,Math.max(0,offset-200))));if(data.length===200)pages.append(button('Older',()=>pendingTab(all,offset+200)));content.append(pages);
   await bannedList(content,serial,all);
  }catch{if(serial===reviewSerial){content.lastChild?.remove();content.append(text('p','Suggestions could not load. Try again.','form-hint'));}status('Suggestions could not load. Please try again.');}
 }
 // A banned account can still use the atlas and its notes, but cannot send suggestions or reports.
 function banDialog(row,all){
  const name=row.author_name||'Discord member',d=showDialog('Ban '+name+' from suggestions?');
  d.append(text('p','They can still use the atlas and their notes, but can no longer send suggestions or reports. All their suggestions waiting for review are dismissed.'),text('p','You can lift the ban later under Banned authors.','form-hint'));
  const actions=text('div','','dialog-actions'),go=button('Ban and dismiss',async()=>{
   go.disabled=true;
   try{let {error}=await client.from('banned').insert({user_id:row.user_id,author_name:name});if(error&&error.code!=='23505')throw error;
    ({error}=await client.from('suggestions').update({status:'rejected',reviewed_at:new Date().toISOString(),review_note:'Author banned'}).eq('user_id',row.user_id).eq('status','pending'));if(error)throw error;
    d.close();status(name+' is banned; their waiting suggestions were dismissed.');pendingTab(all);}
   catch{go.disabled=false;status('The ban could not be saved. Please try again.');}
  },'danger');
  actions.append(button('Cancel',()=>d.close()),go);d.append(actions);
 }
 async function bannedList(content,serial,all){
  const {data,error}=await client.from('banned').select('user_id,author_name,banned_at').order('banned_at',{ascending:false});if(error)throw error;if(serial!==reviewSerial||!data.length)return;
  const section=text('section','','review-banned');section.append(text('h3','Banned authors'));
  for(const row of data){const line=text('div','','review-banned-row');line.append(text('span',(row.author_name||'Discord member')+' · since '+new Date(row.banned_at).toLocaleDateString()),button('Lift ban',async()=>{const {error}=await client.from('banned').delete().eq('user_id',row.user_id);if(error){status('The ban could not be lifted. Please try again.');return;}status((row.author_name||'This account')+' can send suggestions again.');pendingTab(all);}));section.append(line);}
  content.append(section);
 }
 // Reports close as fixed or dismissed; other suggestions are approved for publishing or rejected.
 const kinds={'move-marker':'Moved marker','move-label':'Moved label','new-marker':'New marker','edit-marker':'Edited marker','edit-label':'Edited place name',report:'Problem report'};
 function decisions(row,note,card){const report=row.kind==='report';return [button(report?'Dismiss':'Reject',()=>reviewAction(row,'rejected',note(),card)),button(report?'Fixed':'Approve',()=>reviewAction(row,report?'resolved':'approved',note(),card),'primary')];}
 async function reviewAction(row,state,note,card){
  for(const b of card.querySelectorAll('button'))b.disabled=true;
  try{const {data,error}=await client.from('suggestions').update({status:state,reviewed_at:new Date().toISOString(),review_note:note.trim()||null}).eq('id',row.id).eq('status','pending').select('id');if(error||!data?.length)throw error||Error();card.remove();clearPreview();status({approved:'Suggestion approved for publishing.',resolved:'Report marked as fixed.',rejected:row.kind==='report'?'Report dismissed.':'Suggestion rejected.'}[state]);}
  catch{status('Review could not be saved. Please refresh the list.');for(const b of card.querySelectorAll('button'))b.disabled=false;}
 }
 async function preview(row){
  try{
   review.close();const url=new URL(location.href);url.searchParams.set('map',row.map);for(const k of ['place','x','y','z'])url.searchParams.delete(k);if(row.level)url.searchParams.set('level',row.level);else url.searchParams.delete('level');
   if(config.id!==row.map||(row.level&&config.levelId!==row.level))await loadMap(row.map,url);
   if(config.id!==row.map||(row.level&&config.levelId!==row.level)||loading)throw Error();
   clearPreview();reviewLayer=L.layerGroup().addTo(map);const p=row.payload,edit=row.kind==='edit-marker'||row.kind==='edit-label',points=edit?[(row.kind==='edit-label'?publishedLabelPositions:publishedPositions).get(row.target_id)]:row.kind==='new-marker'||row.kind==='report'?[[p.x,p.y]]:[p.from,p.to];
   const locations=points.map(xy=>{if(!Array.isArray(xy)||xy.length!==2||!bounded(...xy,config.minZoom))throw Error();return locationOf({x:xy[0],y:xy[1]});});
   locations.forEach((where,i)=>{const suggested=points.length===1||i,label=points.length===1?(row.kind==='report'?'Reported marker':edit?'Edited':'Suggested marker'):i?'Suggested position':'Published position';const marker=L.circleMarker(where,{radius:suggested?9:6,color:suggested?'#b5861f':'#2f6f9a',fillColor:suggested?'#b5861f':'#2f6f9a',fillOpacity:.75,weight:3}).bindTooltip(()=>text('span',label+' · '+p.name),{permanent:true,direction:suggested?'bottom':'top'});reviewLayer.addLayer(marker);});
   if(locations.length===2)reviewLayer.addLayer(L.polyline(locations,{color:'#b5861f',weight:2,dashArray:'6 6'}));
   const bar=text('section','','community-preview');bar.id='community-preview';bar.setAttribute('aria-label','Review selected suggestion');bar.append(text('strong',p.name));const note=document.createElement('input');note.placeholder='Optional review note';note.setAttribute('aria-label','Optional review note');note.maxLength=500;bar.append(note);const actions=text('div','','dialog-actions');actions.append(button('Close',clearPreview),...decisions(row,()=>note.value,bar));bar.append(actions);$('map-frame').append(bar);
   if(locations.length===2)map.fitBounds(L.latLngBounds(locations),{padding:[60,60],maxZoom:config.defaultView.placeZoom+1});else map.setView(locations[0],config.defaultView.placeZoom);if(compact())setPanel(false);status(locations.length===2?'Blue: published position. Amber: suggested position.':row.kind==='report'?'Amber: reported marker.':edit?'Amber: the marker or name being edited.':'Amber: suggested marker.');
  }catch{clearPreview();status('This suggestion could not be shown on the map.');}
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
