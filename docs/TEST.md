# Test: cosa è verificato e cosa no

## Esecuzione
`npm run typecheck` · `npm test` · `npm run build:demo && npm run test:e2e` · `npm run test:live` (rete).

## Verificato dai test automatici (in locale)
- **Database/RLS** (PGlite, Postgres reale in WASM): isolamento tra utenti, nessuna escalation di ruolo, anon senza accesso, tabelle operative chiuse, admin solo aggregati/indirizzi mascherati, consensi, disiscrizione con token, export, eliminazione account, idempotenza a vincolo. Mutation check: disattivare RLS o concedere update su `profiles` fa fallire i test.
- **PubMed**: parsing su record reali (incl. entità `&#x3b2;`), tipo di studio da tag e da testo, finestra di ricerca con sovrapposizione, query; ricerche live opzionali.
- **Punteggio/override/ranking/Core**: determinismo, il prestigio della rivista non conta, soglie, tetti, numero di novità scelto, nessuna programmazione dello studio, nessuna ripetizione, prerequisiti, simulazione di 12 settimane, utenti diversi → percorsi diversi.
- **Newsletter**: oggetto esatto, sezioni, link PubMed/DOI, escape HTML, testo equivalente, contrasto ≥ 4.5:1, nessun riempitivo.
- **Pipeline** (PGlite + server SMTP reale locale): idempotenza, retry/backoff (451), errore permanente (550), quota, errori PubMed (429/giù), categoria fallita senza avanzamento, recupero record indicizzati in ritardo, disiscrizione durante l'invio, allowlist, simulazione senza effetti, richieste di prova.
- **Orari**: ora legale/solare, due cron, ritardo.
- **Interfaccia** (Chromium + axe, modalità demo): flusso registrazione→onboarding→dashboard→newsletter→libreria→preferenze→account→eliminazione; due utenti separati; axe senza violazioni (WCAG 2.2 AA tag) a 1280 e 390 px; nessun overflow orizzontale anche con testo al 200%; skip link, focus, bersagli ≥ 40 px; bundle di produzione senza demo né segreti.

## NON verificato (richiede ambiente reale)
- Registrazione, verifica e-mail, recupero password, cambio e-mail con **Supabase Auth reale**; Turnstile; eliminazione dell'utente in `auth.users` lato Supabase reale (nei test il DB è PGlite con uno shim di `auth`).
- Invio con un **provider e-mail reale** (recapito, spam, SPF/DKIM, limiti reali); rendering nei client di posta (Gmail/Outlook).
- **Pianificazione GitHub Actions** (cron, ritardi, disattivazione a 60 giorni) e workflow YAML mai eseguiti.
- Pausa/ripristino di Supabase; carico con molti utenti; qualità del ranking su volumi reali; contenuto clinico del curriculum (bozza non rivista).
- Conformità legale (nessuna dichiarata).

## Mappa dei 20 test obbligatori
Copertura per tema (i nomi esatti sono nei file in `tests/`): utenti diversi/preferenze indipendenti (db-rls, pipeline); RLS (db-rls); idempotenza e invio unico (db-rls, pipeline); simulazione (pipeline); quota (pipeline); retry/backoff (pipeline); errori PubMed (pipeline); nessun riempitivo (rank, pipeline, newsletter); override con criteri (scoring, newsletter); Core senza ripetizioni e simulazione 12 settimane (curriculum); curriculum verificato (curriculum); formato oggetto/sezioni (newsletter); sicurezza HTML (newsletter); orari DST (schedule); disiscrizione (db-rls, pipeline); export/eliminazione (db-rls, e2e); accessibilità/responsive (e2e); build senza segreti (e2e). **Parziali** rispetto alla richiesta: registrazione/verifica e-mail/recupero password (solo UI demo e DB, non Auth reale) e pianificazione reale.
