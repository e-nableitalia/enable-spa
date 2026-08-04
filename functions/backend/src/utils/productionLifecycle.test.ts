import {
  PRODUCTION_LIFECYCLE_STATUSES,
  isProductionLifecycleStatus,
} from "./productionLifecycle";

describe("PRODUCTION_LIFECYCLE_STATUSES", () => {
  // Scenario 1: unica fonte di verità backend per gli 8 stati di fabbricazione
  it("exposes exactly the same 8 statuses previously duplicated in mapToPublicStatus.ts", () => {
    expect(PRODUCTION_LIFECYCLE_STATUSES).toEqual([
      "scelta device e dimensionamento",
      "personalizzazione",
      "attesa materiali",
      "fabbricazione",
      "fitting",
      "pronta per spedizione",
      "spedita",
      "followup famiglia",
    ]);
  });
});

describe("isProductionLifecycleStatus", () => {
  // Scenario 1: la fonte di verità centralizzata riconosce ciascuno degli 8 stati
  it.each(PRODUCTION_LIFECYCLE_STATUSES)("returns true for the granular status '%s'", (status) => {
    expect(isProductionLifecycleStatus(status)).toBe(true);
  });

  it("returns false for a status outside the fabbricazione group", () => {
    expect(isProductionLifecycleStatus("inviata")).toBe(false);
    expect(isProductionLifecycleStatus("completata")).toBe(false);
    expect(isProductionLifecycleStatus("annullata")).toBe(false);
  });

  it("returns false for non-string values", () => {
    expect(isProductionLifecycleStatus(undefined)).toBe(false);
    expect(isProductionLifecycleStatus(null)).toBe(false);
    expect(isProductionLifecycleStatus(42)).toBe(false);
  });
});
