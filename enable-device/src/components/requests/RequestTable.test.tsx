import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import RequestTable from "./RequestTable";

describe("RequestTable (EA-150) - colonna Stato Pubblico derivata da status", () => {
  it("Scenario 2: il filtro/colonna 'Stato Pubblico' usa il raggruppamento calcolato dall'helper, non il campo publicStatus stale", async () => {
    const requests = [
      {
        id: "r1",
        status: "in produzione",
        // Campo publicStatus stale/non aggiornato: deve essere ignorato dal componente
        publicStatus: "annullate / non completabili",
      },
      {
        id: "r2",
        status: "completata",
      },
    ];

    render(<RequestTable requests={requests} onOpen={() => {}} sessionKey="test_requestTable" />);

    const table = await screen.findByRole("table");
    expect(within(table).getByText("fabbricazione in corso")).toBeInTheDocument();
    expect(within(table).getByText("completati")).toBeInTheDocument();
    expect(within(table).queryByText("annullate / non completabili")).not.toBeInTheDocument();
  });
});
