/**
 * Punteggio di IMPORTANZA SCIENTIFICA (0–100), deterministico, trasparente e versionato.
 *
 * ATTENZIONE: non è uno strumento scientificamente validato. È un'euristica che usa SOLO
 * ciò che è leggibile da metadati PubMed e abstract (tipo di studio, dimensione del
 * campione, esiti, indicatori di rigore). Non legge il full text. Il prestigio della
 * rivista NON entra mai nel punteggio né nell'override. Ogni punteggio riporta un livello
 * di incertezza. Documentazione: docs/PUNTEGGIO.md.
 */
import type { ArticleRecord, ImportanceResult, OverrideReason, StudyType } from './types.ts';
import { abstractSections, evidenceSentence, splitSentences, truncateAtSentence } from './text.ts';

export const FORMULA_VERSION = '1.0.0';

export const SCORING_CONFIG = {
  /** punti massimi per componente (somma = 100) */
  max: { design: 30, size: 15, outcomes: 20, robustness: 15, novelty: 10, applicability: 10 },
  designPoints: {
    guideline: 26, meta_analysis: 28, systematic_review: 22, rct: 24, observational: 12, review: 6, other: 4,
  } as Record<StudyType, number>,
  /** tetto per studi preclinici/animali */
  animalCap: 20,
  override: {
    minImportance: 55,
    trialMinN: 800,
    maMinStudies: 8,
    maMinPatients: 2000,
    guidelineMaxAgeDays: 150,
  },
};

// ---------------------------------------------------------------------------
// Estrazione di caratteristiche dall'abstract
// ---------------------------------------------------------------------------

const MAJOR_RE = /\b(mortality|death|deaths|died|survival|survivors?|alive|ventilator-free days|days alive|organ support-free|disability|functional (?:outcome|independence|recovery)|quality of life|major adverse|mace\b|myocardial infarction|stroke|cardiac arrest|neurolog\w+ outcome|renal replacement therapy|persistent organ dysfunction)\b/i;
const INTERMEDIATE_RE = /\b(delirium|acute kidney injury|\baki\b|pneumonia|reintubation|extubation failure|length of stay|icu stay|hospital stay|postoperative complications?|pulmonary complications?|nausea|vomiting|chronic (?:postsurgical )?pain|pain (?:score|intensity)|bleeding|transfusion|hypotension|infection|surgical site|failure)\b/i;
const SURROGATE_RE = /\b(oxygenation|pao2|p\/f|biomarkers?|plasma level|concentrations?|lactate clearance|cardiac index|blood pressure|heart rate|time to|onset|duration of (?:block|action)|score)\b/i;

type OutcomeTier = 'major' | 'intermediate' | 'surrogate' | 'none';

function detectTier(text: string): OutcomeTier {
  if (MAJOR_RE.test(text)) return 'major';
  if (INTERMEDIATE_RE.test(text)) return 'intermediate';
  if (SURROGATE_RE.test(text)) return 'surrogate';
  return 'none';
}
const downgrade = (t: OutcomeTier): OutcomeTier => (t === 'major' ? 'intermediate' : t === 'intermediate' ? 'surrogate' : 'none');

export function extractSampleSize(text: string): { n: number; snippet: string } | null {
  const patterns: RegExp[] = [
    /\bn\s*=\s*(\d[\d,]*)/gi,
    /\b(\d{1,3}(?:,\d{3})+|\d{2,7})\s+(?:[a-z-]+\s+){0,3}(?:patients|participants|adults|subjects|children|infants|women|men|individuals|cases|admissions|surgeries|procedures|neonates|parturients)\b/gi,
    /\b(?:enrolled|randomi[sz]ed|included|recruited|analy[sz]ed|allocated)\s+(?:a total of\s+)?(\d{1,3}(?:,\d{3})+|\d{2,7})\b/gi,
  ];
  let best: { n: number; snippet: string } | null = null;
  for (const re of patterns) {
    for (const m of text.matchAll(re)) {
      const n = parseInt(m[1]!.replace(/,/g, ''), 10);
      if (!Number.isFinite(n) || n < 10 || n > 5_000_000) continue;
      if (n >= 1990 && n <= 2035 && !/,/.test(m[1]!)) continue; // probabile anno
      if (!best || n > best.n) best = { n, snippet: m[0].trim() };
    }
  }
  return best;
}

