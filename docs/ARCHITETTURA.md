# Architettura

```
GitHub Pages (React SPA, solo anon key)  ──HTTPS──>  Supabase Auth + Postgres (RLS, RPC SECURITY DEFINER)
                                                          ^
GitHub Actions (cron lunedì) ── pipeline TypeScript ──────┘  (connessione diretta con DATABASE_URL, secret)
        │  PubMed E-utilities (1 ricerca per categoria, non per utente)
        └─ SMTP del provider scelto (e-mail)
```

## Moduli
- `src/core/` — logica **pura e condivisa** (usata da pipeline e web): parsing PubMed, classificazione, punteggio (`scoring.ts`), ranking personale (`rank.ts`), pianificazione settimanale, scelta Core (`curriculum.ts`), composizione newsletter HTML+testo (`newsletter.ts`), orari (`schedule.ts`), `buildIssue` (stessa funzione per invio e anteprima: l'anteprima mostra ciò che verrebbe inviato).
- `src/pipeline/` — orchestrazione con effetti: DB (`store.ts`), SMTP (`mailer.ts`), `run.ts` (settimanale e richieste di prova), CLI.
- `src/web/` — SPA: Dashboard, Personalizzazione (procedura guidata a 6 passi + pagina Preferenze), Libreria, Archivio/Anteprima/Prova, Account, Admin, Privacy.
- `supabase/migrations/` — schema (0001), RLS e grant (0002), funzioni (0003).
- `data/` — 27 categorie con query PubMed; curriculum Core (19 argomenti, 113 articoli, tutti verificati su PubMed).

## Flusso settimanale
1. Due cron (03:15 e 04:15 UTC del lunedì). `decideRun` calcola l'ora **reale** di Roma: avvia solo dalle 05:00 alle 12:00 locali, attende fino alle 06:00 se serve, segna `late` se in ritardo. Gestisce ora legale/solare (testato).
2. Ricerca PubMed condivisa per categoria con finestra su data di inserimento (EDAT) e 3 giorni di sovrapposizione + riesame degli ultimi 60 giorni (tag/MeSH assegnati in ritardo). Lo stato di ricerca **non avanza** se una categoria fallisce.
3. Deduplica per PMID/DOI, classificazione, punteggio di importanza, salvataggio.
4. Per ogni utente idoneo (attivo, iscritto con consenso, non bloccato, e-mail verificata, non in pausa, giorno non "libero"): ranking personale, Core, piano, newsletter; salvataggio con vincolo `unique(user_id, week_start)`.
5. Invio con `idempotency_key` univoca, retry con backoff sugli errori temporanei, controllo quota giornaliera, ricontrollo dell'iscrizione **subito prima** dell'invio. Se non c'è nulla di rilevante, **non si invia nulla** (nessun riempitivo).
6. Esito registrato in `automation_runs`; `partial`/`failed` ⇒ exit code ≠ 0 ⇒ workflow rosso ⇒ notifica GitHub all'amministratore.

## Modalità
- **Simulazione** (`--simulate`): l'intera pipeline gira in una transazione annullata; nessuna e-mail, nessuna scrittura.
- **Fase di prova**: `SEND_ALLOWLIST` limita gli invii a indirizzi autorizzati.
- **Demo web**: compilata solo con `VITE_ENABLE_DEMO=1`; il build di produzione non contiene il codice demo (verificato da un test).

## Scelte e compromessi
- Pipeline fuori dal browser con connessione diretta al DB: le chiavi privilegiate non toccano mai il frontend.
- Consegna **at-least-once**: una finestra minuscola tra accettazione SMTP e scrittura nel DB potrebbe in teoria produrre un duplicato dopo un crash.
- La "prova di invio" richiesta dall'utente nel sito è una **richiesta in coda** elaborata dal workflow `test-requests` (giornaliero) o a mano; non è istantanea.
- Newsletter in italiano.
