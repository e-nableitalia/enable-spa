import {
  PRODUCTION_LIFECYCLE_STATUSES,
  isProductionLifecycleStatus,
} from "./productionLifecycle";

describe("PRODUCTION_LIFECYCLE_STATUSES", () => {
  // Scenario (EA-148): riduzione da 8 a 4 stati dopo il collasso dei 5 stati
  // di produzione pre-spedizione nell'unico valore 'in produzione'
  it("exposes exactly the 4 statuses after the EA-148 collapse", () => {
    expect(PRODUCTION_LIFECYCLE_STATUSES).toEqual([
      "in produzione",
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
