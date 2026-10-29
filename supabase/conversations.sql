-- Conversations on feedback and reports: the sender and the cartographers write back and forth under one item.
-- Run by hand after schema.sql and spot-feedback.sql; it is safe to run twice.
-- Only the sender of the item and admins read or write its conversation. A cartographer's message lights the sender's
-- notices (the item's updated_at moves); a sender's message on a closed item puts it back in the review queue.
begin;

create table if not exists public.suggestion_messages (
 id bigint generated always as identity primary key,
 suggestion_id bigint not null references public.suggestions on delete cascade,
 user_id uuid default auth.uid() references auth.users on delete set null,
 from_admin boolean not null default false,
 body text not null check (char_length(body) between 1 and 2000),
 created_at timestamptz not null default now()
);
create index if not exists suggestion_messages_thread on public.suggestion_messages(suggestion_id,created_at);

-- The author, side and time come from the sign-in, never from the browser; the text is cleaned as suggestions are.
create or replace function public.prepare_suggestion_message()
returns trigger language plpgsql security definer set search_path = public as $$
declare s public.suggestions; is_admin boolean;
begin
 if auth.uid() is null then raise exception 'Not signed in'; end if;
 is_admin:=exists (select 1 from public.admins where user_id=auth.uid());
 select * into s from public.suggestions where id=new.suggestion_id;
 if s.id is null or s.kind not in ('feedback','report') then raise exception 'Conversations are only for feedback and reports'; end if;
 if not is_admin then
  if s.user_id is distinct from auth.uid() then raise exception 'Not your conversation'; end if;
  if exists (select 1 from public.banned where user_id=auth.uid()) then raise exception 'Messages are turned off for this account'; end if;
  if (select count(*) from public.suggestion_messages m where m.suggestion_id=s.id and m.user_id=auth.uid()
   and m.created_at>now()-interval '1 day')>=20 then raise exception 'Too many messages today'; end if;
 end if;
 new.user_id=auth.uid(); new.from_admin=is_admin; new.created_at=now();
 new.body=public.clean_text(new.body,true);
 return new;
end;
$$;
revoke all on function public.prepare_suggestion_message() from public,anon,authenticated;
drop trigger if exists suggestion_messages_prepare on public.suggestion_messages;
create trigger suggestion_messages_prepare before insert on public.suggestion_messages for each row execute function public.prepare_suggestion_message();

-- Any message moves the item's updated_at (suggestions_updated_at), so the other side sees it as new.
-- A sender writing on an item marked done, fixed or dismissed sends it back to Waiting; reviewed_at is kept,
-- so it cannot be withdrawn and the conversation stays.
create or replace function public.touch_suggestion_conversation()
returns trigger language plpgsql security definer set search_path = public as $$
begin
 update public.suggestions set status=case when not new.from_admin and status in ('resolved','rejected') then 'pending' else status end
  where id=new.suggestion_id;
 return null;
end;
$$;
revoke all on function public.touch_suggestion_conversation() from public,anon,authenticated;
drop trigger if exists suggestion_messages_touch on public.suggestion_messages;
create trigger suggestion_messages_touch after insert on public.suggestion_messages for each row execute function public.touch_suggestion_conversation();

alter table public.suggestion_messages enable row level security;
drop policy if exists suggestion_messages_read on public.suggestion_messages;
create policy suggestion_messages_read on public.suggestion_messages for select to authenticated using (
 exists (select 1 from public.admins where user_id=auth.uid())
 or exists (select 1 from public.suggestions s where s.id=suggestion_id and s.user_id=auth.uid())
);
drop policy if exists suggestion_messages_insert on public.suggestion_messages;
create policy suggestion_messages_insert on public.suggestion_messages for insert to authenticated with check (
 user_id=auth.uid() and (exists (select 1 from public.admins where user_id=auth.uid())
  or exists (select 1 from public.suggestions s where s.id=suggestion_id and s.user_id=auth.uid()))
);
drop policy if exists suggestion_messages_delete on public.suggestion_messages;
create policy suggestion_messages_delete on public.suggestion_messages for delete to authenticated
 using (exists (select 1 from public.admins where user_id=auth.uid()));

revoke all on public.suggestion_messages from public,anon,authenticated;
revoke all on sequence public.suggestion_messages_id_seq from public,anon,authenticated;
grant select,delete on public.suggestion_messages to authenticated;
grant insert (suggestion_id,body) on public.suggestion_messages to authenticated;
grant usage on sequence public.suggestion_messages_id_seq to authenticated;
grant all on public.suggestion_messages to service_role;
grant all on sequence public.suggestion_messages_id_seq to service_role;

commit;
