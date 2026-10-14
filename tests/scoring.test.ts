import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { scoreImportance, extractSampleSize, extractStudyCount, FORMULA_VERSION } from '../src/core/scoring';
import { parsePubmedXml } from '../src/core/pubmed';
import { mk, NOW, BIG_RCT } from './helpers/make';

describe('estrazione dall\'abstract', () => {
  it('dimensione del campione', () => {
    expect(extractSampleSize('we randomized 2,500 adult patients')?.n).toBe(2500);
    expect(extractSampleSize('A total of 861 patients (n = 861)')?.n).toBe(861);
    expect(extractSampleSize('in 2019, we observed 28 days')).toBeNull(); // anno e giorni non sono campioni
  });
  it('numero di studi nelle meta-analisi', () => {
    expect(extractStudyCount('We pooled 14 randomized trials')).toBe(14);
    expect(extractStudyCount('nothing here')).toBeNull();
  });
});

describe('importanza scientifica', () => {
  it('un grande RCT multicentrico registrato con esito di mortalità ottiene un punteggio alto e bassa incertezza', () => {
    const r = scoreImportance(BIG_RCT, NOW);
    expect(r.formula_version).toBe(FORMULA_VERSION);
    expect(r.importance).toBeGreaterThanOrEqual(85);
    expect(r.uncertainty).toBe('low');
    expect(r.sample_size).toBe(2500);
    expect(r.components.design).toBeGreaterThan(0);
  });

  it('il prestigio della rivista NON influenza il punteggio', () => {
    const a = scoreImportance(mk({ ...BIG_RCT, journal: 'N Engl J Med' }), NOW);
    const b = scoreImportance(mk({ ...BIG_RCT, journal: 'Rivista Sconosciuta' }), NOW);
    expect(a.importance).toBe(b.importance);
    expect(a.override_applied).toBe(b.override_applied);
  });

  it('studi su animali/preclinici sono limitati (tetto) e non ottengono override', () => {
    const r = scoreImportance(mk({ ...BIG_RCT, abstract: BIG_RCT.abstract! + '\nIn a murine model of sepsis.' }), NOW);
    expect(r.importance).toBeLessThanOrEqual(20);
    expect(r.override_applied).toBe(false);
  });

  it('pilota e monocentrico vengono penalizzati e segnalati tra i limiti', () => {
    const pilot = mk({
      title: 'A pilot randomized trial of Y',
      study_type: 'rct', study_type_basis: 'pubmed_tag',
      abstract: 'METHODS: This single-center pilot study randomized 40 patients. The primary outcome was oxygenation. RESULTS: Oxygenation improved (P=0.03).',
    });
    const r = scoreImportance(pilot, NOW);
    expect(r.importance).toBeLessThan(55);
    expect(r.limitations).toEqual(expect.arrayContaining(['studio pilota o di fattibilità', 'monocentrico']));
    expect(r.override_applied).toBe(false);
  });

  it('i protocolli di studio sono esclusi', () => {
    const r = scoreImportance(mk({ title: 'Study protocol for a trial of Z', study_type: 'rct', abstract: 'We will randomize patients.' }), NOW);
    expect(r.excluded_reason).toMatch(/protocollo/);
    expect(r.importance).toBeLessThanOrEqual(10);
  });

  it('l\'incertezza è alta quando mancano i segnali', () => {
    const r = scoreImportance(mk({ title: 'Qualcosa', abstract: 'Breve testo.', study_type: 'other', study_type_basis: 'unknown' }), NOW);
    expect(r.uncertainty).toBe('high');
    expect(r.uncertainty_reasons.length).toBeGreaterThanOrEqual(3);
  });

  it('segnala possibile discordanza con evidenze precedenti', () => {
    const r = scoreImportance(mk({ ...BIG_RCT, abstract: BIG_RCT.abstract! + '\nThese findings are in contrast to previous trials.' }), NOW);
    expect(r.discordance_hint).toMatch(/in contrast to previous/);
  });

  it('record reali: punteggi plausibili e nessuna eccezione', () => {
    const recs = parsePubmedXml(readFileSync(join(import.meta.dirname, 'fixtures', 'pubmed-sample.xml'), 'utf8'));
    const ards = recs.find((r) => r.pmid === '10793162')!;
    const s = scoreImportance(ards, NOW);
    expect(s.sample_size).toBe(861);
    expect(s.components.design).toBe(24);
    expect(s.importance).toBeGreaterThan(50);
    for (const r of recs) expect(() => scoreImportance(r, NOW)).not.toThrow();
  });
});

