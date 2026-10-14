/**
 * Modalità DEMO: implementa la stessa interfaccia `Api` interamente nel browser (localStorage),
 * senza backend e senza inviare e-mail. Serve a provare l'interfaccia e ai test automatici.
 * NON è sicura né condivisa: non usarla per dati reali. Viene inclusa solo con VITE_ENABLE_DEMO=1.
 *
 * Differenza dichiarata rispetto alla produzione: qui la "newsletter di prova" viene anche
 * archiviata (in produzione le newsletter sono generate solo dall'automazione settimanale).
 */
import type { ArticleRecord, Candidate, Category, CoreItem, CoreProgressRow, CoreTopic } from '../../core/types.ts';
import { classifyArticle } from '../../core/classify.ts';
import { scoreImportance } from '../../core/scoring.ts';
import { buildIssue } from '../../core/issue.ts';
import { weekStartRome, romeParts } from '../../core/schedule.ts';
import categoriesJson from '../../../data/categories.json';
import curriculumJson from '../../../data/curriculum.json';
import articlesJson from '../demo/articles.json';
import type { AdminOverview, AdminUser, Api, ArticleStatus, IssueFull, LibraryRow, Prefs, SessionInfo, UserState } from './types.ts';

const KEY = 'acc-digest.demo.v1';
const categories = categoriesJson as unknown as Category[];
const curriculum = curriculumJson as unknown as { topics: CoreTopic[]; items: (CoreItem & { verification: string })[] };

interface DemoUser {
  id: string; email: string; password: string; confirmed: boolean;
  profile: UserState['profile']; prefs: Prefs; topics: Record<string, number>; coreTopicIds: string[];
  coreProgress: UserState['coreProgress']; library: { article_id: number; status: ArticleStatus; received_at: string; status_changed_at: string }[];
  issues: IssueFull[]; blocked: boolean;
}
interface DemoDb { users: DemoUser[]; current: string | null; seq: number }

function load(): DemoDb {
  try { const raw = localStorage.getItem(KEY); if (raw) return JSON.parse(raw) as DemoDb; } catch { /* ignora */ }
  return { users: [], current: null, seq: 1 };
}
let db = load();
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { /* storage non disponibile */ } };
const me = (): DemoUser => {
  const u = db.users.find((x) => x.id === db.current);
  if (!u) throw new Error('not_authenticated');
  return u;
};
const listeners = new Set<(s: SessionInfo | null, event: string) => void>();
const session = (u: DemoUser | undefined): SessionInfo | null => (u ? { userId: u.id, email: u.email, emailConfirmed: u.confirmed } : null);
const emit = (event: string) => listeners.forEach((l) => l(session(db.users.find((x) => x.id === db.current)), event));

const now = () => new Date();
type DemoArticle = ArticleRecord & { id: number };
const articles: DemoArticle[] = (articlesJson as unknown as DemoArticle[]).map((a, i) => {
  // le date vengono spostate agli ultimi giorni, così l'anteprima mostra "novità"
  const d = new Date(Date.now() - (2 + i) * 86_400_000).toISOString().slice(0, 10);
  return { ...a, pub_date: d, entrez_date: d, pub_date_text: d };
});

function candidates(): Candidate[] {
  return articles.map((a) => {
    const matches = classifyArticle(a, categories, new Set());
    return { article: a, categories: matches, importance: scoreImportance(a, now()) };
  }).filter((c) => c.categories.length);
}

function newUser(email: string, password: string): DemoUser {
  const id = `demo-${db.seq++}`;
  return {
    id, email, password, confirmed: true, blocked: false,
    profile: { id, display_name: null, role: email === 'admin@demo.test' ? 'admin' : 'user', newsletter_status: 'pending', paused_until: null, consent_at: null, onboarding_step: 0, onboarding_completed: false, test_authorized: true },
    prefs: { max_weekly_reads: 6, weekly_minutes: 120, study_types: [], rest_days: [], core_enabled: true },
    topics: {}, coreTopicIds: [], coreProgress: [], library: [], issues: [],
  };
}

const tick = <T>(v: T): Promise<T> => Promise.resolve(v);

