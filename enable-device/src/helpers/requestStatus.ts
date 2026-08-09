export const REQUEST_STATUSES = [
  "inviata",
  "validata",
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
  "fitting",
  "pronta per spedizione",
  "spedita",
  "followup famiglia",
  "completata",
  "annullata",
  "standby",
  // Story EA-152: "da gestire"/"in produzione" sono i 2 valori generici
  // introdotti da EA-148 per i 10 stati rimossi (vedi REMOVED_STATUS_TO_GENERIC
  // sotto) — aggiunti qui (additivo, i 10 valori rimossi restano per ora,
  // rimuoverli è F-29, fuori scope) perché una deviceRequest migrata da
  // handleMigrateStatuses resti filtrabile/bulk-editabile in
  // AdminRequestTable.tsx e selezionabile nei dropdown "Cambia stato"
  // (RequestDetail.tsx/VolunteerRequestDetail.tsx), che leggono da questo
  // array senza fallback per i valori assenti (adversarial concern, panel
  // review close-story --auto).
  "da gestire",
  "in produzione"
];

export const REQUEST_STATUS_DESCRIPTIONS: { [key: string]: string } = {
  "inviata": "La richiesta è stata inserita dalla famiglia e validata via email.",
  "validata": "La richiesta è stata validata dall'amministratore ed è ora visibile ai volontari.",
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
  "fitting": "Test delle dimensioni e verifica dell'adattamento del device.",
  "pronta per spedizione": "Dispositivo completato.",
  "spedita": "Spedizione effettuata.",
  "followup famiglia": "Contatto post-consegna per verifica utilizzo e soddisfazione.",
  "completata": "Richiesta chiusa positivamente dopo followup.",
  "annullata": "Richiesta chiusa anticipatamente per motivi organizzativi, rinuncia famiglia o altre cause non tecniche.",
  "standby": "Richiesta in pausa temporanea, ad esempio per attesa di capire come gestirla o decisioni da parte della famiglia."
};

export const CLOSED_STATUSES = [
  "followup famiglia ko",
  "followup famiglia troppo piccolo",
  "annullata",
  "completata"
];

export const PUBLIC_STATUS_GROUPS = {
  /**
   * "da validare" non è un publicStatus Firestore: è derivato da status==="inviata".
   * Usato solo per la classificazione interna nell'AdminLayout.
   */
  "da validare": [
    "inviata"
  ],
  "da gestire": [
    "validata",
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
    "fitting",
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
    "annullata",
    "standby"
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

/**
 * Raggruppamento pubblico a 5 gruppi calcolato sugli 11 valori di `status`
 * introdotti dalla Story EA-148 (decisione opt-b di ss-device-request-macro-status).
 *
 * Sostituto display-only di PUBLIC_STATUS_GROUPS/mapInternalStatusToPublic sopra
 * (che restano invariati solo perché ancora usati da AdminMaintenanceRequests.tsx,
 * l'unico consumer non incluso nel perimetro della Story EA-150): nessun campo
 * `publicStatus` viene più persistito da EA-149, quindi qui il raggruppamento è
 * ricalcolato al volo da `status` a ogni chiamata, non letto da Firestore.
 */
export const PUBLIC_STATUS_GROUPS_FROM_STATUS: { [key: string]: string[] } = {
  "da validare": ["inviata"],
  "da gestire": ["validata", "da gestire", "attesa volontario"],
  "fabbricazione in corso": ["in produzione", "pronta per spedizione", "spedita", "followup famiglia"],
  "completati": ["completata"],
  "annullate / non completabili": ["annullata", "standby"],
};

export function getPublicStatusGroup(status: string): string {
  for (const [group, statuses] of Object.entries(PUBLIC_STATUS_GROUPS_FROM_STATUS)) {
    if (statuses.includes(status)) {
      return group;
    }
  }
  return "da gestire"; // Default se non trovato, coerente con mapInternalStatusToPublic
}

export const REQUEST_STATUS_SEVERITY: { [key: string]: "info" | "warning" | "success" | "secondary" | "contrast" | "danger" } = {
  // da validare → info
  "inviata": "info",
  // da gestire → warning
  "validata": "warning",
  "famiglia contattata": "warning",
  "definizione richiesta": "warning",
  "valutazione fattibilità": "warning",
  "attesa volontario": "warning",
  // fabbricazione in corso → secondary
  "scelta device e dimensionamento": "secondary",
  "personalizzazione": "secondary",
  "attesa materiali": "secondary",
  "fabbricazione": "secondary",
  "fitting": "secondary",
  "pronta per spedizione": "secondary",
  "spedita": "secondary",
  "followup famiglia": "secondary",
  // completati → success
  "completata": "success",
  // annullate / non completabili → danger
  "followup famiglia ko": "danger",
  "followup famiglia troppo piccolo": "danger",
  "annullata": "danger",
  "standby": "danger",
  // Story EA-152 (vedi commento su REQUEST_STATUSES sopra): severity
  // coerente col gruppo pubblico di appartenenza dei due valori generici
  // (PUBLIC_STATUS_GROUPS_FROM_STATUS: "da gestire" -> gruppo "da gestire",
  // "in produzione" -> gruppo "fabbricazione in corso").
  "da gestire": "warning",
  "in produzione": "secondary",
};

export const PUBLIC_STATUS_SEVERITY: { [key: string]: "info" | "warning" | "success" | "secondary" | "contrast" | "danger" } = {
  "da validare": "info",
  "da gestire": "warning",
  "fabbricazione in corso": "secondary",
  "completati": "success",
  "annullate / non completabili": "danger"
};

/**
 * Story EA-152: mappa dei 10 valori di `status` rimossi dal dominio (decisione
 * opt-b di `ss-device-request-macro-status`, EA-148) al valore generico
 * corrispondente. Usata solo dallo strumento di migrazione one-shot in
 * `AdminMaintenanceRequests.tsx` per riconoscere e riscrivere le deviceRequest
 * già esistenti in uno di questi 10 valori. `REQUEST_STATUSES`/
 * `REQUEST_STATUS_SEVERITY` sono stati estesi (additivamente, vedi sopra) coi
 * 2 nuovi valori generici perché la migrazione non regredisse la UI admin;
 * la RIMOZIONE dei 10 valori qui sotto da quegli stessi elenchi, e da
 * `deviceStatus` (`shared/types/deviceData.ts`), resta invece fuori scope
 * (F-29 — ancora sui 19 valori pre-riduzione).
 */
export const REMOVED_STATUS_TO_GENERIC: { [key: string]: string } = {
  "famiglia contattata": "da gestire",
  "definizione richiesta": "da gestire",
  "valutazione fattibilità": "da gestire",
  "scelta device e dimensionamento": "in produzione",
  "personalizzazione": "in produzione",
  "attesa materiali": "in produzione",
  "fabbricazione": "in produzione",
  "fitting": "in produzione",
  "followup famiglia ko": "annullata",
  "followup famiglia troppo piccolo": "annullata",
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
