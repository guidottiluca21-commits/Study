/*
 * Scheletro degli argomenti e mappa delle fonti.
 *
 * ATTENZIONE: la lista degli argomenti deriva dalle "aree di conoscenza attese"
 * del documento ESAIC "How to prepare for the EDAIC". Lo stesso documento
 * precisa di NON essere un syllabus completo: questa lista è un punto di
 * partenza da verificare/integrare con il syllabus e la reading list ufficiali
 * (esaic.org). Gli argomenti si possono modificare qui, oppure dall'app
 * cambiando fonte e riferimento di ogni argomento.
 *
 * Non contiene testo dei libri: solo titoli di argomenti e riferimenti.
 * `p` = fonte primaria (una sola), `s` = fonti di integrazione.
 * p: null significa "fonte da assegnare".
 */
window.STUDY_DATA = {
  sources: {
    miller:   { name: "Miller's Anesthesia" },
    ohs:      { name: "Oh's Intensive Care Manual" },
    pinsky:   { name: "Pinsky – Hemodynamic Monitoring" },
    tobin:    { name: "Tobin – Mechanical Ventilation" },
    viaggi:   { name: "Viaggi – Antibiotici in terapia intensiva" },
    stanford: { name: "Stanford Guide" },
    fisio:    { name: "Doc. personale: Fisiologia polmonare" },
    stoelting:{ name: "Guida pratica Stoelting" },
    anastasi: { name: "Anastasi – Anatomia" },
    stat:     { name: "Libro di statistica medica" },
    lezioni:  { name: "Lezioni del corso (PDF/slide)" }
  },

  areas: [
    { id: "anat",   name: "Anatomia applicata",                  clinical: false },
    { id: "farm",   name: "Farmacologia",                        clinical: false },
    { id: "fisio",  name: "Fisiologia e biochimica",             clinical: false },
    { id: "fisica", name: "Fisica e misure",                     clinical: false },
    { id: "stat",   name: "Statistica",                          clinical: false },
    { id: "anest",  name: "Anestesia clinica e perioperatoria",  clinical: true },
    { id: "emerg",  name: "Rianimazione ed emergenza",           clinical: true },
    { id: "ti",     name: "Terapia intensiva",                   clinical: true },
    { id: "dolore", name: "Dolore e cure palliative",            clinical: true }
  ],

  topics: [
    // --- Anatomia applicata ---
    { id: "an1", a: "anat", t: "Testa, collo e vie aeree superiori", p: "anastasi", s: ["miller"] },
    { id: "an2", a: "anat", t: "Torace e mediastino", p: "anastasi", s: [] },
    { id: "an3", a: "anat", t: "Colonna vertebrale e canale spinale", p: "miller", s: ["anastasi"] },
    { id: "an4", a: "anat", t: "Sistema nervoso periferico e plessi (anatomia dei blocchi)", p: "miller", s: ["anastasi"] },
    { id: "an5", a: "anat", t: "Sistema vascolare: accessi e repere di superficie", p: "anastasi", s: ["miller"] },

    // --- Farmacologia ---
    { id: "fa1", a: "farm", t: "Principi di farmacocinetica", p: "stoelting", s: [] },
    { id: "fa2", a: "farm", t: "Farmacodinamica e interazione farmaco-recettore", p: "stoelting", s: [] },
    { id: "fa3", a: "farm", t: "Anestetici inalatori", p: "miller", s: ["stoelting"] },
    { id: "fa4", a: "farm", t: "Anestetici endovenosi e ipnotici", p: "miller", s: ["stoelting"] },
    { id: "fa5", a: "farm", t: "Oppioidi", p: "miller", s: ["stoelting"] },
    { id: "fa6", a: "farm", t: "Miorilassanti e decurarizzazione", p: "miller", s: ["stoelting"] },
    { id: "fa7", a: "farm", t: "Anestetici locali", p: "miller", s: ["stoelting"] },
    { id: "fa8", a: "farm", t: "Farmaci cardiovascolari e vasoattivi", p: "stoelting", s: ["ohs"] },
    { id: "fa9", a: "farm", t: "Tossicità e interazioni; farmaci di uso internistico", p: "stoelting", s: [] },

    // --- Fisiologia e biochimica ---
    { id: "fi1", a: "fisio", t: "Meccanica respiratoria (statica, dinamica, compliance, resistenze)", p: "fisio", s: ["tobin"] },
    { id: "fi2", a: "fisio", t: "Rapporto ventilazione/perfusione, shunt e spazio morto", p: "fisio", s: [] },
    { id: "fi3", a: "fisio", t: "Scambi gassosi e trasporto di O2 e CO2 (curva di dissociazione, Bohr, Haldane, P50)", p: "fisio", s: ["miller"] },
    { id: "fi4", a: "fisio", t: "Controllo della respirazione", p: "fisio", s: [] },
    { id: "fi5", a: "fisio", t: "Fisiologia respiratoria in anestesia (CRF, atelettasie, chiusura delle vie aeree, vasocostrizione ipossica)", p: "miller", s: ["tobin", "fisio"] },
    { id: "fi6", a: "fisio", t: "Fisiologia cardiovascolare", p: "miller", s: [] },
    { id: "fi7", a: "fisio", t: "Fisiologia renale ed equilibrio idroelettrolitico", p: "miller", s: [] },
    { id: "fi8", a: "fisio", t: "Fisiologia epatica e metabolismo", p: "miller", s: [] },
    { id: "fi9", a: "fisio", t: "Neurofisiologia (sistema nervoso autonomo, flusso cerebrale, pressione intracranica, sonno)", p: "miller", s: [] },
    { id: "fi10", a: "fisio", t: "Endocrinologia", p: null, s: [] },
    { id: "fi11", a: "fisio", t: "Coagulazione ed emostasi", p: null, s: [] },
    { id: "fi12", a: "fisio", t: "Equilibrio acido-base", p: "miller", s: [] },
    { id: "fi13", a: "fisio", t: "Fisiologia in gravidanza, età pediatrica e anziano", p: null, s: [] },
    { id: "fi14", a: "fisio", t: "Fisiologia gastrointestinale", p: "miller", s: [] },

    // --- Fisica e misure ---
    { id: "ph1", a: "fisica", t: "Fisica di gas, liquidi e vapori (leggi dei gas)", p: null, s: [] },
    { id: "ph2", a: "fisica", t: "Apparecchiature: flussimetri, regolatori, vaporizzatori, circuiti respiratori", p: null, s: ["miller"] },
    { id: "ph3", a: "fisica", t: "Principi di misura: pressioni, temperatura, capnografia, ossimetria", p: null, s: [] },
    { id: "ph4", a: "fisica", t: "Elettricità, rischio di incendio ed esplosione in sala operatoria", p: null, s: [] },

    // --- Statistica ---
    { id: "st1", a: "stat", t: "Gestione dei dati e distribuzioni di popolazione", p: "stat", s: [] },
    { id: "st2", a: "stat", t: "Probabilità e test di significatività (parametrici e non parametrici)", p: "stat", s: [] },
    { id: "st3", a: "stat", t: "Test diagnostici: sensibilità, specificità, valori predittivi", p: "stat", s: [] },

    // --- Anestesia clinica e perioperatoria ---
    { id: "ac1", a: "anest", t: "Valutazione preoperatoria, rischio e scoring (ASA); interpretazione di ECG, imaging e prove funzionali", p: "miller", s: ["lezioni"] },
    { id: "ac2", a: "anest", t: "Anestesia generale: tecniche e agenti", p: "miller", s: ["lezioni"] },
    { id: "ac3", a: "anest", t: "Gestione delle vie aeree e via aerea difficile", p: "miller", s: ["lezioni"] },
    { id: "ac4", a: "anest", t: "Anestesia neuroassiale (spinale ed epidurale)", p: "miller", s: ["lezioni"] },
    { id: "ac5", a: "anest", t: "Blocchi periferici e anestesia loco-regionale", p: "miller", s: ["lezioni"] },
    { id: "ac6", a: "anest", t: "Monitoraggio in anestesia", p: "miller", s: [] },
    { id: "ac7", a: "anest", t: "Sedazione", p: "miller", s: [] },
    { id: "ac8", a: "anest", t: "Anestesia ostetrica e analgesia del parto", p: "miller", s: ["lezioni"] },
    { id: "ac9", a: "anest", t: "Anestesia pediatrica e rianimazione neonatale", p: "miller", s: ["lezioni"] },
    { id: "ac10", a: "anest", t: "Anestesia nell'anziano", p: "miller", s: [] },
    { id: "ac11", a: "anest", t: "Anestesia cardiotoracica e vascolare", p: "miller", s: ["lezioni"] },
    { id: "ac12", a: "anest", t: "Neuroanestesia", p: "miller", s: ["lezioni"] },
    { id: "ac13", a: "anest", t: "Anestesia fuori sala (NORA) e ambulatoriale", p: "miller", s: [] },
    { id: "ac14", a: "anest", t: "Cura perioperatoria, emergenze perioperatorie e analgesia postoperatoria", p: "miller", s: [] },
    { id: "ac15", a: "anest", t: "Complicanze e incidenti critici in anestesia", p: "miller", s: [] },
    { id: "ac16", a: "anest", t: "Anestesia per specialità chirurgiche (ortopedica, ORL, urologica, epatobiliare, bariatrica, robotica)", p: "miller", s: [] },
    { id: "ac17", a: "anest", t: "Anestesia per trapianto ed espianto di organi; morte cerebrale", p: "miller", s: [] },

    // --- Rianimazione ed emergenza ---
    { id: "em1", a: "emerg", t: "Rianimazione cardiopolmonare: BLS e ALS (adulto e pediatrico)", p: null, s: ["lezioni"] },
    { id: "em2", a: "emerg", t: "Medicina d'emergenza, assistenza preospedaliera e trauma", p: "miller", s: ["lezioni"] },

    // --- Terapia intensiva ---
    { id: "ti1", a: "ti", t: "Insufficienza respiratoria acuta e ARDS", p: "ohs", s: ["tobin"] },
    { id: "ti2", a: "ti", t: "Ventilazione meccanica invasiva", p: "tobin", s: ["ohs"] },
    { id: "ti3", a: "ti", t: "Ventilazione non invasiva e svezzamento", p: "tobin", s: ["ohs"] },
    { id: "ti4", a: "ti", t: "Shock e insufficienza circolatoria", p: "ohs", s: ["pinsky"] },
    { id: "ti5", a: "ti", t: "Monitoraggio emodinamico (gittata cardiaca, responsività ai fluidi)", p: "pinsky", s: ["ohs"] },
    { id: "ti6", a: "ti", t: "Sepsi e shock settico", p: "ohs", s: ["viaggi"] },
    { id: "ti7", a: "ti", t: "Terapia antibiotica empirica in terapia intensiva", p: "viaggi", s: ["stanford"] },
    { id: "ti8", a: "ti", t: "Infezioni in terapia intensiva e uso degli antimicrobici", p: "viaggi", s: ["stanford", "ohs"] },
    { id: "ti9", a: "ti", t: "Fluidi, elettroliti, emocomponenti", p: "ohs", s: [] },
    { id: "ti10", a: "ti", t: "Nutrizione enterale e parenterale", p: "ohs", s: [] },
    { id: "ti11", a: "ti", t: "Disturbi metabolici e acido-base; chetoacidosi, iperosmolarità, intossicazioni acute", p: "ohs", s: [] },
    { id: "ti12", a: "ti", t: "Insufficienza renale acuta e terapie sostitutive (CVVHDF)", p: "ohs", s: [] },
    { id: "ti13", a: "ti", t: "Neurointensiva: condizioni neurochirurgiche e neurologiche acute", p: "ohs", s: [] },
    { id: "ti14", a: "ti", t: "Politrauma, ustioni e insufficienza multiorgano", p: "ohs", s: [] },
    { id: "ti15", a: "ti", t: "Scoring e prognosi in terapia intensiva", p: "ohs", s: [] },
    { id: "ti16", a: "ti", t: "Etica, decisioni di fine vita, donazione di organi", p: "ohs", s: [] },

    // --- Dolore e cure palliative ---
    { id: "do1", a: "dolore", t: "Fisiologia del dolore", p: null, s: [] },
    { id: "do2", a: "dolore", t: "Terapia del dolore acuto e cronico; approccio multidisciplinare", p: "miller", s: [] },
    { id: "do3", a: "dolore", t: "Controllo dei sintomi e cure palliative", p: "miller", s: [] }
  ]
};
