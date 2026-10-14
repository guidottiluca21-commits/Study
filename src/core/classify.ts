/** Classificazione degli articoli per categoria (query di provenienza + parole chiave). */
import type { ArticleRecord, Category, CategoryMatch } from './types.ts';
import { escapeRegex } from './text.ts';

const kwRegexCache = new Map<string, RegExp>();
function kwRegex(kw: string): RegExp {
  let re = kwRegexCache.get(kw);
  if (!re) {
    // parola intera; i termini con trattino o spazio sono letterali
    re = new RegExp(`(?<![a-z0-9])${escapeRegex(kw.toLowerCase())}(?![a-z0-9])`, 'i');
    kwRegexCache.set(kw, re);
  }
  return re;
}

/** Punteggio parole chiave 0..1: titolo pesa 3, MeSH 2, abstract 1 (saturazione a 6). */
export function keywordScore(article: ArticleRecord, keywords: string[]): number {
  const title = article.title.toLowerCase();
  const abs = (article.abstract ?? '').toLowerCase();
  const mesh = article.mesh_terms.join(' | ').toLowerCase();
  let sum = 0;
  for (const kw of keywords) {
    const re = kwRegex(kw);
    if (re.test(title)) sum += 3;
    if (re.test(mesh)) sum += 2;
    if (re.test(abs)) sum += 1;
  }
  return Math.min(1, sum / 6);
}

/**
 * @param queryHits id delle categorie le cui query PubMed hanno restituito l'articolo
 */
export function classifyArticle(
  article: ArticleRecord,
  categories: Pick<Category, 'id' | 'keywords' | 'active'>[],
  queryHits: ReadonlySet<string>,
  minScore = 0.35,
): CategoryMatch[] {
  const out: CategoryMatch[] = [];
  for (const c of categories) {
    if (!c.active) continue;
    const kw = keywordScore(article, c.keywords);
    const hit = queryHits.has(c.id);
    // La query dà una base (la ricerca MeSH/parole chiave è già pertinente); le parole chiave rifiniscono.
    const score = hit ? Math.min(1, 0.5 + kw * 0.5) : kw * 0.7;
    if (score >= minScore) {
      out.push({
        category_id: c.id,
        match_score: Math.round(score * 100) / 100,
        source: hit && kw > 0 ? 'query+keyword' : hit ? 'query' : 'keyword',
      });
    }
  }
  return out.sort((a, b) => b.match_score - a.match_score);
}
