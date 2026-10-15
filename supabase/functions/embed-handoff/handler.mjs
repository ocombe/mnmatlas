// Only Atlas-origin clients issue codes. Partner servers redeem with their own secret.
export function createHandoff({partners=[],atlasOrigins=['https://www.mnmatlas.com','https://mnmatlas.com'],authenticate,store,now=()=>Date.now(),random=()=>crypto.randomUUID()+crypto.randomUUID()}){
 const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),v=>v.toString(16).padStart(2,'0')).join('');
 const equal=async(a,b)=>{const x=await digest(a),y=await digest(b);let diff=0;for(let i=0;i<x.length;i++)diff|=x.charCodeAt(i)^y.charCodeAt(i);return diff===0};
 const validOrigin=value=>{try{const u=new URL(value);return u.origin===value&&u.protocol==='https:'}catch{return false}};
 if(partners.some(p=>!p.id||!validOrigin(p.origin)||typeof p.secret!=='string'||p.secret.length<32))throw Error('Invalid embed partner configuration');
 return async req=>{
  const origin=req.headers.get('origin'),cors=atlasOrigins.includes(origin),headers={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin',...(cors?{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'authorization, apikey, content-type'}:{})};
  const reply=(status,body)=>new Response(JSON.stringify(body),{status,headers});
  if(req.method==='OPTIONS')return new Response(null,{status:cors?204:403,headers});
  if(req.method!=='POST')return reply(405,{error:'method'});
  try{
   const reader=req.body?.getReader();let raw='';if(reader){const decoder=new TextDecoder();for(;;){const {done,value}=await reader.read();if(done)break;raw+=decoder.decode(value,{stream:true});if(raw.length>2048){await reader.cancel();return reply(413,{error:'size'});}}raw+=decoder.decode();}let body;try{body=JSON.parse(raw)}catch{return reply(400,{error:'request'})}
   if(!body||typeof body!=='object'||Array.isArray(body))return reply(400,{error:'request'});
   const partner=partners.find(p=>p.id===body.partner),nonce=body.nonce;
   if(!partner||typeof nonce!=='string'||!/^[a-zA-Z0-9_-]{32,128}$/.test(nonce))return reply(400,{error:'request'});
   if(body.action==='issue'){
    if(!cors)return reply(403,{error:'origin'});
    const identity=await authenticate(req);
    if(!identity?.userId||!identity?.discordId)return reply(401,{error:'sign-in'});
    const code=random(),expires=now()+60000;
    // The store enforces one outstanding grant per account, partner and nonce.
    await store.issue({code_hash:await digest(code),partner:partner.id,nonce,user_id:identity.userId,discord_id:identity.discordId,expires_at:new Date(expires).toISOString()});
    return reply(200,{code,nonce,expiresAt:expires});
   }
   if(body.action==='redeem'){
    // Redemption is server-to-server. No browser-origin request is accepted.
    if(origin)return reply(403,{error:'origin'});
    const supplied=req.headers.get('authorization')||'';
    if(!await equal(supplied,'Bearer '+partner.secret))return reply(401,{error:'partner'});
    if(typeof body.code!=='string'||!/^[a-zA-Z0-9-]{64,128}$/.test(body.code))return reply(400,{error:'request'});
    const grant=await store.redeem({code_hash:await digest(body.code),partner:partner.id,nonce,at:new Date(now()).toISOString()});
    if(!grant)return reply(401,{error:'invalid-code'});
    return reply(200,{issuer:'mnmatlas',audience:partner.id,nonce,subject:grant.user_id,discordId:grant.discord_id});
   }
   return reply(400,{error:'request'});
  }catch{return reply(503,{error:'handoff-unavailable'})}
 };
}
