# Messa online — passo per passo

Prerequisiti: account GitHub, account Supabase (gratuito), un provider SMTP (vedi `LIMITI-E-COSTI.md`). Tutto ciò che segue **non è stato eseguito dall'autore**: segui con attenzione e usa la modalità simulazione prima.

1. **Repository.** Il ramo predefinito deve chiamarsi `main` (il deploy di Pages parte da `main`). Repo pubblico per Actions/Pages gratuiti.
2. **Supabase.** Nuovo progetto (regione UE). Annota: URL, anon key, stringa di connessione (Connection pooling / session mode).
3. **Schema.** In locale: `DATABASE_URL=... npm run db:migrate && npm run db:seed` (oppure incolla in SQL Editor i file `supabase/migrations/0001..0003` in ordine, poi esegui il seed).
4. **Auth (Authentication → Providers/Settings).** Email attivo; **Confirm email = ON**; Secure email change = ON; password minima 10; URL del sito = URL di Pages; Redirect URLs: `https://<utente>.github.io/<repo>/` (+ `#/reset`); **Custom SMTP** con gli stessi dati del provider; modelli e-mail in italiano; opzionale **CAPTCHA (Turnstile)** con secret nel pannello Supabase.
5. **Primo admin.** Registrati dal sito, conferma l'e-mail, poi SQL: vedi RUNBOOK.
6. **GitHub → Settings → Secrets and variables → Actions.**
   - Secrets: `DATABASE_URL`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `NCBI_API_KEY` (opz.).
   - Variables: `SITE_URL`, `NCBI_EMAIL`, `EMAIL_DAILY_LIMIT`, `SMTP_REPLY_TO` (opz.), `SEND_ALLOWLIST` (**all'inizio il tuo indirizzo**), `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_TURNSTILE_SITE_KEY` (opz.).
7. **Pages.** Settings → Pages → Source: **GitHub Actions**. Il workflow `Deploy web app` pubblica a ogni push su `main`.
8. **Prova SMTP:** in locale `SMTP_*=... SITE_URL=... npm run pipeline -- mail-test tuo@indirizzo` (arriva? finisce in spam? controlla SPF/DKIM).
9. **Simulazione:** Actions → Weekly digest → Run workflow con `simulate=true`. Leggi il riepilogo.
10. **Invio reale di prova:** `simulate=false`, `force=true`, con `SEND_ALLOWLIST` valorizzata.
11. **Apertura:** svuota `SEND_ALLOWLIST` solo quando hai verificato mittente, recapito, disiscrizione, privacy.
12. **Calendario:** il primo lunedì reale, controlla in Actions che il run parta (cron non testato dall'autore).
13. **Contenuti:** far rivedere il curriculum (`data/curriculum.json`, `editorial_status`) e completare la pagina Privacy prima di invitare altri.
