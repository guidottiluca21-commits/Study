import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { composeNewsletter, subjectFor, type NewsletterInput } from '../src/core/newsletter';
import { summarizeAbstract } from '../src/core/summary';
import { rankForUser } from '../src/core/rank';
import { scoreImportance } from '../src/core/scoring';
import { parsePubmedXml } from '../src/core/pubmed';
import type { Candidate, CoreItem, RankedItem, UserPrefs } from '../src/core/types';
import { mk, NOW, BIG_RCT } from './helpers/make';

const prefs: UserPrefs = { topics: { sepsis: 5 }, study_types: [], max_weekly_reads: 6, weekly_minutes: 240, rest_days: [5, 6], core_enabled: true, core_topic_ids: [] };
const names = { sepsis: 'Sepsi e shock settico', airway: 'Vie aeree' };

function recentFrom(arts: ReturnType<typeof mk>[]): RankedItem[] {
  const cands: Candidate[] = arts.map((a) => ({ article: a, categories: [{ category_id: 'sepsis', match_score: 0.9, source: 'query' as const }], importance: scoreImportance(a, NOW) }));
  return rankForUser(cands, prefs, { alreadyReceived: new Set(), coreMinutes: 25, coreCount: 1, categoryNames: names }).selected;
}
const coreItem: CoreItem = {
  id: 'ards-arma', topic_id: 'ards', position: 1, pmid: '10793162', doi: '10.1056/nejm200005043421801', title: 'Ventilation with lower tidal volumes', authors: ['Brower RG', 'Matthay MA'], journal: 'N Engl J Med', pub_year: 2000,
  item_type: 'landmark_trial', rationale: 'Trial fondamentale.', prerequisites: ['ards-berlin'], objectives: ['Descrivere il disegno', 'Interpretare il risultato'], reading_minutes: 30, verification: 'verified', superseded_by: null, update_note: null, active: true,
};

function input(recent: RankedItem[], withCore = true, extra: Partial<NewsletterInput> = {}): NewsletterInput {
  return {
    weekStart: '2026-10-12', userName: 'Dr Rossi', recent,
    core: withCore ? { pick: { item: coreItem, topic: { id: 'ards', category_id: 'ards', title_it: 'ARDS', title_en: 'ARDS', sort_order: 1, active: true }, reason: 'new', note: 'Prossimo passo del percorso «ARDS».', unmetPrerequisites: [] }, topicTitle: 'ARDS', prerequisiteTitles: ['Berlin Definition'] } : null,
    transparency: { searchedAt: new Date('2026-10-12T03:30:00Z'), windowFrom: '2026-10-02', windowTo: '2026-10-12', overlapDays: 3, candidatesConsidered: 40, alreadyReceived: 2, belowThreshold: 30, notes: [], scoringVersion: '1.0.0' },
    categoryNames: names,
    links: { site: 'https://example.github.io/study/', unsubscribe: 'https://example.github.io/study/#/unsubscribe/abc-token', manage: 'https://example.github.io/study/#/preferences', privacy: 'https://example.github.io/study/#/privacy' },
    now: NOW, ...extra,
  };
}

const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
};
const contrast = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x! + 0.05) / (y! + 0.05); };

describe('oggetto', () => {
  it('formato richiesto', () => {
    expect(subjectFor('2026-10-12')).toBe('Anesthesia & Critical Care — Weekly Digest | 12 October 2026');
  });
});

describe('contenuto della newsletter', () => {
  const recent = recentFrom([BIG_RCT]);
  const out = composeNewsletter(input(recent));

  it('contiene tutte le sezioni richieste', () => {
    for (const s of ['In sintesi', 'Recent Evidence', 'Core Knowledge', 'Trasparenza']) expect(out.html).toContain(s);
    for (const s of ['IN SINTESI', 'RECENT EVIDENCE', 'CORE KNOWLEDGE', 'TRASPARENZA']) expect(out.text).toContain(s);
  });
  it('sintesi esecutiva: al massimo 5 punti, con evidenza practice-changing e obiettivo di apprendimento', () => {
    expect(out.executiveSummary.length).toBeLessThanOrEqual(5);
    expect(out.executiveSummary.join(' ')).toMatch(/practice-changing/);
    expect(out.executiveSummary.join(' ')).toMatch(/Obiettivo: Descrivere il disegno/);
  });
  it('link verificabili: PubMed e DOI', () => {
    expect(out.html).toContain(`https://pubmed.ncbi.nlm.nih.gov/${BIG_RCT.pmid}/`);
    expect(out.html).toContain('https://pubmed.ncbi.nlm.nih.gov/10793162/');
    expect(out.html).toContain('https://doi.org/10.1056/nejm200005043421801');
  });
  it('mostra criteri dell\'override con le evidenze estratte dall\'abstract', () => {
    expect(out.html).toMatch(/criteri verificabili/i);
    expect(out.html).toMatch(/NCT01234567/);
  });
  it('sintesi dichiarata come basata sull\'abstract e limiti dichiarati', () => {
    expect(out.html).toMatch(/dall'abstract/);
    expect(out.html).toMatch(/non sul full text|ABSTRACT, non sul full text/i);
    expect(out.html).toMatch(/non validati scientificamente/);
  });
  it('trasparenza: data della ricerca, intervallo, criteri, limiti', () => {
    expect(out.html).toMatch(/Ricerca eseguita il/);
    expect(out.html).toMatch(/dal 2 ottobre 2026 al 12 ottobre 2026/);
    expect(out.html).toMatch(/Criteri:/);
    expect(out.html).toMatch(/Limiti:/);
  });
  it('non contiene alcuna programmazione dello studio (niente piano, giorni liberi o budget)', () => {
    expect(out.html).not.toMatch(/Piano settimanale|Giorno libero/);
    expect(out.text).not.toMatch(/PIANO SETTIMANALE|Giorno libero/);
  });
  it('contiene link di disiscrizione e preferenze e l\'avvertenza clinica', () => {
    expect(out.html).toContain('#/unsubscribe/abc-token');
    expect(out.text).toContain('#/unsubscribe/abc-token');
    expect(out.html).toMatch(/non sostituisce linee guida/);
  });
  it('indica la bozza editoriale del Core Knowledge', () => {
    expect(out.html).toMatch(/bozza editoriale non ancora rivista/);
  });
});

describe('sicurezza del contenuto (testo PubMed non attendibile)', () => {
  it('escapa HTML e script provenienti da titoli, abstract, autori e riviste', () => {
    const evil = mk({
      ...BIG_RCT, title: 'Evil <script>alert(1)</script> "quote" & <img src=x onerror=alert(2)>',
      authors: ['<b>Hacker</b> X'], journal: 'J <i>Bad</i>',
      abstract: BIG_RCT.abstract!.replace('Sepsis causes high mortality.', '<iframe src="https://evil"></iframe>'),
    });
    const out = composeNewsletter(input(recentFrom([evil]), false));
    expect(out.html).not.toMatch(/<script/i);
    expect(out.html).not.toMatch(/<iframe/i);
    expect(out.html).not.toMatch(/<img\b/i);
    expect(out.html).not.toMatch(/<[^>]*\bon\w+\s*=/i); // nessun attributo evento dentro un tag
    expect(out.html).toContain('&lt;script&gt;');
  });
  it('gli URL costruiti usano solo PMID numerici e DOI codificati', () => {
    const a = mk({ ...BIG_RCT, doi: '10.1000/a b"c' });
    const out = composeNewsletter(input(recentFrom([a]), false));
    const hrefs = [...out.html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]!);
    for (const h of hrefs) expect(h).not.toMatch(/[\s<>]/);
    expect(hrefs).toContain('https://doi.org/10.1000/a%20b%22c');
  });
});

