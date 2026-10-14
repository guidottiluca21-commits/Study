# Limiti e costi

Obiettivo: **costo zero**. I limiti dei servizi cambiano: **riverificali sulle pagine ufficiali prima di andare online** (non ho potuto consultarli dal sandbox di sviluppo; quanto segue è ciò che era noto al momento della scrittura).

| Servizio | Piano gratuito (da riverificare) | Conseguenze per il progetto |
|---|---|---|
| Supabase | DB ~500 MB; progetti inattivi **messi in pausa** dopo circa 1 settimana senza attività; SMTP integrato molto limitato (solo e-mail di sistema, pochissime/ora) | La pipeline settimanale genera attività, ma resta il rischio pausa: vedi RUNBOOK. Per l'invio di verifica/recupero password **serve un SMTP personalizzato** (stesso provider della newsletter). |
| GitHub Actions | gratuito per repository pubblici; minuti mensili limitati per quelli privati; i cron possono **ritardare** (picchi di carico) o saltare; i workflow pianificati vengono **disattivati dopo 60 giorni di inattività del repository** (repo pubblici) | Due cron + controllo orario reale; `late` segnalato; nel RUNBOOK il promemoria per riattivare. |
| GitHub Pages | gratuito, repository pubblico | La SPA contiene solo chiavi pubbliche. |
| PubMed E-utilities | ~3 richieste/s senza chiave, ~10/s con chiave gratuita; si raccomanda di indicare e-mail e strumento | Una ricerca per categoria (non per utente), throttling e retry integrati. |
| Provider SMTP | **Dipende dalla scelta**: i piani gratuiti hanno tetti giornalieri/mensili e spesso richiedono un dominio di invio verificato (SPF/DKIM) | `EMAIL_DAILY_LIMIT` va impostato al limite reale. Il codice si ferma, lascia in coda e avvisa; il giorno dopo riprende. **Un indirizzo gratuito (gmail ecc.) come mittente di una newsletter può essere inaffidabile/limitato**: valuta un dominio proprio (costo non zero) o resta in fase di prova con pochi utenti. |
| Cloudflare Turnstile | gratuito (opzionale) | Anti-bot sulla registrazione. |

## Cosa può costare
Un dominio proprio (opzionale ma consigliato per la consegnabilità). Nessuna IA a pagamento è richiesta.

## Capacità indicativa
Il collo di bottiglia è la quota e-mail giornaliera del provider, non il codice. Con tetto 100/giorno e invii in coda, circa 100 destinatari per lunedì; oltre, gli invii proseguono nei giorni successivi (con ritardo, dichiarato dal log).
