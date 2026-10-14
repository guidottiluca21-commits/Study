/** Messaggi comprensibili per gli errori più comuni (Supabase/Postgres/rete). */
export function friendlyError(e: unknown): string {
  const msg = String((e as { message?: string } | null)?.message ?? e ?? '');
  const code = (e as { code?: string } | null)?.code ?? '';
  if (/rate_limited/.test(msg) || /rate limit|too many/i.test(msg) || code === '429') return 'Troppe richieste in poco tempo. Riprova tra qualche minuto.';
  if (/invalid login credentials/i.test(msg)) return 'Indirizzo e-mail o password non corretti.';
  if (/email not confirmed/i.test(msg)) return 'L\'indirizzo e-mail non è ancora stato verificato. Controlla la posta e usa il link di conferma.';
  if (/forbidden|permission denied|row-level security/i.test(msg)) return 'Operazione non consentita per il tuo account.';
  if (/not_subscribed/.test(msg)) return 'Non risulti iscritto alla newsletter.';
  if (/failed to fetch|networkerror|network request failed|load failed/i.test(msg)) return 'Connessione non riuscita. Verifica la rete e riprova.';
  if (/password/i.test(msg) && /(weak|short|least|characters)/i.test(msg)) return 'La password è troppo debole: usa almeno 10 caratteri.';
  if (/already registered|already been registered/i.test(msg)) return 'Se l\'indirizzo è valido riceverai un\'e-mail con le istruzioni.';
  if (/captcha/i.test(msg)) return 'Verifica anti-abuso non superata. Riprova.';
  return 'Si è verificato un errore. Riprova; se persiste, contatta l\'amministratore.';
}

export function validatePassword(pw: string, email: string): string | null {
  if (pw.length < 10) return 'Usa almeno 10 caratteri.';
  if (pw.toLowerCase() === email.toLowerCase()) return 'La password non può coincidere con l\'indirizzo e-mail.';
  if (/^(.)\1+$/.test(pw)) return 'La password è troppo semplice.';
  if (['password123', '1234567890', 'qwertyuiop', 'passwordpassword'].includes(pw.toLowerCase())) return 'Scegli una password meno comune.';
  return null;
}

export const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s.trim());
