import { useEffect, useId, useRef, type ReactNode } from 'react';

export function PageHead({ eyebrow, title, children }: { eyebrow?: string; title: string; children?: ReactNode }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => { ref.current?.focus({ preventScroll: true }); document.title = `${title} · Anesthesia & Critical Care Digest`; }, [title]);
  return (
    <header className="page-head">
      {eyebrow && <p className="eyebrow">{eyebrow}</p>}
      <h1 ref={ref} tabIndex={-1}>{title}</h1>
      {children && <p>{children}</p>}
    </header>
  );
}

export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string | null; children: (p: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }) => ReactNode }) {
  const id = useId();
  const describedBy = [hint ? `${id}-h` : '', error ? `${id}-e` : ''].filter(Boolean).join(' ') || undefined;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {hint && <p className="hint" id={`${id}-h`}>{hint}</p>}
      {children({ id, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined })}
      {error && <p className="error-text" id={`${id}-e`} role="alert">{error}</p>}
    </div>
  );
}

export function Note({ children, kind }: { children: ReactNode; kind?: 'error' }) {
  return <div className={`note${kind === 'error' ? ' error' : ''}`} role={kind === 'error' ? 'alert' : 'note'}>{children}</div>;
}

export function Chip({ pressed, onClick, children }: { pressed: boolean; onClick: () => void; children: ReactNode }) {
  return <button type="button" className="chip" aria-pressed={pressed} onClick={onClick}>{children}</button>;
}

export function Priority({ name, value, onChange, label }: { name: string; value: number; onChange: (v: number) => void; label: string }) {
  return (
    <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
      <legend className="visually-hidden">{label}</legend>
      <div className="seg">
        {[1, 2, 3, 4, 5].map((n) => (
          <label key={n}>
            <input type="radio" name={name} value={n} checked={value === n} onChange={() => onChange(n)} />
            <span aria-label={`Priorità ${n} su 5`}>{n}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function Progress({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = max ? Math.round((value / max) * 100) : 0;
  return (
    <div className="progress" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value}>
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}

export const fmtDate = (iso: string, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long', year: 'numeric' }) =>
  new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', ...opts }).format(new Date(iso));

/** Mostra HTML generato (newsletter) in un iframe isolato: niente script, i link si aprono in una nuova scheda. */
export function MailFrame({ html, title }: { html: string; title: string }) {
  const doc = html.replace('<head>', '<head><base target="_blank">');
  return <iframe className="frame" title={title} srcDoc={doc} sandbox="allow-popups allow-popups-to-escape-sandbox" referrerPolicy="no-referrer" />;
}

export function download(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** CAPTCHA Cloudflare Turnstile (gratuito), attivo solo se è configurata VITE_TURNSTILE_SITE_KEY. */
export function Turnstile({ onToken }: { onToken: (t: string | null) => void }) {
  const key = import.meta.env.VITE_TURNSTILE_SITE_KEY;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!key || !ref.current) return;
    const w = window as unknown as { turnstile?: { render: (el: HTMLElement, o: Record<string, unknown>) => string; remove: (id: string) => void } };
    let widget: string | undefined;
    const mount = () => { if (w.turnstile && ref.current) widget = w.turnstile.render(ref.current, { sitekey: key, callback: (t: string) => onToken(t), 'expired-callback': () => onToken(null) }); };
    if (w.turnstile) mount();
    else {
      const s = document.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      s.async = true; s.onload = mount; document.head.append(s);
    }
    return () => { if (widget && w.turnstile) w.turnstile.remove(widget); };
  }, [key, onToken]);
  return key ? <div ref={ref} aria-label="Verifica anti-abuso" /> : null;
}
export const turnstileEnabled = () => !!import.meta.env.VITE_TURNSTILE_SITE_KEY;
