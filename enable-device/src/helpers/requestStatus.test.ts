import { describe, it, expect } from "vitest";
import { getPublicStatusGroup, PUBLIC_STATUS_GROUPS_FROM_STATUS } from "./requestStatus";

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
