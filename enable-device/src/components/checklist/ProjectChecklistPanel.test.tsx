import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ProjectChecklistPanel from "./ProjectChecklistPanel";

/** Vedi ChecklistPanel.test.tsx: jsdom non implementa getBoundingClientRect,
 * il pannello opzioni del Dropdown PrimeReact resta invisibile a getByRole. */
async function selectDropdownOption(user: ReturnType<typeof userEvent.setup>, trigger: HTMLElement, optionLabel: string) {
  await user.click(trigger);
  const option = (await screen.findByText(optionLabel)).closest("li");
  if (!option) throw new Error(`Dropdown option "${optionLabel}" not found`);
  fireEvent.click(option);
}

vi.mock("../../firebase", () => ({ db: {}, functions: {} }));

const callable = vi.fn();
vi.mock("firebase/functions", () => ({
  httpsCallable: (_functions: unknown, name: string) => (data: unknown) => callable(name, data),
}));

const firestoreDocs: Record<string, unknown> = {};
vi.mock("firebase/firestore", () => ({
  doc: (_db: unknown, ...segments: string[]) => ({ __path: segments.join("/") }),
  getDoc: async (ref: { __path: string }) => {
    const data = firestoreDocs[ref.__path];
    return { exists: () => data !== undefined, data: () => data };
  },
}));

afterEach(() => {
  for (const key of Object.keys(firestoreDocs)) delete firestoreDocs[key];
});

