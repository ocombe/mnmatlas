import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
const root=mkdtempSync(join(tmpdir(),'atlas-embed-auth-')),data=join(root,'data'),bin=process.env.ATLAS_PG_BIN;
const executable=name=>bin?join(bin,name+(process.platform==='win32'?'.exe':'')):name;
const run=(name,args)=>execFileSync(executable(name),args,{encoding:'utf8',stdio:name==='pg_ctl'?'ignore':['ignore','pipe','pipe']});
const port=await new Promise(resolve=>{const server=createServer();server.listen(0,'127.0.0.1',()=>{const p=server.address().port;server.close(()=>resolve(p))})});
let started=false;
try{
 run('initdb',['-D',data,'-U','atlas_fixture','-A','trust','--locale=C','--encoding=UTF8']);
 run('pg_ctl',['-D',data,'-l',join(root,'postgres.log'),'-o',`-p ${port} -h 127.0.0.1`,'-w','start']);started=true;
 const args=['-h','127.0.0.1','-p',String(port),'-U','atlas_fixture','-d','postgres','-v','ON_ERROR_STOP=1','-qAt'];
 const sql=text=>run('psql',[...args,'-c',text]).trim();
 sql("create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);insert into auth.users values('00000000-0000-0000-0000-000000000001');");
 run('psql',[...args,'-f',new URL('../supabase/embed-auth.sql',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1')]);
 const user='00000000-0000-0000-0000-000000000001';
 const issue=hash=>sql(`set role service_role;select public.issue_embed_auth_code('${JSON.stringify({code_hash:hash,partner:'fixture',nonce:'n'.repeat(40),user_id:user,discord_id:'123456789012345678',expires_at:new Date(Date.now()+60000).toISOString()})}'::jsonb);`);
 issue('first');
 const redeem=(hash,nonce='n'.repeat(40),partner='fixture')=>sql(`set role service_role;select discord_id from public.redeem_embed_auth_code('${hash}','${partner}','${nonce}');`).split('\n').filter(s=>s!=='SET').join('');
 assert.equal(redeem('first','wrong'),'');assert.equal(redeem('first','n'.repeat(40),'wrong'),'');assert.equal(redeem('first'),'123456789012345678');assert.equal(redeem('first'),'');
 issue('expired');sql("update public.embed_auth_codes set expires_at=now()-interval '1 second'");assert.equal(redeem('expired'),'');
 for(const role of ['anon','authenticated'])for(const operation of ['select * from public.embed_auth_codes',"select * from public.redeem_embed_auth_code('x','fixture','n')"]){assert.throws(()=>sql(`set role ${role};${operation}`));}
 issue('cascade');sql(`delete from auth.users where id='${user}'`);assert.equal(sql('select count(*) from public.embed_auth_codes'),'0');
 console.log('PASS PostgreSQL: migration, service-only grants, nonce/audience, one-use redemption, expiration, anonymous/authenticated denial, account deletion cascade');
}catch(error){console.error('Fixture evidence retained at '+root);throw error}
finally{if(started)run('pg_ctl',['-D',data,'-w','stop','-m','fast']);}
