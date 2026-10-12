(() => {
'use strict';

const D = window.STUDY_DATA;
const KEY = 'study.v1';
const INTERVALS = [1, 3, 7, 21]; // giorni dopo lo studio per i ripassi
const LEVEL_SHORT = ['', '1 Mai', '2 Poco', '3 Ripasso', '4 Solido'];
const MIN_START = 10; // minuti del "minimo" per cominciare

// ---------- utilità data ----------
const z2 = (n) => String(n).padStart(2, '0');
const fmt = (d) => `${d.getFullYear()}-${z2(d.getMonth() + 1)}-${z2(d.getDate())}`;
const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const todayStr = () => fmt(new Date());
const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return fmt(d); };
const mondayOf = (s) => addDays(s, -((parse(s).getDay() + 6) % 7));
const daysBetween = (a, b) => Math.round((parse(b) - parse(a)) / 86400000);
const itDate = (s, opt) => parse(s).toLocaleDateString('it-IT', opt || { day: 'numeric', month: 'long', year: 'numeric' });

// ---------- DOM ----------
function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)) {
    if (c == null || c === false) continue;
    e.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return e;
}
const $app = document.getElementById('app');
const $dlg = document.getElementById('dlg');

function openDlg(title, body, buttons) {
  $dlg.replaceChildren(
    h('h2', {}, title),
    ...[].concat(body),
    h('menu', {}, buttons.map((b) => h('button', {
      class: b.primary ? 'primary' : (b.danger ? 'danger' : ''),
      type: 'button',
      onclick: () => { if (!b.onClick || b.onClick() !== false) closeDlg(); },
    }, b.label)))
  );
  if (!$dlg.open) $dlg.showModal();
}
function closeDlg() { if ($dlg.open) $dlg.close(); }

// ---------- stato ----------
function defaults() {
  return {
    v: 1, start: todayStr(), levels: {}, overrides: {}, sessions: [], unitsDone: {},
    off: {}, light: {}, skipped: {}, saved: {}, dismissed: {},
    baselinePct: null, lastExport: null,
    settings: { weeklyTarget: 4, taskMin: 30, endDate: '', edaicOn: true, edaicDate: '', olaDate: '', rotation: [] },
  };
}
function migrate(o) {
  const d = defaults();
  const s = Object.assign({}, d, o);
  s.settings = Object.assign({}, d.settings, (o && o.settings) || {});
  return s;
}
let mem = null;
let storageBroken = false;
function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return migrate(JSON.parse(raw));
  } catch (e) { storageBroken = true; }
  return mem ? migrate(mem) : defaults();
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(S)); }
  catch (e) { storageBroken = true; mem = JSON.parse(JSON.stringify(S)); }
}
let S = load();

// ---------- dominio ----------
const srcName = (id) => (D.sources[id] ? D.sources[id].name : '');
const areaOf = (id) => D.areas.find((a) => a.id === id);
function topics() {
  return D.topics.map((t) => {
    const ov = S.overrides[t.id] || {};
    return Object.assign({}, t, { p: 'p' in ov ? ov.p : t.p, ref: ov.ref || '' });
  });
}
const topicById = (id) => topics().find((t) => t.id === id);
const level = (id) => S.levels[id] || 1;
const setLevel = (id, l) => { S.levels[id] = l; save(); };

// capitoli (unità di studio) per fonte
const ALL_UNITS = [];
Object.entries(window.STUDY_UNITS || {}).forEach(([src, rows]) => rows.forEach((r) => ALL_UNITS.push({
  id: `${src}:${r[0]}`, src, n: r[0], t: r[1], p1: r[2], p2: r[3], read: r[4] === 'r', tp: r[5],
  pages: r[3] ? r[3] - r[2] + 1 : null,
})));
const unitDone = (u) => !!S.unitsDone[u.id];
const unitLabel = (u) => `Cap. ${u.n} – ${u.t} (${u.p2 ? `pp. ${u.p1}–${u.p2}, ${u.pages} pag.` : `da p. ${u.p1}`})${u.read ? ' · solo lettura' : ''}`;
function unitsOfTopic(t) {
  const mine = ALL_UNITS.filter((u) => u.tp.includes(t.id));
  return { primary: mine.filter((u) => u.src === t.p), extra: mine.filter((u) => u.src !== t.p) };
}
function markUnits(ids, done) {
  ids.forEach((id) => { if (done) S.unitsDone[id] = todayStr(); else delete S.unitsDone[id]; });
  save();
}
function pagesSummary(src) {
  const us = ALL_UNITS.filter((u) => u.src === src);
  const sum = (arr) => arr.reduce((a, u) => a + (u.pages || 0), 0);
  return { total: sum(us), done: sum(us.filter(unitDone)), n: us.length, nDone: us.filter(unitDone).length };
}

function lastStudy(tid) {
  let d = null;
  for (const s of S.sessions) if (s.tid === tid && s.type === 'study' && (!d || s.d > d)) d = s.d;
  return d;
}
function dueReviews(today) {
  const out = [];
  for (const t of D.topics) {
    const ls = lastStudy(t.id);
    if (!ls) continue;
    const n = S.sessions.filter((s) => s.tid === t.id && s.type === 'review' && s.d > ls).length;
    if (n >= INTERVALS.length) continue;
    const due = addDays(ls, INTERVALS[n]);
    if (due <= today) out.push({ tid: t.id, due, n });
  }
  return out.sort((a, b) => (a.due < b.due ? -1 : 1));
}
function pickTask() {
  const today = todayStr();
  const done = new Set(S.sessions.filter((s) => s.d === today).map((s) => s.tid));
  const skipped = S.skipped[today] || [];
  const ok = (id) => !done.has(id) && !skipped.includes(id);
  const reviews = dueReviews(today).filter((r) => ok(r.tid));
  if (reviews.length) return { type: 'review', tid: reviews[0].tid, step: reviews[0].n, pending: reviews.length };
  const rot = new Set(S.settings.rotation);
  const list = topics().filter((t) => ok(t.id) && level(t.id) < 4);
  if (!list.length) return null;
  const idx = new Map(D.topics.map((t, i) => [t.id, i]));
  const allDone = (t) => { const pr = unitsOfTopic(t).primary; return pr.length > 0 && pr.every(unitDone); };
  const score = (t) => (level(t.id) - 1) * 10 + (rot.has(t.a) ? -15 : 0) + (t.p ? 0 : 12) + (allDone(t) ? 25 : 0) + idx.get(t.id) / 1000;
  list.sort((a, b) => score(a) - score(b));
  return { type: 'study', tid: list[0].id };
}

