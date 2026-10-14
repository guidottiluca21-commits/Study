/**
 * Composizione della newsletter settimanale (HTML per i client di posta + testo semplice).
 * Funzione pura: stesso input => stesso output. Tutto il testo proveniente da PubMed è
 * trattato come non attendibile e viene sempre escapato.
 */
import type { CorePick } from './curriculum.ts';
import type { PlanDay } from './planner.ts';
import type { ArticleRecord, CoreItem, RankedItem } from './types.ts';
import { STUDY_TYPE_LABEL_IT } from './types.ts';
import { escapeHtml as esc } from './text.ts';
import { summarizeAbstract } from './summary.ts';

export interface Transparency {
  searchedAt: Date;
  windowFrom: string; // YYYY-MM-DD
  windowTo: string; // YYYY-MM-DD
  overlapDays: number;
  candidatesConsidered: number;
  alreadyReceived: number;
  belowThreshold: number;
  notes: string[];
  scoringVersion: string;
}

export interface NewsletterInput {
  weekStart: string; // lunedì, YYYY-MM-DD (fuso Europe/Rome)
  userName?: string | null;
  recent: RankedItem[];
  core: { pick: CorePick; topicTitle: string; prerequisiteTitles: string[] } | null;
  plan: { days: PlanDay[]; unplanned: { key: string; minutes: number }[] };
  planLabels: Record<string, string>; // key -> titolo breve
  transparency: Transparency;
  categoryNames: Record<string, string>;
  links: { site: string; unsubscribe: string; manage: string; privacy: string };
  now: Date;
}

export interface NewsletterOutput {
  subject: string;
  html: string;
  text: string;
  preheader: string;
  empty: boolean; // nessun contenuto da inviare (né novità né Core)
  executiveSummary: string[];
  totalMinutes: number;
}

const COLORS = { bg: '#faf8f3', card: '#ffffff', text: '#1f2328', muted: '#5a6169', accent: '#1d5c63', line: '#e3ded2', warnBg: '#f4efe2' };
const FONT = "-apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

export function subjectFor(weekStart: string): string {
  const d = new Date(weekStart + 'T00:00:00Z');
  const date = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(d);
  return `Anesthesia & Critical Care — Weekly Digest | ${date}`;
}

const dateIt = (ymd: string) =>
  new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(ymd + 'T00:00:00Z'));
