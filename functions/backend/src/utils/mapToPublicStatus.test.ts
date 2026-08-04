import { mapToPublicStatus } from "./mapToPublicStatus";
import { PRODUCTION_LIFECYCLE_STATUSES } from "./productionLifecycle";

describe("mapToPublicStatus", () => {
  // Scenario (EA-102): stato 'inviata' mappato al gruppo 'da validare'
  it("maps 'inviata' to 'da validare', not 'da gestire'", () => {
    expect(mapToPublicStatus("inviata")).toBe("da validare");
    expect(mapToPublicStatus("inviata")).not.toBe("da gestire");
  });

  // Scenario: gli stati del gruppo 'da gestire' diversi da 'inviata' restano invariati (non regressione)
  it.each([
    "famiglia contattata",
    "definizione richiesta",
    "valutazione fattibilità",
    "attesa volontario",
  ])("keeps '%s' mapped to 'da gestire' (regression)", (status) => {
    expect(mapToPublicStatus(status)).toBe("da gestire");
  });

  // Scenario (EA-107): il gruppo 'fabbricazione in corso' resta invariato dopo
  // l'estrazione della lista degli 8 stati nel modulo centralizzato
  it.each(PRODUCTION_LIFECYCLE_STATUSES)(
    "keeps '%s' mapped to 'fabbricazione in corso' (regression)",
    (status) => {
      expect(mapToPublicStatus(status)).toBe("fabbricazione in corso");
    }
  );

  // Scenario: i gruppi 'completati' e 'annullate / non completabili' restano invariati (non regressione)
  it("keeps 'completata' mapped to 'completati' (regression)", () => {
    expect(mapToPublicStatus("completata")).toBe("completati");
  });

  it.each([
    "followup famiglia ko",
    "followup famiglia troppo piccolo",
    "annullata",
    "standby",
  ])("keeps '%s' mapped to 'annullate / non completabili' (regression)", (status) => {
    expect(mapToPublicStatus(status)).toBe("annullate / non completabili");
  });

  // Scenario: il fallback per stati non mappati resta invariato (non regressione)
  it("falls back to 'da gestire' for an unmapped status (regression)", () => {
    expect(mapToPublicStatus("stato-inesistente")).toBe("da gestire");
  });
});