function weekStats(monday) {
  const days = [...Array(7)].map((_, i) => addDays(monday, i));
  const studied = days.filter((d) => S.sessions.some((s) => s.d === d));
  const off = days.filter((d) => S.off[d]);
  const minutes = S.sessions.filter((s) => days.includes(s.d)).reduce((a, s) => a + s.min, 0);
  const target = Math.max(1, Math.min(S.settings.weeklyTarget, 7 - off.length));
  return { days, studied, off, minutes, target, ok: studied.length >= target };
}
function streakWeeks() {
  let m = addDays(mondayOf(todayStr()), -7), n = 0;
  for (let i = 0; i < 104; i++) {
    if (weekStats(m).ok) { n++; m = addDays(m, -7); } else break;
  }
  return n;
}
const pctAtLeast3 = () => {
  const all = D.topics;
  return Math.round(100 * all.filter((t) => level(t.id) >= 3).length / all.length);
};

function milestones() {
  const end = S.settings.endDate;
  if (!end) return null;
  const today = todayStr();
  const total = daysBetween(S.start, end);
  if (total <= 0) return { over: true, list: [] };
  const nq = Math.max(1, Math.round(total / 91));
  const base = S.baselinePct == null ? pctAtLeast3() : S.baselinePct;
  const cur = pctAtLeast3();
  const list = [];
  for (let k = 1; k <= nq; k++) {
    const date = addDays(S.start, Math.round(total * k / nq));
    const target = Math.round(base + (100 - base) * k / nq);
    list.push({ k, date, target, past: date < today, met: cur >= target });
  }
  return { over: false, list, cur, base };
}

function summaryText() {
  const m = mondayOf(todayStr());
  const w = weekStats(m);
  const names = [...new Set(S.sessions.filter((s) => w.days.includes(s.d)).map((s) => (topicById(s.tid) || {}).t))].filter(Boolean);
  const solid = D.topics.filter((t) => level(t.id) === 4).length;
  return [
    `Riepilogo studio – settimana dal ${itDate(m, { day: 'numeric', month: 'long' })}`,
    `Giorni di studio: ${w.studied.length} su ${w.target} (obiettivo)`,
    `Minuti totali: ${w.minutes}`,
    `Serie di settimane complete: ${streakWeeks()}`,
    `Argomenti a livello almeno 3: ${pctAtLeast3()}% (solidi: ${solid}/${D.topics.length})`,
    names.length ? `Argomenti della settimana:\n- ${names.join('\n- ')}` : 'Argomenti della settimana: nessuno registrato',
  ].join('\n');
}

// ---------- registrazione sessioni ----------
let run = null;      // timer in corso
let tick = null;
let another = false; // mostra un altro compito dopo il primo del giorno

function logSession(tid, type, min, lv) {
  S.sessions.push({ d: todayStr(), tid, min, type });
  if (lv) setLevel(tid, lv);
  delete S.off[todayStr()];
  save();
}
function askFinish(task, minutes) {
  const pending = unitsOfTopic(topicById(task.tid)).primary.filter((u) => !unitDone(u)).slice(0, 6);
  const checks = pending.map((u) => h('label', {}, h('input', { type: 'checkbox', 'data-u': u.id }), unitLabel(u)));
  const minInput = h('input', { type: 'number', min: 1, max: 600, value: Math.max(1, minutes), 'aria-label': 'Minuti' });
  const levelButtons = [[2, 'Ricordo poco'], [3, 'Da ripassare'], [4, 'Solido']].map(([l, label]) =>
    h('button', {
      type: 'button',
      onclick: () => {
        const m = Math.max(1, Math.min(600, parseInt(minInput.value, 10) || 1));
        logSession(task.tid, task.type, m, l);
        markUnits([...$dlg.querySelectorAll('input[data-u]:checked')].map((c) => c.getAttribute('data-u')), true);
        stopRun(); another = false; closeDlg(); render();
      },
    }, label));
  openDlg('Come è andata?', [
    h('div', { class: 'field' }, h('label', {}, 'Minuti studiati'), minInput),
    pending.length ? h('div', { class: 'field checks' }, h('label', {}, 'Capitoli completati'), checks) : null,
    h('p', { class: 'muted' }, 'Quanto ricordi di questo argomento?'),
    h('div', { class: 'row' }, levelButtons),
  ], [{ label: 'Annulla' }]);
}
function stopRun() { run = null; if (tick) { clearInterval(tick); tick = null; } }
function startRun(task) {
  run = { task, start: Date.now(), buzzed: false };
  tick = setInterval(updateTimer, 1000);
  render();
}
function updateTimer() {
  const el = document.getElementById('timer');
  const msg = document.getElementById('timer-msg');
  if (!run || !el) return;
  const sec = Math.floor((Date.now() - run.start) / 1000);
  if (sec < MIN_START * 60) {
    const left = MIN_START * 60 - sec;
    el.textContent = `${z2(Math.floor(left / 60))}:${z2(left % 60)}`;
    msg.textContent = 'Basta cominciare: per ora devi solo restare qui fino a zero.';
  } else {
    el.textContent = `${z2(Math.floor(sec / 60))}:${z2(sec % 60)}`;
    msg.textContent = 'Minimo raggiunto. Puoi continuare o chiudere quando vuoi.';
    if (!run.buzzed) { run.buzzed = true; try { navigator.vibrate && navigator.vibrate(200); } catch (e) { /* ignora */ } }
  }
}

