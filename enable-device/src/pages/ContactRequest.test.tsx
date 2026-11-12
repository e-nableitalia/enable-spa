import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import ContactRequest from "./ContactRequest";

vi.mock("../firebase", () => ({ functions: {} }));
vi.mock("../components/layout/Footer", () => ({ default: () => null }));
vi.mock("../services/security/recaptcha", () => ({
    getRecaptchaToken: vi.fn(async () => "recaptcha-token"),
}));

const callable = vi.fn();
vi.mock("firebase/functions", () => ({
    httpsCallable: (_functions: unknown, name: string) => (data: unknown) => callable(name, data),
}));

function renderPage(path = "/contatti?src=qr") {
    return render(
        <MemoryRouter initialEntries={[path]}>
            <ContactRequest />
        </MemoryRouter>
    );
}

function fill(label: string, value: string) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

describe("ContactRequest - form pubblica /contatti", () => {
    beforeEach(() => {
        callable.mockReset();
        callable.mockResolvedValue({ data: { success: true } });
    });

    it("mostra il banner e i campi richiesti", () => {
        renderPage();
        expect(screen.getByAltText(/e-Nable Italia/)).toBeInTheDocument();
        expect(screen.getByLabelText("Nome *")).toBeInTheDocument();
        expect(screen.getByLabelText("Cognome *")).toBeInTheDocument();
        expect(screen.getByLabelText("Telefono")).toBeInTheDocument();
        expect(screen.getByLabelText("Email")).toBeInTheDocument();
        expect(screen.getByText(/Energy Family Project APS/)).toBeInTheDocument();
    });

    it("non invia senza telefono né email", async () => {
        renderPage();
        fill("Nome *", "Mario");
        fill("Cognome *", "Rossi");
        fireEvent.click(screen.getByRole("checkbox", { name: /Dichiaro/ }));
        fireEvent.click(screen.getByRole("button", { name: /Invia richiesta/ }));

        expect(await screen.findByText("Inserisci almeno un recapito: telefono o email")).toBeInTheDocument();
        expect(callable).not.toHaveBeenCalled();
    });

    it("invia i dati con source dal QR, campo trappola e token reCAPTCHA", async () => {
        renderPage();
        fill("Nome *", "Mario");
        fill("Cognome *", "Rossi");
        fill("Telefono", "+39 333 1234567");
        fill("Motivo del contatto / note", "Laboratorio a scuola");
        fireEvent.click(screen.getByRole("checkbox", { name: /Dichiaro/ }));
        fireEvent.click(screen.getByRole("button", { name: /Invia richiesta/ }));

        await waitFor(() => expect(callable).toHaveBeenCalledTimes(1));
        const [name, data] = callable.mock.calls[0];
        expect(name).toBe("createContactRequest");
        expect(data).toMatchObject({
            firstName: "Mario",
            lastName: "Rossi",
            phone: "+39 333 1234567",
            email: "",
            profile: null,
            description: "Laboratorio a scuola",
            consentPrivacy: true,
            source: "qr",
            website: "",
            recaptchaToken: "recaptcha-token",
        });
        expect(typeof data.elapsedMs).toBe("number");
        expect(await screen.findByText(/abbiamo ricevuto la tua richiesta/)).toBeInTheDocument();
    });
});
