begin;

create table if not exists public.admins (
 user_id uuid primary key references auth.users on delete cascade
);
create table if not exists public.suggestions (
 id bigint generated always as identity primary key,
 created_at timestamptz not null default now(),
 user_id uuid not null default auth.uid() references auth.users on delete cascade,
 author_name text check (char_length(author_name)<=80),
 map text not null check (map ~ '^[a-z0-9-]{1,80}$'),
 level text check (level ~ '^[a-z0-9-]{1,80}$'),
 kind text not null check (kind in ('move-marker','move-label','new-marker')),
 target_id text check (char_length(target_id) between 1 and 160),
 payload jsonb not null check (octet_length(payload::text)<4096),
 comment text check (char_length(comment)<=500),
 status text not null default 'pending' check (status in ('pending','approved','rejected','published')),
 reviewed_at timestamptz,
 review_note text check (char_length(review_note)<=500),
 constraint suggestion_payload check (coalesce(
  jsonb_typeof(payload)='object' and jsonb_typeof(payload->'name')='string'
  and char_length(payload->>'name') between 1 and 100
  and (not payload ? 'note' or (jsonb_typeof(payload->'note')='string' and char_length(payload->>'note')<=2000))
  and case when kind in ('move-marker','move-label') then
   target_id is not null and jsonb_typeof(payload->'from')='array' and jsonb_typeof(payload->'to')='array'
   and jsonb_array_length(payload->'from')=2 and jsonb_array_length(payload->'to')=2
   and jsonb_typeof(payload->'from'->0)='number' and jsonb_typeof(payload->'from'->1)='number'
   and jsonb_typeof(payload->'to'->0)='number' and jsonb_typeof(payload->'to'->1)='number'
  else
   target_id is null and jsonb_typeof(payload->'x')='number' and jsonb_typeof(payload->'y')='number'
   and jsonb_typeof(payload->'category')='string' and char_length(payload->>'category') between 1 and 80
   and (not payload ? 'note' or (jsonb_typeof(payload->'note')='string' and char_length(payload->>'note')<=2000))
   and (not payload ? 'noteType' or payload->>'noteType' in ('marker','label','exit'))
   and (not payload ? 'arrow' or payload->>'arrow' in ('north','northeast','east','southeast','south','southwest','west','northwest'))
   and (not payload ? 'trade' or (jsonb_typeof(payload->'trade')='string' and char_length(payload->>'trade')<=80))
   and (not payload ? 'color' or payload->>'color' in ('#a04438','#b5861f','#4f7a3a','#385f60','#2f6f9a','#6a4a7a','#6b4f2e','#4d5560'))
  end,false))
);
create table if not exists public.votes (
 user_id uuid not null default auth.uid() references auth.users on delete cascade,
 map text not null check (map ~ '^[a-z0-9-]{1,80}$'),
 target_id text not null check (char_length(target_id) between 1 and 160),
 value smallint not null check (value in (-1,1)),
 created_at timestamptz not null default now(),
 primary key (user_id,map,target_id)
);
create table if not exists public.user_notes (
 user_id uuid not null default auth.uid() references auth.users on delete cascade,
 map text not null check (char_length(map) between 1 and 160),
 notes jsonb not null default '[]' check (jsonb_typeof(notes)='array' and octet_length(notes::text)<1048576),
 updated_at timestamptz not null default now(),
 primary key (user_id,map)
);
create index if not exists suggestions_user_created on public.suggestions(user_id,created_at);
create index if not exists suggestions_status_map on public.suggestions(status,map,created_at desc);
create index if not exists votes_map_target on public.votes(map,target_id);

-- Serialize each account's inserts, including batches, at the daily limit.
create or replace function public.limit_suggestions()
returns trigger language plpgsql security definer set search_path = public as $$
begin
 if auth.uid() is not null then
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
  if (select count(*) from public.suggestions where user_id=auth.uid() and created_at>now()-interval '24 hours')>=50 then
   raise exception 'Daily suggestion limit reached';
  end if;
 end if;
 new.created_at=now();
 return new;