export function extractStudyCount(text: string): number | null {
  const m = /\b(\d{1,3})\s+(?:randomi[sz]ed\s+)?(?:controlled\s+)?(?:clinical\s+)?(?:trials|studies|rcts|articles|publications)\b/i.exec(text);
  if (!m) return null;
  const k = parseInt(m[1]!, 10);
  return k >= 2 && k <= 500 ? k : null;
}

export interface Features {
  text: string;
  sampleSize: { n: number; snippet: string } | null;
  studyCount: number | null;
  registered: string | null;
  blinded: boolean;
  multicenter: boolean;
  ciOrP: boolean;
  itt: boolean;
  prospective: boolean;
  adjusted: boolean;
  prisma: boolean;
  riskOfBias: boolean;
  grade: boolean;
  heterogeneity: boolean;
  ofRcts: boolean;
  outcomeTier: OutcomeTier;
  outcomeEvidence: string | null;
  resultEvidence: string | null;
  significantClaim: boolean;
  nullClaim: boolean;
  animal: boolean;
  limitations: string[];
  protocolPaper: boolean;
  discordance: string | null;
  ageDays: number | null;
}

const DISCORDANCE_RE = /(in contrast to|contrary to|contradict\w*|inconsistent with|conflicting|did not confirm|failed to replicate|unlike previous|discordant|at odds with)/i;

export function extractFeatures(a: ArticleRecord, now: Date): Features {
  const abstract = a.abstract ?? '';
  const text = `${a.title}. ${abstract}`;
  const secs = abstractSections(a.abstract);
  const resultsText = [secs['RESULTS'], secs['FINDINGS'], secs['CONCLUSIONS'], secs['CONCLUSION'], secs['INTERPRETATION']].filter(Boolean).join(' ');
  const sentences = splitSentences(abstract.replace(/\n/g, ' '));
  const primarySentence = sentences.find((s) => /primary (?:outcome|endpoint|end point)|primary\b.*\b(?:was|were)\b/i.test(s)) ?? null;

  let tier: OutcomeTier;
  let outcomeEvidence: string | null = null;
  if (primarySentence && detectTier(primarySentence) !== 'none') {
    tier = detectTier(primarySentence);
    outcomeEvidence = truncateAtSentence(primarySentence, 300);
  } else {
    const scope = resultsText || abstract;
    const t = detectTier(scope);
    tier = primarySentence ? downgrade(t) : t === 'major' ? 'major' : t;
    if (!primarySentence && tier === 'major') {
      // senza esito primario esplicito, l'evidenza deve comunque comparire in risultati/conclusioni
      outcomeEvidence = evidenceSentence(scope, MAJOR_RE);
      if (!outcomeEvidence) tier = 'intermediate';
    } else if (tier !== 'none') {
      outcomeEvidence = evidenceSentence(scope, tier === 'intermediate' ? INTERMEDIATE_RE : SURROGATE_RE);
    }
    if (tier === 'none') {
      tier = downgrade(detectTier(text));
    }
  }

  const ciRe = /95\s?%\s*(?:ci|confidence interval|credible interval|cri)|\bconfidence interval\b|\bp\s*[<≤=]\s*0?\.\d+|\bP\s*[<≤=]\s*0?\.\d+/i;
  const effectRe = /\b(hr|rr|or|aor|ahr|difference|reduc\w+|improv\w+|mortality|odds|hazard|risk ratio)\b/i;
  const resultSentence =
    (resultsText ? sentences.find((s) => resultsText.includes(s.slice(0, 40)) && ciRe.test(s) && effectRe.test(s)) : null) ??
    sentences.find((s) => ciRe.test(s) && effectRe.test(s)) ??
    null;

  const sig = /(?<!no\s)(?<!not\s)\bsignificantly\s+(?:reduced|lower|improved|higher|increased|decreased|better|fewer|more|greater|longer|shorter)|(?<!no\s)(?<!not\s)\bstatistically significant (?:reduction|improvement|increase|decrease)/i.test(text);
  const nul = /no (?:statistically )?significant (?:difference|effect|benefit|improvement|reduction)|did not (?:significantly )?(?:reduce|improve|differ|affect|increase|decrease)|not (?:significantly )?(?:different|superior|associated)|non-?inferior|similar (?:mortality|outcomes|rates)|no (?:difference|benefit)/i.test(text);

  const limitations: string[] = [];
  if (/\b(pilot|feasibility)\b/i.test(a.title + ' ' + abstract.slice(0, 400))) limitations.push('studio pilota o di fattibilità');
  if (/\b(post[ -]?hoc|secondary analysis|exploratory analysis|ancillary)\b/i.test(text)) limitations.push('analisi secondaria o post hoc');
  if (/\bsingle[- ](?:center|centre|site|institution)\b/i.test(text)) limitations.push('monocentrico');
  if (/\bretrospective\b/i.test(text)) limitations.push('retrospettivo');
  if (/\b(open[- ]label|unblinded|not blinded|non-blinded)\b/i.test(text)) limitations.push('in aperto (non in cieco)');
  if (/\b(small sample|underpowered|limited power|low power)\b/i.test(text)) limitations.push('campione piccolo o potenza limitata');
  if (/\b(terminated early|stopped early|early termination|stopped for futility|prematurely)\b/i.test(text)) limitations.push('interrotto precocemente');

  const dateStr = a.entrez_date ?? a.pub_date;
  const ageDays = dateStr ? Math.max(0, Math.round((now.getTime() - new Date(dateStr + 'T00:00:00Z').getTime()) / 86_400_000)) : null;

  const reg = /\b(NCT\d{8}|ISRCTN\d{5,}|ACTRN\d{10,}|ChiCTR[-\w]*\d+|EudraCT[\s:]*[\d-]+|CRD\d{8,}|PROSPERO)\b/i.exec(text);
  const disc = DISCORDANCE_RE.exec(text);

  return {
    text,
    sampleSize: extractSampleSize(text),
    studyCount: extractStudyCount(text),
    registered: reg ? reg[1]! : /clinicaltrials\.gov|trial registration/i.test(text) ? 'registro citato' : null,
    blinded: /\b(double|triple)[- ]blind|\bblinded\b|placebo-controlled|\bsham\b|assessor-blind/i.test(text) && !/\bunblinded|not blinded\b/i.test(text),
    multicenter: a.pub_types.includes('Multicenter Study') || /\b(multi-?cent(?:er|re)|\d+\s+(?:sites|hospitals|centers|centres|icus|countries))\b/i.test(text),
    ciOrP: ciRe.test(text),
    itt: /intention[- ]to[- ]treat|modified intention/i.test(text),
    prospective: /\bprospective\b/i.test(text),
    adjusted: /\b(adjusted|propensity|multivariable|multivariate)\b/i.test(text),
    prisma: /\b(prisma|prospero)\b/i.test(text),
    riskOfBias: /risk of bias|\brob\b|quality assessment|newcastle|cochrane/i.test(text),
    grade: /\bgrade\b|certainty of (?:the )?evidence|quality of evidence/i.test(text),
    heterogeneity: /heterogeneity|\bi2\b|i\^2|random-effects?/i.test(text),
    ofRcts: /randomi[sz]ed/i.test(text),
    outcomeTier: tier,
    outcomeEvidence,
    resultEvidence: resultSentence ? truncateAtSentence(resultSentence, 300) : null,
    significantClaim: sig,
    nullClaim: nul,
    animal: /\b(rats?|mice|mouse|murine|porcine|piglets?|rabbits?|swine|canine|sheep|in vitro|animal model|preclinical|ex vivo|cadaver\w*|manikin)\b/i.test(text),
    limitations,
    protocolPaper: /\b(study|trial|review) protocol\b|protocol for\b|statistical analysis plan|\bprotocol\s*:/i.test(a.title),
    discordance: disc ? evidenceSentence(abstract.replace(/\n/g, ' '), DISCORDANCE_RE) : null,
    ageDays,
  };
}

