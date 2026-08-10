import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DeviceRequestChecklists from "./DeviceRequestChecklists";

vi.mock("../../firebase", () => ({ db: {}, functions: {} }));

const callable = vi.fn();
vi.mock("firebase/functions", () => ({
  httpsCallable: (_functions: unknown, name: string) => (data: unknown) => callable(name, data),
}));

vi.mock("firebase/firestore", () => ({
  collection: vi.fn(),
  doc: vi.fn(),
  getDoc: vi.fn().mockResolvedValue({ exists: () => false }),
  getDocs: vi.fn().mockResolvedValue({ docs: [] }),
}));

function mockChecklistLoad() {
  callable.mockImplementation((name: string, data: { checklistId?: string }) => {
    if (name === "getDeviceRequestChecklist") {
      return Promise.resolve({
        data: { checklistId: data.checklistId, title: `Titolo ${data.checklistId}`, category: "cat", items: [] },
      });
    }
    if (name === "getDeviceRequestChecklistCompleteness") {
      return Promise.resolve({ data: { complete: false } });
    }
    if (name === "createDeviceRequestChecklist") {
      return Promise.resolve({ data: { checklistId: "new-checklist" } });
    }
    if (name === "listTemplates") {
      return Promise.resolve({
        data: {
          templates: [
            { id: "template-a", title: "Template A" },
            { id: "template-b", title: "Template B" },
          ],
        },
      });
    }
    return Promise.reject(new Error(`Unexpected callable invoked in test: ${name}`));
  });
}

