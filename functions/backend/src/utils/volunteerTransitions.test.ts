import { HttpsError } from "firebase-functions/v2/https";
import { isAllowedVolunteerTransition, assertVolunteerTransitionAllowed } from "./volunteerTransitions";

describe("isAllowedVolunteerTransition", () => {
  // Scenario 4 (EA-148): le 2 transizioni consentite ai volontari dopo la
  // riduzione dalle precedenti 5 coppie
  it.each([
    ["in produzione", "pronta per spedizione"],
    ["pronta per spedizione", "spedita"],
  ])("returns true for the allowed transition '%s' -> '%s'", (from, to) => {
    expect(isAllowedVolunteerTransition(from, to)).toBe(true);
  });

  // Scenario 5 (EA-148): coppia (from, to) non tra le 2 consentite
  it("returns false for a transition not among the 2 allowed", () => {
    expect(isAllowedVolunteerTransition("da gestire", "in produzione")).toBe(false);
    expect(isAllowedVolunteerTransition("spedita", "in produzione")).toBe(false);
  });

  // Regression: le vecchie coppie granulari (rimosse dal dominio da EA-148)
  // non sono più riconosciute come transizioni consentite
  it("returns false for the pre-EA-148 granular pairs, now removed from the domain", () => {
    expect(isAllowedVolunteerTransition("scelta device e dimensionamento", "personalizzazione")).toBe(false);
    expect(isAllowedVolunteerTransition("fabbricazione", "pronta per spedizione")).toBe(false);
  });
});

describe("assertVolunteerTransitionAllowed", () => {
  // Scenario 1: admin puo' eseguire qualsiasi transizione, nessun controllo aggiuntivo
  it("does not throw for admin regardless of assignedVolunteers or transition", () => {
    expect(() =>
      assertVolunteerTransitionAllowed("admin", "admin-1", [], "spedita", "da gestire")
    ).not.toThrow();
  });

  // Scenario 4 (EA-148): volontario assegnato e transizione tra le 2 consentite
  it("does not throw for an assigned volunteer performing an allowed transition", () => {
    expect(() =>
      assertVolunteerTransitionAllowed(
        "volunteer",
        "volunteer-1",
        ["volunteer-1"],
        "in produzione",
        "pronta per spedizione"
      )
    ).not.toThrow();
  });

  // Scenario 5 (EA-148): volontario assegnato ma transizione non tra le 2 consentite
  it("throws permission-denied 'Invalid status transition' for an assigned volunteer with a disallowed transition", () => {
    expect(() =>
      assertVolunteerTransitionAllowed(
        "volunteer",
        "volunteer-1",
        ["volunteer-1"],
        "da gestire",
        "in produzione"
      )
    ).toThrow(new HttpsError("permission-denied", "Invalid status transition"));
  });

  // Scenario: volontario non assegnato, rifiutato indipendentemente dalla transizione
  it("throws permission-denied 'Not assigned volunteer' for a volunteer not in assignedVolunteers", () => {
    expect(() =>
      assertVolunteerTransitionAllowed(
        "volunteer",
        "volunteer-2",
        ["volunteer-1"],
        "in produzione",
        "pronta per spedizione"
      )
    ).toThrow(new HttpsError("permission-denied", "Not assigned volunteer"));
  });

  it("throws permission-denied 'Not assigned volunteer' when assignedVolunteers is undefined", () => {
    expect(() =>
      assertVolunteerTransitionAllowed(
        "volunteer",
        "volunteer-1",
        undefined,
        "in produzione",
        "pronta per spedizione"
      )
    ).toThrow(new HttpsError("permission-denied", "Not assigned volunteer"));
  });

  it("throws permission-denied 'Invalid role' for any other role", () => {
    expect(() =>
      assertVolunteerTransitionAllowed(
        "organizer",
        "user-1",
        [],
        "in produzione",
        "pronta per spedizione"
      )
    ).toThrow(new HttpsError("permission-denied", "Invalid role"));
  });

  it("throws permission-denied 'Invalid role' for undefined role", () => {
    expect(() =>
      assertVolunteerTransitionAllowed(undefined, "user-1", [], "in produzione", "pronta per spedizione")
    ).toThrow(new HttpsError("permission-denied", "Invalid role"));
  });
});
