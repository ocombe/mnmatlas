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
 let previewLeave=()=>true;const allowLeave=()=>{if(!previewLeave())return false;previewLeave=()=>true;return true;};
 let user=null,admin=false,authSerial=0,mapSerial=0,reviewLayer=null,syncing=false,syncReady='',privateSyncReady='',syncTimer,reviewSerial=0;
 // Reports sent in this visit; nothing is kept per marker, so a fixed marker starts clean.
 const reportedNow=new Set(),syncJobs=new Map(),sentKey='mnmaps-community-reviewed-positions',sharedKey='mnmaps-community-shared';
 const normaliseSuggestion=normaliseChange;
 const scope=()=>config.id+'-'+config.tileRevision,displayName=u=>String(u?.user_metadata?.full_name||u?.user_metadata?.name||u?.user_metadata?.preferred_username||'Discord member').slice(0,80);
 function readSet(key){try{const rows=JSON.parse(localStorage.getItem(key)||'[]');return new Set(Array.isArray(rows)?rows.filter(r=>typeof r==='string'):[]);}catch{return new Set();}}
 function remember(key,values){try{const rows=readSet(key);for(const value of values)rows.add(value);localStorage.setItem(key,JSON.stringify([...rows]));}catch{status('Sent successfully, but this browser could not remember it.');}}
 // Account lives in the top bar: a Sign in / avatar button that opens a small menu.
 const accountBox=text('div','','account'),accountButton=text('button','','account-button'),account=text('div','','account-menu');
 accountButton.type='button';accountButton.setAttribute('aria-haspopup','true');accountButton.setAttribute('aria-expanded','false');account.id='account-menu';account.hidden=true;accountButton.setAttribute('aria-controls',account.id);
 accountBox.append(accountButton,account);(document.querySelector('.notices')||$('toggle-panel')).after(accountBox);
 const notesLine=document.querySelector('.journal-bottom .backup').previousElementSibling;
 const syncLine=text('p','','community-sync');syncLine.setAttribute('role','status');syncLine.setAttribute('aria-live','polite');
 const reviewButton=button('Review',()=>{closeAccount();openReview();}),reviewCount=text('span','','account-badge');reviewCount.hidden=true;reviewButton.append(reviewCount);
 const dialog=text('dialog','','community-dialog');dialog.id='community-dialog';dialog.setAttribute('aria-labelledby','community-title');document.body.append(dialog);
 let desk;
 function quiet(message){syncLine.textContent=message;if(message)status(message);}
 // Discord's own avatar, only from its image host; the first letter of the name otherwise.
 function avatar(size){
  const src=String(user?.user_metadata?.avatar_url||''),letter=text('span',displayName(user).trim().charAt(0).toUpperCase()||'?','account-avatar');letter.setAttribute('aria-hidden','true');letter.style.setProperty('--size',size+'px');
  if(/^https:\/\/cdn\.discordapp\.com\/[a-zA-Z0-9_./-]+$/.test(src)){const img=document.createElement('img');img.src=src;img.alt='';img.width=img.height=size;img.referrerPolicy='no-referrer';img.onerror=()=>img.replaceWith(letter);img.className='account-avatar';img.style.setProperty('--size',size+'px');return img;}
  return letter;
 }
 function accountUI(){
  accountButton.replaceChildren();
  if(user){accountButton.append(avatar(24),text('span',displayName(user),'account-name'));accountButton.insertAdjacentHTML('beforeend','<svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4.5 6 7.5 9 4.5"/></svg>');accountButton.setAttribute('aria-label','Account: '+displayName(user));}
  else{accountButton.append(text('span','Sign in','account-name'));accountButton.removeAttribute('aria-label');}
  account.replaceChildren();
  if(user){
   const head=text('div','','account-head'),who=text('div');who.append(text('strong',displayName(user)),text('small','Signed in with Discord'));head.append(avatar(36),who);
   // Contribution points: approved suggestions count 1, bounties 2, priority bounties 3.
   const points=text('p','','account-points');points.hidden=true;myPoints().then(p=>{if(!p)return;points.textContent=rewardWord[0].toUpperCase()+rewardWord.slice(1)+': '+p.points+(p.bounties+p.priority_bounties?' · '+(p.bounties+p.priority_bounties)+((p.bounties+p.priority_bounties)===1?' bounty':' bounties'):'');points.hidden=false;});
   account.append(head,points,syncLine);if(admin)account.append(reviewButton);
   account.append(button('Sign out',()=>{if(!desk.close())return;closeAccount();signOut();}),text('hr'),button('Delete my account…',()=>{closeAccount();deleteDialog();},'account-delete'));
  }
  else account.append(text('p','Sign in with Discord to keep your notes on every device, report problems and suggest fixes.'),button('Sign in with Discord',signIn,'primary'));
  notesLine.textContent=user?'Your notes sync to your account.':'Notes stay in this browser; sign in to sync them.';
  if(admin)countWaiting();
 }
 function openAccount(){account.hidden=false;accountBox.classList.add('open');accountButton.setAttribute('aria-expanded','true');if(admin)countWaiting();account.querySelector('button')?.focus({preventScroll:true});}
 function closeAccount(refocus){if(account.hidden)return;account.hidden=true;accountBox.classList.remove('open');accountButton.setAttribute('aria-expanded','false');if(refocus)accountButton.focus({preventScroll:true});}
 accountButton.onclick=()=>account.hidden?openAccount():closeAccount(false);
 account.addEventListener('keydown',e=>{if(e.key==='Escape'){e.stopPropagation();closeAccount(true);}});
 document.addEventListener('pointerdown',e=>{if(!accountBox.contains(e.target))closeAccount(false);});
 accountBox.addEventListener('focusout',e=>{if(e.relatedTarget&&!accountBox.contains(e.relatedTarget))closeAccount(false);});
 // Waiting suggestions on every map, shown beside Review suggestions.
 async function countWaiting(){
  if(!admin)return;
  try{const {count,error}=await client.from('suggestions').select('id',{count:'exact',head:true}).eq('status','pending');if(error)throw error;reviewCount.textContent=count>99?'99+':String(count||'');reviewButton.textContent='Review ('+(count||0)+')';reviewCount.hidden=!count;}catch{reviewCount.hidden=true;}
 }
 $('about-community').textContent='Optional Discord sign-in stores your Discord name and id, your suggestions and reports and, if you sign in, your notes, so they follow you between devices. Delete my account removes all of it.';$('about-community').hidden=false;
 $('editor').querySelector('.storage-hint').textContent='Saved on this device. Sign in to sync notes, and export a backup.';
 async function signIn(){
  if(embedded){popupSignIn();return;}
  try{const url=new URL(location.href);url.hash='';event('sign-in');const {error}=await client.auth.signInWithOAuth({provider:'discord',options:{redirectTo:url.href}});if(error)throw error;}
  catch{status('Discord sign-in could not start. Please try again.');}
 }
 // Inside another site's frame Discord refuses to load, so sign-in runs in a small window (signin.html) that posts the session back here.
 let signInWindow=null,signInWatch;
 // Host-initiated sign-in still requires an Atlas-side consent gesture. This also
 // gives browsers a user gesture for the existing Discord popup.
 window.installAtlasEmbedAuth?.({client,settings,approve:partner=>new Promise(resolve=>{
  const consent=text('dialog','','community-dialog');consent.setAttribute('aria-label','Sign in to '+(partner.name||partner.id));consent.append(text('h2','Sign in to '+(partner.name||partner.id)+'?'));document.body.append(consent);consent.showModal();
  consent.append(text('p','Share your verified Discord identity with '+partner.origin+'. Your Atlas notes and permissions stay here.'));
  let settled=false;const finish=value=>{if(settled)return;settled=true;clearTimeout(expiry);consent.close();consent.remove();resolve(value)};
  const expiry=setTimeout(()=>finish(false),300000);
  const actions=text('div','','dialog-actions');
  actions.append(button('Cancel',()=>finish(false)),button('Continue with Discord',()=>{if(user){finish(true);return;}popupSignIn(message=>status(message));}));consent.append(actions);consent.addEventListener('close',()=>finish(false),{once:true});
 })});
 function fullAtlasHint(message){
  account.querySelector('.community-fallback')?.remove();openAccount();
  const url=new URL(location.href);url.searchParams.delete('embed');url.hash='';
  const line=text('p',message+' ','community-fallback form-hint'),link=text('a','Open the full atlas');link.href=url.href;link.target='_blank';link.rel='noopener';
  line.append(link,text('span',' to sign in there.'));account.append(line);
 }
 // The wiki field also uses this window on the full atlas, so an open note survives the sign-in; trouble is then shown there.
 let signInTrouble=fullAtlasHint;
 function popupSignIn(trouble=fullAtlasHint){
  event('sign-in');account.querySelector('.community-fallback')?.remove();signInTrouble=trouble;
  const w=520,h=720,left=Math.max(0,(screen.availWidth-w)/2),top=Math.max(0,(screen.availHeight-h)/2);
  signInWindow=window.open(location.origin+'/signin.html','mnmaps-signin',`popup,width=${w},height=${h},left=${left},top=${top}`);
  if(!signInWindow){trouble('Your browser blocked the sign-in window.');return;}
  clearInterval(signInWatch);
  signInWatch=setInterval(()=>{if(!signInWindow||!signInWindow.closed)return;clearInterval(signInWatch);signInWindow=null;if(!user)trouble('Sign-in did not reach this map.');},700);
 }
 window.addEventListener('message',async e=>{
  if(e.origin!==location.origin||!signInWindow||e.source!==signInWindow)return;
  const d=e.data;if(!d||d.type!=='mnmaps-session'||typeof d.access_token!=='string'||typeof d.refresh_token!=='string')return;
  clearInterval(signInWatch);signInWindow=null;
  try{const {error}=await client.auth.setSession({access_token:d.access_token,refresh_token:d.refresh_token});if(error)throw error;}
  catch{signInTrouble('Sign-in could not finish in this map.');}
 });
 async function signOut(){try{await pushJobs();const {error}=await client.auth.signOut();if(error)throw error;}catch{status('Sign-out could not finish. Please try again.');}}
 // Deletes the sign-in and everything stored with it on the server; notes saved in this browser stay here.
 function deleteDialog(){
  const d=showDialog('Delete your account?');
  d.append(text('p','This closes your traveller\'s account for good. Your synced notes, waiting suggestions and reports are deleted; changes already accepted into the atlas stay, without your name.'),text('p','Notes saved in this browser stay here until you delete them. Accepted changes keep their place in the atlas, credited to an anonymous traveller at the next update.','form-hint'));
  const actions=text('div','','dialog-actions'),go=button('Delete my account',async()=>{
   go.disabled=true;clearTimeout(syncTimer);syncJobs.clear();syncReady='';
   try{const {error}=await client.rpc('delete_my_account');if(error)throw error;}
   catch{go.disabled=false;status('Your account could not be deleted. Please try again.');return;}
   d.close();try{await client.auth.signOut({scope:'local'});}catch{}authChanged(null);status('Your account, synced notes and waiting suggestions and reports are gone. Accepted changes stay in the atlas without your name.');event('account-deleted');
  },'danger');
  actions.append(button('Cancel',()=>d.close()),go);d.append(actions);
 }
 function showDialog(title,floating=false){dialog.oncancel=dialog.onclose=null;dialog.classList.remove('place-change','suggest-sheet','moving-place');for(const k of ['left','top','right','bottom','maxHeight','width'])dialog.style[k]='';dialog.replaceChildren();const heading=text('h2',title);heading.id='community-title';dialog.append(heading);if(!dialog.open){if(floating)dialog.show();else dialog.showModal();}if(floating)fitFloating(dialog);return dialog;}
 function fitFloating(card,point){const r=$('map-frame').getBoundingClientRect(),margin=12,width=Math.min(330,r.width-2*margin),height=r.height-2*margin;card.style.maxHeight=height+'px';card.style.width=width+'px';card.style.left=Math.max(r.left+margin,Math.min(r.right-width-margin,r.left+(point?.x||0)+60))+'px';card.style.top=r.top+margin+'px';card.style.right=card.style.bottom='auto';}
 // A labelled field of a dialog.
 function field(d,label,id,el){const l=text('label',label);l.htmlFor=id;el.id=id;d.append(l,el);return el;}
 const textBox=(rows,max,placeholder='')=>{const t=document.createElement('textarea');t.rows=rows;t.maxLength=max;t.placeholder=placeholder;return t;};
 // Radio choices of a dialog ({value: label}); picked() is the chosen value, or undefined.
 function choiceList(d,name,options){
  const list=text('div','','community-choices'),radios=Object.entries(options).map(([value,label])=>{const row=text('label',''),r=document.createElement('input');r.type='radio';r.name=name;r.value=value;row.append(r,text('span',label));list.append(row);return r;});
  d.append(list);return {radios,picked:()=>radios.find(r=>r.checked)?.value};
 }
 // What went wrong when sending, in the visitor's words.
 const sendError=(e,fallback,what='suggestions')=>turnedOff(e)?'Your account can no longer send '+what+'.':e?.code==='too-long'?'This is too long to send: shorten the description or remove shape points.':fallback;
 // A dialog's send button: it needs an account, runs once at a time and says what went wrong.
 function sendButton(label,run,failed,what,signedOut){const b=button(label,async()=>{if(!user){signedOut?.();signInDialog();return;}b.disabled=true;try{await run();}catch(e){status(sendError(e,failed,what));}finally{b.disabled=false;}},'primary');return b;}
 function signInDialog(){const d=showDialog('Sign in to contribute');d.append(text('p','Sign in with Discord to report problems or send suggestions for review. Your positions and notes remain saved in this browser.'));const actions=text('div','','dialog-actions');actions.append(button('Close',()=>d.close()),button('Sign in with Discord',signIn,'primary'));d.append(actions);}
 function freshPopup(){if(!map||loading)return;for(const m of allMarkers()){const pin=pins.get(m.id);if(pin?.isPopupOpen?.())pin.setPopupContent(()=>popup(m));}}
 // A report says what is wrong, so it can be acted on; it waits in review until fixed or dismissed.
 const reasons={position:'Wrong position',name:'Wrong name',type:'Wrong type or icon',missing:'Not there in the game',other:'Something else'};
 const turnedOff=e=>String(e?.message||'').includes('turned off for this account');
 const reportToken=m=>config.id+':'+m.id;
 function reportDialog(m){
  if(!user){signInDialog();return;}
  const d=showDialog('Report a problem');d.append(text('p',m.name,'form-hint'));
  const reason=choiceList(d,'report-reason',reasons);
  const hint=text('p','Tip: in ✎ Edit you can drag the marker to the right spot and send it for review.','form-hint');hint.hidden=true;d.append(hint);
  for(const r of reason.radios)r.onchange=()=>{hint.hidden=r.value!=='position'||!r.checked;};
  const comment=field(d,'Details (optional)','report-comment',textBox(3,500,'For example: it is on the other side of the bridge.'));
  const actions=text('div','','dialog-actions'),send=sendButton('Send report',async()=>{
   const picked=reason.picked();if(!picked){status('Choose what is wrong.');return;}
   const [x,y]=publishedPositions.get(m.id)||[m.x,m.y];
   const {data,error}=await client.from('suggestions').insert({user_id:user.id,author_name:displayName(user),map:config.id,level:m.level||config.levelId||null,kind:'report',target_id:m.id,payload:window.atlasFields.stored('report',{name:m.name,reason:picked,x,y}),comment:comment.value.trim()||null}).select('id').single();if(error)throw error;
   reportedNow.add(reportToken(m));d.close();await loadApproved();await sentUndo(data?.id);freshPopup();status('Thanks! Your report is waiting for review.');event('report-sent');
  },'The report could not be sent. Please try again.','reports');
  actions.append(button('Cancel',()=>d.close()),send);d.append(actions);
 }
 // A published marker's or place name's text can be corrected; the change waits in review like any suggestion.
 let cachedChanges=null;
 function changeSet(){const version=[mapSerial,config.id,config.levelId,originals,labelData,publishedPositions,publishedLabelPositions,approvedRows,pendingRows,rejectedRows,publishedMapLabels];if(cachedChanges&&version.every((v,i)=>v===cachedChanges.version[i]))return cachedChanges.set;const set=window.atlasChanges.buildChanges({mapId:config.id,levelId:config.levelId,markers:originals,labels:[...publishedMapLabels.filter(l=>!labelData.labels.some(p=>p.id===l.id&&p.level===l.level)),...labelData.labels],trainers:labelData.trainers||[],publishedPositions,publishedLabelPositions:new Map([...publishedMapLabels.map(l=>[l.id,[l.x,l.y]]),...publishedLabelPositions]),rows:[...approvedRows,...pendingRows,...rejectedRows],normalise:normaliseChange,onError:(row,error)=>desk.rowError(row,error)});cachedChanges={version,set};return set;}
 const targetState=(m,kind)=>changeSet().get((kind==='edit-label'?'label':originals.some(p=>p.id===m.id)||m.id.startsWith('community-')?'marker':'chip')+':'+m.id);
 const reviewMaps=new Map();let currentReviewSet=null;
 async function reviewLocations(rows,onError=(row,error)=>desk.rowError(row,error)){
  const ids=[...new Set(rows.flatMap(r=>[r.map,r.payload?.toMap,r.payload?.from?.toMap]).filter(Boolean))];await Promise.all(ids.map(async id=>{const c=registry.maps.find(c=>c.id===id);if(!c||id===config.id&&!c.levels||reviewMaps.has(id))return;try{const levels=c.levels?.length?c.levels:[c],markers=[],labels=[],trainers=[];for(const floor of levels){const conf={...c,...floor},m=conf.markersFile?await fetchData(conf.markersFile,[]):[],l=conf.labelsFile?await fetchData(conf.labelsFile,{labels:[],trainers:[]}):{};markers.push(...m.map(r=>({...r,level:r.level||(c.levels?floor.id:undefined)})));labels.push(...(l.labels||[]).map(r=>({...r,level:r.level||(c.levels?floor.id:undefined)})));trainers.push(...(l.trainers||[]).map(r=>({...r,level:r.level||(c.levels?floor.id:undefined)})));}reviewMaps.set(id,{markers,labels,trainers,rows:rows.filter(r=>r.map===id)});}catch(error){for(const row of rows.filter(r=>r.map===id||r.payload?.toMap===id||r.payload?.from?.toMap===id))onError(row,error);}}));for(const id of ids)if(reviewMaps.has(id))reviewMaps.get(id).rows=rows.filter(r=>r.map===id);
 }
 function reviewTarget(row){
  let current=null;if(row.map===config.id){if(!currentReviewSet||currentReviewSet.serial!==approvedSerial||currentReviewSet.map!==config.id||currentReviewSet.level!==config.levelId)currentReviewSet={serial:approvedSerial,map:config.id,level:config.levelId,set:changeSet()};current=currentReviewSet.set.forRow(row.id);if(current&&!current.missing)return current;}
  // A floor correction needs the mark on its old floor as well as its destination.
  const data=reviewMaps.get(row.map),from=data?otherMapChanges(data,row.map,row.level).forRow(row.id):null;
  return from||current||(row.map===config.id?targetState({id:row.target_id||'community-'+row.id},row.kind.endsWith('label')?'edit-label':'edit-marker'):null);
 }
 // One change set per map and floor for each fetched queue; rebuilding it per lookup froze the desk with a long queue.
 function otherMapChanges(data,mapId,levelId){if(data.sets?.rows!==data.rows)data.sets={rows:data.rows,byLevel:new Map()};const key=levelId||'';let set=data.sets.byLevel.get(key);if(!set){set=window.atlasChanges.buildChanges({...data,mapId,levelId,onError:(row,error)=>desk.rowError(row,error),publishedPositions:new Map(data.markers.map(m=>[m.id,[m.x,m.y]])),publishedLabelPositions:new Map(data.labels.map(l=>[l.id,[l.x,l.y]]))});data.sets.byLevel.set(key,set);}return set;}
 function reviewPlaces(id,level){return (id===config.id?labelData.labels:reviewMaps.get(id)?.labels||[]).filter(r=>!level||!r.level||r.level===level);}
 function connectNotices(){window.atlasNotices?.setAccount(user,{closeAccount,points:myPoints,kind:desk.kind,mapName:desk.mapName,show:showOwn,change:changeOwn,withdraw:withdrawOwn,rows:async()=>{const uid=user?.id,rows=[];if(!uid)return rows;for(let offset=0;;offset+=500){const {data,error}=await client.from('suggestions').select('*').eq('user_id',uid).order('created_at',{ascending:false}).range(offset,offset+499);if(error)throw error;rows.push(...(data||[]).map(normaliseSuggestion));if(!data||data.length<500)break;}return rows;}});}
 let ownSerial=0;
 async function travelOwn(row){if(!desk.close()||!allowLeave())return false;const serial=++ownSerial,url=new URL(location.href);for(const k of ['place','x','y','z'])url.searchParams.delete(k);url.searchParams.set('map',row.map);if(row.level)url.searchParams.set('level',row.level);else url.searchParams.delete('level');if(config.id!==row.map||row.level&&config.levelId!==row.level)await loadMap(row.map,url);if(serial!==ownSerial||config.id!==row.map||loading)return false;await loadApproved();return serial===ownSerial;}
 async function showOwn(row){if(!await travelOwn(row))return;const target=reviewTarget(row),at=window.atlasReview.point(row),live=row.status==='published'?target?.published:target?.proposed,p=Number.isFinite(live?.x)&&Number.isFinite(live?.y)?live:at.every(Number.isFinite)?{x:at[0],y:at[1]}:target?.published;if(!Number.isFinite(p?.x)||!Number.isFinite(p?.y)){status('This mark is no longer on this map.');return;}map.setView(locationOf(p),config.defaultView.placeZoom);const pin=suggestionPins.get(row.id)||pins.get(row.target_id)||labelPins.get(row.target_id);pin?.openPopup?.();if(compact())setPanel(false);}
 async function withdrawOwn(row){if(!user||row.user_id!==user.id||row.status!=='pending'||row.reviewed_at)return false;try{const {data,error}=await version(client.from('suggestions').delete().eq('id',row.id).eq('user_id',user.id).eq('status','pending').is('reviewed_at',null),row).select('id');if(error||!data?.length)throw error||Error();await loadApproved();status('Suggestion withdrawn.');return true;}catch{status('This suggestion changed or is already being reviewed. Open your notices again.');return false;}}
 async function changeOwn(row){
  if(!user||row.user_id!==user.id||row.status!=='pending'||row.reviewed_at||!await travelOwn(row))return;
  const t=reviewTarget(row),base=t?.effective||row.payload.from||{},value=window.atlasChanges.applyTo(base,row),d=showDialog('Change your suggestion'),move=row.kind.startsWith('move-');let fields=null,position=[value.x,value.y];
  if(!move&&!row.payload.remove&&row.kind!=='report')fields=window.atlasFields.build(d,{value,newMarker:row.kind==='new-marker',label:t?.kind==='label'||['exit','label'].includes(row.payload.noteType),chip:t?.kind==='chip',prefix:'own',finder:(...args)=>{const f=wikiFinder(...args);d.addEventListener('close',()=>{f.reset();finders.delete(f);},{once:true});return f;}});const why=field(d,'Comment for the cartographers','own-comment',textBox(3,500));why.value=row.comment||'';
  if(position.every(Number.isFinite)&&!row.payload.remove&&row.kind!=='report'){clearPreview();reviewLayer=L.layerGroup().addTo(map);const pin=L.marker(locationOf(value),{icon:pinIcon({...value,category:value.category||'Personal',...(t?.kind==='label'?{atlasLabel:true,noteType:value.kind==='exit'?'exit':'label'}:{})}),draggable:true,zIndexOffset:1200}).addTo(reviewLayer);pin.on('dragend',()=>position=pixelsOf(pin.getLatLng()));d.append(text('p','Drag the pin to adjust its spot.','form-hint'));map.setView(locationOf(value),config.defaultView.placeZoom);}
  const initial=JSON.stringify(fields?.read()||{}),start=JSON.stringify(position),leave=()=>JSON.stringify(fields?.read()||{})===initial&&JSON.stringify(position)===start&&why.value===(row.comment||'')||window.confirm('Leave without saving these changes?');
  const actions=text('div','','dialog-actions');actions.append(button('Cancel',()=>{try{if(leave())d.close();}catch{if(window.confirm('Leave without saving these changes?'))d.close();}}),sendButton('Save suggestion',async()=>{
   let payload=structuredClone(row.payload);if(fields){const now=fields.read();if(row.kind==='new-marker'){payload={...payload,...now};for(const k of ['trade','classes','vendor','sells','wikiId'])if(payload[k]===null)delete payload[k];}else{const delta=window.atlasFields.delta(now,value);delete delta.from;delete delta.name;if(now.name!==value.name)delta.name=now.name;Object.assign(payload,delta);}}
   if(position.every(Number.isFinite)){if(!bounded(...position,config.minZoom))throw Error('Keep the pin inside the map.');if(move)payload.to=position;else if(row.kind==='new-marker'||JSON.stringify(position)!==start){payload.x=position[0];payload.y=position[1];if(payload.from&&!Array.isArray(payload.from))payload.from={...base,...payload.from};}}
   payload=window.atlasFields.stored(row.kind,payload);
   const amendments=[...approvedRows,...pendingRows],newest=newestOnTarget(row,amendments);
   if(row.kind==='report'||newest?.id===row.id){const {data,error}=await version(client.from('suggestions').update({payload,comment:why.value.trim()||null,...(admin?{status:'approved',reviewed_at:new Date().toISOString()}:{})}).eq('id',row.id).eq('user_id',user.id).eq('status','pending').is('reviewed_at',null),row).select('*');if(error||!data?.length)throw error||Error('Changed since opened');window.atlasNotices?.sent(normaliseSuggestion(data[0]));}
   else{const now=fields?.read(),added=row.kind==='new-marker',kind=added?(t?.kind==='label'?'edit-label':'edit-marker'):row.kind,from=window.atlasChanges.nextFrom({effective:base.name?base:value},kind);payload=move?{...payload,from:[base.x,base.y]}:now?window.atlasFields.delta(now,from):{...payload,from};if(!move&&position.every(Number.isFinite)&&JSON.stringify(position)!==start){payload.x=position[0];payload.y=position[1];}await saveOwn({kind,target_id:added?'community-'+row.id:row.target_id,map:row.map,level:row.level,user_id:user.id,author_name:displayName(user),credit:row.credit,payload,comment:why.value.trim()||null},amendments);}
   d.close();await loadApproved();status(admin?'Saved for the next edition.':'Your suggestion is updated and waiting for review.');
  },'This suggestion changed or is already being reviewed. Open it again.'));d.append(actions);d.oncancel=e=>{e.preventDefault();try{if(leave())d.close();}catch{if(window.confirm('Leave without saving these changes?'))d.close();}};d.addEventListener('close',()=>{fields?.dispose();clearPreview();},{once:true});
 }
 async function sentUndo(id){if(id==null||!user)return;let found;try{found=await client.from('suggestions').select('*').eq('id',id).maybeSingle();}catch{return;}const {data,error}=found;if(error||!data)return;const row=normaliseSuggestion(data);window.atlasNotices?.sent(row);window.atlasOfferUndo('Delete just-sent suggestion',async()=>{try{let q=version(client.from('suggestions').delete().eq('id',row.id).eq('user_id',user.id).eq('status',row.status),row);if(!admin)q=q.is('reviewed_at',null);const {data:done,error}=await q.select('id');if(error||!done?.length)throw error||Error();await loadApproved();status('Just-sent suggestion withdrawn.');}catch{status('This suggestion changed or was reviewed; it could not be withdrawn.');}});}
 // Wiki search (signed-in visitors): look a page up by name and fill the wiki link with it.
 // The search goes through the atlas's own backend function, which holds the wiki's partner key.
 // Only what can stand on the map as a marker is searched (NPCs, not items or quests), and only in this map's zone:
 // the backend keeps the wiki's results from that zone. A map's wiki zone is its title unless maps.json gives wikiZone;
 // the world map spans every zone.
 let finderCount=0;const finders=new Set(),wikiTypes={npc:'NPC'},markerTypes=Object.keys(wikiTypes).join(',');
 const searchZone=()=>!config||config.zonesFile?'':config.wikiZone||config.title||'';
 async function wikiSearch(q,signal,asking){
  // Answers are kept in this browser for a day (and shared ones on the backend), so a repeated search costs the wiki nothing.
  const zone=searchZone(),key=q.toLowerCase().replace(/\s+/g,' '),id=markerTypes+'|'+zone.toLowerCase()+'|'+key,saved=readSearches(),hit=saved[id];if(hit&&Date.now()-hit.at<864e5)return hit;
  const {data}=await client.auth.getSession(),token=data?.session?.access_token;if(!token)throw Error('sign-in');asking?.();
  const r=await fetch(settings.supabaseUrl.replace(/\/$/,'')+'/functions/v1/wiki-search?q='+encodeURIComponent(key)+'&type='+markerTypes+(zone?'&zone='+encodeURIComponent(zone):''),{headers:{apikey:settings.supabaseKey,Authorization:'Bearer '+token},signal});
  if(!r.ok)throw Error(r.status===429?'busy':'failed');const body=await r.json();
  const answer={at:Date.now(),site:Object.hasOwn(wikiSites,body?.site)?body.site:'mnm-wiki',results:Array.isArray(body?.results)?body.results:[]};
  saved[id]=answer;const keys=Object.keys(saved).sort((a,b)=>saved[b].at-saved[a].at);for(const old of keys.slice(100))delete saved[old];
  try{localStorage.setItem(searchesKey,JSON.stringify(saved));}catch{}return answer;
 }
 const searchesKey='mnmaps-wiki-searches-2';
 function readSearches(){try{const rows=JSON.parse(localStorage.getItem(searchesKey)||'{}');return rows&&typeof rows==='object'&&!Array.isArray(rows)?rows:{};}catch{return {};}}
 // The wiki search lives in the Name field: typing a name lists the wiki's NPCs of this map's zone under it, and picking
 // one fills the name, the wiki link (input) and whatever else the form takes (picked). Typing on without picking keeps
 // exactly what was typed. Signed-out visitors get a plain Name field and a link to sign in.
 function wikiFinder(input,picked,name,{enabled=()=>true,multi=false}={}){
  // Inside a site that may not link to the Monsters and Memories Wiki, the Name field stays a plain field.
  if(!wikiSiteShown('mnm-wiki')){const off=text('div','','wiki-finder');off.hidden=true;off.update=off.reset=()=>{};return off;}
  const box=text('div','','wiki-finder'),list=text('div','','wiki-results'),signedOut=text('p','','form-hint wiki-signin-hint'),trouble=text('span','','wiki-signin-trouble');
  list.id='wiki-results-'+(++finderCount);list.setAttribute('role','listbox');list.setAttribute('aria-label','Wiki NPCs');
  name.setAttribute('aria-controls',list.id);name.setAttribute('aria-autocomplete','list');name.autocomplete='off';
  // Signing in from here keeps the note open: the sign-in window hands the session back to this page.
  signedOut.append(text('strong','Did you know?','wiki-tip-label'),button('Sign in',()=>{trouble.textContent='';popupSignIn(message=>{trouble.textContent=' '+message+' You can also sign in from the top bar.';});},'wiki-signin'),text('span',multi?' to seek mobs in the wiki and add them to this camp.':' to look up NPCs from the wiki as you type: picking one fills in its name, level, type, wiki link and location for you.'),trouble);
  // A spinner runs while the wiki is asked; answers kept in this browser show at once without it.
  const spinner=text('p','','wiki-searching');spinner.append(text('span','','wiki-spinner'),text('span','Searching the wiki…'));spinner.hidden=true;
  let timer,serial=0,wanted='',asking=null,active=-1;
  const busy=on=>{spinner.hidden=!on;list.setAttribute('aria-busy',on?'true':'false');};
  // Only the latest search counts: a new one cancels the wait and the request before it.
  const stop=()=>{clearTimeout(timer);serial++;asking?.abort();asking=null;busy(false);};
  const options=()=>[...list.querySelectorAll('button')].filter(b=>String(b.className).split(' ').includes('wiki-result'));
  const highlight=i=>{const all=options();active=all.length?(i+all.length)%all.length:-1;all.forEach((b,n)=>{b.className=n===active?'wiki-result active':'wiki-result';b.setAttribute('aria-selected',String(n===active));});if(active>=0){name.setAttribute('aria-activedescendant',all[active].id);all[active].scrollIntoView?.({block:'nearest'});}else name.removeAttribute('aria-activedescendant');};
  // The credit names and links the wiki the results came from, under the list and again after a pick.
  const credit=(from,lead)=>{const line=wikiCredit(from,lead);if(line)list.append(line);};
  const pick=(row,from)=>{if(!enabled())return;name.value=multi?'':row.name+levelText(row.level);wanted=name.value.trim().toLowerCase().replace(/\s+/g,' ');
   input.value=row.url;setWikiPick(input,row.url,row.id);input.dispatchEvent(new Event('input'));picked?.(row);
   stop();show([]);credit(from,'Filled from the wiki · ');name.focus?.();};
  const show=(rows,message,from,heading)=>{list.replaceChildren();active=-1;name.removeAttribute('aria-activedescendant');name.setAttribute('aria-expanded',String(rows.length>0));
   if(heading&&rows.length)list.append(text('p',heading,'wiki-heading'));if(message)list.append(text('p',message,'form-hint'));
   rows.forEach((row,n)=>{const b=button('',()=>pick(row,from),'wiki-result');b.id=list.id+'-'+n;b.setAttribute('role','option');b.tabIndex=-1;
    b.append(text('strong',row.name),text('small',[isClassTrainer(row)?'Class trainer':wikiTypes[row.type]||row.type,row.level?'level '+row.level:'',row.zone].filter(Boolean).join(' · ')));list.append(b);});
   if(rows.length)credit(from);};
  const showFound=(site,results)=>{const rows=results.filter(r=>Object.hasOwn(wikiTypes,r.type)),zone=searchZone();show(rows,rows.length?'':zone?'No wiki NPC in '+zone+' with that name.':'No wiki NPC with that name.',site,zone?'Wiki NPCs in '+zone:'Wiki NPCs');};
  // Typing waits 600 ms for a pause; the same words again (spaces or case aside) do not search twice.
  name.addEventListener('input',()=>{if(!user||!enabled())return;const q=name.value.trim(),key=q.toLowerCase().replace(/\s+/g,' ');if(key===wanted)return;
   stop();wanted=key;const mine=serial;if(q.length<2){show([]);return;}
   timer=setTimeout(async()=>{const request=new AbortController();asking=request;
    try{const {site,results}=await wikiSearch(q,request.signal,()=>{if(mine===serial)busy(true);});if(mine===serial){busy(false);asking=null;showFound(site,results);}}
    catch(e){if(mine!==serial)return;busy(false);asking=null;wanted='';show([],e.message==='busy'?'Wiki searches are rate limited. Try again in a minute.':'The wiki could not be searched right now. Keep typing the name, or paste the page address below.');}},600);});
  // Up and down move through the suggestions, Enter picks one, Escape closes them (and only them).
  name.addEventListener('keydown',e=>{const all=options();if(!all.length)return;
   if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();highlight(active<0&&e.key==='ArrowUp'?all.length-1:active+(e.key==='ArrowDown'?1:-1));}
   else if(e.key==='Enter'&&active>=0){e.preventDefault();all[active].onclick();}
   else if(e.key==='Escape'){e.preventDefault();e.stopPropagation();stop();show([]);}});
  box.append(spinner,list,signedOut);
  box.update=()=>{if(!enabled()){stop();wanted='';show([]);box.hidden=true;name.removeAttribute('aria-autocomplete');name.removeAttribute('aria-controls');name.placeholder='Give this place a name';return;}name.setAttribute('aria-controls',list.id);name.setAttribute('aria-autocomplete','list');name.placeholder=multi?'Find a mob in the wiki':user?'Type a name to search the wiki, or any name':'Give this place a name';box.hidden=false;list.hidden=spinner.hidden=!user;signedOut.hidden=!!user;if(!user){stop();wanted='';show([]);}else busy(false);};
  box.reset=()=>{stop();wanted='';show([]);};box.dispose=()=>{box.reset();finders.delete(box);};
  finders.add(box);box.update();return box;
 }
 // The credit a wiki's data carries, linking its front page; null for a site not listed.
 function wikiCredit(site,lead='',cls='wiki-credit'){const source=wikiSites[site];return source?externalLink(lead+(source.credit||'Data from '+source.name),source.home||'https://'+source.hosts[0]+'/',cls):null;}
 // A picked NPC pre-fills a new note as the wiki's terms allow: its name (with its level, as the atlas writes levels),
 // its type from the wiki's role, and its short location line as the note. Nothing the visitor typed is replaced,
 // and descriptions, walkthroughs or loot never come in. A "named" NPC is a named mob only when the wiki gives it a level; any other NPC is a notable NPC.
 const roleTypes={merchant:'Vendor',quest:'Quest NPC',mob:'Mob camp'};
 const roleType=row=>isClassTrainer(row)?'Class trainer':roleTypes[row.role]||(row.role==='named'&&row.level?'Named mob':'Notable NPC');
 const levelText=level=>{const v=String(level??'').trim();return v?' ('+(/[-–]/.test(v)?'levels '+v.replace(/\s*[-–]\s*/,'–'):'level '+v)+')':'';};
 const wikiNote=row=>row.location||'';
 let noteFinderReady=false;function attachNoteFinder(){const field=$('wiki-field');if(field&&!noteFinderReady){noteFinderReady=true;noteFields.attachFinder(wikiFinder,row=>{
  const type=roleType(row);if(type&&$('category').value==='Personal'&&[...$('category').options].some(o=>o.value===type)){$('category').value=type;$('category').dispatchEvent(new Event('change'));}
  // A trainer's classes ride with its wiki link, so the note reads "Beastmaster trainer" first like the atlas's own trainers.
  pickClasses(trainerClasses(row));
  if(!$('note').value.trim()&&wikiNote(row))$('note').value=wikiNote(row);guessVendor();});$('editor')?.addEventListener('close',()=>noteFields.root.dispatchEvent(new Event('wiki-done')));}}attachNoteFinder();window.addEventListener('atlas:fields',attachNoteFinder);
 // The Wanted board: NPCs the wiki knows in this map's zone that the map does not mark yet, as bounties to take.
 // Trainers and merchants come first as priority bounties. Taking one starts the pin with a note filled from the wiki
 // that saving claims (sends for review). Signed out, the note can be kept private and claimed after signing in.
 let bountyNext=null;
 // A note placed from a bounty remembers it, so its suggestion carries the bounty (worth 2 points, 3 for priority).
 const bountyKey='mnmaps-bounty-notes';
 const readBounties=()=>{try{const v=JSON.parse(localStorage.getItem(bountyKey)||'{}');return v&&typeof v==='object'&&!Array.isArray(v)?v:{};}catch{return {};}};
 const writeBounties=v=>{try{localStorage.setItem(bountyKey,JSON.stringify(v));}catch{}};
 const looseName=v=>String(v??'').split(/\s+[—–-]\s+|\s*\(/)[0].normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[’'`]/g,'').replace(/[^a-z0-9]+/g,' ').trim().replace(/^(the|a|an) /,'');
 // On the map already: the same wiki id, or our name holding the wiki's ("Paymaster Elara Venn" is "Elara Venn").
 function placedOnMap(row,places){const name=looseName(row.name);return places.some(p=>p.w===row.id||(name.length>=4&&(looseName(p.n)===name||(' '+looseName(p.n)+' ').includes(' '+name+' '))));}
 const bountyGroups=[{key:'trainer',title:'Class trainers',priority:true},{key:'merchant',title:'Merchants',priority:true},{key:'quest',title:'Quest givers'},{key:'named',title:'Named NPCs'}];
 const bountyGroup=row=>isClassTrainer(row)?'trainer':row.role==='merchant'?'merchant':row.role==='quest'?'quest':'named';
 const bountyKind=row=>{const g=bountyGroup(row),classes=trainerClasses(row);return g==='trainer'?'Class trainer'+(classes.length?' · '+classes.join(' / '):''):g==='merchant'?'Merchant':g==='quest'?'Quest giver':'Named';};
 // The list is built when the atlas is published (bounties/<map>.json); this browser keeps it for an hour.
 const wantedKey=id=>'mnmaps-wanted-'+id;
 function keptWanted(id){try{const v=JSON.parse(localStorage.getItem(wantedKey(id))||'null');return v&&Date.now()-v.at<3600000&&Array.isArray(v.rows)?v:null;}catch{return null;}}
 async function wantedList(){
  let file=keptWanted(config.id);
  if(!file){const r=await fetch('bounties/'+encodeURIComponent(config.id)+'.json');if(r.status===404)throw Error('none');if(!r.ok)throw Error('failed');
   const body=await r.json();file={at:Date.now(),site:Object.hasOwn(wikiSites,body?.site)?body.site:'mnm-wiki',rows:(Array.isArray(body?.rows)?body.rows:[]).filter(r=>r&&typeof r.id==='string'&&typeof r.name==='string'&&/^https:\/\/([a-z0-9-]+\.)*monstersandmemories\.wiki\//.test(String(r.url)))};
   try{localStorage.setItem(wantedKey(config.id),JSON.stringify(file));}catch{}}
  // Markers suggested since the list was built are left out too, on this map or one drawn as the same place
  // (Faelindral's platforms above Evershade Weald).
  const here=new Set([config.id,...(config.linkedMaps||[]).map(l=>l.map)]);
  let places=[];try{const index=await (await fetch('data/find-index.json')).json();places=index.filter(p=>here.has(p.m));}catch{places=allMarkers().map(m=>({n:m.name,w:m.wikiId,m:config.id}));}
  // Instructors whose classes already have a class trainer marker or chip on this map are on it too.
  const trained=mapTrainerClasses(allMarkers(),labelData.trainers);
  return {site:file.site,rows:file.rows.filter(r=>!placedOnMap(r,places)&&!trainerOnMap(r,trained))};
 }
 // Bounties claimed (a suggestion waiting for review or publishing): the atlas's own database, plus the claims this
 // device made or was refused (someone else first), kept per map so the board shows them straight away. The database
 // wins on the next answer: a claim refused or deleted since is dropped (one sent in the last minute may not show yet).
 const claimedKey='mnmaps-claimed-bounties';
 const readClaimed=()=>{try{const v=JSON.parse(localStorage.getItem(claimedKey)||'{}');return v&&typeof v==='object'&&!Array.isArray(v)?v:{};}catch{return {};}};
 let lastClaimed={map:null,ids:new Set()};
 function claimedNow(){const ids=new Set(Object.keys(readClaimed()[config?.id]||{}));if(lastClaimed.map===config?.id)for(const id of lastClaimed.ids)ids.add(id);return ids;}
 function markBountyClaimed(mapId,id){const all=readClaimed();all[mapId]={...(all[mapId]||{}),[id]:Date.now()};try{localStorage.setItem(claimedKey,JSON.stringify(all));}catch{}
  if(mapId!==config?.id)return;if($('journal')?.classList.contains('wanted-mode'))renderWanted();else contributeCount();}
 async function claimedBounties(){
  const mapId=config.id,local=readClaimed()[mapId]||{};if(!user)return new Set(Object.keys(local));
  try{const {data,error}=await client.rpc('claimed_bounties',{map_id:mapId});if(error)throw error;
   const ids=new Set((data||[]).map(r=>typeof r==='string'?r:r?.claimed_bounties).filter(Boolean)),all=readClaimed(),mine=all[mapId]||{},now=Date.now();
   for(const id of Object.keys(mine)){if(ids.has(id)||now-mine[id]<60000)ids.add(id);else delete mine[id];}
   all[mapId]=mine;try{localStorage.setItem(claimedKey,JSON.stringify(all));}catch{}lastClaimed={map:mapId,ids};return new Set(ids);}
  catch{return new Set(Object.keys(local));}
 }
 // What a bounty's note starts with: the wiki's name and level, its type, its page and id, a trainer's classes.
 function bountyPrefill(row){const classes=trainerClasses(row),type=roleType(row)||'Personal';
  return {name:row.name+levelText(row.level),category:type,note:'',wiki:row.url,wikiId:row.id,...(type==='Class trainer'&&classes.length?{classes}:{})};}
 const signInToTake=()=>popupSignIn(m=>status(m+' You can also sign in from the top bar.'));
// The reward a bounty earns, in the bounty board's own words (one place to change it).
 const rewardWord='renown';
 async function takeBounty(row,note){
  // Checked again on the click: someone may have claimed it since the board opened.
  if((await claimedBounties()).has(row.id)){markClaimed(note,'Someone just claimed this one');return;}
  bountyNext={id:row.id,priority:!!row.priority};window.atlasPlaceNote?.(bountyPrefill(row));
 }
 // A notice can also be dragged onto the map (mouse, or a short press on touch so the list still scrolls): a pin with
 // the NPC's type follows the pointer and dropping it on the map opens the note there. Where the panel covers the map
 // (phones, embeds) it steps aside while dragging. Escape, or a drop off the map, cancels.
 function bountyDrag(note,row){
  note.addEventListener('pointerdown',e=>{
   if(e.button!==0||e.target.closest('a,button')||note.classList.contains('claimed'))return;
   const touch=e.pointerType!=='mouse',x0=e.clientX,y0=e.clientY,journal=$('journal');let started=false,timer=null,ghost=null;
   const cleanup=()=>{clearTimeout(timer);window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up);window.removeEventListener('pointercancel',cancel);window.removeEventListener('keydown',key,true);ghost?.remove();journal.classList.remove('wanted-dragging');document.body.classList.remove('notice-dragging');};
   const begin=ev=>{if(started)return;started=true;
    const prefill=bountyPrefill(row),face=text('span','');face.style.setProperty('--pin',categories[prefill.category]?.[1]||'#365f59');face.append(markerSymbol({category:prefill.category,name:prefill.name}));
    ghost=text('span','','drag-ghost');ghost.append(face,text('small',row.name));ghost.style.left=ev.clientX+'px';ghost.style.top=ev.clientY+'px';document.body.append(ghost);
    document.body.classList.add('notice-dragging');window.getSelection?.().removeAllRanges();if(compact())journal.classList.add('wanted-dragging');status('Drop the notice where '+row.name+' stands, or press Escape.',true);};
   const move=ev=>{if(!started){if(Math.hypot(ev.clientX-x0,ev.clientY-y0)<(touch?10:6))return;if(touch){cleanup();return;}begin(ev);if(!started)return;}
    if(ghost){ghost.style.left=ev.clientX+'px';ghost.style.top=ev.clientY+'px';}ev.preventDefault();};
   const up=async ev=>{const was=started&&!!ghost;cleanup();if(!was)return;$('status').hidden=true;
    if((await claimedBounties()).has(row.id)){markClaimed(note,'Someone just claimed this one');return;}
    bountyNext={id:row.id,priority:!!row.priority};if(!window.atlasPlaceNoteAt?.(bountyPrefill(row),ev.clientX,ev.clientY)){bountyNext=null;status('Drop it on the map to place it.');}};
   const cancel=()=>{const was=started;cleanup();if(was)$('status').hidden=true;};
   const key=ev=>{if(ev.key==='Escape'&&started){ev.preventDefault();ev.stopPropagation();cancel();}};
   if(touch)timer=setTimeout(()=>begin({clientX:x0,clientY:y0}),350);
   window.addEventListener('pointermove',move,{passive:false});window.addEventListener('pointerup',up);window.addEventListener('pointercancel',cancel);window.addEventListener('keydown',key,true);
  });
 }
 function markClaimed(note,label='Claimed, awaiting review'){note.classList.add('claimed');note.querySelector('.notice-take')?.remove();if(!note.querySelector('.notice-stamp'))note.querySelector('.notice-paper').append(text('span',label,'notice-stamp'));status(label==='Claimed, awaiting review'?label:label+'.');}
 // The notices' paper: the paper texture with a rim cut the same way as the map's own parchment edge (sheet-edge.js):
 // a ragged cut, then a scorched band fading into the paper. Drawn once the texture is in, flat cream until then.
 let paperTexture=null;
 function paperFrame(){
  if(paperFrame.url||typeof sheetFbm!=='function')return paperFrame.url||'';
  const S=128,c=document.createElement('canvas');c.width=c.height=S;const g=c.getContext('2d'),burnt=SHEET.burnt,ready=!!paperTexture?.complete&&paperTexture.naturalWidth>0;
  g.fillStyle='#ece0c2';g.fillRect(0,0,S,S);if(ready)g.drawImage(paperTexture,0,0,S,S,0,0,S,S);
  const img=g.getImageData(0,0,S,S);
  for(let y=0;y<S;y++)for(let x=0;x<S;x++){
   const edge=Math.min(x,y,S-1-x,S-1-y),cut=2+sheetFbm(x/6,y/6,71,3)*6,i=(y*S+x)*4;
   if(edge<cut){img.data[i+3]=0;continue;}
   const burn=Math.max(0,1-(edge-cut)/(6+sheetFbm(x/9,y/9,29,2)*6))**1.6*.85;
   for(let k=0;k<3;k++)img.data[i+k]=Math.round(img.data[i+k]+(burnt[k]-img.data[i+k])*burn);}
  g.putImageData(img,0,0);const url=c.toDataURL('image/png');if(ready)paperFrame.url=url;return url;
 }
 function setPaper(){const frame=paperFrame();if(frame)document.documentElement.style.setProperty('--paper-frame','url('+frame+')');}
 // The Wanted panel takes the Search menu's place, so the map stays in view for dragging notices onto it.
 const tabKey='mnmaps-wanted-tab';
 function closeWanted(){$('journal').classList.remove('wanted-mode');$('wanted-view').hidden=true;}
 // The board is the Monsters and Memories Wiki's own list: only where that wiki may be linked (embed rules).
 const wantedShown=()=>wikiSiteShown('mnm-wiki');
 // A link to an NPC not on the atlas yet (?find=, ?wiki=, a Wanted poster) opens the board on its notice.
 let wantedFocus=null;
 window.atlasOpenBounty=id=>{if(typeof id!=='string'||!wantedShown())return;wantedFocus=id;openWanted();};
 // "Search the atlas" also finds the NPCs on this map's Wanted board, from this browser's copy of the list (read once
 // when a search first needs it). Only where the board shows.
 let wantedFetching=null;
 window.atlasWantedMatches=terms=>{
  if(!config||config.zonesFile||!wantedShown()||!terms.length)return [];
  const kept=keptWanted(config.id);
  if(!kept){if(!wantedFetching){const mapId=config.id;wantedFetching=wantedList().catch(()=>null).then(()=>{wantedFetching=null;if(config?.id===mapId&&$('search').value.trim())refreshSearch();});}return [];}
  const places=originals.map(m=>({n:m.name,w:m.wikiId})),trained=mapTrainerClasses(originals,labelData.trainers),claimed=claimedNow(),keys=terms.map(findKey);
  return kept.rows.filter(r=>!placedOnMap(r,places)&&!trainerOnMap(r,trained)&&keys.every(k=>findKey(r.name).includes(k))).slice(0,20).map(r=>({id:r.id,name:r.name,kind:bountyKind(r),category:bountyPrefill(r).category,claimed:claimed.has(r.id)}));
 };
 function openWanted(){if(desk?.opened&&!desk.close())return;if(!config||config.zonesFile||!wantedShown())return;if(!paperTexture){paperTexture=new Image();paperTexture.onload=setPaper;paperTexture.src='assets/bounty/paper.webp';}setPaper();
  $('journal').classList.add('wanted-mode');$('wanted-view').hidden=false;setPanel(true);renderWanted();}
 async function renderWanted(){
  const view=$('wanted-view'),serial=++renderWanted.serial;view.replaceChildren();
  const head=text('div','','wanted-head');head.append(button('← Search menu',closeWanted,'wanted-back'),button('×',()=>{closeWanted();setPanel(false);},'wanted-close'));head.lastChild.setAttribute('aria-label','Close');
  const zone=searchZone()||config.title,count=text('p','Reading the notices…','board-count');
  view.append(head,text('h2','Wanted','wanted-title'),text('p','Whereabouts sought by the atlas. Find them in the world, mark them on the map.','board-lede'),count);
  if(!user){const tip=text('div','','board-signin');tip.append(text('strong','Did you know? ','wiki-tip-label'),button('Sign in',signInToTake,'wiki-signin'),text('span',' to take bounties and earn '+rewardWord+' and a place in the atlas credits.'));view.append(tip);}
  else myPoints().then(p=>{if(p&&serial===renderWanted.serial)count.after(text('p','Your '+rewardWord+': '+p.points,'board-points'));});
  let found;try{found=await wantedList();}catch(e){if(serial===renderWanted.serial)count.textContent=e.message==='none'?'The wanted list for '+zone+' isn’t available yet.':'The wanted list could not be loaded right now. Please try again later.';return;}
  if(serial!==renderWanted.serial)return;
  const claimed=await claimedBounties();if(serial!==renderWanted.serial)return;
  const {site,rows}=found,open=rows.filter(r=>!claimed.has(r.id)),priority=open.filter(r=>r.priority).length;
  if(!rows.length){count.textContent='No bounties here. Every NPC the wiki knows is on the map.';contributeCount([]);return;}
  // One short line: how many, and how to take one.
  count.textContent=[open.length+' open',priority?priority+' priority':'',matchMedia('(pointer: fine)').matches?'drag a notice onto the map':'tap Take the bounty'].filter(Boolean).join(' · ');count.title=open.length+' bounties open in '+zone;
  // One tab per kind, with its open count; the last one chosen comes back, else the first with bounties (trainers first).
  const groups=bountyGroups.map(g=>({...g,rows:rows.filter(r=>bountyGroup(r)===g.key).sort((a,b)=>claimed.has(a.id)-claimed.has(b.id)||a.name.localeCompare(b.name))})).filter(g=>g.rows.length);
  let chosen;try{chosen=localStorage.getItem(tabKey);}catch{}if(!groups.some(g=>g.key===chosen))chosen=groups[0].key;
  const focus=wantedFocus&&groups.find(g=>g.rows.some(r=>r.id===wantedFocus));if(focus)chosen=focus.key;
  const tabs=text('div','','wanted-tabs'),reward=text('p','','wanted-reward'),list=text('div','','wanted-list');tabs.setAttribute('role','tablist');list.setAttribute('role','tabpanel');
  // A filter over every tab: name, level and kind; each tab counts its matches, an empty tab gives way to one with some.
  const box=text('div','','search-box wanted-search'),filter=document.createElement('input'),clear=button('×',()=>{filter.value='';filter.dispatchEvent(new Event('input'));filter.focus();},'wanted-clear');
  filter.type='search';filter.placeholder='Find a bounty: name, level, kind…';filter.autocomplete='off';filter.setAttribute('aria-label','Find a bounty');clear.setAttribute('aria-label','Clear');clear.hidden=true;
  box.append(text('span','⌕'),filter,clear);box.firstChild.setAttribute('aria-hidden','true');
  const terms=()=>findKey(filter.value).split(' ').filter(Boolean),matches=(row,t)=>{if(!t.length)return true;const hay=findKey([row.name,row.level?'level '+row.level:'',bountyKind(row),row.role].join(' '));return t.every(x=>hay.includes(x));};
  const shown=g=>{const t=terms();return g.rows.filter(r=>matches(r,t));};
  const show=key=>{chosen=key;try{if(!filter.value)localStorage.setItem(tabKey,key);}catch{}const g=groups.find(x=>x.key===key),rows=shown(g);
   for(const t of tabs.children)t.setAttribute('aria-selected',String(t.dataset.key===key));
   reward.textContent='Reward: '+(g.priority?3:2)+' '+rewardWord+' and your name in the atlas credits';
   list.replaceChildren(...rows.map(row=>notice(row,claimed.has(row.id))));
   if(!rows.length)list.append(text('p','No bounty matches “'+filter.value.trim()+'”.','wanted-empty'));list.scrollTop=0;};
  const counts=()=>{for(const t of tabs.children){const g=groups.find(x=>x.key===t.dataset.key),n=shown(g).filter(r=>!claimed.has(r.id)).length;t.lastChild.textContent=String(n);}};
  filter.addEventListener('input',()=>{clear.hidden=!filter.value;counts();const g=groups.find(x=>x.key===chosen);if(!shown(g).length){const other=groups.find(x=>shown(x).length);if(other){show(other.key);return;}}show(chosen);});
  filter.addEventListener('keydown',e=>{if(e.key==='Escape'&&filter.value){e.preventDefault();e.stopPropagation();clear.onclick();}});
  for(const g of groups){const t=button('',()=>show(g.key),'wanted-tab');t.dataset.key=g.key;t.setAttribute('role','tab');t.append(text('span',g.title.replace('Class trainers','Trainers').replace('Quest givers','Quests').replace('Named NPCs','Named')),text('small',String(g.rows.filter(r=>!claimed.has(r.id)).length)));tabs.append(t);}
  view.append(box,tabs,reward,list);
  const credit=wikiCredit(site,'','wiki-credit board-credit');if(credit)view.append(credit);
  show(chosen);contributeCount(open);
  if(focus){const el=[...list.children].find(n=>n.dataset.bounty===wantedFocus);if(el){el.classList.add('notice-focus');el.scrollIntoView({block:'center'});}}wantedFocus=null;
 }
 renderWanted.serial=0;
 // A compact notice: the name (to its wiki page), level and kind, the wiki link and the bounty button. The whole notice
 // is the drag handle; a claimed one is stamped.
 function notice(row,isClaimed){
  const note=text('article','','notice'+(row.priority?' priority':'')),paper=text('div','','notice-paper'),name=text('h4','','notice-name');
  name.append(externalLink(row.name,row.url));paper.append(text('p',row.priority?'Priority bounty · 3 '+rewardWord:'Bounty · 2 '+rewardWord,'notice-tag'));
  paper.append(name,text('p',[row.level?'Level '+row.level:'',bountyKind(row)].filter(Boolean).join(' · '),'notice-meta'));
  const foot=text('div','','notice-foot');foot.append(externalLink('Wiki ↗',row.url,'notice-wiki'));
  if(isClaimed)paper.append(text('span','Claimed, awaiting review','notice-stamp'));else foot.append(button('Take the bounty',()=>takeBounty(row,note),'notice-take primary'));
  paper.append(foot);note.dataset.bounty=row.id;note.append(paper,text('span','','notice-nail'));note.classList.toggle('claimed',isClaimed);bountyDrag(note,row);return note;
 }
 // The Wanted banner shows how many bounties are open once this browser has the list, never fetching it on load.
 function contributeCount(given){const open=$('contribute'),kept=config&&keptWanted(config.id);if(!open)return;
  // The same rows as the board leaves open: not already on the map, by name, wiki page or class trainer chip.
  let rows=given||null;if(!rows&&kept){const places=originals.map(m=>({n:m.name,w:m.wikiId})),trained=mapTrainerClasses(originals,labelData.trainers),claimed=claimedNow();rows=kept.rows.filter(r=>!placedOnMap(r,places)&&!trainerOnMap(r,trained)&&!claimed.has(r.id));}
  const n=rows?rows.length:-1,p=rows?rows.filter(r=>r.priority).length:0,words=text('span','','wanted-text');
  words.append(text('strong','Wanted'),text('span',n>0?n+(n===1?' bounty':' bounties'):'NPCs this map is missing','wanted-count'));if(n>0&&p)words.append(text('span',p+' priority','wanted-count'));
  open.replaceChildren(words,text('span','View bounties →','wanted-cta'));if(n===0)open.hidden=true;}
 {const open=$('contribute');if(open){open.onclick=()=>openWanted();
  // Not on the world map (no notes there); a map change redraws the open board, or closes it on the world map.
  const show=()=>{open.hidden=!config||!!config.zonesFile||!wantedShown();if(config)contributeCount();if(user)offerPrivateBounties();if($('journal').classList.contains('wanted-mode')){if(!config||config.zonesFile)closeWanted();else renderWanted();}};show();window.addEventListener('atlas:loaded',show);}}
 // A bounty's note remembers its bounty as it opens.
 window.addEventListener('atlas:editor-open',e=>{const m=e.detail?.note;if(bountyNext&&m?.wikiId===bountyNext.id){
  const all=readBounties();all[m.id]={bounty:bountyNext.id,priority:bountyNext.priority,map:config.id};writeBounties(all);}bountyNext=null;});
 // Contribution points (approved suggestions: 1, bounty 2, priority bounty 3), from the database; null when unavailable.
 async function myPoints(){if(!user)return null;try{const {data,error}=await client.rpc('my_contribution_points');if(error)throw error;const row=Array.isArray(data)?data[0]:data;return row&&Number.isFinite(row.points)?row:null;}catch{return null;}}
 let labelMoveDraft=null;
 async function editDialog(target,kind){
  if(!user){signInDialog();return;}await loadApproved();const amendments=[...approvedRows,...pendingRows],state=targetState(target,kind),own=!admin&&amendments.filter(r=>r.user_id===user.id&&r.status==='pending'&&!r.reviewed_at&&r.kind===kind&&r.target_id===target.id&&r.map===config.id&&(kind!=='edit-label'||(r.level||null)===(target.level||config.levelId||null))).sort((a,b)=>Number(b.id)-Number(a.id))[0],base=own?window.atlasChanges.applyTo(state?.effective||target,own):state?.effective||target,chip=state?.kind==='chip';
  const d=showDialog('Change “'+base.name+'”',kind==='edit-label');if(kind==='edit-label')d.classList.add('place-change');
  const fields=window.atlasFields.build(d,{value:base,label:kind==='edit-label',chip,building:!!labelData.trainers?.some(t=>t.id===target.id),owner:admin,prefix:'edit',ids:{name:'edit-name',note:'edit-note',wiki:'edit-wiki',category:'edit-type',trade:'edit-trade',classes:'edit-class',vendor:'edit-vendor'},finder:(...args)=>{const f=wikiFinder(...args);d.addEventListener('close',()=>{f.reset();finders.delete(f);},{once:true});return f;}});
  d.addEventListener('close',()=>{fields.dispose();d.classList.remove('place-change','moving-place');},{once:true});
  const why=field(d,'Why (optional)','edit-comment',textBox(2,500,'Tell the cartographers what changed.')),credit=creditBox(d);if(own){why.value=own.comment||'';credit.checked=own.credit===true;}
  let moved=null,movePin=null,start=base.x!==undefined?[base.x,base.y]:null;
  // A name stays on the map while its floating card is open, and can be dragged on touch screens too.
  if(kind==='edit-label'&&start){map.closePopup();const pin=labelPins.get(target.id);if(pin){movePin=pin;pin.dragging?.enable();pin.getElement?.()?.classList.add('change-selected');labelMoveDraft={id:target.id,dialog:d};const drag=()=>{if(alignmentMode)return;const to=pixelsOf(pin.getLatLng());pin.setLatLng?.(locationOf(target));moveDialog(target,kind,to);};pin.on('dragend',drag);d.addEventListener('close',()=>{labelMoveDraft=null;pin.off?.('dragend',drag);if(!alignmentMode)pin.dragging?.disable();pin.setLatLng?.(locationOf({...base,x:target.x,y:target.y}));pin.getElement?.()?.classList.remove('change-selected');},{once:true});}}
  if(kind==='edit-label')fitFloating(d,map.latLngToContainerPoint?.(locationOf(base)));
  if(kind==='edit-label'){d.append(text('p','Drag the name on the map to move it.','form-hint'));if(movePin){const bar=text('div','','place-move-bar'),name=text('strong',base.name),done=button('Done',()=>{d.classList.remove('moving-place');fields.controls.name.focus?.();});bar.append(name,done);d.append(button('Move on the map',()=>{name.textContent=fields.controls.name.value||base.name;d.classList.add('moving-place');map.closePopup();},'place-move-button'),bar);}}
  const actions=text('div','','dialog-actions'),send=sendButton(admin?'Save':'Send for review',async()=>{
   let now;try{now=fields.read();}catch(e){status(e.message);return;}let payload=window.atlasFields.delta(now,window.atlasChanges.nextFrom(state||{effective:base},kind));
   if(Object.keys(payload).length===2&&payload.name===base.name&&!moved){status('Change a field or move the name first.');return;}
   if(Object.keys(payload).length>2||payload.name!==base.name)await saveOwn({kind,target_id:target.id,map:config.id,level:target.level||config.levelId||null,payload,comment:why.value.trim()||null,credit:credit.checked,user_id:user.id,author_name:displayName(user)},amendments);
   if(moved&&start.some((v,i)=>v!==moved[i])){if(!bounded(...moved,config.minZoom)){status('Keep the name inside the map.');return;}await saveOwn({kind:'move-label',target_id:target.id,map:config.id,level:target.level||config.levelId||null,payload:{name:base.name,from:start,to:moved},credit:credit.checked,user_id:user.id,author_name:displayName(user)},amendments);}
   d.close();await loadApproved();freshPopup();status(admin?'Saved: it arrives with the next edition.':'Thanks! Your change is waiting for review.');event('edit-sent');
  },'The change could not be saved. It may have changed since you opened it; open Change again.');
  actions.append(button('✕ It should be removed',()=>removalDialog(target,kind),'community-remove'),button('Cancel',()=>guardClose(d,fields,base,moved)),send);d.append(actions);fields.controls.name.focus?.();
  d.oncancel=e=>{e.preventDefault();guardClose(d,fields,base,moved);};
 }
 function guardClose(d,fields,base,moved=null){let changed;try{const p=window.atlasFields.delta(fields.read(),base);changed=Object.keys(p).length>2||p.name!==base.name||!!moved&&(moved[0]!==base.x||moved[1]!==base.y);}catch{changed=true;}if(!changed||window.confirm('Leave without saving these changes?'))d.close();}
 const removalReasons={duplicate:'A duplicate of another marker',missing:'Not in the game (or no longer)',other:'Something else'};
 function removalDialog(target,kind='edit-marker'){
  if(!user){signInDialog();return;}const amendments=[...approvedRows,...pendingRows],state=targetState(target,kind),base=state?.effective?.name?state.effective:state?.proposed?.name?state.proposed:target;
  // A marker that only exists as a suggestion is not on the map yet: dropping it sets that suggestion aside (or withdraws the author's own).
  const fresh=!state?.published&&state?.rows?.find(r=>r.kind==='new-marker'&&['pending','approved'].includes(r.status));
  if(fresh&&(admin||fresh.user_id===user.id&&fresh.status==='pending'&&!fresh.reviewed_at)){confirmDialog('drop-confirm','Drop “'+(base.name||'this marker')+'”?','It is not on the map yet, so this '+(admin&&fresh.user_id!==user.id?'sets the suggestion aside.':'withdraws the suggestion.'),[['Cancel',()=>{}],['Drop it',async()=>{map.closePopup?.();if(admin){await desk.decideRow(fresh,'rejected','Dropped before publishing');}else{const {error}=await client.from('suggestions').delete().eq('id',fresh.id).eq('status','pending');status(error?'It could not be withdrawn. Please try again.':'Suggestion withdrawn.');}await loadApproved();freshPopup();},'danger']]);return;}
  const d=showDialog('It should be removed'),choice=choiceList(d,'removal-reason',removalReasons),why=field(d,'Details','removal-details',textBox(3,500,'Not in the game any more, or marked twice')),credit=creditBox(d);
  d.append(text('p',(base.name||target.name||'This marker')+' · '+config.title,'form-hint'));
  const actions=text('div','','dialog-actions'),send=sendButton(admin?'Approve removal':'Send for review',async()=>{
   const reason=choice.picked(),details=why.value.trim();if(!reason){status('Choose a reason.');return;}if(reason==='other'&&!details){status('Tell us why it should go.');return;}
   await saveOwn({user_id:user.id,author_name:displayName(user),map:config.id,level:target.level||config.levelId||null,kind,target_id:target.id,payload:{name:base.name,remove:true,reason,from:window.atlasChanges.nextFrom(state||{effective:base},kind)},comment:details||null,credit:credit.checked},amendments);
   d.close();await loadApproved();freshPopup();status(admin?'Removal approved for the next edition.':'Thanks! Your removal request is waiting for review.');event('removal-sent');
  },'The request could not be saved. Please open Change again.');actions.append(button('Cancel',()=>d.close()),send);d.append(actions);
 }
 function suggestSheet(target,kind){
  if(admin){editDialog(target,kind);return;}const d=showDialog('Suggest a change');d.classList.add('suggest-sheet');d.append(text('p',target.name+' · '+config.title,'form-hint'));
  for(const [icon,title,hint,go] of [['✎','Fix the name or details','Name, type, description or wiki page',()=>editDialog(target,kind)],['⚒','It stands somewhere else','Drag it or tap the right spot on the map',()=>moveDialog(target,kind)],['✕','It should be removed','Not in the game any more, or marked twice',()=>removalDialog(target,kind)],['?','Something else','Tell the cartographers what is wrong',()=>reportDialog(target)]]){const b=button('',()=>new Promise(resolve=>{d.addEventListener('close',()=>resolve(go()),{once:true});d.close();}),'suggest-option');b.append(text('i',icon),text('strong',title),text('small',hint));d.append(b);}d.append(button('Cancel',()=>d.close()));d.addEventListener('close',()=>d.classList.remove('suggest-sheet'),{once:true});
 }
 let deferredMove=null;
 function moveDialog(target,kind,destination,values){
  const amendments=[...approvedRows,...pendingRows],state=targetState(target,kind),base=state?.effective||target;map.closePopup();clearPreview();reviewLayer=L.layerGroup().addTo(map);
  const pin=L.marker(locationOf(destination?{...base,x:destination[0],y:destination[1]}:base),{icon:pinIcon({...base,atlasLabel:kind==='edit-label',noteType:kind==='edit-label'?base.kind==='exit'?'exit':'label':undefined,category:base.category||'Personal'}),draggable:true,zIndexOffset:600}).addTo(reviewLayer),bar=text('section','','community-preview move-sheet');bar.id='community-preview';bar.append(text('strong','It stands somewhere else'),text('p','Drag the faded mark, or tap its rightful spot.','form-hint'));$('map-frame').append(bar);
  if(kind==='edit-label'&&labelMoveDraft?.id===target.id){const d=labelMoveDraft.dialog;d.style.visibility='hidden';bar.addEventListener('wiki-done',()=>{d.style.visibility='';d.classList.remove('moving-place');});}
  const why=field(bar,'Why (optional)','move-comment',textBox(2,500,'Tell the cartographers what changed.')),credit=creditBox(bar);if(values){why.value=values.comment;credit.checked=values.credit;}let moveShapes=null;const previewShape=()=>{moveShapes?.remove();if(!base.shape)return;moveShapes=L.layerGroup().addTo(reviewLayer);try{const to=pixelsOf(pin.getLatLng()),shape=window.atlasShapes.translate(base.shape,to[0]-base.x,to[1]-base.y,config);window.atlasShapeUI?.render(base,moveShapes,{old:true});window.atlasShapeUI?.render({...base,shape},moveShapes,{solid:true});}catch(e){status(e.message);}};previewShape();pin.on('dragend',previewShape);const tap=e=>{pin.setLatLng(e.latlng);previewShape();};map.on('click',tap);bar.addEventListener('wiki-done',()=>map.off('click',tap));const actions=text('div','','dialog-actions');actions.append(button('Cancel',()=>{deferredMove=null;clearPreview();}),sendButton(admin?'Save':'Send for review',async()=>{const row=moveSuggestion(target,kind,pixelsOf(pin.getLatLng()));await saveOwn({...row,comment:why.value.trim()||null,credit:credit.checked,user_id:user.id,author_name:displayName(user)},amendments);clearPreview();await loadApproved();status(admin?'Saved for the next edition.':'Thanks! The move is waiting for review.');},'The move could not be saved.',undefined,()=>{deferredMove={target,kind,destination:pixelsOf(pin.getLatLng()),map:scope(),values:{comment:why.value,credit:credit.checked}};}));bar.append(actions);
 }
 function moveSuggestion(target,kind,to){if(!Array.isArray(to)||to.length!==2||!bounded(...to,config.minZoom))throw Error('Keep it inside the map.');const base=targetState(target,kind)?.effective||target;return {kind:kind==='edit-label'?'move-label':'move-marker',target_id:target.id,map:config.id,level:target.level||config.levelId||null,payload:{name:base.name,from:[base.x,base.y],to,...(base.shape?{fromShape:structuredClone(base.shape),shape:window.atlasShapes.translate(base.shape,to[0]-base.x,to[1]-base.y,config)}:{})}};}
 // Repeated saves amend only this account's open row; the original base still protects earlier contributions.
 function newestOnTarget(row,rows){const rules=window.atlasReview;return rows.filter(r=>!r.sourceStatus&&['pending','approved'].includes(r.status)&&rules.target(r)===rules.target(row)&&rules.targetKind(r)===rules.targetKind(row)&&r.map===row.map&&(rules.targetKind(row)!=='label'||(r.level||null)===(row.level||null))).sort((a,b)=>Number(b.id)-Number(a.id))[0];}
 // A desk receipt pairs the saved version with its decision's undo; amendments retain their earlier contents.
 async function saveOwn(row,amendments=[...approvedRows,...pendingRows],{receipt=false}={}){
  const newest=row.target_id?newestOnTarget(row,amendments):null,old=newest&&newest.user_id===user.id&&newest.kind===row.kind&&(admin||newest.status==='pending'&&!newest.reviewed_at)?newest:null;
  if(!old)return receipt?submitRow(row,{receipt}):submit(row);const delta={...row.payload};if(!row.kind.startsWith('move-')&&delta.remove!==true&&delta.name===delta.from?.name)delete delta.name;let payload={...old.payload,...delta,from:row.kind.startsWith('move-')?old.payload.from:{...row.payload.from,...old.payload.from},...(row.kind==='move-marker'&&old.payload.fromShape?{fromShape:old.payload.fromShape}:{})};
  payload=window.atlasFields.stored(row.kind,payload);if(row.payload.remove!==true){delete payload.remove;delete payload.reason;}if(payloadBytes(payload)>=4096)throw Object.assign(Error('Too long'),{code:'too-long'});
  let q=client.from('suggestions').update({payload,status:admin?'approved':'pending',comment:row.comment??old.comment,credit:row.credit??old.credit,...(admin?{reviewed_at:new Date().toISOString()}:{})}).eq('id',old.id).eq('user_id',user.id).eq('status',old.status);if(!admin)q=q.is('reviewed_at',null);const {data,error}=await version(q,old).select('*');if(error||!data?.length)throw error||Error('Changed since opened');await loadApproved();const saved=normaliseSuggestion(data[0]);window.atlasNotices?.sent(saved);return receipt?{row:saved,before:old,published:admin}:true;
 }
 const editButton=(target,kind)=>button('Change',()=>suggestSheet(target,kind),'community-edit','edit');
 const sharedToken=m=>scope()+':'+m.id;
 // Deleting a note that carries a suggestion withdraws it: a pending, unreviewed one (the author's right), or an
 // approved one not live yet when an admin deletes it. Then a bounty is open again. One already accepted for a
 // normal user, or published, stays (and says so); if withdrawing fails, the claim stays too.
 const withdrawnLine=b=>b?'This also withdraws your bounty claim.':'This also withdraws your suggestion.';
 function deleteNotice(m){if(!user||!m||!readFollowed()[followId(m)])return null;return withdrawnLine(readBounties()[m.id]);}
 function unmarkBountyClaimed(mapId,id){const all=readClaimed();if(all[mapId]){delete all[mapId][id];try{localStorage.setItem(claimedKey,JSON.stringify(all));}catch{}}
  if(lastClaimed.map===mapId)lastClaimed.ids.delete(id);if(mapId!==config?.id)return;if($('journal')?.classList.contains('wanted-mode'))renderWanted();else contributeCount();}
 async function withdrawNote(m){
  if(!user||!m)return;const key=followId(m),rec=readFollowed()[key];if(!rec)return;
  const b=readBounties()[m.id],what=b?'bounty claim':'suggestion';
  const forget=()=>{const all=readFollowed();delete all[key];writeFollowed(all);const bs=readBounties();delete bs[m.id];writeBounties(bs);};
  try{
   const {data:row,error}=await client.from('suggestions').select('status,reviewed_at').eq('id',rec.id).maybeSingle();if(error)throw error;
   // Gone already, or refused: nothing to withdraw, and a bounty is open again.
   if(!row||row.status==='rejected'){forget();if(b)unmarkBountyClaimed(b.map||config.id,b.bounty);return;}
   if(!(row.status==='pending'&&!row.reviewed_at)&&!(admin&&row.status==='approved')){
    // Accepted (approved or live) stays on the map; one already looked at (sent back by the publishing job) waits for its review.
    forget();status(row.status==='pending'?'Note deleted. Your '+what+' is already being reviewed, so it could not be withdrawn.':'Your '+(b?'claim':'suggestion')+' was already accepted, so the marker stays on the public map.',true);return;}
   const {data:done,error:refused}=await client.from('suggestions').delete().eq('id',rec.id).select('id');if(refused)throw refused;if(!done?.length)throw Error('not withdrawn');
   forget();loadApproved();if(b)unmarkBountyClaimed(b.map||config.id,b.bounty);status('Note deleted, and your '+what+' was withdrawn.');event('suggestion-withdrawn');
  }catch{status('Note deleted, but your '+what+' could not be withdrawn: it is still waiting for review.',true);}
 }
 window.addEventListener('atlas:note-deleted',e=>{withdrawNote(e.detail?.note);});
 function ledger(target,kind,n){
  const t=targetState(target,kind),rows=t?.rows.filter(r=>['pending','approved'].includes(r.status)&&!approvedLive(r))||[],box=text('div','','change-ledger');
  // The name it will carry once these go live, under the title where a vendor's own name sits.
  {const next=t?.proposed?.name,now=target.name;if(rows.some(r=>r.fields.has('name'))&&next&&next!==now){const h=n.querySelector?.('h3'),line=text('p','','marker-who next-name');line.append(text('span',next),text('small',' · '+(rows.some(r=>r.fields.has('name')&&r.status==='pending')?'waiting for review':'approved, not live yet')));if(h?.after)h.after(line);}}
  if(rows.length){box.append(text('h4','Changes on their way'));for(const r of rows){const pn=r.payload?.name,fields=[...r.fields].map(k=>k==='name'&&pn?'renamed to “'+pn+'”':k==='added'&&pn?'charted as “'+pn+'”':k==='type'&&r.payload?.category?'type changed to '+r.payload.category:({shape:'reshaped',position:'moved',note:'description updated',removed:'removal',type:'type changed',added:'charted'}[k]||k+' changed')),line=text('div','','ledger-change');line.append(text('i',r.fields.has('position')?'⚒':r.fields.has('removed')?'✕':'✎'),text('strong',fields.join(' · ')||'Details checked'),text('small','by '+(r.author_name||'a traveller')+' · '+new Date(r.created_at||r.reviewed_at||Date.now()).toLocaleString()));line.append(text('span',r.status==='approved'?'approved':'waiting for review','change-state '+r.status));box.append(line);}}
  const key=(kind==='edit-label'?'label':'marker')+':'+target.id,published=mapCredits[key+(kind==='edit-label'&&(target.level||config.levelId)?'#'+(target.level||config.levelId):'')]||mapCredits[key]||[];
  if(published.length)box.append(text('p',creditWords(published)+'.','contributors-line'));
  const actions=text('div','','change-actions');actions.append(editButton(target,kind));const row=rows.find(r=>r.status==='pending')||rows[0];if(admin&&row&&!row.sourceStatus){const open=rows.filter(r=>['pending','approved'].includes(r.status)).length;actions.append(button('Review'+(open>1?' ('+open+')':''),()=>{map.closePopup();desk.open(row);}));}actions.append(button('✕ Remove',()=>removalDialog(target,kind),'community-remove'));box.append(actions);n.append(box);
 }
 function creditWords(rows){const groups=new Map();for(const c of rows){const verb=c.what==='added'?'charted':c.what==='moved'?'moved':c.what==='reshaped'?'reshaped':'improved';if(!groups.has(verb))groups.set(verb,[]);groups.get(verb).push(c.name||null);}return [...groups].map(([verb,names],i)=>{const known=[...new Set(names.filter(Boolean))],unknown=names.filter(n=>!n).length,who=known.length>2?known.slice(0,2).join(', ')+' and '+(known.length===3?'a traveller':(known.length-2)+' travellers'):known.join(' and ');return (i?verb:verb[0].toUpperCase()+verb.slice(1))+' by '+who+(unknown?(who?' and ':'')+(unknown>1?'other travellers':'a traveller'):'');}).join(' · ');}
 window.atlasCommunity={filtersChanged:()=>{drawSuggestedShapes();desk.drawShapes();},deleteNotice,userId:()=>user?.id||null,move:moveDialog,offerPositions,hoverState(m){const t=targetState(m,'edit-marker');return t&&{rows:t.rows.filter(r=>['pending','approved'].includes(r.status)&&!approvedLive(r)),proposed:t.proposed};},change(target,kind){if(!user)return false;editDialog(target,kind);return true;},isAdmin:()=>admin,reviewOpen:()=>desk.opened,reviewCurrent:token=>desk.currentPreview(token),reviewLabel:()=>desk.opened&&desk.selected?.kind.endsWith('label')?desk.selected.target_id:null,leaveReview:token=>desk.leaveMap(token)&&allowLeave(),closeReview:()=>desk.opened?desk.close():null,afterPositions:go=>{if(dialog.open)dialog.addEventListener('close',go,{once:true});else go();},report:reportDialog,fields:window.atlasFields,refresh:loadApproved,popup(m,n){
  if(m.atlasLabel){ledger(m,'edit-label',n);return;}if(m.id.startsWith('personal-')){if(alignmentMode)return;const shared=readSet(sharedKey).has(sharedToken(m));if(!config.zonesFile)n.append(shared?text('p','Shared for review','moved-note'):button('Share with everyone',()=>shareNote(m),'','share'));return;}ledger(m,'edit-marker',n);
 },placePopup(p,n){if(!['label','exit','building','district'].includes(p.kind))return;const target=labelData.labels.find(l=>l.id===p.id)||changeSet().get('label:'+p.id)?.published||p;ledger(target,'edit-label',n);},chipPopup(p,n){ledger(p,'edit-marker',n);}};
 function movedItems(){
  const sent=readSet(sentKey),rows=[];
  for(const [kind,items,saved,positions] of [['edit-marker',originals,alignmentPositions,publishedPositions],['edit-label',labelData.labels,alignmentLabelPositions,publishedLabelPositions]])for(const m of items){
   const from=positions.get(m.id),to=saved[m.id];if(!from||!Array.isArray(to)||to.length!==2||!bounded(...to,config.minZoom)||from.every((v,i)=>v===to[i]))continue;
   const token=JSON.stringify([scope(),m.level||config.levelId||'',kind==='edit-label'?'move-label':'move-marker',m.id,...to]);if(sent.has(token))continue;
   rows.push({token,name:m.name,...moveSuggestion(m,kind,to)});
  }return rows;
 }
 let deferredPositions=null;const positionSigninKey='mnmaps-offer-positions-on-signin',positionVisits=new Set();
 function offerPositions(){const rows=movedItems();if(!rows.length)return;
  const d=showDialog('You moved '+rows.length+' places on this map in this browser');d.append(text('p','Public places now keep their published positions. Your saved moves are kept until you choose to put them back.'));
  const list=text('ul','');for(const row of rows)list.append(text('li',row.name));d.append(list);if(!user)d.append(text('p','Sign in to send these moves for review.'));
  const actions=text('div','','dialog-actions');if(user)actions.append(button('Send them for review',()=>{d.close();sendDialog('Suggest positions',rows,false);}));
  actions.append(button('Put them back',()=>{try{localStorage.setItem(storageKey('alignment'),'{}');localStorage.setItem(storageKey('label-alignment'),'{}');alignmentPositions={};alignmentLabelPositions={};if(editSnapshot){editSnapshot.positions={};editSnapshot.labels={};}updateAlignmentStatus();d.close();}catch{status('Your browser could not clear these positions. Please try again.',true);}}),button('Later',()=>d.close()));d.append(actions);return true;
 }
 function notePayload(m){m=normaliseMarker(m);
  const payload={x:m.x,y:m.y,name:m.name,category:m.category,note:m.note,...markerExtras(m)};if(m.noteType==='exit'&&!payload.travel)payload.travel=travelKind(m.name,'',m.travel)||'Exit';
  const bounty=readBounties()[m.id];if(bounty&&m.wikiId===bounty.bounty){payload.bounty=bounty.bounty;if(bounty.priority)payload.priority=true;}
  return payload;
 }
 function shareNote(m){
  sendDialog('Share a personal note',[{token:sharedToken(m),name:m.name,map:config.id,level:m.level||config.levelId||null,kind:'new-marker',target_id:null,payload:notePayload(m),note_id:m.id}],true);
 }
 // Being credited is opt-in: the Discord name goes into the public contributors list once a suggestion is published.
 const creditKey='mnmaps-community-credit';
 function creditBox(d){
  const row=text('label','','community-check'),box=document.createElement('input');box.type='checkbox';
  try{box.checked=localStorage.getItem(creditKey)==='true';}catch{box.checked=false;}
  box.onchange=()=>{try{localStorage.setItem(creditKey,String(box.checked));}catch{}};
  row.append(box,text('span','Credit me as a contributor'));d.append(row,text('p','Your Discord name is then listed publicly in About once a suggestion is published.','form-hint'));return box;
 }
 // An admin's own suggestion is approved as soon as it is saved. It is still an ordinary pending insert followed by
 // the same approval the review page does, so the database rules decide: only an account in admins can approve.
 async function submit(row){return (await submitRow(row)).published;}
 // The publishing job refuses a suggestion of 4 KB or more (in UTF-8): refused here first, with a clear message.
 const payloadBytes=v=>encodeURIComponent(JSON.stringify(v)).replace(/%[0-9A-F]{2}/g,'x').length;
 async function submitRow(row,{receipt=false}={}){row={...row,payload:window.atlasFields.stored(row.kind,row.payload)};
  if(payloadBytes(row.payload)>=4096)throw Object.assign(Error('Too long'),{code:'too-long'});
  const {data,error}=await client.from('suggestions').insert(row).select(receipt?'*':'id').single();if(error)throw error;
  const id=data?.id??null,inserted=receipt&&data?normaliseSuggestion(data):null,finish=async(published,saved=inserted)=>{await loadApproved();if(receipt)window.atlasNotices?.sent(saved);else await sentUndo(id);return {id,published,...(receipt?{row:saved}:{})};};if(!admin||id==null)return finish(false);
  let q=client.from('suggestions').update({status:'approved',reviewed_at:new Date().toISOString(),review_note:'Approved on sending (admin)'}).eq('id',data.id).eq('status','pending');if(receipt)q=version(q,inserted);const {data:done,error:fail}=await q.select(receipt?'*':'id');
  if(fail||!done?.length){status('Saved, but it could not be approved here; approve it at the Review desk.');return finish(false);}
  return finish(true,receipt?normaliseSuggestion(done[0]):null);
 }
 const sentLine=published=>published?'Approved: it goes live with the next publishing run.':null;
 // The note form can suggest a note for the public map as it is saved, through the same path as Share with everyone:
 // the same suggestion, the visitor's usual credit choice, the same limits. The note is saved whatever happens.
 const suggestKey='mnmaps-suggest-on-save';
 {const row=$('suggest-on-save'),check=$('suggest-check'),credit=$('suggest-credit');
  if(row&&check&&credit){row.hidden=false;
   try{check.checked=localStorage.getItem(suggestKey)==='true';credit.checked=localStorage.getItem(creditKey)==='true';}catch{}
   const showCredit=()=>{credit.parentElement.hidden=!check.checked;};showCredit();
   check.addEventListener('change',()=>{try{localStorage.setItem(suggestKey,String(check.checked));}catch{}showCredit();
    // Signed out, ticking it opens the sign-in window; the form stays open.
    if(check.checked&&!user)popupSignIn(message=>status(message+' You can also sign in from the top bar.'));});
   credit.addEventListener('change',()=>{try{localStorage.setItem(creditKey,String(credit.checked));}catch{}});
   // Hidden for notes already shared; shown again for the next one.
   window.addEventListener('atlas:editor-open',e=>{const m=e.detail?.note;row.hidden=!!m&&readSet(sharedKey).has(sharedToken(m));});
   window.addEventListener('atlas:note-saved',e=>{const m=e.detail?.note;if(!m)return;
    // A note already suggested from here follows its suggestion, whether it was edited or only moved.
    const rec=user&&readFollowed()[followId(m)];if(rec){followNote(m,rec);return;}
    if(!e.detail.moved&&bountyOf(m)){if(privateSave){privateSave=false;status('Saved as a private note. Sign in to claim the bounty.');}else if(user)claimBounty(m,credit.checked);return;}
    if(e.detail.moved||row.hidden||!check.checked)return;
    if(!user){status('Saved to your field notes. Sign in to suggest it for the public map.');return;}suggestOnSave(m,credit.checked);});
  }}
 // A note placed from a bounty is always shared: saving claims the bounty. Its wiki facts are shown, not edited (only
 // Notes, the position and the floor are the finder's own), except the class of a trainer the wiki gives none for.
 // Signed out, the main button signs in and then claims; "Save as a private note" keeps it on this device.
 const bountyOf=m=>{const b=m&&readBounties()[m.id];return b&&m.wikiId===b.bounty&&!readSet(sharedKey).has(sharedToken(m))?b:null;};
 let bountyForm=null,claimAfterSignIn=false,privateSave=false;
 function setBountyForm(m){
  const form=$('marker-form'),b=bountyOf(m),save=$('save-note'),keep=$('save-private'),line=$('bounty-claim-line'),check=$('suggest-check'),credit=$('suggest-credit'),row=$('suggest-on-save');
  bountyForm=b?{note:m,...b}:null;form.classList.toggle('bounty-mode',!!b);$('bounty-facts')?.remove();
  if(save)save.textContent=b?(user?'Claim the bounty':'Sign in to claim'):'Save note';if(keep)keep.hidden=!b||!!user;if(line)line.hidden=!b;
  if(check)check.parentElement.hidden=!!b;
  if(!b){if(credit&&check)credit.parentElement.hidden=!check.checked;return;}
  row.hidden=false;credit.parentElement.hidden=false;$('editor-title').textContent='Claim a bounty';
  const classes=pickedClasses(),facts=text('div','','bounty-facts');facts.id='bounty-facts';const list=document.createElement('dl');
  const fact=(term,value)=>{list.append(text('dt',term));const dd=document.createElement('dd');dd.append(value);list.append(dd);};
  const category=$('category').value,page=externalLink($('wiki').value.replace(/^https:\/\//,''),$('wiki').value);
  fact('Name',$('name').value);fact('Show as','Marker');fact('Category',category+(category==='Class trainer'&&classes.length?' · '+classes.join(' / '):''));fact('Wiki page',page);facts.append(list);
  // A trainer the wiki gives no class for: the finder says which, or the marker could not be placed right.
  if(category==='Class trainer'&&!classes.length){const field=text('div','','field'),label=text('label','Class'),pick=document.createElement('select');label.htmlFor=pick.id='bounty-class';pick.required=true;
   fillSelect(pick,[['Choose the class they teach',''],...atlasClasses.map(c=>[c,c])]);pick.onchange=()=>pickClasses(pick.value?[pick.value]:[]);field.append(label,pick);facts.append(field);}
  facts.append(text('p','From the wiki. Add what you saw in Notes.','form-hint'));form.querySelector('.form-head').after(facts);
 }
 window.addEventListener('atlas:editor-open',e=>{claimAfterSignIn=false;privateSave=false;setBountyForm(e.detail?.note);});
 {const save=$('save-note'),keep=$('save-private');
  // Signed out, the main button opens the sign-in window and keeps the form; the claim goes once the account is in.
  save?.addEventListener('click',e=>{if(!bountyForm||user)return;e.preventDefault();if(!$('marker-form').reportValidity())return;claimAfterSignIn=true;popupSignIn(m=>{claimAfterSignIn=false;status(m+' You can also sign in from the top bar.');});});
  if(keep)keep.onclick=()=>{privateSave=true;$('marker-form').requestSubmit();if($('editor').open)privateSave=false;};}
 async function claimBounty(m,credited,quiet=false){
  const b=readBounties()[m.id];if(!b)return 'failed';
  try{const published=await sendNote(m,credited);remember(sharedKey,[sharedToken(m)]);markBountyClaimed(b.map||config.id,b.bounty);freshPopup();event('suggestion-sent');
   if(!quiet)status(sentLine(published)||'Bounty claimed: your marker is waiting for review.');return 'claimed';}
  catch(e){
   if(e?.code==='23505'){markBountyClaimed(b.map||config.id,b.bounty);if(!quiet)status('Someone claimed this bounty first. Your note stays in your private field notes.',true);return 'taken';}
   if(!quiet)claimFailed(m,credited,e);return 'failed';}
 }
 // A claim that did not go through leaves the note private, says why, and can be tried again.
 function claimFailed(m,credited,e){
  const d=showDialog('The bounty was not claimed');
  d.append(text('p',turnedOff(e)?'Your account can no longer send suggestions. Your note is kept in your private field notes.':'The claim did not go through. Your note is kept in your private field notes; you can try again now or later from its popup.'));
  const actions=text('div','','dialog-actions');actions.append(button('Keep it private',()=>d.close()));
  if(!turnedOff(e))actions.append(button('Try again',()=>{d.close();claimBounty(m,credited);},'primary'));d.append(actions);
 }
 // After signing in: the claim asked for from the open form goes at once; bounties placed while signed out are offered
 // once (per note) to claim.
 function afterSignIn(){if(deferredMove){const queued=deferredMove;deferredMove=null;if(queued.map===scope()){if(dialog.open)dialog.close();moveDialog(queued.target,queued.kind,queued.destination,queued.values);return;}}let resume=false;try{resume=localStorage.getItem(positionSigninKey)===scope();if(resume)localStorage.removeItem(positionSigninKey);}catch{}if(deferredPositions){const queued=deferredPositions;deferredPositions=null;sendDialog(queued.title,queued.rows,false);return;}
  if(claimAfterSignIn&&bountyForm&&$('editor').open){claimAfterSignIn=false;setBountyForm(bountyForm.note);$('marker-form').requestSubmit();return;}
  claimAfterSignIn=false;if(resume&&movedItems().length){offerPositions();return;}offerPrivateBounties();
 }
 const offeredKey='mnmaps-offered-bounties';
 async function offerPrivateBounties(){
  if(!user||!config||config.zonesFile||!map||$('editor').open||offerPrivateBounties.busy||!wikiSiteShown('mnm-wiki'))return;
  const offered=readSet(offeredKey),notes=personal.filter(m=>{const b=bountyOf(m);return b&&(b.map||config.id)===config.id&&!offered.has(sharedToken(m))&&!readFollowed()[followId(m)];});
  if(!notes.length)return;remember(offeredKey,notes.map(sharedToken));
  const d=showDialog('Claim your bounties?');d.append(text('p','You placed '+notes.length+(notes.length===1?' bounty':' bounties')+' on '+config.title+' while signed out. Claim '+(notes.length===1?'it':'them')+' now?'));
  const list=document.createElement('ul');for(const m of notes)list.append(text('li',m.name));d.append(list);const credit=creditBox(d);
  const actions=text('div','','dialog-actions'),go=button('Claim '+(notes.length===1?'it':'them'),async()=>{
   go.disabled=true;offerPrivateBounties.busy=true;const taken=[],failed=[];let claimed=0;
   try{const already=await claimedBounties();
    for(const m of notes){const b=bountyOf(m);if(!b)continue;if(already.has(b.bounty)){markBountyClaimed(config.id,b.bounty);taken.push(m.name);continue;}
     const result=await claimBounty(m,credit.checked,true);if(result==='claimed')claimed++;else if(result==='taken')taken.push(m.name);else failed.push(m.name);}}
   finally{offerPrivateBounties.busy=false;}
   d.close();status([claimed?'Claimed '+claimed+(claimed===1?' bounty.':' bounties.'):'',taken.length?'Already claimed by someone else (kept as private notes): '+taken.join(', ')+'.':'',failed.length?'Not sent, try again from the note’s popup: '+failed.join(', ')+'.':''].filter(Boolean).join(' '),true);
  },'primary');actions.append(button('Not now',()=>d.close()),go);d.append(actions);
 }
 // A note suggested from the form remembers its suggestion, so a later edit or move of the note follows it: while the
 // suggestion waits for review it is updated in place (or, where that is not allowed, sent again); once approved, the
 // change goes as an ordinary move or edit of the marker it becomes. A refused suggestion is no longer followed.
 const followKey='mnmaps-suggested-notes';
 const readFollowed=()=>{try{const v=JSON.parse(localStorage.getItem(followKey)||'{}');return v&&typeof v==='object'&&!Array.isArray(v)?v:{};}catch{return {};}};
 const writeFollowed=v=>{try{localStorage.setItem(followKey,JSON.stringify(v));}catch{}};
 const followId=m=>user.id+':'+scope()+':'+m.id;
 async function sendNote(m,credited){
  const payload=notePayload(m),{id,published}=await submitRow({map:config.id,level:m.level||config.levelId||null,kind:'new-marker',target_id:null,payload,note_id:m.id,user_id:user.id,author_name:displayName(user),comment:null,credit:credited});
  if(id!=null){const all=readFollowed();all[followId(m)]={id,sent:payload,credit:credited};writeFollowed(all);}
  return published;
 }
 async function suggestOnSave(m,credited){
  if(readSet(sharedKey).has(sharedToken(m)))return;
  try{const published=await sendNote(m,credited);remember(sharedKey,[sharedToken(m)]);freshPopup();status(sentLine(published)||'Saved, and suggested for the public map: it is waiting for review.');event('suggestion-sent');}
  catch(e){status(e?.code==='23505'?'Someone just claimed this bounty. Your note is kept in your field notes.':'Saved to your field notes. '+sendError(e,'The suggestion did not go through: you can send it from the note’s popup with Share with everyone.'));}
 }
 async function followNote(m,rec){
  const payload=notePayload(m),key=followId(m),same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);if(same(payload,normaliseMarker(rec.sent)))return;
  const keep=()=>{const all=readFollowed();all[key]={...rec,sent:payload};writeFollowed(all);};
  try{
   const {data:row,error}=await client.from('suggestions').select('status,payload,reviewed_at,review_note').eq('id',rec.id).maybeSingle();if(error)throw error;
   if(row?.status==='pending'){
    // Its author may change it only until it has been looked at (the database's rule; an admin always may). After that
    // the change stays in the note: sending it again would only make a duplicate.
    if(admin||(!row.reviewed_at&&!row.review_note)){const {data:done,error:refused}=await client.from('suggestions').update({payload:window.atlasFields.stored('new-marker',payload),...(admin?{status:'approved',reviewed_at:new Date().toISOString()}:{})}).eq('id',rec.id).eq('status','pending').select('*');
     if(!refused&&done?.length){window.atlasNotices?.sent(normaliseSuggestion(done[0]));keep();status('Saved, and your suggestion was updated.');loadApproved();return;}}
    status('Saved to your field notes. Your suggestion is already being reviewed, so this change was not added to it.',true);return;
   }
   if(row?.status==='approved'||row?.status==='published'){
    // The marker it becomes is community-<suggestion id>; place names and exits live with the labels. What changed since
    // this note last sent is sent as a move and an edit of it, from what is live (else what was approved, a reviewer's
    // changes included), so the publishing job's checks see the text and spot it really shows.
    const old=normaliseMarker(rec.sent),label=payload.noteType==='label'||payload.noteType==='exit',target='community-'+rec.id,base={user_id:user.id,author_name:displayName(user),map:config.id,level:m.level||config.levelId||null,target_id:target,comment:null,credit:!!rec.credit};
    const live=(label?labelData.labels:originals).find(x=>x.id===target),shown={...old,...row.payload,...(live?{name:live.name,note:live.note||'',wiki:live.wiki||'',x:live.x,y:live.y,shape:live.shape}:{})};
    let sent=false;
    const reshaped=!label&&JSON.stringify(old.shape??null)!==JSON.stringify(payload.shape??null);
    if(!reshaped&&(old.x!==payload.x||old.y!==payload.y)){await submit({...base,kind:label?'move-label':'move-marker',payload:{name:payload.name,from:[shown.x,shown.y],to:[payload.x,payload.y]}});sent=true;}
    if(reshaped){await submit({...base,kind:'edit-marker',payload:{name:payload.name,shape:payload.shape||null,from:{name:shown.name,shape:shown.shape||null}}});sent=true;}
    const wikiOf=p=>label?{}:{wiki:p.wiki||'',...(p.wiki&&p.wikiId?{wikiId:p.wikiId}:{})};
    if(old.name!==payload.name||(old.note||'')!==(payload.note||'')||(!label&&(old.wiki||'')!==(payload.wiki||''))){
     await submit({...base,kind:label?'edit-label':'edit-marker',payload:{name:payload.name,note:payload.note||'',...wikiOf(payload),from:{name:shown.name,note:shown.note||'',...(label?{}:{wiki:shown.wiki||''})}}});sent=true;}
    // A marker's type, trade, class, kind, Sells tags or colour (an exit's arrow or map) cannot follow it once approved.
    const fixed=(label?['arrow','toMap']:['category','trade','classes','vendor','sells','color']).some(k=>JSON.stringify(old[k]??null)!==JSON.stringify(payload[k]??null));
    keep();
    if(fixed)status((sent?'Saved, and the move or text change was sent for review. ':'Saved to your field notes. ')+'A type, kind, class or Sells change cannot follow an approved suggestion: once it is live, use Report a problem on it.',true);
    else if(sent)status('Saved, and the change was sent for review.');
    return;
   }
   const all=readFollowed();delete all[key];writeFollowed(all);
  }catch(e){status('Saved to your field notes, but your suggestion could not be updated. '+sendError(e,'You can share the note again from its popup.'));}
 }
 // A shared note that is now a public marker is not kept as a second, personal copy: once its marker is live the note
 // is retired, and text of its own that the marker does not carry moves to the private "Your note" on that marker.
 // The note is found by the id its suggestion keeps, by this browser's record of the share, or (older shares) by the
 // same name and wiki page close to where it was suggested or now stands. Waiting or refused shares keep their note.
 async function retirePublishedNotes(serial){
  if(!user||!notesReadable||!privateNotesReadable||alignmentMode||!personal.length)return;
  const uid=user.id,{data,error}=await client.from('suggestions').select('id,level,payload,note_id').eq('user_id',uid).eq('map',config.id).eq('kind','new-marker').in('status',['approved','published']);
  if(error||!Array.isArray(data)||serial!==mapSerial||user?.id!==uid)return;
  const near=0.015*Math.max(config.width,config.height),followed=readFollowed(),taken=new Set(),retired=[];let moved=0;
  for(const row of data){
   const p=row.payload||{},label=p.noteType==='label'||p.noteType==='exit',live=(label?labelData.labels:originals).find(x=>x.id==='community-'+row.id);if(!live)continue;
   const free=personal.filter(m=>!taken.has(m.id)&&(m.level||'')===(row.level||'')),close=m=>[[p.x,p.y],[live.x,live.y]].some(([x,y])=>Number.isFinite(x)&&Number.isFinite(y)&&Math.hypot(x-m.x,y-m.y)<=near);
   const note=free.find(m=>m.id===row.note_id)||free.find(m=>followed[followId(m)]?.id===row.id)
    ||free.find(m=>looseName(m.name)===looseName(p.name)&&(!m.wikiId||!p.wikiId||m.wikiId===p.wikiId)&&close(m));
   if(!note)continue;
   const own=String(note.note||'').trim();
   if(own&&own!==String(live.note||'').trim()){const kind=label?'label':'marker',was=privateNoteFor(live,kind),next=!was?own:was.includes(own)?was:was+'\n\n'+own;
    if(next.length>1000||!savePrivateNote(live,kind,next))continue;if(next!==was)moved++;}
   taken.add(note.id);retired.push(note);
  }
  if(!retired.length||serial!==mapSerial||!persist(personal.filter(m=>!taken.has(m.id))))return;
  const all=readFollowed();for(const m of retired)delete all[followId(m)];writeFollowed(all);
  setupCategoryControls();buildPlaceIndex();drawMarkers();
  status((retired.length===1?'Your note “'+retired[0].name+'” is now on the public map, so it is no longer kept twice.':retired.length+' of your notes are now on the public map, so they are no longer kept twice.')+(moved?' Your own text is kept as “Your note” on '+(moved===1?'its marker.':'their markers.'):''),true);
 }
 function sendDialog(title,rows,sharing){if(!user&&!sharing){deferredPositions={title,rows};try{localStorage.setItem(positionSigninKey,scope());}catch{}signInDialog();return;}
  const amendments=[...approvedRows,...pendingRows],d=showDialog(title);d.append(text('p',sharing?'Send this note for review before it appears in the community atlas.':'Choose the saved moves to send for review.'));
  const list=text('div','','community-choices'),checks=[];
  for(const row of rows){const label=text('label',''),check=document.createElement('input');check.type='checkbox';check.checked=true;label.append(check,text('span',row.name));list.append(label);checks.push(check);}d.append(list);
  const comment=field(d,'Optional comment','suggestion-comment',textBox(3,500)),credit=creditBox(d);
  const actions=text('div','','dialog-actions'),send=button(user?(admin?'Save':'Send for review'):'Sign in with Discord',async()=>{
   if(!user){await signIn();return;}const selected=rows.filter((_,i)=>checks[i].checked&&!checks[i].disabled);if(!selected.length){status('Choose at least one item.');return;}
   send.disabled=true;let done=0;
   try{
    // Separate inserts: partial success is remembered.
    let published=0;for(const row of selected){const {token,name,...suggestion}=row;if(!sharing){const target=(suggestion.kind==='move-label'?labelData.labels:originals).find(m=>m.id===suggestion.target_id);if(!target)throw Error('This place is no longer published.');Object.assign(suggestion,moveSuggestion(target,suggestion.kind==='move-label'?'edit-label':'edit-marker',suggestion.payload.to));}if(await saveOwn({...suggestion,user_id:user.id,author_name:displayName(user),comment:comment.value.trim()||null,credit:credit.checked},amendments))published++;remember(sharing?sharedKey:sentKey,[token]);checks[rows.indexOf(row)].disabled=true;checks[rows.indexOf(row)].checked=false;done++;}
    if(done){freshPopup();d.close();status(sentLine(published===done)||'Thanks! Your suggestion is waiting for review.');}
   }catch(e){status(sendError(e,'Some suggestions could not be sent; unsent items remain selected.')+' Your local notes and positions are safe.');freshPopup();}
   finally{if(done)event('suggestion-sent');send.disabled=false;}
  },'primary');actions.append(button('Not now',()=>{d.close();}),send);d.append(actions);
 }
 // Ids present at the last successful sync tell a deleted note from a new one on the other side.
 const baseKey=(uid,key)=>'mnmaps-community-synced-'+uid+'-'+key;
 // The last synced copy of each note (older browsers kept only the ids): a side that still matches it did not change the note since.
 const noteSum=m=>JSON.stringify(Object.keys(m).sort().map(k=>[k,m[k]]));
 function readBase(uid,key){try{const v=JSON.parse(localStorage.getItem(baseKey(uid,key))||'null');return Array.isArray(v)?new Map(v.map(id=>[id,null])):v&&typeof v==='object'?new Map(Object.entries(v)):null;}catch{return null;}}
 function writeBase(uid,key,notes){try{localStorage.setItem(baseKey(uid,key),JSON.stringify(Object.fromEntries(notes.map(m=>[m.id,noteSum(m)]))));}catch{}}
 function syncIdentity(){return user?user.id+':'+scope():'';}
 function scheduleSync(){
  if(syncing||!user||!config||syncReady!==syncIdentity())return;
  const job={uid:user.id,map:scope(),notes:personal.map(m=>({...m}))};syncJobs.set(job.uid+':'+job.map,job);clearTimeout(syncTimer);syncTimer=setTimeout(()=>pushJobs(),2000);
 }
 const privateScope=()=>scope()+'#private';
 function mergePrivateEntries(local,remote,uid){if(!Array.isArray(remote)||!remote.every(m=>validPrivate(m)&&m.owner===uid))throw Error('Private notes could not be read.');const merged=new Map();for(const m of [...remote,...local]){const old=merged.get(m.id);if(!old||m.updated>old.updated)merged.set(m.id,m);}return [...merged.values()];}
 function schedulePrivateSync(){
  if(syncing||!user||!config||privateSyncReady!==syncIdentity())return;
  const job={uid:user.id,map:privateScope(),notes:privateNotes.filter(m=>m.owner===user.id).map(m=>({...m}))};if(job.map.length>160||payloadBytes(job.notes)>=1000000){quiet('Private notes could not sync. Your local notes are safe.');return;}
  syncJobs.set(job.uid+':'+job.map,job);clearTimeout(syncTimer);syncTimer=setTimeout(()=>pushJobs(),2000);
 }
 async function syncPrivateNotes(serial,push=true){
  if(!user||!map||loading||alignmentMode||!privateNotesReadable)return;const uid=user.id,key=privateScope(),identity=syncIdentity();privateSyncReady='';
  try{if(key.length>160)throw Error();const {data,error}=await client.from('user_notes').select('notes').eq('user_id',uid).eq('map',key).maybeSingle();if(error)throw error;if(serial!==mapSerial||user?.id!==uid||key!==privateScope()||alignmentMode)return;
   const remote=data?.notes||[];
   // Tombstones and timestamps travel with entries, so an offline deletion beats an older remote note.
   const merged=mergePrivateEntries(privateNotes.filter(m=>m.owner===uid||m.owner===null).map(m=>({...m,owner:uid})),remote,uid);
   syncing=true;const saved=persistPrivate([...privateNotes.filter(m=>m.owner!==uid&&m.owner!==null),...merged]);syncing=false;if(!saved)return;
   privateSyncReady=identity;recoverPrivateTargets();schedulePrivateSync();if(push)await pushJobs();
  }catch{syncing=false;quiet('Private notes could not sync. Your local notes are safe.');}
 }
 let pushing=false;
 async function pushJobs(){
  if(pushing)return;pushing=true;let failed=false,progressed=false;
  try{for(const [key,job] of syncJobs){if(user?.id!==job.uid){syncJobs.delete(key);continue;}if(job.map===scope()&&syncReady!==syncIdentity()||job.map===privateScope()&&privateSyncReady!==syncIdentity())continue;
   try{let notes=job.notes;if(job.map.endsWith('#private')){const {data,error}=await client.from('user_notes').select('notes').eq('user_id',job.uid).eq('map',job.map).maybeSingle();if(error)throw error;
     const here=user?.id===job.uid&&job.map===privateScope();notes=mergePrivateEntries(here?privateNotes.filter(m=>m.owner===job.uid):notes,data?.notes||[],job.uid);if(payloadBytes(notes)>=1000000)throw Error();
     if(here){syncing=true;const saved=persistPrivate([...privateNotes.filter(m=>m.owner!==job.uid),...notes]);syncing=false;if(!saved)throw Error();}}
    const {error}=await client.from('user_notes').upsert({user_id:job.uid,map:job.map,notes,updated_at:new Date().toISOString()},{onConflict:'user_id,map'});if(error)throw error;writeBase(job.uid,job.map,notes);if(syncJobs.get(key)===job)syncJobs.delete(key);progressed=true;quiet('Notes synced.');}
   catch{failed=true;quiet('Notes could not sync. Your local notes are safe.');}
  }}finally{pushing=false;if(progressed&&!failed&&syncJobs.size){clearTimeout(syncTimer);syncTimer=setTimeout(()=>pushJobs(),2000);}}
 }
 async function syncNotes(serial){
  if(!user||!map||loading||alignmentMode)return;const uid=user.id,key=scope(),identity=uid+':'+key;syncReady='';
  try{const {data,error}=await client.from('user_notes').select('notes').eq('user_id',uid).eq('map',key).maybeSingle();if(error)throw error;if(serial!==mapSerial||user?.id!==uid||key!==scope()||alignmentMode)return;
   const notes=data?.notes||[];if(!Array.isArray(notes)||notes.length>2000||!notes.every(valid))throw Error();const remote=notes.map(normaliseMarker);
   // A note on one side only was either added there (keep it) or deleted on the other side since the last sync (drop it).
   const base=readBase(uid,key),localIds=new Set(personal.map(m=>m.id)),remoteIds=new Set(remote.map(m=>m.id)),merged=new Map();
   for(const m of remote)if(localIds.has(m.id)||!base?.has(m.id))merged.set(m.id,m);
   // On both sides: a copy unchanged since the last sync gives way to the other side's edit.
   for(const m of personal)if(remoteIds.has(m.id)||!base?.has(m.id)){const there=merged.get(m.id),was=base?.get(m.id);if(there&&was&&noteSum(m)===was&&noteSum(there)!==was)continue;merged.set(m.id,m);}
   if(merged.size>2000)throw Error();
   syncing=true;const saved=persist([...merged.values()]);syncing=false;if(!saved)return;
   syncReady=identity;setupCategoryControls();buildPlaceIndex();drawMarkers();scheduleSync();await pushJobs();
  }catch{syncing=false;quiet('Notes could not sync. Your local notes are safe.');}
 }
 async function syncMapNotes(serial){await syncPrivateNotes(serial,false);if(serial===mapSerial)await syncNotes(serial);}
 async function onMap(){
  if(!map||loading)return;const serial=++mapSerial;syncReady='';privateSyncReady='';clearPreview();desk.mapChanged();
  map.off?.('zoomend',zoomApproved);map.on?.('zoomend',zoomApproved);loadApproved();await syncMapNotes(serial);if(serial!==mapSerial)return;await retirePublishedNotes(serial).catch(()=>{});if(serial!==mapSerial)return;if(!positionVisits.has(scope())&&!dialog.open&&!desk.opened&&offerPositions())positionVisits.add(scope());
 }
 // Suggestions on the map before they are live. Approved ones wait for the publishing run: admins see them all, and each
 // author their own (the read policy already lets authors read their rows). Admins also see those waiting for review,
 // with a soft glow. Each is drawn like the marker it will be, faded: a new marker where it will stand, a move at its
 // new spot with a dotted line from the current one, an edit tagged as such. Each goes once its change is live.
 // Suggestions close together (or naming the same NPC), and ones repeating a marker already on the map, are flagged
 // as possible duplicates, with a jump between them.
 let approvedLayer=null,approvedRows=[],pendingRows=[],rejectedRows=[],approvedSerial=0,mapCredits={},publishedMapLabels=[],loadedSignature='';const suggestionPins=new Map(),creditsCache=new Map();
 function zoomApproved(){if(changeSet().targets().some(t=>t.kind==='label'||t.proposed?.shape||t.published?.shape))drawApproved();}
 async function creditsForMap(){const key=config.id,edition=loadSerial;let entry=creditsCache.get(key);if(!entry||!entry.missing&&entry.edition!==edition){entry={edition,missing:false};entry.read=fetch('data/credits/'+key+'.json').then(r=>{if(r.status===404){entry.missing=true;return {};}return r.ok?r.json():{};}).catch(()=>({}));creditsCache.set(key,entry);}return entry.read;}
 const approvedKey='mnmaps-show-approved',pendingKey='mnmaps-show-pending',rejectedKey='mnmaps-show-rejected';
 // Rejected suggestions stay in the database and never go live; admins see the ones rejected since the site was last
 // published, crossed out, until the next update. The published time is the site files' Last-Modified (as the update
 // check reads it); without it, the last day.
 async function publishedSince(){
  try{const r=await fetch('site.webmanifest',{method:'HEAD',cache:'no-store'}),stamp=r.ok&&Date.parse(r.headers.get('last-modified')||'');if(Number.isFinite(stamp))return new Date(stamp).toISOString();}catch{}
  return new Date(Date.now()-24*3600000).toISOString();
 }
 const shownSetting=key=>{try{return localStorage.getItem(key)!=='false';}catch{return true;}};
 function approvedLive(row){const p=row.payload||{},t=changeSet().forRow(row.id),live=t?.published;
  if(row.kind==='new-marker')return !!live||!!row.sourceStatus&&t?.effective.removed===true;if(p.remove===true)return !live;if(!live)return false;
  const next=window.atlasChanges.applyTo(live,row);return [...window.atlasChanges.fieldsOf(row)].every(f=>f==='position'?next.x===live.x&&next.y===live.y:f==='type'?['category','trade','classes','vendor','sells'].every(k=>JSON.stringify(next[k])===JSON.stringify(live[k])):f==='wiki'?next.wiki===live.wiki&&next.wikiId===live.wikiId:JSON.stringify(next[f])===JSON.stringify(live[f]));}
 const drawable=r=>['new-marker','move-marker','edit-marker','move-label','edit-label'].includes(r.kind);
 function suggestionAt(row){const t=changeSet().forRow(row.id),p=t?.proposed;return Number.isFinite(p?.x)&&Number.isFinite(p?.y)?[p.x,p.y]:null;}
 // Possible duplicates of a new marker: other suggestions within 15 map units or naming the same NPC, and markers
 // already on the map with the same wiki page or name.
 function duplicatesOf(row){
  if(row.kind!=='new-marker')return [];const p=row.payload||{},at=suggestionAt(row),key=looseName(p.name),found=[];
  // A kind of NPC ("A reagent vendor") stands in many places: by name it only matches close by.
  const generic=/^(a|an)\s/i.test(String(p.name||'').trim());
  for(const other of [...pendingRows,...approvedRows]){if(other.id===row.id||other.kind!=='new-marker')continue;const q=other.payload||{},there=suggestionAt(other);
   const gap=at&&there?Math.hypot(at[0]-there[0],at[1]-there[1]):Infinity,near=gap<=15,same=(p.wikiId&&p.wikiId===q.wikiId)||(key.length>=4&&key===looseName(q.name)&&(!generic||gap<=60));
   if(near||same)found.push({row:other,name:q.name,why:same?'same NPC':'close by',state:other.status==='approved'?'approved':'waiting',author:other.author_name,sameAuthor:!!row.user_id&&other.user_id===row.user_id});}
  for(const m of originals){const gap=at?Math.hypot(at[0]-m.x,at[1]-m.y):Infinity;if((p.wikiId&&m.wikiId===p.wikiId)||(key.length>=4&&looseName(m.name)===key&&(!generic||gap<=60)))found.push({marker:m,name:m.name,why:p.wikiId&&m.wikiId===p.wikiId?'same wiki page':'same name',state:'on the map'});}
  return found;}
 function duplicateList(row,onPick){
  const found=duplicatesOf(row);if(!found.length)return null;const box=text('div','','duplicate-box');box.append(text('strong','Possible duplicate'+(found.length>1?'s':'')));
  // Who sent each one, so two from the same person stand out (markers already on the map have no author here).
  for(const d of found){const by=d.row?' · '+(d.sameAuthor?'by the same person':'by '+(d.author||'a Discord member')):'';box.append(button(d.name+' · '+d.state+by+' ('+d.why+')',()=>onPick(d),'duplicate-jump'));}return box;}
 function jumpTo(d){map.closePopup();if(d.marker){choose(d.marker);return;}const pin=suggestionPins.get(d.row.id);if(pin){map.setView(pin.getLatLng(),Math.max(map.getZoom(),config.defaultView.placeZoom));pin.openPopup();}else preview(d.row,loadApproved,loadApproved,null,true);}
 function overlayToggle(id,key,label,count,after){
  let section=$(id);if(!count){section?.remove();return;}
  if(!section){section=text('section','','approved-controls');section.id=id;const l=text('label',''),box=document.createElement('input');box.type='checkbox';
   box.onchange=()=>{try{localStorage.setItem(key,String(box.checked));}catch{}drawApproved();};l.append(box,text('span',''));section.append(l);(after()||$('hidden-controls'))?.after(section);}
  section.querySelector('input').checked=shownSetting(key);section.querySelector('span').textContent=' '+label+' ('+count+')';}
 async function loadApproved(){
  const serial=++approvedSerial;let approved=[],pending=[],rejected=[],published=[];
  if(user&&config&&!config.zonesFile){
   const read=async(state,since)=>{let q=client.from('suggestions').select('*').eq('status',state).eq('map',config.id);if(since)q=q.gte(state==='published'?'updated_at':'reviewed_at',since).order(state==='published'?'updated_at':'reviewed_at',{ascending:false}).order('id',{ascending:false});let {data,error}=await q.limit(500);if(error&&state==='published'&&since&&/updated_at/.test(error.message||error.details||'')){({data,error}=await client.from('suggestions').select('*').eq('status',state).eq('map',config.id).gte('reviewed_at',since).order('reviewed_at',{ascending:false}).order('id',{ascending:false}).limit(500));}if(error)throw error;return Array.isArray(data)?data.map(normaliseSuggestion):[];};
   // The reads run side by side: the review desk waits on this after every decision.
   const since=await publishedSince(),gone=admin?read('rejected',since).catch(()=>[]):null;
   try{[approved,pending,published]=await Promise.all([read('approved'),read('pending'),read('published',since)]);}catch{}
   if(gone)rejected=await gone;}
  let labels=[];try{const source=(config.levels||[]).filter(l=>l.labelsFile&&l.labelsFile!==config.labelsFile);labels=(await Promise.all(source.map(async l=>{const data=await fetchData(l.labelsFile,{labels:[]});return (data.labels||[]).map(p=>({...p,level:p.level||l.id}));}))).flat();}catch{}
  const credits=await creditsForMap();if(serial!==approvedSerial)return;const signature=JSON.stringify([mapSerial,loadSerial,originals,labelData,approved,pending,rejected,published,labels,credits]);currentReviewSet=null;window.atlasNotices?.refresh();if(signature===loadedSignature){freshPopup();return;}loadedSignature=signature;mapCredits=credits;publishedMapLabels=labels;approvedRows=[...approved,...published];pendingRows=pending;rejectedRows=rejected;cachedChanges=null;approvedRows=[...approved,...published.filter(r=>!approvedLive(r)).map(r=>({...r,status:'approved',sourceStatus:'published'}))];cachedChanges=null;drawApproved();freshPopup();
 }
 let suggestedShapeLayer=null;
 function drawSuggestedShapes(){suggestedShapeLayer?.remove();suggestedShapeLayer=null;if(!map||!config)return;const visible=new Set([...(shownSetting(approvedKey)?approvedRows:[]),...(shownSetting(pendingKey)?pendingRows:[])].filter(r=>drawable(r)&&!approvedLive(r)).map(r=>String(r.id)));for(const t of changeSet().targets()){const rows=t.rows.filter(r=>visible.has(String(r.id))),proposed=t.proposed;if(t.kind==='label'||!rows.length||rows.some(r=>desk.hides(r))||config.levels&&proposed.level&&proposed.level!==config.levelId||!(proposed.shape||t.published?.shape)||!enabled.has(proposed.category)||!showPins||(proposed.minZoom??-Infinity)>map.getZoom())continue;try{suggestedShapeLayer||=L.layerGroup().addTo(map);const look={...proposed,id:t.id};if(t.published?.shape&&(t.changed.has('shape')||t.changed.has('position')))window.atlasShapeUI?.render(t.published,suggestedShapeLayer,{old:true});window.atlasShapeUI?.render(look,suggestedShapeLayer,{solid:true,click:()=>L.popup().setLatLng(locationOf(look)).setContent(suggestionPopup(rows[0],look)).openOn(map),state:()=>({rows,proposed})});}catch(error){for(const row of rows)desk.rowError(row,error);}}}
 function drawApproved(){
  if(map&&config&&typeof drawMarkerShapes==='function')drawMarkerShapes();
  approvedLayer?.remove();approvedLayer=null;suggestionPins.clear();const ready=map&&config;
  const approved=ready?approvedRows.filter(r=>drawable(r)&&!approvedLive(r)):[],pending=ready?pendingRows.filter(r=>drawable(r)&&!approvedLive(r)):[],rejected=ready&&admin?rejectedRows.filter(drawable):[];
  overlayToggle('approved-controls',approvedKey,'Show approved, not live yet',approved.length,()=>null);overlayToggle('pending-controls',pendingKey,'Show waiting for review',pending.length,()=>$('approved-controls'));overlayToggle('rejected-controls',rejectedKey,'Show rejected, until the next update',rejected.length,()=>$('pending-controls')||$('approved-controls'));
  if(!ready)return;const visible=new Set([...(shownSetting(approvedKey)?approved:[]),...(shownSetting(pendingKey)?pending:[])].map(r=>String(r.id)));approvedLayer=L.layerGroup().addTo(map);
  for(const t of changeSet().targets()){try{
   const rows=t.rows.filter(r=>visible.has(String(r.id)));if(!rows.length||rows.some(r=>desk.hides(r)))continue;const proposed=t.proposed;if(config.levels&&proposed.level&&proposed.level!==config.levelId)continue;if(!Number.isFinite(proposed.x)||!Number.isFinite(proposed.y))continue;
   const at=locationOf(proposed),look={...proposed,id:t.id,...(t.kind==='label'?{category:'Personal',atlasLabel:true,noteType:proposed.kind==='exit'?'exit':'label'}:{})},waiting=rows.filter(r=>r.status==='pending').length,words=[...t.changed].map(k=>({position:'moved',name:'renamed',note:'details',removed:'removal',type:'type changed',added:'new'}[k]||k)).join(' · '),plate=[words,waiting?waiting+' waiting':'approved'].filter(Boolean).join(' · ');
   if(t.published&&t.changed.has('position'))approvedLayer.addLayer(L.polyline([locationOf(t.published),at],{color:'#e2b46a',weight:2,dashArray:'3 6',interactive:false}));
   const ownPopup=()=>suggestionPopup(rows[0],look);
   // A pending pin standing on its own spot (a new marker or a move) opens like a marker; one sitting on the live marker leaves its clicks to it.
   const apart=!t.published||t.changed.has('position')||t.changed.has('added');
   const pin=L.marker(at,{icon:pinIcon(look),zIndexOffset:-500,interactive:apart,keyboard:apart,label:plate+' ('+(waiting?'waiting for review':'approved, not live yet')+'): '+proposed.name}).bindPopup(ownPopup);bindMarkerTooltip(pin,look);pin.on('add',()=>{const el=pin.getElement();el?.classList.add('combined-ghost');if(apart)el?.classList.add('apart');});approvedLayer.addLayer(pin);
   // Only the offset plate is clickable. The faded face cannot intercept the real marker's clicks or drags.
   const face=button(plate,()=>pin.openPopup(),'change-plate');const anchor=L.marker(at,{icon:L.divIcon({className:'change-plate-anchor',html:face,iconSize:[0,0],iconAnchor:[-32,-18]}),interactive:true,keyboard:true,zIndexOffset:-400});bindMarkerTooltip(anchor,look,undefined,[50,-23],face);approvedLayer.addLayer(anchor);for(const r of t.rows)suggestionPins.set(r.id,pin);
  }catch(error){for(const row of t.rows)desk.rowError(row,error);}}
  if(shownSetting(rejectedKey))for(const row of rejected){try{if(desk.hides(row))continue;const at=suggestionAt(row)||[row.payload.x,row.payload.y];if(!at.every(Number.isFinite))continue;const pin=L.marker(locationOf({x:at[0],y:at[1]}),{icon:pinIcon({...row.payload,category:row.payload.category||'Personal'}),zIndexOffset:-600,label:'Set aside (rejected): '+row.payload.name}).bindPopup(()=>approvedPopup(row,'Set aside'));pin.on('add',()=>pin.getElement()?.classList.add('rejected-pin'));approvedLayer.addLayer(pin);suggestionPins.set(row.id,pin);}catch(error){desk.rowError(row,error);}}
  drawSuggestedShapes();desk.drawPins();
 }
 function suggestionPopup(row,look){const t=changeSet().forRow(row.id),real=originals.find(m=>m.id===(t?.id||look.id)),n=t?.kind==='label'&&typeof placePopup==='function'?placePopup({...t.published||look,id:t.id}):popup(real||look);const dup=duplicateList(row,jumpTo);if(dup)n.append(dup);return n;}
 function reviewPrivateNote(row,n){if(row.map!==config.id)return;const t=reviewTarget(row);if(t?.published)privateNoteLine(t.published,t.kind==='label'?'label':'marker',n);}
 function approvedPopup(row,tag){
  const p=row.payload||{},waiting=row.status==='pending',refused=row.status==='rejected',n=text('div','');n.append(text('div',tag+' · '+(refused?'rejected':waiting?'waiting for review':'approved, not live yet'),'tag'),text('h3',p.name||''));if(p.note&&row.kind!=='move-marker'&&p.remove!==true)n.append(text('p',p.note));
  if(p.remove===true)n.append(text('p','Removal'+(removalReasons[p.reason]?': '+removalReasons[p.reason]:'')+(row.comment?'. “'+row.comment+'”':''),'reported-reason'));
  reviewPrivateNote(row,n);
  n.append(text('p',refused?'Rejected'+(row.reviewed_at?' '+new Date(row.reviewed_at).toLocaleString():'')+'. Sent by '+(row.author_name||'a Discord member')+'.':waiting?'Sent by '+(row.author_name||'a Discord member')+', waiting for review.':'Approved: it goes live with the next publishing run, within the hour. Sent by '+(row.author_name||'a Discord member')+'.','moved-note'));
  if(refused&&row.review_note)n.append(text('p','Review note: '+row.review_note,'reported-reason'));
  const dups=duplicateList(row,jumpTo);if(dups)n.append(dups);
  if(admin&&refused){const actions=text('div','','popup-actions'),back=button('Back to waiting',()=>{map.closePopup?.();return reviewAction(row,'pending','',n);});actions.append(back);n.append(actions);}
  else if(admin){const actions=text('div','','popup-actions'),edit=button(waiting?'Edit and review':'Edit',()=>{map.closePopup();preview(row,loadApproved,loadApproved,null,true);},'','edit');actionIcon(edit);actions.append(edit);n.append(actions);}
  else if(row.user_id===user?.id)n.append(text('p','Your suggestion. Thank you!','community-note'));
  return n;}
 async function authChanged(session){
  const next=session?.user||null;if(next?.id===user?.id)return;
  const serial=++authSerial;user=next;admin=false;syncReady='';privateSyncReady='';accountUI();for(const f of finders)f.update();desk.close(true);if(!user&&dialog.open)dialog.close();clearPreview();freshPopup();
  if(user){const uid=user.id;try{const {data,error}=await client.from('admins').select('user_id').eq('user_id',uid).maybeSingle();if(error)throw error;if(serial!==authSerial)return;admin=!!data;accountUI();}catch{status('Account permissions could not load. Please try again.');}}
  if(serial===authSerial)await onMap();
  if(serial===authSerial){connectNotices();if(user)afterSignIn();}
 }
 function clearPreview(){previewLeave=()=>true;reviewLayer?.remove();reviewLayer=null;const bar=$('community-preview');bar?.dispatchEvent(new Event('wiki-done'));bar?.remove();}
 // Publish now starts one run of the publishing job, after a batch of approvals; it shows once the function is set up.
 const publishUrl=()=>settings.supabaseUrl.replace(/\/$/,'')+'/functions/v1/publish-now';
 function publishButton(){
  const b=button('Publish now',async()=>{
   b.disabled=true;
   try{const {data}=await client.auth.getSession(),token=data?.session?.access_token;if(!token)throw Error();
    const r=await fetch(publishUrl(),{method:'POST',headers:{apikey:settings.supabaseKey,Authorization:'Bearer '+token}}),out=await r.json().catch(()=>({}));
    status(out.queued?'Queued after the current run.':out.started?'Publishing started: approved changes go live in a few minutes.':out.running?'A publishing run is already going; new approvals need another run.':'Publishing could not start. Please try again.');}
   catch{status('Publishing could not start. Please try again.');}
   finally{b.disabled=false;}
  },'primary');
  b.hidden=true;fetch(publishUrl()+'?check=1',{headers:{apikey:settings.supabaseKey}}).then(r=>r.json()).then(d=>{b.hidden=!d?.configured;}).catch(()=>{});
  return b;
 }
 function openReview(){return desk.open();}
 // A banned account can still use the atlas and its notes, but cannot send suggestions or reports.
 function banDialog(row,again){
  const name=row.author_name||'Discord member',d=showDialog('Ban '+name+' from suggestions?');
  d.append(text('p','They can still use the atlas and their notes, but can no longer send suggestions or reports. All their suggestions waiting for review are dismissed.'),text('p','You can lift the ban later under Banned authors.','form-hint'));
  const actions=text('div','','dialog-actions'),go=button('Ban and dismiss',async()=>{
   go.disabled=true;
   try{let {error}=await client.from('banned').insert({user_id:row.user_id,author_name:name});if(error&&error.code!=='23505')throw error;
    ({error}=await client.from('suggestions').update({status:'rejected',reviewed_at:new Date().toISOString(),review_note:'Author banned'}).eq('user_id',row.user_id).eq('status','pending'));if(error)throw error;
    d.close();status(name+' is banned; their waiting suggestions were dismissed.');again();loadApproved();countWaiting();}
   catch{go.disabled=false;status('The ban could not be saved. Please try again.');}
  },'danger');
  actions.append(button('Cancel',()=>d.close()),go);d.append(actions);
 }
 async function bannedList(content,serial,again){
  const {data,error}=await client.from('banned').select('user_id,author_name,banned_at').order('banned_at',{ascending:false});if(error)throw error;if(serial!==reviewSerial||!data.length)return;
  const section=text('section','','review-banned');section.append(text('h3','Banned authors'));
  for(const row of data){const line=text('div','','review-banned-row');line.append(text('span',(row.author_name||'Discord member')+' · since '+new Date(row.banned_at).toLocaleDateString()),button('Lift ban',async()=>{const {error}=await client.from('banned').delete().eq('user_id',row.user_id);if(error){status('The ban could not be lifted. Please try again.');return;}status((row.author_name||'This account')+' can send suggestions again.');again();}));section.append(line);}
  content.append(section);
 }
 // Reports close as fixed or dismissed; other suggestions are approved for publishing or rejected.
 const kinds={'move-marker':'Moved marker','move-label':'Moved label','new-marker':'New marker','edit-marker':'Edited marker','edit-label':'Edited place name',report:'Problem report'};
 function version(q,row){return row.updated_at?q.eq('updated_at',row.updated_at):q;}
 async function reviewAction(row,state,note,card,payload,done){if(await desk.decideRow(row,state,note))done?.();}
 async function preview(row){return desk.open(row);}
 desk=window.createReviewDesk({client,isAdmin:()=>admin,getUser:()=>user,normalise:normaliseSuggestion,target:reviewTarget,locations:reviewLocations,places:reviewPlaces,loadApproved,countWaiting,publishButton,bannedList,banDialog,wikiFinder,finders,version,payloadBytes,reasons,removalReasons,nextSerial:()=>++reviewSerial,drawApproved,popup:suggestionPopup,privateNote:reviewPrivateNote,ownEdit:(row,payload,amendments)=>{let credit=false;try{credit=localStorage.getItem(creditKey)==='true';}catch{}return saveOwn({kind:(reviewTarget(row)?.kind||window.atlasReview.targetKind(row))==='label'?'edit-label':'edit-marker',target_id:window.atlasReview.target(row),map:row.map,level:row.level||null,user_id:user.id,author_name:displayName(user),credit,payload},amendments,{receipt:true});}});
 connectNotices();accountUI();client.auth.onAuthStateChange((eventName,session)=>{setTimeout(()=>authChanged(session).catch(()=>status('Account could not refresh. Your local notes are safe.')),0);});
 client.auth.getSession().then(({data,error})=>{if(error)throw error;return authChanged(data.session);}).catch(()=>status('Account could not load. Your local notes are safe.'));
 window.addEventListener('atlas:loaded',()=>{for(const f of finders)f.reset();onMap().catch(()=>status('Community data could not load.'));});
 window.addEventListener('atlas:private-notes',schedulePrivateSync);window.addEventListener('atlas:notes',scheduleSync);window.addEventListener('atlas:positions',offerPositions);
 window.addEventListener('atlas:published',()=>{creditsCache.clear();if(!loading)loadApproved();});
 window.addEventListener('resize',()=>{if(dialog.open&&dialog.classList.contains('place-change'))fitFloating(dialog);});
 window.addEventListener('focus',()=>{if(!loading){reviewMaps.clear();loadApproved();if(admin)countWaiting();if(desk.opened)desk.refresh();}});window.addEventListener('atlas:editing',drawApproved);
 window.addEventListener('atlas:edit-ended',()=>{drawApproved();if(user&&(syncReady!==syncIdentity()||privateSyncReady!==syncIdentity()))syncMapNotes(mapSerial);});
 window.addEventListener('online',()=>{pushJobs();if(user&&map&&!loading&&(syncReady!==syncIdentity()||privateSyncReady!==syncIdentity()))syncMapNotes(mapSerial);});
 document.addEventListener('visibilitychange',()=>{if(document.hidden)pushJobs();});
 if(map&&!loading)onMap();
})();
