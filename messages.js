/* Messages: feedback and problem reports, each with a conversation between its sender and the cartographers.
   A traveller sees their own; an admin sees all of them and closes them here (they never reach the review desk). */
'use strict';
window.atlasMessages=(()=>{
 const rules=window.atlasReview,box=text('div','','notices messages'),envelope=button('',()=>panel.hidden?open():close(),'notices-bell messages-button'),badge=text('span','','notices-count'),panel=text('section','','notices-panel messages-panel');
 envelope.insertAdjacentHTML('beforeend','<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M3 6h18v12H3z M3 7l9 6 9-6"/></svg>');envelope.append(badge);envelope.setAttribute('aria-label','Messages');envelope.setAttribute('aria-expanded','false');envelope.setAttribute('aria-controls','messages-panel');panel.id='messages-panel';panel.hidden=true;badge.hidden=true;box.hidden=true;box.append(envelope,panel);$('toggle-panel').after(box);
 let account=null,adapter={},items=[],talk=new Map(),reading=null,filter='open',serial=0,failed=false,loading=null;
 const admin=()=>!!adapter.admin,key=()=>'mnmaps-messages-'+account?.id;
 function seen(){try{return JSON.parse(localStorage.getItem(key())||'{}');}catch{return {};}}
 function markSeen(item){const history=seen(),last=talk.get(item.id)?.at(-1);history[item.id]=last?.id??0;try{localStorage.setItem(key(),JSON.stringify(history));}catch{}}
 // Unread: a message from the other side newer than the last one looked at; for an admin, also a new item never opened.
 function unread(item,history=seen()){const theirs=(talk.get(item.id)||[]).filter(m=>m.from_admin!==admin());if(theirs.length&&theirs.at(-1).id>(history[item.id]??-1))return true;return admin()&&item.status==='pending'&&!(item.id in history);}
 // Waiting for the cartographers: not closed yet, or the sender wrote last.
 const waiting=item=>{const last=(talk.get(item.id)||[]).at(-1);return item.status==='pending'||!!last&&!last.from_admin;};
 const activity=item=>(talk.get(item.id)||[]).at(-1)?.created_at||item.created_at;
 const original=item=>{const p=item.payload||{};if(item.kind==='feedback')return p.note||'';const reason=item.target_id==null?rules.spotReasons[p.reason]:adapter.reasons?.[p.reason];return [reason,item.comment].filter(Boolean).join('\n\n');};
 const heading=i=>i.kind==='feedback'?rules.topics[i.payload?.topic]||'Feedback':rules.title(i),label=i=>i.kind==='feedback'?i.payload?.name||'Feedback':rules.title(i),state=i=>i.status==='pending'?'Open':rules.state(i);
 const when=v=>{const d=new Date(v);return Number.isFinite(d.getTime())?d.toLocaleString(undefined,{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):'';};
 const day=v=>{const d=new Date(v);return Number.isFinite(d.getTime())?d.toLocaleDateString(undefined,{day:'numeric',month:'short'}):'';};
 function updateBadge(){const history=seen(),n=items.filter(i=>unread(i,history)).length;badge.textContent=n>99?'99+':String(n);badge.hidden=!n;envelope.setAttribute('aria-label','Messages'+(n?' · '+n+' unread':''));}
 async function refresh(){if(!account||!adapter.client)return;if(loading)return loading;const ticket=++serial,uid=account.id;loading=(async()=>{try{
   // One read: the items with their conversations embedded (Row Level Security keeps a traveller to their own).
   let q=adapter.client.from('suggestions').select('id,user_id,author_name,map,level,kind,target_id,status,created_at,reviewed_at,comment,payload,suggestion_messages(id,from_admin,body,created_at)').in('kind',['feedback','report']);if(!admin())q=q.eq('user_id',uid);
   const {data,error}=await q.order('created_at',{ascending:false}).limit(300);
   if(ticket!==serial||uid!==account?.id)return;if(error)throw error;
   items=(data||[]).map(r=>({...r,payload:r.payload||{}}));talk=new Map(items.map(i=>[i.id,(Array.isArray(i.suggestion_messages)?i.suggestion_messages:[]).slice().sort((a,b)=>a.id-b.id)]));for(const i of items)delete i.suggestion_messages;
   failed=false;box.hidden=false;
  }catch{if(ticket!==serial)return;failed=true;if(!items.length)box.hidden=true;}finally{loading=null;}
  updateBadge();if(!panel.hidden)render();})();return loading;}
 // The panel hangs from the envelope's right edge and slides to stay on screen (as the notices panel does).
 function place(){panel.style.right='';if(panel.hidden||typeof getComputedStyle!=='function'||!panel.getBoundingClientRect||getComputedStyle(panel).position==='fixed')return;const r=panel.getBoundingClientRect(),gap=8;if(r.left<gap)panel.style.right=(r.left-gap)+'px';else if(r.right>innerWidth-gap)panel.style.right=(r.right-innerWidth+gap)+'px';}
 window.addEventListener('resize',place);
 function close(){if(panel.hidden)return;panel.hidden=true;envelope.setAttribute('aria-expanded','false');}
 function open(id=null){if(!account)return;adapter.closeAccount?.();panel.hidden=false;envelope.setAttribute('aria-expanded','true');if(id!=null){reading=id;filter='all';}render();place();const done=refresh();if(id!=null)done?.then(()=>{if(reading===id&&!items.some(i=>i.id===id))reading=null;render();});}
 function bubble(who,body,fromAtlas,at){const m=text('article','','conversation-message'+(fromAtlas?' from-atlas':''));m.append(text('small',who+(at?' · '+when(at):'')),text('p',body));return m;}
 function render(){
  panel.replaceChildren();const head=text('div','','notices-head'),x=button('×',close);x.setAttribute('aria-label','Close messages');head.append(text('h3','Messages'),x);panel.append(head);
  const item=items.find(i=>i.id===reading);panel.classList.toggle('reading',!!item);if(item&&!panel.hidden){markSeen(item);updateBadge();}
  const body=text('div','','messages-body'),list=text('div','','messages-list'),thread=text('div','','messages-thread');body.append(list,thread);panel.append(body);
  if(admin()){const tabs=text('div','','desk-tabs');for(const [value,label] of [['open','Waiting'],['all','All']]){const n=value==='open'?items.filter(waiting).length:items.length,b=button(label+' '+n,()=>{filter=value;render();});b.setAttribute('aria-pressed',String(filter===value));tabs.append(b);}list.append(tabs);}
  const history=seen(),shown=items.filter(i=>!admin()||filter==='all'||waiting(i)||i.id===reading).sort((a,b)=>admin()&&waiting(b)-waiting(a)||String(activity(b)).localeCompare(String(activity(a))));
  if(failed&&!items.length)list.append(text('p','Messages could not load.','form-hint'),button('Try again',refresh));
  else if(!shown.length)list.append(text('p',admin()?'Nothing waiting. Feedback and reports from travellers arrive here.':'No messages yet. When you send feedback or report a problem, the cartographers can answer you here.','form-hint'));
  for(const i of shown){const row=button('',()=>{reading=i.id;render();panel.querySelector('.conversation-input')?.focus();},'messages-item'+(unread(i,history)?' unread':'')+(i.id===reading?' current':''));const meta=[admin()?i.author_name||'A traveller':null,adapter.mapName?.(i.map)||i.map,day(activity(i))].filter(Boolean).join(' · ');row.append(text('strong',label(i)),text('small',meta),text('span',admin()&&waiting(i)?(i.status==='pending'?'Waiting':'They wrote'):state(i),'notice-state '+i.status));list.append(row);}
  if(!item){thread.append(text('p',shown.length?'Choose a message to read it.':'','form-hint messages-empty'));return;}
  const top=text('div','','messages-thread-head'),back=button('‹ All messages',()=>{reading=null;render();},'messages-back');top.append(back,text('h4',heading(item)),text('small',[admin()?'By '+(item.author_name||'a traveller'):null,adapter.mapName?.(item.map)||item.map,day(item.created_at),state(item)].filter(Boolean).join(' · ')));
  const links=text('div','','notice-links');links.append(button('Show on map',()=>{close();adapter.show?.(item);}));top.append(links);thread.append(top);
  const said=text('div','','conversation-list'),first=original(item),sender=admin()?item.author_name||'The sender':'You',atlas=admin()?'You':'The atlas';if(first)said.append(bubble(sender,first,false,item.created_at));for(const m of talk.get(item.id)||[])said.append(bubble(m.from_admin?atlas:sender,m.body,m.from_admin,m.created_at));thread.append(said);
  const form=text('div','','conversation-form'),input=document.createElement('textarea'),line=text('p','','form-hint conversation-status');input.rows=2;input.maxLength=2000;input.className='conversation-input';input.placeholder=admin()?'Reply to '+(item.author_name||'the sender'):'Write to the cartographers';input.setAttribute('aria-label',input.placeholder);
  const send=button('Send',async()=>{const text0=input.value.trim();if(!text0||send.disabled)return;send.disabled=true;line.textContent='';try{const {error}=await adapter.client.from('suggestion_messages').insert({suggestion_id:item.id,body:text0});if(error)throw error;input.value='';await refresh();render();panel.querySelector('.conversation-input')?.focus();}catch(e){send.disabled=false;line.textContent='Not sent: '+(e?.message||'try again')+'.';}},'primary');
  form.append(input,send);thread.append(form,line);
  if(admin()){const actions=text('div','','desk-decisions messages-decisions');const decide=async next=>{try{const {data,error}=await adapter.client.from('suggestions').update({status:next,reviewed_at:next==='pending'?null:new Date().toISOString()}).eq('id',item.id).eq('status',item.status).select('id,status,reviewed_at');if(error)throw error;if(!data?.length)throw Error('changed');Object.assign(item,data[0]);render();adapter.changed?.();status(next==='pending'?'Back to waiting.':next==='rejected'?'Dismissed.':item.kind==='feedback'?'Feedback marked as done.':'Report marked as fixed.');}catch(e){status(e.message==='changed'?'Changed since you opened it. Open Messages again.':'Could not save: '+(e.message||'try again'));refresh();}};
   if(item.status==='pending')actions.append(button(item.kind==='feedback'?'Done':'Fixed',()=>decide('resolved'),'primary'),button('Dismiss',()=>decide('rejected'),'desk-danger'));else actions.append(button('Back to waiting',()=>decide('pending')));
   if(adapter.ban&&item.user_id&&item.user_id!==account.id)actions.append(button('Ban author',()=>adapter.ban(item,()=>{refresh();}),'review-ban'));thread.append(actions);}
  said.scrollTop=said.scrollHeight;
 }
 document.addEventListener('pointerdown',e=>{if(!box.contains(e.target)&&!e.target?.closest?.('dialog'))close();});box.addEventListener('keydown',e=>{if(e.key==='Escape'){e.stopPropagation();close();envelope.focus();}});
 return {refresh,open,close,setAccount(user,hooks={}){close();const bell=$('notices-panel')?.parentElement;if(bell&&bell!==box&&box.previousElementSibling!==bell)bell.after(box);serial++;account=user||null;adapter=hooks;items=[];talk=new Map();reading=null;filter='open';failed=false;loading=null;box.hidden=true;updateBadge();if(account)refresh();}};
})();
