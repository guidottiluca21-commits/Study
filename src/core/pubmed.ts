/**
 * PubMed: costruzione delle query e lettura dei record XML (funzioni pure, senza rete).
 * Fonte primaria: NCBI E-utilities. Nessun metadato mancante viene inventato.
 */
import { XMLParser } from 'fast-xml-parser';
import type { ArticleRecord, Category, StudyType, StudyTypeBasis } from './types.ts';

/** Filtro sul disegno dello studio.
 *  I tag [pt] vengono assegnati da NLM con settimane di ritardo: per gli articoli
 *  recenti si cerca anche nel testo, e il tipo viene poi dedotto (inferStudyType). */
export const DESIGN_FILTER =
  '("Randomized Controlled Trial"[pt] OR "Meta-Analysis"[pt] OR "Systematic Review"[pt] OR "Practice Guideline"[pt] OR "Guideline"[pt] OR "Observational Study"[pt] OR randomized[tiab] OR randomised[tiab] OR meta-analysis[ti] OR "systematic review"[ti] OR guideline*[ti] OR consensus[ti])';

export function ymdSlash(d: Date): string {
  return `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}`;
}

export function buildCategoryTerm(category: Pick<Category, 'pubmed_query'>): string {
  return `(${category.pubmed_query}) AND ${DESIGN_FILTER} AND hasabstract AND english[la]`;
}

/** Finestra di ricerca: dall'ultima ricerca riuscita (con sovrapposizione per i record indicizzati in ritardo). */
export function computeSearchWindow(
  now: Date,
  lastSuccessfulSearch: Date | null,
  opts: { overlapDays?: number; defaultDays?: number; maxDays?: number } = {},
): { from: Date; to: Date } {
  const overlap = opts.overlapDays ?? 3;
  const defaultDays = opts.defaultDays ?? 10;
  const maxDays = opts.maxDays ?? 60;
  const dayMs = 86_400_000;
  let from = lastSuccessfulSearch
    ? new Date(lastSuccessfulSearch.getTime() - overlap * dayMs)
    : new Date(now.getTime() - defaultDays * dayMs);
  const floor = new Date(now.getTime() - maxDays * dayMs);
  if (from < floor) from = floor;
  return { from, to: now };
}

// ---------------------------------------------------------------------------
// Classificazione del tipo di studio
// ---------------------------------------------------------------------------

const EXCLUDED_PUB_TYPES = new Set([
  'Editorial', 'Comment', 'Letter', 'News', 'Newspaper Article', 'Published Erratum', 'Erratum',
  'Retraction of Publication', 'Expression of Concern', 'Interview', 'Biography', 'Congress',
  'Case Reports', 'Personal Narrative', 'Introductory Journal Article',
]);

export function excludedPubType(pubTypes: string[]): string | null {
  for (const t of pubTypes) if (EXCLUDED_PUB_TYPES.has(t)) return t;
  return null;
}

export function inferStudyType(
  pubTypes: string[],
  title: string,
  abstract: string | null,
): { type: StudyType; basis: StudyTypeBasis } {
  const has = (t: string) => pubTypes.includes(t);
  if (has('Practice Guideline') || has('Guideline')) return { type: 'guideline', basis: 'pubmed_tag' };
  if (has('Meta-Analysis')) return { type: 'meta_analysis', basis: 'pubmed_tag' };
  if (has('Systematic Review')) return { type: 'systematic_review', basis: 'pubmed_tag' };
  if (has('Randomized Controlled Trial') || has('Pragmatic Clinical Trial'))
    return { type: 'rct', basis: 'pubmed_tag' };
  if (has('Observational Study') || has('Cohort Studies') || has('Case-Control Studies'))
    return { type: 'observational', basis: 'pubmed_tag' };
  if (has('Review')) return { type: 'review', basis: 'pubmed_tag' };

  // Nessun tag utile (tipico degli articoli appena inseriti): si deduce dal testo.
  const t = title.toLowerCase();
  const head = (abstract ?? '').slice(0, 700).toLowerCase();
  if (/\b(guidelines?|consensus|practice advisory|recommendations)\b/.test(t))
    return { type: 'guideline', basis: 'inferred_from_text' };
  if (t.includes('meta-analy') || head.includes('meta-analy'))
    return { type: 'meta_analysis', basis: 'inferred_from_text' };
  if (t.includes('systematic review') || head.includes('systematic review'))
    return { type: 'systematic_review', basis: 'inferred_from_text' };
  if (/randomi[sz]ed/.test(t) || (/randomi[sz]ed/.test(head) && head.includes('trial')))
    return { type: 'rct', basis: 'inferred_from_text' };
  if (/\b(cohort|observational|registry)\b/.test(t + ' ' + head.slice(0, 300)))
    return { type: 'observational', basis: 'inferred_from_text' };
  return { type: 'other', basis: 'unknown' };
}

// ---------------------------------------------------------------------------
// Lettura XML (efetch, retmode=xml)
// ---------------------------------------------------------------------------

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  processEntities: true,
  htmlEntities: true,
  isArray: (name) =>
    ['PubmedArticle', 'AbstractText', 'Author', 'PublicationType', 'MeshHeading', 'ArticleId', 'ELocationID', 'PubMedPubDate', 'CommentsCorrections'].includes(name),
});

function txt(node: unknown): string {
  if (node == null) return '';
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(txt).join(' ');
  if (typeof node === 'object') {
    const o = node as Record<string, unknown>;
    return Object.entries(o)
      .filter(([k]) => !k.startsWith('@_'))
      .map(([, v]) => txt(v))
      .join('');
  }
  return '';
}

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

