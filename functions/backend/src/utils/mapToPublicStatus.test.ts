import {mapToPublicStatus} from "./mapToPublicStatus";
import {PRODUCTION_LIFECYCLE_STATUSES} from "./productionLifecycle";

describe("mapToPublicStatus", () => {
  // Scenario 1 + 3 (regression): il mapping verso "fabbricazione in corso" resta
  // invariato dopo l'estrazione della lista degli 8 stati nel modulo centralizzato
  it.each(PRODUCTION_LIFECYCLE_STATUSES)("maps the granular status '%s' to 'fabbricazione in corso'", (status) => {
    expect(mapToPublicStatus(status)).toBe("fabbricazione in corso");
  });

  // Regression: gli altri macro-gruppi pre-esistenti non sono stati toccati dal refactoring
  it.each([
    "inviata",
    "famiglia contattata",
    "definizione richiesta",
    "valutazione fattibilità",
    "attesa volontario",
  ])("maps the pre-existing status '%s' to 'da gestire' (bug inviata->da gestire preserved as-is, out of scope)", (status) => {
    expect(mapToPublicStatus(status)).toBe("da gestire");
  });

  it("maps 'completata' to 'completati'", () => {
    expect(mapToPublicStatus("completata")).toBe("completati");
  });

  it.each([
    "followup famiglia ko",
    "followup famiglia troppo piccolo",
    "annullata",
    "standby",
  ])("maps the pre-existing status '%s' to 'annullate / non completabili'", (status) => {
    expect(mapToPublicStatus(status)).toBe("annullate / non completabili");
  });

  it("falls back to 'da gestire' for an unrecognized status", () => {
    expect(mapToPublicStatus("stato-inesistente")).toBe("da gestire");
  });
});
