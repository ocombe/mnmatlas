// Wiki search for the marker editor: signed-in visitors look up a wiki page by name.
// The partner key stays here (secret WIKI_API_KEY); the site never sees it.
// Deployed with verify_jwt off: the sign-in is checked below, so that ?check can say whether the key is set.
const api='https://monstersandmemories.wiki/api/partner/v1/';
const origins=new Set(['https://www.mnmatlas.com','https://mnmatlas.com']);
const local=/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const types=new Set(['npc','item','quest','zone']);
// The wiki allows 120 requests a minute for the whole atlas; one visitor gets a share of that.
const perUser=new Map<string,number[]>(),limit=20;
// Recent answers are kept for a while, so the same name searched again (by anyone) does not reach the wiki twice.
const cache=new Map<string,{at:number,results:unknown[]}>(),keep=30*60000,most=500;
// Results come from this wiki; the site credits it under them.
const site='mnm-wiki';

function headers(req:Request){
 const origin=req.headers.get('origin')||'';
 return {'Content-Type':'application/json','Vary':'Origin',
  ...(origins.has(origin)||local.test(origin)?{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'GET, OPTIONS'}:{})};
}
const reply=(req:Request,status:number,body:unknown,extra:Record<string,string>={})=>new Response(JSON.stringify(body),{status,headers:{...headers(req),...extra}});
const text=(v:unknown,max:number)=>typeof v==='string'?v.replace(/[\u0000-\u001f\u007f<>]/g,'').trim().slice(0,max):'';

async function signedIn(req:Request){
 const auth=req.headers.get('authorization')||'',key=req.headers.get('apikey')||Deno.env.get('SUPABASE_ANON_KEY')||'';
 if(!/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/.test(auth)||!key)return null;
 const r=await fetch(Deno.env.get('SUPABASE_URL')+'/auth/v1/user',{headers:{Authorization:auth,apikey:key}});
 if(!r.ok)return null;const user=await r.json();return typeof user?.id==='string'?user.id:null;
}

Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:headers(req)});
 if(req.method!=='GET')return reply(req,405,{error:'method'});
 const url=new URL(req.url),key=Deno.env.get('WIKI_API_KEY')||'';
 if(url.searchParams.has('check'))return reply(req,200,{configured:/^mnmp_\S+$/.test(key)});
 if(!key)return reply(req,503,{error:'not-configured'});
 const user=await signedIn(req);if(!user)return reply(req,401,{error:'sign-in'});
 const q=text(url.searchParams.get('q'),80).toLowerCase().replace(/\s+/g,' '),wanted=(url.searchParams.get('type')||'npc,item,quest,zone').split(',').filter(t=>types.has(t)).sort();
 if(q.length<2||!wanted.length)return reply(req,400,{error:'query'});
 const now=Date.now(),id=wanted.join(',')+'|'+q,hit=cache.get(id);
 if(hit&&now-hit.at<keep)return reply(req,200,{site,results:hit.results},{'Cache-Control':'private, max-age=1800'});
 const recent=(perUser.get(user)||[]).filter(t=>now-t<60000);
 if(recent.length>=limit)return reply(req,429,{error:'busy'},{'Retry-After':'30'});
 recent.push(now);perUser.set(user,recent);
 let r:Response;
 try{r=await fetch(api+'search?q='+encodeURIComponent(q)+'&type='+wanted.join(','),{headers:{Authorization:'Bearer '+key,Accept:'application/json'}});}
 catch{return reply(req,502,{error:'wiki'});}
 if(r.status===429)return reply(req,429,{error:'busy'},{'Retry-After':'30'});
 if(r.status===404)return reply(req,200,{site,results:[]});
 if(!r.ok)return reply(req,502,{error:'wiki',status:r.status});
 const data=await r.json().catch(()=>null),rows=Array.isArray(data?.results)?data.results:[];
 // Only what the editor shows and stores: an id for later lookups, the name, the kind, the zone and the page address.
 const results=rows.map((row:Record<string,unknown>)=>{
  let page:URL|null=null;try{page=new URL(String(row.url));}catch{}
  if(!page||page.protocol!=='https:'||!/(^|\.)monstersandmemories\.wiki$/.test(page.hostname))return null;
  return {id:text(row.id,160),type:text(row.type,20),name:text(row.name,100),zone:text(row.zone,100),url:page.href};
 }).filter((row:{id:string,name:string}|null)=>row&&row.id&&row.name).slice(0,12);
 cache.delete(id);cache.set(id,{at:now,results});if(cache.size>most)cache.delete(cache.keys().next().value!);
 return reply(req,200,{site,results},{'Cache-Control':'private, max-age=1800'});
});
