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
 const notesLine=document.querySelector('.journal-bottom .backup').previousElementSibling;
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
   // Contribution points: approved suggestions count 1, bounties 2, priority bounties 3.
   const points=text('p','','account-points');points.hidden=true;myPoints().then(p=>{if(!p)return;points.textContent=rewardWord[0].toUpperCase()+rewardWord.slice(1)+': '+p.points+(p.bounties+p.priority_bounties?' · '+(p.bounties+p.priority_bounties)+((p.bounties+p.priority_bounties)===1?' bounty':' bounties'):'');points.hidden=false;});
   account.append(head,points,syncLine);if(admin)account.append(reviewButton);
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
 $('editor').querySelector('.storage-hint').textContent='Saved on this device. Sign in to sync notes, and export a backup.';
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
 // Only what can stand on the map as a marker is searched (NPCs, not items or quests), and only in this map's zone:
 // the backend keeps the wiki's results from that zone. A map's wiki zone is its title unless maps.json gives wikiZone;
 // the world map spans every zone.
 let finderCount=0;const finders=new Set(),wikiTypes={npc:'NPC'},markerTypes=Object.keys(wikiTypes).join(',');
 const searchZone=()=>!config||config.zonesFile?'':config.wikiZone||config.title||'';
 const searchPlaceholder=()=>{const zone=searchZone();return zone?'Search NPCs in '+zone:'Search NPCs in every zone';};
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
 function wikiFinder(input,picked,name){
  // Inside a site that may not link to the Monsters and Memories Wiki, the Name field stays a plain field.
  if(!wikiSiteShown('mnm-wiki')){const off=text('div','','wiki-finder');off.hidden=true;off.update=off.reset=()=>{};return off;}
  const box=text('div','','wiki-finder'),list=text('div','','wiki-results'),signedOut=text('p','','form-hint wiki-signin-hint'),trouble=text('span','','wiki-signin-trouble');
  list.id='wiki-results-'+(++finderCount);list.setAttribute('role','listbox');list.setAttribute('aria-label','Wiki NPCs');
  name.setAttribute('aria-controls',list.id);name.setAttribute('aria-autocomplete','list');name.autocomplete='off';
  // Signing in from here keeps the note open: the sign-in window hands the session back to this page.
  signedOut.append(text('strong','Did you know?','wiki-tip-label'),button('Sign in',()=>{trouble.textContent='';popupSignIn(message=>{trouble.textContent=' '+message+' You can also sign in from the top bar.';});},'wiki-signin'),text('span',' to look up NPCs from the wiki as you type: picking one fills in its name, level, type, wiki link and location for you.'),trouble);
  // A spinner runs while the wiki is asked; answers kept in this browser show at once without it.
  const spinner=text('p','','wiki-searching');spinner.append(text('span','','wiki-spinner'),text('span','Searching the wiki…'));spinner.hidden=true;
  let timer,serial=0,wanted='',asking=null,active=-1;
  const busy=on=>{spinner.hidden=!on;list.setAttribute('aria-busy',on?'true':'false');};
  // Only the latest search counts: a new one cancels the wait and the request before it.
  const stop=()=>{clearTimeout(timer);serial++;asking?.abort();asking=null;busy(false);};
  const options=()=>[...list.querySelectorAll('button')].filter(b=>String(b.className).split(' ').includes('wiki-result'));
  const highlight=i=>{const all=options();active=all.length?(i+all.length)%all.length:-1;all.forEach((b,n)=>{b.className=n===active?'wiki-result active':'wiki-result';b.setAttribute('aria-selected',String(n===active));});if(active>=0){name.setAttribute('aria-activedescendant',all[active].id);all[active].scrollIntoView?.({block:'nearest'});}else name.removeAttribute('aria-activedescendant');};
  // The credit names and links the wiki the results came from, under the list and again after a pick.
  const credit=(from,lead='')=>{const source=wikiSites[from];if(!source)return;const line=text('a',lead+(source.credit||'Data from '+source.name),'wiki-credit');line.href=source.home||'https://'+source.hosts[0]+'/';line.target='_blank';line.rel='noopener';list.append(line);};
  const pick=(row,from)=>{name.value=row.name+levelText(row.level);wanted=name.value.trim().toLowerCase().replace(/\s+/g,' ');
   input.value=row.url;setWikiPick(input,row.url,row.id);input.dispatchEvent(new Event('input'));picked?.(row);
   stop();show([]);credit(from,'Filled from the wiki · ');name.focus?.();};
  const show=(rows,message,from,heading)=>{list.replaceChildren();active=-1;name.removeAttribute('aria-activedescendant');name.setAttribute('aria-expanded',String(rows.length>0));
   if(heading&&rows.length)list.append(text('p',heading,'wiki-heading'));if(message)list.append(text('p',message,'form-hint'));
   rows.forEach((row,n)=>{const b=button('',()=>pick(row,from),'wiki-result');b.id=list.id+'-'+n;b.setAttribute('role','option');b.tabIndex=-1;
    b.append(text('strong',row.name),text('small',[isClassTrainer(row)?'Class trainer':wikiTypes[row.type]||row.type,row.level?'level '+row.level:'',row.zone].filter(Boolean).join(' · ')));list.append(b);});
   if(rows.length)credit(from);};
  const showFound=(site,results)=>{const rows=results.filter(r=>Object.hasOwn(wikiTypes,r.type)),zone=searchZone();show(rows,rows.length?'':zone?'No wiki NPC in '+zone+' with that name.':'No wiki NPC with that name.',site,zone?'Wiki NPCs in '+zone:'Wiki NPCs');};
  // Typing waits 600 ms for a pause; the same words again (spaces or case aside) do not search twice.
  name.addEventListener('input',()=>{if(!user)return;const q=name.value.trim(),key=q.toLowerCase().replace(/\s+/g,' ');if(key===wanted)return;
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
  box.update=()=>{name.placeholder=user?'Type a name to search the wiki, or any name':'Give this place a name';box.hidden=false;list.hidden=spinner.hidden=!user;signedOut.hidden=!!user;if(!user){stop();wanted='';show([]);}else busy(false);};
  box.reset=()=>{stop();wanted='';show([]);};
  finders.add(box);box.update();return box;
 }
 // A picked NPC pre-fills a new note as the wiki's terms allow: its name (with its level, as the atlas writes levels),
 // its type from the wiki's role, and its short location line as the note. Nothing the visitor typed is replaced,
 // and descriptions, walkthroughs or loot never come in. A "named" NPC is a named mob only when the wiki gives it a level.
 const roleTypes={merchant:'Vendor',quest:'Quest',mob:'Mob camp'};
 const roleType=row=>isClassTrainer(row)?'Class trainer':roleTypes[row.role]||(row.role==='named'&&row.level?'Named mob':'');
 const levelText=level=>{const v=String(level??'').trim();return v?' ('+(/[-–]/.test(v)?'levels '+v.replace(/\s*[-–]\s*/,'–'):'level '+v)+')':'';};
 const wikiNote=row=>row.location||'';
 {const field=$('wiki-field');if(field){const finder=wikiFinder($('wiki'),row=>{
  const type=roleType(row);if(type&&$('category').value==='Personal'&&[...$('category').options].some(o=>o.value===type)){$('category').value=type;$('category').dispatchEvent(new Event('change'));}
  // A trainer's classes ride with its wiki link, so the note reads "Beastmaster trainer" first like the atlas's own trainers.
  $('wiki').dataset.wikiClasses=JSON.stringify(trainerClasses(row));
  if(!$('note').value.trim()&&wikiNote(row))$('note').value=wikiNote(row);},$('name'));$('name').after(finder);$('editor')?.addEventListener('close',()=>finder.reset());}}
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
  // Markers suggested since the list was built are left out too.
  let places=[];try{const index=await (await fetch('data/find-index.json')).json();places=index.filter(p=>p.m===config.id);}catch{places=allMarkers().map(m=>({n:m.name,w:m.wikiId,m:config.id}));}
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
 function bountyPrefill(row){const classes=trainerClasses(row),type=isClassTrainer(row)?'Class trainer':roleTypes[row.role]||(row.role==='named'&&row.level?'Named mob':'Personal');
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
 const wikiLink=(row,label,cls)=>{const a=text('a',label,cls);a.href=row.url;a.target='_blank';a.rel='noopener';return a;};
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
 function openWanted(){if(!config||config.zonesFile||!wantedShown())return;if(!paperTexture){paperTexture=new Image();paperTexture.onload=setPaper;paperTexture.src='assets/bounty/paper.webp';}setPaper();
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
  const show=key=>{chosen=key;try{localStorage.setItem(tabKey,key);}catch{}const g=groups.find(x=>x.key===key);
   for(const t of tabs.children)t.setAttribute('aria-selected',String(t.dataset.key===key));
   reward.textContent='Reward: '+(g.priority?3:2)+' '+rewardWord+' and your name in the atlas credits';
   list.replaceChildren(...g.rows.map(row=>notice(row,claimed.has(row.id))));list.scrollTop=0;};
  for(const g of groups){const t=button('',()=>show(g.key),'wanted-tab');t.dataset.key=g.key;t.setAttribute('role','tab');t.append(text('span',g.title.replace('Class trainers','Trainers').replace('Quest givers','Quests').replace('Named NPCs','Named')),text('small',String(g.rows.filter(r=>!claimed.has(r.id)).length)));tabs.append(t);}
  view.append(tabs,reward,list);
  const source=wikiSites[site];if(source){const credit=text('a',source.credit||'Data from '+source.name,'wiki-credit board-credit');credit.href=source.home||'https://'+source.hosts[0]+'/';credit.target='_blank';credit.rel='noopener';view.append(credit);}
  show(chosen);contributeCount(open);
  if(focus){const el=[...list.children].find(n=>n.dataset.bounty===wantedFocus);if(el){el.classList.add('notice-focus');el.scrollIntoView({block:'center'});}}wantedFocus=null;
 }
 renderWanted.serial=0;
 // A compact notice: the name (to its wiki page), level and kind, the wiki link and the bounty button. The whole notice
 // is the drag handle; a claimed one is stamped.
 function notice(row,isClaimed){
  const note=text('article','','notice'+(row.priority?' priority':'')),paper=text('div','','notice-paper'),name=text('h4','','notice-name');
  name.append(wikiLink(row,row.name,''));paper.append(text('p',row.priority?'Priority bounty · 3 '+rewardWord:'Bounty · 2 '+rewardWord,'notice-tag'));
  paper.append(name,text('p',[row.level?'Level '+row.level:'',bountyKind(row)].filter(Boolean).join(' · '),'notice-meta'));
  const foot=text('div','','notice-foot');foot.append(wikiLink(row,'Wiki ↗','notice-wiki'));
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
 function editDialog(target,kind){
  if(!user){signInDialog();return;}
  const d=showDialog(kind==='edit-label'?'Suggest a better place name':'Suggest an edit');
  const marker=kind==='edit-marker';
  d.append(text('p','Fix the name or the description'+(marker?', or link its wiki page':'')+'. Your change waits for review before it appears on the map.','form-hint'));
  const field=(label,id,el)=>{const l=text('label',label);l.htmlFor=id;el.id=id;d.append(l,el);return el;};
  const name=field('Name','edit-name',document.createElement('input'));name.maxLength=100;name.required=true;name.value=target.name;
  const note=field('Description','edit-note',document.createElement('textarea'));note.maxLength=2000;note.rows=4;note.value=target.note||'';note.placeholder='What players should know about this place.';
  let wiki=null;if(marker){wiki=field('Wiki page (optional)','edit-wiki',document.createElement('input'));wiki.inputMode='url';wiki.maxLength=300;wiki.spellcheck=false;wiki.value=target.wiki||'';setWikiPick(wiki,target.wiki,target.wikiId);wiki.placeholder='https://monstersandmemories.wiki/…';const finder=wikiFinder(wiki,null,name);name.after(finder);d.addEventListener('close',()=>finders.delete(finder),{once:true});}
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
   if(!(row.status==='pending'&&!row.reviewed_at)&&!(admin&&row.status==='approved')){forget();status(b?'Your claim was already accepted, so the marker stays on the public map.':'Your suggestion was already accepted, so the marker stays on the public map.',true);return;}
   const {data:done,error:refused}=await client.from('suggestions').delete().eq('id',rec.id).select('id');if(refused)throw refused;if(!done?.length)throw Error('not withdrawn');
   forget();if(b)unmarkBountyClaimed(b.map||config.id,b.bounty);status('Note deleted, and your '+what+' was withdrawn.');event('suggestion-withdrawn');
  }catch{status('Note deleted, but your '+what+' could not be withdrawn: it is still waiting for review.',true);}
 }
 window.addEventListener('atlas:note-deleted',e=>{withdrawNote(e.detail?.note);});
 window.atlasCommunity={deleteNotice,popup(m,n){
  if(m.id.startsWith('personal-')){if(alignmentMode)return;const shared=readSet(sharedKey).has(sharedToken(m));if(!config.zonesFile)n.append(shared?text('p','Shared for review','moved-note'):button('Share with everyone',()=>shareNote(m)));return;}
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
 function notePayload(m){
  const payload={x:m.x,y:m.y,name:m.name,category:m.category,note:m.note};for(const key of ['noteType','arrow','trade','color','toMap','wiki'])if(m[key])payload[key]=m[key];if(m.wiki&&m.wikiId)payload.wikiId=m.wikiId;if(m.category==='Class trainer'&&classesOk(m.classes))payload.classes=m.classes;
  const bounty=readBounties()[m.id];if(bounty&&m.wikiId===bounty.bounty){payload.bounty=bounty.bounty;if(bounty.priority)payload.priority=true;}
  return payload;
 }
 function shareNote(m){
  sendDialog('Share a personal note',[{token:sharedToken(m),name:m.name,map:config.id,level:m.level||config.levelId||null,kind:'new-marker',target_id:null,payload:notePayload(m)}],true);
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
 async function submitRow(row){
  const {data,error}=await client.from('suggestions').insert(row).select('id').single();if(error)throw error;
  const id=data?.id??null;if(!admin||id==null)return {id,published:false};
  const {data:done,error:fail}=await client.from('suggestions').update({status:'approved',reviewed_at:new Date().toISOString(),review_note:'Approved on sending (admin)'}).eq('id',data.id).eq('status','pending').select('id');
  if(fail||!done?.length){status('Saved, but it could not be approved here; approve it in Review suggestions.');return {id,published:false};}
  return {id,published:true};
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
  let classes=[];try{classes=JSON.parse($('wiki').dataset.wikiClasses||'[]');}catch{}
  const facts=text('div','','bounty-facts');facts.id='bounty-facts';const list=document.createElement('dl');
  const fact=(term,value)=>{list.append(text('dt',term));const dd=document.createElement('dd');dd.append(value);list.append(dd);};
  const category=$('category').value,page=text('a',$('wiki').value.replace(/^https:\/\//,''),'');page.href=$('wiki').value;page.target='_blank';page.rel='noopener';
  fact('Name',$('name').value);fact('Show as','Marker');fact('Category',category+(category==='Class trainer'&&classes.length?' · '+classes.join(' / '):''));fact('Wiki page',page);facts.append(list);
  // A trainer the wiki gives no class for: the finder says which, or the marker could not be placed right.
  if(category==='Class trainer'&&!classes.length){const field=text('div','','field'),label=text('label','Class'),pick=document.createElement('select');label.htmlFor=pick.id='bounty-class';pick.required=true;
   pick.append(new Option('Choose the class they teach',''),...atlasClasses.map(c=>new Option(c,c)));pick.onchange=()=>{$('wiki').dataset.wikiClasses=JSON.stringify(pick.value?[pick.value]:[]);};field.append(label,pick);facts.append(field);}
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
 function afterSignIn(){
  if(claimAfterSignIn&&bountyForm&&$('editor').open){claimAfterSignIn=false;setBountyForm(bountyForm.note);$('marker-form').requestSubmit();return;}
  claimAfterSignIn=false;offerPrivateBounties();
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
  const payload=notePayload(m),{id,published}=await submitRow({map:config.id,level:m.level||config.levelId||null,kind:'new-marker',target_id:null,payload,user_id:user.id,author_name:displayName(user),comment:null,credit:credited});
  if(id!=null){const all=readFollowed();all[followId(m)]={id,sent:payload,credit:credited};writeFollowed(all);}
  return published;
 }
 async function suggestOnSave(m,credited){
  if(readSet(sharedKey).has(sharedToken(m)))return;
  try{const published=await sendNote(m,credited);remember(sharedKey,[sharedToken(m)]);freshPopup();status(sentLine(published)||'Saved, and suggested for the public map: it is waiting for review.');event('suggestion-sent');}
  catch(e){status(e?.code==='23505'?'Someone just claimed this bounty. Your note is kept in your field notes.':turnedOff(e)?'Saved to your field notes. Your account can no longer send suggestions.':'Saved to your field notes, but the suggestion did not go through. You can send it from the note’s popup with Share with everyone.');}
 }
 async function followNote(m,rec){
  const payload=notePayload(m),key=followId(m),same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);if(same(payload,rec.sent))return;
  const keep=sent=>{const all=readFollowed();all[key]={...rec,...sent};writeFollowed(all);};
  try{
   const {data:row,error}=await client.from('suggestions').select('status').eq('id',rec.id).maybeSingle();if(error)throw error;
   if(row?.status==='pending'){
    const {data:done,error:refused}=await client.from('suggestions').update({payload}).eq('id',rec.id).eq('status','pending').select('id');
    if(!refused&&done?.length){keep({sent:payload});status('Saved, and your suggestion was updated.');return;}
    await sendNote(m,!!rec.credit);status('Saved, and your suggestion was sent again with the change.');return;
   }
   if(row?.status==='approved'||row?.status==='published'){
    // The marker it becomes is community-<suggestion id>; place names and exits live with the labels.
    const old=rec.sent,label=payload.noteType==='label'||payload.noteType==='exit',target='community-'+rec.id,base={user_id:user.id,author_name:displayName(user),map:config.id,level:m.level||config.levelId||null,target_id:target,comment:null,credit:!!rec.credit};
    if(old.x!==payload.x||old.y!==payload.y)await submit({...base,kind:label?'move-label':'move-marker',payload:{name:payload.name,from:[old.x,old.y],to:[payload.x,payload.y]}});
    const wikiOf=p=>label?{}:{wiki:p.wiki||'',...(p.wiki&&p.wikiId?{wikiId:p.wikiId}:{})};
    if(old.name!==payload.name||(old.note||'')!==(payload.note||'')||(!label&&(old.wiki||'')!==(payload.wiki||'')))
     await submit({...base,kind:label?'edit-label':'edit-marker',payload:{name:payload.name,note:payload.note||'',...wikiOf(payload),from:{name:old.name,note:old.note||'',...(label?{}:{wiki:old.wiki||''})}}});
    keep({sent:payload});status('Saved, and the change was sent for review.');return;
   }
   const all=readFollowed();delete all[key];writeFollowed(all);
  }catch(e){status('Saved to your field notes, but your suggestion could not be updated. You can share the note again from its popup.');}
 }
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
  if(serial===authSerial&&user)afterSignIn();
 }
 function clearPreview(){reviewLayer?.remove();reviewLayer=null;const bar=$('community-preview');bar?.dispatchEvent(new Event('wiki-done'));bar?.remove();}
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
    if(row.kind==='new-marker'){card.append(text('p',row.payload.noteType==='label'?'Area label':row.payload.noteType==='exit'?'Zone exit':row.payload.category,'form-hint'));if(row.payload.note)card.append(text('p',row.payload.note));if(row.payload.wiki)card.append(text('p','Wiki page: '+row.payload.wiki,'review-change'));
     // A bounty from the Wanted board is worth more points once approved: the badge says which, with its wiki page.
     if(typeof row.payload.bounty==='string'){const badge=text('p','','bounty-badge');badge.append(text('strong',row.payload.priority===true?'Priority bounty · 3 '+rewardWord:'Bounty · 2 '+rewardWord));if(row.payload.wiki){const a=text('a',' Wiki page ↗');a.href=row.payload.wiki;a.target='_blank';a.rel='noopener';badge.append(a);}card.append(badge);}}
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
   let wiki;if(row.kind==='new-marker'&&!p.noteType||row.kind==='edit-marker'){wiki=field('Wiki page',document.createElement('input'));wiki.inputMode='url';wiki.maxLength=300;wiki.spellcheck=false;wiki.value=Object.hasOwn(p,'wiki')?p.wiki:edit?target?.wiki||'':'';setWikiPick(wiki,wiki.value,p.wikiId||(!Object.hasOwn(p,'wiki')&&edit?target?.wikiId:''));
    // Picking the NPC from the wiki fixes the name too, so it is spelled as on the wiki.
    const finder=wikiFinder(wiki,()=>restyle(),name);name.after(finder);bar.addEventListener('wiki-done',()=>finders.delete(finder));}
   if(!edit&&!report)bar.append(text('p','Drag the marker to adjust its position.','form-hint'));
   const restyle=()=>{if(name)p.name=name.value.replace(/\s+/g,' ').trim()||p.name;if(category){p.category=category.value;if(p.category!=='Tradeskill')delete p.trade;}pin.setIcon(pinIcon(look()));};
   for(const el of [name,category])el?.addEventListener('input',restyle);category?.addEventListener('change',restyle);
   const reviewNote=document.createElement('input');reviewNote.placeholder='Optional review note';reviewNote.setAttribute('aria-label','Optional review note');reviewNote.maxLength=500;bar.append(reviewNote);
   // The adjusted payload keeps the visitor's other fields; positions are checked against the map bounds.
   const edits=()=>{
    restyle();if(note)p.note=note.value.trim();
    if(wiki){const link=wikiAddress(wiki.value);if(link===null)throw Error('Wiki link');
     // An older edit without a link only gains one when a page is typed in; the published link it saw is kept for the check.
     const picked=wikiIdFor(wiki,link);if(picked)p.wikiId=picked;else if(link!==(p.wiki||''))delete p.wikiId;
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
 window.addEventListener('atlas:loaded',()=>{for(const f of finders)f.reset();onMap().catch(()=>status('Community data could not load.'));});
 window.addEventListener('atlas:notes',scheduleSync);window.addEventListener('atlas:positions',offerPositions);
 window.addEventListener('atlas:edit-ended',()=>{if(user&&syncReady!==syncIdentity())syncNotes(mapSerial);});
 window.addEventListener('online',()=>{pushJobs();if(user&&map&&!loading&&syncReady!==syncIdentity())syncNotes(mapSerial);});
 document.addEventListener('visibilitychange',()=>{if(document.hidden)pushJobs();});
 if(map&&!loading)onMap();
})();
