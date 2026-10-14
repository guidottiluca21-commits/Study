-- =============================================================================
-- 0002_rls.sql  —  Row Level Security e privilegi
--
-- Modello:
--  * ogni utente legge/scrive SOLO le proprie righe (user_id = auth.uid());
--  * catalogo articoli, categorie e curriculum sono leggibili dagli utenti
--    autenticati; solo gli amministratori modificano categorie e curriculum;
--  * il catalogo articoli è scritto solo dalla pipeline (connessione di servizio,
--    che aggira RLS): nessun client può scriverlo;
--  * tabelle operative (log, quote, rate limit) non sono accessibili ai client:
--    solo tramite funzioni di amministrazione (vedi 0003_functions.sql);
--  * l'amministratore NON ha accesso diretto a profili, preferenze o e-mail
--    degli utenti; vede solo aggregati e indirizzi mascherati.
-- IMPORTANTE: ogni nuova tabella in public deve avere RLS abilitata e privilegi
-- espliciti (Supabase concede di default tutti i privilegi ad anon/authenticated).
-- =============================================================================

-- Funzioni di supporto (usate dalle policy) -------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select p.role = 'admin' and not p.blocked from public.profiles p where p.id = auth.uid()),
    false);
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_updated    before update on public.profiles    for each row execute function public.set_updated_at();
create trigger preferences_updated before update on public.preferences for each row execute function public.set_updated_at();
create trigger categories_updated  before update on public.categories  for each row execute function public.set_updated_at();

-- Partenza da zero: nessun privilegio ad anon/authenticated ----------------------
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;

-- Abilita RLS ovunque -------------------------------------------------------------
alter table public.profiles           enable row level security;
alter table public.consent_log        enable row level security;
alter table public.preferences        enable row level security;
alter table public.categories         enable row level security;
alter table public.user_topics        enable row level security;
alter table public.articles           enable row level security;
alter table public.article_categories enable row level security;
alter table public.article_scores     enable row level security;
alter table public.core_topics        enable row level security;
alter table public.core_items         enable row level security;
alter table public.user_core_topics   enable row level security;
alter table public.user_core_progress enable row level security;
alter table public.user_articles      enable row level security;
alter table public.newsletter_issues  enable row level security;
alter table public.newsletter_items   enable row level security;
alter table public.email_deliveries   enable row level security;
alter table public.automation_runs    enable row level security;
alter table public.search_state       enable row level security;
alter table public.quota_usage        enable row level security;
alter table public.rate_events        enable row level security;
alter table public.test_requests      enable row level security;

-- Dati individuali: solo le proprie righe ---------------------------------------
grant select on public.profiles to authenticated;
create policy profiles_select_own on public.profiles
  for select to authenticated using (id = (select auth.uid()));
-- nessun insert/update/delete diretto: si passa dalle funzioni (0003)

grant select on public.consent_log to authenticated;
create policy consent_select_own on public.consent_log
  for select to authenticated using (user_id = (select auth.uid()));

grant select, insert, update on public.preferences to authenticated;
create policy preferences_select_own on public.preferences
  for select to authenticated using (user_id = (select auth.uid()));
create policy preferences_insert_own on public.preferences
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy preferences_update_own on public.preferences
  for update to authenticated using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

grant select, insert, update, delete on public.user_topics to authenticated;
create policy user_topics_own on public.user_topics
  for all to authenticated using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

grant select, insert, delete on public.user_core_topics to authenticated;
create policy user_core_topics_own on public.user_core_topics
  for all to authenticated using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

grant select, insert, update on public.user_core_progress to authenticated;
create policy user_core_progress_own on public.user_core_progress
  for all to authenticated using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

grant select, insert, update, delete on public.user_articles to authenticated;
create policy user_articles_own on public.user_articles
  for all to authenticated using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

grant select on public.newsletter_issues to authenticated;
create policy issues_select_own on public.newsletter_issues
  for select to authenticated using (user_id = (select auth.uid()));

grant select on public.newsletter_items to authenticated;
create policy items_select_own on public.newsletter_items
  for select to authenticated using (exists (
    select 1 from public.newsletter_issues i
    where i.id = newsletter_items.issue_id and i.user_id = (select auth.uid())));

grant select on public.email_deliveries to authenticated;
create policy deliveries_select_own on public.email_deliveries
  for select to authenticated using (user_id = (select auth.uid()));

grant select on public.test_requests to authenticated;
create policy test_requests_select_own on public.test_requests
  for select to authenticated using (user_id = (select auth.uid()));

-- Dati condivisi: lettura per utenti autenticati --------------------------------
grant select on public.articles, public.article_categories, public.article_scores to authenticated;
create policy articles_read on public.articles for select to authenticated using (true);
create policy article_categories_read on public.article_categories for select to authenticated using (true);
create policy article_scores_read on public.article_scores for select to authenticated using (true);

grant select on public.categories, public.core_topics, public.core_items to authenticated;
create policy categories_read on public.categories for select to authenticated using (true);
create policy core_topics_read on public.core_topics for select to authenticated using (true);
create policy core_items_read on public.core_items for select to authenticated using (true);

-- Solo gli amministratori modificano categorie e curriculum condivisi -------------
grant insert, update, delete on public.categories, public.core_topics, public.core_items to authenticated;
create policy categories_admin_ins on public.categories for insert to authenticated with check (public.is_admin());
create policy categories_admin_upd on public.categories for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy categories_admin_del on public.categories for delete to authenticated using (public.is_admin());
create policy core_topics_admin_ins on public.core_topics for insert to authenticated with check (public.is_admin());
create policy core_topics_admin_upd on public.core_topics for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy core_topics_admin_del on public.core_topics for delete to authenticated using (public.is_admin());
create policy core_items_admin_ins on public.core_items for insert to authenticated with check (public.is_admin());
create policy core_items_admin_upd on public.core_items for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy core_items_admin_del on public.core_items for delete to authenticated using (public.is_admin());

-- Tabelle operative: RLS attiva e NESSUNA policy => inaccessibili ai client ---------
-- (automation_runs, search_state, quota_usage, rate_events): solo pipeline e funzioni
-- SECURITY DEFINER di amministrazione.
