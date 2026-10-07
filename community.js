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
 // Account lives in the top bar: a Sign in / avatar button that opens a small menu.
 const accountBox=text('div','','account'),accountButton=text('button','','account-button'),account=text('div','','account-menu');
 accountButton.type='button';accountButton.setAttribute('aria-haspopup','true');accountButton.setAttribute('aria-expanded','false');account.id='account-menu';account.hidden=true;accountButton.setAttribute('aria-controls',account.id);
 accountBox.append(accountButton,account);$('toggle-panel').after(accountBox);
 const notesLine=document.querySelector('.journal-bottom>.backup').previousElementSibling;
 const syncLine=text('p','','community-sync');syncLine.setAttribute('role','status');syncLine.setAttribute('aria-live','polite');
 const reviewButton=button('Review suggestions',()=>{closeAccount();openReview();}),reviewCount=text('span','','account-badge');reviewCount.hidden=true;reviewButton.append(reviewCount);
 const dialog=text('dialog','','community-dialog');dialog.id='community-dialog';dialog.setAttribute('aria-labelledby','community-title');document.body.append(dialog);
 const review=text('dialog','','community-review');review.id='community-review';review.setAttribute('aria-labelledby','review-title');document.body.append(review);
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
   account.append(head,syncLine);if(admin)account.append(reviewButton);
   account.append(button('Sign out',()=>{closeAccount();signOut();}),text('hr'),button('Delete my account…',()=>{closeAccount();deleteDialog();},'account-delete'));
  }
  else account.append(text('p','Sign in with Discord to keep your notes on every device, report problems and suggest fixes.'),button('Sign in with Discord',signIn,'primary'));
  notesLine.textContent=user?'Your notes sync to your account.':'Notes stay in this browser; sign in to sync them.';
  if(admin&&!account.hidden)countWaiting();
 }
 function openAccount(){account.hidden=false;accountBox.classList.add('open');accountButton.setAttribute('aria-expanded','true');if(admin)countWaiting();account.querySelector('button')?.focus({preventScroll:true});}
 function closeAccount(refocus){if(account.hidden)return;account.hidden=true;accountBox.classList.remove('open');accountButton.setAttribute('aria-expanded','false');if(refocus)accountButton.focus({preventScroll:true});}
 accountButton.onclick=()=>account.hidden?openAccount():closeAccount(false);
 account.addEventListener('keydown',e=>{if(e.key==='Escape'){e.stopPropagation();closeAccount(true);}});
 document.addEventListener('pointerdown',e=>{if(!accountBox.contains(e.target))closeAccount(false);});
 accountBox.addEventListener('focusout',e=>{if(e.relatedTarget&&!accountBox.contains(e.relatedTarget))closeAccount(false);});
 // Waiting suggestions on every map, shown beside Review suggestions.
 async function countWaiting(){
  try{const {count,error}=await client.from('suggestions').select('id',{count:'exact',head:true}).eq('status','pending');if(error)throw error;reviewCount.textContent=count>99?'99+':String(count||'');reviewCount.hidden=!count;}catch{reviewCount.hidden=true;}
 }
 $('about-community').textContent='Optional Discord sign-in stores your Discord name and id, your suggestions and reports and, if you sign in, your notes, so they follow you between devices. Delete my account removes all of it.';$('about-community').hidden=false;
 $('editor').querySelector('.form-hint').textContent='Saved on this device. Sign in to sync notes, and export a backup.';
 async function signIn(){
  if(embedded){popupSignIn();return;}
  try{const url=new URL(location.href);url.hash='';event('sign-in');const {error}=await client.auth.signInWithOAuth({provider:'discord',options:{redirectTo:url.href}});if(error)throw error;}
  catch{status('Discord sign-in could not start. Please try again.');}
 }
 // Inside another site's frame Discord refuses to load, so sign-in runs in a small window (signin.html) that posts the session back here.
 let signInWindow=null,signInWatch;
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
  d.append(text('p','This permanently deletes your sign-in and everything stored with it: your synced notes, your suggestions and reports, including ones not reviewed yet.'),text('p','Notes saved in this browser stay here until you delete them. Markers already added to the atlas from your suggestions stay. If you asked to be credited, your name in the contributors list becomes Anonymous at the next update.','form-hint'));
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
  const hint=text('p','Tip: in ✎ Edit you can drag the marker to the right spot and send it for review.','form-hint');hint.hidden=true;d.append(hint);
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
 // Wiki search (signed-in visitors): look a page up by name and fill the wiki link with it.
 // The search goes through the atlas's own backend function, which holds the wiki's partner key.
 const finders=new Set(),wikiTypes={npc:'NPC',item:'Item',quest:'Quest',zone:'Zone'};
 async function wikiSearch(q){
  // Answers are kept in this browser for a day (and shared ones on the backend), so a repeated search costs the wiki nothing.
  const key=q.toLowerCase().replace(/\s+/g,' '),saved=readSearches(),hit=saved[key];if(hit&&Date.now()-hit.at<864e5)return hit;
  const {data}=await client.auth.getSession(),token=data?.session?.access_token;if(!token)throw Error('sign-in');
  const r=await fetch(settings.supabaseUrl.replace(/\/$/,'')+'/functions/v1/wiki-search?q='+encodeURIComponent(key),{headers:{apikey:settings.supabaseKey,Authorization:'Bearer '+token}});
  if(!r.ok)throw Error(r.status===429?'busy':'failed');const body=await r.json();
  const answer={at:Date.now(),site:Object.hasOwn(wikiSites,body?.site)?body.site:'mnm-wiki',results:Array.isArray(body?.results)?body.results:[]};
  saved[key]=answer;const keys=Object.keys(saved).sort((a,b)=>saved[b].at-saved[a].at);for(const old of keys.slice(100))delete saved[old];
  try{localStorage.setItem(searchesKey,JSON.stringify(saved));}catch{}return answer;
 }
 const searchesKey='mnmaps-wiki-searches';
 function readSearches(){try{const rows=JSON.parse(localStorage.getItem(searchesKey)||'{}');return rows&&typeof rows==='object'&&!Array.isArray(rows)?rows:{};}catch{return {};}}
 function wikiFinder(input,picked){
  const box=text('div','','wiki-finder'),search=document.createElement('input'),list=text('div','','wiki-results'),signedOut=text('p','','form-hint'),trouble=text('span','','wiki-signin-trouble');
  // Signing in from here keeps the note open: the sign-in window hands the session back to this page.
  signedOut.append(text('span','Paste a page address, or '),button('sign-in',()=>{trouble.textContent='';popupSignIn(message=>{trouble.textContent=' '+message+' You can also sign in from the top bar.';});},'wiki-signin'),text('span',' to search the wiki by name'),trouble);
  search.type='search';search.maxLength=80;search.placeholder='Search the wiki by name';search.setAttribute('aria-label','Search the Monsters and Memories Wiki by name');
  let timer,serial=0;
  // The credit names and links the wiki the results came from.
  const show=(rows,message,from)=>{list.replaceChildren();if(message)list.append(text('p',message,'form-hint'));
   for(const row of rows){const b=button('',()=>{input.value=row.url;setWikiPick(input,row.url,row.id);input.dispatchEvent(new Event('input'));picked?.(row);search.value='';show([]);input.focus?.();},'wiki-result');
    b.append(text('strong',row.name),text('small',[wikiTypes[row.type]||row.type,row.zone].filter(Boolean).join(' · ')));list.append(b);}
   const source=wikiSites[from];if(rows.length&&source){const credit=text('a',source.credit||'Data from '+source.name,'wiki-credit');credit.href=source.home||'https://'+source.hosts[0]+'/';credit.target='_blank';credit.rel='noopener';list.append(credit);}};
  search.addEventListener('input',()=>{clearTimeout(timer);const q=search.value.trim(),mine=++serial;if(q.length<2){show([]);return;}
   timer=setTimeout(async()=>{show([],'Searching…');try{const {site,results}=await wikiSearch(q);if(mine===serial)show(results,results.length?'':'No wiki page found with that name.',site);}
    catch(e){if(mine===serial)show([],e.message==='busy'?'Wiki searches are rate limited. Try again in a minute.':'The wiki could not be searched right now. You can paste the page address instead.');}},350);});
  box.append(search,list,signedOut);
  box.update=()=>{search.hidden=list.hidden=!user;signedOut.hidden=!!user;if(!user){search.value='';show([]);}};
  box.reset=()=>{clearTimeout(timer);serial++;search.value='';show([]);};
  finders.add(box);box.update();return box;
 }
 // A picked page names an unnamed note, and a quest makes it a Quest marker; the wiki's own text is never copied in.
 {const field=$('wiki-field');if(field){const finder=wikiFinder($('wiki'),row=>{if(!$('name').value.trim())$('name').value=row.name;if(row.type==='quest'&&$('category').value!=='Quest'){$('category').value='Quest';$('category').dispatchEvent(new Event('change'));}});field.append(finder);$('editor')?.addEventListener('close',()=>finder.reset());}}
 function editDialog(target,kind){
  if(!user){signInDialog();return;}
  const d=showDialog(kind==='edit-label'?'Suggest a better place name':'Suggest an edit');
  const marker=kind==='edit-marker';
  d.append(text('p','Fix the name or the description'+(marker?', or link its wiki page':'')+'. Your change waits for review before it appears on the map.','form-hint'));
  const field=(label,id,el)=>{const l=text('label',label);l.htmlFor=id;el.id=id;d.append(l,el);return el;};
  const name=field('Name','edit-name',document.createElement('input'));name.maxLength=100;name.required=true;name.value=target.name;
  const note=field('Description','edit-note',document.createElement('textarea'));note.maxLength=2000;note.rows=4;note.value=target.note||'';note.placeholder='What players should know about this place.';
  let wiki=null;if(marker){wiki=field('Wiki page (optional)','edit-wiki',document.createElement('input'));wiki.inputMode='url';wiki.maxLength=300;wiki.spellcheck=false;wiki.value=target.wiki||'';setWikiPick(wiki,target.wiki,target.wikiId);wiki.placeholder='https://monstersandmemories.wiki/…';const finder=wikiFinder(wiki);d.append(finder);d.addEventListener('close',()=>finders.delete(finder),{once:true});}
  const why=field('Why (optional)','edit-comment',document.createElement('textarea'));why.maxLength=500;why.rows=2;why.placeholder='For example: the vendor was renamed in the last patch.';const credit=creditBox(d);
  const actions=text('div','','dialog-actions'),send=button(admin?'Publish':'Send for review',async()=>{
   const newName=name.value.replace(/\s+/g,' ').trim(),newNote=note.value.trim(),oldNote=(target.note||'').trim(),newWiki=wiki?wikiAddress(wiki.value):'',oldWiki=target.wiki||'';
   if(!newName){status('Give it a name.');name.focus?.();return;}
   if(newWiki===null){status(wikiHint);wiki.focus?.();return;}
   if(newName===target.name&&newNote===oldNote&&newWiki===oldWiki){status(marker?'Change the name, the description or the wiki page first.':'Change the name or the description first.');return;}
   if(!user){signInDialog();return;}send.disabled=true;
   try{const published=await submit({user_id:user.id,author_name:displayName(user),map:config.id,level:target.level||config.levelId||null,kind,target_id:target.id,payload:{name:newName,note:newNote,...(marker?{wiki:newWiki,...(wikiIdFor(wiki,newWiki)?{wikiId:wikiIdFor(wiki,newWiki)}:{})}:{}),from:{name:target.name,note:target.note||'',...(marker?{wiki:oldWiki}:{})}},comment:why.value.trim()||null,credit:credit.checked});
    editedNow.add(editToken(kind,target.id));d.close();freshPopup();map.closePopup();status(sentLine(published)||'Thanks! Your edit is waiting for review.');event('edit-sent');}
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
  const payload={x:m.x,y:m.y,name:m.name,category:m.category,note:m.note};for(const key of ['noteType','arrow','trade','color','toMap','wiki'])if(m[key])payload[key]=m[key];if(m.wiki&&m.wikiId)payload.wikiId=m.wikiId;
  sendDialog('Share a personal note',[{token:sharedToken(m),name:m.name,map:config.id,level:m.level||config.levelId||null,kind:'new-marker',target_id:null,payload}],true);
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
 async function submit(row){
  const {data,error}=await client.from('suggestions').insert(row).select('id').single();if(error)throw error;
  if(!admin||data?.id==null)return false;
  const {data:done,error:fail}=await client.from('suggestions').update({status:'approved',reviewed_at:new Date().toISOString(),review_note:'Approved on sending (admin)'}).eq('id',data.id).eq('status','pending').select('id');
  if(fail||!done?.length){status('Saved, but it could not be approved here; approve it in Review suggestions.');return false;}
  return true;
 }
 const sentLine=published=>published?'Approved: it goes live with the next publishing run.':null;
 function sendDialog(title,rows,sharing){
  const d=showDialog(title);d.append(text('p',sharing?'Send this note for review before it appears in the community atlas.':'Your positions are saved locally. Choose the changes to send for review.'));
  const list=text('div','','community-choices'),checks=[];
  for(const row of rows){const label=text('label',''),check=document.createElement('input');check.type='checkbox';check.checked=true;label.append(check,text('span',row.name));list.append(label);checks.push(check);}d.append(list);
  const label=text('label','Optional comment');label.htmlFor='suggestion-comment';const comment=document.createElement('textarea');comment.id='suggestion-comment';comment.maxLength=500;comment.rows=3;d.append(label,comment);const credit=creditBox(d);
  const actions=text('div','','dialog-actions'),send=button(user?(admin?'Publish':'Send for review'):'Sign in with Discord',async()=>{
   if(!user){await signIn();return;}const selected=rows.filter((_,i)=>checks[i].checked&&!checks[i].disabled);if(!selected.length){status('Choose at least one item.');return;}
   send.disabled=true;let done=0;
   try{
    // Separate inserts let the daily limit apply to every row; partial success is remembered.
    let published=0;for(const row of selected){const {token,name,...suggestion}=row;if(await submit({...suggestion,user_id:user.id,author_name:displayName(user),comment:comment.value.trim()||null,credit:credit.checked}))published++;remember(sharing?sharedKey:sentKey,[token]);checks[rows.indexOf(row)].disabled=true;checks[rows.indexOf(row)].checked=false;done++;}
    if(done){freshPopup();d.close();status(sentLine(published===done)||'Thanks! Your suggestion is waiting for review.');}
   }catch(e){if(turnedOff(e)){status('Your account can no longer send suggestions. Your local notes and positions are safe.');freshPopup();return;}status('Some suggestions could not be sent. Unsent items remain selected; your local notes and positions are safe.');freshPopup();}
   finally{if(done)event('suggestion-sent');send.disabled=false;}
  },'primary');actions.append(button('Not now',()=>d.close()),send);d.append(actions);
 }
 // Ids present at the last successful sync tell a deleted note from a new one on the other side.
 const baseKey=(uid,key)=>'mnmaps-community-synced-'+uid+'-'+key;
 function readBase(uid,key){try{const ids=JSON.parse(localStorage.getItem(baseKey(uid,key))||'null');return Array.isArray(ids)?new Set(ids):null;}catch{return null;}}
 function writeBase(uid,key,notes){try{localStorage.setItem(baseKey(uid,key),JSON.stringify(notes.map(m=>m.id)));}catch{}}
 function syncIdentity(){return user?user.id+':'+scope():'';}
 function scheduleSync(){
  if(syncing||!user||!config||syncReady!==syncIdentity())return;
  const job={uid:user.id,map:scope(),notes:personal.map(m=>({...m}))};syncJobs.set(job.uid+':'+job.map,job);clearTimeout(syncTimer);syncTimer=setTimeout(()=>pushJobs(),2000);
 }
 let pushing=false;
 async function pushJobs(){
  if(pushing)return;pushing=true;let failed=false;
  try{for(const [key,job] of syncJobs){if(user?.id!==job.uid){syncJobs.delete(key);continue;}
   try{const {error}=await client.from('user_notes').upsert({user_id:job.uid,map:job.map,notes:job.notes,updated_at:new Date().toISOString()},{onConflict:'user_id,map'});if(error)throw error;writeBase(job.uid,job.map,job.notes);if(syncJobs.get(key)===job)syncJobs.delete(key);quiet('Notes synced.');}
   catch{failed=true;quiet('Notes could not sync. Your local notes are safe.');}
  }}finally{pushing=false;if(!failed&&syncJobs.size){clearTimeout(syncTimer);syncTimer=setTimeout(()=>pushJobs(),2000);}}
 }
 async function syncNotes(serial){
  if(!user||!map||loading||alignmentMode)return;const uid=user.id,key=scope(),identity=uid+':'+key;syncReady='';
  try{const {data,error}=await client.from('user_notes').select('notes').eq('user_id',uid).eq('map',key).maybeSingle();if(error)throw error;if(serial!==mapSerial||user?.id!==uid||key!==scope()||alignmentMode)return;
   const remote=data?.notes||[];if(!Array.isArray(remote)||remote.length>2000||!remote.every(valid))throw Error();
   // A note on one side only was either added there (keep it) or deleted on the other side since the last sync (drop it).
   const base=readBase(uid,key),localIds=new Set(personal.map(m=>m.id)),remoteIds=new Set(remote.map(m=>m.id)),merged=new Map();
   for(const m of remote)if(localIds.has(m.id)||!base?.has(m.id))merged.set(m.id,m);
   for(const m of personal)if(remoteIds.has(m.id)||!base?.has(m.id))merged.set(m.id,m);
   if(merged.size>2000)throw Error();
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
  const serial=++authSerial;user=next;admin=false;syncReady='';accountUI();for(const f of finders)f.update();if(review.open)review.close();clearPreview();freshPopup();
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
 // Approved suggestions stay listed, and can still be adjusted, until the publishing job puts them live.
 async function pendingTab(all=false,offset=0,state='pending'){
  clearPreview();const serial=++reviewSerial,content=$('review-content');content.replaceChildren();
  const tabs=text('div','','community-tabs');for(const [value,label] of [['pending','Waiting for review'],['approved','Approved, not live yet']]){const b=button(label,()=>pendingTab(all,0,value));b.setAttribute('aria-pressed',String(state===value));tabs.append(b);}
  const toggle=text('label','','community-check'),check=document.createElement('input');check.type='checkbox';check.checked=all;check.onchange=()=>pendingTab(check.checked,0,state);toggle.append(check,text('span','All maps'));content.append(tabs,toggle,text('p','Loading…','form-hint'));
  try{let request=client.from('suggestions').select('*').eq('status',state).order('created_at',{ascending:false}).order('id',{ascending:false});if(!all)request=request.eq('map',config.id);const {data,error}=await request.range(offset,offset+199);if(error)throw error;if(serial!==reviewSerial||!admin)return;content.lastChild.remove();
   if(!data.length)content.append(text('p',state==='approved'?'Nothing waiting to go live. Approved suggestions are published within the hour.':'Nothing to review. Reports come from Report a problem on a marker; suggestions from Edit, Suggest an edit and Share with everyone.','form-hint'));
   const perAuthor=new Map();for(const row of data)perAuthor.set(row.user_id,(perAuthor.get(row.user_id)||0)+1);
   for(const row of data){const card=text('article','','review-card'),count=perAuthor.get(row.user_id);card.append(reviewTitle(row),text('p','By '+(row.author_name||'Discord member')+(count>1?' ('+count+' waiting)':''),'review-author'),text('p',(kinds[row.kind]||row.kind)+' · '+row.map+(row.level?' / '+row.level:'')+' · '+new Date(row.created_at).toLocaleString(),'form-hint'));if(row.comment)card.append(text('p',row.comment));
    // A suggestion the publishing job could not apply comes back with its reason.
    if(row.review_note)card.append(text('p',row.review_note,'reported-reason'));
    if(row.kind==='report')card.append(text('p',reasons[row.payload.reason]||'Something else','reported-reason'));
    if(row.kind==='edit-marker'||row.kind==='edit-label'){const f=row.payload.from||{},was=v=>v||'(none)';if(f.name!==row.payload.name)card.append(text('p','Name: '+was(f.name)+' → '+row.payload.name,'review-change'));if((f.note||'')!==(row.payload.note||''))card.append(text('p','Description: '+was(f.note)+'\n→ '+was(row.payload.note),'review-change'));if(typeof row.payload.wiki==='string'&&(f.wiki||'')!==row.payload.wiki)card.append(text('p','Wiki page: '+was(f.wiki)+'\n→ '+was(row.payload.wiki),'review-change'));}
    if(row.kind==='new-marker'){card.append(text('p',row.payload.noteType==='label'?'Area label':row.payload.noteType==='exit'?'Zone exit':row.payload.category,'form-hint'));if(row.payload.note)card.append(text('p',row.payload.note));if(row.payload.wiki)card.append(text('p','Wiki page: '+row.payload.wiki,'review-change'));}
    const label=text('label','Optional review note'),note=document.createElement('textarea');note.rows=2;note.maxLength=500;label.append(note);card.append(label);
    const actions=text('div','','dialog-actions');if(row.user_id!==user?.id&&state==='pending')actions.append(button('Ban author',()=>banDialog(row,all),'review-ban'));actions.append(button(row.kind==='report'?'Show on map':'Review on map',()=>preview(row,()=>pendingTab(all,offset,state))),...decisions(row,()=>note.value,card));card.append(actions);content.append(card);
   }
   const pages=text('div','','dialog-actions');if(offset)pages.append(button('Newer',()=>pendingTab(all,Math.max(0,offset-200),state)));if(data.length===200)pages.append(button('Older',()=>pendingTab(all,offset+200,state)));content.append(pages);
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
 function decisions(row,note,card,edits=()=>null){const report=row.kind==='report';
  if(row.status==='approved')return [button('Reject',()=>reviewAction(row,'rejected',note(),card)),button('Back to waiting',()=>reviewAction(row,'pending',note(),card))];
  return [button(report?'Dismiss':'Reject',()=>reviewAction(row,'rejected',note(),card)),button(report?'Fixed':'Approve',()=>reviewAction(row,report?'resolved':'approved',note(),card,edits()),'primary')];}
 // The card title shows the icon the visitor chose (or the marker being moved or edited).
 function reviewTitle(row){
  const title=text('strong','','review-title'),p=row.payload,target=row.kind==='new-marker'?p:originals.find(m=>m.id===row.target_id&&row.map===config.id);
  try{if(target&&!target.noteType&&categories[target.category]){const face=text('span','','review-icon');face.style.setProperty('--pin',target.color||categories[target.category][1]);face.append(markerSymbol(target));title.append(face);}}catch{}
  title.append(text('span',p.name));return title;
 }
 async function reviewAction(row,state,note,card,payload=null){
  for(const b of card.querySelectorAll('button'))b.disabled=true;
  try{const {data,error}=await client.from('suggestions').update({status:state,reviewed_at:state==='pending'?null:new Date().toISOString(),review_note:note.trim()||null,...(payload?{payload}:{})}).eq('id',row.id).eq('status',row.status||'pending').select('id');if(error||!data?.length)throw error||Error();card.remove();clearPreview();status({approved:'Suggestion approved for publishing.',pending:'Back in the review queue.',resolved:'Report marked as fixed.',rejected:row.kind==='report'?'Report dismissed.':'Suggestion rejected.'}[state]);}
  catch{status('Review could not be saved. Please refresh the list.');for(const b of card.querySelectorAll('button'))b.disabled=false;}
 }
 // On the map, a suggestion can be adjusted before approval (or while approved and not live yet):
 // drag its marker, and change the name, type and description of a new marker or the text of an edit.
 async function preview(row,refresh=()=>{}){
  try{
   review.close();const url=new URL(location.href);url.searchParams.set('map',row.map);for(const k of ['place','x','y','z'])url.searchParams.delete(k);if(row.level)url.searchParams.set('level',row.level);else url.searchParams.delete('level');
   if(config.id!==row.map||(row.level&&config.levelId!==row.level))await loadMap(row.map,url);
   if(config.id!==row.map||(row.level&&config.levelId!==row.level)||loading)throw Error();
   clearPreview();reviewLayer=L.layerGroup().addTo(map);
   const p=structuredClone(row.payload),edit=row.kind==='edit-marker'||row.kind==='edit-label',move=row.kind==='move-marker'||row.kind==='move-label',report=row.kind==='report';
   const target=row.kind==='edit-label'||row.kind==='move-label'?labelData.labels.find(l=>l.id===row.target_id):originals.find(m=>m.id===row.target_id);
   const xy=v=>{if(!Array.isArray(v)||v.length!==2||!bounded(...v,config.minZoom))throw Error();return locationOf({x:v[0],y:v[1]});};
   const here=edit?xy((row.kind==='edit-label'?publishedLabelPositions:publishedPositions).get(row.target_id)):move?xy(p.to):xy([p.x,p.y]);
   const look=()=>row.kind==='new-marker'?{...p,id:'review-'+row.id}:row.kind.endsWith('label')?{id:'review-'+row.id,name:p.name,noteType:'label',category:'Personal'}:{...(target||{category:'Personal'}),id:'review-'+row.id,name:edit?p.name:target?.name||p.name};
   const pin=L.marker(here,{icon:pinIcon(look()),draggable:!edit&&!report,zIndexOffset:1500,keyboard:false}).bindTooltip(()=>text('span',(report?'Reported':edit?'Being edited':move?'Suggested position':'Suggested marker')+' · '+p.name),{permanent:true,direction:'bottom',offset:[0,6]});
   reviewLayer.addLayer(pin);
   let line=null;
   if(move){const from=L.circleMarker(xy(p.from),{radius:6,color:'#2f6f9a',fillColor:'#2f6f9a',fillOpacity:.75,weight:3}).bindTooltip(()=>text('span','Published position'),{permanent:true,direction:'top'});reviewLayer.addLayer(from);line=L.polyline([xy(p.from),here],{color:'#b5861f',weight:2,dashArray:'6 6'});reviewLayer.addLayer(line);}
   pin.on('drag',()=>line?.setLatLngs([line.getLatLngs()[0],pin.getLatLng()]));
   const bar=text('section','','community-preview');bar.id='community-preview';bar.setAttribute('aria-label','Review selected suggestion');
   bar.append(text('strong',(kinds[row.kind]||'Suggestion')+(row.status==='approved'?' · approved, not live yet':'')));
   const field=(label,el)=>{const l=text('label',label,'preview-field');l.append(el);bar.append(l);return el;};
   let name,note,category;
   if(row.kind==='new-marker'||edit){name=field('Name',document.createElement('input'));name.maxLength=100;name.value=p.name;}
   if(row.kind==='new-marker'&&!p.noteType){category=field('Type',document.createElement('select'));for(const k of Object.keys(categories).filter(k=>k!=='Personal').sort((a,b)=>a.localeCompare(b))){const o=text('option',k);o.value=k;category.append(o);}category.value=categories[p.category]?p.category:Object.keys(categories)[0];}
   if(row.kind==='new-marker'||edit){note=field('Description',document.createElement('textarea'));note.rows=2;note.maxLength=2000;note.value=p.note||'';}
   let wiki;if(row.kind==='new-marker'&&!p.noteType||row.kind==='edit-marker'){wiki=field('Wiki page',document.createElement('input'));wiki.inputMode='url';wiki.maxLength=300;wiki.spellcheck=false;wiki.value=Object.hasOwn(p,'wiki')?p.wiki:edit?target?.wiki||'':'';}
   if(!edit&&!report)bar.append(text('p','Drag the marker to adjust its position.','form-hint'));
   const restyle=()=>{if(name)p.name=name.value.replace(/\s+/g,' ').trim()||p.name;if(category){p.category=category.value;if(p.category!=='Tradeskill')delete p.trade;}pin.setIcon(pinIcon(look()));};
   for(const el of [name,category])el?.addEventListener('input',restyle);category?.addEventListener('change',restyle);
   const reviewNote=document.createElement('input');reviewNote.placeholder='Optional review note';reviewNote.setAttribute('aria-label','Optional review note');reviewNote.maxLength=500;bar.append(reviewNote);
   // The adjusted payload keeps the visitor's other fields; positions are checked against the map bounds.
   const edits=()=>{
    restyle();if(note)p.note=note.value.trim();
    if(wiki){const link=wikiAddress(wiki.value);if(link===null)throw Error('Wiki link');
     // An older edit without a link only gains one when a page is typed in; the published link it saw is kept for the check.
     if(link!==(p.wiki||''))delete p.wikiId;
     if(edit&&!Object.hasOwn(p,'wiki')){if(link){p.wiki=link;p.from={...p.from,wiki:target?.wiki||''};}}else if(link||edit)p.wiki=link;else delete p.wiki;}
    if(!report&&!edit){const [x,y]=pixelsOf(pin.getLatLng());if(!bounded(x,y,config.minZoom))throw Error('Outside the map');if(move)p.to=[x,y];else{p.x=x;p.y=y;}}
    if(!p.name)throw Error('Name required');return p;
   };
   const safe=()=>{try{return edits();}catch(e){status(e.message==='Name required'?'Give it a name.':e.message==='Wiki link'?wikiHint:'Keep the marker inside the map.');throw e;}};
   const actions=text('div','','dialog-actions');actions.append(button('Close',()=>{clearPreview();refresh();}));
   if(!report)actions.append(button(row.status==='approved'?'Save changes':'Save without approving',async()=>{let payload;try{payload=safe();}catch{return;}
    const {data,error}=await client.from('suggestions').update({payload}).eq('id',row.id).eq('status',row.status).select('id');if(error||!data?.length){status('Changes could not be saved. Please refresh the list.');return;}row.payload=structuredClone(payload);status('Changes saved.');}));
   const wrapped=decisions(row,()=>reviewNote.value,bar,()=>{try{return safe();}catch{return undefined;}});
   actions.append(...wrapped);bar.append(actions);$('map-frame').append(bar);
   if(move)map.fitBounds(L.latLngBounds([xy(p.from),here]),{padding:[60,60],maxZoom:config.defaultView.placeZoom+1});else map.setView(here,config.defaultView.placeZoom);if(compact())setPanel(false);
   status(move?'Blue: published position. Drag the suggested marker to adjust it.':report?'The reported marker.':edit?'The marker or name being edited.':'Drag the suggested marker to adjust it.');
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
