import type { Candidate, Category, CoreItem, CoreProgressRow, CoreTopic, StudyType } from '../../core/types.ts';

export interface SessionInfo { userId: string; email: string; emailConfirmed: boolean }

export interface Profile {
  id: string;
  display_name: string | null;
  role: 'user' | 'admin';
  newsletter_status: 'pending' | 'active' | 'paused' | 'unsubscribed';
  paused_until: string | null;
  consent_at: string | null;
  onboarding_step: number;
  onboarding_completed: boolean;
  test_authorized: boolean;
}

export interface Prefs {
  max_weekly_reads: number;
  weekly_minutes: number;
  study_types: StudyType[];
  rest_days: number[];
  core_enabled: boolean;
}

export interface UserState {
  profile: Profile;
  prefs: Prefs;
  topics: Record<string, number>; // category_id -> priorità
  coreTopicIds: string[]; // vuoto = tutti
  categories: Category[];
  coreTopics: CoreTopic[];
  coreItems: CoreItem[];
  coreProgress: (CoreProgressRow & { completed_at?: string | null })[];
}

export interface IssueMeta { id: string; week_start: string; subject: string; status: 'generated' | 'sent' | 'failed'; created_at: string; sent_at: string | null; items: number; minutes: number }
export interface IssueFull extends IssueMeta { html: string; text_body: string }

export type ArticleStatus = 'received' | 'saved' | 'to_read' | 'completed' | 'to_review';
export interface LibraryRow {
  article_id: number; pmid: string; doi: string | null; title: string; journal: string | null; pub_date_text: string | null; study_type: StudyType;
  status: ArticleStatus; received_at: string; status_changed_at: string;
}

export interface AdminOverview {
  users: Record<'total' | 'pending' | 'active' | 'paused' | 'unsubscribed' | 'blocked', number>;
  articles: { total: number; last_7_days: number };
  core_items: { verified: number; unverified: number };
  deliveries_7d: { sent: number; failed: number; pending: number };
  quota_today: { provider: string; used: number }[];
  search_state: Record<string, unknown>;
  recent_runs: { id: string; kind: string; mode: string; status: string; started_at: string; finished_at: string | null; stats: Record<string, unknown>; error: string | null }[];
}
export interface AdminUser { id: string; email_masked: string; role: string; newsletter_status: string; blocked: boolean; test_authorized: boolean; created_at: string }

export interface SignUpResult { needsConfirmation: boolean }

export interface Api {
  readonly mode: 'supabase' | 'demo';
  // autenticazione
  getSession(): Promise<SessionInfo | null>;
  onAuthChange(cb: (s: SessionInfo | null, event: string) => void): () => void;
  signUp(email: string, password: string, captchaToken?: string): Promise<SignUpResult>;
  signIn(email: string, password: string, captchaToken?: string): Promise<void>;
  signOut(): Promise<void>;
  requestPasswordReset(email: string, captchaToken?: string): Promise<void>;
  updatePassword(password: string): Promise<void>;
  requestEmailChange(newEmail: string): Promise<void>;
  resendConfirmation(email: string): Promise<void>;
  // dati dell'utente
  loadState(): Promise<UserState>;
  saveName(name: string): Promise<void>;
  savePrefs(p: Prefs): Promise<void>;
  saveTopics(topics: Record<string, number>): Promise<void>;
  saveCoreTopics(ids: string[]): Promise<void>;
  setOnboarding(step: number, completed: boolean): Promise<void>;
  giveConsent(version: string): Promise<void>;
  pause(until: string | null): Promise<void>;
  resume(): Promise<void>;
  unsubscribe(): Promise<void>;
  unsubscribeByToken(token: string): Promise<boolean>;
  // libreria e newsletter
  library(): Promise<LibraryRow[]>;
  setArticleStatus(articleId: number, status: ArticleStatus): Promise<void>;
  setCoreStatus(itemId: string, status: 'sent' | 'reading' | 'completed' | 'to_review' | 'skipped'): Promise<void>;
  listIssues(): Promise<IssueMeta[]>;
  getIssue(id: string): Promise<IssueFull>;
  /** articoli recenti del catalogo condiviso, per l'anteprima calcolata nel browser */
  recentCandidates(days: number): Promise<Candidate[]>;
  receivedPmids(): Promise<Set<string>>;
  requestTestSend(): Promise<void>;
  // dati personali
  exportData(): Promise<unknown>;
  deleteAccount(): Promise<void>;
  // amministrazione
  admin: {
    overview(): Promise<AdminOverview>;
    users(): Promise<AdminUser[]>;
    setUserFlags(userId: string, blocked: boolean | null, testAuthorized: boolean | null): Promise<void>;
    saveCategory(c: Category & { isNew?: boolean }): Promise<void>;
  };
}
