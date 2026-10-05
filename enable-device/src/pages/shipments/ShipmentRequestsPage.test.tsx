import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ShipmentRequestsPage from "./ShipmentRequestsPage";

vi.mock("../../firebase", () => ({
  auth: { currentUser: { uid: "admin-1" } },
  db: {},
  functions: {},
}));

const callable = vi.fn();
vi.mock("firebase/functions", () => ({
  httpsCallable: (_functions: unknown, name: string) => (data: unknown) => callable(name, data),
}));

type SnapCb = (snap: { docs: Array<{ id: string; data: () => Record<string, unknown> }> }) => void;
let snapshotCb: SnapCb | null = null;

vi.mock("firebase/firestore", () => ({
  doc: (_db: unknown, ...segments: string[]) => ({ __path: segments.join("/") }),
  getDoc: async (ref: { __path: string }) => {
    if (ref.__path === "users/admin-1") {
      return { exists: () => true, data: () => ({ role: "admin" }) };
    }
    return { exists: () => false, data: () => undefined };
  },
  collection: (_db: unknown, ...segments: string[]) => ({ __path: segments.join("/") }),
  query: (ref: unknown) => ref,
  where: vi.fn(),
  onSnapshot: (_q: unknown, cb: SnapCb) => {
    snapshotCb = cb;
    return () => {
      snapshotCb = null;
    };
  },
}));

function emitShipments(rows: Array<Record<string, unknown> & { id: string }>) {
  snapshotCb?.({
    docs: rows.map((r) => {
      const { id, ...data } = r;
      return { id, data: () => data };
    }),
  });
}

describe("ShipmentRequestsPage", () => {
  beforeEach(() => {
    callable.mockReset();
    snapshotCb = null;
    callable.mockImplementation((name: string) => {
      if (name === "listShipmentAddressBook") {
        return Promise.resolve({
          data: {
            addresses: [
              {
                kind: "profile",
                id: "volunteer-1",
                label: "Volontario V — Via 1",
                name: "Volontario V",
                addressText: "Via 1\n20100 Milano (MI)\nIT",
              },
            ],
          },
        });
      }
      if (name === "approveShipmentRequest") return Promise.resolve({ data: { success: true } });
      if (name === "updateShipmentTracking") return Promise.resolve({ data: { success: true, status: "in_transit" } });
      if (name === "markShipmentDelivered") return Promise.resolve({ data: { success: true } });
      if (name === "deleteShipmentRequest") return Promise.resolve({ data: { success: true } });
      if (name === "createShipmentRequest") return Promise.resolve({ data: { success: true, id: "new" } });
      return Promise.reject(new Error(`Unexpected callable: ${name}`));
    });
  });

  it("carica listShipmentAddressBook aprendo 'Nuova richiesta'", async () => {
    const user = userEvent.setup();
    render(<ShipmentRequestsPage />);
    await waitFor(() => expect(snapshotCb).not.toBeNull());
    emitShipments([]);

    await user.click(await screen.findByRole("button", { name: "Nuova richiesta" }));
    await waitFor(() =>
      expect(callable).toHaveBeenCalledWith("listShipmentAddressBook", {})
    );
    expect(screen.getByRole("dialog", { name: /Nuova richiesta/i })).toBeInTheDocument();
  });

  it("mostra Approva solo su pending; Modifica su approved/in_transit; lente a sinistra", async () => {
    render(<ShipmentRequestsPage />);
    await waitFor(() => expect(snapshotCb).not.toBeNull());
    emitShipments([
      {
        id: "s1",
        status: "pending",
        createdBy: "volunteer-1",
        reason: "Kit A",
        senderName: "Mittente A",
        recipientName: "Dest A",
        senderAddress: "SA",
        recipientAddress: "RA",
        createdAt: { seconds: 1_700_000_000 },
      },
      {
        id: "s2",
        status: "approved",
        createdBy: "volunteer-1",
        reason: "Kit B",
        senderName: "Mittente B",
        recipientName: "Dest B",
        senderAddress: "SB",
        recipientAddress: "RB",
        createdAt: { seconds: 1_700_000_100 },
      },
      {
        id: "s3",
        status: "in_transit",
        createdBy: "volunteer-1",
        reason: "Kit C",
        senderName: "Mittente C",
        recipientName: "Dest C",
        senderAddress: "SC",
        recipientAddress: "RC",
        trackingNumber: "TRK-1",
        createdAt: { seconds: 1_700_000_200 },
      },
    ]);

    expect(await screen.findByText("Kit A")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Dettaglio" }).length).toBe(3);
    expect(screen.getByRole("button", { name: "Approva" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Modifica" }).length).toBe(2);
    expect(screen.getByText("TRK-1")).toBeInTheDocument();
  });

  it("Modifica salva tracking via updateShipmentTracking", async () => {
    const user = userEvent.setup();
    render(<ShipmentRequestsPage />);
    await waitFor(() => expect(snapshotCb).not.toBeNull());
    emitShipments([
      {
        id: "s2",
        status: "approved",
        createdBy: "volunteer-1",
        reason: "Kit B",
        senderName: "Mittente B",
        recipientName: "Dest B",
        senderAddress: "SB",
        recipientAddress: "RB",
        createdAt: { seconds: 1_700_000_100 },
      },
    ]);

    await user.click(await screen.findByRole("button", { name: "Modifica" }));
    const dialog = screen.getByRole("dialog", { name: /Modifica spedizione/i });
    await user.type(within(dialog).getByLabelText(/Numero di tracciamento/i), "TRK-999");
    await user.click(within(dialog).getByRole("button", { name: "Salva tracking" }));

    await waitFor(() =>
      expect(callable).toHaveBeenCalledWith("updateShipmentTracking", {
        requestId: "s2",
        trackingNumber: "TRK-999",
      })
    );
  });

  it("Segna come consegnata chiama markShipmentDelivered su in_transit", async () => {
    const user = userEvent.setup();
    render(<ShipmentRequestsPage />);
    await waitFor(() => expect(snapshotCb).not.toBeNull());
    emitShipments([
      {
        id: "s3",
        status: "in_transit",
        createdBy: "volunteer-1",
        reason: "Kit C",
        senderName: "Mittente C",
        recipientName: "Dest C",
        senderAddress: "SC",
        recipientAddress: "RC",
        trackingNumber: "TRK-1",
        createdAt: { seconds: 1_700_000_200 },
      },
    ]);

    await user.click(await screen.findByRole("button", { name: "Modifica" }));
    const dialog = screen.getByRole("dialog", { name: /Modifica spedizione/i });
    await user.click(within(dialog).getByRole("button", { name: "Segna come consegnata" }));

    await waitFor(() =>
      expect(callable).toHaveBeenCalledWith("markShipmentDelivered", { requestId: "s3" })
    );
  });
});
