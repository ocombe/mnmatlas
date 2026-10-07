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
 kind text not null,
 target_id text check (char_length(target_id) between 1 and 160),
 payload jsonb not null check (octet_length(payload::text)<4096),
 comment text check (char_length(comment)<=500),
 status text not null default 'pending',
 reviewed_at timestamptz,
 review_note text check (char_length(review_note)<=500)
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
-- A "looks wrong" vote carries what is wrong and optional details.
alter table public.votes add column if not exists reason text check (reason in ('position','name','type','missing','other'));
alter table public.votes add column if not exists comment text check (char_length(comment)<=300);
-- Accounts an admin has stopped from sending suggestions and reports; they can still use the atlas and sync notes.
create table if not exists public.banned (
 user_id uuid primary key references auth.users on delete cascade,
 author_name text check (char_length(author_name)<=80),
 banned_at timestamptz not null default now()
);
-- Kind, status and payload rules live here so re-running this file updates an existing table.
-- A report says what is wrong with a published marker; it closes as resolved (fixed) or rejected (dismissed).
alter table public.suggestions drop constraint if exists suggestions_kind_check;
alter table public.suggestions add constraint suggestions_kind_check check (kind in ('move-marker','move-label','new-marker','edit-marker','edit-label','report'));
alter table public.suggestions drop constraint if exists suggestions_status_check;
alter table public.suggestions add constraint suggestions_status_check check (status in ('pending','approved','rejected','published','resolved'));
alter table public.suggestions drop constraint if exists suggestion_payload;
alter table public.suggestions add constraint suggestion_payload check (coalesce(
 jsonb_typeof(payload)='object' and jsonb_typeof(payload->'name')='string'
 and char_length(payload->>'name') between 1 and 100
 and (not payload ? 'note' or (jsonb_typeof(payload->'note')='string' and char_length(payload->>'note')<=2000))
 and case when kind in ('move-marker','move-label') then
  target_id is not null and jsonb_typeof(payload->'from')='array' and jsonb_typeof(payload->'to')='array'
  and jsonb_array_length(payload->'from')=2 and jsonb_array_length(payload->'to')=2
  and jsonb_typeof(payload->'from'->0)='number' and jsonb_typeof(payload->'from'->1)='number'
  and jsonb_typeof(payload->'to'->0)='number' and jsonb_typeof(payload->'to'->1)='number'
 when kind in ('edit-marker','edit-label') then
  target_id is not null and jsonb_typeof(payload->'from')='object' and jsonb_typeof(payload->'from'->'name')='string'
  and char_length(payload->'from'->>'name')<=100
  and (not payload->'from' ? 'note' or (jsonb_typeof(payload->'from'->'note')='string' and char_length(payload->'from'->>'note')<=2000))
 when kind='report' then
  target_id is not null and payload->>'reason' in ('position','name','type','missing','other')
  and jsonb_typeof(payload->'x')='number' and jsonb_typeof(payload->'y')='number'
 else
  target_id is null and jsonb_typeof(payload->'x')='number' and jsonb_typeof(payload->'y')='number'
  and jsonb_typeof(payload->'category')='string' and char_length(payload->>'category') between 1 and 80
  and (not payload ? 'noteType' or payload->>'noteType' in ('marker','label','exit'))
  and (not payload ? 'arrow' or payload->>'arrow' in ('north','northeast','east','southeast','south','southwest','west','northwest'))
  and (not payload ? 'trade' or (jsonb_typeof(payload->'trade')='string' and char_length(payload->>'trade')<=80))
  and (not payload ? 'color' or payload->>'color' in ('#a04438','#b5861f','#4f7a3a','#385f60','#2f6f9a','#6a4a7a','#6b4f2e','#4d5560'))
 end,false));
create index if not exists suggestions_user_created on public.suggestions(user_id,created_at);
create index if not exists suggestions_status_map on public.suggestions(status,map,created_at desc);
create index if not exists votes_map_target on public.votes(map,target_id);

-- Serialize each account's inserts, including batches, at the daily limit.
create or replace function public.limit_suggestions()
returns trigger language plpgsql security definer set search_path = public as $$
begin
 if auth.uid() is not null then
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
  if exists (select 1 from public.banned where user_id=auth.uid()) then
   raise exception 'Suggestions are turned off for this account';
  end if;
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

-- Sent text is stored clean: no control, invisible or direction-changing characters, no angle brackets.
-- The site shows it as plain text anyway; this keeps the stored copy safe wherever it is used later.
create or replace function public.clean_text(t text,multiline boolean default false)
returns text language sql immutable set search_path = '' as $$
 select case when multiline
  then btrim(regexp_replace(regexp_replace(v,'[ \t]+\n',E'\n','g'),'\n{3,}',E'\n\n','g'),E' \t\n')
  else btrim(regexp_replace(v,'\s+',' ','g')) end
 from (select regexp_replace(replace(replace(normalize(t,NFC),E'\r\n',E'\n'),E'\r',E'\n'),
  '[\x01-\x08\x0b-\x1f\x7f-\x9f\xad\x61c\x180e\x200b-\x200f\x202a-\x202e\x2060-\x2069\xfeff<>]','','g') v) s;
