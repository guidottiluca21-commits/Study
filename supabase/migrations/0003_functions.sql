-- =============================================================================
-- 0003_functions.sql  —  Trigger e funzioni RPC (SECURITY DEFINER)
--
-- Tutte le funzioni con privilegi elevati:
--  * fissano search_path (niente hijacking di schema);
--  * derivano l'utente da auth.uid() e non accettano mai un user_id dal client;
--  * sono concesse solo ai ruoli necessari (execute revocato a PUBLIC).
-- =============================================================================

-- Profilo e preferenze creati alla registrazione --------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  insert into public.preferences (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Limite di frequenza per azione/utente ---------------------------------------------
create or replace function public.check_rate(p_action text, p_max int, p_window interval)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid   uuid := auth.uid();
  v_count int;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  select count(*) into v_count from public.rate_events
   where user_id = v_uid and action = p_action and at > now() - p_window;
  if v_count >= p_max then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
  insert into public.rate_events (user_id, action) values (v_uid, p_action);
end;
$$;

-- Profilo --------------------------------------------------------------------------
create or replace function public.update_profile(p_display_name text, p_locale text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  update public.profiles
     set display_name = nullif(btrim(p_display_name), ''),
         locale = coalesce(p_locale, locale)
   where id = auth.uid();
end;
$$;

create or replace function public.set_onboarding(p_step smallint, p_completed boolean default false)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  update public.profiles
     set onboarding_step = greatest(onboarding_step, least(greatest(p_step, 0), 6)),
         onboarding_completed = onboarding_completed or coalesce(p_completed, false)
   where id = auth.uid();
end;
$$;

-- Consenso, pausa, disiscrizione -------------------------------------------------------
create or replace function public.give_newsletter_consent(p_version text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if p_version is null or btrim(p_version) = '' then raise exception 'consent_version_required'; end if;
  update public.profiles
     set newsletter_status = 'active', paused_until = null,
         consent_at = now(), consent_version = p_version, unsubscribed_at = null
   where id = v_uid;
  insert into public.consent_log (user_id, event, text_version) values (v_uid, 'consent_newsletter', p_version);
end;
$$;

create or replace function public.pause_newsletter(p_until date default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  update public.profiles set newsletter_status = 'paused', paused_until = p_until
   where id = v_uid and newsletter_status in ('active', 'paused');
  if not found then raise exception 'not_subscribed'; end if;
  insert into public.consent_log (user_id, event, meta)
    values (v_uid, 'pause', jsonb_build_object('until', p_until));
end;
$$;

create or replace function public.resume_newsletter()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  update public.profiles set newsletter_status = 'active', paused_until = null
   where id = v_uid and newsletter_status = 'paused';
  if not found then raise exception 'not_paused'; end if;
  insert into public.consent_log (user_id, event) values (v_uid, 'resume');
end;
$$;

create or replace function public.unsubscribe_me()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  update public.profiles set newsletter_status = 'unsubscribed', unsubscribed_at = now(), paused_until = null
   where id = v_uid and newsletter_status <> 'unsubscribed';
  if found then
    insert into public.consent_log (user_id, event) values (v_uid, 'unsubscribe');
  end if;
end;
$$;

-- Disiscrizione con un clic dal link in e-mail (anche senza login) -------------------
create or replace function public.unsubscribe_by_token(p_token uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_uid uuid;
begin
  update public.profiles set newsletter_status = 'unsubscribed', unsubscribed_at = now(), paused_until = null
   where unsubscribe_token = p_token and newsletter_status <> 'unsubscribed'
  returning id into v_uid;
  if v_uid is null then
    return exists (select 1 from public.profiles where unsubscribe_token = p_token);
  end if;
  insert into public.consent_log (user_id, event) values (v_uid, 'unsubscribe_token');
  return true;
end;
$$;

-- Esportazione dei propri dati (GDPR) ----------------------------------------------------
create or replace function public.export_my_data()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_uid uuid := auth.uid(); v_out jsonb;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  perform public.check_rate('export', 5, interval '1 day');
  select jsonb_build_object(
    'exported_at', now(),
    'account', (select jsonb_build_object('id', u.id, 'email', u.email, 'created_at', u.created_at,
                                          'email_confirmed_at', u.email_confirmed_at)
                  from auth.users u where u.id = v_uid),
    'profile', (select to_jsonb(p) - 'unsubscribe_token' from public.profiles p where p.id = v_uid),
    'preferences', (select to_jsonb(pr) from public.preferences pr where pr.user_id = v_uid),
    'topics', coalesce((select jsonb_agg(to_jsonb(t)) from public.user_topics t where t.user_id = v_uid), '[]'),
    'core_topics', coalesce((select jsonb_agg(to_jsonb(t)) from public.user_core_topics t where t.user_id = v_uid), '[]'),
    'core_progress', coalesce((select jsonb_agg(to_jsonb(c)) from public.user_core_progress c where c.user_id = v_uid), '[]'),
    'library', coalesce((select jsonb_agg(jsonb_build_object('pmid', a.pmid, 'title', a.title,
                          'status', ua.status, 'received_at', ua.received_at, 'status_changed_at', ua.status_changed_at))
                         from public.user_articles ua join public.articles a on a.id = ua.article_id
                         where ua.user_id = v_uid), '[]'),
    'newsletters', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'week_start', i.week_start,
                          'subject', i.subject, 'status', i.status, 'created_at', i.created_at, 'sent_at', i.sent_at))
                         from public.newsletter_issues i where i.user_id = v_uid), '[]'),
    'deliveries', coalesce((select jsonb_agg(jsonb_build_object('kind', d.kind, 'status', d.status,
                          'attempts', d.attempts, 'sent_at', d.sent_at)) from public.email_deliveries d where d.user_id = v_uid), '[]'),
    'consents', coalesce((select jsonb_agg(to_jsonb(c)) from public.consent_log c where c.user_id = v_uid), '[]')
  ) into v_out;
  insert into public.consent_log (user_id, event) values (v_uid, 'export_data');
  return v_out;
end;
$$;

-- Eliminazione dell'account e di tutti i dati collegati (cascade) --------------------------
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  delete from auth.users where id = v_uid;
end;
$$;

-- Richiesta di invio di prova (solo utenti autorizzati) --------------------------------------
create or replace function public.request_test_send()
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_uid uuid := auth.uid(); v_id uuid;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not (public.is_admin() or exists (select 1 from public.profiles where id = v_uid and test_authorized and not blocked)) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform public.check_rate('test_send', 3, interval '1 day');
  insert into public.test_requests (user_id) values (v_uid) returning id into v_id;
  return v_id;
end;
$$;

-- Amministrazione -----------------------------------------------------------------------
create or replace function public.admin_overview()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  return jsonb_build_object(
    'users', jsonb_build_object(
      'total', (select count(*) from public.profiles),
      'pending', (select count(*) from public.profiles where newsletter_status = 'pending'),
      'active', (select count(*) from public.profiles where newsletter_status = 'active'),
      'paused', (select count(*) from public.profiles where newsletter_status = 'paused'),
      'unsubscribed', (select count(*) from public.profiles where newsletter_status = 'unsubscribed'),
      'blocked', (select count(*) from public.profiles where blocked)),
    'articles', jsonb_build_object(
      'total', (select count(*) from public.articles),
      'last_7_days', (select count(*) from public.articles where acquired_at > now() - interval '7 days')),
    'core_items', jsonb_build_object(
      'verified', (select count(*) from public.core_items where verification = 'verified' and active),
      'unverified', (select count(*) from public.core_items where verification <> 'verified' and active)),
    'deliveries_7d', jsonb_build_object(
      'sent', (select count(*) from public.email_deliveries where status = 'sent' and created_at > now() - interval '7 days'),
      'failed', (select count(*) from public.email_deliveries where status = 'failed' and created_at > now() - interval '7 days'),
      'pending', (select count(*) from public.email_deliveries where status = 'pending')),
    'quota_today', coalesce((select jsonb_agg(jsonb_build_object('provider', provider, 'used', used))
                               from public.quota_usage where period_key = to_char(now() at time zone 'utc', 'YYYY-MM-DD')), '[]'),
    'search_state', coalesce((select jsonb_object_agg(key, value) from public.search_state), '{}'),
    'recent_runs', coalesce((select jsonb_agg(r) from (
        select id, kind, mode, status, started_at, finished_at, stats, error
          from public.automation_runs order by started_at desc limit 10) r), '[]')
  );
end;
$$;

create or replace function public.admin_list_users()
returns table (id uuid, email_masked text, role text, newsletter_status text,
               blocked boolean, test_authorized boolean, created_at timestamptz)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
    select p.id,
           substr(u.email, 1, 1) || '***@' ||
             regexp_replace(split_part(u.email, '@', 2), '^(.).*(\..*)$', '\1***\2'),
           p.role, p.newsletter_status, p.blocked, p.test_authorized, p.created_at
      from public.profiles p join auth.users u on u.id = p.id
     order by p.created_at desc
     limit 500;
end;
$$;

create or replace function public.admin_set_user_flags(p_user uuid, p_blocked boolean, p_test_authorized boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_user = auth.uid() and p_blocked then raise exception 'cannot_block_self'; end if;
  update public.profiles set blocked = coalesce(p_blocked, blocked),
                             test_authorized = coalesce(p_test_authorized, test_authorized)
   where id = p_user;
end;
$$;

-- Privilegi di esecuzione -------------------------------------------------------------------
-- Le funzioni nuove sono eseguibili da PUBLIC per default: si revoca tutto e si concede
-- solo ciò che serve.
revoke all on all functions in schema public from public, anon, authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.update_profile(text, text) to authenticated;
grant execute on function public.set_onboarding(smallint, boolean) to authenticated;
grant execute on function public.give_newsletter_consent(text) to authenticated;
grant execute on function public.pause_newsletter(date) to authenticated;
grant execute on function public.resume_newsletter() to authenticated;
grant execute on function public.unsubscribe_me() to authenticated;
grant execute on function public.unsubscribe_by_token(uuid) to anon, authenticated;
grant execute on function public.export_my_data() to authenticated;
grant execute on function public.delete_my_account() to authenticated;
grant execute on function public.request_test_send() to authenticated;
grant execute on function public.admin_overview() to authenticated;
grant execute on function public.admin_list_users() to authenticated;
grant execute on function public.admin_set_user_flags(uuid, boolean, boolean) to authenticated;
-- check_rate, handle_new_user, set_updated_at: nessun grant (uso interno).
