import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ChecklistPanel from "./ChecklistPanel";

/**
 * PrimeReact Dropdown posiziona il pannello opzioni con una misurazione del
 * layout (getBoundingClientRect) che jsdom non implementa: il pannello resta
 * con `display: none` anche a selezione avvenuta, quindi `getByRole` (che
 * esclude gli elementi non accessibili) non lo trova. Si individua l'opzione
 * per testo e si simula il click direttamente sul nodo, bypassando il filtro
 * di visibilità di `getByRole` — la selezione stessa (`onOptionClick`) non
 * dipende dal CSS del pannello.
 */
async function selectDropdownOption(user: ReturnType<typeof userEvent.setup>, trigger: HTMLElement, optionLabel: string) {
  await user.click(trigger);
  const option = (await screen.findByText(optionLabel)).closest("li");
  if (!option) throw new Error(`Dropdown option "${optionLabel}" not found`);
  fireEvent.click(option);
}

vi.mock("../../firebase", () => ({ functions: {} }));

const callable = vi.fn();
vi.mock("firebase/functions", () => ({
  httpsCallable: (_functions: unknown, name: string) => (data: unknown) => callable(name, data),
}));

function mockChecklist(items: Array<Record<string, unknown>>) {
  callable.mockImplementation((name: string) => {
    if (name === "getDeviceRequestChecklist") {
      return Promise.resolve({
        data: { checklistId: "checklist-1", title: "Checklist test", category: "cat", items },
      });
    }
    if (name === "getDeviceRequestChecklistCompleteness") {
      return Promise.resolve({ data: { complete: false } });
    }
    return Promise.reject(new Error(`Unexpected callable invoked in test: ${name}`));
  });
}

async function rowFor(title: string) {
  const input = await screen.findByDisplayValue(title);
  const row = input.closest("tr");
  if (!row) throw new Error(`Row not found for item "${title}"`);
  return row;
}

