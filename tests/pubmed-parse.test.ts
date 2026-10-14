import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parsePubmedXml, inferStudyType, computeSearchWindow, buildCategoryTerm } from '../src/core/pubmed';

const xml = readFileSync(join(import.meta.dirname, 'fixtures', 'pubmed-sample.xml'), 'utf8');

describe('parsePubmedXml (record reali di PubMed)', () => {
  const recs = parsePubmedXml(xml);
  const by = (pmid: string) => recs.find((r) => r.pmid === pmid)!;

  it('legge tutti i record', () => {
    expect(recs.length).toBeGreaterThanOrEqual(6);
  });

  it('ARDSNet 2000: metadati completi e tipo RCT da tag PubMed', () => {
    const r = by('10793162');
    expect(r.title).toMatch(/lower tidal volumes/i);
    expect(r.journal).toBe('N Engl J Med');
    expect(r.pub_date?.startsWith('2000-05')).toBe(true);
    expect(r.study_type).toBe('rct');
    expect(r.study_type_basis).toBe('pubmed_tag');
    expect(r.doi).toMatch(/^10\.1056\//);
    expect(r.abstract).toMatch(/RESULTS:/);
    expect(r.authors.length).toBeGreaterThan(0);
    expect(r.mesh_terms.length).toBeGreaterThan(0);
  });

  it('linea guida (Surviving Sepsis 2021) è riconosciuta come guideline', () => {
    const r = by('34605781');
    expect(r.study_type).toBe('guideline');
  });

  it('nessun metadato inventato: DOI assente resta null, titoli senza markup, doi in minuscolo', () => {
    for (const r of recs) {
      expect(r.title).not.toMatch(/<[^>]+>/);
      if (r.doi) expect(r.doi).toBe(r.doi.toLowerCase());
      expect(r.pmid).toMatch(/^\d+$/);
    }
  });

  it('decodifica i riferimenti di carattere (es. &#x3b2; -> β) e le entità nei titoli', () => {
    const r = by('27145012');
    expect(r.title).toMatch(/^11β-Hydroxysteroid/);
    for (const x of recs) expect(x.title).not.toMatch(/&#x?[0-9a-f]+;|&amp;|&lt;/i);
  });

  it('data di inserimento in PubMed (entrez) presente nei record recenti', () => {
    expect(by('42827265').entrez_date).toMatch(/^2026-/);
  });
});

describe('inferStudyType', () => {
  it('usa il tag PubMed quando c\'è', () => {
    expect(inferStudyType(['Meta-Analysis', 'Systematic Review'], 'x', null)).toEqual({ type: 'meta_analysis', basis: 'pubmed_tag' });
  });
  it('deduce dal testo quando i tag mancano (indicizzazione in ritardo)', () => {
    expect(inferStudyType(['Journal Article'], 'Effect of X: a randomized clinical trial', 'We randomized 500 patients')).toEqual({ type: 'rct', basis: 'inferred_from_text' });
    expect(inferStudyType([], 'Y: a systematic review and meta-analysis', null).type).toBe('meta_analysis');
    expect(inferStudyType([], 'Something unrelated', 'no design words').basis).toBe('unknown');
  });
});

describe('finestra di ricerca e query', () => {
  const now = new Date('2026-10-12T04:00:00Z');
  it('prima esecuzione: finestra predefinita', () => {
    const w = computeSearchWindow(now, null);
    expect(Math.round((w.to.getTime() - w.from.getTime()) / 86_400_000)).toBe(10);
  });
  it('esecuzioni successive: parte dall\'ultima ricerca con sovrapposizione (recupero dei ritardi)', () => {
    const w = computeSearchWindow(now, new Date('2026-10-05T04:00:00Z'));
    expect(w.from.toISOString().slice(0, 10)).toBe('2026-10-02');
  });
  it('dopo una lunga pausa la finestra è limitata', () => {
    const w = computeSearchWindow(now, new Date('2025-01-01T00:00:00Z'));
    expect(Math.round((w.to.getTime() - w.from.getTime()) / 86_400_000)).toBe(60);
  });
  it('la query combina categoria, disegno e abstract', () => {
    const t = buildCategoryTerm({ pubmed_query: 'sepsis[tiab]' });
    expect(t).toContain('(sepsis[tiab]) AND');
    expect(t).toContain('hasabstract');
  });
});
