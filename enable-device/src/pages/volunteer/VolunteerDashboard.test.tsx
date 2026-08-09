import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import VolunteerDashboard from "./VolunteerDashboard";

vi.mock("../../firebase", () => ({
  auth: { currentUser: { uid: "vol1", email: "vol@test.it" } },
  db: {},
}));

type FakeRef = { __path: string; __query?: boolean };

vi.mock("firebase/firestore", () => ({
  doc: (_db: unknown, ...segments: string[]) => ({ __path: segments.join("/") }) as FakeRef,
  getDoc: async () => ({ exists: () => false, data: () => ({}) }),
  setDoc: async () => undefined,
  updateDoc: async () => undefined,
  collection: (_db: unknown, path: string) => ({ __path: path }) as FakeRef,
  query: (ref: FakeRef) => ({ ...ref, __query: true }),
  where: () => ({}),
  serverTimestamp: () => "SERVER_TIMESTAMP",
  getDocs: async (ref: FakeRef) => {
    if (ref.__path === "publicDeviceRequests") {
      return {
        docs: [
          { id: "pub1", data: () => ({ devicetype: "Hand" }) },
          { id: "pub2", data: () => ({ devicetype: "Arm" }) },
          { id: "pub3", data: () => ({ devicetype: "Hand" }) },
        ],
      };
    }
    // Fetch integrale (non query()) di deviceRequests: usato per ricalcolare
    // il gruppo pubblico da status (EA-150).
    if (ref.__path === "deviceRequests" && !ref.__query) {
      return {
        docs: [
          { id: "pub1", data: () => ({ status: "annullata" }) }, // annullate / non completabili -> INACTIVE
          { id: "pub2", data: () => ({ status: "in produzione" }) }, // fabbricazione in corso -> ACTIVE
          { id: "pub3", data: () => ({ status: "validata" }) }, // da gestire -> INACTIVE
        ],
      };
    }
    return { docs: [] };
  },
}));

vi.mock("primereact/chart", () => ({
  Chart: (props: { data: { labels: string[] } }) => (
    <div data-testid="chart" data-labels={JSON.stringify(props.data.labels)} />
  ),
}));

describe("VolunteerDashboard (EA-150) - grafico attive/inattive derivato da status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("Scenario 3: classifica le richieste attive/inattive usando il raggruppamento derivato da status, non da publicStatus persistito", async () => {
    render(<VolunteerDashboard />);

    // "annullata" e "validata" ricadono in gruppi inattivi (annullate/non completabili, da gestire);
    // solo "in produzione" (-> fabbricazione in corso) è attiva.
    expect(await screen.findByText("Gestite/in gestione: 1")).toBeInTheDocument();
    expect(await screen.findByText("Totale: 3")).toBeInTheDocument();
  });
});
