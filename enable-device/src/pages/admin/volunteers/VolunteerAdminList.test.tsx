import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import VolunteerAdminList from "./VolunteerAdminList";
import type { VolunteerAdminRow } from "./volunteerAdminHelpers";

// Fixture minimale: solo i campi letti da VolunteerAdminList, il resto della
// forma reale di VolunteerAdminRow (printer/skills/raw) non è rilevante qui.
const row = {
  uid: "vol-1",
  firstName: "Mario",
  lastName: "Rossi",
  email: "mario.rossi@example.com",
  city: "Roma",
  region: "Lazio",
  availability: "Weekend",
  continuityType: "Continuativo",
  desiredInvolvementLevel: "Alto",
  mainInterest: ["Stampa 3D"],
  hasActivePrinter: true,
  role: "volunteer",
  active: true,
} as unknown as VolunteerAdminRow;

// Regressione (bug segnalato dall'operatore): il pulsante di dettaglio
// (occhio) era in fondo alla riga, dopo tutte le altre colonne — spostato
// all'inizio per praticità (prima colonna della tabella).
describe("VolunteerAdminList - colonna Dettaglio in prima posizione", () => {
  it("la colonna Dettaglio è la prima intestazione della tabella, prima di Nome", () => {
    render(
      <VolunteerAdminList
        rows={[row]}
        loading={false}
        roleUpdateLoadingUid={null}
        onToggleRole={vi.fn()}
        onShowDetail={vi.fn()}
      />
    );

    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers[0]).toBe("Dettaglio");
    expect(headers.indexOf("Dettaglio")).toBeLessThan(headers.indexOf("Nome"));
  });

  it("il pulsante di dettaglio è nella prima cella della riga", async () => {
    render(
      <VolunteerAdminList
        rows={[row]}
        loading={false}
        roleUpdateLoadingUid={null}
        onToggleRole={vi.fn()}
        onShowDetail={vi.fn()}
      />
    );

    const dataRow = (await screen.findByText("Mario")).closest("tr");
    if (!dataRow) throw new Error("Riga non trovata");
    const firstCell = dataRow.querySelectorAll("td")[0];
    expect(firstCell.querySelector(".pi-eye")).toBeInTheDocument();
  });
});
