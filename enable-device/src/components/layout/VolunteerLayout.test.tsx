import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import VolunteerLayout from "./VolunteerLayout";

vi.mock("../../firebase", () => ({ auth: {}, db: {}, functions: {} }));

vi.mock("firebase/auth", () => ({
  onAuthStateChanged: (_auth: unknown, cb: (user: unknown) => void) => {
    cb({ uid: "vol1", email: "vol@test.it" });
    return () => {};
  },
  signOut: async () => undefined,
}));

vi.mock("firebase/functions", () => ({
  httpsCallable: () => async () => ({ data: { items: [] } }),
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
  getDocs: async () => ({ docs: [] }),
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

describe("VolunteerLayout (EA-156) - voce di menu reale per raggiungere 'I miei item'", () => {
  it("Scenario: il volontario attivo vede la voce 'I miei item' nel menu e la usa per raggiungere la pagina introdotta da EA-154", async () => {
    render(
      <MemoryRouter initialEntries={["/volunteer"]}>
        <Routes>
          <Route path="/volunteer/*" element={<VolunteerLayout />} />
        </Routes>
      </MemoryRouter>
    );

    await userEvent.click(await screen.findByRole("button", { name: "Apri menu" }));

    const menuItem = await screen.findByRole("button", { name: "I miei item" });
    expect(menuItem).toBeInTheDocument();

    await userEvent.click(menuItem);

    expect(
      await screen.findByText("Non hai al momento nessun item di checklist assegnato.")
    ).toBeInTheDocument();
  });
});
