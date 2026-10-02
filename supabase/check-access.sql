-- Access checks for a signed-in account that is NOT an admin, plus a temporary second account.
-- Run in the SQL editor after signing in once and before adding yourself to admins.
-- Test rows and the temporary account are removed at the end; the last result lists each check.
create temp table if not exists access_checks(n serial, check_name text, passed boolean);
truncate access_checks;
do $$
declare
 a uuid; b uuid := '00000000-0000-4000-8000-00000000b0b0'; b_suggestion bigint; a_suggestion bigint;
 rows int; ok boolean; detail text:=''; results text[] := '{}'; passes boolean[] := '{}';
begin
 select id into a from auth.users where id not in (select user_id from public.admins) and id<>b order by created_at limit 1;
 if a is null then raise exception 'Sign in once with a non-admin account first.'; end if;
 insert into auth.users(id,instance_id,aud,role,email) values (b,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','access-check@example.invalid') on conflict do nothing;
 insert into public.suggestions(user_id,map,kind,payload) values (b,'night-harbor','new-marker','{"name":"Access check","x":1,"y":1,"category":"Quest"}') returning id into b_suggestion;
 insert into public.votes(user_id,map,target_id,value) values (b,'night-harbor','access-check',1) on conflict do nothing;
 insert into public.user_notes(user_id,map,notes) values (b,'access-check','[]') on conflict do nothing;

 -- Act as the signed-in, non-admin account.
 perform set_config('request.jwt.claims',json_build_object('sub',a,'role','authenticated')::text,true);
 perform set_config('request.jwt.claim.sub',a::text,true);
 execute 'set local role authenticated';

 select count(*) into rows from public.suggestions where user_id=b;
 results:=results||'cannot read another account''s suggestions'::text;passes:=passes||(rows=0);
 update public.suggestions set status='approved' where id=b_suggestion;get diagnostics rows=row_count;
 results:=results||'cannot approve another account''s suggestion'::text;passes:=passes||(rows=0);
 delete from public.suggestions where id=b_suggestion;get diagnostics rows=row_count;
 results:=results||'cannot delete another account''s suggestion'::text;passes:=passes||(rows=0);
 begin insert into public.suggestions(user_id,map,kind,payload) values (b,'night-harbor','new-marker','{"name":"Access check","x":1,"y":1,"category":"Quest"}');ok:=false;exception when others then ok:=true;end;
 results:=results||'cannot suggest as another account'::text;passes:=passes||ok;
 begin insert into public.suggestions(map,kind,payload,status) values ('night-harbor','new-marker','{"name":"Access check","x":1,"y":1,"category":"Quest"}','approved');ok:=false;exception when others then ok:=true;end;
 results:=results||'cannot send a suggestion already approved'::text;passes:=passes||ok;
 begin insert into public.suggestions(map,kind,payload) values ('night-harbor','new-marker','{"name":"Access check","x":1,"y":1,"category":"Quest"}') returning id into a_suggestion;ok:=a_suggestion is not null;detail:='';exception when others then ok:=false;detail:=' ('||sqlstate||': '||sqlerrm||')';end;
 results:=results||('can send a pending suggestion'||detail);passes:=passes||ok;
 update public.suggestions set status='approved' where id=a_suggestion;get diagnostics rows=row_count;
 results:=results||'cannot approve own suggestion'::text;passes:=passes||(rows=0);
 update public.suggestions set payload='{"name":"Changed","x":1,"y":1,"category":"Quest"}' where id=a_suggestion;get diagnostics rows=row_count;
 results:=results||'cannot edit own suggestion after sending'::text;passes:=passes||(rows=0);
 select count(*) into rows from public.votes where user_id=b;
 results:=results||'cannot read another account''s votes'::text;passes:=passes||(rows=0);
 update public.votes set value=-1 where user_id=b;get diagnostics rows=row_count;
 results:=results||'cannot change another account''s vote'::text;passes:=passes||(rows=0);
 select count(*) into rows from public.user_notes where user_id=b;
 results:=results||'cannot read another account''s notes'::text;passes:=passes||(rows=0);
 begin insert into public.admins(user_id) values (a);ok:=false;exception when others then ok:=true;end;
 results:=results||'cannot make itself admin'::text;passes:=passes||ok;
 select count(*) into rows from public.vote_totals('night-harbor');
 results:=results||'public vote counts still work'::text;passes:=passes||(rows>=1);

 -- Anonymous visitors.
 execute 'reset role';
 perform set_config('request.jwt.claims',json_build_object('role','anon')::text,true);
 perform set_config('request.jwt.claim.sub','',true);
 execute 'set local role anon';
 begin perform count(*) from public.suggestions;ok:=false;exception when others then ok:=true;end;
 results:=results||'anonymous visitors cannot read suggestions'::text;passes:=passes||ok;
 begin perform count(*) from public.votes;ok:=false;exception when others then ok:=true;end;
 results:=results||'anonymous visitors cannot read raw votes'::text;passes:=passes||ok;
 execute 'reset role';

 -- Clean up.
 delete from public.suggestions where user_id=b or id=a_suggestion;
 delete from public.votes where user_id=b;delete from public.user_notes where user_id=b;delete from auth.users where id=b;
 for i in 1..array_length(results,1) loop insert into access_checks(check_name,passed) values (results[i],passes[i]); end loop;
end $$;
select check_name, case when passed then 'PASS' else 'FAIL' end as result from access_checks order by n;
