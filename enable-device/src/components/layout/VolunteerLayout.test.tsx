import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import VolunteerLayout from "./VolunteerLayout";

vi.mock("../../firebase", () => ({ auth: {}, db: {} }));

vi.mock("firebase/auth", () => ({
  onAuthStateChanged: (_auth: unknown, cb: (user: unknown) => void) => {
    cb({ uid: "vol1", email: "vol@test.it" });
    return () => {};
  },
  signOut: async () => undefined,
}));

const requestDocs = [
  // "in produzione" e "spedita" sono entrambi nel gruppo "fabbricazione in corso"
  // (PUBLIC_STATUS_GROUPS_FROM_STATUS, EA-150); il filtro produzione/spedizione
  // in VolunteerLayout li separa poi in base al valore letterale di status.
  { id: "r1", data: () => ({ status: "in produzione", assignedVolunteers: ["vol1"] }) },
  { id: "r2", data: () => ({ status: "spedita", assignedVolunteers: ["vol1"] }) },
];

vi.mock("firebase/firestore", () => ({
  doc: (_db: unknown, ...segments: string[]) => ({ __path: segments.join("/") }),
  getDoc: async (ref: { __path: string }) => {
    if (ref.__path.startsWith("users/")) {
      return { exists: () => true, data: () => ({ role: "volunteer", active: true }) };
    }
    return { exists: () => false, data: () => ({}) };
  },
  collection: () => ({}),
  query: (ref: unknown) => ref,
  where: () => ({}),
  onSnapshot: (_q: unknown, cb: (snap: { docs: typeof requestDocs }) => void) => {
    cb({ docs: requestDocs });
    return () => {};
  },
}));

describe("VolunteerLayout (EA-150) - classificazione produzione/spedizione dal gruppo 'fabbricazione in corso' derivato da status", () => {
  it("Scenario 4 (regressione volontario): 'in produzione' compare tra le richieste in produzione, non tra le spedizioni", async () => {
    render(
      <MemoryRouter initialEntries={["/volunteer/production"]}>
        <Routes>
          <Route path="/volunteer/*" element={<VolunteerLayout />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText("Richieste in produzione")).toBeInTheDocument();
    const table = await screen.findByRole("table");
    expect(within(table).getByText("in produzione")).toBeInTheDocument();
    expect(within(table).queryByText("spedita")).not.toBeInTheDocument();
  });

  it("Scenario 4 (regressione volontario): 'spedita' compare tra le spedizioni, non tra le richieste in produzione", async () => {
    render(
      <MemoryRouter initialEntries={["/volunteer/shipping"]}>
        <Routes>
          <Route path="/volunteer/*" element={<VolunteerLayout />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText("Richieste di spedizione")).toBeInTheDocument();
    const table = await screen.findByRole("table");
    expect(within(table).getByText("spedita")).toBeInTheDocument();
    expect(within(table).queryByText("in produzione")).not.toBeInTheDocument();
  });
});
