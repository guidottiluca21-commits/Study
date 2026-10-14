import { PageHead, Note } from '../components.tsx';

export function Privacy() {
  return (
    <div className="prose">
      <PageHead eyebrow="Informativa" title="Privacy e trattamento dei dati" />
      <Note>Questa informativa è una BOZZA da verificare con un consulente o con il responsabile della protezione dei dati prima della pubblicazione. Non costituisce una dichiarazione di conformità al GDPR.</Note>

      <h2>Chi tratta i dati</h2>
      <p>Titolare del trattamento: <strong>[da compilare: nome e recapito del gestore del servizio]</strong>.</p>

      <h2>Quali dati raccogliamo</h2>
      <ul>
        <li><strong>Indirizzo e-mail</strong> e password (la password è gestita dal servizio di autenticazione in forma cifrata; il gestore non può leggerla).</li>
        <li><strong>Preferenze</strong>: argomenti e priorità, numero di letture settimanali, tipologie di studio.</li>
        <li><strong>Libreria e progressi</strong>: articoli ricevuti, salvati o completati, avanzamento nel percorso Core Knowledge.</li>
        <li><strong>Registro dei consensi</strong> e delle disiscrizioni; <strong>registro tecnico degli invii</strong> (esito, data).</li>
      </ul>
      <p>Non chiediamo dati clinici, dati di pazienti né informazioni non necessarie. Il nome è facoltativo.</p>

      <h2>Perché e con quale base giuridica</h2>
      <p>Per erogare il servizio che hai richiesto (account, preferenze, libreria) e, per l'invio della newsletter, sulla base del tuo <strong>consenso esplicito</strong>, che puoi revocare in ogni momento con un clic dal link in ogni e-mail o dalle preferenze.</p>

      <h2>Quanto conserviamo i dati</h2>
      <p>Fino alla cancellazione dell'account, che elimina profilo, preferenze, libreria, progressi, newsletter e consensi. I registri tecnici di invio più vecchi vengono ripuliti periodicamente.</p>

      <h2>A chi sono comunicati</h2>
      <ul>
        <li>Servizio di database e autenticazione (Supabase), <strong>[verificare la regione del progetto e l'eventuale trasferimento extra-UE]</strong>;</li>
        <li>fornitore del servizio di invio e-mail (SMTP) <strong>[indicare il fornitore scelto]</strong>;</li>
        <li>GitHub, per l'hosting del sito e l'esecuzione dell'automazione settimanale.</li>
      </ul>
      <p>Le ricerche su PubMed non contengono alcun dato personale.</p>

      <h2>I tuoi diritti</h2>
      <p>Puoi accedere ai tuoi dati ed esportarli, rettificarli, limitarne il trattamento, opporti e cancellarli direttamente dalla pagina <a href="#/account">Account</a>. Hai inoltre il diritto di proporre reclamo all'autorità di controllo (in Italia, il Garante per la protezione dei dati personali).</p>

      <h2>Cookie e archiviazione locale</h2>
      <p>Non usiamo cookie di tracciamento né strumenti di analisi. Il browser conserva solo il necessario per mantenerti connesso (archiviazione locale della sessione).</p>

      <h2>Avvertenza</h2>
      <p>I contenuti sono un supporto allo studio personale: non sostituiscono linee guida, la lettura dell'articolo completo né il giudizio clinico. Le sintesi si basano sugli abstract; i punteggi sono indicativi e non validati scientificamente.</p>
    </div>
  );
}