// ---------------------------------------------------------------------------
// Punteggio
// ---------------------------------------------------------------------------

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

function sizePoints(type: StudyType, f: Features): number {
  if (type === 'guideline') return 8;
  if (type === 'meta_analysis' || type === 'systematic_review') {
    const k = f.studyCount;
    let p = k == null ? 4 : k < 5 ? 5 : k < 10 ? 8 : k < 20 ? 11 : 13;
    if ((f.sampleSize?.n ?? 0) >= 5000) p += 2;
    return Math.min(15, p);
  }
  if (type === 'rct' || type === 'observational') {
    const n = f.sampleSize?.n;
    if (n == null) return 4;
    return n < 50 ? 2 : n < 200 ? 5 : n < 500 ? 8 : n < 1000 ? 11 : n < 3000 ? 13 : 15;
  }
  return 3;
}

function robustnessPoints(type: StudyType, f: Features): number {
  let p = 0;
  if (type === 'rct') {
    p = (f.registered ? 4 : 0) + (f.blinded ? 3 : 0) + (f.multicenter ? 3 : 0) + (f.itt ? 3 : 0) + (f.ciOrP ? 2 : 0);
  } else if (type === 'meta_analysis' || type === 'systematic_review') {
    p = (f.prisma ? 5 : 0) + (f.riskOfBias ? 4 : 0) + (f.heterogeneity ? 3 : 0) + (f.ciOrP ? 3 : 0);
  } else if (type === 'guideline') {
    p = (f.grade ? 6 : 0) + (/systematic review|evidence review/i.test(f.text) ? 4 : 0) + (/delphi|consensus|panel|multidisciplinary/i.test(f.text) ? 3 : 0) + (/society|association|college/i.test(f.text) ? 2 : 0);
  } else if (type === 'observational') {
    p = (f.ciOrP ? 3 : 0) + (f.multicenter ? 3 : 0) + (f.prospective ? 3 : 0) + (f.adjusted ? 4 : 0) + (f.registered ? 2 : 0);
  } else {
    p = f.ciOrP ? 2 : 0;
  }
  return Math.min(15, p);
}

