/**
 * Sintesi ESTRATTIVA dell'abstract: nessun testo generato. Le frasi riportate sono quelle
 * dell'abstract (troncate a fine frase) e sono dichiarate come tali. Non legge il full text.
 */
import type { ArticleRecord } from './types.ts';
import { STUDY_TYPE_LABEL_IT } from './types.ts';
import { abstractSections, splitSentences, truncateAtSentence } from './text.ts';
import { extractFeatures } from './scoring.ts';

export interface AbstractSummary {
  design: string; // es. "Trial randomizzato · multicentrico · n = 2,500"
  result: string | null; // frase dell'abstract (risultati)
  conclusion: string | null; // frase dell'abstract (conclusioni)
  basis: 'abstract';
}

export function summarizeAbstract(a: ArticleRecord, now: Date): AbstractSummary {
  const f = extractFeatures(a, now);
  const parts = [STUDY_TYPE_LABEL_IT[a.study_type]];
  if (a.study_type_basis === 'inferred_from_text') parts[0] += ' (dedotto dal testo)';
  if (f.multicenter) parts.push('multicentrico');
  if (f.blinded) parts.push('in cieco');
  if (f.registered) parts.push(`registrato (${f.registered})`);
  if (f.sampleSize) parts.push(`n = ${f.sampleSize.n.toLocaleString('en-US')}`);
  if ((a.study_type === 'meta_analysis' || a.study_type === 'systematic_review') && f.studyCount) parts.push(`${f.studyCount} studi`);

  const secs = abstractSections(a.abstract);
  const pick = (...keys: string[]) => keys.map((k) => secs[k]).find(Boolean) ?? null;
  const resultsText = pick('RESULTS', 'FINDINGS');
  const conclText = pick('CONCLUSIONS', 'CONCLUSION', 'INTERPRETATION', 'CONCLUSIONS AND RELEVANCE');

  let result: string | null = null;
  if (resultsText) {
    const ss = splitSentences(resultsText);
    result = ss.find((s) => /\d/.test(s) && /(%|ci\b|p\s*[<=]|hazard|odds|risk|ratio|difference)/i.test(s)) ?? ss[0] ?? null;
  }
  let conclusion: string | null = null;
  if (conclText) conclusion = splitSentences(conclText)[0] ?? null;
  else if (!resultsText && a.abstract) {
    const ss = splitSentences(a.abstract.replace(/\n/g, ' '));
    conclusion = ss[ss.length - 1] ?? null; // abstract non strutturato: ultima frase
  }
  return {
    design: parts.join(' · '),
    result: result ? truncateAtSentence(result, 300) : null,
    conclusion: conclusion ? truncateAtSentence(conclusion, 300) : null,
    basis: 'abstract',
  };
}
