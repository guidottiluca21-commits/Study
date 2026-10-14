import type { ArticleRecord } from '../../src/core/types';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function toXml(records: ArticleRecord[]): string {
  const arts = records.map((r) => {
    const [y, m, d] = (r.pub_date ?? '2026-10-01').split('-');
    const [ey, em, ed] = (r.entrez_date ?? r.pub_date ?? '2026-10-01').split('-');
    const abs = (r.abstract ?? '').split('\n').filter(Boolean).map((line) => {
      const mm = /^([A-Z][A-Z ]+):\s*(.*)$/.exec(line);
      return mm ? `<AbstractText Label="${mm[1]}">${esc(mm[2]!)}</AbstractText>` : `<AbstractText>${esc(line)}</AbstractText>`;
    }).join('');
    return `<PubmedArticle><MedlineCitation Status="MEDLINE"><PMID Version="1">${r.pmid}</PMID><Article PubModel="Print-Electronic">
<Journal><ISOAbbreviation>${esc(r.journal ?? 'J Test')}</ISOAbbreviation><Title>${esc(r.journal ?? 'J Test')}</Title><JournalIssue><PubDate><Year>${y}</Year><Month>${m}</Month></PubDate></JournalIssue></Journal>
<ArticleTitle>${esc(r.title)}.</ArticleTitle>${abs ? `<Abstract>${abs}</Abstract>` : ''}
<AuthorList>${r.authors.map((a) => { const [l, i] = a.split(' '); return `<Author><LastName>${esc(l!)}</LastName><Initials>${esc(i ?? '')}</Initials></Author>`; }).join('')}</AuthorList>
<PublicationTypeList>${r.pub_types.map((t) => `<PublicationType>${esc(t)}</PublicationType>`).join('')}</PublicationTypeList>
<ArticleDate DateType="Electronic"><Year>${y}</Year><Month>${m}</Month><Day>${d ?? '01'}</Day></ArticleDate></Article>
<MeshHeadingList>${r.mesh_terms.map((t) => `<MeshHeading><DescriptorName>${esc(t)}</DescriptorName></MeshHeading>`).join('')}</MeshHeadingList></MedlineCitation>
<PubmedData><History><PubMedPubDate PubStatus="pubmed"><Year>${ey}</Year><Month>${em}</Month><Day>${ed ?? '01'}</Day></PubMedPubDate></History>
<ArticleIdList>${r.doi ? `<ArticleId IdType="doi">${esc(r.doi)}</ArticleId>` : ''}</ArticleIdList></PubmedData></PubmedArticle>`;
  });
  return `<?xml version="1.0"?><PubmedArticleSet>${arts.join('')}</PubmedArticleSet>`;
}

export interface FakeCall { endpoint: string; term?: string; mindate?: string; maxdate?: string; ids?: string[] }

/** PubMed finto (solo rete: stesse URL e formati di E-utilities). I dati sono sintetici. */
export class FakePubmed {
  records = new Map<string, ArticleRecord>();
  hits = new Map<string, string[]>(); // frammento di query -> pmid
  calls: FakeCall[] = [];
  failTerm: ((term: string) => number | null) | null = null; // restituisce uno status HTTP per simulare errori
  failAll: number | null = null;
  failFirstN = 0;

  add(r: ArticleRecord, ...queries: string[]): void {
    this.records.set(r.pmid, r);
    for (const q of queries) this.hits.set(q, [...(this.hits.get(q) ?? []), r.pmid]);
  }

  fetch: typeof fetch = async (url, init) => {
    const u = String(url);
    const body = new URLSearchParams(String((init as RequestInit).body));
    const endpoint = u.includes('esearch') ? 'esearch' : 'efetch';
    const call: FakeCall = { endpoint, term: body.get('term') ?? undefined, mindate: body.get('mindate') ?? undefined, maxdate: body.get('maxdate') ?? undefined, ids: body.get('id')?.split(',') };
    this.calls.push(call);
    if (this.failFirstN > 0) { this.failFirstN--; return new Response('busy', { status: 429 }); }
    if (this.failAll) return new Response('error', { status: this.failAll });
    if (endpoint === 'esearch') {
      const term = body.get('term') ?? '';
      const st = this.failTerm?.(term);
      if (st) return new Response('error', { status: st });
      const ids = new Set<string>();
      for (const [frag, pmids] of this.hits) if (term.includes(frag)) pmids.forEach((p) => ids.add(p));
      return new Response(JSON.stringify({ esearchresult: { count: String(ids.size), idlist: [...ids] } }), { status: 200 });
    }
    const recs = (call.ids ?? []).map((id) => this.records.get(id)).filter(Boolean) as ArticleRecord[];
    return new Response(toXml(recs), { status: 200 });
  };
}