export function scoreImportance(a: ArticleRecord, now: Date): ImportanceResult {
  const f = extractFeatures(a, now);
  const M = SCORING_CONFIG.max;
  const type = a.study_type;

  let excluded: string | null = null;
  if (a.retracted) excluded = 'articolo ritrattato';
  else if (f.protocolPaper) excluded = 'protocollo di studio (nessun risultato)';
  else if (!a.abstract) excluded = 'abstract assente';

  let design = SCORING_CONFIG.designPoints[type];
  if ((type === 'meta_analysis' || type === 'systematic_review') && !f.ofRcts) design -= 4;
  design = clamp(design, 0, M.design);

  const size = clamp(sizePoints(type, f), 0, M.size);
  const outcomes = f.outcomeTier === 'major' ? 20 : f.outcomeTier === 'intermediate' ? 12 : f.outcomeTier === 'surrogate' ? 6 : 8;
  const robustness = clamp(robustnessPoints(type, f), 0, M.robustness);
  const novelty = f.ageDays == null ? 4 : f.ageDays <= 14 ? 10 : f.ageDays <= 30 ? 8 : f.ageDays <= 60 ? 6 : f.ageDays <= 120 ? 4 : 2;
  const applicability = f.animal ? 0 : /\bpragmatic\b/i.test(f.text) ? 10 : 8;

  let penalties = 0;
  if (f.limitations.includes('studio pilota o di fattibilità')) penalties += 12;
  if (f.limitations.includes('analisi secondaria o post hoc')) penalties += 6;
  if (f.limitations.includes('monocentrico') && (type === 'rct' || type === 'observational')) penalties += 3;
  if (f.limitations.includes('retrospettivo')) penalties += 3;
  if (f.limitations.includes('in aperto (non in cieco)')) penalties += 1;
  if (f.limitations.includes('campione piccolo o potenza limitata')) penalties += 4;
  if (f.limitations.includes('interrotto precocemente')) penalties += 2;

  let importance = design + size + outcomes + robustness + novelty + applicability - penalties;
  if (f.animal) importance = Math.min(importance, SCORING_CONFIG.animalCap);
  if (excluded) importance = Math.min(importance, 10);
  importance = Math.round(clamp(importance, 0, 100));

  // incertezza: quanto il punteggio si regge su segnali mancanti o dedotti
  const reasons: string[] = [];
  let u = 0;
  if (a.study_type_basis === 'inferred_from_text') { u += 1; reasons.push('tipo di studio dedotto dal testo (tag PubMed non ancora assegnato)'); }
  if (a.study_type_basis === 'unknown') { u += 2; reasons.push('tipo di studio non determinabile'); }
  if ((type === 'rct' || type === 'observational') && !f.sampleSize) { u += 1; reasons.push('dimensione del campione non estraibile dall\'abstract'); }
  if (f.outcomeTier === 'none') { u += 1; reasons.push('esito principale non identificabile'); }
  if ((a.abstract ?? '').length < 600) { u += 1; reasons.push('abstract breve'); }
  const uncertainty: ImportanceResult['uncertainty'] = u <= 1 ? 'low' : u === 2 ? 'medium' : 'high';

  const override = excluded || f.animal ? [] : evaluateOverride(a, f, importance, now);

  return {
    formula_version: FORMULA_VERSION,
    importance,
    components: { design, size, outcomes, robustness, novelty, applicability, penalties: -penalties },
    uncertainty,
    uncertainty_reasons: reasons,
    limitations: f.limitations,
    discordance_hint: f.discordance,
    excluded_reason: excluded,
    override_applied: override.length > 0,
    override_reasons: override,
    sample_size: f.sampleSize?.n ?? null,
  };
}

