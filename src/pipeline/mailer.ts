/**
 * Invio e-mail via SMTP (nodemailer): provider-agnostico. Qualunque servizio con SMTP e piano
 * gratuito (vedi docs/LIMITI-E-COSTI.md) funziona senza modifiche al codice.
 * La modalità simulazione non apre mai connessioni di rete.
 */
import nodemailer from 'nodemailer';
import { HttpError, isTransient, withRetry, type RetryOptions } from '../core/retry.ts';

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  messageId: string; // deterministico: stessa newsletter => stesso Message-ID
  headers?: Record<string, string>;
}

export interface Mailer {
  readonly name: string;
  send(msg: MailMessage): Promise<{ providerMessageId?: string }>;
}

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  pass?: string;
  from: string; // es. "Anesthesia & Critical Care Digest <digest@example.org>"
  replyTo?: string;
}

/** Errore SMTP del provider: classificato come temporaneo, definitivo o di quota. */
export class MailError extends Error {
  constructor(message: string, public kind: 'transient' | 'permanent' | 'quota') {
    super(message);
    this.name = 'MailError';
  }
}

function classify(e: any): MailError {
  const code: number | undefined = e?.responseCode;
  const text = String(e?.response ?? e?.message ?? e);
  if (/quota|limit exceeded|too many|rate limit|daily/i.test(text) && (code === undefined || code >= 400)) return new MailError(text, 'quota');
  if (code && code >= 500) return new MailError(text, 'permanent');
  if ((code && code >= 400) || isTransient(e)) return new MailError(text, 'transient');
  return new MailError(text, 'permanent');
}

export function smtpMailer(cfg: SmtpConfig, retry: RetryOptions = {}): Mailer {
  const transport = nodemailer.createTransport({
    host: cfg.host, port: cfg.port, secure: cfg.secure,
    auth: cfg.user ? { user: cfg.user, pass: cfg.pass } : undefined,
    connectionTimeout: 20_000, greetingTimeout: 20_000, socketTimeout: 30_000,
  });
  return {
    name: `smtp:${cfg.host}`,
    async send(msg) {
      return withRetry(
        async () => {
          try {
            const info = await transport.sendMail({
              from: cfg.from, replyTo: cfg.replyTo, to: msg.to, subject: msg.subject, html: msg.html, text: msg.text,
              messageId: msg.messageId, headers: msg.headers,
            });
            return { providerMessageId: info.messageId };
          } catch (e) {
            throw classify(e);
          }
        },
        { attempts: 3, baseMs: 2000, ...retry, isRetryable: (e) => e instanceof MailError && e.kind === 'transient' },
      );
    },
  };
}

/** Mailer di simulazione: registra i messaggi in memoria, nessuna rete. */
export function simulateMailer(): Mailer & { sent: MailMessage[] } {
  const sent: MailMessage[] = [];
  return { name: 'simulate', sent, async send(msg) { sent.push(msg); return { providerMessageId: `simulated:${msg.messageId}` }; } };
}

export { HttpError };
