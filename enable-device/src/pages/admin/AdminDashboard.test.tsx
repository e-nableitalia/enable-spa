import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import AdminDashboard from "./AdminDashboard";

vi.mock("../../firebase", () => ({ db: {} }));
vi.mock("firebase/firestore", () => ({
  doc: () => ({}),
  getDoc: async () => ({ exists: () => false, data: () => ({}) }),
}));

describe("AdminDashboard (EA-150) - colonne Kanban derivate da status", () => {
  it("Scenario 1: ogni richiesta appare nella colonna del gruppo pubblico calcolato da status, senza leggere publicStatus persistito", async () => {
    const requests = [
      // publicStatus persistito volutamente assente/stale: la colonna deve comunque
      // essere corretta perché calcolata dall'helper a partire da status.
      { id: "r1", status: "in produzione", publicStatus: "annullate / non completabili" },
      { id: "r2", status: "completata" },
      { id: "r3", status: "standby" },
      { id: "r4", status: "validata" },
    ];

    render(<AdminDashboard requests={requests} />);

    expect(await screen.findByText("fabbricazione in corso (1)")).toBeInTheDocument();
    expect(await screen.findByText("completati (1)")).toBeInTheDocument();
    expect(await screen.findByText("annullate / non completabili (1)")).toBeInTheDocument();
    expect(await screen.findByText("da gestire (1)")).toBeInTheDocument();
  });
});