export function createDemoApi(): Api {
  const api: Api = {
    mode: 'demo',
    getSession: () => tick(session(db.users.find((x) => x.id === db.current))),
    onAuthChange(cb) { listeners.add(cb); return () => { listeners.delete(cb); }; },
    async signUp(email, password) {
      if (db.users.some((u) => u.email === email.toLowerCase())) return { needsConfirmation: false };
      const u = newUser(email.toLowerCase(), password);
      db.users.push(u); db.current = u.id; save(); emit('SIGNED_IN');
      return { needsConfirmation: false };
    },
    async signIn(email, password) {
      const u = db.users.find((x) => x.email === email.toLowerCase());
      if (!u || u.password !== password) throw new Error('Invalid login credentials');
      db.current = u.id; save(); emit('SIGNED_IN');
    },
    async signOut() { db.current = null; save(); emit('SIGNED_OUT'); },
    async requestPasswordReset() { /* demo: nessuna e-mail */ },
    async updatePassword(password) { me().password = password; save(); },
    async requestEmailChange(newEmail) { me().email = newEmail.toLowerCase(); save(); },
    async resendConfirmation() { /* demo */ },

    async loadState(): Promise<UserState> {
      const u = me();
      return {
        profile: u.profile, prefs: u.prefs, topics: u.topics, coreTopicIds: u.coreTopicIds,
        categories: categories.filter((c) => c.active), coreTopics: curriculum.topics,
        coreItems: curriculum.items.filter((i) => i.verification === 'verified'), coreProgress: u.coreProgress,
      };
    },
    async saveName(name) { me().profile.display_name = name.trim() || null; save(); },
    async savePrefs(p) { me().prefs = p; save(); },
    async saveTopics(t) { me().topics = t; save(); },
    async saveCoreTopics(ids) { me().coreTopicIds = ids; save(); },
    async setOnboarding(step, completed) { const u = me(); u.profile.onboarding_step = Math.max(u.profile.onboarding_step, step); u.profile.onboarding_completed ||= completed; save(); },
    async giveConsent() { const u = me(); u.profile.newsletter_status = 'active'; u.profile.consent_at = now().toISOString(); u.profile.paused_until = null; save(); },
    async pause(until) { const u = me(); u.profile.newsletter_status = 'paused'; u.profile.paused_until = until; save(); },
    async resume() { const u = me(); u.profile.newsletter_status = 'active'; u.profile.paused_until = null; save(); },
    async unsubscribe() { me().profile.newsletter_status = 'unsubscribed'; save(); },
    async unsubscribeByToken(token) { return tick(token.length > 8); },

    async library(): Promise<LibraryRow[]> {
      const u = me();
      return u.library.map((l) => {
        const a = articles.find((x) => x.id === l.article_id)!;
        return { ...l, pmid: a.pmid, doi: a.doi, title: a.title, journal: a.journal, pub_date_text: a.pub_date_text, study_type: a.study_type };
      }).sort((a, b) => b.status_changed_at.localeCompare(a.status_changed_at));
    },
    async setArticleStatus(articleId, status) {
      const row = me().library.find((l) => l.article_id === articleId);
      if (row) { row.status = status; row.status_changed_at = now().toISOString(); save(); }
    },
    async setCoreStatus(itemId, status) {
      const u = me();
      const next = status === 'to_review' ? new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10) : null;
      const ex = u.coreProgress.find((p) => p.item_id === itemId);
      const row = { item_id: itemId, status, next_review_at: next, completed_at: status === 'completed' ? now().toISOString() : null } as CoreProgressRow & { completed_at: string | null };
      if (ex) Object.assign(ex, row); else u.coreProgress.push(row);
      save();
    },
    async listIssues() { return me().issues.map(({ html, text_body, ...m }) => m).sort((a, b) => b.week_start.localeCompare(a.week_start)); },
    async getIssue(id) { const i = me().issues.find((x) => x.id === id); if (!i) throw new Error('not found'); return i; },
    async recentCandidates() { return candidates(); },
    async receivedPmids() { const u = me(); return new Set(u.library.map((l) => articles.find((a) => a.id === l.article_id)!.pmid)); },

    /** Demo: genera e archivia subito la newsletter della settimana (in produzione lo fa l'automazione). */
    async requestTestSend() {
      const u = me();
      const d = now();
      const weekStart = weekStartRome(d);
      const p = romeParts(d);
      const received = new Set(u.library.map((l) => articles.find((a) => a.id === l.article_id)!.pmid));
      const built = buildIssue({
        weekStart, now: d, todayRome: `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`, userName: u.profile.display_name,
        prefs: { topics: u.topics, study_types: u.prefs.study_types, max_weekly_reads: u.prefs.max_weekly_reads, weekly_minutes: u.prefs.weekly_minutes, rest_days: u.prefs.rest_days, core_enabled: u.prefs.core_enabled, core_topic_ids: u.coreTopicIds },
        candidates: candidates(), curriculum: { topics: curriculum.topics, items: curriculum.items.filter((i) => i.verification === 'verified') },
        alreadyReceived: received, coreProgress: u.coreProgress, categoryNames: Object.fromEntries(categories.map((c) => [c.id, c.name_it])),
        window: { from: weekStart, to: weekStart }, searchedAt: d,
        links: { site: location.origin + location.pathname, manage: '#/preferences', privacy: '#/privacy', unsubscribe: '#/account' },
        notes: ['Modalità DEMO: catalogo di esempio con record reali di PubMed; nessuna e-mail inviata.'],
      });
      if (built.out.empty) throw new Error('Nessun contenuto rilevante per le preferenze attuali.');
      const id = `issue-${u.issues.length + 1}`;
      const minutes = built.out.totalMinutes;
      u.issues = u.issues.filter((i) => i.week_start !== weekStart);
      u.issues.push({ id, week_start: weekStart, subject: built.out.subject, status: 'sent', created_at: d.toISOString(), sent_at: d.toISOString(), items: built.recent.length + (built.core ? 1 : 0), minutes, html: built.out.html, text_body: built.out.text });
      for (const r of built.recent) {
        const art = articles.find((a) => a.pmid === r.article.pmid)!;
        if (!u.library.some((l) => l.article_id === art.id)) u.library.push({ article_id: art.id, status: 'received', received_at: d.toISOString(), status_changed_at: d.toISOString() });
      }
      if (built.core && !u.coreProgress.some((c) => c.item_id === built.core!.item.id)) u.coreProgress.push({ item_id: built.core.item.id, status: 'sent', next_review_at: null });
      save();
    },

    async exportData() { const u = me(); const { password, ...safe } = u; void password; return { exported_at: now().toISOString(), demo: true, account: { email: u.email }, ...safe }; },
    async deleteAccount() { db.users = db.users.filter((x) => x.id !== db.current); db.current = null; save(); emit('SIGNED_OUT'); },

    admin: {
      async overview(): Promise<AdminOverview> {
        const count = (s: string) => db.users.filter((u) => u.profile.newsletter_status === s).length;
        return {
          users: { total: db.users.length, pending: count('pending'), active: count('active'), paused: count('paused'), unsubscribed: count('unsubscribed'), blocked: db.users.filter((u) => u.blocked).length },
          articles: { total: articles.length, last_7_days: articles.length }, core_items: { verified: curriculum.items.filter((i) => i.verification === 'verified').length, unverified: curriculum.items.filter((i) => i.verification !== 'verified').length },
          deliveries_7d: { sent: 0, failed: 0, pending: 0 }, quota_today: [], search_state: {}, recent_runs: [],
        };
      },
      async users(): Promise<AdminUser[]> {
        return db.users.map((u) => ({ id: u.id, email_masked: `${u.email[0]}***@${u.email.split('@')[1]!.replace(/^(.).*(\..*)$/, '$1***$2')}`, role: u.profile.role, newsletter_status: u.profile.newsletter_status, blocked: u.blocked, test_authorized: u.profile.test_authorized, created_at: now().toISOString() }));
      },
      async setUserFlags(id, blocked, test) { const u = db.users.find((x) => x.id === id); if (u) { if (blocked != null) u.blocked = blocked; if (test != null) u.profile.test_authorized = test; save(); } },
      async saveCategory(c) { const i = categories.findIndex((x) => x.id === c.id); if (i >= 0) categories[i] = c; else categories.push(c); },
    },
  };
  return api;
}
