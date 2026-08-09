import { describe, it, expect } from "vitest";
import {
  getPublicStatusGroup,
  PUBLIC_STATUS_GROUPS_FROM_STATUS,
  REMOVED_STATUS_TO_GENERIC,
  REQUEST_STATUSES,
  REQUEST_STATUS_SEVERITY,
} from "./requestStatus";

describe("getPublicStatusGroup (EA-150) - raggruppamento display-only dagli 11 valori di status", () => {
  it("classifica ognuno degli 11 valori di status nel gruppo pubblico atteso", () => {
    expect(getPublicStatusGroup("inviata")).toBe("da validare");

    expect(getPublicStatusGroup("validata")).toBe("da gestire");
    expect(getPublicStatusGroup("da gestire")).toBe("da gestire");
    expect(getPublicStatusGroup("attesa volontario")).toBe("da gestire");

    expect(getPublicStatusGroup("in produzione")).toBe("fabbricazione in corso");
    expect(getPublicStatusGroup("pronta per spedizione")).toBe("fabbricazione in corso");
    expect(getPublicStatusGroup("spedita")).toBe("fabbricazione in corso");
    expect(getPublicStatusGroup("followup famiglia")).toBe("fabbricazione in corso");

    expect(getPublicStatusGroup("completata")).toBe("completati");

    expect(getPublicStatusGroup("annullata")).toBe("annullate / non completabili");
    expect(getPublicStatusGroup("standby")).toBe("annullate / non completabili");
  });

  it("ricade su 'da gestire' per un valore di status sconosciuto/non più in dominio", () => {
    expect(getPublicStatusGroup("famiglia contattata")).toBe("da gestire");
    expect(getPublicStatusGroup("")).toBe("da gestire");
  });

  it("copre esattamente gli 11 valori del dominio ridotto, senza duplicati tra i 5 gruppi", () => {
    const allStatuses = Object.values(PUBLIC_STATUS_GROUPS_FROM_STATUS).flat();
    expect(allStatuses).toHaveLength(11);
    expect(new Set(allStatuses).size).toBe(11);
    expect(Object.keys(PUBLIC_STATUS_GROUPS_FROM_STATUS)).toHaveLength(5);
  });
});

describe("REMOVED_STATUS_TO_GENERIC (EA-152) - mappa dei 10 stati rimossi ai 3 generici", () => {
  it("mappa i 3 stati di triage rimossi a 'da gestire'", () => {
    expect(REMOVED_STATUS_TO_GENERIC["famiglia contattata"]).toBe("da gestire");
    expect(REMOVED_STATUS_TO_GENERIC["definizione richiesta"]).toBe("da gestire");
    expect(REMOVED_STATUS_TO_GENERIC["valutazione fattibilità"]).toBe("da gestire");
  });

  it("mappa i 5 stati di produzione pre-spedizione rimossi a 'in produzione'", () => {
    expect(REMOVED_STATUS_TO_GENERIC["scelta device e dimensionamento"]).toBe("in produzione");
    expect(REMOVED_STATUS_TO_GENERIC["personalizzazione"]).toBe("in produzione");
    expect(REMOVED_STATUS_TO_GENERIC["attesa materiali"]).toBe("in produzione");
    expect(REMOVED_STATUS_TO_GENERIC["fabbricazione"]).toBe("in produzione");
    expect(REMOVED_STATUS_TO_GENERIC["fitting"]).toBe("in produzione");
  });

  it("mappa i 2 stati di cancellazione specifica rimossi a 'annullata'", () => {
    expect(REMOVED_STATUS_TO_GENERIC["followup famiglia ko"]).toBe("annullata");
    expect(REMOVED_STATUS_TO_GENERIC["followup famiglia troppo piccolo"]).toBe("annullata");
  });

  it("contiene esattamente 10 voci, nessuna in più", () => {
    expect(Object.keys(REMOVED_STATUS_TO_GENERIC)).toHaveLength(10);
  });
});

// Regressione (adversarial concern, panel review EA-152): dopo la migrazione
// one-shot una deviceRequest può avere status "da gestire"/"in produzione" —
// senza queste due voci, AdminRequestTable.tsx (Tag senza fallback, filtro,
// "Bulk Change") e i dropdown "Cambia stato" perderebbero la riga migrata.
describe("REQUEST_STATUSES / REQUEST_STATUS_SEVERITY (EA-152) - i 2 valori generici restano selezionabili/visualizzabili dopo la migrazione", () => {
  it("REQUEST_STATUSES include 'da gestire' e 'in produzione'", () => {
    expect(REQUEST_STATUSES).toContain("da gestire");
    expect(REQUEST_STATUSES).toContain("in produzione");
  });

  it("REQUEST_STATUS_SEVERITY ha una severity per entrambi, coerente col gruppo pubblico di appartenenza", () => {
    expect(REQUEST_STATUS_SEVERITY["da gestire"]).toBe("warning");
    expect(REQUEST_STATUS_SEVERITY["in produzione"]).toBe("secondary");
  });

  it("ogni valore di REQUEST_STATUSES ha una severity definita (nessun Tag senza colorazione)", () => {
    for (const status of REQUEST_STATUSES) {
      expect(REQUEST_STATUS_SEVERITY[status]).toBeDefined();
    }
  });

  // Regressione (F-29, risolto): dopo aver confermato la migrazione eseguita
  // sull'ambiente, i 10 valori rimossi da EA-148 non devono più comparire nei
  // dropdown "Cambia stato"/filtri/bulk-edit che leggono da REQUEST_STATUSES.
  it("REQUEST_STATUSES contiene esattamente gli 11 valori del dominio ridotto, nessuno dei 10 rimossi", () => {
    expect(REQUEST_STATUSES).toHaveLength(11);
    for (const removed of Object.keys(REMOVED_STATUS_TO_GENERIC)) {
      expect(REQUEST_STATUSES).not.toContain(removed);
    }
  });
});