describe("ChecklistPanel - colonna Quantità condizionale sul type dell'item", () => {
  beforeEach(() => {
    callable.mockReset();
  });

  it("Scenario 1: un item con type='boolean' non mostra la colonna Quantità", async () => {
    mockChecklist([
      {
        id: "i1",
        title: "Verifica batteria",
        type: "boolean",
        assignee: null,
        quantity: null,
        notes: "",
        status: "Assegnare",
        completed: false,
      },
    ]);

    render(<ChecklistPanel requestId="r1" checklistId="c1" />);

    const row = await rowFor("Verifica batteria");
    expect(within(row).queryByRole("spinbutton")).not.toBeInTheDocument();
  });

  it("Scenario 2: un item con type='numeric' mostra la colonna Quantità editabile", async () => {
    mockChecklist([
      {
        id: "i2",
        title: "Cavo USB",
        type: "numeric",
        assignee: null,
        quantity: 3,
        notes: "",
        status: "Assegnare",
        completed: false,
      },
    ]);

    render(<ChecklistPanel requestId="r1" checklistId="c1" />);

    const row = await rowFor("Cavo USB");
    expect(within(row).getByRole("spinbutton")).toBeInTheDocument();
  });

  it("Scenario 3: un item con type='generic' non mostra la colonna Quantità", async () => {
    mockChecklist([
      {
        id: "i3",
        title: "Consegna a domicilio",
        type: "generic",
        assignee: null,
        quantity: null,
        notes: "",
        status: "Assegnare",
        completed: false,
      },
    ]);

    render(<ChecklistPanel requestId="r1" checklistId="c1" />);

    const row = await rowFor("Consegna a domicilio");
    expect(within(row).queryByRole("spinbutton")).not.toBeInTheDocument();
  });

  it("Scenario 4: la form di aggiunta nuovo item mostra il campo Quantità solo per type='numeric'", async () => {
    mockChecklist([]);
    const user = userEvent.setup();

    render(<ChecklistPanel requestId="r1" checklistId="c1" />);
    await screen.findByText("Nessun item nella checklist.");

    await user.click(screen.getByRole("button", { name: "Aggiungi item" }));
    const dialog = screen.getByRole("dialog");

    // Nessun type selezionato: il campo Quantità non è mostrato.
    expect(within(dialog).queryByRole("spinbutton")).not.toBeInTheDocument();

    const typeTrigger = within(dialog).getByRole("button", { name: "Seleziona il tipo" });

    // type='boolean': il campo Quantità resta nascosto.
    await selectDropdownOption(user, typeTrigger, "Sì/No");
    expect(within(dialog).queryByRole("spinbutton")).not.toBeInTheDocument();

    // type='generic': il campo Quantità resta nascosto.
    await selectDropdownOption(user, typeTrigger, "Generico");
    expect(within(dialog).queryByRole("spinbutton")).not.toBeInTheDocument();

    // type='numeric': il campo Quantità viene mostrato.
    await selectDropdownOption(user, typeTrigger, "Quantità numerica");
    expect(within(dialog).getByRole("spinbutton")).toBeInTheDocument();
  });

  it("Il bottone 'Aggiungi' resta disabilitato finché non è selezionato un Tipo, anche con il Titolo compilato", async () => {
    mockChecklist([]);
    const user = userEvent.setup();

    render(<ChecklistPanel requestId="r1" checklistId="c1" />);
    await screen.findByText("Nessun item nella checklist.");

    await user.click(screen.getByRole("button", { name: "Aggiungi item" }));
    const dialog = screen.getByRole("dialog");
    const addButton = within(dialog).getByRole("button", { name: "Aggiungi" });

    // Solo Titolo compilato (primo campo testuale del dialog), nessun Tipo
    // selezionato: il bottone resta disabilitato.
    const titleInput = within(dialog).getAllByRole("textbox")[0];
    await user.type(titleInput, "Verifica dita");
    expect(addButton).toBeDisabled();

    // Selezionato un Tipo: il bottone si abilita.
    const typeTrigger = within(dialog).getByRole("button", { name: "Seleziona il tipo" });
    await selectDropdownOption(user, typeTrigger, "Generico");
    expect(addButton).not.toBeDisabled();
  });
});

