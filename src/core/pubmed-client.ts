/**
 * Client NCBI E-utilities con rispetto dei limiti (3 richieste/s senza chiave, 10/s con chiave),
 * retry con backoff e conteggio delle richieste. Rete e tempo sono iniettabili per i test.
 * Nessun tentativo di aggirare i limiti: la chiave API NCBI è gratuita e opzionale.
 */
import type { ArticleRecord } from './types.ts';
import { parsePubmedXml } from './pubmed.ts';
import { HttpError, defaultSleep, withRetry } from './retry.ts';

const BASE = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/';

export interface PubmedClientOptions {
  fetchFn?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  apiKey?: string;
  email?: string;
  tool?: string;
  minIntervalMs?: number; // default: 340 ms (333 con chiave: 110 ms)
  maxAttempts?: number;
  onLog?: (msg: string) => void;
}

export interface SearchWindow { from: Date; to: Date }

export class PubmedClient {
  readonly stats = { requests: 0, retries: 0 };
  private lastRequestAt = 0;
  private readonly f: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly minInterval: number;

  constructor(private readonly o: PubmedClientOptions = {}) {
    this.f = o.fetchFn ?? fetch;
    this.sleep = o.sleep ?? defaultSleep;
    this.now = o.now ?? Date.now;
    this.minInterval = o.minIntervalMs ?? (o.apiKey ? 110 : 340);
  }

  private async throttle(): Promise<void> {
    const wait = this.lastRequestAt + this.minInterval - this.now();
    if (wait > 0) await this.sleep(wait);
    this.lastRequestAt = this.now();
  }

  private params(extra: Record<string, string>): URLSearchParams {
    const p = new URLSearchParams({ tool: this.o.tool ?? 'anesthesia-cc-digest', ...extra });
    if (this.o.email) p.set('email', this.o.email);
    if (this.o.apiKey) p.set('api_key', this.o.apiKey);
    return p;
  }

  private async post(endpoint: string, params: URLSearchParams): Promise<string> {
    return withRetry(
      async () => {
        await this.throttle();
        this.stats.requests++;
        const res = await this.f(BASE + endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: params,
        });
        if (!res.ok) {
          const ra = Number(res.headers.get('retry-after'));
          throw new HttpError(`PubMed ${endpoint}: HTTP ${res.status}`, res.status, ra ? ra * 1000 : undefined);
        }
        const body = await res.text();
        // NCBI a volte risponde 200 con un errore applicativo
        if (/"error"\s*:\s*"[^"]*(rate limit|too many)/i.test(body) || /<ERROR>[^<]*(rate limit|too many)/i.test(body))
          throw new HttpError(`PubMed ${endpoint}: rate limit`, 429);
        return body;
      },
      {
        attempts: this.o.maxAttempts ?? 4,
        sleep: this.sleep,
        onRetry: (e, n, w) => {
          this.stats.retries++;
          this.o.onLog?.(`PubMed: tentativo ${n} fallito (${(e as Error).message}); riprovo tra ${w} ms`);
        },
      },
    );
  }

  /** Cerca per data di inserimento in PubMed (EDAT): include i record indicizzati in ritardo. */
  async search(term: string, win: SearchWindow, retmax = 300): Promise<string[]> {
    const fmt = (d: Date) => `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}`;
    const body = await this.post(
      'esearch.fcgi',
      this.params({ db: 'pubmed', term, retmode: 'json', retmax: String(retmax), datetype: 'edat', mindate: fmt(win.from), maxdate: fmt(win.to), sort: 'date' }),
    );
    const j = JSON.parse(body) as { esearchresult?: { idlist?: string[]; ERROR?: string; errorlist?: unknown } };
    if (j.esearchresult?.ERROR) throw new Error(`PubMed esearch: ${j.esearchresult.ERROR}`);
    return (j.esearchresult?.idlist ?? []).filter((id) => /^\d+$/.test(id));
  }

  async fetchArticles(pmids: string[]): Promise<ArticleRecord[]> {
    const out: ArticleRecord[] = [];
    for (let i = 0; i < pmids.length; i += 100) {
      const chunk = pmids.slice(i, i + 100);
      const xml = await this.post('efetch.fcgi', this.params({ db: 'pubmed', id: chunk.join(','), retmode: 'xml' }));
      out.push(...parsePubmedXml(xml));
    }
    return out;
  }

  /** Ricerca libera senza filtri di data (usata per verificare il curriculum). */
  async searchTerm(term: string, retmax = 5): Promise<string[]> {
    const body = await this.post('esearch.fcgi', this.params({ db: 'pubmed', term, retmode: 'json', retmax: String(retmax) }));
    const j = JSON.parse(body) as { esearchresult?: { idlist?: string[] } };
    return j.esearchresult?.idlist ?? [];
  }

  /** Risolve un titolo noto in un PMID (usato per verificare il curriculum). */
  async findByTitle(title: string): Promise<string[]> {
    const t = title.replace(/["\[\]]/g, ' ').replace(/\s+/g, ' ').trim();
    const body = await this.post('esearch.fcgi', this.params({ db: 'pubmed', term: `"${t}"[ti]`, retmode: 'json', retmax: '5' }));
    const j = JSON.parse(body) as { esearchresult?: { idlist?: string[] } };
    return j.esearchresult?.idlist ?? [];
  }
}
