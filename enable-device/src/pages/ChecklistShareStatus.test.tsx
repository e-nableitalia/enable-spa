import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import ChecklistShareStatus from "./ChecklistShareStatus";

vi.mock("../firebase", () => ({ functions: {} }));

const callable = vi.fn();
vi.mock("firebase/functions", () => ({
  httpsCallable: (_functions: unknown, name: string) => (data: unknown) => callable(name, data),
}));

let mockToken: string | undefined = "share-token-1";
vi.mock("react-router-dom", () => ({ useParams: () => ({ token: mockToken }) }));

describe("ChecklistShareStatus - pagina pubblica di avanzamento checklist condivisa via link", () => {
  beforeEach(() => {
    callable.mockReset();
    mockToken = "share-token-1";
  });

  // Scenario: la pagina mostra la percentuale di avanzamento e l'elenco item, con solo titolo e stato semplificato
  it("mostra percentComplete e l'elenco item con titolo e flag di completamento, senza altro dettaglio", async () => {
    callable.mockResolvedValue({
      data: {
        percentComplete: 50,
        requestNumber: "REQ-000137",
        items: [
          { title: "Stampa mano", completed: true },
          { title: "Verifica misure", completed: false },
        ],
      },
    });

    render(<ChecklistShareStatus />);

    expect(callable).toHaveBeenCalledWith("getChecklistShareStatus", { token: "share-token-1" });
    expect(await screen.findByText("50%")).toBeInTheDocument();

    const item1 = (await screen.findByText("Stampa mano")).closest("li");
    if (!item1) throw new Error("Item 'Stampa mano' non trovato");
    expect(within(item1).getByText("Stampa mano")).toBeInTheDocument();
    expect(item1.querySelector(".pi-check-circle")).toBeInTheDocument();

    const item2 = (await screen.findByText("Verifica misure")).closest("li");
    if (!item2) throw new Error("Item 'Verifica misure' non trovato");
    expect(item2.querySelector(".pi-circle")).toBeInTheDocument();
    expect(item2.querySelector(".pi-check-circle")).not.toBeInTheDocument();
  });

  // Regressione (bug segnalato dall'operatore): il titolo era generico
  // "Avanzamento checklist di fabbricazione" — ora generico "Stato di
  // avanzamento della richiesta" (nessun riferimento a "fabbricazione",
  // troppo tecnico per una famiglia) con l'id richiesta se risolvibile.
  it("il titolo include il requestNumber quando risolvibile", async () => {
    callable.mockResolvedValue({
      data: { percentComplete: 50, requestNumber: "REQ-000137", items: [] },
    });

    render(<ChecklistShareStatus />);

    expect(await screen.findByText("Stato di avanzamento della richiesta - REQ-000137")).toBeInTheDocument();
    expect(screen.queryByText(/fabbricazione/i)).not.toBeInTheDocument();
  });

  it("il titolo resta generico, senza id, quando requestNumber è null", async () => {
    callable.mockResolvedValue({
      data: { percentComplete: 50, requestNumber: null, items: [] },
    });

    render(<ChecklistShareStatus />);

    expect(await screen.findByText("Stato di avanzamento della richiesta")).toBeInTheDocument();
  });

  it("il testo descrittivo è esaustivo per le famiglie, non generico", async () => {
    callable.mockResolvedValue({
      data: { percentComplete: 50, requestNumber: null, items: [] },
    });

    render(<ChecklistShareStatus />);

    expect(
      await screen.findByText(/quali attività il team di volontari ha già completato/)
    ).toBeInTheDocument();
  });

  // Scenario: nessuna colonna Quantità o altro dettaglio di tipo, rappresentazione omogenea per i tre type
  it("non mostra alcun dettaglio oltre a titolo e flag di completamento (nessuna quantità, nessuno status grezzo)", async () => {
    callable.mockResolvedValue({
      data: {
        percentComplete: 100,
        items: [{ title: "Item numerico", completed: true }],
      },
    });

    render(<ChecklistShareStatus />);

    const item = (await screen.findByText("Item numerico")).closest("li");
    if (!item) throw new Error("Item non trovato");
    expect(item).not.toHaveTextContent(/\d+\s*(pz|pezzi)/i);
    expect(screen.queryByText(/Assegnare|In corso|Da iniziare/)).not.toBeInTheDocument();
  });

  // Scenario: una checklist senza item non mostra alcun elenco
  it("non mostra alcun elenco quando items è vuoto", async () => {
    callable.mockResolvedValue({ data: { percentComplete: 100, items: [] } });

    render(<ChecklistShareStatus />);

    await screen.findByText("100%");
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  // Scenario: un token mancante mostra un errore senza invocare la Cloud Function
  it("mostra un errore e non invoca la Cloud Function quando il token è assente", async () => {
    mockToken = undefined;

    render(<ChecklistShareStatus />);

    expect(await screen.findByText("Link non valido.")).toBeInTheDocument();
    expect(callable).not.toHaveBeenCalled();
  });

  // Scenario: un errore della Cloud Function mostra un messaggio comprensibile
  it("mostra un messaggio di errore quando la Cloud Function fallisce", async () => {
    callable.mockRejectedValue(new Error("Share link not found"));

    render(<ChecklistShareStatus />);

    expect(await screen.findByText("Share link not found")).toBeInTheDocument();
  });
});