describe("ChecklistPanel - checklistId esplicito inoltrato a tutte le Cloud Function (EA-131/EA-133)", () => {
  beforeEach(() => {
    callable.mockReset();
  });

  function mockChecklistWithId(checklistId: string, items: Array<Record<string, unknown>>) {
    callable.mockImplementation((name: string) => {
      if (name === "getDeviceRequestChecklist") {
        return Promise.resolve({ data: { checklistId, title: "Checklist test", category: "cat", items } });
      }
      if (name === "getDeviceRequestChecklistCompleteness") {
        return Promise.resolve({ data: { complete: false } });
      }
      if (name === "addDeviceRequestChecklistItem") {
        return Promise.resolve({ data: { itemId: "new-item" } });
      }
      if (name === "updateDeviceRequestChecklistItem") {
        return Promise.resolve({ data: {} });
      }
      if (name === "removeDeviceRequestChecklistItem") {
        return Promise.resolve({ data: {} });
      }
      if (name === "createChecklistShareLink") {
        return Promise.resolve({ data: { token: "tok", url: "https://example.test/share/tok" } });
      }
      return Promise.reject(new Error(`Unexpected callable invoked in test: ${name}`));
    });
  }

  it("il caricamento invia il checklistId esplicito del pannello, non un altro", async () => {
    mockChecklistWithId("c42", []);
    render(<ChecklistPanel requestId="r1" checklistId="c42" />);
    await screen.findByText("Nessun item nella checklist.");

    expect(callable).toHaveBeenCalledWith("getDeviceRequestChecklist", { requestId: "r1", checklistId: "c42" });
    expect(callable).toHaveBeenCalledWith("getDeviceRequestChecklistCompleteness", { requestId: "r1", checklistId: "c42" });
  });

  it("l'aggiunta di un item invia il checklistId esplicito del pannello", async () => {
    mockChecklistWithId("c42", []);
    const user = userEvent.setup();
    render(<ChecklistPanel requestId="r1" checklistId="c42" />);
    await screen.findByText("Nessun item nella checklist.");

    await user.click(screen.getByRole("button", { name: "Aggiungi item" }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getAllByRole("textbox")[0], "Verifica dita");
    const typeTrigger = within(dialog).getByRole("button", { name: "Seleziona il tipo" });
    await selectDropdownOption(user, typeTrigger, "Generico");
    await user.click(within(dialog).getByRole("button", { name: "Aggiungi" }));

    expect(callable).toHaveBeenCalledWith(
      "addDeviceRequestChecklistItem",
      expect.objectContaining({ requestId: "r1", checklistId: "c42" })
    );
  });

  // Regressione F-17: modificare un campo deve abilitare "Salva" e il click
  // deve effettivamente inviare l'update (in precedenza la memoizzazione di
  // PrimeReact DataTable ignorava lo stato locale "drafts", rendendo il
  // bottone "Salva" permanentemente disabilitato).
  it("modificare il titolo abilita 'Salva' e invia l'update con il checklistId esplicito del pannello", async () => {
    mockChecklistWithId("c42", [
      { id: "i1", title: "Verifica batteria", type: "generic", assignee: null, quantity: null, notes: "", status: "Assegnare", completed: false },
    ]);
    const user = userEvent.setup();
    render(<ChecklistPanel requestId="r1" checklistId="c42" />);
    const row = await rowFor("Verifica batteria");

    const saveButton = row.querySelector(".pi-save")?.closest("button");
    if (!saveButton) throw new Error("Save button not found");
    expect(saveButton).toBeDisabled();

    const titleInput = within(row).getByDisplayValue("Verifica batteria");
    await user.clear(titleInput);
    await user.type(titleInput, "Verifica batteria (aggiornato)");
    expect(within(row).getByDisplayValue("Verifica batteria (aggiornato)")).toBeInTheDocument();
    expect(saveButton).not.toBeDisabled();

    await user.click(saveButton);

    expect(callable).toHaveBeenCalledWith(
      "updateDeviceRequestChecklistItem",
      expect.objectContaining({ requestId: "r1", checklistId: "c42", itemId: "i1", title: "Verifica batteria (aggiornato)" })
    );
  });

  it("la rimozione di un item invia il checklistId esplicito del pannello", async () => {
    mockChecklistWithId("c42", [
      { id: "i1", title: "Verifica batteria", type: "generic", assignee: null, quantity: null, notes: "", status: "Assegnare", completed: false },
    ]);
    const user = userEvent.setup();
    render(<ChecklistPanel requestId="r1" checklistId="c42" />);
    const row = await rowFor("Verifica batteria");
    // Bottone icon-only (icona "pi-trash"): nessun'etichetta testuale accessibile via role.
    const removeButton = row.querySelector(".pi-trash")?.closest("button");
    if (!removeButton) throw new Error("Remove button not found");
    await user.click(removeButton);
    const confirmButton = await screen.findByRole("button", { name: "Rimuovi" });
    fireEvent.click(confirmButton);

    expect(callable).toHaveBeenCalledWith(
      "removeDeviceRequestChecklistItem",
      expect.objectContaining({ requestId: "r1", checklistId: "c42", itemId: "i1" })
    );
  });

  it("la generazione del link di condivisione invia il checklistId esplicito del pannello", async () => {
    mockChecklistWithId("c42", []);
    const user = userEvent.setup();
    render(<ChecklistPanel requestId="r1" checklistId="c42" />);
    await screen.findByText("Nessun item nella checklist.");

    await user.click(screen.getByRole("button", { name: "Genera link di condivisione" }));

    expect(callable).toHaveBeenCalledWith(
      "createChecklistShareLink",
      expect.objectContaining({ requestId: "r1", checklistId: "c42" })
    );
  });
});

describe("ChecklistPanel - controllo 'Completato' per item boolean (EA-146)", () => {
  beforeEach(() => {
    callable.mockReset();
  });

  it('Scenario 1: un item type="boolean" con completed=false mostra il controllo "Completato" non selezionato', async () => {
    mockChecklist([
      { id: "i1", title: "Verifica batteria", type: "boolean", assignee: null, quantity: null, notes: "", status: "Assegnare", completed: false },
    ]);

    render(<ChecklistPanel requestId="r1" checklistId="c1" />);

    const row = await rowFor("Verifica batteria");
    const checkbox = within(row).getByRole("checkbox");
    expect(checkbox).toBeInTheDocument();
    expect(checkbox).not.toBeChecked();
  });

  it('Scenario 2: item type="generic" e type="numeric" non mostrano il controllo "Completato"', async () => {
    mockChecklist([
      { id: "i1", title: "Consegna a domicilio", type: "generic", assignee: null, quantity: null, notes: "", status: "Assegnare", completed: false },
      { id: "i2", title: "Cavo USB", type: "numeric", assignee: null, quantity: 3, notes: "", status: "Assegnare", completed: false },
    ]);

    render(<ChecklistPanel requestId="r1" checklistId="c1" />);

    const genericRow = await rowFor("Consegna a domicilio");
    expect(within(genericRow).queryByRole("checkbox")).not.toBeInTheDocument();

    const numericRow = await rowFor("Cavo USB");
    expect(within(numericRow).queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it('Scenario 3: un item type="boolean" con completed=true mostra il controllo "Completato" selezionato', async () => {
    mockChecklist([
      { id: "i1", title: "Verifica batteria", type: "boolean", assignee: null, quantity: null, notes: "", status: "Assegnare", completed: true },
    ]);

    render(<ChecklistPanel requestId="r1" checklistId="c1" />);

    const row = await rowFor("Verifica batteria");
    expect(within(row).getByRole("checkbox")).toBeChecked();
  });

  it('Scenario 4: selezionare il controllo "Completato" e salvare invia completed=true a updateDeviceRequestChecklistItem, e dopo il reload il controllo risulta selezionato', async () => {
    const item = { id: "i1", title: "Verifica batteria", type: "boolean", assignee: null, quantity: null, notes: "", status: "Assegnare", completed: false };
    callable.mockImplementation((name: string, data: unknown) => {
      if (name === "getDeviceRequestChecklist") {
        return Promise.resolve({ data: { checklistId: "c1", title: "Checklist test", category: "cat", items: [item] } });
      }
      if (name === "getDeviceRequestChecklistCompleteness") {
        return Promise.resolve({ data: { complete: false } });
      }
      if (name === "updateDeviceRequestChecklistItem") {
        const patch = data as { completed?: boolean };
        item.completed = Boolean(patch.completed);
        return Promise.resolve({ data: { success: true } });
      }
      return Promise.reject(new Error(`Unexpected callable invoked in test: ${name}`));
    });

    const user = userEvent.setup();
    render(<ChecklistPanel requestId="r1" checklistId="c1" />);
    const row = await rowFor("Verifica batteria");

    const checkbox = within(row).getByRole("checkbox");
    expect(checkbox).not.toBeChecked();
    await user.click(checkbox);
    expect(checkbox).toBeChecked();

    const saveButton = row.querySelector(".pi-save")?.closest("button");
    if (!saveButton) throw new Error("Save button not found");
    expect(saveButton).not.toBeDisabled();
    await user.click(saveButton);

    expect(callable).toHaveBeenCalledWith(
      "updateDeviceRequestChecklistItem",
      expect.objectContaining({
        requestId: "r1",
        checklistId: "c1",
        itemId: "i1",
        title: "Verifica batteria",
        assignee: null,
        quantity: null,
        notes: "",
        status: "Assegnare",
        completed: true,
      })
    );

    const reloadedRow = await rowFor("Verifica batteria");
    expect(within(reloadedRow).getByRole("checkbox")).toBeChecked();
  });
});
