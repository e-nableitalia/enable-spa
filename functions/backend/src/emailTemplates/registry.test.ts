import { EMAIL_TEMPLATE_IDS, EMAIL_TEMPLATES } from "./registry";

describe("emailTemplates registry", () => {
  it("resolves the same template.name values the 5 senders wrote before the migration to the registry", () => {
    // Comportamento runtime invariato (EA-172): questi sono i valori
    // letterali che ciascun sender scriveva prima di importare l'id dal
    // registro — un cambiamento qui altererebbe silenziosamente quale
    // template dell'estensione Trigger Email viene risolto in produzione.
    expect(EMAIL_TEMPLATE_IDS).toEqual({
      volunteerActivation: "attivazioneVolontario",
      deviceRequestConfirmation: "confermaRicezione",
      volunteerInvite: "inviteVolunteer",
      shipmentRequest: "shipmentRequest",
      deviceRequestDocumentsTransmission: "device-request-documents-transmission",
    });
  });

  it("provides subject and html content for all 5 known template ids", () => {
    for (const id of Object.values(EMAIL_TEMPLATE_IDS)) {
      expect(EMAIL_TEMPLATES[id]).toBeDefined();
      expect(typeof EMAIL_TEMPLATES[id].subject).toBe("string");
      expect(EMAIL_TEMPLATES[id].subject.length).toBeGreaterThan(0);
      expect(typeof EMAIL_TEMPLATES[id].html).toBe("string");
      expect(EMAIL_TEMPLATES[id].html.length).toBeGreaterThan(0);
    }
  });

  it("has exactly 5 entries, no more no less", () => {
    expect(Object.keys(EMAIL_TEMPLATES)).toHaveLength(5);
  });
});