end;
$$;
revoke all on function public.limit_suggestions() from public,anon,authenticated;
drop trigger if exists suggestions_daily_limit on public.suggestions;
create trigger suggestions_daily_limit before insert on public.suggestions for each row execute function public.limit_suggestions();

alter table public.admins enable row level security;
alter table public.suggestions enable row level security;
alter table public.votes enable row level security;
alter table public.user_notes enable row level security;

drop policy if exists admins_self on public.admins;
create policy admins_self on public.admins for select to authenticated using (user_id=auth.uid());
drop policy if exists suggestions_read on public.suggestions;
create policy suggestions_read on public.suggestions for select to authenticated using (
 user_id=auth.uid() or exists (select 1 from public.admins where user_id=auth.uid())
);
drop policy if exists suggestions_insert on public.suggestions;
create policy suggestions_insert on public.suggestions for insert to authenticated with check (
 -- The daily limit lives in the suggestions_daily_limit trigger; a policy reading this table would recurse.
 user_id=auth.uid() and status='pending' and reviewed_at is null and review_note is null
);
drop policy if exists suggestions_update on public.suggestions;
create policy suggestions_update on public.suggestions for update to authenticated
 using (exists (select 1 from public.admins where user_id=auth.uid()))
 with check (exists (select 1 from public.admins where user_id=auth.uid()));
drop policy if exists suggestions_delete on public.suggestions;
create policy suggestions_delete on public.suggestions for delete to authenticated
 using (exists (select 1 from public.admins where user_id=auth.uid()));
drop policy if exists votes_read on public.votes;
create policy votes_read on public.votes for select to authenticated using (user_id=auth.uid());
drop policy if exists votes_insert on public.votes;
create policy votes_insert on public.votes for insert to authenticated with check (user_id=auth.uid());
drop policy if exists votes_update on public.votes;
create policy votes_update on public.votes for update to authenticated using (user_id=auth.uid()) with check (user_id=auth.uid());
drop policy if exists votes_delete on public.votes;
create policy votes_delete on public.votes for delete to authenticated using (user_id=auth.uid());
drop policy if exists notes_owner on public.user_notes;
create policy notes_owner on public.user_notes for all to authenticated using (user_id=auth.uid()) with check (user_id=auth.uid());

-- Only aggregates leave this function; raw votes remain private.
create or replace function public.vote_totals(p_map text)
returns table (map text,target_id text,up bigint,down bigint)
language sql stable security definer set search_path = public as $$
 select v.map,v.target_id,count(*) filter (where v.value=1),count(*) filter (where v.value=-1)
 from public.votes v where v.map=p_map group by v.map,v.target_id;
$$;
revoke all on function public.vote_totals(text) from public,anon,authenticated;
grant execute on function public.vote_totals(text) to anon,authenticated,service_role;

revoke all on public.admins,public.suggestions,public.votes,public.user_notes from public,anon,authenticated;
revoke all on sequence public.suggestions_id_seq from public,anon,authenticated;
grant select on public.admins to authenticated;
grant select,update,delete on public.suggestions to authenticated;
-- The creation timestamp cannot be supplied by a browser to evade the daily limit.
grant insert (user_id,author_name,map,level,kind,target_id,payload,comment,status,reviewed_at,review_note) on public.suggestions to authenticated;
grant usage on sequence public.suggestions_id_seq to authenticated;
grant select,insert,update,delete on public.votes,public.user_notes to authenticated;
grant all on public.admins,public.suggestions,public.votes,public.user_notes to service_role;
grant all on sequence public.suggestions_id_seq to service_role;

commit;

-- After signing in once, run one of these in the SQL editor:
-- insert into public.admins(user_id) select id from auth.users
-- where raw_user_meta_data->>'full_name' = '<your Discord name>' on conflict do nothing;
-- insert into public.admins(user_id) select id from auth.users
-- where email = '<your email>' on conflict do nothing;
