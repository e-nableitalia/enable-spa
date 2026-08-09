import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import MyChecklistItems from "./MyChecklistItems";

vi.mock("../../firebase", () => ({ db: {}, functions: {} }));

const callable = vi.fn();
vi.mock("firebase/functions", () => ({
  httpsCallable: (_functions: unknown, name: string) => (data: unknown) => callable(name, data),
}));

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

  // Scenario: un item completato non mostra alcun contesto di provenienza
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
