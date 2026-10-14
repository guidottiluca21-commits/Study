import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { createServer, type Server } from 'node:http';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import { createRequire } from 'node:module';

const ROOT = join(import.meta.dirname, '..', '..');
const DIST = join(ROOT, 'dist-demo');
const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' };
export const SHOTS = process.env.SHOTS_DIR ?? '';

export interface Env { server: Server; url: string; browser: Browser }

export async function start(): Promise<Env> {
  if (!existsSync(join(DIST, 'index.html'))) throw new Error('Esegui prima `npm run build:demo`');
  const server = createServer((req, res) => {
    let p = decodeURIComponent((req.url ?? '/').split('?')[0]!);
    if (p.endsWith('/')) p += 'index.html';
    const f = join(DIST, p);
    if (!f.startsWith(DIST) || !existsSync(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': TYPES[extname(f)] ?? 'application/octet-stream' });
    res.end(readFileSync(f));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  return { server, url: `http://127.0.0.1:${port}/index.html`, browser };
}
export async function stop(e: Env) { await e.browser.close(); await new Promise((r) => e.server.close(r)); }

export async function newPage(e: Env, opts: { mobile?: boolean; acceptDownloads?: boolean } = {}): Promise<{ ctx: BrowserContext; page: Page; errors: string[] }> {
  const ctx = await e.browser.newContext({ viewport: opts.mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 }, acceptDownloads: true, locale: 'it-IT', timezoneId: 'Europe/Rome' });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (er) => errors.push('pageerror: ' + er.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  return { ctx, page, errors };
}

const require = createRequire(import.meta.url);
const axeSource = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

export async function axe(page: Page, label: string): Promise<string[]> {
  await page.addScriptTag({ content: axeSource });
  const res = await page.evaluate(async () => {
    // @ts-expect-error axe è iniettato
    const r = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] } });
    return r.violations.map((v: any) => `${v.id} (${v.impact}): ${v.help} — ${v.nodes.slice(0, 3).map((n: any) => n.target.join(' ')).join(' | ')}`);
  });
  return res.map((v: string) => `[${label}] ${v}`);
}

export async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true });
}

export async function overflowX(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
}

export async function signUp(page: Page, url: string, email: string, pw = 'una-password-lunga-1') {
  await page.goto(url + '#/signup');
  await page.getByLabel('Indirizzo e-mail').fill(email);
  await page.getByLabel('Password').fill(pw);
  await page.getByRole('button', { name: 'Registrati' }).click();
  await page.getByRole('heading', { name: 'Cosa ti interessa?' }).waitFor();
}

/** Percorre la procedura guidata scegliendo "Sepsi" e dando il consenso. */
export async function completeOnboarding(page: Page) {
  await page.getByRole('button', { name: 'Sepsi e shock settico' }).click();
  await page.getByRole('button', { name: 'Vie aeree' }).click();
  await page.getByRole('button', { name: 'Avanti' }).click();
  await page.getByRole('heading', { name: 'Quanto è importante ciascun argomento?' }).waitFor();
  await page.getByLabel('Priorità 5 su 5').first().check({ force: true });
  await page.getByRole('button', { name: 'Avanti' }).click();
  await page.getByRole('heading', { name: 'Quante novità vuoi ricevere?' }).waitFor();
  // il campo deve accettare qualsiasi numero scritto a mano (bug segnalato: solo 6 o 21)
  const count = page.getByLabel('Quante novità vuoi ricevere ogni lunedì?');
  await count.fill('');
  await count.pressSequentially('3');
  await count.blur();
  if ((await count.inputValue()) !== '3') throw new Error('il campo numerico non accetta 3');
  await page.getByRole('button', { name: 'Avanti' }).click();
  await page.getByRole('heading', { name: 'Percorso Core Knowledge' }).waitFor();
  await page.getByRole('button', { name: 'Avanti' }).click();
  await page.getByRole('heading', { name: 'Conferma e consenso' }).waitFor();
  await page.getByRole('checkbox', { name: /Acconsento a ricevere/ }).check();
  await page.getByRole('button', { name: 'Avanti' }).click();
  await page.getByRole('heading', { name: 'Anteprima della tua newsletter' }).waitFor();
}

export async function overflowers(page: Page): Promise<string[]> {
  return page.evaluate(() => { const W = document.documentElement.clientWidth; return [...document.querySelectorAll('*')].filter((e) => e.getBoundingClientRect().right > W + 1).slice(0, 6).map((e) => `${e.tagName}.${e.className} ${Math.round(e.getBoundingClientRect().right)}/${W}`); });
}