describe('high-impact override', () => {
  it('scatta per un grande RCT con tutti i criteri verificabili e riporta le evidenze', () => {
    const r = scoreImportance(BIG_RCT, NOW);
    expect(r.override_applied).toBe(true);
    const crit = r.override_reasons.map((x) => x.criterion);
    expect(crit).toEqual(['design', 'outcome', 'size_rigor', 'result']);
    for (const reason of r.override_reasons) {
      expect(reason.evidence.length).toBeGreaterThan(10); // motivazione verificabile
    }
    expect(r.override_reasons.find((x) => x.criterion === 'outcome')!.evidence).toMatch(/mortality/i);
    expect(r.override_reasons.find((x) => x.criterion === 'size_rigor')!.evidence).toMatch(/NCT01234567/);
  });

  it('non scatta se manca un criterio: nessuna registrazione', () => {
    const r = scoreImportance(mk({ ...BIG_RCT, abstract: BIG_RCT.abstract!.replace('NCT01234567', 'a registry') }), NOW);
    expect(r.override_applied).toBe(false);
  });

  it('non scatta se il campione è piccolo (anche con rivista prestigiosa)', () => {
    const r = scoreImportance(mk({ ...BIG_RCT, journal: 'N Engl J Med', abstract: BIG_RCT.abstract!.replace('2,500', '300') }), NOW);
    expect(r.override_applied).toBe(false);
  });

  it('non scatta se l\'esito non è rilevante per il paziente (surrogato)', () => {
    const r = scoreImportance(mk({
      ...BIG_RCT,
      abstract: BIG_RCT.abstract!.replace(/mortality/gi, 'oxygenation').replace('28-day all-cause oxygenation', 'oxygenation'),
    }), NOW);
    expect(r.override_applied).toBe(false);
  });

  it('un grande trial neutro può generare override con motivazione dedicata', () => {
    const neutral = mk({
      ...BIG_RCT,
      abstract: BIG_RCT.abstract
        .replace(/Mortality at 28 days was 27\.1%[^.]*\.[^.]*\./, 'Mortality at 28 days was 30.1% versus 30.9% (hazard ratio 0.97; 95% CI 0.86 to 1.09; P=0.60). There was no significant difference between groups.')
        .replace('significantly lower mortality', 'similar mortality'),
    });
    const r = scoreImportance(neutral, NOW);
    expect(r.override_applied).toBe(true);
    expect(r.override_reasons.find((x) => x.criterion === 'result')!.statement).toMatch(/neutro/);
  });

  it('meta-analisi: richiede ≥8 studi, ≥2000 pazienti, metodologia e effetto con CI', () => {
    const ma = mk({
      title: 'Drug W and mortality in sepsis: a systematic review and meta-analysis of randomized trials',
      study_type: 'meta_analysis', study_type_basis: 'pubmed_tag',
      pub_types: ['Meta-Analysis', 'Systematic Review'],
      abstract: [
        'METHODS: Following PRISMA and PROSPERO registration, we pooled 18 randomized trials including 6,400 patients with sepsis. Risk of bias was assessed with RoB 2; heterogeneity with I2. The primary outcome was mortality.',
        'RESULTS: Drug W significantly reduced mortality (risk ratio 0.88; 95% CI 0.80 to 0.97).',
        'CONCLUSIONS: Drug W reduces mortality in sepsis.',
      ].join('\n'),
    });
    const r = scoreImportance(ma, NOW);
    expect(r.override_applied).toBe(true);
    const few = scoreImportance(mk({ ...ma, abstract: ma.abstract!.replace('18 randomized trials', '4 randomized trials') }), NOW);
    expect(few.override_applied).toBe(false);
  });

  it('linea guida recente con metodologia GRADE: override; senza tag PubMed: no', () => {
    const g = mk({
      title: 'Guidelines for the management of X in adults',
      study_type: 'guideline', study_type_basis: 'pubmed_tag', pub_types: ['Practice Guideline'],
      entrez_date: '2026-09-20',
      abstract: 'METHODS: A multidisciplinary panel used GRADE and a systematic review of the evidence. RESULTS: The panel issued 40 recommendations.',
    });
    expect(scoreImportance(g, NOW).override_applied).toBe(true);
    expect(scoreImportance(mk({ ...g, study_type_basis: 'inferred_from_text' }), NOW).override_applied).toBe(false);
    expect(scoreImportance(mk({ ...g, entrez_date: '2026-01-10' }), NOW).override_applied).toBe(false);
  });

  it('tipo dedotto dal testo: l\'override lo dichiara da verificare', () => {
    const r = scoreImportance(mk({ ...BIG_RCT, study_type_basis: 'inferred_from_text', pub_types: ['Journal Article'] }), NOW);
    expect(r.override_applied).toBe(true);
    expect(r.override_reasons[0]!.statement).toMatch(/dedotto dal testo/);
    expect(r.uncertainty).not.toBe('low');
  });
});
