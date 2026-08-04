import {
  PRODUCTION_LIFECYCLE_STATUSES,
  isProductionLifecycleStatus,
  isAllowedVolunteerTransition,
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

describe("isAllowedVolunteerTransition", () => {
  // Scenario 2: le 5 transizioni volontario esistenti restano identiche dopo l'estrazione
  const allowedTransitions: Array<[string, string]> = [
    ["scelta device e dimensionamento", "personalizzazione"],
    ["personalizzazione", "attesa materiali"],
    ["attesa materiali", "fabbricazione"],
    ["fabbricazione", "pronta per spedizione"],
    ["pronta per spedizione", "spedita"],
  ];

  it.each(allowedTransitions)("allows the existing volunteer transition '%s' -> '%s'", (from, to) => {
    expect(isAllowedVolunteerTransition(from, to)).toBe(true);
  });

  // Scenario 3: nessuna nuova transizione viene introdotta da questa Story
  it("rejects a reversed (backward) transition", () => {
    expect(isAllowedVolunteerTransition("personalizzazione", "scelta device e dimensionamento")).toBe(false);
  });

  it("rejects a transition that skips a step", () => {
    expect(isAllowedVolunteerTransition("scelta device e dimensionamento", "attesa materiali")).toBe(false);
  });

  it("rejects transitions involving 'fitting' or 'followup famiglia', which are not part of the 5 volunteer transitions", () => {
    expect(isAllowedVolunteerTransition("spedita", "fitting")).toBe(false);
    expect(isAllowedVolunteerTransition("fitting", "followup famiglia")).toBe(false);
  });

  it("rejects a transition from a status outside the fabbricazione group", () => {
    expect(isAllowedVolunteerTransition("inviata", "personalizzazione")).toBe(false);
  });
});
