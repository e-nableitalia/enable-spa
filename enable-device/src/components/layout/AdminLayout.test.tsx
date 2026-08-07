import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import AdminLayout from "./AdminLayout";

vi.mock("../../firebase", () => ({ auth: {}, db: {} }));

vi.mock("firebase/auth", () => ({
  onAuthStateChanged: (_auth: unknown, cb: (user: unknown) => void) => {
    cb({ uid: "admin1", email: "admin@test.it" });
    return () => {};
  },
  signOut: async () => undefined,
}));

vi.mock("firebase/functions", () => ({
  httpsCallable: () => async () => ({ data: {} }),
}));

// 10 richieste che coprono gli 11 valori di status (EA-148/EA-150), progettate per
// avere conteggi distinti su ognuno dei 5 gruppi pubblici + i due filtri letterali.
const requestDocs = [
  { id: "r1", data: () => ({ status: "inviata", amputationType: "" }) },
  { id: "r2", data: () => ({ status: "validata", amputationType: "" }) },
  { id: "r3", data: () => ({ status: "da gestire", amputationType: "" }) },
  { id: "r4", data: () => ({ status: "attesa volontario", amputationType: "" }) },
  { id: "r5", data: () => ({ status: "in produzione", amputationType: "" }) },
  { id: "r6", data: () => ({ status: "pronta per spedizione", amputationType: "" }) },
  { id: "r7", data: () => ({ status: "spedita", amputationType: "" }) },
  { id: "r8", data: () => ({ status: "completata", amputationType: "" }) },
  { id: "r9", data: () => ({ status: "annullata", amputationType: "" }) },
  { id: "r10", data: () => ({ status: "standby", amputationType: "" }) },
];

vi.mock("firebase/firestore", () => ({
  doc: (_db: unknown, ...segments: string[]) => ({ __path: segments.join("/") }),
  getDoc: async (ref: { __path: string }) => {
    if (ref.__path === "users/admin1") {
      return { exists: () => true, data: () => ({ role: "admin", active: true }) };
    }
    return { exists: () => false, data: () => ({}) };
  },
  collection: (_db: unknown, path: string) => ({ __path: path }),
  query: (ref: unknown) => ref,
  orderBy: () => undefined,
  onSnapshot: (ref: { __path: string }, cb: (snap: { docs: typeof requestDocs }) => void) => {
    if (ref.__path === "deviceRequests") {
      cb({ docs: requestDocs });
    }
    return () => {};
  },
  getDocs: async () => ({ docs: [] }),
}));

// Numero di righe dati attese (esclusa l'intestazione) per ciascuna pagina di
// classificazione raggiunta dal menu laterale di AdminLayout.
const cases: Array<[string, string, number]> = [
  ["/admin/requests/validate", "Richieste da validare", 1], // inviata
  ["/admin/requests/triage", "Richieste da gestire", 3], // validata + da gestire + attesa volontario (gruppo "da gestire")
  ["/admin/requests/pending", "Richieste in attesa volontario", 1], // filtro letterale invariato: status === "attesa volontario"
  ["/admin/requests/production", "Richieste in produzione", 3], // in produzione + pronta per spedizione + spedita (gruppo "fabbricazione in corso")
  ["/admin/requests/shipping", "Richieste spedizioni", 2], // filtro letterale invariato: ['pronta per spedizione','spedita']
  ["/admin/requests/completed", "Richieste completate", 1], // completata
  ["/admin/requests/cancelled", "Richieste annullate / KO", 2], // annullata + standby
];

describe("AdminLayout (EA-150) - classificazione delle richieste derivata da status, tranne i due filtri letterali", () => {
  it.each(cases)(
    "Scenario 4: %s mostra %s righe calcolate dall'helper display-only o dal filtro letterale invariato",
    async (path, heading, expectedRows) => {
      render(
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/admin/*" element={<AdminLayout />} />
          </Routes>
        </MemoryRouter>
      );

      expect(await screen.findByRole("heading", { name: heading })).toBeInTheDocument();
      const table = await screen.findByRole("table");
      const tbody = table.querySelector("tbody");
      const dataRows = within(tbody as HTMLElement).getAllByRole("row").length;
      expect(dataRows).toBe(expectedRows);
    }
  );
});