$$;
-- The author name comes from the Discord sign-in itself, not from what the browser sends.
create or replace function public.clean_suggestion()
returns trigger language plpgsql security definer set search_path = public as $$
begin
 if auth.uid() is not null then
  new.author_name=left(coalesce(public.clean_text((select coalesce(i.identity_data->>'full_name',i.identity_data->>'name')
   from auth.identities i where i.user_id=auth.uid() and i.provider='discord' limit 1)),'Discord member'),80);
 end if;
 new.comment=nullif(public.clean_text(new.comment,true),'');
 if jsonb_typeof(new.payload->'name')='string' then new.payload=jsonb_set(new.payload,'{name}',to_jsonb(public.clean_text(new.payload->>'name')));end if;
 if jsonb_typeof(new.payload->'note')='string' then new.payload=jsonb_set(new.payload,'{note}',to_jsonb(public.clean_text(new.payload->>'note',true)));end if;
 return new;
end;
$$;
revoke all on function public.clean_suggestion() from public,anon,authenticated;

-- A signed-in visitor can delete their own account; suggestions, reports, votes and synced notes go with it (on delete cascade).
create or replace function public.delete_my_account()
returns void language plpgsql security definer set search_path = '' as $$
declare uid uuid:=auth.uid();
begin
 if uid is null then raise exception 'Not signed in'; end if;
 delete from auth.users where id=uid;
end;
$$;
revoke all on function public.delete_my_account() from public,anon,authenticated;
grant execute on function public.delete_my_account() to authenticated;
drop trigger if exists suggestions_clean_text on public.suggestions;
-- Also on update, so a pending suggestion its author corrects is cleaned the same way.
create trigger suggestions_clean_text before insert or update of payload on public.suggestions for each row execute function public.clean_suggestion();

alter table public.admins enable row level security;
alter table public.suggestions enable row level security;
alter table public.votes enable row level security;
alter table public.user_notes enable row level security;
alter table public.banned enable row level security;

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
-- A note suggested from the note form follows its suggestion: while nobody has reviewed it, its author may update it
-- (a moved pin, a corrected name). The row stays pending and unreviewed; reviewing stays with admins.
drop policy if exists suggestions_update_own_pending on public.suggestions;
create policy suggestions_update_own_pending on public.suggestions for update to authenticated
 using (user_id=auth.uid() and status='pending' and reviewed_at is null)
 with check (user_id=auth.uid() and status='pending' and reviewed_at is null and review_note is null);
drop policy if exists suggestions_delete on public.suggestions;
create policy suggestions_delete on public.suggestions for delete to authenticated
 using (exists (select 1 from public.admins where user_id=auth.uid()));
drop policy if exists votes_read on public.votes;
create policy votes_read on public.votes for select to authenticated using (user_id=auth.uid());
drop policy if exists votes_admin_read on public.votes;
create policy votes_admin_read on public.votes for select to authenticated using (exists (select 1 from public.admins where user_id=auth.uid()));
drop policy if exists votes_insert on public.votes;
create policy votes_insert on public.votes for insert to authenticated with check (user_id=auth.uid());
drop policy if exists votes_update on public.votes;
create policy votes_update on public.votes for update to authenticated using (user_id=auth.uid()) with check (user_id=auth.uid());
drop policy if exists votes_delete on public.votes;
create policy votes_delete on public.votes for delete to authenticated using (user_id=auth.uid());
-- Only admins see or change the banned list, and an admin cannot ban themselves.
drop policy if exists banned_admin on public.banned;
create policy banned_admin on public.banned for all to authenticated
 using (exists (select 1 from public.admins where user_id=auth.uid()))
 with check (exists (select 1 from public.admins where user_id=auth.uid()) and user_id<>auth.uid());
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
-- No longer used by the site; kept callable only by the service role.
grant execute on function public.vote_totals(text) to service_role;

revoke all on public.admins,public.suggestions,public.votes,public.user_notes from public,anon,authenticated;
revoke all on sequence public.suggestions_id_seq from public,anon,authenticated;
grant select on public.admins to authenticated;
grant select,update,delete on public.suggestions to authenticated;
-- The creation timestamp cannot be supplied by a browser to evade the daily limit.
-- Credits for published suggestions, written by the publishing job only. Deleting an account clears user_id,
-- so its entries show as Anonymous in the public contributors list.
create table if not exists public.credits (
 suggestion_id bigint primary key,
 user_id uuid references auth.users on delete set null,
 name text not null check (char_length(name) between 1 and 80),
 credited_at timestamptz not null default now()
);
alter table public.credits enable row level security;
revoke all on public.credits from public,anon,authenticated;
grant all on public.credits to service_role;
-- Opt-in credit: the publishing job lists the author's name as a contributor once the suggestion is published.
alter table public.suggestions add column if not exists credit boolean not null default false;
grant insert (user_id,author_name,map,level,kind,target_id,payload,comment,status,reviewed_at,review_note,credit) on public.suggestions to authenticated;
grant usage on sequence public.suggestions_id_seq to authenticated;
grant select,insert,update,delete on public.votes,public.user_notes to authenticated;
grant all on public.admins,public.suggestions,public.votes,public.user_notes to service_role;
grant all on sequence public.suggestions_id_seq to service_role;
revoke all on public.banned from public,anon,authenticated;
grant select,insert,delete on public.banned to authenticated;
grant all on public.banned to service_role;

commit;

-- After signing in once, run one of these in the SQL editor:
-- insert into public.admins(user_id) select id from auth.users
-- where raw_user_meta_data->>'full_name' = '<your Discord name>' on conflict do nothing;
-- insert into public.admins(user_id) select id from auth.users
-- where email = '<your email>' on conflict do nothing;
