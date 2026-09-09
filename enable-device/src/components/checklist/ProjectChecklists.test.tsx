import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ProjectChecklists from "./ProjectChecklists";

async function selectDropdownOption(user: ReturnType<typeof userEvent.setup>, trigger: HTMLElement, optionLabel: string) {
  await user.click(trigger);
  const candidates = await screen.findAllByText(optionLabel);
  const option = candidates.map((el) => el.closest("li")).find((li) => li?.getAttribute("role") === "option");
  if (!option) throw new Error(`Dropdown option "${optionLabel}" not found`);
  fireEvent.click(option);
}

vi.mock("../../firebase", () => ({ db: {}, functions: {} }));

const callable = vi.fn();
vi.mock("firebase/functions", () => ({
  httpsCallable: (_functions: unknown, name: string) => (data: unknown) => callable(name, data),
}));

vi.mock("firebase/firestore", () => ({
  doc: vi.fn(),
  getDoc: vi.fn().mockResolvedValue({ exists: () => false }),
}));

function mockChecklistLoad() {
  callable.mockImplementation((name: string, data: { checklistId?: string }) => {
    if (name === "getProjectChecklist") {
      return Promise.resolve({
        data: { checklistId: data.checklistId, title: `Titolo ${data.checklistId}`, category: "progetto", items: [] },
      });
    }
    if (name === "getProjectChecklistCompleteness") {
      return Promise.resolve({ data: { complete: false } });
    }
    if (name === "createProjectChecklist") {
      return Promise.resolve({ data: { checklistId: "new-checklist" } });
    }
    if (name === "listAssignableProjectUsers") {
      return Promise.resolve({ data: { uids: [] } });
    }
    if (name === "listTemplates") {
      return Promise.resolve({ data: { templates: [] } });
    }
    return Promise.reject(new Error(`Unexpected callable invoked in test: ${name}`));
  });
}

describe("ProjectChecklists - vista a tab delle checklist di un progetto", () => {
  beforeEach(() => {
    callable.mockReset();
    mockChecklistLoad();
  });

  it("una checklist collegata mostra una tab etichettata col label", async () => {
    render(
      <ProjectChecklists
        projectId="p1"
        checklists={[{ checklistId: "c1", label: "Fase 1" }]}
        projectType="progetto"
        onChecklistsChanged={vi.fn()}
      />
    );

    expect(screen.getByRole("tab", { name: "Fase 1" })).toBeInTheDocument();
    expect(await screen.findAllByText("Titolo c1")).not.toHaveLength(0);
    expect(callable).toHaveBeenCalledWith("getProjectChecklist", { projectId: "p1", checklistId: "c1" });
  });

  it("nessuna checklist collegata mostra il messaggio vuoto", () => {
    render(
      <ProjectChecklists projectId="p1" checklists={[]} projectType="progetto" onChecklistsChanged={vi.fn()} />
    );

    expect(screen.getByText("Nessuna checklist collegata a questo progetto.")).toBeInTheDocument();
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
  });

  it("'Crea checklist' invoca createProjectChecklist con label/title/projectType e ricarica il genitore", async () => {
    const user = userEvent.setup();
    const onChecklistsChanged = vi.fn();
    render(
      <ProjectChecklists projectId="p1" checklists={[]} projectType="evento" onChecklistsChanged={onChecklistsChanged} />
    );

    await user.click(screen.getByRole("button", { name: "Crea checklist" }));
    await user.type(screen.getByLabelText("Etichetta tab"), "Fase 1");
    await user.click(screen.getByRole("button", { name: "Crea" }));

    expect(callable).toHaveBeenCalledWith("createProjectChecklist", {
      projectId: "p1",
      label: "Fase 1",
      title: "Fase 1",
      templateId: undefined,
    });
    expect(onChecklistsChanged).toHaveBeenCalled();
  });

  it("tornare su 'Nessun template' dopo averne scelto uno reale invia templateId undefined, non l'oggetto opzione", async () => {
    // Regressione: senza optionValue="value" esplicito, PrimeReact Dropdown
    // risolve l'opzione "Nessun template (checklist vuota)" (value:null)
    // all'intero oggetto opzione invece che a null (ObjectUtils.isNotEmpty(null)
    // e' false): createTemplateId diventava quell'oggetto, inviato al backend
    // come templateId invece di essere omesso.
    callable.mockImplementation((name: string) => {
      if (name === "listTemplates") {
        return Promise.resolve({ data: { templates: [{ id: "tmpl-1", title: "Template A" }] } });
      }
      if (name === "createProjectChecklist") {
        return Promise.resolve({ data: { checklistId: "new-checklist" } });
      }
      return Promise.reject(new Error(`Unexpected callable invoked in test: ${name}`));
    });

    const user = userEvent.setup();
    render(<ProjectChecklists projectId="p1" checklists={[]} projectType="evento" onChecklistsChanged={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Crea checklist" }));
    await user.type(screen.getByLabelText("Etichetta tab"), "Fase 1");

    const dialog = screen.getByRole("dialog");
    const trigger = dialog.querySelector(".p-dropdown-trigger") as HTMLElement;

    await selectDropdownOption(user, trigger, "Template A");
    await selectDropdownOption(user, trigger, "Nessun template (checklist vuota)");

    await user.click(screen.getByRole("button", { name: "Crea" }));

    expect(callable).toHaveBeenCalledWith(
      "createProjectChecklist",
      expect.objectContaining({ templateId: undefined })
    );
  });

  it("readOnly nasconde il pulsante 'Crea checklist' e l'icona di eliminazione", async () => {
    render(
      <ProjectChecklists
        projectId="p1"
        checklists={[{ checklistId: "c1", label: "Fase 1" }]}
        projectType="progetto"
        onChecklistsChanged={vi.fn()}
        isAdmin
        readOnly
      />
    );

    await screen.findAllByText("Titolo c1");
    expect(screen.queryByRole("button", { name: "Crea checklist" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Elimina checklist/ })).not.toBeInTheDocument();
  });

  it("con isAdmin, elimina la checklist dopo conferma", async () => {
    const user = userEvent.setup();
    const onChecklistsChanged = vi.fn();
    callable.mockImplementation((name: string, data: { checklistId?: string }) => {
      if (name === "getProjectChecklist") {
        return Promise.resolve({
          data: { checklistId: data.checklistId, title: "Titolo c1", category: "progetto", items: [] },
        });
      }
      if (name === "getProjectChecklistCompleteness") return Promise.resolve({ data: { complete: false } });
      if (name === "listAssignableProjectUsers") return Promise.resolve({ data: { uids: [] } });
      if (name === "deleteProjectChecklist") return Promise.resolve({ data: { success: true } });
      return Promise.reject(new Error(`Unexpected callable invoked in test: ${name}`));
    });

    render(
      <ProjectChecklists
        projectId="p1"
        checklists={[{ checklistId: "c1", label: "Fase 1" }]}
        projectType="progetto"
        onChecklistsChanged={onChecklistsChanged}
        isAdmin
      />
    );

    await screen.findAllByText("Titolo c1");
    await user.click(screen.getByRole("button", { name: "Elimina checklist Titolo c1" }));
    await user.click(await screen.findByRole("button", { name: "Elimina" }));

    expect(callable).toHaveBeenCalledWith("deleteProjectChecklist", { projectId: "p1", checklistId: "c1" });
    expect(onChecklistsChanged).toHaveBeenCalled();
  });
});
