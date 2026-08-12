// I 10 valori rimossi da EA-148 (3 di triage + 5 di produzione pre-spedizione
// + 2 di cancellazione specifica) sono stati tolti da qui: dopo che la
// migrazione one-shot (handleMigrateStatuses, EA-152) è stata eseguita
// sull'ambiente, nessuna deviceRequest reale li usa più — restano solo come
// chiavi sorgente di REMOVED_STATUS_TO_GENERIC sotto, che lo strumento di
// migrazione continua a leggere per riconoscerli sui dati storici non ancora
// migrati. Dominio finale a 11 valori (F-29, risolto).
export const REQUEST_STATUSES = [
  "inviata",
  "validata",
  "da gestire",
  "attesa volontario",
  "in produzione",
  "pronta per spedizione",
  "spedita",
  "followup famiglia",
  "completata",
  "annullata",
  "standby"
];

export const REQUEST_STATUS_DESCRIPTIONS: { [key: string]: string } = {
  "inviata": "La richiesta è stata inserita dalla famiglia e validata via email.",
  "validata": "La richiesta è stata validata dall'amministratore ed è ora visibile ai volontari.",
  "da gestire": "Fase di triage: raccolta informazioni, definizione della richiesta e valutazione di fattibilità.",
  "attesa volontario": "Richiesta pronta per assegnazione.",
  "in produzione": "Scelta del device, personalizzazione, attesa materiali, fabbricazione e fitting.",
  "pronta per spedizione": "Dispositivo completato.",
  "spedita": "Spedizione effettuata.",
  "followup famiglia": "Contatto post-consegna per verifica utilizzo e soddisfazione.",
  "completata": "Richiesta chiusa positivamente dopo followup.",
  "annullata": "Richiesta chiusa anticipatamente per motivi organizzativi, rinuncia famiglia, esito tecnico negativo o altre cause non tecniche.",
  "standby": "Richiesta in pausa temporanea, ad esempio per attesa di capire come gestirla o decisioni da parte della famiglia."
};

export const CLOSED_STATUSES = [
  "annullata",
  "completata"
];

/**
 * Raggruppamento pubblico a 5 gruppi calcolato sugli 11 valori di `status`
 * introdotti dalla Story EA-148 (decisione opt-b di ss-device-request-macro-status).
 *
 * Sostituisce il precedente `PUBLIC_STATUS_GROUPS`/`mapInternalStatusToPublic`
 * (dominio a 19 valori, rimossi da F-31 — `AdminMaintenanceRequests.tsx` era
 * l'ultimo consumer residuo): nessun campo `publicStatus` viene più
 * persistito da EA-149, quindi qui il raggruppamento è ricalcolato al volo
 * da `status` a ogni chiamata, non letto da Firestore.
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
  "da gestire": "warning",
  "attesa volontario": "warning",
  // fabbricazione in corso → secondary
  "in produzione": "secondary",
  "pronta per spedizione": "secondary",
  "spedita": "secondary",
  "followup famiglia": "secondary",
  // completati → success
  "completata": "success",
  // annullate / non completabili → danger
  "annullata": "danger",
  "standby": "danger",
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
 * già esistenti in uno di questi 10 valori. Resta qui anche dopo la potatura
 * di `REQUEST_STATUSES`/`REQUEST_STATUS_SEVERITY` (F-29, risolto): lo
 * strumento di migrazione deve poter riconoscere i 10 valori storici su
 * qualunque ambiente su cui non sia ancora stato eseguito, anche se non sono
 * più nel dominio "valido" corrente.
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