// ---------------------------------------------------------------------------
// High-impact override (studi potenzialmente practice-changing)
// ---------------------------------------------------------------------------

/**
 * L'override richiede criteri oggettivi e VERIFICABILI sul testo/metadati, ciascuno con la
 * relativa evidenza. Non dipende dalle priorità personali né dal prestigio della rivista.
 * Restituisce le motivazioni; array vuoto = nessun override.
 */
export function evaluateOverride(a: ArticleRecord, f: Features, importance: number, _now: Date): OverrideReason[] {
  const C = SCORING_CONFIG.override;
  if (importance < C.minImportance) return [];
  const type = a.study_type;
  const reasons: OverrideReason[] = [];
  const inferred = a.study_type_basis === 'inferred_from_text' ? ' (tipo dedotto dal testo: verificare)' : '';

  if (type === 'rct') {
    if (f.outcomeTier !== 'major' || !f.outcomeEvidence) return [];
    if (!f.sampleSize || f.sampleSize.n < C.trialMinN) return [];
    if (!f.multicenter || !f.registered) return [];
    if (!f.ciOrP || !(f.significantClaim || f.nullClaim) || !f.resultEvidence) return [];
    reasons.push({ criterion: 'design', statement: `Trial randomizzato${inferred}`, evidence: `Tipi di pubblicazione PubMed: ${a.pub_types.join(', ') || 'n/d'}` });
    reasons.push({ criterion: 'outcome', statement: 'Esito principale rilevante per il paziente (mortalità, disabilità o morbilità maggiore)', evidence: f.outcomeEvidence });
    reasons.push({ criterion: 'size_rigor', statement: `Ampio (n ≥ ${C.trialMinN}), multicentrico e registrato`, evidence: `${f.sampleSize.snippet}; registrazione: ${f.registered}` });
    reasons.push({
      criterion: 'result',
      statement: f.significantClaim ? 'Risultato con effetto statisticamente significativo e intervallo/valore p riportato' : 'Risultato neutro in un trial ampio: può confermare o ridimensionare una pratica',
      evidence: f.resultEvidence,
    });
    return reasons;
  }

  if (type === 'meta_analysis' || type === 'systematic_review') {
    if (!f.ofRcts || f.outcomeTier !== 'major' || !f.outcomeEvidence) return [];
    if (!f.studyCount || f.studyCount < C.maMinStudies) return [];
    if (!f.sampleSize || f.sampleSize.n < C.maMinPatients) return [];
    if (!(f.prisma || f.riskOfBias)) return [];
    if (!f.ciOrP || !(f.significantClaim || f.nullClaim) || !f.resultEvidence) return [];
    reasons.push({ criterion: 'design', statement: `${type === 'meta_analysis' ? 'Meta-analisi' : 'Revisione sistematica'} di trial randomizzati${inferred}`, evidence: `Tipi di pubblicazione PubMed: ${a.pub_types.join(', ') || 'n/d'}` });
    reasons.push({ criterion: 'outcome', statement: 'Esito rilevante per il paziente', evidence: f.outcomeEvidence });
    reasons.push({ criterion: 'size_rigor', statement: `≥ ${C.maMinStudies} studi e ≥ ${C.maMinPatients} pazienti, con metodologia dichiarata`, evidence: `${f.studyCount} studi; ${f.sampleSize.snippet}` });
    reasons.push({ criterion: 'result', statement: 'Stima dell\'effetto con intervallo di confidenza o valore p', evidence: f.resultEvidence });
    return reasons;
  }

  if (type === 'guideline') {
    if (a.study_type_basis !== 'pubmed_tag') return [];
    if (f.ageDays == null || f.ageDays > C.guidelineMaxAgeDays) return [];
    if (!/recommendation/i.test(f.text)) return [];
    if (!(f.grade || /systematic review|evidence review/i.test(f.text))) return [];
    reasons.push({ criterion: 'guideline', statement: 'Nuova linea guida o raccomandazione ufficiale (tipo di pubblicazione PubMed)', evidence: `Tipi di pubblicazione PubMed: ${a.pub_types.join(', ')}` });
    reasons.push({
      criterion: 'size_rigor',
      statement: 'Metodologia basata su revisione sistematica delle evidenze / GRADE dichiarata',
      evidence: evidenceSentence((a.abstract ?? '').replace(/\n/g, ' '), /grade|systematic review|evidence review|certainty/i) ?? 'menzione nel testo',
    });
    return reasons;
  }
  return [];
}
