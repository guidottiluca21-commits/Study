/** Tipi condivisi tra pipeline e interfaccia web. Nessuna dipendenza da Node o dal DOM. */

export type StudyType =
  | 'guideline'
  | 'meta_analysis'
  | 'systematic_review'
  | 'rct'
  | 'observational'
  | 'review'
  | 'other';

export type StudyTypeBasis = 'pubmed_tag' | 'inferred_from_text' | 'unknown';

export const STUDY_TYPE_LABEL_IT: Record<StudyType, string> = {
  guideline: 'Linea guida / consensus',
  meta_analysis: 'Meta-analisi',
  systematic_review: 'Revisione sistematica',
  rct: 'Trial randomizzato',
  observational: 'Studio osservazionale',
  review: 'Revisione narrativa',
  other: 'Altro',
};

export type CategoryGroup = 'icu' | 'anesthesia' | 'cross';

export interface Category {
  id: string;
  group_key: CategoryGroup;
  name_it: string;
  name_en: string;
  description?: string | null;
  pubmed_query: string;
  keywords: string[];
  sort_order: number;
  active: boolean;
}

/** Record bibliografico letto da PubMed. Nessun campo è inventato: ciò che manca resta null/vuoto. */
export interface ArticleRecord {
  pmid: string;
  doi: string | null;
  title: string;
  authors: string[];
  journal: string | null;
  pub_date: string | null; // YYYY-MM-DD (se mancano mese/giorno: primo del mese/anno)
  pub_date_text: string | null; // testo originale (es. "2026 Oct", "2025 Winter")
  entrez_date: string | null; // data di inserimento in PubMed
  abstract: string | null;
  mesh_terms: string[];
  pub_types: string[];
  study_type: StudyType;
  study_type_basis: StudyTypeBasis;
  retracted: boolean;
}

export interface CategoryMatch {
  category_id: string;
  match_score: number; // 0..1
  source: 'query' | 'keyword' | 'query+keyword';
}

export interface OverrideReason {
  criterion: 'design' | 'outcome' | 'size_rigor' | 'result' | 'guideline';
  statement: string;
  evidence: string; // frase o dato estratto dall'abstract/metadati (verificabile)
}

export interface ImportanceResult {
  formula_version: string;
  importance: number; // 0..100
  components: Record<string, number>;
  uncertainty: 'low' | 'medium' | 'high';
  uncertainty_reasons: string[];
  limitations: string[]; // limiti metodologici rilevati dal testo/metadati
  discordance_hint: string | null;
  excluded_reason: string | null;
  override_applied: boolean;
  override_reasons: OverrideReason[];
  sample_size: number | null;
}

export interface UserPrefs {
  topics: Record<string, number>; // category_id -> priorità 1..5
  study_types: StudyType[];
  max_weekly_reads: number;
  weekly_minutes: number;
  rest_days: number[]; // 0 = lunedì ... 6 = domenica
  core_enabled: boolean;
  core_topic_ids: string[]; // vuoto = tutti
}

export interface CoreItem {
  id: string;
  topic_id: string;
  position: number;
  pmid: string | null;
  doi: string | null;
  title: string;
  authors: string[];
  journal: string | null;
  pub_year: number | null;
  item_type: 'landmark_trial' | 'guideline' | 'review' | 'method';
  rationale: string;
  prerequisites: string[];
  objectives: string[];
  reading_minutes: number;
  verification: 'verified' | 'unverified' | 'mismatch';
  superseded_by: string | null;
  update_note: string | null;
  active: boolean;
}

export interface CoreTopic {
  id: string;
  category_id: string | null;
  title_it: string;
  title_en: string;
  sort_order: number;
  active: boolean;
}

export interface CoreProgressRow {
  item_id: string;
  status: 'sent' | 'reading' | 'completed' | 'to_review' | 'skipped';
  next_review_at: string | null; // YYYY-MM-DD
}

/** Articolo candidato per un utente (dopo classificazione e punteggio). */
export interface Candidate {
  article: ArticleRecord & { id?: number };
  categories: CategoryMatch[];
  importance: ImportanceResult;
}

export interface RankedItem {
  article: ArticleRecord & { id?: number };
  primary_category: string | null;
  personal_score: number; // 0..100
  importance: number; // 0..100
  final_score: number; // 0..100
  override_applied: boolean;
  override_reasons: OverrideReason[];
  reason: string; // motivo della selezione (testo)
  minutes: number;
  uncertainty: 'low' | 'medium' | 'high';
  limitations: string[];
  discordance_hint: string | null;
  sample_size: number | null;
}