const dateTimeRome = (d: Date) =>
  new Intl.DateTimeFormat('it-IT', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Europe/Rome' }).format(d);

const pubmedUrl = (pmid: string) => `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`;
const doiUrl = (doi: string) => `https://doi.org/${doi.split('/').map(encodeURIComponent).join('/')}`;

function articleMeta(a: ArticleRecord): string {
  const authors = a.authors.length ? a.authors.slice(0, 3).join(', ') + (a.authors.length > 3 ? ' et al.' : '') : null;
  return [authors, a.journal, a.pub_date_text ?? a.pub_date].filter(Boolean).join(' · ');
}

const UNCERT_IT = { low: 'incertezza bassa', medium: 'incertezza media', high: 'incertezza alta' } as const;

export function composeNewsletter(inp: NewsletterInput): NewsletterOutput {
  const { recent, core } = inp;
  const subject = subjectFor(inp.weekStart);
  const empty = recent.length === 0 && !core;

  // ---- sintesi esecutiva (massimo 5 punti) ------------------------------------------
  const exec: string[] = [];
  if (recent.length) {
    const cats = new Set(recent.map((r) => r.primary_category).filter(Boolean) as string[]);
    exec.push(`${recent.length} ${recent.length === 1 ? 'studio recente selezionato' : 'studi recenti selezionati'}${cats.size ? ` su ${cats.size} ${cats.size === 1 ? 'argomento' : 'argomenti'}` : ''}.`);
    const ov = recent.filter((r) => r.override_applied);
    for (const r of ov.slice(0, 2)) exec.push(`Evidenza potenzialmente practice-changing: «${shorten(r.article.title, 110)}» (criteri verificabili indicati sotto).`);
    const guide = recent.find((r) => r.article.study_type === 'guideline' && !r.override_applied);
    if (guide) exec.push(`Nuova linea guida o raccomandazione: «${shorten(guide.article.title, 110)}».`);
    const top = [...recent].sort((a, b) => b.final_score - a.final_score)[0]!;
    if (exec.length < 4) exec.push(`Più rilevante per te: «${shorten(top.article.title, 110)}» (${STUDY_TYPE_LABEL_IT[top.article.study_type].toLowerCase()}).`);
  } else {
    exec.push('Nessun nuovo studio ha superato i criteri di rilevanza e importanza questa settimana: non aggiungiamo riempitivi.');
  }
  if (core) exec.push(`Articolo fondamentale: «${shorten(core.pick.item.title, 100)}» (${core.topicTitle}). Obiettivo: ${core.pick.item.objectives[0] ?? '—'}`);
  const executiveSummary = exec.slice(0, 5);

  const totalMinutes = recent.reduce((a, r) => a + r.minutes, 0) + (core ? core.pick.item.reading_minutes : 0);
  const preheader = recent.length
    ? `${recent.length} ${recent.length === 1 ? 'lettura' : 'letture'} recenti${core ? ' + 1 articolo fondamentale' : ''} · circa ${totalMinutes} minuti`
    : core ? 'Un articolo fondamentale per il tuo percorso' : 'Nessuna novità rilevante questa settimana';

  // ---- HTML ---------------------------------------------------------------------------
  const h: string[] = [];
  const section = (title: string) =>
    `<tr><td style="padding:28px 24px 8px 24px"><h2 style="margin:0;font:600 18px/1.3 ${FONT};color:${COLORS.text};border-bottom:2px solid ${COLORS.accent};padding-bottom:6px">${esc(title)}</h2></td></tr>`;
  const para = (inner: string, extra = '') =>
    `<tr><td style="padding:6px 24px;font:400 15px/1.6 ${FONT};color:${COLORS.text};${extra}">${inner}</td></tr>`;

  h.push(`<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(subject)}</title></head>`);
  h.push(`<body style="margin:0;padding:0;background:${COLORS.bg}"><div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(preheader)}</div>`);
  h.push(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLORS.bg}"><tr><td align="center" style="padding:16px 8px">`);
  h.push(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;background:${COLORS.card};border:1px solid ${COLORS.line}">`);
  h.push(`<tr><td style="padding:24px 24px 4px 24px"><p style="margin:0;font:600 12px/1.4 ${FONT};letter-spacing:.08em;text-transform:uppercase;color:${COLORS.accent}">Anesthesia &amp; Critical Care</p><h1 style="margin:4px 0 0 0;font:600 24px/1.25 ${FONT};color:${COLORS.text}">Weekly Digest</h1><p style="margin:4px 0 0 0;font:400 14px/1.5 ${FONT};color:${COLORS.muted}">Settimana del ${esc(dateIt(inp.weekStart))}${inp.userName ? ` · per ${esc(inp.userName)}` : ''}</p></td></tr>`);

  h.push(section('In sintesi'));
  h.push(`<tr><td style="padding:6px 24px"><ul style="margin:0;padding-left:20px;font:400 15px/1.6 ${FONT};color:${COLORS.text}">${executiveSummary.map((s) => `<li style="margin:0 0 6px 0">${esc(s)}</li>`).join('')}</ul></td></tr>`);
  if (totalMinutes) h.push(para(`Tempo di lettura stimato: circa <strong>${totalMinutes} minuti</strong> in totale.`, `color:${COLORS.muted}`));

  // Recent Evidence
  if (recent.length) {
    h.push(section('Recent Evidence — novità selezionate'));
    recent.forEach((r, i) => h.push(renderRecent(r, i + 1, inp)));
  }

  // Core Knowledge
  if (core) {
    h.push(section('Core Knowledge — articolo fondamentale'));
    h.push(renderCore(core, inp));
  }

  // Piano settimanale
  const hasPlan = inp.plan.days.some((d) => d.items.length);
  if (hasPlan) {
    h.push(section('Piano settimanale'));
    h.push(`<tr><td style="padding:6px 24px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font:400 14px/1.5 ${FONT};color:${COLORS.text}">`);
    for (const d of inp.plan.days) {
      const body = d.rest ? `<span style="color:${COLORS.muted}">Giorno libero</span>` : d.items.length ? d.items.map((it) => `${esc(inp.planLabels[it.key] ?? it.key)} <span style="color:${COLORS.muted}">(${it.minutes} min)</span>`).join('<br>') : `<span style="color:${COLORS.muted}">Recupero / nessuna lettura</span>`;
      h.push(`<tr><td valign="top" width="96" style="padding:6px 8px 6px 0;border-top:1px solid ${COLORS.line};font-weight:600">${esc(d.name)}</td><td style="padding:6px 0;border-top:1px solid ${COLORS.line}">${body}</td></tr>`);
    }
    h.push('</table></td></tr>');
    h.push(para('Obiettivo abituale: una o due letture al giorno, con giorni liberi o di recupero. Puoi spostare le letture come preferisci.', `color:${COLORS.muted};font-size:13px`));
  }

  // Trasparenza
  h.push(section('Trasparenza'));
  h.push(`<tr><td style="padding:6px 24px"><div style="background:${COLORS.warnBg};padding:12px 14px;font:400 13px/1.6 ${FONT};color:${COLORS.text}">${transparencyLines(inp).map((l) => `<p style="margin:0 0 6px 0">${esc(l)}</p>`).join('')}</div></td></tr>`);

  // Piè di pagina
  h.push(`<tr><td style="padding:20px 24px 28px 24px;font:400 13px/1.6 ${FONT};color:${COLORS.muted}"><p style="margin:0 0 8px 0">Supporto allo studio personale: non sostituisce linee guida, la lettura dell'articolo completo né il giudizio clinico.</p><p style="margin:0"><a href="${esc(inp.links.manage)}" style="color:${COLORS.accent}">Gestisci preferenze</a> · <a href="${esc(inp.links.site)}" style="color:${COLORS.accent}">Apri la tua libreria</a> · <a href="${esc(inp.links.privacy)}" style="color:${COLORS.accent}">Privacy</a> · <a href="${esc(inp.links.unsubscribe)}" style="color:${COLORS.accent}">Annulla l'iscrizione</a></p></td></tr>`);
  h.push('</table></td></tr></table></body></html>');

  return {
    subject,
    html: h.join(''),
    text: renderText(inp, subject, executiveSummary, totalMinutes),
    preheader,
    empty,
    executiveSummary,
    totalMinutes,
  };
}

function shorten(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…';
}

function transparencyLines(inp: NewsletterInput): string[] {
  const t = inp.transparency;
  const lines = [
    `Ricerca eseguita il ${dateTimeRome(t.searchedAt)} (fuso Europe/Rome) su PubMed (NCBI E-utilities).`,
    `Intervallo coperto: dal ${dateIt(t.windowFrom)} al ${dateIt(t.windowTo)}, per data di inserimento in PubMed, con sovrapposizione di ${t.overlapDays} giorni per recuperare i record indicizzati in ritardo.`,
    `Criteri: priorità che hai assegnato agli argomenti; importanza scientifica stimata (tipo di studio, dimensione del campione, esito principale, indicatori di rigore, novità) con soglie minime; override per evidenze potenzialmente practice-changing solo se tutti i criteri verificabili sono soddisfatti (non dipendono dalla rivista). Punteggi indicativi, versione ${t.scoringVersion}, non validati scientificamente.`,
    `Candidati valutati: ${t.candidatesConsidered}; già ricevuti in passato: ${t.alreadyReceived}; sotto soglia: ${t.belowThreshold}; proposti: ${inp.recent.length}.`,
    'Limiti: le sintesi si basano sull\'ABSTRACT, non sul full text; la classificazione per argomento e il tipo di studio sono automatici e possono contenere errori; gli articoli senza abstract sono esclusi; articoli indicizzati in ritardo possono comparire nelle settimane successive.',
    ...t.notes,
  ];
  return lines;
}

function renderRecent(r: RankedItem, n: number, inp: NewsletterInput): string {
  const a = r.article;
  const s = summarizeAbstract(a, inp.now);
  const links = [`<a href="${esc(pubmedUrl(a.pmid))}" style="color:${COLORS.accent}">PubMed (PMID ${esc(a.pmid)})</a>`];
  if (a.doi) links.push(`<a href="${esc(doiUrl(a.doi))}" style="color:${COLORS.accent}">DOI</a>`);
  const catName = r.primary_category ? inp.categoryNames[r.primary_category] ?? r.primary_category : null;
  const rows: string[] = [];
  rows.push(`<p style="margin:0 0 2px 0;font:600 12px/1.4 ${FONT};color:${COLORS.accent};text-transform:uppercase;letter-spacing:.05em">${n}. ${esc(STUDY_TYPE_LABEL_IT[a.study_type])}${catName ? ` · ${esc(catName)}` : ''}</p>`);
  rows.push(`<h3 style="margin:0 0 4px 0;font:600 17px/1.35 ${FONT};color:${COLORS.text}"><a href="${esc(pubmedUrl(a.pmid))}" style="color:${COLORS.text};text-decoration:underline">${esc(a.title)}</a></h3>`);
  rows.push(`<p style="margin:0 0 8px 0;font:400 13px/1.5 ${FONT};color:${COLORS.muted}">${esc(articleMeta(a))}</p>`);
  if (r.override_applied) {
    rows.push(`<div style="border-left:4px solid ${COLORS.accent};background:${COLORS.warnBg};padding:8px 12px;margin:0 0 10px 0;font:400 13px/1.55 ${FONT}"><strong>Evidenza potenzialmente practice-changing</strong> (proposta indipendentemente dalle tue priorità). Criteri verificabili:<ul style="margin:6px 0 0 0;padding-left:18px">${r.override_reasons.map((o) => `<li><strong>${esc(o.statement)}.</strong> <span style="color:${COLORS.muted}">«${esc(o.evidence)}»</span></li>`).join('')}</ul></div>`);
  }
  rows.push(`<p style="margin:0 0 6px 0;font:400 14px/1.55 ${FONT}"><strong>Disegno:</strong> ${esc(s.design)}</p>`);
  if (s.result) rows.push(`<p style="margin:0 0 6px 0;font:400 14px/1.55 ${FONT}"><strong>Risultato principale</strong> <span style="color:${COLORS.muted}">(dall'abstract)</span>: «${esc(s.result)}»</p>`);
  if (s.conclusion) rows.push(`<p style="margin:0 0 6px 0;font:400 14px/1.55 ${FONT}"><strong>Conclusione degli autori:</strong> «${esc(s.conclusion)}»</p>`);
  rows.push(`<p style="margin:0 0 6px 0;font:400 14px/1.55 ${FONT}"><strong>Limiti metodologici:</strong> ${r.limitations.length ? esc(r.limitations.join('; ')) : 'non valutabili dall\'abstract oltre a quanto indicato nel disegno'}.</p>`);
  if (r.discordance_hint) rows.push(`<p style="margin:0 0 6px 0;font:400 14px/1.55 ${FONT}"><strong>Possibile discordanza con evidenze precedenti</strong> (da verificare): «${esc(r.discordance_hint)}»</p>`);
  rows.push(`<p style="margin:0 0 6px 0;font:400 14px/1.55 ${FONT}"><strong>Perché lo vedi:</strong> ${esc(r.reason)}</p>`);
  rows.push(`<p style="margin:0;font:400 13px/1.5 ${FONT};color:${COLORS.muted}">Lettura stimata: ${r.minutes} min · punteggio indicativo ${r.final_score}/100 (${esc(UNCERT_IT[r.uncertainty])}) · ${links.join(' · ')}</p>`);
  return `<tr><td style="padding:12px 24px"><div style="border:1px solid ${COLORS.line};padding:14px 16px">${rows.join('')}</div></td></tr>`;
}

function renderCore(core: NonNullable<NewsletterInput['core']>, inp: NewsletterInput): string {
  const it: CoreItem = core.pick.item;
  const url = it.pmid ? pubmedUrl(it.pmid) : null;
  const links: string[] = [];
  if (url) links.push(`<a href="${esc(url)}" style="color:${COLORS.accent}">PubMed (PMID ${esc(it.pmid!)})</a>`);
  if (it.doi) links.push(`<a href="${esc(doiUrl(it.doi))}" style="color:${COLORS.accent}">DOI</a>`);
  const reasonLabel = core.pick.reason === 'review' ? 'Ripasso' : core.pick.reason === 'update' ? 'Aggiornamento' : 'Nuovo';
  return `<tr><td style="padding:12px 24px"><div style="border:1px solid ${COLORS.line};padding:14px 16px">
<p style="margin:0 0 2px 0;font:600 12px/1.4 ${FONT};color:${COLORS.accent};text-transform:uppercase;letter-spacing:.05em">${esc(core.topicTitle)} · ${reasonLabel}</p>
<h3 style="margin:0 0 4px 0;font:600 17px/1.35 ${FONT};color:${COLORS.text}">${url ? `<a href="${esc(url)}" style="color:${COLORS.text};text-decoration:underline">${esc(it.title)}</a>` : esc(it.title)}</h3>
<p style="margin:0 0 8px 0;font:400 13px/1.5 ${FONT};color:${COLORS.muted}">${esc([it.authors.join(', '), it.journal, it.pub_year].filter(Boolean).join(' · '))}</p>
<p style="margin:0 0 6px 0;font:400 14px/1.55 ${FONT}"><strong>Perché è fondamentale:</strong> ${esc(it.rationale)}</p>
<p style="margin:0 0 4px 0;font:400 14px/1.55 ${FONT}"><strong>Obiettivi di apprendimento:</strong></p>
<ul style="margin:0 0 6px 0;padding-left:20px;font:400 14px/1.55 ${FONT}">${it.objectives.map((o) => `<li>${esc(o)}</li>`).join('')}</ul>
${core.prerequisiteTitles.length ? `<p style="margin:0 0 6px 0;font:400 14px/1.55 ${FONT}"><strong>Prerequisiti (già completati):</strong> ${esc(core.prerequisiteTitles.join('; '))}</p>` : `<p style="margin:0 0 6px 0;font:400 14px/1.55 ${FONT}"><strong>Prerequisiti:</strong> nessuno.</p>`}
${core.pick.note ? `<p style="margin:0 0 6px 0;font:400 14px/1.55 ${FONT}">${esc(core.pick.note)}</p>` : ''}
<p style="margin:0;font:400 13px/1.5 ${FONT};color:${COLORS.muted}">Tempo stimato: ${it.reading_minutes} min · ${links.join(' · ')}</p>
<p style="margin:6px 0 0 0;font:400 12px/1.5 ${FONT};color:${COLORS.muted}">La motivazione e gli obiettivi sono una bozza editoriale non ancora rivista da un clinico.</p>
</div></td></tr>`;
}

function renderText(inp: NewsletterInput, subject: string, exec: string[], totalMinutes: number): string {
  const L: string[] = [];
  L.push(subject, '='.repeat(Math.min(72, subject.length)), '', `Settimana del ${dateIt(inp.weekStart)}`, '', 'IN SINTESI');
  exec.forEach((e) => L.push(`- ${e}`));
  if (totalMinutes) L.push(`Tempo di lettura stimato: circa ${totalMinutes} minuti.`);
  if (inp.recent.length) {
    L.push('', 'RECENT EVIDENCE — NOVITÀ SELEZIONATE');
    inp.recent.forEach((r, i) => {
      const a = r.article;
      const s = summarizeAbstract(a, inp.now);
      L.push('', `${i + 1}. ${a.title}`, `   ${STUDY_TYPE_LABEL_IT[a.study_type]} · ${articleMeta(a)}`);
      if (r.override_applied) {
        L.push('   EVIDENZA POTENZIALMENTE PRACTICE-CHANGING (criteri verificabili):');
        r.override_reasons.forEach((o) => L.push(`   * ${o.statement}: «${o.evidence}»`));
      }
      L.push(`   Disegno: ${s.design}`);
      if (s.result) L.push(`   Risultato principale (dall'abstract): «${s.result}»`);
      if (s.conclusion) L.push(`   Conclusione degli autori: «${s.conclusion}»`);
      L.push(`   Limiti metodologici: ${r.limitations.length ? r.limitations.join('; ') : "non valutabili dall'abstract oltre al disegno"}.`);
      if (r.discordance_hint) L.push(`   Possibile discordanza (da verificare): «${r.discordance_hint}»`);
      L.push(`   Perché lo vedi: ${r.reason}`, `   Lettura: ${r.minutes} min · punteggio ${r.final_score}/100 (${UNCERT_IT[r.uncertainty]})`, `   PubMed: ${pubmedUrl(a.pmid)}${a.doi ? `  DOI: ${doiUrl(a.doi)}` : ''}`);
    });
  }
  if (inp.core) {
    const it = inp.core.pick.item;
    L.push('', 'CORE KNOWLEDGE — ARTICOLO FONDAMENTALE', '', `${it.title}`, `   ${inp.core.topicTitle} · ${[it.authors.join(', '), it.journal, it.pub_year].filter(Boolean).join(' · ')}`,
      `   Perché è fondamentale: ${it.rationale}`, '   Obiettivi di apprendimento:');
    it.objectives.forEach((o) => L.push(`   - ${o}`));
    L.push(`   Prerequisiti: ${inp.core.prerequisiteTitles.length ? inp.core.prerequisiteTitles.join('; ') : 'nessuno'}`);
    if (inp.core.pick.note) L.push(`   ${inp.core.pick.note}`);
    L.push(`   Tempo stimato: ${it.reading_minutes} min`, `   ${it.pmid ? pubmedUrl(it.pmid) : ''}${it.doi ? `  DOI: ${doiUrl(it.doi)}` : ''}`, '   (Motivazione e obiettivi: bozza editoriale non ancora rivista da un clinico.)');
  }
  if (inp.plan.days.some((d) => d.items.length)) {
    L.push('', 'PIANO SETTIMANALE');
    for (const d of inp.plan.days) {
      L.push(`   ${d.name.padEnd(10)} ${d.rest ? 'Giorno libero' : d.items.length ? d.items.map((x) => `${inp.planLabels[x.key] ?? x.key} (${x.minutes} min)`).join(' + ') : 'Recupero / nessuna lettura'}`);
    }
  }
  L.push('', 'TRASPARENZA');
  transparencyLines(inp).forEach((l) => L.push(`- ${l}`));
  L.push('', 'Supporto allo studio personale: non sostituisce linee guida, la lettura dell\'articolo completo né il giudizio clinico.',
    `Gestisci preferenze: ${inp.links.manage}`, `Annulla l'iscrizione: ${inp.links.unsubscribe}`, `Privacy: ${inp.links.privacy}`);
  return L.join('\n');
}