// ---------- viste ----------
function sourceLine(t) {
  if (!t.p) return h('div', { class: 'src' }, h('span', { class: 'none' }, 'Fonte da assegnare'));
  return h('div', { class: 'src' }, 'Fonte: ', h('b', {}, srcName(t.p)), t.ref ? ` – ${t.ref}` : '',
    t.s.length ? ` · Integra con: ${t.s.map(srcName).join(', ')}` : '');
}

function unitsBlock(t, limit) {
  const { primary, extra } = unitsOfTopic(t);
  const todo = primary.filter((u) => !unitDone(u));
  if (!primary.length && !extra.length) return null;
  const box = h('div', { class: 'small', style: 'margin-top:8px' });
  if (primary.length) {
    box.append(h('div', {}, h('b', {}, todo.length ? 'Da studiare: ' : 'Capitoli della fonte primaria: tutti completati')));
    todo.slice(0, limit || 3).forEach((u) => box.append(h('div', { class: 'muted' }, '• ', unitLabel(u))));
    if (todo.length > (limit || 3)) box.append(h('div', { class: 'muted' }, `… e altri ${todo.length - (limit || 3)}`));
  }
  const ex = extra.filter((u) => !unitDone(u));
  if (ex.length) box.append(h('div', { class: 'muted', style: 'margin-top:4px' }, 'Integrazioni: ', ex.slice(0, 3).map((u) => `${srcName(u.src).split(' ')[0]} cap. ${u.n}`).join(', '), ex.length > 3 ? '…' : ''));
  return box;
}

