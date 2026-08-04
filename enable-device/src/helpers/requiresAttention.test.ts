import { describe, it, expect, vi, beforeEach } from "vitest";
import { setRequiresAttention } from "./requiresAttention";

vi.mock("../firebase", () => ({ db: {}, functions: {} }));

const updateDocMock = vi.fn().mockResolvedValue(undefined);
vi.mock("firebase/firestore", () => ({
  doc: (_db: unknown, ...segments: string[]) => ({ __path: segments.join("/") }),
  updateDoc: (...args: unknown[]) => updateDocMock(...args),
}));

const callable = vi.fn().mockResolvedValue({ data: {} });
vi.mock("firebase/functions", () => ({
  httpsCallable: (_functions: unknown, name: string) => (data: unknown) => callable(name, data),
}));

describe("setRequiresAttention (EA-105)", () => {
  beforeEach(() => {
    updateDocMock.mockClear();
    callable.mockClear();
  });

  it("Scenario 1: impostazione senza nota non viene eseguita", async () => {
    await expect(setRequiresAttention("req1", "inviata", true, "   ")).rejects.toThrow();
    expect(updateDocMock).not.toHaveBeenCalled();
    expect(callable).not.toHaveBeenCalled();
  });

  it("Scenario 2: impostazione con nota e notifiche opzionali", async () => {
    await setRequiresAttention("req1", "inviata", true, "manca la misura del moncone", {
      volunteers: true,
      telegram: false,
    });

    expect(updateDocMock).toHaveBeenCalledWith({ __path: "deviceRequests/req1" }, { requiresAttention: true });
    expect(callable).toHaveBeenCalledWith("changeStatus", {
      requestId: "req1",
      newStatus: "inviata",
      note: "⚠️ Richiede attenzione: manca la misura del moncone",
      notifica: { admin: true, volunteers: true, telegram: false },
    });
  });

  it("Scenario 3: rimozione senza nota obbligatoria, con nota fissa", async () => {
    await setRequiresAttention("req1", "inviata", false);

    expect(updateDocMock).toHaveBeenCalledWith({ __path: "deviceRequests/req1" }, { requiresAttention: false });
    expect(callable).toHaveBeenCalledWith("changeStatus", {
      requestId: "req1",
      newStatus: "inviata",
      note: "✅ Flag 'richiede attenzione' rimosso.",
    });
    const [, payload] = callable.mock.calls[0];
    expect(payload).not.toHaveProperty("notifica");
  });
});
