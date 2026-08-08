import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AdminMaintenanceRequests from "./AdminMaintenanceRequests";

vi.mock("../../../firebase", () => ({ db: {}, functions: {} }));
vi.mock("firebase/functions", () => ({ httpsCallable: () => vi.fn() }));

let mainDocs: { id: string; ref: { __path: string }; data: () => Record<string, unknown> }[] = [];
let publicDocs: { id: string; ref: { __path: string }; data: () => Record<string, unknown> }[] = [];
let allUpdates: { path: string; data: Record<string, unknown> }[] = [];
let allSets: { path: string; data: Record<string, unknown> }[] = [];
let autoIdCounter = 0;

function mainDoc(id: string, data: Record<string, unknown>) {
  return { id, ref: { __path: `deviceRequests/${id}` }, data: () => data };
}
function publicDoc(id: string, data: Record<string, unknown>) {
  return { id, ref: { __path: `publicDeviceRequests/${id}` }, data: () => data };
}

vi.mock("firebase/firestore", () => ({
  collection: (_db: unknown, ...segments: string[]) => ({ __path: segments.join("/") }),
  doc: (...args: unknown[]) => {
    const first = args[0] as { __path?: string } | undefined;
    if (args.length === 1 && first && first.__path !== undefined) {
      // doc(collectionRef) - auto-generated id under an existing collection
      return { __path: `${first.__path}/auto-${autoIdCounter++}` };
    }
    const segments = (args.slice(1) as string[]);
    return { __path: segments.join("/") };
  },
  getDocs: vi.fn(async (ref: { __path: string }) => {
    if (ref.__path === "deviceRequests") return { docs: mainDocs };
    if (ref.__path === "publicDeviceRequests") return { docs: publicDocs };
    return { docs: [] };
  }),
  writeBatch: () => {
    const updates: { path: string; data: Record<string, unknown> }[] = [];
    const sets: { path: string; data: Record<string, unknown> }[] = [];
    return {
      update: (ref: { __path: string }, data: Record<string, unknown>) => updates.push({ path: ref.__path, data }),
      set: (ref: { __path: string }, data: Record<string, unknown>) => sets.push({ path: ref.__path, data }),
      commit: async () => {
        allUpdates.push(...updates);
        allSets.push(...sets);
      },
    };
  },
  deleteField: () => "__DELETE_FIELD__",
  serverTimestamp: () => "__SERVER_TIMESTAMP__",
  deleteDoc: vi.fn(),
  updateDoc: vi.fn(),
  Timestamp: { now: () => ({}), fromDate: () => ({}) },
}));

describe("AdminMaintenanceRequests (EA-152) - migrazione one-shot dei 10 stati rimossi e rimozione publicStatus", () => {
  beforeEach(() => {
    mainDocs = [];
    publicDocs = [];
    allUpdates = [];
    allSets = [];
    autoIdCounter = 0;
  });

  const clickMigrate = async () => {
    render(<AdminMaintenanceRequests />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /migra stati richieste/i }));
  };

  it("Scenario 1: una deviceRequest 'valutazione fattibilità' migra a 'da gestire' con nota del valore granulare perso", async () => {
    mainDocs = [mainDoc("r1", { status: "valutazione fattibilità" })];

    await clickMigrate();

    await waitFor(() => expect(allUpdates).toHaveLength(1));
    expect(allUpdates[0]).toEqual({ path: "deviceRequests/r1", data: { status: "da gestire" } });
    expect(allSets).toHaveLength(1);
    expect(allSets[0].data).toMatchObject({
      type: "status_change",
      fromStatus: "valutazione fattibilità",
      toStatus: "da gestire",
    });
    expect(allSets[0].data.note).toContain("valutazione fattibilità");
  });

  it("Scenario 2: una deviceRequest 'fabbricazione' migra a 'in produzione' con nota del valore granulare perso", async () => {
    mainDocs = [mainDoc("r2", { status: "fabbricazione" })];

    await clickMigrate();

    await waitFor(() => expect(allUpdates).toHaveLength(1));
    expect(allUpdates[0]).toEqual({ path: "deviceRequests/r2", data: { status: "in produzione" } });
    expect(allSets[0].data).toMatchObject({ fromStatus: "fabbricazione", toStatus: "in produzione" });
    expect(allSets[0].data.note).toContain("fabbricazione");
  });

  it("Scenario 3: una deviceRequest 'followup famiglia ko' migra a 'annullata' con nota del motivo/valore granulare perso", async () => {
    mainDocs = [mainDoc("r3", { status: "followup famiglia ko" })];

    await clickMigrate();

    await waitFor(() => expect(allUpdates).toHaveLength(1));
    expect(allUpdates[0]).toEqual({ path: "deviceRequests/r3", data: { status: "annullata" } });
    expect(allSets[0].data).toMatchObject({ fromStatus: "followup famiglia ko", toStatus: "annullata" });
    expect(allSets[0].data.note).toContain("followup famiglia ko");
  });

  it("Scenario 4: publicStatus viene rimosso sia da deviceRequests sia da publicDeviceRequests", async () => {
    mainDocs = [mainDoc("r4", { status: "inviata", publicStatus: "da validare" })];
    publicDocs = [publicDoc("r4", { publicStatus: "da validare", province: "MI" })];

    await clickMigrate();

    await waitFor(() => expect(allUpdates).toHaveLength(2));
    const mainUpdate = allUpdates.find((u) => u.path === "deviceRequests/r4");
    const publicUpdate = allUpdates.find((u) => u.path === "publicDeviceRequests/r4");
    expect(mainUpdate?.data).toEqual({ publicStatus: "__DELETE_FIELD__" });
    expect(publicUpdate?.data).toEqual({ publicStatus: "__DELETE_FIELD__" });
    // "inviata" non è uno dei 10 stati rimossi: nessun evento di nota per lo status.
    expect(allSets).toHaveLength(0);
  });

  it("Scenario 5: la migrazione è idempotente - rilanciarla su documenti già migrati non scrive nulla di nuovo", async () => {
    // Prima esecuzione: un documento ancora nel dominio rimosso.
    mainDocs = [mainDoc("r5", { status: "personalizzazione", publicStatus: "fabbricazione in corso" })];
    publicDocs = [publicDoc("r5", { publicStatus: "fabbricazione in corso" })];

    const { unmount } = render(<AdminMaintenanceRequests />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /migra stati richieste/i }));

    await waitFor(() => expect(allUpdates.length).toBeGreaterThan(0));
    expect(allSets).toHaveLength(1);
    unmount();

    // Stato dei documenti dopo la prima migrazione: status già nel nuovo dominio,
    // publicStatus già rimosso su entrambe le collection.
    mainDocs = [mainDoc("r5", { status: "in produzione" })];
    publicDocs = [publicDoc("r5", {})];
    allUpdates = [];
    allSets = [];

    render(<AdminMaintenanceRequests />);
    await userEvent.setup().click(screen.getByRole("button", { name: /migra stati richieste/i }));

    await screen.findByText("Nessun documento da migrare.");
    expect(allUpdates).toHaveLength(0);
    expect(allSets).toHaveLength(0);
  });
});
