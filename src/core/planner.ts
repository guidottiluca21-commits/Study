/** Piano di lettura settimanale: distribuisce le letture da lunedì a domenica rispettando i giorni liberi. */

export const DAY_NAMES_IT = ['Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato', 'Domenica'];

export interface PlanInput { key: string; minutes: number }
export interface PlanDay { day: number; name: string; rest: boolean; items: PlanInput[]; minutes: number }

/**
 * Obiettivo abituale: una lettura al giorno, al massimo due. I giorni liberi non ricevono letture.
 * Le letture in eccesso rispetto a 2/giorno non vengono pianificate (restano `unplanned`).
 */
export function planWeek(items: PlanInput[], restDays: number[]): { days: PlanDay[]; unplanned: PlanInput[] } {
  const rest = new Set(restDays);
  const days: PlanDay[] = DAY_NAMES_IT.map((name, day) => ({ day, name, rest: rest.has(day), items: [], minutes: 0 }));
  const avail = days.filter((d) => !d.rest);
  const unplanned: PlanInput[] = [];
  if (!avail.length) return { days, unplanned: [...items] };
  const MAX_PER_DAY = 2;
  items.forEach((it, k) => {
    // prima passata: una lettura per giorno disponibile; seconda: fino a due
    const pass = Math.floor(k / avail.length);
    if (pass >= MAX_PER_DAY) { unplanned.push(it); return; }
    const d = avail[k % avail.length]!;
    d.items.push(it);
    d.minutes += it.minutes;
  });
  return { days, unplanned };
}
