// ========================================
// DEVICE TYPES (devicetype)
// Valori standard del modello open-source di dispositivo prostetico,
// assegnato dall'admin in validazione (vedi RequestDetail.tsx). Elenco
// duplicato qui intenzionalmente: RequestDetail.tsx gestisce il devicetype
// della singola deviceRequest, questo modulo il catalogo dei template di
// checklist per tipo device (dominio distinto, vedi EA-109).
// ========================================

export const DEVICE_TYPE_OPTIONS: string[] = [
  "Kinetic Hand",
  "Kinetic Arm",
  "Bike Adapter",
  "Guitar Pick",
  "Kwawu Arm",
  "Device Batteria",
  "Kwawu Gripper",
  "Phoenix Hand",
];

// Valore sentinella usato in UI per selezionare l'opzione "Altro" (testo
// libero). Non viene mai salvato come categoria: la categoria salvata è il
// testo libero inserito dall'utente.
export const OTHER_DEVICE_TYPE_OPTION = "__altro__";
