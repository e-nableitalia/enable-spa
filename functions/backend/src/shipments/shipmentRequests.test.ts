import { HttpsError } from "firebase-functions/v2/https";
import {
  shipmentRequestsStore,
  mailStore,
  firestoreMockModule,
  buildRequest,
  resetShipmentsTestSupport,
  seedDefaultShipmentData,
} from "./testSupport";

jest.mock("firebase-admin/firestore", () => firestoreMockModule());
jest.mock("../security/securityLog", () => ({
  logSecurityEvent: jest.fn().mockResolvedValue(undefined),
}));

import {
  listShipmentAddressBook,
  approveShipmentRequest,
  updateShipmentTracking,
  markShipmentDelivered,
  deleteShipmentRequest,
  createShipmentRequest,
} from "./shipmentRequests";

describe("listShipmentAddressBook", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetShipmentsTestSupport();
    seedDefaultShipmentData();
  });

  it("returns own profile + assigned device requests for a volunteer", async () => {
    const result = (await listShipmentAddressBook.run(buildRequest({}, "volunteer-1"))) as {
      addresses: Array<{ kind: string; id: string }>;
    };

    const ids = result.addresses.map((a) => `${a.kind}:${a.id}`);
    expect(ids).toContain("profile:volunteer-1");
    expect(ids).toContain("deviceRequest:req-assigned");
    expect(ids).not.toContain("profile:volunteer-2");
    expect(ids).not.toContain("deviceRequest:req-other");
  });

  it("returns all volunteer profiles and all device-request addresses for an admin", async () => {
    const result = (await listShipmentAddressBook.run(buildRequest({}, "admin-1"))) as {
      addresses: Array<{ kind: string; id: string }>;
    };

    const ids = result.addresses.map((a) => `${a.kind}:${a.id}`);
    expect(ids).toContain("profile:admin-1");
    expect(ids).toContain("profile:volunteer-1");
    expect(ids).toContain("profile:volunteer-2");
    expect(ids).toContain("deviceRequest:req-assigned");
    expect(ids).toContain("deviceRequest:req-other");
  });

  it("throws unauthenticated without auth", async () => {
    await expect(listShipmentAddressBook.run(buildRequest({}, null))).rejects.toMatchObject(
      new HttpsError("unauthenticated", "User must be authenticated")
    );
  });
});

describe("approveShipmentRequest", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetShipmentsTestSupport();
    seedDefaultShipmentData();
  });

  it("approves a pending request and enqueues email (admin)", async () => {
    const result = await approveShipmentRequest.run(
      buildRequest({ requestId: "ship-pending" }, "admin-1")
    );
    expect(result).toEqual({ success: true });
    expect(shipmentRequestsStore["ship-pending"]?.status).toBe("approved");
    expect(Object.keys(mailStore).length).toBe(1);
  });

  it("rejects approving a non-pending request", async () => {
    await expect(
      approveShipmentRequest.run(buildRequest({ requestId: "ship-approved" }, "admin-1"))
    ).rejects.toMatchObject(
      new HttpsError("failed-precondition", "Only pending shipment requests can be approved")
    );
  });

  it("denies a volunteer", async () => {
    await expect(
      approveShipmentRequest.run(buildRequest({ requestId: "ship-pending" }, "volunteer-1"))
    ).rejects.toMatchObject(new HttpsError("permission-denied", "Admin role required"));
  });
});

describe("updateShipmentTracking", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetShipmentsTestSupport();
    seedDefaultShipmentData();
  });

  it("sets tracking and moves approved → in_transit", async () => {
    const result = (await updateShipmentTracking.run(
      buildRequest({ requestId: "ship-approved", trackingNumber: " TRK-123 " }, "admin-1")
    )) as { success: boolean; status: string };

    expect(result).toEqual({ success: true, status: "in_transit" });
    expect(shipmentRequestsStore["ship-approved"]).toEqual(
      expect.objectContaining({ status: "in_transit", trackingNumber: "TRK-123" })
    );
  });

  it("updates tracking on in_transit without changing status", async () => {
    const result = (await updateShipmentTracking.run(
      buildRequest({ requestId: "ship-transit", trackingNumber: "TRK-NEW" }, "admin-1")
    )) as { status: string };

    expect(result.status).toBe("in_transit");
    expect(shipmentRequestsStore["ship-transit"]?.trackingNumber).toBe("TRK-NEW");
    expect(shipmentRequestsStore["ship-transit"]?.status).toBe("in_transit");
  });

  it("rejects blank trackingNumber", async () => {
    await expect(
      updateShipmentTracking.run(buildRequest({ requestId: "ship-approved", trackingNumber: "  " }, "admin-1"))
    ).rejects.toMatchObject(
      new HttpsError("invalid-argument", "trackingNumber must be a non-empty string")
    );
  });

  it("rejects tracking on pending", async () => {
    await expect(
      updateShipmentTracking.run(
        buildRequest({ requestId: "ship-pending", trackingNumber: "TRK" }, "admin-1")
      )
    ).rejects.toMatchObject(
      new HttpsError(
        "failed-precondition",
        "Tracking can only be set on approved or in-transit shipments"
      )
    );
  });

  it("denies a volunteer", async () => {
    await expect(
      updateShipmentTracking.run(
        buildRequest({ requestId: "ship-approved", trackingNumber: "TRK" }, "volunteer-1")
      )
    ).rejects.toMatchObject(new HttpsError("permission-denied", "Admin role required"));
  });
});

describe("markShipmentDelivered", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetShipmentsTestSupport();
    seedDefaultShipmentData();
  });

  it("marks in_transit as delivered", async () => {
    const result = await markShipmentDelivered.run(
      buildRequest({ requestId: "ship-transit" }, "admin-1")
    );
    expect(result).toEqual({ success: true });
    expect(shipmentRequestsStore["ship-transit"]?.status).toBe("delivered");
  });

  it("rejects delivered from approved", async () => {
    await expect(
      markShipmentDelivered.run(buildRequest({ requestId: "ship-approved" }, "admin-1"))
    ).rejects.toMatchObject(
      new HttpsError("failed-precondition", "Only in-transit shipments can be marked as delivered")
    );
  });
});

describe("createShipmentRequest / deleteShipmentRequest (smoke)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetShipmentsTestSupport();
    seedDefaultShipmentData();
  });

  it("creates a pending shipment", async () => {
    const result = (await createShipmentRequest.run(
      buildRequest(
        {
          reason: "Motivo",
          senderName: "S",
          senderAddress: "SA",
          recipientName: "R",
          recipientAddress: "RA",
        },
        "volunteer-1"
      )
    )) as { success: boolean; id: string };

    expect(result.success).toBe(true);
    expect(shipmentRequestsStore[result.id]?.status).toBe("pending");
  });

  it("lets a volunteer soft-delete their own pending request", async () => {
    await deleteShipmentRequest.run(buildRequest({ requestId: "ship-pending" }, "volunteer-1"));
    expect(shipmentRequestsStore["ship-pending"]?.status).toBe("deleted");
  });
});
