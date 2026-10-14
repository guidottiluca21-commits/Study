/**
 * Verifica del curriculum Core Knowledge: ogni articolo viene risolto su PubMed a partire dal
 * titolo; PMID, DOI, autori, rivista e anno vengono LETTI dal record PubMed (mai digitati a mano).
 * Un articolo non risolto con certezza non viene mai inviato (verification != 'verified').
 */
import type { ArticleRecord, CoreItem } from './types.ts';
import type { PubmedClient } from './pubmed-client.ts';

export interface CurriculumSourceItem {
  id: string;
  topic_id: string;
  position: number;
  title_query: string;
  expected_year: number;
  /** cognome del primo autore (facoltativo): serve solo a disambiguare titoli molto generici */
  author?: string;
  item_type: CoreItem['item_type'];
  rationale: string;
  prerequisites: string[];
  objectives: string[];
  reading_minutes: number;
}

export interface VerifiedItem extends CoreItem {
  editorial_status: 'draft_unreviewed';
  verified_at: string | null;
  title_query: string;
  match_score: number;
  verification_note: string | null;
}

const STOP = new Set(['a', 'an', 'the', 'of', 'in', 'and', 'for', 'to', 'on', 'with', 'versus', 'vs', 'or', 'by', 'at', 'from', 'trial', 'study']);

/** Parole che PubMed ignora nelle ricerche per campo ([ti]): includerle nella query dà 0 risultati. */
const PUBMED_STOP = new Set(('a about again all almost also although always among an and another any are as at be because been before being between both but by can could did do does done due during each either enough especially etc for found from further had has have having here how however i if in into is it its itself just kg km made mainly make may mg might ml mm most mostly must nearly neither no nor obtained of often on our overall perhaps pmid quite rather really regarding seem seen several should show showed shown shows significantly since so some such than that the their theirs them then there therefore these they this those through thus to upon use used using various very was we were what when which while with within without would').split(' '));

export function tokens(title: string): Set<string> {
  return new Set(
    title.toLowerCase().normalize('NFKD').replace(/-/g, '').replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((t) => t && !STOP.has(t)),
  );
}

/** Per la query PubMed i trattini separano le parole (ventilator-induced -> ventilator, induced). */
export function queryTokens(title: string): string[] {
  const words = title.toLowerCase().normalize('NFKD').replace(/[^a-z0-9\s]/g, ' ').split(/\s+/);
  return [...new Set(words.filter((t) => t && !STOP.has(t) && !PUBMED_STOP.has(t)))];
}

/** containment = quota dei termini attesi presenti nel titolo PubMed; jaccard evita titoli molto più lunghi. */
export function titleSimilarity(a: string, b: string): { containment: number; jaccard: number } {
  const A = tokens(a), B = tokens(b);
  if (!A.size || !B.size) return { containment: 0, jaccard: 0 };
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return { containment: inter / A.size, jaccard: inter / (A.size + B.size - inter) };
}

// 'Comment' non è escluso: alcuni articoli originali (es. linee guida) portano anche questo tag.
const NOT_ORIGINAL = new Set(['Editorial', 'Letter', 'Published Erratum', 'News', 'Retraction of Publication']);

export async function verifyItem(client: PubmedClient, src: CurriculumSourceItem, now: Date): Promise<VerifiedItem> {
  const base = {
    id: src.id, topic_id: src.topic_id, position: src.position, item_type: src.item_type, rationale: src.rationale,
    prerequisites: src.prerequisites, objectives: src.objectives, reading_minutes: src.reading_minutes,
    editorial_status: 'draft_unreviewed' as const, superseded_by: null, update_note: null, active: true, title_query: src.title_query,
  };
  const fail = (verification: 'unverified' | 'mismatch', note: string, score = 0): VerifiedItem => ({
    ...base, pmid: null, doi: null, title: src.title_query, authors: [], journal: null, pub_year: null,
    verification, verified_at: null, match_score: score, verification_note: note,
  });

  // Unione di due ricerche: frase esatta nel titolo e parole del titolo (±1 anno): la sola frase
  // può trovare solo commenti/lettere con lo stesso titolo, la sola ricerca per parole può mancare l'originale.
  const phraseIds = await client.findByTitle(src.title_query);
  const words = queryTokens(src.title_query).slice(0, 12).map((w) => `${w}[ti]`).join(' AND ');
  const authorClause = src.author ? ` AND ${src.author}[au]` : '';
  const tokenIds = words ? await client.searchTerm(`${words} AND ${src.expected_year - 1}:${src.expected_year + 1}[dp]${authorClause}`, 30) : [];
  const ids = [...new Set([...phraseIds, ...tokenIds])].slice(0, 35);
  if (!ids.length) return fail('unverified', 'nessun record PubMed trovato per il titolo');

  const recs = (await client.fetchArticles(ids)).filter((r) => !r.pub_types.some((t) => NOT_ORIGINAL.has(t)));
  const yr = (r: ArticleRecord) => (r.pub_date ? parseInt(r.pub_date.slice(0, 4), 10) : 9999);
  let best: { r: ArticleRecord; score: number; containment: number } | null = null;
  for (const r of recs) {
    const { containment, jaccard } = titleSimilarity(src.title_query, r.title);
    const better =
      !best ||
      containment + jaccard > best.containment + best.score + 1e-9 ||
      (Math.abs(containment + jaccard - best.containment - best.score) <= 1e-9 &&
        Math.abs(yr(r) - src.expected_year) < Math.abs(yr(best.r) - src.expected_year));
    if (better) best = { r, score: jaccard, containment };
  }
  if (!best) return fail('unverified', 'solo commenti/errata trovati');
  const year = best.r.pub_date ? parseInt(best.r.pub_date.slice(0, 4), 10) : null;
  const yearOk = year != null && Math.abs(year - src.expected_year) <= 1;
  if (best.containment < 0.9 || best.score < 0.5)
    return fail('mismatch', `titolo PubMed diverso (copertura ${best.containment.toFixed(2)}, somiglianza ${best.score.toFixed(2)}): «${best.r.title}»`, best.score);
  if (!yearOk) return fail('mismatch', `anno PubMed ${year ?? 'n/d'} diverso dall'atteso ${src.expected_year}`, best.score);

  return {
    ...base,
    pmid: best.r.pmid,
    doi: best.r.doi,
    title: best.r.title,
    authors: best.r.authors.slice(0, 3),
    journal: best.r.journal,
    pub_year: year,
    verification: 'verified',
    verified_at: now.toISOString(),
    match_score: Math.round(best.score * 100) / 100,
    verification_note: null,
  };
}
