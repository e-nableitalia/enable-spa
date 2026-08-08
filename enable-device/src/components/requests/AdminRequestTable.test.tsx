import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import AdminRequestTable from "./AdminRequestTable";

vi.mock("react-router-dom", () => ({ useNavigate: () => vi.fn() }));
vi.mock("../../firebase", () => ({ db: {}, functions: {} }));
vi.mock("firebase/firestore", () => ({
  doc: () => ({}),
  getDoc: async () => ({ exists: () => false, data: () => ({}) }),
  deleteDoc: async () => undefined,
  collection: () => ({}),
  getDocs: async () => ({ docs: [] }),
}));
vi.mock("firebase/functions", () => ({
  httpsCallable: () => async () => ({ data: {} }),
}));

describe("AdminRequestTable (EA-150) - colonna Stato Pubblico derivata da status", () => {
  it("Scenario 2: la colonna Stato Pubblico usa il raggruppamento calcolato dall'helper, non il campo publicStatus/publicStatus2 stale", async () => {
    const requests = [
      {
        id: "r1",
        status: "in produzione",
        // Campo publicStatus stale/non aggiornato: deve essere ignorato dal componente
        publicStatus: "annullate / non completabili",
        amputationType: "braccio sotto il gomito",
        createdAt: null,
        updatedAt: null,
      },
      {
        id: "r2",
        status: "annullata",
        amputationType: "braccio sotto il gomito",
        createdAt: null,
        updatedAt: null,
      },
    ];

    render(<AdminRequestTable requests={requests} />);

    const table = await screen.findByRole("table");
    expect(within(table).getByText("fabbricazione in corso")).toBeInTheDocument();
    expect(within(table).getByText("annullate / non completabili")).toBeInTheDocument();
  });
});