describe('nessun riempitivo', () => {
  it('senza novità e senza Core la newsletter è vuota (da non inviare)', () => {
    const out = composeNewsletter(input([], false));
    expect(out.empty).toBe(true);
    expect(out.executiveSummary[0]).toMatch(/non aggiungiamo riempitivi/);
  });
  it('senza novità ma con Core, si invia solo il Core', () => {
    const out = composeNewsletter(input([], true));
    expect(out.empty).toBe(false);
    expect(out.html).not.toMatch(/Recent Evidence/);
    expect(out.html).toMatch(/Core Knowledge/);
  });
});

describe('qualità del markup e del design dell\'e-mail', () => {
  const out = composeNewsletter(input(recentFrom([BIG_RCT])));
  it('struttura HTML bilanciata e adatta ai client (tabelle, stili in linea, lang, viewport)', () => {
    for (const tag of ['table', 'tr', 'td', 'ul', 'div']) {
      const open = (out.html.match(new RegExp(`<${tag}[\\s>]`, 'g')) ?? []).length;
      const close = (out.html.match(new RegExp(`</${tag}>`, 'g')) ?? []).length;
      expect(open, tag).toBe(close);
    }
    expect(out.html).toMatch(/<html lang="it">/);
    expect(out.html).toMatch(/name="viewport"/);
    expect(out.html).toMatch(/max-width:620px/);
    expect(out.html).not.toMatch(/<style|<link|<script/i);
  });
  it('contrasto dei colori conforme a WCAG AA (≥ 4.5:1)', () => {
    expect(contrast('#1f2328', '#faf8f3')).toBeGreaterThan(4.5);
    expect(contrast('#5a6169', '#ffffff')).toBeGreaterThan(4.5);
    expect(contrast('#5a6169', '#f4efe2')).toBeGreaterThan(4.5);
    expect(contrast('#1d5c63', '#ffffff')).toBeGreaterThan(4.5);
    expect(contrast('#1d5c63', '#f4efe2')).toBeGreaterThan(4.5);
  });
  it('versione testo equivalente (stessi link e titoli)', () => {
    expect(out.text).toContain(BIG_RCT.title);
    expect(out.text).toContain(`https://pubmed.ncbi.nlm.nih.gov/${BIG_RCT.pmid}/`);
  });
});

describe('sintesi estrattiva su record reali', () => {
  const recs = parsePubmedXml(readFileSync(join(import.meta.dirname, 'fixtures', 'pubmed-sample.xml'), 'utf8'));
  it('ARDSNet 2000: riporta frasi dell\'abstract, non testo generato', () => {
    const a = recs.find((r) => r.pmid === '10793162')!;
    const s = summarizeAbstract(a, NOW);
    expect(s.basis).toBe('abstract');
    expect(s.design).toMatch(/Trial randomizzato/);
    expect(s.design).toMatch(/n = 861/);
    expect(s.result).toBeTruthy();
    expect(a.abstract!.replace(/\n/g, ' ')).toContain(s.result!.replace(/…$/, '').slice(0, 40));
    expect(s.conclusion).toBeTruthy();
  });
  it('tutti i record reali producono newsletter senza eccezioni', () => {
    const cands: Candidate[] = recs.map((a) => ({ article: a, categories: [{ category_id: 'sepsis', match_score: 0.8, source: 'query' as const }], importance: scoreImportance(a, NOW) }));
    const r = rankForUser(cands, { ...prefs, max_weekly_reads: 12, weekly_minutes: 600 }, { alreadyReceived: new Set(), coreMinutes: 0, coreCount: 0, categoryNames: names }).selected;
    expect(() => composeNewsletter(input(r, false))).not.toThrow();
  });
});
