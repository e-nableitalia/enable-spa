import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import RequestDetail from "./RequestDetail";

vi.mock("react-router-dom", () => ({ useParams: () => ({ id: "req1" }) }));
vi.mock("../../../firebase", () => ({ db: {}, functions: {}, auth: {} }));

const callable = vi.fn().mockResolvedValue({ data: {} });
vi.mock("firebase/functions", () => ({
  httpsCallable: (_functions: unknown, name: string) => (data: unknown) => callable(name, data),
}));

const firestoreDocs: Record<string, unknown> = {};
const firestoreCollections: Record<string, unknown[]> = {};
const updateDocMock = vi.fn().mockResolvedValue(undefined);

vi.mock("firebase/firestore", () => ({
  doc: (_db: unknown, ...segments: string[]) => ({ __path: segments.join("/") }),
  collection: (_db: unknown, ...segments: string[]) => ({ __path: segments.join("/") }),
  query: (ref: unknown) => ref,
  orderBy: () => undefined,
  updateDoc: (ref: { __path: string }, data: Record<string, unknown>) => {
    updateDocMock(ref, data);
    firestoreDocs[ref.__path] = { ...(firestoreDocs[ref.__path] as Record<string, unknown> | undefined), ...data };
    return Promise.resolve(undefined);
  },
  serverTimestamp: () => "SERVER_TIMESTAMP",
  getDoc: async (ref: { __path: string }) => {
    const data = firestoreDocs[ref.__path];
    return { exists: () => data !== undefined, data: () => data };
  },
  getDocs: async (ref: { __path: string }) => {
    const items = firestoreCollections[ref.__path] ?? [];
    return { docs: items.map((d, i) => ({ id: (d as { id?: string }).id ?? String(i), data: () => d })) };
  },
}));

vi.mock("../../../components/checklist/DeviceRequestChecklists", () => ({
  default: (props: { requestId: string; checklistIds: string[] }) => (
    <div
      data-testid="checklists"
      data-request-id={props.requestId}
      data-checklist-ids={JSON.stringify(props.checklistIds)}
    />
  ),
}));

function setRequestDoc(data: Record<string, unknown>) {
  firestoreDocs["deviceRequests/req1"] = data;
  firestoreDocs["deviceRequests/req1/private/data"] = undefined;
  firestoreDocs["publicDeviceRequests/req1"] = undefined;
  firestoreCollections["deviceRequests/req1/events"] = [];
  firestoreCollections["users"] = [];
}

describe("RequestDetail (admin) - vista a tab multi-checklist (EA-133)", () => {
  beforeEach(() => {
    for (const key of Object.keys(firestoreDocs)) delete firestoreDocs[key];
    for (const key of Object.keys(firestoreCollections)) delete firestoreCollections[key];
    callable.mockClear();
    updateDocMock.mockClear();
  });

  it("Scenario 1: una sola checklist collegata viene passata come unico checklistId alla vista a tab", async () => {
    setRequestDoc({ requestNumber: "42", checklistIds: ["c1"], assignedVolunteers: [] });
    render(<RequestDetail />);

    const checklists = await screen.findByTestId("checklists");
    expect(checklists).toHaveAttribute("data-request-id", "req1");
    expect(checklists).toHaveAttribute("data-checklist-ids", JSON.stringify(["c1"]));
  });

  it("Scenario 2: più checklist collegate vengono passate tutte alla vista a tab", async () => {
    setRequestDoc({ requestNumber: "42", checklistIds: ["c1", "c2", "c3"], assignedVolunteers: [] });
    render(<RequestDetail />);

    const checklists = await screen.findByTestId("checklists");
    expect(checklists).toHaveAttribute("data-checklist-ids", JSON.stringify(["c1", "c2", "c3"]));
  });
});

