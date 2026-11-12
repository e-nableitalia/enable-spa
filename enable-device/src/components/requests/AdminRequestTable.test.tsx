import { describe, it, expect, vi } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import { beforeEach } from "vitest";
import AdminRequestTable from "./AdminRequestTable";

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => vi.fn(),
    useLocation: () => ({ pathname: "/admin/requests", search: "", hash: "", state: null, key: "test" }),
  };
});
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

beforeEach(() => sessionStorage.clear());

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

describe("AdminRequestTable - filtri base, estesi e reset", () => {
  const requests = [
    { id: "r1", seqId: "A1", firstName: "Mario", lastName: "Rossi", status: "in produzione", amputationType: "mano", province: "MI", createdAt: null, updatedAt: null },
    { id: "r2", seqId: "B2", firstName: "Anna", lastName: "Verdi", status: "annullata", amputationType: "mano", province: "RM", createdAt: null, updatedAt: null },
  ];

  it("mostra sempre i filtri base e filtra la lista per nome", async () => {
    render(<AdminRequestTable requests={requests} compact />);
    expect(screen.getByLabelText("ID")).toBeInTheDocument();
    expect(screen.getByLabelText("Nome")).toBeInTheDocument();
    expect(screen.getByLabelText("Cognome")).toBeInTheDocument();

    const table = await screen.findByRole("table");
    expect(within(table).getByText("Mario")).toBeInTheDocument();
    expect(within(table).getByText("Anna")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "mar" } });
    expect(within(table).getByText("Mario")).toBeInTheDocument();
    expect(within(table).queryByText("Anna")).not.toBeInTheDocument();
  });

  it("segnala i filtri estesi attivi a pannello chiuso e il reset li azzera", async () => {
    render(<AdminRequestTable requests={requests} />);
    expect(screen.queryByTestId("extended-filters-active")).not.toBeInTheDocument();

    // il pannello è collassato: il filtro esteso è montato ma non visibile; lo imposto via storage persistito
    fireEvent.click(screen.getByText("Filtri estesi"));
    fireEvent.change(screen.getByLabelText("Provincia"), { target: { value: "RM" } });

    expect(screen.getByTestId("extended-filters-active")).toHaveTextContent("1 attivo");
    const table = await screen.findByRole("table");
    expect(within(table).queryByText("Mario")).not.toBeInTheDocument();
    expect(within(table).getByText("Anna")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Azzera filtri/ }));
    expect(screen.queryByTestId("extended-filters-active")).not.toBeInTheDocument();
    expect(within(table).getByText("Mario")).toBeInTheDocument();
  });

  it("i filtri restano al rimontaggio (cambio vista) e il selettore colonne funziona anche in compact", async () => {
    const first = render(<AdminRequestTable requests={requests} compact />);
    fireEvent.change(screen.getByLabelText("Cognome"), { target: { value: "verdi" } });
    first.unmount();

    render(<AdminRequestTable requests={requests} compact />);
    expect(screen.getByLabelText("Cognome")).toHaveValue("verdi");
    expect(screen.getAllByLabelText("Colonne visibili").length).toBeGreaterThan(0);
  });
});
