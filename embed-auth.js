'use strict';
// Parent pages receive a redeemable code only, never an Atlas or Discord token.
window.installAtlasEmbedAuth=function({client,settings,approve,fetcher=fetch,host=window}){
 const partners=Array.isArray(settings.embedAuthPartners)?settings.embedAuthPartners:[];
 const valid=partners.filter(p=>{try{return typeof p.id==='string'&&new URL(p.origin).origin===p.origin&&p.origin.startsWith('https://')}catch{return false}});
 if(host.parent===host||!valid.length)return ()=>{};
 let pending=null;
 const seen=new Map();
 async function receive(event){
  if(event.source!==host.parent)return;
  const partner=valid.find(p=>p.origin===event.origin),d=event.data;
  if(!partner||!d||d.type!=='mnmatlas:signin'||d.version!==1||typeof d.requestId!=='string'||!/^[a-zA-Z0-9_-]{32,128}$/.test(d.requestId))return;
  const key=partner.id+':'+d.requestId;
  for(const [id,at] of seen)if(Date.now()-at>300000)seen.delete(id);
  if(seen.has(key)||pending)return;
  if(seen.size>=100)return;
  seen.set(key,Date.now());const job={};pending=job;
  const reply=value=>event.source.postMessage({type:'mnmatlas:signin-result',version:1,requestId:d.requestId,...value},event.origin);
  let timer;const timeout=new Promise(resolve=>{timer=setTimeout(()=>resolve(false),300000)});
  try{
   const accepted=await Promise.race([approve(partner),timeout]);
   if(pending!==job)return;
   if(!accepted){reply({error:'cancelled'});return;}
   const {data,error}=await client.auth.getSession();if(error||!data?.session?.access_token){reply({error:'sign-in-required'});return;}
   const response=await fetcher(settings.supabaseUrl.replace(/\/$/,'')+'/functions/v1/embed-handoff',{method:'POST',headers:{'Content-Type':'application/json',apikey:settings.supabaseKey,Authorization:'Bearer '+data.session.access_token},body:JSON.stringify({action:'issue',partner:partner.id,nonce:d.requestId})});
   if(!response.ok)throw Error('issue');const result=await response.json();
   if(typeof result.code!=='string'||!/^[a-zA-Z0-9-]{64,128}$/.test(result.code)||result.nonce!==d.requestId||!Number.isFinite(result.expiresAt)||result.expiresAt<=Date.now())throw Error('response');
   if(pending===job)reply({code:result.code,expiresAt:result.expiresAt});
  }catch{if(pending===job)reply({error:'unavailable'})}
  finally{clearTimeout(timer);if(pending===job)pending=null;}
 }
 host.addEventListener('message',receive);
 return ()=>{pending=null;host.removeEventListener('message',receive)};
};