describe("RequestDetail (admin) - flag requiresAttention condiviso (EA-105)", () => {
  beforeEach(() => {
    for (const key of Object.keys(firestoreDocs)) delete firestoreDocs[key];
    for (const key of Object.keys(firestoreCollections)) delete firestoreCollections[key];
    callable.mockClear();
    updateDocMock.mockClear();
  });

  it("Scenario 1: impostazione del flag richiede nota obbligatoria", async () => {
    const user = userEvent.setup();
    setRequestDoc({ requestNumber: "42", status: "famiglia contattata", assignedVolunteers: [] });
    render(<RequestDetail />);

    await user.click(await screen.findByRole("button", { name: "Segnala" }));
    const confirmButton = await screen.findByRole("button", { name: "Conferma" });
    expect(confirmButton).toBeDisabled();

    await user.click(confirmButton);
    expect(updateDocMock).not.toHaveBeenCalled();
    expect(callable).not.toHaveBeenCalledWith("changeStatus", expect.anything());
  });

  it("Scenario 2: impostazione del flag con nota e notifiche opzionali", async () => {
    const user = userEvent.setup();
    setRequestDoc({ requestNumber: "42", status: "famiglia contattata", assignedVolunteers: [] });
    render(<RequestDetail />);

    await user.click(await screen.findByRole("button", { name: "Segnala" }));
    await user.type(await screen.findByPlaceholderText("Motivo attenzione..."), "manca la misura del moncone");
    await user.click(screen.getByLabelText("Volontari assegnati"));
    await user.click(screen.getByLabelText("Gruppo Telegram"));
    await user.click(screen.getByRole("button", { name: "Conferma" }));

    expect(updateDocMock).toHaveBeenCalledWith({ __path: "deviceRequests/req1" }, { requiresAttention: true });
    expect(callable).toHaveBeenCalledWith("changeStatus", {
      requestId: "req1",
      newStatus: "famiglia contattata",
      note: "⚠️ Richiede attenzione: manca la misura del moncone",
      notifica: { admin: true, volunteers: true, telegram: true },
    });
    expect(await screen.findByText("⚠️ Sì")).toBeInTheDocument();
  });

  it("Scenario 3: rimozione del flag senza dialog né nota obbligatoria", async () => {
    const user = userEvent.setup();
    setRequestDoc({ requestNumber: "42", status: "famiglia contattata", requiresAttention: true, assignedVolunteers: [] });
    render(<RequestDetail />);

    expect(screen.queryByText("⚠️ Segnala richiede attenzione")).not.toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "Rimuovi flag" }));

    expect(updateDocMock).toHaveBeenCalledWith({ __path: "deviceRequests/req1" }, { requiresAttention: false });
    expect(callable).toHaveBeenCalledWith("changeStatus", {
      requestId: "req1",
      newStatus: "famiglia contattata",
      note: "✅ Flag 'richiede attenzione' rimosso.",
    });
    const [, payload] = callable.mock.calls.find(([name]) => name === "changeStatus")!;
    expect(payload).not.toHaveProperty("notifica");
  });

  it("Scenario 4 (non regressione): il flag non viene rimosso da un cambio di stato tramite un percorso diverso", async () => {
    const user = userEvent.setup();
    setRequestDoc({ requestNumber: "42", status: "famiglia contattata", requiresAttention: true, assignedVolunteers: [] });
    render(<RequestDetail />);

    expect(await screen.findByText("⚠️ Sì")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Cambia Stato" }));
    await user.click(await screen.findByRole("button", { name: "Conferma" }));

    expect(callable).toHaveBeenCalledWith("changeStatus", expect.objectContaining({ requestId: "req1" }));
    expect(updateDocMock.mock.calls.some(([, payload]) => payload && Object.prototype.hasOwnProperty.call(payload, "requiresAttention"))).toBe(false);
    expect(await screen.findByText("⚠️ Sì")).toBeInTheDocument();
  });
});

describe("RequestDetail (admin) - handleValidate non scrive più publicStatus (EA-149)", () => {
  beforeEach(() => {
    for (const key of Object.keys(firestoreDocs)) delete firestoreDocs[key];
    for (const key of Object.keys(firestoreCollections)) delete firestoreCollections[key];
    callable.mockClear();
    updateDocMock.mockClear();
  });

  it("Scenario 2: valida una richiesta 'inviata' senza scrivere publicStatus, e la porta a status 'validata'", async () => {
    const user = userEvent.setup();
    setRequestDoc({ requestNumber: "42", status: "inviata", assignedVolunteers: [] });
    render(<RequestDetail />);

    await user.click(await screen.findByRole("button", { name: "Valida richiesta" }));
    await user.click(await screen.findByRole("button", { name: "Conferma validazione" }));

    expect(callable).toHaveBeenCalledWith("changeStatus", {
      requestId: "req1",
      newStatus: "validata",
      note: "Richiesta validata dall'amministratore.",
    });

    const publicWrites = updateDocMock.mock.calls.filter(
      ([ref]) => (ref as { __path: string }).__path === "publicDeviceRequests/req1"
    );
    expect(publicWrites.length).toBeGreaterThan(0);
    for (const [, payload] of publicWrites) {
      expect(payload).not.toHaveProperty("publicStatus");
    }
  });
});

