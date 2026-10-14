# Runbook operativo

## Il digest del lunedì non è arrivato
1. GitHub → Actions → "Weekly digest": c'è un'esecuzione del lunedì? Rossa/gialla/assente?
2. **Assente**: GitHub può ritardare/saltare i cron, o i workflow pianificati sono stati disattivati (60 giorni senza attività nel repo). Riattivali (Actions → workflow → Enable) ed esegui **Run workflow** con `simulate=false`, `force=true`. L'idempotenza impedisce doppi invii.
3. **Rossa**: leggi il riepilogo (Summary) del run: errori PubMed, SMTP permanente, quota, DB. `partial` = alcune categorie/e-mail fallite; riesegui: riprende solo ciò che manca.
4. **Verde ma nessuna e-mail**: potrebbe non esserci nulla di rilevante per l'utente (nessun riempitivo), oppure `SEND_ALLOWLIST` è ancora valorizzata.

## Quota e-mail superata
Il run lascia gli invii in coda e avvisa. Alza `EMAIL_DAILY_LIMIT` solo se il provider lo consente; altrimenti riesegui il giorno dopo (il run di recupero invia la coda).

## Supabase in pausa (piano gratuito, inattività)
Sintomi: login non funziona, workflow rosso con errore di connessione. Azioni: dashboard Supabase → **Restore project**; attendi; riesegui il workflow. Prevenzione: la pipeline settimanale è attività sufficiente di solito; verifica che non sia disattivata. **Se il progetto è stato eliminato** (pausa lunga): crea un nuovo progetto, esegui `npm run db:migrate && npm run db:seed`, aggiorna `DATABASE_URL`, `VITE_SUPABASE_*`, redirect URL e riesegui il deploy; gli utenti vanno re-invitati (i dati vanno persi se non esportati: tieni un `pg_dump` periodico manuale).

## Cambio password/segreti compromessi
Ruota la password del DB (Supabase → Database → Reset password) e/o SMTP, aggiorna i Secrets di GitHub, riesegui un run simulato.

## Primo amministratore
SQL Editor: `update public.profiles set role='admin' where id = (select id from auth.users where email='tu@example.org');` (una sola volta; gli utenti non possono auto-promuoversi).

## Rollback
Disattiva i workflow (Actions → Disable). Per sospendere un utente: pannello Admin ⇒ blocca. Le newsletter già generate restano nell'archivio.

## Manutenzione periodica
Mensile: controlla Actions e la quota del provider; ogni 60 giorni assicurati che i workflow pianificati siano attivi; ogni 6 mesi `npm run curriculum:verify` e revisione clinica del curriculum.
