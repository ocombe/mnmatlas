// Publish now: an admin starts one run of the "Apply approved suggestions" workflow from the review page.
// The GitHub token stays here (secret GITHUB_DISPATCH_TOKEN: fine-grained, this repository, Actions read and write);
// the site never sees it. Deployed with verify_jwt off: the sign-in and the admin row are checked below.
const repo='ocombe/mnmatlas',workflow='apply-suggestions.yml';
const origins=new Set(['https://www.mnmatlas.com','https://mnmatlas.com']);
const local=/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

function headers(req:Request){
 const origin=req.headers.get('origin')||'';
 return {'Content-Type':'application/json','Vary':'Origin',
  ...(origins.has(origin)||local.test(origin)?{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'GET, POST, OPTIONS'}:{})};
}
const reply=(req:Request,status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers:headers(req)});

// Only an account listed in admins may start a run; the admins table's own rules answer that question.
async function isAdmin(req:Request){
 const auth=req.headers.get('authorization')||'',key=req.headers.get('apikey')||Deno.env.get('SUPABASE_ANON_KEY')||'',base=Deno.env.get('SUPABASE_URL');
 if(!/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/.test(auth)||!key||!base)return false;
 const who=await fetch(base+'/auth/v1/user',{headers:{Authorization:auth,apikey:key}});if(!who.ok)return false;
 const user=await who.json();if(typeof user?.id!=='string')return false;
 const row=await fetch(base+'/rest/v1/admins?select=user_id&user_id=eq.'+encodeURIComponent(user.id),{headers:{Authorization:auth,apikey:key}});
 if(!row.ok)return false;const rows=await row.json();return Array.isArray(rows)&&rows.length===1;
}
const github=(path:string,token:string,init:RequestInit={})=>fetch('https://api.github.com/repos/'+repo+'/actions/workflows/'+workflow+path,{...init,headers:{Accept:'application/vnd.github+json',Authorization:'Bearer '+token,'X-GitHub-Api-Version':'2022-11-28','User-Agent':'mnm-atlas-publish',...(init.headers||{})}});

Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:headers(req)});
 const token=Deno.env.get('GITHUB_DISPATCH_TOKEN')||'';
 if(req.method==='GET'&&new URL(req.url).searchParams.has('check'))return reply(req,200,{configured:!!token});
 if(req.method!=='POST')return reply(req,405,{error:'method'});
 if(!token)return reply(req,503,{error:'not-configured'});
 if(!await isAdmin(req))return reply(req,403,{error:'admins-only'});
 // An existing waiting run will read the approvals; a running one has already read its batch.
 let running=false;
 for(const status of ['queued','pending','waiting','in_progress']){
  const r=await github('/runs?per_page=1&status='+status,token);if(!r.ok)return reply(req,502,{error:'github'});
  const runs=await r.json();if(runs?.total_count>0){if(status!=='in_progress')return reply(req,200,{started:false,queued:true});running=true;}
 }
 const r=await github('/dispatches',token,{method:'POST',body:JSON.stringify({ref:'main',inputs:{dry_run:'false'}})});
 if(r.status!==204)return reply(req,502,{error:'github'});
 return reply(req,200,running?{started:true,queued:true}:{started:true});
});