function viewToday() {
  const today = todayStr();
  const out = [];
  const stats = weekStats(mondayOf(today));
  const todays = S.sessions.filter((s) => s.d === today);
  const hasAny = S.sessions.length > 0 || Object.keys(S.levels).length > 0;

  out.push(h('p', { class: 'muted', style: 'margin-bottom:4px' }, itDate(today, { weekday: 'long', day: 'numeric', month: 'long' })));
  out.push(h('h1', {}, 'Oggi'));

  if (storageBroken) out.push(h('div', { class: 'banner' }, 'Il salvataggio sul dispositivo non è disponibile (navigazione privata o dati bloccati): i progressi si perderanno chiudendo la pagina.'));
  if (!hasAny) out.push(h('div', { class: 'banner' }, h('b', {}, 'Per cominciare (2 minuti): '),
    'nella sezione Piano imposta il livello per ciascuna area. Fino ad allora tutti gli argomenti risultano "mai studiati".',
    h('div', { style: 'margin-top:8px' }, h('a', { class: 'btn primary', href: '#piano', style: 'display:inline-block;text-decoration:none' }, 'Vai al Piano'))));
  const stale = S.sessions.length > 5 && (!S.lastExport || daysBetween(S.lastExport, today) > 30);
  if (stale) out.push(h('div', { class: 'banner' }, 'I dati sono solo su questo telefono. ', h('a', { href: '#imp' }, 'Fai un backup (Opzioni)'), ' ogni tanto.'));

  if (S.off[today]) {
    out.push(h('div', { class: 'card hero' }, h('div', { class: 'kicker' }, 'Giorno libero'),
      h('h2', {}, 'Oggi riposi, e la tua serie non si rompe.'),
      h('p', { class: 'muted' }, 'Questa giornata è stata tolta dal conto dell\'obiettivo settimanale.'),
      h('button', { onclick: () => { delete S.off[today]; save(); render(); } }, 'Annulla')));
  } else if (run) {
    const t = topicById(run.task.tid);
    out.push(h('div', { class: 'card hero' },
      h('div', { class: 'kicker' }, run.task.type === 'review' ? 'Ripasso in corso' : 'Studio in corso'),
      h('h2', {}, t.t), sourceLine(t),
      h('div', { class: 'timer', id: 'timer', 'aria-live': 'off' }, '10:00'),
      h('p', { class: 'muted', id: 'timer-msg' }, ''),
      h('div', { class: 'row' },
        h('button', { class: 'primary', onclick: () => askFinish(run.task, Math.round((Date.now() - run.start) / 60000)) }, 'Fatto'),
        h('button', { class: 'ghost', onclick: () => { stopRun(); render(); } }, 'Annulla'))));
  } else if (todays.length && !another) {
    const mins = todays.reduce((a, s) => a + s.min, 0);
    out.push(h('div', { class: 'card hero' }, h('div', { class: 'kicker' }, 'Fatto per oggi'),
      h('h2', {}, `Hai studiato ${mins} ${mins === 1 ? 'minuto' : 'minuti'} oggi.`),
      h('p', { class: 'muted' }, 'L\'obiettivo di oggi è raggiunto. Tutto il resto è in più.'),
      h('button', { onclick: () => { another = true; render(); } }, 'Fai un altro compito')));
  } else {
    const task = pickTask();
    if (!task) {
      out.push(h('div', { class: 'card hero' }, h('h2', {}, 'Nessun compito disponibile'),
        h('p', {}, 'Tutti gli argomenti sono a livello "Solido" o già fatti oggi. Rivedi i livelli nel Piano.')));
    } else {
      const t = topicById(task.tid);
      const a = areaOf(t.a);
      const light = !!S.light[today];
      const estMin = task.type === 'review' ? Math.round(S.settings.taskMin / 2) : (light ? MIN_START : S.settings.taskMin);
      out.push(h('div', { class: 'card hero' },
        h('div', { class: 'kicker' }, task.type === 'review' ? `Ripasso dovuto${task.pending > 1 ? ` (+${task.pending - 1} in coda)` : ''}` : 'Il compito di oggi'),
        h('h2', {}, t.t),
        h('div', { class: 'row', style: 'margin-bottom:8px' }, h('span', { class: 'pill' }, a.name), h('span', { class: 'pill ok' }, `~${estMin} min`), light ? h('span', { class: 'pill warn' }, 'Giornata leggera') : null),
        sourceLine(t), unitsBlock(t),
        task.type === 'review' ? h('p', { class: 'muted small', style: 'margin-top:8px' }, 'Ripasso a intervalli: prova a ricordare prima di riaprire il testo, poi controlla.') : null,
        h('div', { style: 'margin-top:14px' }, h('button', { class: 'primary big', onclick: () => startRun(task) }, `Inizia ${MIN_START} minuti`)),
        h('div', { class: 'row', style: 'margin-top:10px' },
          h('button', { class: 'ghost', onclick: () => {
            const m = Math.max(1, S.settings.taskMin);
            const minInput = h('input', { type: 'number', min: 1, max: 600, value: estMin || m });
            openDlg('Registra senza timer', [h('div', { class: 'field' }, h('label', {}, 'Minuti'), minInput)], [
              { label: 'Annulla' },
              { label: 'Avanti', primary: true, onClick: () => { const v = parseInt(minInput.value, 10) || 1; setTimeout(() => askFinish(task, v), 0); } },
            ]);
          } }, 'Ho già studiato'),
          h('button', { class: 'ghost', onclick: () => { (S.skipped[today] = S.skipped[today] || []).push(task.tid); save(); render(); } }, 'Cambia argomento'),
          !t.p ? h('button', { class: 'ghost', onclick: () => editTopic(t.id) }, 'Assegna fonte') : null)));
    }
    const row = h('div', { class: 'row' });
    if (!S.light[today]) row.append(h('button', { class: 'ghost', onclick: () => { S.light[today] = true; save(); render(); } }, 'Giornata pesante: obiettivo ridotto'));
    row.append(h('button', { class: 'ghost', onclick: () => { S.off[today] = true; save(); render(); } }, 'Guardia / riposo: salta oggi'));
    out.push(h('div', { class: 'card' }, h('div', { class: 'kicker' }, 'Quando non ce la fai'), h('p', { class: 'muted small' }, 'Dopo una notte o in un giorno pieno non perdi la serie: l\'obiettivo si riduce.'), row));
  }

  // settimana
  const streak = streakWeeks();
  const pct = Math.min(100, Math.round(100 * stats.studied.length / stats.target));
  const chartDays = [...Array(30)].map((_, i) => addDays(today, i - 29));
  const mins = chartDays.map((d) => S.sessions.filter((s) => s.d === d).reduce((a, s) => a + s.min, 0));
  const max = Math.max(60, ...mins);
  out.push(h('div', { class: 'card' },
    h('div', { class: 'kicker' }, 'Questa settimana'),
    h('div', { class: 'row between' }, h('h2', {}, `${stats.studied.length} su ${stats.target} giorni`), h('span', { class: stats.ok ? 'pill ok' : 'pill' }, stats.ok ? 'Obiettivo raggiunto' : `${stats.minutes} min`)),
    h('div', { class: `bar ${stats.ok ? 'ok' : ''}`, role: 'progressbar', 'aria-valuenow': pct, 'aria-valuemin': 0, 'aria-valuemax': 100 }, h('i', { style: `width:${pct}%` })),
    h('p', { class: 'muted small', style: 'margin-top:8px' }, streak ? `Serie: ${streak} ${streak === 1 ? 'settimana completa' : 'settimane complete'} di fila.` : 'Completa la settimana per aprire una serie.'),
    h('div', { class: 'chart', role: 'img', 'aria-label': 'Minuti di studio negli ultimi 30 giorni' },
      chartDays.map((d, i) => h('i', { class: mins[i] ? '' : (S.off[d] ? 'off' : 'z'), style: `height:${mins[i] ? Math.max(8, 100 * mins[i] / max) : 4}%`, title: `${itDate(d, { day: 'numeric', month: 'short' })}: ${mins[i]} min` }))),
    h('p', { class: 'muted small' }, 'Ultimi 30 giorni (arancione = giorno libero)'),
    h('div', { style: 'margin-top:10px' }, h('button', { onclick: () => copyText(summaryText(), 'Riepilogo settimanale') }, 'Copia il riepilogo da condividere'))));

  return out;
}

function copyText(text, title) {
  const done = () => openDlg('Copiato', [h('p', {}, `${title} copiato negli appunti.`)], [{ label: 'OK', primary: true }]);
  const manual = () => {
    const ta = h('textarea', { rows: 8, style: 'width:100%' });
    ta.value = text;
    openDlg(title, [h('p', { class: 'muted small' }, 'Selezionalo e copialo.'), ta], [{ label: 'Chiudi', primary: true }]);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, manual);
  else manual();
}

