import { HttpsError } from "firebase-functions/v2/https";
import { isAllowedVolunteerTransition, assertVolunteerTransitionAllowed } from "./volunteerTransitions";

describe("isAllowedVolunteerTransition", () => {
  // Scenario 2: le 5 transizioni consentite ai volontari
  it.each([
    ["scelta device e dimensionamento", "personalizzazione"],
    ["personalizzazione", "attesa materiali"],
    ["attesa materiali", "fabbricazione"],
    ["fabbricazione", "pronta per spedizione"],
    ["pronta per spedizione", "spedita"],
  ])("returns true for the allowed transition '%s' -> '%s'", (from, to) => {
    expect(isAllowedVolunteerTransition(from, to)).toBe(true);
  });

  // Scenario 3: coppia (from, to) non tra le 5 consentite
  it("returns false for a transition not among the 5 allowed", () => {
    expect(isAllowedVolunteerTransition("scelta device e dimensionamento", "spedita")).toBe(false);
    expect(isAllowedVolunteerTransition("spedita", "personalizzazione")).toBe(false);
  });
});

describe("assertVolunteerTransitionAllowed", () => {
  // Scenario 1: admin puo' eseguire qualsiasi transizione, nessun controllo aggiuntivo
  it("does not throw for admin regardless of assignedVolunteers or transition", () => {
    expect(() =>
      assertVolunteerTransitionAllowed("admin", "admin-1", [], "spedita", "scelta device e dimensionamento")
    ).not.toThrow();
  });

  // Scenario 2: volontario assegnato e transizione tra le 5 consentite
  it("does not throw for an assigned volunteer performing an allowed transition", () => {
    expect(() =>
      assertVolunteerTransitionAllowed(
        "volunteer",
        "volunteer-1",
        ["volunteer-1"],
        "scelta device e dimensionamento",
        "personalizzazione"
      )
    ).not.toThrow();
  });

  // Scenario 3: volontario assegnato ma transizione non tra le 5 consentite
  it("throws permission-denied 'Invalid status transition' for an assigned volunteer with a disallowed transition", () => {
    expect(() =>
      assertVolunteerTransitionAllowed(
        "volunteer",
        "volunteer-1",
        ["volunteer-1"],
        "scelta device e dimensionamento",
        "spedita"
      )
    ).toThrow(new HttpsError("permission-denied", "Invalid status transition"));
  });

  // Scenario 4: volontario non assegnato, rifiutato indipendentemente dalla transizione
  it("throws permission-denied 'Not assigned volunteer' for a volunteer not in assignedVolunteers", () => {
    expect(() =>
      assertVolunteerTransitionAllowed(
        "volunteer",
        "volunteer-2",
        ["volunteer-1"],
        "scelta device e dimensionamento",
        "personalizzazione"
      )
    ).toThrow(new HttpsError("permission-denied", "Not assigned volunteer"));
  });

  it("throws permission-denied 'Not assigned volunteer' when assignedVolunteers is undefined", () => {
    expect(() =>
      assertVolunteerTransitionAllowed(
        "volunteer",
        "volunteer-1",
        undefined,
        "scelta device e dimensionamento",
        "personalizzazione"
      )
    ).toThrow(new HttpsError("permission-denied", "Not assigned volunteer"));
  });

  it("throws permission-denied 'Invalid role' for any other role", () => {
    expect(() =>
      assertVolunteerTransitionAllowed(
        "organizer",
        "user-1",
        [],
        "scelta device e dimensionamento",
        "personalizzazione"
      )
    ).toThrow(new HttpsError("permission-denied", "Invalid role"));
  });

  it("throws permission-denied 'Invalid role' for undefined role", () => {
    expect(() =>
      assertVolunteerTransitionAllowed(undefined, "user-1", [], "scelta device e dimensionamento", "personalizzazione")
    ).toThrow(new HttpsError("permission-denied", "Invalid role"));
  });
});
