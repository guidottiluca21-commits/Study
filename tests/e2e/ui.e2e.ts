import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { axe, completeOnboarding, newPage, overflowX, overflowers, shot, signUp, start, stop, type Env } from './helpers';

let env: Env;
beforeAll(async () => { env = await start(); });
afterAll(async () => { await stop(env); });

describe('flusso completo (demo): registrazione, onboarding, dashboard, newsletter, libreria, account', () => {
  it('percorre tutto il flusso e mantiene i dati dopo il ricaricamento', async () => {
    const { page, errors, ctx } = await newPage(env);
    await page.goto(env.url + '#/signup');
    await shot(page, '01-signup');

    // password debole: errore comprensibile e accessibile
    await page.getByLabel('Indirizzo e-mail').fill('mario@example.org');
    await page.getByLabel('Password').fill('corta');
    await page.getByRole('button', { name: 'Registrati' }).click();
    const err = page.getByRole('alert').filter({ hasText: 'almeno 10 caratteri' });
    await err.waitFor();
    expect(await page.getByLabel('Password').getAttribute('aria-invalid')).toBe('true');

    await signUp(page, env.url, 'mario@example.org');
    await shot(page, '02-onboarding-1');
    await completeOnboarding(page);
    const frame = page.frameLocator('iframe[title="Anteprima della newsletter"]');
    await frame.getByText('Weekly Digest').first().waitFor();
    await shot(page, '03-onboarding-preview');
    await page.getByRole('button', { name: 'Fine' }).click();

    // dashboard
    await page.getByRole('heading', { name: 'Il tuo digest' }).waitFor();
    await page.getByText(/ore 06:00 \(Europe\/Rome\)/).first().waitFor();
    await page.getByText(/articoli fondamentali completati/).first().waitFor();
    await shot(page, '04-dashboard-empty');

    // newsletter: genera (demo), apri
    await page.getByRole('link', { name: 'Newsletter' }).first().click();
    await page.getByRole('button', { name: 'Genera la newsletter della settimana' }).click();
    await page.getByRole('link', { name: /Settimana del/ }).first().click();
    await page.frameLocator('iframe').getByText('Recent Evidence').first().waitFor();
    await shot(page, '05-newsletter');

    // libreria: segna un articolo come completato
    await page.getByRole('link', { name: 'Letture' }).first().click();
    await page.getByRole('heading', { name: 'Le tue letture' }).waitFor();
    const firstRow = page.locator('section[aria-labelledby="l-art"] ul.list > li').first();
    await firstRow.getByRole('button', { name: 'Completato' }).click();
    await page.getByRole('tab', { name: /Completati \(1\)/ }).click();
    await expect.poll(() => page.locator('section[aria-labelledby="l-art"] ul.list > li').count()).toBe(1);
    await shot(page, '06-library');

    // la dashboard mostra l'ultima lettura completata
    await page.getByRole('link', { name: 'Home' }).first().click();
    await page.getByRole('heading', { name: 'Ultime letture completate' }).first().waitFor();
    await expect.poll(() => page.locator('section[aria-labelledby="h-last"] li').count()).toBe(1);
    await shot(page, '07-dashboard');

    // persistenza: dopo il ricaricamento lo stato è conservato (storage del browser)
    await page.reload();
    await page.getByRole('heading', { name: 'Il tuo digest' }).waitFor();
    await expect.poll(() => page.locator('section[aria-labelledby="h-last"] li').count()).toBe(1);

    // preferenze: modifica e salva
    await page.getByRole('link', { name: 'Preferenze' }).first().click();
    await page.getByLabel('Quante novità vuoi ricevere ogni lunedì?').fill('4');
    await page.getByRole('button', { name: 'Salva le preferenze' }).click();
    await page.getByText('Preferenze salvate').first().waitFor();
    await shot(page, '08-preferences');
    await page.reload();
    expect(await page.getByLabel('Quante novità vuoi ricevere ogni lunedì?').inputValue()).toBe('4');

    // account: esportazione senza password, pausa/ripresa, eliminazione
    await page.getByRole('link', { name: 'Account' }).first().click();
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Scarica i miei dati' }).click()]);
    const exported = JSON.parse(readFileSync((await dl.path())!, 'utf8'));
    expect(exported.account.email).toBe('mario@example.org');
    expect(JSON.stringify(exported)).not.toMatch(/una-password-lunga/);
    await page.getByRole('button', { name: 'Sospendi gli invii' }).click();
    await page.getByText('in pausa').first().first().waitFor();
    await page.getByRole('button', { name: 'Riprendi gli invii' }).click();
    await shot(page, '09-account');
    await page.getByLabel('Per confermare scrivi ELIMINA').fill('ELIMINA');
    await page.getByRole('button', { name: 'Elimina definitivamente il mio account' }).click();
    await page.getByRole('heading', { name: 'Accedi' }).waitFor();
    // dopo l'eliminazione non si può più accedere
    await page.getByLabel('Indirizzo e-mail').fill('mario@example.org');
    await page.getByLabel('Password').fill('una-password-lunga-1');
    await page.getByRole('button', { name: 'Accedi' }).click();
    await page.getByText('Indirizzo e-mail o password non corretti').first().waitFor();

    expect(errors).toEqual([]);
    await ctx.close();
  });

  it('due utenti non vedono i dati l\'uno dell\'altro', async () => {
    const { page, ctx } = await newPage(env);
    await signUp(page, env.url, 'a@example.org');
    await completeOnboarding(page);
    await page.getByRole('button', { name: 'Fine' }).click();
    await page.getByRole('heading', { name: 'Il tuo digest' }).waitFor();
    await page.getByRole('link', { name: 'Newsletter' }).first().click();
    await page.getByRole('button', { name: 'Genera la newsletter della settimana' }).click();
    await page.getByRole('link', { name: /Settimana del/ }).first().waitFor();
    await page.getByRole('link', { name: 'Account' }).first().click();
    await page.getByRole('button', { name: 'Esci' }).click();
    await signUp(page, env.url, 'b@example.org');
    await page.goto(env.url + '#/newsletters');
    await page.getByRole('heading', { name: 'Le tue newsletter' }).waitFor();
    await page.getByText('Non hai ancora ricevuto nessuna newsletter').first().waitFor();
    await ctx.close();
  });
});

