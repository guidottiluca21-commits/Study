import type { ArticleRecord } from '../../src/core/types';

let seq = 1000;
/** Crea un record di test. I testi sono SINTETICI e servono solo a esercitare la logica. */
export function mk(o: Partial<ArticleRecord> = {}): ArticleRecord {
  const pmid = o.pmid ?? String(seq++);
  return {
    pmid,
    doi: null,
    title: 'Titolo di prova',
    authors: ['Rossi M'],
    journal: 'J Test',
    pub_date: '2026-10-05',
    pub_date_text: '2026 Oct',
    entrez_date: '2026-10-06',
    abstract: 'BACKGROUND: Testo di prova. RESULTS: nessun risultato.',
    mesh_terms: [],
    pub_types: ['Journal Article'],
    study_type: 'other',
    study_type_basis: 'unknown',
    retracted: false,
    ...o,
  };
}

export const NOW = new Date('2026-10-12T04:00:00Z');

export const BIG_RCT = mk({
  title: 'Early intervention X in septic shock: a multicenter randomized clinical trial',
  study_type: 'rct',
  study_type_basis: 'pubmed_tag',
  pub_types: ['Randomized Controlled Trial', 'Multicenter Study', 'Journal Article'],
  abstract: [
    'BACKGROUND: Sepsis causes high mortality.',
    'METHODS: In this multicenter, double-blind, placebo-controlled trial (NCT01234567) conducted in 62 hospitals, we randomized 2,500 adult patients with septic shock. Analysis was by intention-to-treat. The primary outcome was 28-day all-cause mortality.',
    'RESULTS: Mortality at 28 days was 27.1% in the intervention group and 31.4% in the control group (hazard ratio 0.84; 95% CI 0.74 to 0.95; P=0.006). Patients receiving the intervention had significantly lower mortality.',
    'CONCLUSIONS: In patients with septic shock, the intervention reduced 28-day mortality.',
  ].join('\n'),
});