function ymd(y: string, m: string | undefined, d: string | undefined): string | null {
  if (!/^\d{4}$/.test(y)) return null;
  let mm = 1;
  if (m) mm = /^\d+$/.test(m) ? parseInt(m, 10) : (MONTHS[m.slice(0, 3).toLowerCase()] ?? 1);
  const dd = d && /^\d+$/.test(d) ? parseInt(d, 10) : 1;
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  return `${y}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

function parseDates(art: any, pubmedData: any): { pub_date: string | null; pub_date_text: string | null; entrez: string | null } {
  let pub_date: string | null = null;
  let pub_date_text: string | null = null;
  const artDates = art?.ArticleDate;
  const ad = Array.isArray(artDates) ? artDates[0] : artDates;
  if (ad) pub_date = ymd(txt(ad.Year), txt(ad.Month) || undefined, txt(ad.Day) || undefined);
  const pd = art?.Journal?.JournalIssue?.PubDate;
  if (pd) {
    const y = txt(pd.Year);
    pub_date_text = clean([y, txt(pd.Month), txt(pd.Day), txt(pd.Season)].filter(Boolean).join(' ')) || clean(txt(pd.MedlineDate)) || null;
    if (!pub_date && y) pub_date = ymd(y, txt(pd.Month) || undefined, txt(pd.Day) || undefined);
    if (!pub_date && pd.MedlineDate) {
      const m = /(\d{4})/.exec(txt(pd.MedlineDate));
      if (m) pub_date = ymd(m[1]!, undefined, undefined);
    }
  }
  let entrez: string | null = null;
  for (const h of pubmedData?.History?.PubMedPubDate ?? []) {
    if (h?.['@_PubStatus'] === 'pubmed') entrez = ymd(txt(h.Year), txt(h.Month), txt(h.Day));
  }
  return { pub_date, pub_date_text, entrez };
}

export function parsePubmedXml(xml: string): ArticleRecord[] {
  // Il markup inline (<i>, <sub>...) compare solo nei campi di testo: si elimina prima del parsing.
  const flat = xml.replace(/<\/?(i|b|u|sub|sup|em|strong)(\s[^>]*)?>/gi, '');
  const doc = parser.parse(flat);
  const set = doc?.PubmedArticleSet;
  const articles: any[] = set?.PubmedArticle ?? [];
  const out: ArticleRecord[] = [];
  for (const pa of articles) {
    const mc = pa?.MedlineCitation;
    const pmid = clean(txt(mc?.PMID));
    const art = mc?.Article;
    if (!/^\d{1,9}$/.test(pmid) || !art) continue;
    const title = clean(txt(art.ArticleTitle)).replace(/\.$/, '');
    if (!title) continue;

    const absParts: string[] = [];
    for (const ab of art?.Abstract?.AbstractText ?? []) {
      const label = typeof ab === 'object' ? ab?.['@_Label'] : undefined;
      const t = clean(txt(ab));
      if (t) absParts.push(label ? `${String(label).toUpperCase()}: ${t}` : t);
    }

    const authors: string[] = [];
    const authorList: any[] = art?.AuthorList?.Author ?? [];
    for (const a of authorList.slice(0, 6)) {
      const last = clean(txt(a?.LastName));
      const ini = clean(txt(a?.Initials));
      const coll = clean(txt(a?.CollectiveName));
      if (last) authors.push(`${last}${ini ? ' ' + ini : ''}`);
      else if (coll) authors.push(coll);
    }
    if (authorList.length > 6) authors.push('et al.');

    const pubTypes: string[] = (art?.PublicationTypeList?.PublicationType ?? []).map((p: unknown) => clean(txt(p))).filter(Boolean);
    const mesh: string[] = (mc?.MeshHeadingList?.MeshHeading ?? []).map((m: any) => clean(txt(m?.DescriptorName))).filter(Boolean);

    let doi: string | null = null;
    const pubmedData = pa?.PubmedData;
    for (const id of pubmedData?.ArticleIdList?.ArticleId ?? []) {
      if (id?.['@_IdType'] === 'doi') doi = clean(txt(id)).toLowerCase();
    }
    if (!doi) {
      for (const e of art?.ELocationID ?? []) {
        if (e?.['@_EIdType'] === 'doi') doi = clean(txt(e)).toLowerCase();
      }
    }
    if (doi && !/^10\.\d{4,9}\//.test(doi)) doi = null;

    const retractedInList = (mc?.CommentsCorrectionsList?.CommentsCorrections ?? []).some(
      (c: any) => c?.['@_RefType'] === 'RetractionIn',
    );
    const retracted = retractedInList || pubTypes.includes('Retracted Publication');

    const { pub_date, pub_date_text, entrez } = parseDates(art, pubmedData);
    const abstract = absParts.length ? absParts.join('\n') : null;
    const st = inferStudyType(pubTypes, title, abstract);

    out.push({
      pmid,
      doi,
      title,
      authors,
      journal: clean(txt(art?.Journal?.ISOAbbreviation)) || clean(txt(art?.Journal?.Title)) || null,
      pub_date,
      pub_date_text,
      entrez_date: entrez,
      abstract,
      mesh_terms: mesh,
      pub_types: pubTypes,
      study_type: st.type,
      study_type_basis: st.basis,
      retracted,
    });
  }
  return out;
}