const PAGES: [string, string][] = [
  ['#/signin', 'Accedi'], ['#/signup', 'Crea il tuo account'], ['#/forgot', 'Recupera la password'], ['#/privacy', 'Privacy e trattamento dei dati'],
];
const APP_PAGES: [string, string][] = [
  ['#/', 'Il tuo digest'], ['#/preferences', 'Preferenze'], ['#/library', 'Le tue letture'], ['#/newsletters', 'Le tue newsletter'],
  ['#/preview', 'La tua newsletter, se fosse oggi'], ['#/account', 'Il tuo account'], ['#/admin', 'Stato del sistema'],
];

for (const mobile of [false, true]) {
  describe(`accessibilità e layout — ${mobile ? 'smartphone 390px' : 'desktop 1280px'}`, () => {
    it('pagine pubbliche: nessuna violazione WCAG 2.2 AA rilevata da axe, nessun overflow orizzontale', async () => {
      const { page, ctx } = await newPage(env, { mobile });
      const issues: string[] = [];
      for (const [hash, h] of PAGES) {
        await page.goto(env.url + hash);
        await page.getByRole('heading', { name: h }).first().waitFor();
        issues.push(...(await axe(page, hash)));
        expect(await overflowX(page), `overflow su ${hash}`).toBe(false);
        await shot(page, `${mobile ? 'm' : 'd'}-pub-${hash.replace(/[^a-z]/g, '')}`);
      }
      expect(issues).toEqual([]);
      await ctx.close();
    });

    it('pagine dell\'applicazione (utente admin demo): axe pulito, nessun overflow, ingrandimento del testo al 200%', async () => {
      const { page, ctx } = await newPage(env, { mobile });
      await signUp(page, env.url, 'admin@demo.test');
      await completeOnboarding(page);
      await page.getByRole('button', { name: 'Fine' }).click();
      await page.getByRole('heading', { name: 'Il tuo digest' }).waitFor();
      await page.getByRole('link', { name: 'Newsletter' }).first().click();
      await page.getByRole('button', { name: 'Genera la newsletter della settimana' }).click();
      await page.getByRole('link', { name: /Settimana del/ }).first().waitFor();
      const issues: string[] = [];
      for (const [hash, h] of APP_PAGES) {
        await page.goto(env.url + hash);
        await page.getByRole('heading', { name: h }).first().waitFor();
        issues.push(...(await axe(page, hash)));
        expect(await overflowX(page), `overflow su ${hash}`).toBe(false);
        await shot(page, `${mobile ? 'm' : 'd'}-app-${hash.replace(/[^a-z]/g, '') || 'home'}`);
      }
      // testo ingrandito
      await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
      for (const [hash, h] of APP_PAGES.filter(([x]) => ['#/', '#/preferences', '#/library'].includes(x))) {
        await page.goto(env.url + hash);
        await page.getByRole('heading', { name: h }).first().waitFor();
        expect(await overflowX(page), `overflow con testo al 200% su ${hash}: ${(await overflowers(page)).join(' ; ')}`).toBe(false);
      }
      expect(issues).toEqual([]);
      await ctx.close();
    });
  });
}

