import type { CallableRequest } from "firebase-functions/v2/https";

/**
 * Mock Firestore in-memory per i test del modulo shipments: users (+ private/profile),
 * deviceRequests (+ private/data), shipmentRequests, mail.
 */

export const usersStore: Record<string, Record<string, unknown> | undefined> = {};
export const userProfilesStore: Record<string, Record<string, unknown> | undefined> = {};
export const deviceRequestsStore: Record<string, Record<string, unknown> | undefined> = {};
export const devicePrivateStore: Record<string, Record<string, unknown> | undefined> = {};
export const shipmentRequestsStore: Record<string, Record<string, unknown> | undefined> = {};
export const mailStore: Record<string, Record<string, unknown>> = {};

let idCounter = 0;

export function resetShipmentsTestSupport(): void {
  for (const k of Object.keys(usersStore)) delete usersStore[k];
  for (const k of Object.keys(userProfilesStore)) delete userProfilesStore[k];
  for (const k of Object.keys(deviceRequestsStore)) delete deviceRequestsStore[k];
  for (const k of Object.keys(devicePrivateStore)) delete devicePrivateStore[k];
  for (const k of Object.keys(shipmentRequestsStore)) delete shipmentRequestsStore[k];
  for (const k of Object.keys(mailStore)) delete mailStore[k];
  idCounter = 0;
}

export function buildRequest(data: Record<string, unknown>, uid: string | null = "admin-1"): CallableRequest {
  return {
    auth: uid
      ? ({ uid, token: { email: `${uid}@example.com` } } as CallableRequest["auth"])
      : undefined,
    data,
    rawRequest: { headers: {} } as CallableRequest["rawRequest"],
  } as CallableRequest;
}

function userDoc(uid: string) {
  const privateCollection = () => ({
    doc: (docId: string) => ({
      get: jest.fn(() =>
        Promise.resolve({
          exists: docId === "profile" && userProfilesStore[uid] !== undefined,
          data: () => userProfilesStore[uid],
        })
      ),
    }),
  });

  return {
    id: uid,
    collection: (sub: string) => {
      if (sub === "private") return privateCollection();
      return { doc: () => ({ get: jest.fn().mockResolvedValue({ exists: false, data: () => undefined }) }) };
    },
    ref: {
      collection: (sub: string) => {
        if (sub === "private") return privateCollection();
        return { doc: () => ({ get: jest.fn().mockResolvedValue({ exists: false, data: () => undefined }) }) };
      },
    },
    get: jest.fn(() =>
      Promise.resolve({
        exists: usersStore[uid] !== undefined,
        data: () => usersStore[uid],
      })
    ),
  };
}

function deviceRequestDoc(id: string) {
  return {
    id,
    data: () => deviceRequestsStore[id],
    get: jest.fn(() =>
      Promise.resolve({
        exists: deviceRequestsStore[id] !== undefined,
        data: () => deviceRequestsStore[id],
        id,
      })
    ),
    collection: (sub: string) => {
      if (sub === "private") {
        return {
          doc: (docId: string) => ({
            get: jest.fn(() =>
              Promise.resolve({
                exists: docId === "data" && devicePrivateStore[id] !== undefined,
                data: () => devicePrivateStore[id],
              })
            ),
          }),
        };
      }
      return { doc: () => ({ get: jest.fn().mockResolvedValue({ exists: false }) }) };
    },
  };
}

function shipmentDoc(id: string) {
  return {
    id,
    get: jest.fn(() =>
      Promise.resolve({
        exists: shipmentRequestsStore[id] !== undefined,
        data: () => shipmentRequestsStore[id],
        id,
      })
    ),
    update: jest.fn((updates: Record<string, unknown>) => {
      shipmentRequestsStore[id] = { ...(shipmentRequestsStore[id] ?? {}), ...updates };
      return Promise.resolve();
    }),
  };
}