function editTopic(tid) {
  const t = topicById(tid);
  const sel = h('select', { id: 'f-src' }, h('option', { value: '' }, '— Fonte da assegnare —'),
    Object.entries(D.sources).map(([id, s]) => h('option', Object.assign({ value: id }, t.p === id ? { selected: true } : {}), s.name)));
  const ref = h('input', { type: 'text', id: 'f-ref', value: t.ref, placeholder: 'es. cap. 24, pp. 410-450' });
  openDlg('Fonte per questo argomento', [
    h('p', { class: 'muted' }, t.t),
    h('div', { class: 'field' }, h('label', { for: 'f-src' }, 'Fonte primaria (una sola)'), sel),
    h('div', { class: 'field' }, h('label', { for: 'f-ref' }, 'Riferimento (capitolo / pagine)'), ref),
  ], [
    { label: 'Annulla' },
    { label: 'Salva', primary: true, onClick: () => {
      S.overrides[tid] = { p: sel.value || null, ref: ref.value.trim() };
      save(); render();
    } },
  ]);
}

function topicUnits(t) {
  const { primary, extra } = unitsOfTopic(t);
  if (!primary.length && !extra.length) return null;
  const nDone = primary.filter(unitDone).length;
  return h('details', { class: 'units' },
    h('summary', {}, primary.length ? `Capitoli della fonte primaria: ${nDone}/${primary.length} completati` : 'Capitoli di integrazione'),
    primary.map(unitRow),
    extra.length ? h('div', { class: 'muted small', style: 'margin-top:6px' }, 'Integrazioni') : null,
    extra.map((u) => h('div', { class: 'checks' }, h('div', { class: 'small muted' }, `${srcName(u.src)}: `), unitRow(u))));
}

function unitRow(u) {
  return h('label', { class: 'unit' },
    h('input', Object.assign({ type: 'checkbox', onchange: (e) => { markUnits([u.id], e.target.checked); } }, unitDone(u) ? { checked: true } : {})),
    h('span', {}, unitLabel(u)));
}

function viewPlan() {
  const out = [h('h1', {}, 'Piano')];
  const all = topics();
  const cur = pctAtLeast3();

  // traguardo EDAIC
  if (S.settings.edaicOn) {
    const d = S.settings.edaicDate;
    const ola = S.settings.olaDate;
    const lines = [];
    if (d) { const n = daysBetween(todayStr(), d); lines.push(n >= 0 ? `Esame il ${itDate(d)}: mancano ${n} giorni.` : `La data dell'esame (${itDate(d)}) è passata: aggiornala.`); }
    else lines.push('Data non impostata. L\'esame si tiene di solito a settembre: verifica data e iscrizione su esaic.org e inseriscila in Opzioni.');
    if (ola) { const n = daysBetween(todayStr(), ola); if (n >= 0) lines.push(`On-Line Assessment il ${itDate(ola)} (tra ${n} giorni): ottimo come verifica intermedia.`); }
    out.push(h('div', { class: 'card' }, h('div', { class: 'kicker' }, 'Traguardo opzionale'), h('h2', {}, 'EDAIC Part I'),
      lines.map((l) => h('p', {}, l)),
      h('p', { class: 'muted small' }, 'Due prove da 60 quesiti; ogni quesito ha 5 affermazioni vero/falso, senza penalità per gli errori. Il Paper A riguarda le scienze di base, il Paper B l\'anestesia clinica e la terapia intensiva. Si può sostenere in qualsiasi fase della formazione e il superamento non scade. Dettagli e quote vanno verificati sul sito ESAIC.')));
  }

  // tappe
  const ms = milestones();
  const mCard = h('div', { class: 'card' }, h('div', { class: 'kicker' }, 'Scadenze'), h('h2', {}, 'Tappe verso la fine della specializzazione'));
  if (!ms) mCard.append(h('p', { class: 'muted' }, 'Imposta la data di fine specializzazione in Opzioni: ti proporrò una tappa ogni tre mesi circa.'), h('a', { href: '#imp' }, 'Vai a Opzioni'));
  else if (ms.over) mCard.append(h('p', {}, 'La data di fine specializzazione è passata: aggiornala in Opzioni.'));
  else {
    mCard.append(h('p', { class: 'muted small' }, `Misura: percentuale di argomenti a livello 3 o 4. Oggi ${ms.cur}%, alla partenza ${ms.base}%. Il livello lo decidi tu (e vale quanto la tua onestà): conviene verificarlo con quiz.`));
    const next = ms.list.find((m) => !m.past);
    ms.list.forEach((m) => mCard.append(h('div', { class: 'ms' },
      h('div', { class: 'row between' }, h('b', {}, `Tappa ${m.k} – ${itDate(m.date, { day: 'numeric', month: 'short', year: 'numeric' })}`),
        m.past ? h('span', { class: m.met ? 'pill ok' : 'pill warn' }, m.met ? 'Raggiunta' : 'In ritardo') : (m === next ? h('span', { class: 'pill' }, 'Prossima') : null)),
      h('div', { class: 'small muted' }, `Obiettivo: ${m.target}% degli argomenti a livello ≥ 3`),
      m === next ? h('div', { class: `bar ${ms.cur >= m.target ? 'ok' : ''}`, style: 'margin-top:6px' }, h('i', { style: `width:${Math.min(100, Math.round(100 * ms.cur / Math.max(1, m.target)))}%` })) : null)));
  }
  out.push(mCard);

  // lacune
  const gaps = all.filter((t) => !t.p);
  if (gaps.length) {
    out.push(h('details', { class: 'area' }, h('summary', {}, h('div', { class: 'area-title' }, h('span', {}, 'Argomenti senza fonte'), h('span', { class: 'pill warn' }, gaps.length)),
      h('span', { class: 'muted small' }, 'Scegli una fonte primaria per ciascuno, anche provvisoria.')),
      gaps.map((t) => h('div', { class: 'topic' }, h('div', { class: 'topic-t' }, t.t), h('div', { class: 'row between' }, h('span', { class: 'src' }, areaOf(t.a).name), h('button', { onclick: () => editTopic(t.id) }, 'Assegna'))))));
  }

  // capitoli per fonte
  const srcs = Object.keys(window.STUDY_UNITS || {});
  if (srcs.length) {
    const card = h('div', { class: 'card' }, h('div', { class: 'kicker' }, 'Avanzamento sulle fonti'), h('h2', {}, 'Capitoli e pagine'));
    srcs.forEach((src) => {
      const ps = pagesSummary(src);
      const pct = ps.total ? Math.round(100 * ps.done / ps.total) : 0;
      card.append(h('div', { class: 'ms' },
        h('div', { class: 'row between' }, h('b', {}, srcName(src)), h('span', { class: 'small muted' }, `${ps.nDone}/${ps.n} capitoli`)),
        h('div', { class: 'bar', style: 'margin:6px 0' }, h('i', { style: `width:${pct}%` })),
        h('div', { class: 'small muted' }, ps.total ? `${ps.done} di ${ps.total} pagine (restano ${ps.total - ps.done})` : '')));
    });
    card.append(h('p', { class: 'muted small' }, 'Le pagine finali dei capitoli del Pinsky sono dedotte dall\'indice (inizio del capitolo successivo) e quindi approssimate. Segna un capitolo come fatto dal suo argomento, oppure importa quelli già studiati in Opzioni.'));
    const loose = ALL_UNITS.filter((u) => !u.tp.length);
    if (loose.length) card.append(h('details', { class: 'units' }, h('summary', {}, `Capitoli non associati a un argomento (${loose.length})`), loose.map(unitRow)));
    out.push(card);
  }

  // aree
  out.push(h('h2', { style: 'margin-top:18px' }, 'Argomenti per area'));
  D.areas.forEach((a) => {
    const ts = all.filter((t) => t.a === a.id);
    const mean = ts.reduce((s, t) => s + level(t.id), 0) / ts.length;
    const det = h('details', { class: 'area' },
      h('summary', {}, h('div', { class: 'area-title' }, h('span', {}, a.name), h('span', { class: 'muted small' }, `${ts.length} arg.`)),
        h('div', { class: 'bar', 'aria-label': 'Padronanza media' }, h('i', { style: `width:${Math.round((mean - 1) / 3 * 100)}%` }))));
    const bulk = h('select', { 'aria-label': 'Livello per tutta l\'area' }, [1, 2, 3, 4].map((l) => h('option', { value: l }, LEVEL_SHORT[l])));
    det.append(h('div', { class: 'topic' }, h('div', { class: 'row' }, h('span', { class: 'small' }, 'Imposta tutta l\'area a:'), bulk,
      h('button', { onclick: () => {
        const l = parseInt(bulk.value, 10);
        openDlg('Conferma', [h('p', {}, `Impostare tutti gli argomenti di "${a.name}" a "${LEVEL_SHORT[l]}"?`)], [
          { label: 'Annulla' },
          { label: 'Applica', primary: true, onClick: () => { ts.forEach((t) => { S.levels[t.id] = l; }); save(); render(); } },
        ]);
      } }, 'Applica'))));
    ts.forEach((t) => det.append(h('div', { class: 'topic' },
      h('div', { class: 'topic-t' }, t.t),
      h('div', { class: 'row between' }, sourceLine(t), h('button', { class: 'ghost', style: 'min-height:36px;padding:4px 10px', onclick: () => editTopic(t.id), 'aria-label': `Modifica fonte: ${t.t}` }, 'Fonte')),
      h('div', { class: 'lv', role: 'group', 'aria-label': `Livello: ${t.t}` },
        [1, 2, 3, 4].map((l) => h('button', { type: 'button', 'data-l': l, 'aria-pressed': level(t.id) === l ? 'true' : 'false',
          onclick: () => { setLevel(t.id, l); render(); } }, LEVEL_SHORT[l]))),
      topicUnits(t))));
    out.push(det);
  });
  out.push(h('p', { class: 'muted small' }, `Livelli: 1 mai studiato · 2 visto una volta, ricordo poco · 3 studiato, da ripassare · 4 solido. Argomenti a livello ≥ 3: ${cur}%.`));
  return out;
}

