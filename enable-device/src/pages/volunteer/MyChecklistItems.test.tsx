import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MyChecklistItems from "./MyChecklistItems";

vi.mock("../../firebase", () => ({ db: {}, functions: {} }));

const callable = vi.fn();
vi.mock("firebase/functions", () => ({
  httpsCallable: (_functions: unknown, name: string) => (data: unknown) => callable(name, data),
}));

const mockNavigate = vi.fn();
vi.mock("react-router-dom", () => ({ useNavigate: () => mockNavigate }));

const firestoreDocs: Record<string, unknown> = {};
vi.mock("firebase/firestore", () => ({
  doc: (_db: unknown, ...segments: string[]) => ({ __path: segments.join("/") }),
  getDoc: async (ref: { __path: string }) => {
    const data = firestoreDocs[ref.__path];
    return { exists: () => data !== undefined, data: () => data };
  },
}));

describe("MyChecklistItems - elenco aggregato dei propri item di checklist (EA-154)", () => {
  beforeEach(() => {
    callable.mockReset();
    mockNavigate.mockReset();
    for (const key of Object.keys(firestoreDocs)) delete firestoreDocs[key];
  });

  // Scenario: il volontario con item assegnati vede titolo e stato di ciascun item
  it("invoca listMyChecklistItems senza parametro scope e mostra title e status di ciascun item restituito", async () => {
    callable.mockResolvedValue({
      data: {
        items: [
          { id: "item-1", checklistId: "checklist-a", title: "Stampa mano", status: "In corso" },
          { id: "item-2", checklistId: "checklist-b", title: "Verifica misure", status: "Assegnare" },
        ],
      },
    });

    render(<MyChecklistItems />);

    expect(await screen.findByText("Stampa mano")).toBeInTheDocument();
    expect(screen.getByText("Verifica misure")).toBeInTheDocument();
    expect(screen.getByText("In corso")).toBeInTheDocument();
    expect(screen.getByText("Assegnare")).toBeInTheDocument();

    expect(callable).toHaveBeenCalledWith("listMyChecklistItems", {});
    const [, requestData] = callable.mock.calls[0];
    expect(requestData).not.toHaveProperty("scope");
  });

  // Scenario: un item non completato mostra il contesto di provenienza dalla deviceRequest collegata
  it("mostra un riferimento leggibile alla richiesta di provenienza per un item non completato con origin deviceRequest", async () => {
    firestoreDocs["deviceRequests/req-1"] = { requestNumber: "REQ-000042" };
    callable.mockResolvedValue({
      data: {
        items: [
          {
            id: "item-1",
            checklistId: "checklist-a",
            title: "Stampa mano",
            status: "In corso",
            origin: { type: "deviceRequest", id: "req-1" },
          },
        ],
      },
    });

    render(<MyChecklistItems />);

    expect(await screen.findByText("Richiesta REQ-000042")).toBeInTheDocument();
  });

  // Scenario: click sul contesto di provenienza di un item non completato con origin di tipo deviceRequest naviga al dettaglio della richiesta (EA-155)
  it("naviga a /volunteer/my-requests/:id quando si clicca sul riferimento alla richiesta di provenienza", async () => {
    firestoreDocs["deviceRequests/req-1"] = { requestNumber: "REQ-000042" };
    callable.mockResolvedValue({
      data: {
        items: [
          {
            id: "item-1",
            checklistId: "checklist-a",
            title: "Stampa mano",
            status: "In corso",
            origin: { type: "deviceRequest", id: "req-1" },
          },
        ],
      },
    });

    render(<MyChecklistItems />);

    const originButton = await screen.findByRole("button", { name: "Richiesta REQ-000042" });
    await userEvent.click(originButton);

    expect(mockNavigate).toHaveBeenCalledWith("/volunteer/my-requests/req-1");
  });

  // Regressione: originBasePath e' usato da AdminLayout per riusare lo stesso
  // componente con la propria rotta di dettaglio richiesta (/admin/request/:id),
  // diversa da quella del volontario.
  it("naviga a <originBasePath>/:id quando originBasePath e' passato esplicitamente", async () => {
    firestoreDocs["deviceRequests/req-1"] = { requestNumber: "REQ-000042" };
    callable.mockResolvedValue({
      data: {
        items: [
          {
            id: "item-1",
            checklistId: "checklist-a",
            title: "Stampa mano",
            status: "In corso",
            origin: { type: "deviceRequest", id: "req-1" },
          },
        ],
      },
    });

    render(<MyChecklistItems originBasePath="/admin/request" />);

    const originButton = await screen.findByRole("button", { name: "Richiesta REQ-000042" });
    await userEvent.click(originButton);

    expect(mockNavigate).toHaveBeenCalledWith("/admin/request/req-1");
  });

  // Scenario: un item il cui origin e' null non mostra alcuna azione di navigazione (EA-155)
  it("non mostra alcuna azione di navigazione per un item con origin null", async () => {
    callable.mockResolvedValue({
      data: {
        items: [
          { id: "item-1", checklistId: "checklist-a", title: "Stampa mano", status: "In corso", origin: null },
        ],
      },
    });

    render(<MyChecklistItems />);

    expect(await screen.findByText("Stampa mano")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Richiesta/ })).not.toBeInTheDocument();
    expect(screen.getByText("-")).toBeInTheDocument();
  });

  // Scenario: un item completato (senza origin nella risposta) non mostra alcuna azione di navigazione (EA-155)
  it("non mostra alcun contesto di provenienza per un item con stato Completata (nessun campo origin)", async () => {
    callable.mockResolvedValue({
      data: {
        items: [
          { id: "item-1", checklistId: "checklist-a", title: "Stampa mano", status: "Completata" },
        ],
      },
    });

    render(<MyChecklistItems />);

    expect(await screen.findByText("Stampa mano")).toBeInTheDocument();
    expect(screen.queryByText(/Richiesta/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Richiesta/ })).not.toBeInTheDocument();
    expect(screen.getByText("-")).toBeInTheDocument();
  });

  // Scenario: il volontario senza item assegnati vede uno stato vuoto esplicativo
  it("mostra un messaggio esplicativo di assenza item, non una tabella vuota, quando non ci sono item assegnati", async () => {
    callable.mockResolvedValue({ data: { items: [] } });

    render(<MyChecklistItems />);

    expect(
      await screen.findByText("Non hai al momento nessun item di checklist assegnato.")
    ).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  // Scenario: un errore restituito dalla Cloud Function mostra un messaggio di errore al volontario
  it("mostra un messaggio di errore comprensibile quando la chiamata a listMyChecklistItems fallisce", async () => {
    callable.mockRejectedValue(new Error("internal"));

    render(<MyChecklistItems />);

    expect(await screen.findByText("internal")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});
