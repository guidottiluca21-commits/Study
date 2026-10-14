# Sicurezza e privacy

> Questo documento descrive misure tecniche. **Non costituisce una dichiarazione di conformità al GDPR.** Il titolare del trattamento deve completare la pagina Privacy (campi `[DA COMPILARE]`), valutare base giuridica, informativa, registro dei trattamenti, eventuali DPA con i fornitori (Supabase, provider e-mail, GitHub) e trasferimenti extra-UE, ed eventualmente consultare un DPO/legale. I dati trattati possono far emergere l'attività professionale dell'utente; non sono raccolti dati dei pazienti.

## Segreti
Nessun segreto nel repository o nel frontend. Nel browser solo `VITE_SUPABASE_URL`, anon key (pubblica per progetto, protetta da RLS) e site key Turnstile. `DATABASE_URL`, `SMTP_*`, `NCBI_API_KEY` sono Secrets di GitHub. Un test verifica che il bundle di produzione non contenga demo né nomi di chiavi segrete. Se una password DB o SMTP trapela: ruotarla subito (RUNBOOK).

## Database
RLS attiva su tutte le tabelle; `revoke all` poi grant espliciti; tabelle operative (`automation_runs`, `email_deliveries`, `quota_usage`, `rate_events`…) inaccessibili ai client. Funzioni `SECURITY DEFINER` con `search_path` fisso e `auth.uid()`. L'utente non può cambiare ruolo o flag. Gli **admin non leggono dati individuali**: vedono aggregati e indirizzi mascherati tramite RPC. Verificato con test su Postgres reale (PGlite) e con mutation check (disattivando RLS i test falliscono).

## Account
Verifica e-mail e recupero password tramite Supabase Auth; **da configurare** nel pannello (conferma e-mail obbligatoria, "secure email change", redirect URL, SMTP personalizzato, password ≥ 10 caratteri, CAPTCHA). Cambio e-mail con conferma. Eliminazione account (`delete_my_account`) e esportazione dati (`export_my_data`, limitata in frequenza) disponibili in Account.

## Consenso e disiscrizione
Iscrizione alla newsletter solo con consenso esplicito registrato (versione del testo, data); nuova iscrizione ⇒ nuovo consenso. Link di disiscrizione a un clic con token nelle e-mail, intestazioni `List-Unsubscribe`. Chi si disiscrive tra generazione e invio non riceve la newsletter (test).

## Limiti di frequenza
`check_rate` sul database per esportazioni, prove di invio (3/giorno) e richieste sensibili. Per registrazione e login si usano i limiti di Supabase Auth + Turnstile (da attivare). Il limite lato DB non sostituisce un WAF.

## Contenuti esterni
Titoli/abstract/autori da PubMed sono escapati nell'HTML delle e-mail e nella SPA (React); gli URL sono costruiti solo con PMID numerici e DOI codificati (test). L'anteprima in iframe è sandboxed.

## Residui noti
Nessun penetration test; nessuna verifica contro Supabase reale; i log di esecuzione possono contenere indirizzi e-mail nei messaggi di errore SMTP (non mascherati: valutare prima di aprire a terzi la visibilità dei log; il repository pubblico espone i log di Actions); conservazione dei dati: definire e applicare un periodo (la pipeline ha pulizie di base).
