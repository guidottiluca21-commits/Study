# Open Anesthesia & Critical Care Digest

Piattaforma web **gratuita e multiutente** per medici di anestesia e terapia intensiva: ogni lunedì alle 06:00 (Europe/Rome) una newsletter personalizzata con
**Latest Evidence** (novità da PubMed, 4–6 articoli) e **Core Knowledge** (percorso progressivo di articoli fondamentali, linee guida e revisioni).
Oggetto: `Anesthesia & Critical Care — Weekly Digest | [data]`.

> Stato: **codice completo e testato in locale**, ma **mai eseguito contro un Supabase reale, un provider e-mail reale o la pianificazione di GitHub Actions**.
> Leggi `docs/TEST.md` per sapere con precisione cosa è verificato e cosa no, e `docs/DEPLOY.md` per la messa online.

## Stack (costo zero, nessuna IA a pagamento)
TypeScript · React + Vite (GitHub Pages) · Supabase (Auth + Postgres + RLS) · GitHub Actions (pipeline) · SMTP a scelta · PubMed E-utilities.
Il punteggio è deterministico e trasparente (`docs/PUNTEGGIO.md`), le sintesi sono estrattive (frasi dell'abstract), non generate.

## Comandi
| Comando | Cosa fa |
|---|---|
| `npm ci` | installa le dipendenze |
| `npm run typecheck` / `npm test` | controllo dei tipi / test (PGlite = Postgres reale in WASM, SMTP locale reale) |
| `npm run build:demo && npm run test:e2e` | test dell'interfaccia in Chromium con axe (modalità demo) |
| `npm run test:live` | test contro PubMed reale (richiede rete) |
| `npm run dev` | sviluppo; con `VITE_ENABLE_DEMO=1` e senza Supabase gira in **modalità demo** (dati nel browser) |
| `npm run db:migrate` / `db:seed` | applica le migrazioni / carica categorie e curriculum |
| `npm run pipeline -- weekly --simulate` | prova generale completa: nessuna e-mail, nessun dato salvato |
| `npm run pipeline -- schedule-check --at 2026-10-12T04:15:00Z` | mostra se quell'istante farebbe partire l'invio |
| `npm run curriculum:verify` | riverifica su PubMed ogni articolo del curriculum |

## Documentazione
`docs/ARCHITETTURA.md` · `docs/PUNTEGGIO.md` · `docs/LIMITI-E-COSTI.md` · `docs/SICUREZZA-E-PRIVACY.md` · `docs/DEPLOY.md` · `docs/RUNBOOK.md` · `docs/TEST.md`

## Avvertenze
Strumento di supporto allo studio: non sostituisce linee guida, articoli completi né il giudizio clinico. Il curriculum Core è una **bozza editoriale generata con l'IA e non ancora rivista** da un clinico (`editorial_status: draft_unreviewed`); i riferimenti bibliografici sono stati verificati su PubMed, motivazioni e obiettivi di apprendimento no. La pagina Privacy è una **bozza** con campi da compilare. Nessuna dichiarazione di conformità GDPR.