// ---------- aggiornamenti ----------
const dig = { index: null, file: null, data: null, err: null, tab: 'week', showDismissed: false, loading: false };

async function fetchJSON(path) {
  const r = await fetch(path, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
}
async function loadDigest(file) {
  dig.loading = true; dig.err = null;
  try {
    if (!dig.index) dig.index = await fetchJSON('data/digest/index.json');
    const weeks = dig.index.weeks || [];
    dig.file = file || dig.file || (weeks[0] && weeks[0].file) || null;
    dig.data = dig.file ? await fetchJSON(`data/digest/${dig.file}`) : null;
  } catch (e) {
    dig.err = e.message;
  }
  dig.loading = false;
  if (location.hash === '#agg') render();
}

function artNode(a) {
  const isSaved = !!S.saved[a.pmid];
  const types = (a.pubtypes || []).join(', ');
  return h('article', { class: 'art' },
    h('h3', {}, a.title),
    h('div', { class: 'meta' }, [a.journal, a.date, types].filter(Boolean).join(' · ')),
    a.why ? h('div', {}, h('span', { class: 'pill' }, a.why)) : null,
    a.summary_it ? h('div', { class: 'ai' }, h('b', {}, 'In sintesi (generata automaticamente): '), a.summary_it) : null,
    a.abstract ? h('details', {}, h('summary', {}, 'Abstract originale'), h('div', { class: 'abs' }, a.abstract)) : null,
    h('div', { class: 'acts' },
      h('a', { href: a.url, target: '_blank', rel: 'noopener noreferrer' }, 'Apri su PubMed'),
      h('button', { onclick: () => { if (isSaved) delete S.saved[a.pmid]; else S.saved[a.pmid] = a; save(); render(); } }, isSaved ? 'Rimuovi dai salvati' : 'Salva'),
      dig.tab === 'week' ? h('button', { class: 'ghost', onclick: () => { S.dismissed[a.pmid] = true; save(); render(); } }, 'Scarta') : null));
}

function viewDigest() {
  if (!dig.index && !dig.loading && !dig.err) loadDigest();
  const out = [h('h1', {}, 'Aggiornamenti')];
  out.push(h('div', { class: 'row', style: 'margin-bottom:12px' },
    h('button', { class: dig.tab === 'week' ? 'primary' : '', onclick: () => { dig.tab = 'week'; render(); } }, 'Report settimanale'),
    h('button', { class: dig.tab === 'saved' ? 'primary' : '', onclick: () => { dig.tab = 'saved'; render(); } }, `Salvati (${Object.keys(S.saved).length})`)));

  if (dig.tab === 'saved') {
    const list = Object.values(S.saved);
    out.push(list.length ? h('div', { class: 'card' }, list.map(artNode)) : h('div', { class: 'card' }, h('p', { class: 'muted' }, 'Nessun articolo salvato.')));
    return out;
  }
  if (dig.loading && !dig.data) { out.push(h('div', { class: 'card' }, h('p', {}, 'Caricamento…'))); return out; }
  if (dig.err || !dig.data) {
    out.push(h('div', { class: 'card' }, h('p', {}, 'Nessun report disponibile (o sei offline).'),
      h('p', { class: 'muted small' }, 'Il report viene generato ogni lunedì mattina. Se il sito è appena stato creato, lancia la prima esecuzione manuale dalla scheda Actions del repository.'),
      h('button', { onclick: () => { dig.index = null; dig.err = null; loadDigest(); render(); } }, 'Riprova')));
    return out;
  }
  const d = dig.data;
  const weeks = (dig.index && dig.index.weeks) || [];
  const sel = h('select', { 'aria-label': 'Settimana', onchange: (e) => { loadDigest(e.target.value); render(); } },
    weeks.map((w) => h('option', Object.assign({ value: w.file }, w.file === dig.file ? { selected: true } : {}), `Settimana dal ${itDate(w.week, { day: 'numeric', month: 'long', year: 'numeric' })} (${w.count})`)));
  out.push(h('div', { class: 'card' },
    h('div', { class: 'field' }, sel),
    h('p', { class: 'muted small' }, `Generato il ${itDate(d.generated.slice(0, 10))}. ${d.ai ? 'Selezione e sintesi in italiano prodotte automaticamente da un modello di linguaggio a partire dagli abstract: possono contenere errori, controlla sempre l\'articolo.' : 'Selezione automatica per tipo di studio e rivista, senza sintesi: ordine di rilevanza indicativo.'}`),
    d.note ? h('p', { class: 'muted small' }, d.note) : null));
  const shown = (d.articles || []).filter((a) => dig.showDismissed || !S.dismissed[a.pmid]);
  const hidden = (d.articles || []).length - shown.length;
  const card = h('div', { class: 'card' });
  if (!shown.length) card.append(h('p', { class: 'muted' }, 'Nessun articolo da mostrare per questa settimana.'));
  shown.forEach((a) => card.append(artNode(a)));
  if (hidden > 0 || dig.showDismissed) card.append(h('button', { class: 'ghost', onclick: () => { dig.showDismissed = !dig.showDismissed; render(); } }, dig.showDismissed ? 'Nascondi gli scartati' : `Mostra ${hidden} scartati`));
  out.push(card);
  return out;
}

// ---------- impostazioni ----------
function viewSettings() {
  const st = S.settings;
  const num = (id, label, key, min, max, hint) => h('div', { class: 'field' }, h('label', { for: id }, label),
    h('input', { type: 'number', id, min, max, value: st[key], onchange: (e) => { st[key] = Math.max(min, Math.min(max, parseInt(e.target.value, 10) || min)); save(); } }),
    hint ? h('div', { class: 'muted small' }, hint) : null);
  const date = (id, label, key, hint, onSet) => h('div', { class: 'field' }, h('label', { for: id }, label),
    h('input', { type: 'date', id, value: st[key], onchange: (e) => { st[key] = e.target.value; if (onSet) onSet(); save(); } }),
    hint ? h('div', { class: 'muted small' }, hint) : null);

  const rot = h('div', { class: 'checks' }, D.areas.filter((a) => a.clinical).map((a) => h('label', {},
    h('input', Object.assign({ type: 'checkbox', onchange: (e) => {
      st.rotation = st.rotation.filter((x) => x !== a.id);
      if (e.target.checked) st.rotation.push(a.id);
      save();
    } }, st.rotation.includes(a.id) ? { checked: true } : {})), a.name)));

  const file = h('input', { type: 'file', accept: 'application/json,.json', style: 'display:none', onchange: importFile });
  return [
    h('h1', {}, 'Opzioni'),
    h('div', { class: 'card' }, h('h2', {}, 'Obiettivi'),
      num('s-wt', 'Giorni di studio a settimana', 'weeklyTarget', 1, 7, 'Pochi e costanti battono tanti e saltuari. Parti da 3 o 4.'),
      num('s-tm', 'Durata tipica di un compito (minuti)', 'taskMin', 10, 120),
      date('s-end', 'Fine della specializzazione', 'endDate', 'Serve per calcolare le tappe trimestrali.', () => { if (S.baselinePct == null) S.baselinePct = pctAtLeast3(); })),
    h('div', { class: 'card' }, h('h2', {}, 'Traguardo EDAIC Part I'),
      h('div', { class: 'checks' }, h('label', {}, h('input', Object.assign({ type: 'checkbox', onchange: (e) => { st.edaicOn = e.target.checked; save(); } }, st.edaicOn ? { checked: true } : {})), 'Mostra il traguardo opzionale')),
      date('s-ed', 'Data dell\'esame', 'edaicDate', 'Verifica la data e le scadenze di iscrizione su esaic.org: non le ho inserite io.'),
      date('s-ola', 'Data dell\'On-Line Assessment', 'olaDate', 'Di solito in aprile; verifica sul sito ESAIC.')),
    h('div', { class: 'card' }, h('h2', {}, 'Rotazione corrente'),
      h('p', { class: 'muted small' }, 'Gli argomenti di queste aree passano avanti. Aggiornala quando cambi reparto.'), rot),
    importCard(),
    h('div', { class: 'card' }, h('h2', {}, 'Dati e backup'),
      h('p', { class: 'muted small' }, 'I dati sono salvati solo su questo dispositivo. Se cambi telefono o cancelli i dati del browser li perdi: esporta un backup ogni tanto.'),
      h('div', { class: 'row' },
        h('button', { class: 'primary', onclick: exportData }, 'Esporta backup'),
        h('button', { onclick: () => file.click() }, 'Importa backup'), file,
        h('button', { class: 'danger', onclick: () => openDlg('Cancellare tutto?', [h('p', {}, 'Livelli, sessioni e impostazioni verranno eliminati da questo dispositivo.')], [
          { label: 'Annulla' }, { label: 'Cancella', danger: true, onClick: () => { stopRun(); S = defaults(); save(); render(); } }]) }, 'Cancella tutto')),
      S.lastExport ? h('p', { class: 'muted small', style: 'margin-top:8px' }, `Ultimo backup: ${itDate(S.lastExport)}`) : null),
  ];
}
function importCard() {
  const srcs = Object.keys(window.STUDY_UNITS || {});
  if (!srcs.length) return null;
  const sel = h('select', { id: 'imp-src' }, srcs.map((s) => h('option', { value: s }, srcName(s))));
  const txt = h('input', { type: 'text', id: 'imp-nums', placeholder: 'es. 16, 25, 26, 27, 28' });
  return h('div', { class: 'card' }, h('h2', {}, 'Capitoli già studiati'),
    h('p', { class: 'muted small' }, 'Scrivi i numeri dei capitoli che hai già completato (separati da virgole) e li segno come fatti. Gli argomenti coperti da tutti i loro capitoli passano almeno a "Da ripassare".'),
    h('div', { class: 'field' }, h('label', { for: 'imp-src' }, 'Fonte'), sel),
    h('div', { class: 'field' }, h('label', { for: 'imp-nums' }, 'Numeri dei capitoli'), txt),
    h('button', { onclick: () => {
      const nums = txt.value.split(/[^0-9]+/).filter(Boolean).map(Number);
      const found = ALL_UNITS.filter((u) => u.src === sel.value && nums.includes(u.n));
      const missing = nums.filter((n) => !found.some((u) => u.n === n));
      markUnits(found.map((u) => u.id), true);
      let raised = 0;
      topics().forEach((t) => {
        const pr = unitsOfTopic(t).primary;
        if (pr.length && pr.every(unitDone) && level(t.id) < 3) { S.levels[t.id] = 3; raised++; }
      });
      save();
      openDlg('Fatto', [h('p', {}, `${found.length} capitoli segnati come completati.${raised ? ` ${raised} argomenti portati a "Da ripassare".` : ''}`),
        missing.length ? h('p', { class: 'muted' }, `Non presenti nell'elenco: ${missing.join(', ')}.`) : null], [{ label: 'OK', primary: true, onClick: () => { render(); } }]);
    } }, 'Segna come fatti'));
}

function exportData() {
  S.lastExport = todayStr(); save();
  const blob = new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: `studio-backup-${todayStr()}.json` });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  render();
}
function importFile(e) {
  const f = e.target.files[0];
  if (!f) return;
  f.text().then((txt) => {
    let o;
    try { o = JSON.parse(txt); } catch (err) { o = null; }
    if (!o || o.v !== 1 || typeof o.levels !== 'object' || !Array.isArray(o.sessions)) {
      openDlg('File non valido', [h('p', {}, 'Il file non sembra un backup di questa app.')], [{ label: 'OK', primary: true }]);
      return;
    }
    openDlg('Importare il backup?', [h('p', {}, `Sostituirà i dati attuali con quelli del file (${o.sessions.length} sessioni registrate).`)], [
      { label: 'Annulla' },
      { label: 'Importa', primary: true, onClick: () => { stopRun(); S = migrate(o); save(); render(); } },
    ]);
  });
  e.target.value = '';
}

// ---------- router ----------
const VIEWS = { oggi: viewToday, piano: viewPlan, agg: viewDigest, imp: viewSettings };
function render() {
  const tab = (location.hash || '#oggi').slice(1);
  const name = VIEWS[tab] ? tab : 'oggi';
  document.querySelectorAll('#tabs a').forEach((a) => {
    a.classList.toggle('on', a.dataset.tab === name);
    if (a.dataset.tab === name) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  const open = [...document.querySelectorAll('details.area[open] .area-title span:first-child')].map((n) => n.textContent);
  const y = window.scrollY;
  $app.replaceChildren(...VIEWS[name]());
  if (name === 'piano') document.querySelectorAll('details.area').forEach((d) => {
    const n = d.querySelector('.area-title span:first-child');
    if (n && open.includes(n.textContent)) d.open = true;
  });
  window.scrollTo(0, y);
  if (run) updateTimer();
}
window.addEventListener('hashchange', () => { window.scrollTo(0, 0); render(); });
render();

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* funziona anche senza */ });
}
})();
