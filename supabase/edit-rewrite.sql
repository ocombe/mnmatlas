begin;

-- Review decisions carry the version that was opened, so a newer correction stays waiting.
alter table public.suggestions add column if not exists updated_at timestamptz not null default now();
create or replace function public.stamp_suggestion_update()
returns trigger language plpgsql set search_path = '' as $$
begin
 new.updated_at=clock_timestamp();
 return new;
end;
$$;
revoke all on function public.stamp_suggestion_update() from public,anon,authenticated;
drop trigger if exists suggestions_updated_at on public.suggestions;
create trigger suggestions_updated_at before update on public.suggestions for each row execute function public.stamp_suggestion_update();

-- Existing rows remain readable; the updated rule applies to every new write.
alter table public.suggestions drop constraint if exists suggestion_payload;
alter table public.suggestions add constraint suggestion_payload check (coalesce(
 jsonb_typeof(payload)='object' and jsonb_typeof(payload->'name')='string'
 and char_length(payload->>'name') between 1 and 100
 and (kind='new-marker' or (not payload ? 'bounty' and not payload ? 'priority'))
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
 end,false)) not valid;

-- Accepted changes keep anonymous credit when an account is deleted.
alter table public.suggestions alter column user_id drop not null;
do $$
declare fk record;
begin
 for fk in select c.conname from pg_constraint c
  where c.contype='f' and c.conrelid='public.suggestions'::regclass and c.confrelid='auth.users'::regclass
  and c.conkey=array[(select attnum from pg_attribute where attrelid='public.suggestions'::regclass and attname='user_id')]::smallint[]
 loop execute format('alter table public.suggestions drop constraint %I',fk.conname); end loop;
end;
$$;
alter table public.suggestions add constraint suggestions_user_id_fkey foreign key (user_id) references auth.users on delete set null;
create or replace function public.delete_my_account()
returns void language plpgsql security definer set search_path = '' as $$
declare uid uuid:=auth.uid();
begin
 if uid is null then raise exception 'Not signed in'; end if;
 perform set_config('atlas.deleting_account', auth.uid()::text, true);
 delete from public.suggestions where user_id=uid and status not in ('published','approved');
 update public.suggestions set author_name=null,comment=null,payload=case when kind<>'new-marker' then payload-'bounty'-'priority' else payload end where user_id=uid;
 update public.credits set name=null where user_id=uid;
 delete from auth.users where id=uid;
end;
$$;
revoke all on function public.delete_my_account() from public,anon,authenticated;
grant execute on function public.delete_my_account() to authenticated;

create or replace function public.guard_own_suggestion_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
 if auth.uid() is null or exists (select 1 from public.admins where user_id=auth.uid()) then return new; end if;
 -- Only the account-deletion transaction may anonymise accepted rows and clear their foreign key.
 if current_setting('atlas.deleting_account', true) = old.user_id::text then return new; end if;
 new.id=old.id; new.created_at=old.created_at; new.user_id=old.user_id; new.author_name=old.author_name;
 new.map=old.map; new.kind=old.kind; new.target_id=old.target_id;
 new.comment=nullif(public.clean_text(new.comment,true),'');
 if jsonb_typeof(new.payload->'name')='string' then new.payload=jsonb_set(new.payload,'{name}',to_jsonb(public.clean_text(new.payload->>'name')));end if;
 if jsonb_typeof(new.payload->'note')='string' then new.payload=jsonb_set(new.payload,'{note}',to_jsonb(public.clean_text(new.payload->>'note',true)));end if;
 return new;
end;
$$;
revoke all on function public.guard_own_suggestion_update() from public,anon,authenticated;
commit;
