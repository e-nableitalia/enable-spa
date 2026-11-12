import { describe, it, expect } from "vitest";
import {
    contactOrigin,
    contactsNeedingInviteConfirmation,
    readContactSource,
    validateContactForm,
    type ContactFormValues,
} from "./contactProfiles";

const valid: ContactFormValues = {
    firstName: "Mario",
    lastName: "Rossi",
    phone: "",
    email: "mario@example.com",
    profile: "",
    profileOther: "",
    description: "",
    consentPrivacy: true,
};

describe("validateContactForm", () => {
    it("accetta nome, cognome, un solo recapito e consenso", () => {
        expect(validateContactForm(valid)).toBeNull();
        expect(validateContactForm({ ...valid, email: "", phone: "+39 333 1234567" })).toBeNull();
    });

    it("richiede nome e cognome", () => {
        expect(validateContactForm({ ...valid, lastName: "  " })).toMatch(/nome e cognome/);
    });

    it("richiede almeno telefono o email", () => {
        expect(validateContactForm({ ...valid, email: "", phone: "" })).toMatch(/telefono o email/);
    });

    it("rifiuta email e telefono malformati", () => {
        expect(validateContactForm({ ...valid, email: "mario@" })).toMatch(/email/);
        expect(validateContactForm({ ...valid, email: "", phone: "abc" })).toMatch(/telefono/);
    });

    it("richiede il consenso privacy", () => {
        expect(validateContactForm({ ...valid, consentPrivacy: false })).toMatch(/privacy/);
    });
});

describe("readContactSource", () => {
    it("legge ?src= solo se ben formato", () => {
        expect(readContactSource("?src=qr")).toBe("qr");
        expect(readContactSource("?src=fiera-2026")).toBe("fiera-2026");
        expect(readContactSource("?src=<script>")).toBeNull();
        expect(readContactSource("")).toBeNull();
    });
});

describe("contactOrigin / contactsNeedingInviteConfirmation", () => {
    it("i contatti senza origin valgono come import CSV", () => {
        expect(contactOrigin({})).toBe("csv-import");
        expect(contactOrigin({ origin: "contact-form" })).toBe("contact-form");
    });

    it("chiede conferma solo per i contatti dalla form con profilo non da volontario", () => {
        const contacts = [
            { id: "a" },
            { id: "b", origin: "contact-form", profile: "maker" },
            { id: "c", origin: "contact-form", profile: "docente_scuola" },
            { id: "d", origin: "contact-form" },
        ];
        expect(contactsNeedingInviteConfirmation(contacts).map((c) => c.id)).toEqual(["c", "d"]);
    });
});