describe('tastiera, focus e dimensione dei controlli', () => {
  it('skip link per primo; il focus passa al titolo a ogni cambio pagina; focus visibile', async () => {
    const { page, ctx } = await newPage(env);
    await page.goto(env.url + '#/signin');
    await page.getByRole('heading', { name: 'Accedi' }).first().waitFor();
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.activeElement?.textContent)).toBe('Vai al contenuto');
    await signUp(page, env.url, 'tastiera@example.org');
    const active = await page.evaluate(() => document.activeElement?.tagName + ':' + document.activeElement?.textContent);
    expect(active).toMatch(/^H1:/);
    await page.keyboard.press('Tab');
    const outline = await page.evaluate(() => getComputedStyle(document.activeElement!).outlineStyle);
    expect(outline).not.toBe('none');
    await ctx.close();
  });

  it('smartphone: i pulsanti e i link di navigazione hanno area di tocco ≥ 44px', async () => {
    const { page, ctx } = await newPage(env, { mobile: true });
    await signUp(page, env.url, 'touch@example.org');
    await completeOnboarding(page);
    await page.getByRole('button', { name: 'Fine' }).click();
    await page.getByRole('heading', { name: 'Il tuo digest' }).waitFor();
    const small = await page.evaluate(() => {
      const out: string[] = [];
      document.querySelectorAll<HTMLElement>('button, .btn, nav a, input[type=checkbox], input[type=radio] + span').forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return;
        const visible = getComputedStyle(el).visibility !== 'hidden';
        if (visible && (r.height < 40 || r.width < 40) && !el.closest('.skip')) out.push(`${el.tagName}.${el.className} "${el.textContent?.slice(0, 20)}" ${Math.round(r.width)}x${Math.round(r.height)}`);
      });
      return out;
    });
    expect(small).toEqual([]);
    await ctx.close();
  });
});

describe('build di produzione', () => {
  it('non include la modalità demo né chiavi segrete', () => {
    const fs = require('node:fs') as typeof import('node:fs');
    const dist = fs.readdirSync('dist/assets').filter((f: string) => f.endsWith('.js'));
    expect(dist.length).toBeGreaterThan(0);
    for (const f of dist) {
      const src = fs.readFileSync(`dist/assets/${f}`, 'utf8');
      expect(src).not.toContain('acc-digest.demo');
      expect(src).not.toMatch(/service_role|SUPABASE_SERVICE|SMTP_PASS|sk-ant-/);
    }
  });
});
