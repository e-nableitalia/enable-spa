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