describe("RequestDetail (admin) - invio email documenti alla famiglia (EA-160)", () => {
  beforeEach(() => {
    for (const key of Object.keys(firestoreDocs)) delete firestoreDocs[key];
    for (const key of Object.keys(firestoreCollections)) delete firestoreCollections[key];
    callable.mockClear();
    callable.mockResolvedValue({ data: {} });
    updateDocMock.mockClear();
  });

  // Scenario 1 EA-160: email valorizzata + documentsEmailSent === false -> abilitato
  it("Scenario 1: command button abilitato con email valorizzata e invio non ancora effettuato", async () => {
    setRequestDoc({ requestNumber: "42", documentsEmailSent: false, assignedVolunteers: [] });
    firestoreDocs["deviceRequests/req1/private/data"] = { email: "famiglia@example.com" };
    render(<RequestDetail />);

    expect(await screen.findByRole("button", { name: "Invia documenti" })).toBeEnabled();
  });

  // Scenario 2 EA-160: email assente/vuota -> disabilitato
  it("Scenario 2: command button disabilitato se l'email privata non è valorizzata", async () => {
    setRequestDoc({ requestNumber: "42", documentsEmailSent: false, assignedVolunteers: [] });
    firestoreDocs["deviceRequests/req1/private/data"] = { email: "" };
    render(<RequestDetail />);

    expect(await screen.findByRole("button", { name: "Invia documenti" })).toBeDisabled();
  });

  it("Scenario 2b: command button disabilitato se non esiste alcun documento private/data", async () => {
    setRequestDoc({ requestNumber: "42", documentsEmailSent: false, assignedVolunteers: [] });
    render(<RequestDetail />);

    expect(await screen.findByRole("button", { name: "Invia documenti" })).toBeDisabled();
  });

  // Scenario 3 EA-160: documentsEmailSent === true -> disabilitato indipendentemente dall'email
  it("Scenario 3: command button disabilitato se l'invio è già stato effettuato, anche con email valorizzata", async () => {
    setRequestDoc({ requestNumber: "42", documentsEmailSent: true, assignedVolunteers: [] });
    firestoreDocs["deviceRequests/req1/private/data"] = { email: "famiglia@example.com" };
    render(<RequestDetail />);

    expect(await screen.findByRole("button", { name: "Invia documenti" })).toBeDisabled();
  });

  // Scenario 4 EA-160: click invoca la Cloud Function e ricarica il flag aggiornato
  it("Scenario 4: click sul command button invoca sendDocumentsEmail e ricarica documentsEmailSent", async () => {
    const user = userEvent.setup();
    setRequestDoc({ requestNumber: "42", documentsEmailSent: false, assignedVolunteers: [] });
    firestoreDocs["deviceRequests/req1/private/data"] = { email: "famiglia@example.com" };
    callable.mockImplementationOnce(async (name: string) => {
      if (name === "sendDocumentsEmail") {
        firestoreDocs["deviceRequests/req1"] = {
          ...(firestoreDocs["deviceRequests/req1"] as Record<string, unknown>),
          documentsEmailSent: true,
        };
      }
      return { data: { success: true } };
    });
    render(<RequestDetail />);

    const button = await screen.findByRole("button", { name: "Invia documenti" });
    await user.click(button);

    expect(callable).toHaveBeenCalledWith("sendDocumentsEmail", { requestId: "req1" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Invia documenti" })).toBeDisabled());
  });

  // Scenario 5 EA-160 (lato UI): il pulsante si disabilita già durante l'invio
  // in corso, prima ancora che la callable risolva — la garanzia "un solo
  // invio riuscito" resta comunque della Cloud Function (vedi
  // sendDocumentsEmail.test.ts, claim in transazione), qui si verifica solo
  // che un secondo click nella stessa finestra non possa partire dalla UI.
  it("Scenario 5 (UI): il command button si disabilita mentre l'invio è in corso, impedendo un secondo click immediato", async () => {
    const user = userEvent.setup();
    setRequestDoc({ requestNumber: "42", documentsEmailSent: false, assignedVolunteers: [] });
    firestoreDocs["deviceRequests/req1/private/data"] = { email: "famiglia@example.com" };
    let resolveCallable: (() => void) | undefined;
    callable.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveCallable = () => resolve({ data: { success: true } });
        })
    );
    render(<RequestDetail />);

    const button = await screen.findByRole("button", { name: "Invia documenti" });
    await user.click(button);

    await waitFor(() => expect(screen.getByRole("button", { name: "Invia documenti" })).toBeDisabled());
    expect(callable).toHaveBeenCalledTimes(1);

    resolveCallable?.();
  });
});
