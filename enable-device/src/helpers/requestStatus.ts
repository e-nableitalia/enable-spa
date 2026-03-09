export const REQUEST_STATUSES = [
  "inviata",
  "famiglia contattata",
  "definizione richiesta",
  "valutazione fattibilità",
  "followup famiglia ko",
  "followup famiglia troppo piccolo",
  "attesa volontario",
  "scelta device e dimensionamento",
  "personalizzazione",
  "attesa materiali",
  "fabbricazione",
  "pronta per spedizione",
  "spedita",
  "followup famiglia",
  "completata",
  "annullata"
];

export const REQUEST_STATUS_DESCRIPTIONS: { [key: string]: string } = {
  "inviata": "La richiesta è stata inserita dalla famiglia e validata via email.",
  "famiglia contattata": "Primo contatto effettuato per raccolta informazioni.",
  "definizione richiesta": "Fase collaborativa per chiarire esigenze, misure, obiettivi.",
  "valutazione fattibilità": "Verifica tecnica della possibilità di realizzazione.",
  "followup famiglia ko": "Chiusura per esito tecnico negativo.",
  "followup famiglia troppo piccolo": "Chiusura temporanea per età non idonea.",
  "attesa volontario": "Richiesta pronta per assegnazione.",
  "scelta device e dimensionamento": "Selezione modello e adattamento misure.",
  "personalizzazione": "Eventuali modifiche estetiche o funzionali.",
  "attesa materiali": "In attesa componenti necessari.",
  "fabbricazione": "Stampa e assemblaggio.",
  "pronta per spedizione": "Dispositivo completato.",
  "spedita": "Spedizione effettuata.",
  "followup famiglia": "Contatto post-consegna per verifica utilizzo e soddisfazione.",
  "completata": "Richiesta chiusa positivamente dopo followup.",
  "annullata": "Richiesta chiusa anticipatamente per motivi organizzativi, rinuncia famiglia o altre cause non tecniche."
};

export const CLOSED_STATUSES = [
  "followup famiglia ko",
  "followup famiglia troppo piccolo",
  "annullata",
  "completata"
];

export const PUBLIC_STATUS_GROUPS = {
  "da gestire": [
    "inviata",
    "famiglia contattata",
    "definizione richiesta",
    "valutazione fattibilità",
    "attesa volontario"
  ],
  "fabbricazione in corso": [
    "scelta device e dimensionamento",
    "personalizzazione",
    "attesa materiali",
    "fabbricazione",
    "pronta per spedizione",
    "spedita",
    "followup famiglia"
  ],
  "completati": [
    "completata"
  ],
  "annullate / non completabili": [
    "followup famiglia ko",
    "followup famiglia troppo piccolo",
    "annullata"
  ]
};

// Funzione di mapping da stato interno a pubblico
export function mapInternalStatusToPublic(status: string): string {
  for (const [publicStatus, internalStates] of Object.entries(PUBLIC_STATUS_GROUPS)) {
    if (internalStates.includes(status)) {
      return publicStatus;
    }
  }
  return "da gestire"; // Default se non trovato
}

export const REQUEST_STATUS_SEVERITY: { [key: string]: "info" | "warning" | "success" | "secondary" | "contrast" | "danger" } = {
  "inviata": "info",
  "famiglia contattata": "info",
  "definizione richiesta": "info",
  "valutazione fattibilità": "warning",
  "followup famiglia ko": "danger",
  "followup famiglia troppo piccolo": "warning",
  "attesa volontario": "warning",
  "scelta device e dimensionamento": "info",
  "personalizzazione": "info",
  "attesa materiali": "warning",
  "fabbricazione": "info",
  "pronta per spedizione": "success",
  "spedita": "success",
  "followup famiglia": "secondary",
  "completata": "success",
  "annullata": "danger"
};

export const PUBLIC_STATUS_SEVERITY: { [key: string]: "info" | "warning" | "success" | "secondary" | "contrast" | "danger" } = {
  "da gestire": "warning",
  "fabbricazione in corso": "secondary",
  "completati": "success",
  "annullate / non completabili": "danger"
};

export function shortAmputationType(amputationType: string): "avambraccio" | "braccio" | "mano" | "altro" {
  const type = amputationType.toLowerCase();

  if (type.includes("braccio") && type.includes("sotto") && type.includes("gomito")) {
    return "avambraccio";
  }
  if (type.includes("braccio") && type.includes("sopra") && type.includes("gomito")) {
    return "braccio";
  }
  if (type.includes("mano") && (type.includes("polso"))) {
    return "mano";
  }
  return "altro";
}
