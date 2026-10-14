-- =============================================================================
-- 0001_schema.sql  —  Schema dati (Postgres / Supabase)
--
-- Principi:
--  * dati CONDIVISI (catalogo articoli, categorie, curriculum) separati dai dati
--    INDIVIDUALI (profilo, preferenze, progressi, newsletter);
--  * nessun metadato di articolo duplicato per utente: gli utenti puntano a
--    public.articles / public.core_items tramite chiave esterna;
--  * l'indirizzo e-mail resta solo in auth.users (non è copiato nel profilo);
--  * le password non sono mai in tabelle dello schema public.
-- Le policy di accesso sono in 0002_rls.sql, le funzioni in 0003_functions.sql.
-- =============================================================================

-- ---------- profili e consensi ------------------------------------------------
create table public.profiles (
  id                   uuid primary key references auth.users (id) on delete cascade,
  display_name         text check (display_name is null or char_length(display_name) <= 80),
  role                 text not null default 'user' check (role in ('user', 'admin')),
  locale               text not null default 'it' check (locale in ('it', 'en')),
  onboarding_step      smallint not null default 0 check (onboarding_step between 0 and 6),
  onboarding_completed boolean not null default false,
  -- pending = registrato ma senza consenso; active = consenso dato; paused; unsubscribed
  newsletter_status    text not null default 'pending'
                       check (newsletter_status in ('pending', 'active', 'paused', 'unsubscribed')),
  paused_until         date,
  consent_at           timestamptz,
  consent_version      text,
  unsubscribed_at      timestamptz,
  unsubscribe_token    uuid not null default gen_random_uuid() unique,
  test_authorized      boolean not null default false,
  blocked              boolean not null default false,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
comment on column public.profiles.unsubscribe_token is
  'Token segreto per la disiscrizione con un clic dal link in e-mail (non esporre ad altri utenti).';

create table public.consent_log (
  id           bigserial primary key,
  user_id      uuid not null references auth.users (id) on delete cascade,
  event        text not null check (event in
                 ('consent_newsletter', 'pause', 'resume', 'unsubscribe', 'unsubscribe_token', 'export_data')),
  text_version text,
  at           timestamptz not null default now(),
  meta         jsonb not null default '{}'::jsonb
);
create index consent_log_user_idx on public.consent_log (user_id, at desc);

-- ---------- preferenze individuali ------------------------------------------
create table public.preferences (
  user_id          uuid primary key references public.profiles (id) on delete cascade,
  max_weekly_reads smallint not null default 6 check (max_weekly_reads between 1 and 21),
  weekly_minutes   smallint not null default 120 check (weekly_minutes between 15 and 1200),
  study_types      text[] not null default '{}'
                   check (study_types <@ array['guideline', 'meta_analysis', 'systematic_review',
                                               'rct', 'observational', 'review']::text[]),
  -- giorni liberi: 0 = lunedì ... 6 = domenica
  rest_days        smallint[] not null default '{}'
                   check (rest_days <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[]),
  core_enabled     boolean not null default true,
  updated_at       timestamptz not null default now()
);

-- ---------- categorie (modificabili senza toccare il codice) -----------------
create table public.categories (
  id           text primary key check (id ~ '^[a-z0-9][a-z0-9_-]{1,60}$'),
  parent_id    text references public.categories (id) on delete set null,
  group_key    text not null check (group_key in ('icu', 'anesthesia', 'cross')),
  name_it      text not null,
  name_en      text not null,
  description  text,
  -- frammento di query PubMed (MeSH + parole chiave) usato dalla ricerca condivisa
  pubmed_query text not null,
  -- parole chiave (minuscole) usate per classificare titolo/abstract/MeSH
  keywords     text[] not null default '{}',
  sort_order   int not null default 100,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table public.user_topics (
  user_id     uuid not null references public.profiles (id) on delete cascade,
  category_id text not null references public.categories (id) on delete cascade,
  priority    smallint not null default 3 check (priority between 1 and 5),
  primary key (user_id, category_id)
);

-- ---------- catalogo bibliografico condiviso --------------------------------
create table public.articles (
  id               bigserial primary key,
  pmid             text not null unique check (pmid ~ '^[0-9]{1,9}$'),
  doi              text check (doi is null or doi = lower(doi)),
  title            text not null,
  authors          text[] not null default '{}',
  journal          text,
  pub_date         date,
  pub_date_text    text,
  -- data in cui PubMed ha registrato il record (Entrez date): base per la finestra di ricerca
  entrez_date      date,
  abstract         text,
  mesh_terms       text[] not null default '{}',
  pub_types        text[] not null default '{}',
  study_type       text not null default 'other'
                   check (study_type in ('guideline', 'meta_analysis', 'systematic_review', 'rct',
                                         'observational', 'review', 'other')),
  study_type_basis text not null default 'pubmed_tag'
                   check (study_type_basis in ('pubmed_tag', 'inferred_from_text', 'unknown')),
  retracted        boolean not null default false,
  -- verified_pubmed = metadati letti dal record PubMed; non si inventano metadati mancanti
  reference_status text not null default 'verified_pubmed'
                   check (reference_status in ('verified_pubmed', 'unverified')),
  acquired_at      timestamptz not null default now(),
  refreshed_at     timestamptz not null default now()
);
create unique index articles_doi_uidx on public.articles (doi) where doi is not null;
create index articles_pub_date_idx on public.articles (pub_date desc);
create index articles_acquired_idx on public.articles (acquired_at desc);

create table public.article_categories (
  article_id  bigint not null references public.articles (id) on delete cascade,
  category_id text not null references public.categories (id) on delete cascade,
  match_score real not null check (match_score between 0 and 1),
  source      text not null check (source in ('query', 'keyword', 'query+keyword')),
  primary key (article_id, category_id)
);
create index article_categories_cat_idx on public.article_categories (category_id);

create table public.article_scores (
  article_id       bigint primary key references public.articles (id) on delete cascade,
  formula_version  text not null,
  scored_at        timestamptz not null default now(),
  importance       real not null check (importance between 0 and 100),
  components       jsonb not null,
  uncertainty      text not null check (uncertainty in ('low', 'medium', 'high')),
  override_applied boolean not null default false,
  override_reasons jsonb not null default '[]'::jsonb
);

-- ---------- percorso Core Knowledge (comune) --------------------------------
create table public.core_topics (
  id          text primary key check (id ~ '^[a-z0-9][a-z0-9_-]{1,60}$'),
  category_id text references public.categories (id) on delete set null,
  title_it    text not null,
  title_en    text not null,
  description text,
  sort_order  int not null default 100,
  active      boolean not null default true
);

create table public.core_items (
  id                text primary key check (id ~ '^[a-z0-9][a-z0-9_-]{1,80}$'),
  topic_id          text not null references public.core_topics (id) on delete cascade,
  position          int not null default 100,
  pmid              text check (pmid is null or pmid ~ '^[0-9]{1,9}$'),
  doi               text check (doi is null or doi = lower(doi)),
  -- metadati letti da PubMed (non digitati a mano)
  title             text not null,
  authors           text[] not null default '{}',
  journal           text,
  pub_year          smallint,
  item_type         text not null check (item_type in ('landmark_trial', 'guideline', 'review', 'method')),
  -- contenuto editoriale (bozza da revisione di un clinico)
  rationale         text not null,
  prerequisites     text[] not null default '{}',
  objectives        text[] not null default '{}',
  reading_minutes   smallint not null default 25 check (reading_minutes between 5 and 180),
  editorial_status  text not null default 'draft_unreviewed'
                    check (editorial_status in ('draft_unreviewed', 'reviewed')),
  verification      text not null default 'unverified'
                    check (verification in ('verified', 'unverified', 'mismatch')),
  verified_at       timestamptz,
  last_reviewed     date,
  update_note       text,
  superseded_by     text references public.core_items (id) on delete set null,
  active            boolean not null default true
);
create index core_items_topic_idx on public.core_items (topic_id, position);

create table public.user_core_topics (
  user_id  uuid not null references public.profiles (id) on delete cascade,
  topic_id text not null references public.core_topics (id) on delete cascade,
  primary key (user_id, topic_id)
);

-- ---------- progressi individuali -------------------------------------------
create table public.user_core_progress (
  user_id        uuid not null references public.profiles (id) on delete cascade,
  item_id        text not null references public.core_items (id) on delete cascade,
  status         text not null check (status in ('sent', 'reading', 'completed', 'to_review', 'skipped')),
  sent_at        timestamptz,
  completed_at   timestamptz,
  next_review_at date,
  review_count   smallint not null default 0,
  updated_at     timestamptz not null default now(),
  primary key (user_id, item_id)
);

create table public.user_articles (
  user_id            uuid not null references public.profiles (id) on delete cascade,
  article_id         bigint not null references public.articles (id) on delete cascade,
  status             text not null default 'received'
                     check (status in ('received', 'saved', 'to_read', 'completed', 'to_review')),
  received_at        timestamptz not null default now(),
  status_changed_at  timestamptz not null default now(),
  primary key (user_id, article_id)
);
create index user_articles_status_idx on public.user_articles (user_id, status);

-- ---------- newsletter e invii ----------------------------------------------
create table public.newsletter_issues (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  week_start  date not null,
  subject     text not null,
  html        text not null,
  text_body   text not null,
  language    text not null default 'it',
  status      text not null default 'generated'
              check (status in ('generated', 'sent', 'failed')),
  payload     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  sent_at     timestamptz,
  unique (user_id, week_start)
);

create table public.newsletter_items (
  id              bigserial primary key,
  issue_id        uuid not null references public.newsletter_issues (id) on delete cascade,
  position        smallint not null,
  kind            text not null check (kind in ('recent', 'core')),
  article_id      bigint references public.articles (id) on delete set null,
  core_item_id    text references public.core_items (id) on delete set null,
  planned_day     smallint check (planned_day between 0 and 6),
  minutes         smallint,
  reason          text,
  personal_score  real,
  importance      real,
  final_score     real,
  override_applied boolean not null default false,
  unique (issue_id, position),
  check ((kind = 'recent' and article_id is not null) or (kind = 'core' and core_item_id is not null))
);

create table public.email_deliveries (
  id                  uuid primary key default gen_random_uuid(),
  -- le e-mail di prova non creano una newsletter archiviata: issue_id nullo solo per kind = 'test'
  issue_id            uuid references public.newsletter_issues (id) on delete cascade,
  user_id             uuid not null references public.profiles (id) on delete cascade,
  kind                text not null default 'newsletter' check (kind in ('newsletter', 'test')),
  -- chiave di idempotenza: un solo invio per utente/settimana/tipo
  idempotency_key     text not null unique,
  status              text not null default 'pending'
                      check (status in ('pending', 'sent', 'failed')),
  attempts            smallint not null default 0,
  provider_message_id text,
  last_error          text,
  created_at          timestamptz not null default now(),
  sent_at             timestamptz,
  updated_at          timestamptz not null default now(),
  check (kind = 'test' or issue_id is not null)
);
create index email_deliveries_status_idx on public.email_deliveries (status, created_at);

-- ---------- operatività -----------------------------------------------------
create table public.automation_runs (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null check (kind in ('weekly', 'search', 'requests')),
  mode         text not null check (mode in ('live', 'simulate')),
  status       text not null default 'running'
               check (status in ('running', 'success', 'partial', 'failed')),
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  stats        jsonb not null default '{}'::jsonb,
  error        text,
  github_run_id text
);
create index automation_runs_started_idx on public.automation_runs (started_at desc);

create table public.search_state (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

create table public.quota_usage (
  provider   text not null,
  period_key text not null,
  used       integer not null default 0,
  primary key (provider, period_key)
);

create table public.rate_events (
  id      bigserial primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  action  text not null,
  at      timestamptz not null default now()
);
create index rate_events_idx on public.rate_events (user_id, action, at desc);

create table public.test_requests (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles (id) on delete cascade,
  kind         text not null default 'send_test' check (kind in ('send_test')),
  status       text not null default 'queued' check (status in ('queued', 'done', 'failed')),
  requested_at timestamptz not null default now(),
  processed_at timestamptz,
  result       jsonb
);
create index test_requests_status_idx on public.test_requests (status, requested_at);
