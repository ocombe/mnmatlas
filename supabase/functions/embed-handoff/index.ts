import {createHandoff} from './handler.mjs';
const base=Deno.env.get('SUPABASE_URL')||'',service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'',anon=Deno.env.get('SUPABASE_ANON_KEY')||'';
const partners=JSON.parse(Deno.env.get('EMBED_AUTH_PARTNERS')||'[]');
const headers={apikey:service,Authorization:'Bearer '+service,'Content-Type':'application/json'};
async function request(path:string,body:unknown){const r=await fetch(base+'/rest/v1/'+path,{method:'POST',headers,body:JSON.stringify(body)});if(!r.ok)throw Error('store');return r.status===204?null:await r.json();}
Deno.serve(createHandoff({partners,
 authenticate:async(req:Request)=>{
  const authorization=req.headers.get('authorization')||'';if(!authorization.startsWith('Bearer '))return null;
  const r=await fetch(base+'/auth/v1/user',{headers:{apikey:anon,Authorization:authorization}});if(!r.ok)return null;
  const user=await r.json(),discord=user.identities?.find((i:{provider:string})=>i.provider==='discord');
  const id=discord?.identity_data?.provider_id||discord?.identity_data?.sub;
  return typeof user.id==='string'&&typeof id==='string'&&/^\d+$/.test(id)?{userId:user.id,discordId:id}:null;
 },
 store:{
  issue:async(grant:unknown)=>{await request('rpc/issue_embed_auth_code',{grant_payload:grant})},
  redeem:async(q:{code_hash:string;partner:string;nonce:string;at:string})=>{const rows=await request('rpc/redeem_embed_auth_code',{wanted_hash:q.code_hash,wanted_partner:q.partner,wanted_nonce:q.nonce});return rows?.[0]||null}
 }
}));
