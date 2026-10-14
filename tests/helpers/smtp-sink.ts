import { SMTPServer } from 'smtp-server';
import { simpleParser, type ParsedMail } from 'mailparser';
import type { AddressInfo } from 'node:net';

export interface Received { to: string; mail: ParsedMail }

/** Server SMTP locale: riceve davvero i messaggi inviati da nodemailer; può simulare errori per destinatario. */
export async function startSink() {
  const received: Received[] = [];
  const attempts = new Map<string, number>();
  // restituisce un errore SMTP da simulare per (destinatario, tentativo n.)
  let behavior: (rcpt: string, attempt: number) => { code: number; message: string } | null = () => null;
  const server = new SMTPServer({
    authOptional: true, disabledCommands: ['STARTTLS', 'AUTH'], logger: false,
    onRcptTo(addr, _s, cb) {
      const n = (attempts.get(addr.address) ?? 0) + 1;
      attempts.set(addr.address, n);
      const b = behavior(addr.address, n);
      if (b) { const e: Error & { responseCode?: number } = new Error(b.message); e.responseCode = b.code; return cb(e); }
      cb();
    },
    onData(stream, session, cb) {
      const chunks: Buffer[] = [];
      stream.on('data', (c) => chunks.push(c));
      stream.on('end', async () => {
        const mail = await simpleParser(Buffer.concat(chunks));
        received.push({ to: session.envelope.rcptTo.map((r) => r.address).join(','), mail });
        cb();
      });
    },
  });
  await new Promise<void>((res) => server.listen(0, '127.0.0.1', res));
  const port = (server.server.address() as AddressInfo).port;
  return {
    port, received, attempts,
    setBehavior(fn: typeof behavior) { behavior = fn; },
    reset() { received.length = 0; attempts.clear(); behavior = () => null; },
    close: () => new Promise<void>((res) => server.close(() => res())),
    cfg: { host: '127.0.0.1', port, secure: false, from: 'Digest <digest@example.org>' },
  };
}
