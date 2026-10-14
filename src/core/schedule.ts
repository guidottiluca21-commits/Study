/**
 * Pianificazione nel fuso Europe/Rome. GitHub Actions usa cron in UTC (e può ritardare):
 * per questo il lunedì si avvia più presto e si ATTENDE fino alle 06:00 locali, e la
 * decisione "eseguire o no" dipende dall'ora locale reale, non dall'ora UTC del cron.
 */
export const TZ = 'Europe/Rome';

interface Parts { y: number; m: number; d: number; hh: number; mm: number; weekday: number } // weekday: 0 = lunedì

const fmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short',
});

export function romeParts(date: Date): Parts {
  const p = Object.fromEntries(fmt.formatToParts(date).map((x) => [x.type, x.value]));
  const wd = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(p.weekday!);
  return { y: +p.year!, m: +p.month!, d: +p.day!, hh: +p.hour!, mm: +p.minute!, weekday: wd };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Lunedì (YYYY-MM-DD) della settimana che contiene `date`, in ora di Roma. */
export function weekStartRome(date: Date): string {
  const p = romeParts(date);
  const d = new Date(Date.UTC(p.y, p.m - 1, p.d - p.weekday));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Istante UTC corrispondente a un'ora locale di Roma (gestisce ora legale e passaggi). */
export function romeLocalToUtc(ymd: string, hh: number, mm = 0): Date {
  const [y, m, d] = ymd.split('-').map(Number) as [number, number, number];
  let guess = Date.UTC(y, m - 1, d, hh, mm);
  for (let i = 0; i < 3; i++) {
    const p = romeParts(new Date(guess));
    const got = Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm);
    const want = Date.UTC(y, m - 1, d, hh, mm);
    if (got === want) break;
    guess += want - got;
  }
  return new Date(guess);
}

export const SEND_HOUR = 6; // le 06:00 di lunedì, ora di Roma
export const EARLIEST_START_HOUR = 5; // non si avvia prima delle 05:00 locali
export const LATEST_START_HOUR = 12; // oltre le 12:00 locali si salta (salvo force)

export interface RunDecision {
  run: boolean;
  reason: string;
  weekStart: string;
  sendAt: Date;
  waitMs: number; // attesa prima dell'invio (0 se già oltre le 06:00)
  late: boolean; // avviata dopo le 06:30
}

export function decideRun(now: Date, opts: { force?: boolean } = {}): RunDecision {
  const p = romeParts(now);
  const weekStart = weekStartRome(now);
  const sendAt = romeLocalToUtc(weekStart, SEND_HOUR);
  const minutes = p.hh * 60 + p.mm;
  const base = { weekStart, sendAt };
  if (opts.force) return { ...base, run: true, reason: 'esecuzione forzata', waitMs: Math.max(0, sendAt.getTime() - now.getTime()), late: false };
  if (p.weekday !== 0) return { ...base, run: false, reason: `oggi non è lunedì in ora di Roma (giorno ${p.weekday + 1})`, waitMs: 0, late: false };
  if (minutes < EARLIEST_START_HOUR * 60) return { ...base, run: false, reason: `troppo presto (${pad(p.hh)}:${pad(p.mm)} a Roma): parte l'altra pianificazione`, waitMs: 0, late: false };
  if (minutes >= LATEST_START_HOUR * 60) return { ...base, run: false, reason: `oltre le ${LATEST_START_HOUR}:00 a Roma: salto (usa force per inviare comunque)`, waitMs: 0, late: false };
  const waitMs = Math.max(0, sendAt.getTime() - now.getTime());
  return { ...base, run: true, reason: waitMs ? `attesa fino alle ${SEND_HOUR}:00 a Roma` : 'ora di invio già raggiunta', waitMs, late: minutes >= SEND_HOUR * 60 + 30 };
}
