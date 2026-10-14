import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import type { Candidate, Category, CategoryMatch, StudyType } from '../../core/types.ts';
import { scoreImportance } from '../../core/scoring.ts';
import type { AdminOverview, AdminUser, Api, ArticleStatus, IssueFull, IssueMeta, LibraryRow, Prefs, SessionInfo, UserState } from './types.ts';

const siteBase = () => location.origin + location.pathname;
const todayPlus = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

function fail(error: { message: string } | null): void {
  if (error) throw new Error(error.message);
}

export function createSupabaseApi(url: string, anonKey: string): Api {
  const sb: SupabaseClient = createClient(url, anonKey, {
    auth: { flowType: 'pkce', detectSessionInUrl: true, persistSession: true, autoRefreshToken: true },
  });
  const toSession = (u: User | null | undefined): SessionInfo | null =>
    u ? { userId: u.id, email: u.email ?? '', emailConfirmed: !!u.email_confirmed_at } : null;

  let uidCache: string | null = null;
  const uid = async (): Promise<string> => {
    if (uidCache) return uidCache;
    const { data } = await sb.auth.getUser();
    if (!data.user) throw new Error('not_authenticated');
    uidCache = data.user.id;
    return uidCache;
  };
  const rpc = async <T = unknown>(fn: string, args?: Record<string, unknown>): Promise<T> => {
    const { data, error } = await sb.rpc(fn, args);
    fail(error);
    return data as T;
  };

  const api: Api = {
    mode: 'supabase',

    async getSession() {
      const { data } = await sb.auth.getSession();
      return toSession(data.session?.user);
    },
    onAuthChange(cb) {
      const { data } = sb.auth.onAuthStateChange((event, session) => {
        uidCache = session?.user.id ?? null;
        cb(toSession(session?.user), event);
      });
      return () => data.subscription.unsubscribe();
    },
    async signUp(email, password, captchaToken) {
      const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: siteBase(), captchaToken } });
      fail(error);
      return { needsConfirmation: !data.session };
    },
    async signIn(email, password, captchaToken) {
      const { error } = await sb.auth.signInWithPassword({ email, password, options: { captchaToken } });
      fail(error);
    },
    async signOut() { fail((await sb.auth.signOut()).error); uidCache = null; },
    async requestPasswordReset(email, captchaToken) {
      fail((await sb.auth.resetPasswordForEmail(email, { redirectTo: siteBase() + '#/reset', captchaToken })).error);
    },
    async updatePassword(password) { fail((await sb.auth.updateUser({ password })).error); },
    async requestEmailChange(newEmail) { fail((await sb.auth.updateUser({ email: newEmail }, { emailRedirectTo: siteBase() })).error); },
    async resendConfirmation(email) { fail((await sb.auth.resend({ type: 'signup', email, options: { emailRedirectTo: siteBase() } })).error); },

    async loadState(): Promise<UserState> {
      const id = await uid();
      const [p, pr, tp, ct, cats, cts, cis, prog] = await Promise.all([
        sb.from('profiles').select('id, display_name, role, newsletter_status, paused_until, consent_at, onboarding_step, onboarding_completed, test_authorized').eq('id', id).single(),
        sb.from('preferences').select('max_weekly_reads, weekly_minutes, study_types, rest_days, core_enabled').eq('user_id', id).single(),
        sb.from('user_topics').select('category_id, priority').eq('user_id', id),
        sb.from('user_core_topics').select('topic_id').eq('user_id', id),
        sb.from('categories').select('id, group_key, name_it, name_en, description, pubmed_query, keywords, sort_order, active').order('sort_order'),
        sb.from('core_topics').select('id, category_id, title_it, title_en, sort_order, active').eq('active', true).order('sort_order'),
        sb.from('core_items').select('id, topic_id, position, pmid, doi, title, authors, journal, pub_year, item_type, rationale, prerequisites, objectives, reading_minutes, verification, superseded_by, update_note, active').eq('active', true).eq('verification', 'verified').order('position'),
        sb.from('user_core_progress').select('item_id, status, next_review_at, completed_at').eq('user_id', id),
      ]);
      for (const r of [p, pr, tp, ct, cats, cts, cis, prog]) fail(r.error);
      return {
        profile: p.data as UserState['profile'],
        prefs: pr.data as Prefs,
        topics: Object.fromEntries((tp.data ?? []).map((t: { category_id: string; priority: number }) => [t.category_id, t.priority])),
        coreTopicIds: (ct.data ?? []).map((t: { topic_id: string }) => t.topic_id),
        categories: (cats.data ?? []) as Category[],
        coreTopics: (cts.data ?? []) as UserState['coreTopics'],
        coreItems: (cis.data ?? []) as UserState['coreItems'],
        coreProgress: (prog.data ?? []) as UserState['coreProgress'],
      };
    },

    async saveName(name) { await rpc('update_profile', { p_display_name: name, p_locale: null }); },
    async savePrefs(p) {
      const id = await uid();
      fail((await sb.from('preferences').update({ max_weekly_reads: p.max_weekly_reads, weekly_minutes: p.weekly_minutes, study_types: p.study_types, rest_days: p.rest_days, core_enabled: p.core_enabled }).eq('user_id', id)).error);
    },
    async saveTopics(topics) {
      const id = await uid();
      const ids = Object.keys(topics);
      const del = sb.from('user_topics').delete().eq('user_id', id);
      fail((ids.length ? await del.not('category_id', 'in', `(${ids.map((i) => `"${i}"`).join(',')})`) : await del).error);
      if (ids.length) fail((await sb.from('user_topics').upsert(ids.map((c) => ({ user_id: id, category_id: c, priority: topics[c] })), { onConflict: 'user_id,category_id' })).error);
    },
    async saveCoreTopics(ids) {
      const id = await uid();
      const del = sb.from('user_core_topics').delete().eq('user_id', id);
      fail((ids.length ? await del.not('topic_id', 'in', `(${ids.map((i) => `"${i}"`).join(',')})`) : await del).error);
      if (ids.length) fail((await sb.from('user_core_topics').upsert(ids.map((t) => ({ user_id: id, topic_id: t })), { onConflict: 'user_id,topic_id' })).error);
    },
    async setOnboarding(step, completed) { await rpc('set_onboarding', { p_step: step, p_completed: completed }); },
    async giveConsent(version) { await rpc('give_newsletter_consent', { p_version: version }); },
    async pause(until) { await rpc('pause_newsletter', { p_until: until }); },
    async resume() { await rpc('resume_newsletter'); },
    async unsubscribe() { await rpc('unsubscribe_me'); },
    async unsubscribeByToken(token) { return !!(await rpc<boolean>('unsubscribe_by_token', { p_token: token })); },

    async library(): Promise<LibraryRow[]> {
      const { data, error } = await sb.from('user_articles')
        .select('article_id, status, received_at, status_changed_at, articles(pmid, doi, title, journal, pub_date_text, study_type)')
        .order('status_changed_at', { ascending: false }).limit(1000);
      fail(error);
      return (data ?? []).map((r: any) => ({ article_id: r.article_id, status: r.status, received_at: r.received_at, status_changed_at: r.status_changed_at, ...r.articles }));
    },
    async setArticleStatus(articleId, status: ArticleStatus) {
      const id = await uid();
      fail((await sb.from('user_articles').update({ status, status_changed_at: new Date().toISOString() }).eq('user_id', id).eq('article_id', articleId)).error);
    },
    async setCoreStatus(itemId, status) {
      const id = await uid();
      const now = new Date().toISOString();
      fail((await sb.from('user_core_progress').upsert({
        user_id: id, item_id: itemId, status, updated_at: now,
        completed_at: status === 'completed' ? now : null,
        next_review_at: status === 'to_review' ? todayPlus(30) : null,
      }, { onConflict: 'user_id,item_id' })).error);
    },
    async listIssues(): Promise<IssueMeta[]> {
      const { data, error } = await sb.from('newsletter_issues').select('id, week_start, subject, status, created_at, sent_at, newsletter_items(minutes)').order('week_start', { ascending: false }).limit(200);
      fail(error);
      return (data ?? []).map((r: any) => ({ id: r.id, week_start: r.week_start, subject: r.subject, status: r.status, created_at: r.created_at, sent_at: r.sent_at, items: r.newsletter_items.length, minutes: r.newsletter_items.reduce((a: number, x: { minutes: number | null }) => a + (x.minutes ?? 0), 0) }));
    },
    async getIssue(id): Promise<IssueFull> {
      const { data, error } = await sb.from('newsletter_issues').select('id, week_start, subject, status, created_at, sent_at, html, text_body, newsletter_items(minutes)').eq('id', id).single();
      fail(error);
      const r = data as any;
      return { id: r.id, week_start: r.week_start, subject: r.subject, status: r.status, created_at: r.created_at, sent_at: r.sent_at, html: r.html, text_body: r.text_body, items: r.newsletter_items.length, minutes: r.newsletter_items.reduce((a: number, x: { minutes: number | null }) => a + (x.minutes ?? 0), 0) };
    },
    async recentCandidates(days): Promise<Candidate[]> {
      const since = todayPlus(-days);
      const { data, error } = await sb.from('articles')
        .select('id, pmid, doi, title, authors, journal, pub_date, pub_date_text, entrez_date, abstract, mesh_terms, pub_types, study_type, study_type_basis, retracted, article_categories(category_id, match_score, source)')
        .gte('entrez_date', since).eq('retracted', false).order('entrez_date', { ascending: false }).limit(1000);
      fail(error);
      const now = new Date();
      return (data ?? []).map((row: any) => {
        const { article_categories, ...article } = row;
        const categories: CategoryMatch[] = (article_categories ?? []).map((c: any) => ({ category_id: c.category_id, match_score: Number(c.match_score), source: c.source }));
        return { article, categories, importance: scoreImportance(article, now) };
      });
    },
    async receivedPmids() {
      const { data, error } = await sb.from('user_articles').select('articles(pmid)').limit(5000);
      fail(error);
      return new Set((data ?? []).map((r: any) => r.articles?.pmid).filter(Boolean));
    },
    async requestTestSend() { await rpc('request_test_send'); },
    async exportData() { return rpc('export_my_data'); },
    async deleteAccount() { await rpc('delete_my_account'); await sb.auth.signOut({ scope: 'local' }).catch(() => undefined); uidCache = null; },

    admin: {
      overview: () => rpc<AdminOverview>('admin_overview'),
      users: () => rpc<AdminUser[]>('admin_list_users'),
      async setUserFlags(userId, blocked, testAuthorized) { await rpc('admin_set_user_flags', { p_user: userId, p_blocked: blocked, p_test_authorized: testAuthorized }); },
      async saveCategory(c) {
        const row = { id: c.id, group_key: c.group_key, name_it: c.name_it, name_en: c.name_en, description: c.description ?? null, pubmed_query: c.pubmed_query, keywords: c.keywords, sort_order: c.sort_order, active: c.active };
        fail((await sb.from('categories').upsert(row, { onConflict: 'id' })).error);
      },
    },
  };
  return api;
}

export type { StudyType };
