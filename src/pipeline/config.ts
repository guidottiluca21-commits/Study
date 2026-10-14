import { z } from 'zod';
import type { SmtpConfig } from './mailer.ts';

const bool = (v: string | undefined) => (v ?? '').toLowerCase() === 'true' || v === '1';

export interface Config {
  databaseUrl: string;
  databaseCa?: string;
  siteUrl: string;
  emailDailyLimit: number;
  ncbiEmail?: string;
  ncbiApiKey?: string;
  allowlist: string[]; // se non vuota, si inviano e-mail SOLO a questi indirizzi (fase di test)
  smtp?: SmtpConfig;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, opts: { needSmtp?: boolean; needDb?: boolean } = {}): Config {
  const schema = z.object({
    DATABASE_URL: opts.needDb === false ? z.string().optional() : z.string().min(10, 'DATABASE_URL mancante'),
    SITE_URL: z.string().url('SITE_URL deve essere un URL valido (es. https://utente.github.io/study/)'),
    EMAIL_DAILY_LIMIT: z.coerce.number().int().min(1).max(100000).default(100),
  });
  const parsed = schema.safeParse({ DATABASE_URL: env.DATABASE_URL, SITE_URL: env.SITE_URL ?? 'https://example.invalid/', EMAIL_DAILY_LIMIT: env.EMAIL_DAILY_LIMIT || undefined });
  if (!parsed.success) throw new Error('Configurazione non valida: ' + parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));

  let smtp: SmtpConfig | undefined;
  if (env.SMTP_HOST) {
    const port = Number(env.SMTP_PORT ?? 587);
    smtp = {
      host: env.SMTP_HOST, port, secure: env.SMTP_SECURE ? bool(env.SMTP_SECURE) : port === 465,
      user: env.SMTP_USER || undefined, pass: env.SMTP_PASS || undefined,
      from: env.SMTP_FROM ?? '', replyTo: env.SMTP_REPLY_TO || undefined,
    };
    if (!smtp.from) throw new Error('SMTP_FROM mancante');
  } else if (opts.needSmtp) {
    throw new Error('SMTP_HOST non configurato: usa --simulate oppure configura le variabili SMTP_* (vedi docs/DEPLOY.md)');
  }
  return {
    databaseUrl: parsed.data.DATABASE_URL ?? '',
    databaseCa: env.DATABASE_CA || undefined,
    siteUrl: parsed.data.SITE_URL.endsWith('/') ? parsed.data.SITE_URL : parsed.data.SITE_URL + '/',
    emailDailyLimit: parsed.data.EMAIL_DAILY_LIMIT,
    ncbiEmail: env.NCBI_EMAIL || undefined,
    ncbiApiKey: env.NCBI_API_KEY || undefined,
    allowlist: (env.SEND_ALLOWLIST ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
    smtp,
  };
}
