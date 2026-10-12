# Studio Anestesia

Piano di studio personale e aggiornamenti settimanali di letteratura per la specializzazione in anestesia, rianimazione, terapia intensiva e del dolore.

Sito statico (nessun server): HTML, CSS e JavaScript, installabile come app dal telefono. I dati personali (livelli, sessioni, impostazioni) restano **solo sul dispositivo**.

## Sezioni

- **Oggi** – un solo compito già scelto, con timer "Inizia 10 minuti", ripassi a intervalli (1, 3, 7, 21 giorni), serie misurata sulla settimana, giorni "pesanti" o "di riposo" che non rompono la serie.
- **Piano** – argomenti per area con livello di padronanza (1–4), una sola fonte primaria per argomento, tappe trimestrali fino a fine specializzazione, traguardo opzionale EDAIC Part I.
- **Aggiornamenti** – report del lunedì con RCT, meta-analisi, revisioni sistematiche e linee guida da PubMed; salvataggio e scarto degli articoli.
- **Opzioni** – obiettivi, date, rotazione corrente, esporta/importa backup.

## Messa online (GitHub Pages)

1. Unisci il ramo di lavoro in `main`.
2. Su GitHub: *Settings → Pages → Build and deployment → Deploy from a branch → `main` / root*.
3. Apri l'indirizzo che compare (`https://<utente>.github.io/study/`) dal telefono e usa "Aggiungi a schermata Home".

## Digest del lunedì

Il workflow `.github/workflows/digest.yml` gira ogni lunedì mattina e salva il report in `data/digest/`. Per la prima esecuzione: *Actions → Digest settimanale → Run workflow*.

- **Senza chiave**: elenco con titolo, rivista, tipo di studio, link PubMed e abstract originale.
- **Con sintesi in italiano** (facoltativo, costa pochi centesimi a settimana): aggiungi il secret `ANTHROPIC_API_KEY` in *Settings → Secrets and variables → Actions*. Modello predefinito `claude-sonnet-5-5`, cambiabile con la variabile d'ambiente `DIGEST_MODEL` nel workflow. Se la chiamata fallisce, il report esce comunque in versione base.
- Facoltativo: variabile di repository `NCBI_EMAIL` (cortesia verso PubMed).
- Prova in locale: `python3 scripts/digest.py --no-ai`.

Tutto ciò che compare nel report viene da PubMed; le sintesi automatiche possono contenere errori e vanno sempre verificate sull'articolo.

## Modificare argomenti e fonti

Gli argomenti e la mappa delle fonti sono in `data/topics.js`. Per cambiare fonte o riferimento di un singolo argomento basta il pulsante "Fonte" nella sezione Piano. La lista deriva dalle aree di conoscenza del documento ESAIC "How to prepare for the EDAIC", che non è un syllabus completo: va verificata con il syllabus e la reading list ufficiali.

## Backup

Dalla sezione Opzioni: *Esporta backup* (file JSON) e *Importa backup*. Fallo ogni tanto: cambiando telefono o cancellando i dati del browser i progressi si perdono.

Supporto allo studio personale: non sostituisce linee guida, articoli completi né il giudizio clinico.