describe("DeviceRequestChecklists - vista a tab multi-checklist (EA-133)", () => {
  beforeEach(() => {
    callable.mockReset();
    mockChecklistLoad();
  });

  it("Scenario 1: una sola checklist collegata mostra una singola tab con quel checklistId", async () => {
    render(
      <DeviceRequestChecklists
        requestId="req1"
        checklistIds={["c1"]}
        onChecklistsChanged={vi.fn()}
      />
    );

    // Il pannello mostrato monta ChecklistPanel col checklistId esplicito: la
    // chiamata al backend deve portare quello specifico id, non un altro.
    // "Titolo c1" compare due volte una volta risolto (etichetta della tab,
    // vedi assert dedicato sotto, più il corpo del pannello).
    expect(await screen.findAllByText("Titolo c1")).toHaveLength(2);
    expect(callable).toHaveBeenCalledWith("getDeviceRequestChecklist", { requestId: "req1", checklistId: "c1" });

    // Una sola tab presente, etichettata col titolo reale (onTitleResolved)
    // invece del solo indice posizionale "Checklist 1" (bug segnalato
    // dall'operatore: la tab non rifletteva mai il titolo effettivo).
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(1);
    expect(screen.getByRole("tab", { name: "Titolo c1" })).toBeInTheDocument();
  });

  it("Scenario 2: più checklist collegate mostrano una tab per ciascuna, ognuna col proprio checklistId esplicito", async () => {
    const user = userEvent.setup();
    render(
      <DeviceRequestChecklists
        requestId="req1"
        checklistIds={["c1", "c2", "c3"]}
        onChecklistsChanged={vi.fn()}
      />
    );

    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(3);

    // Prima tab attiva di default: monta ChecklistPanel con checklistId "c1".
    expect(await screen.findAllByText("Titolo c1")).toHaveLength(2);

    // Passando alla seconda tab (ancora etichettata per indice: il suo
    // ChecklistPanel non è mai stato montato prima d'ora, onTitleResolved
    // non è ancora stato invocato), monta ChecklistPanel col checklistId
    // esplicito "c2".
    await user.click(screen.getByRole("tab", { name: "Checklist 2" }));
    expect(await screen.findAllByText("Titolo c2")).toHaveLength(2);
    expect(callable).toHaveBeenCalledWith("getDeviceRequestChecklist", { requestId: "req1", checklistId: "c2" });

    // La tab si rietichetta col titolo reale una volta risolto.
    expect(screen.getByRole("tab", { name: "Titolo c2" })).toBeInTheDocument();
  });

  it("Scenario 3: 'Crea checklist' resta disponibile con checklist esistenti e aggiunge una nuova tab senza errore", async () => {
    const user = userEvent.setup();
    const onChecklistsChanged = vi.fn();
    const { rerender } = render(
      <DeviceRequestChecklists
        requestId="req1"
        checklistIds={["c1"]}
        onChecklistsChanged={onChecklistsChanged}
      />
    );

    const createButton = screen.getByRole("button", { name: "Crea checklist di fabbricazione" });
    expect(createButton).not.toBeDisabled();

    await user.click(createButton);
    await user.click(await screen.findByRole("button", { name: "Crea" }));

    expect(callable).toHaveBeenCalledWith("createDeviceRequestChecklist", {
      requestId: "req1",
      title: undefined,
      templateId: null,
    });
    expect(onChecklistsChanged).toHaveBeenCalled();

    // Il genitore ricarica `checklistIds` (qui simulato via rerender): la nuova
    // checklist appare come tab aggiuntiva.
    rerender(
      <DeviceRequestChecklists
        requestId="req1"
        checklistIds={["c1", "new-checklist"]}
        onChecklistsChanged={onChecklistsChanged}
      />
    );
    expect(screen.getAllByRole("tab")).toHaveLength(2);
  });

  it("Scenario 5: al limite di cardinalità i pulsanti Crea/Clona sono disabilitati", () => {
    render(
      <DeviceRequestChecklists
        requestId="req1"
        checklistIds={["c1", "c2", "c3", "c4", "c5"]}
        onChecklistsChanged={vi.fn()}
      />
    );

    expect(screen.getByRole("button", { name: "Crea checklist di fabbricazione" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Clona da device simile" })).toBeDisabled();
  });

  it("Scenario 5 (fallback backend): un errore failed-precondition dalla creazione viene mostrato all'utente", async () => {
    // Difesa in profondità rispetto al solo disable client-side (es. race
    // condition tra due sessioni che creano contemporaneamente la 5a e la 6a
    // checklist): il messaggio del backend deve comunque emergere in UI.
    callable.mockImplementation((name: string) => {
      if (name === "createDeviceRequestChecklist") {
        return Promise.reject(new Error("This device request already has the maximum number of checklists (5)"));
      }
      return Promise.reject(new Error(`Unexpected callable invoked in test: ${name}`));
    });
    const user = userEvent.setup();
    render(
      <DeviceRequestChecklists
        requestId="req1"
        checklistIds={[]}
        onChecklistsChanged={vi.fn()}
      />
    );

    await user.click(screen.getByRole("button", { name: "Crea checklist di fabbricazione" }));
    await user.click(await screen.findByRole("button", { name: "Crea" }));

    expect(
      await screen.findByText("This device request already has the maximum number of checklists (5)")
    ).toBeInTheDocument();
  });

  it("Nessuna checklist collegata: mostra il messaggio vuoto e i pulsanti Crea/Clona abilitati", () => {
    render(
      <DeviceRequestChecklists requestId="req1" checklistIds={[]} onChecklistsChanged={vi.fn()} />
    );

    expect(screen.getByText("Nessuna checklist di fabbricazione collegata a questa richiesta.")).toBeInTheDocument();
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Crea checklist di fabbricazione" })).not.toBeDisabled();
  });
});

// Regressione (bug segnalato dall'operatore): il consumer deve poter
// scegliere esplicitamente un template tra quelli disponibili (o nessuno),
// invece di subire sempre l'auto-lookup del primo trovato dal backend, e
// poter impostare un titolo — nessuno dei due era possibile prima.
describe("DeviceRequestChecklists - dialog di creazione: scelta esplicita di template e titolo", () => {
  beforeEach(() => {
    callable.mockReset();
    mockChecklistLoad();
  });

  it("con un devicetype risolto, il dialog elenca i template disponibili (listTemplates) e passa il templateId scelto esplicitamente", async () => {
    const user = userEvent.setup();
    render(
      <DeviceRequestChecklists
        requestId="req1"
        checklistIds={[]}
        deviceType="Kinetic Hand"
        onChecklistsChanged={vi.fn()}
      />
    );

    await user.click(screen.getByRole("button", { name: "Crea checklist di fabbricazione" }));

    expect(callable).toHaveBeenCalledWith("listTemplates", { category: "Kinetic Hand" });

    const dropdownTrigger = await screen.findByRole("button", { name: "Seleziona un template" });
    await user.click(dropdownTrigger);
    await user.click(await screen.findByText("Template B"));

    await user.click(screen.getByRole("button", { name: "Crea" }));

    expect(callable).toHaveBeenCalledWith("createDeviceRequestChecklist", {
      requestId: "req1",
      title: undefined,
      templateId: "template-b",
    });
  });

  it("un titolo digitato dall'operatore viene passato esattamente al backend, non sovrascritto", async () => {
    const user = userEvent.setup();
    render(
      <DeviceRequestChecklists requestId="req1" checklistIds={[]} onChecklistsChanged={vi.fn()} />
    );

    await user.click(screen.getByRole("button", { name: "Crea checklist di fabbricazione" }));
    await user.type(screen.getByLabelText("Titolo"), "Checklist collaudo");
    await user.click(screen.getByRole("button", { name: "Crea" }));

    expect(callable).toHaveBeenCalledWith("createDeviceRequestChecklist", {
      requestId: "req1",
      title: "Checklist collaudo",
      templateId: null,
    });
  });

  it("senza devicetype risolto sulla richiesta, non chiama listTemplates e resta disponibile solo l'opzione 'checklist vuota'", async () => {
    const user = userEvent.setup();
    render(
      <DeviceRequestChecklists requestId="req1" checklistIds={[]} onChecklistsChanged={vi.fn()} />
    );

    await user.click(screen.getByRole("button", { name: "Crea checklist di fabbricazione" }));

    expect(callable).not.toHaveBeenCalledWith("listTemplates", expect.anything());
    // Il testo compare due volte nel markup del Dropdown (span visibile +
    // option nascosta per l'accessibilità nativa del <select>): basta che
    // sia presente almeno una volta.
    expect(
      screen.getAllByText("Nessun devicetype su questa richiesta: solo checklist vuota").length
    ).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: "Crea" }));

    expect(callable).toHaveBeenCalledWith("createDeviceRequestChecklist", {
      requestId: "req1",
      title: undefined,
      templateId: null,
    });
  });
});
