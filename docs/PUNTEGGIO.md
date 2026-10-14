# Punteggio di importanza e ranking

**Non è uno strumento scientificamente validato.** È un'euristica deterministica (versione `1.0.0`) che legge solo metadati PubMed e abstract; non legge il full text né valuta il rischio di bias come farebbe un revisore. Ogni punteggio riporta un livello di **incertezza**. Il **prestigio della rivista non entra mai** nel punteggio né nell'override (test dedicato).

## Importanza (0–100)
Componenti: disegno dello studio (max 30), dimensione del campione (15), rilevanza degli esiti — mortalità/esiti funzionali > intermedi > surrogati (20), indicatori di robustezza: registrazione, cieco, multicentrico, intention-to-treat, intervallo di confidenza (15), novità (10), applicabilità (10); meno penalità (pilota, monocentrico, post-hoc, ecc.). Studi preclinici: tetto 20. Protocolli, ritrattati e senza abstract: esclusi. I valori esatti sono in `SCORING_CONFIG` (`src/core/scoring.ts`).

## Override "high impact"
Fa passare un articolo **anche fuori dalle priorità dell'utente**, al massimo 2 per newsletter, solo se l'importanza è ≥ 55 e **tutti** i criteri verificabili del suo tipo sono soddisfatti; la newsletter mostra i criteri con la frase dell'abstract che li giustifica.
- RCT: ≥ 800 partecipanti, registrazione, esito rilevante per il paziente, metodologia robusta.
- Meta-analisi: ≥ 8 studi, ≥ 2000 pazienti, metodologia dichiarata, effetto con IC.
- Linea guida: recente (≤ 150 giorni) con metodologia GRADE/tag PubMed.
Se il tipo è dedotto dal testo (tag mancante) l'override lo dichiara "da verificare".

## Ranking personale
`finale = 0.5 × rilevanza_personale + 0.5 × importanza`. Rilevanza = peso priorità (1→0.3 … 5→1) × corrispondenza della categoria; bonus +10 / malus −5 per il tipo di studio preferito. Soglie: personale ≥ 30 e importanza ≥ 35. Tetto 2 per categoria e numero di novità scelto dall'utente (da 1 a 20; l'articolo Core si aggiunge a parte). Nessuna programmazione dello studio, nessun budget di tempo. I minuti per tipo di studio (guideline 40, meta-analisi/revisione sistematica 25, RCT 20, osservazionale 15, review 20, altro 10) sono solo una stima mostrata accanto a ogni articolo. Mai riproporre articoli già ricevuti.

## Limiti noti
Falsi negativi/positivi inevitabili (abstract strutturati diversamente, tipi inferiti). Non misura qualità reale, conflitti di interesse o applicabilità al tuo contesto. Va usato per **ordinare l'attenzione**, non per decidere pratica clinica.