export function firestoreMockModule() {
  return {
    FieldValue: {
      serverTimestamp: jest.fn(() => ({ __op: "serverTimestamp" })),
    },
    getFirestore: jest.fn(() => ({
      collection: (name: string) => {
        if (name === "users") {
          return {
            doc: (uid: string) => userDoc(uid),
            where: (field: string, _op: string, value: unknown) => ({
              get: jest.fn(() => {
                const docs = Object.entries(usersStore)
                  .filter(([, d]) => d !== undefined && d[field] === value)
                  .map(([id]) => userDoc(id));
                return Promise.resolve({ docs });
              }),
            }),
          };
        }
        if (name === "deviceRequests") {
          return {
            doc: (id: string) => deviceRequestDoc(id),
            get: jest.fn(() => {
              const docs = Object.keys(deviceRequestsStore).map((id) => deviceRequestDoc(id));
              return Promise.resolve({ docs });
            }),
            where: (field: string, op: string, value: unknown) => ({
              get: jest.fn(() => {
                const docs = Object.entries(deviceRequestsStore)
                  .filter(([, d]) => {
                    if (!d) return false;
                    if (op === "array-contains") {
                      const arr = d[field];
                      return Array.isArray(arr) && arr.includes(value);
                    }
                    return d[field] === value;
                  })
                  .map(([id]) => deviceRequestDoc(id));
                return Promise.resolve({ docs });
              }),
            }),
          };
        }
        if (name === "shipmentRequests") {
          return {
            doc: (id: string) => shipmentDoc(id),
            add: jest.fn((data: Record<string, unknown>) => {
              const id = `ship-${++idCounter}`;
              shipmentRequestsStore[id] = data;
              return Promise.resolve({ id });
            }),
          };
        }
        if (name === "mail") {
          return {
            add: jest.fn((data: Record<string, unknown>) => {
              const id = `mail-${++idCounter}`;
              mailStore[id] = data;
              return Promise.resolve({ id });
            }),
          };
        }
        return {
          doc: () => ({ get: jest.fn().mockResolvedValue({ exists: false }) }),
        };
      },
    })),
  };
}

export function seedDefaultShipmentData(): void {
  usersStore["admin-1"] = { role: "admin" };
  usersStore["volunteer-1"] = { role: "volunteer", active: true };
  usersStore["volunteer-2"] = { role: "volunteer", active: true };

  userProfilesStore["admin-1"] = {
    firstName: "Admin",
    lastName: "Uno",
    shippingAddress: {
      fullName: "Admin Uno",
      street: "Via Admin 1",
      city: "Roma",
      province: "RM",
      postalCode: "00100",
      country: "IT",
    },
  };
  userProfilesStore["volunteer-1"] = {
    firstName: "Vol",
    lastName: "Uno",
    shippingAddress: {
      fullName: "Vol Uno",
      street: "Via Vol 1",
      city: "Milano",
      province: "MI",
      postalCode: "20100",
      country: "IT",
      phone: "333111",
    },
  };
  userProfilesStore["volunteer-2"] = {
    firstName: "Vol",
    lastName: "Due",
    shippingAddress: {
      fullName: "Vol Due",
      street: "Via Vol 2",
      city: "Torino",
      province: "TO",
      postalCode: "10100",
      country: "IT",
    },
  };

  deviceRequestsStore["req-assigned"] = {
    seqId: "R-1",
    assignedVolunteers: ["volunteer-1"],
    shippingAddress: {
      fullName: "Famiglia A",
      street: "Via Benef 1",
      city: "Napoli",
      province: "NA",
      postalCode: "80100",
      country: "IT",
    },
  };
  devicePrivateStore["req-assigned"] = { firstName: "Mario", lastName: "Rossi" };

  deviceRequestsStore["req-other"] = {
    seqId: "R-2",
    assignedVolunteers: ["volunteer-2"],
    shippingAddress: {
      street: "Via Altro 9",
      city: "Bari",
      province: "BA",
      postalCode: "70100",
      country: "IT",
    },
  };
  devicePrivateStore["req-other"] = { firstName: "Luigi", lastName: "Verdi" };

  shipmentRequestsStore["ship-pending"] = {
    status: "pending",
    createdBy: "volunteer-1",
    email: "volunteer-1@example.com",
    reason: "Kit",
    senderName: "A",
    senderAddress: "Addr A",
    recipientName: "B",
    recipientAddress: "Addr B",
  };
  shipmentRequestsStore["ship-approved"] = {
    status: "approved",
    createdBy: "volunteer-1",
    email: "volunteer-1@example.com",
    reason: "Kit",
    senderName: "A",
    senderAddress: "Addr A",
    recipientName: "B",
    recipientAddress: "Addr B",
  };
  shipmentRequestsStore["ship-transit"] = {
    status: "in_transit",
    createdBy: "volunteer-1",
    email: "volunteer-1@example.com",
    reason: "Kit",
    senderName: "A",
    senderAddress: "Addr A",
    recipientName: "B",
    recipientAddress: "Addr B",
    trackingNumber: "TRK-OLD",
  };
}
