/** Utilità testuali pure (estrazione da abstract, escape, data). */

export const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Divide l'abstract nelle sezioni etichettate ("RESULTS: ..."). Senza etichette: sezione unica. */
export function abstractSections(abstract: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!abstract) return out;
  let any = false;
  for (const line of abstract.split('\n')) {
    const m = /^([A-Z][A-Z /&-]{2,40}):\s*(.*)$/.exec(line);
    if (m) {
      out[m[1]!] = ((out[m[1]!] ?? '') + ' ' + m[2]).trim();
      any = true;
    } else {
      out['TEXT'] = ((out['TEXT'] ?? '') + ' ' + line).trim();
    }
  }
  if (!any) return { TEXT: abstract.replace(/\n/g, ' ').trim() };
  return out;
}

export function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+(?=[A-Z(\[])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function truncateAtSentence(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastStop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('; '));
  return (lastStop > max * 0.5 ? cut.slice(0, lastStop + 1) : cut.replace(/\s+\S*$/, '') + '…').trim();
}

/** Prima corrispondenza con la frase intera che la contiene (per mostrare l'evidenza). */
export function evidenceSentence(text: string, re: RegExp): string | null {
  for (const s of splitSentences(text)) if (re.test(s)) return truncateAtSentence(s, 300);
  return null;
}

export const pad2 = (n: number) => String(n).padStart(2, '0');