function mockChecklist(items: Array<Record<string, unknown>>) {
  callable.mockImplementation((name: string) => {
    if (name === "getProjectChecklist") {
      return Promise.resolve({ data: { checklistId: "checklist-1", title: "Checklist test", category: "progetto", items } });
    }
    if (name === "getProjectChecklistCompleteness") {
      return Promise.resolve({ data: { complete: false } });
    }
    if (name === "listAssignableProjectUsers") {
      return Promise.resolve({ data: { uids: [] } });
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

describe("ProjectChecklistPanel", () => {
  beforeEach(() => {
    callable.mockReset();
  });

  it("carica checklist e completezza per il progetto/checklist espliciti", async () => {
    mockChecklist([]);
    render(<ProjectChecklistPanel projectId="p1" checklistId="c1" />);

    expect(await screen.findByText("Checklist test")).toBeInTheDocument();
    expect(callable).toHaveBeenCalledWith("getProjectChecklist", { projectId: "p1", checklistId: "c1" });
    expect(callable).toHaveBeenCalledWith("getProjectChecklistCompleteness", { projectId: "p1", checklistId: "c1" });
  });

  it("un item type='numeric' mostra il campo Quantità, 'boolean' e 'generic' no", async () => {
    mockChecklist([
      { id: "i1", title: "Item bool", type: "boolean", assignee: null, quantity: null, notes: "", status: "Assegnare", completed: false },
      { id: "i2", title: "Item num", type: "numeric", assignee: null, quantity: 2, notes: "", status: "Assegnare", completed: false },
    ]);
    render(<ProjectChecklistPanel projectId="p1" checklistId="c1" />);

    const boolRow = await rowFor("Item bool");
    expect(within(boolRow).queryByRole("spinbutton")).not.toBeInTheDocument();
    const numRow = await rowFor("Item num");
    expect(within(numRow).getByRole("spinbutton")).toBeInTheDocument();
  });

  it("aggiunge un item tramite il dialog", async () => {
    mockChecklist([]);
    const user = userEvent.setup();
    render(<ProjectChecklistPanel projectId="p1" checklistId="c1" />);

    await screen.findByText("Checklist test");
    await user.click(screen.getByRole("button", { name: "Aggiungi item" }));
    const dialog = screen.getByRole("dialog");

    const titleInput = within(dialog).getAllByRole("textbox")[0];
    await user.type(titleInput, "Nuovo item");

    // Il tipo è richiesto per abilitare "Aggiungi" (coerente col backend, che
    // rifiuta un item senza type valido).
    const addButton = within(dialog).getByRole("button", { name: "Aggiungi" });
    expect(addButton).toBeDisabled();

    const typeTrigger = within(dialog).getByRole("button", { name: "Seleziona il tipo" });
    await selectDropdownOption(user, typeTrigger, "Generico");

    expect(addButton).not.toBeDisabled();
  });

  it("rimuove un item dopo conferma", async () => {
    mockChecklist([
      { id: "i1", title: "Da rimuovere", type: "generic", assignee: null, quantity: null, notes: "", status: "Assegnare", completed: false },
    ]);
    callable.mockImplementation((name: string) => {
      if (name === "getProjectChecklist") {
        return Promise.resolve({
          data: {
            checklistId: "c1",
            title: "Checklist test",
            category: "progetto",
            items: [{ id: "i1", title: "Da rimuovere", type: "generic", assignee: null, quantity: null, notes: "", status: "Assegnare", completed: false }],
          },
        });
      }
      if (name === "getProjectChecklistCompleteness") return Promise.resolve({ data: { complete: false } });
      if (name === "listAssignableProjectUsers") return Promise.resolve({ data: { uids: [] } });
      if (name === "removeProjectChecklistItem") return Promise.resolve({ data: { success: true } });
      return Promise.reject(new Error(`Unexpected callable invoked in test: ${name}`));
    });

    const user = userEvent.setup();
    render(<ProjectChecklistPanel projectId="p1" checklistId="c1" />);

    const row = await rowFor("Da rimuovere");
    // Bottone icon-only (icona "pi-trash"): nessuna etichetta testuale
    // accessibile via role (stesso pattern di ChecklistPanel.test.tsx).
    const removeButton = row.querySelector(".pi-trash")?.closest("button");
    if (!removeButton) throw new Error("Remove button not found");
    await user.click(removeButton);
    await user.click(await screen.findByRole("button", { name: "Rimuovi" }));

    expect(callable).toHaveBeenCalledWith("removeProjectChecklistItem", { projectId: "p1", checklistId: "c1", itemId: "i1" });
  });

  it("readOnly nasconde i pulsanti 'Aggiungi item' e la colonna Azioni, e disabilita i campi", async () => {
    mockChecklist([
      { id: "i1", title: "Item", type: "generic", assignee: null, quantity: null, notes: "", status: "Assegnare", completed: false },
    ]);
    render(<ProjectChecklistPanel projectId="p1" checklistId="c1" readOnly />);

    const row = await rowFor("Item");
    expect(screen.queryByRole("button", { name: "Aggiungi item" })).not.toBeInTheDocument();
    expect(row.querySelector(".pi-trash")).not.toBeInTheDocument();
    expect(within(row).getByDisplayValue("Item")).toBeDisabled();
  });

  it("genera un link di condivisione checklist progetto", async () => {
    mockChecklist([]);
    callable.mockImplementation((name: string) => {
      if (name === "getProjectChecklist") {
        return Promise.resolve({ data: { checklistId: "c1", title: "Checklist test", category: "progetto", items: [] } });
      }
      if (name === "getProjectChecklistCompleteness") return Promise.resolve({ data: { complete: false } });
      if (name === "listAssignableProjectUsers") return Promise.resolve({ data: { uids: [] } });
      if (name === "createProjectChecklistShareLink") {
        return Promise.resolve({ data: { token: "token-1", url: "https://app.e-nableitalia.it/project-checklist-share/token-1" } });
      }
      return Promise.reject(new Error(`Unexpected callable invoked in test: ${name}`));
    });

    const user = userEvent.setup();
    render(<ProjectChecklistPanel projectId="p1" checklistId="c1" />);

    await screen.findByText("Checklist test");
    await user.click(screen.getByRole("button", { name: "Genera link di condivisione" }));

    expect(callable).toHaveBeenCalledWith("createProjectChecklistShareLink", { projectId: "p1", checklistId: "c1" });
    expect(await screen.findByDisplayValue("https://app.e-nableitalia.it/project-checklist-share/token-1")).toBeInTheDocument();
  });

  it("importa item da testo creando un item boolean per ogni riga non vuota, in ordine", async () => {
    callable.mockImplementation((name: string) => {
      if (name === "getProjectChecklist") {
        return Promise.resolve({ data: { checklistId: "c1", title: "Checklist test", category: "progetto", items: [] } });
      }
      if (name === "getProjectChecklistCompleteness") return Promise.resolve({ data: { complete: false } });
      if (name === "listAssignableProjectUsers") return Promise.resolve({ data: { uids: [] } });
      if (name === "addProjectChecklistItem") return Promise.resolve({ data: { itemId: "new-item" } });
      return Promise.reject(new Error(`Unexpected callable invoked in test: ${name}`));
    });

    const user = userEvent.setup();
    render(<ProjectChecklistPanel projectId="p1" checklistId="c1" />);
    await screen.findByText("Checklist test");

    await user.click(screen.getByRole("button", { name: "Importa item" }));
    const dialog = screen.getByRole("dialog");
    await user.type(
      within(dialog).getByLabelText("Oppure incolla il testo (una riga per item)"),
      "Task A\n\nTask B"
    );
    await user.click(within(dialog).getByRole("button", { name: "Importa" }));

    const addCalls = callable.mock.calls.filter(([name]) => name === "addProjectChecklistItem");
    expect(addCalls).toHaveLength(2);
    expect(addCalls[0][1]).toMatchObject({
      projectId: "p1",
      checklistId: "c1",
      title: "Task A",
      type: "boolean",
    });
    expect(addCalls[1][1]).toMatchObject({
      projectId: "p1",
      checklistId: "c1",
      title: "Task B",
      type: "boolean",
    });
  });
});
