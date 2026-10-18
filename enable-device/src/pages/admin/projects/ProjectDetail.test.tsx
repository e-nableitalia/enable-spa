import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import ProjectDetail from "./ProjectDetail";

vi.mock("../../../firebase", () => ({ db: {}, functions: {} }));

const callable = vi.fn();
vi.mock("firebase/functions", () => ({
  httpsCallable: (_functions: unknown, name: string) => (data: unknown) => callable(name, data),
}));

const navigateMock = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => navigateMock };
});

vi.mock("firebase/firestore", () => ({
  doc: (_db: unknown, ...segments: string[]) => ({ __path: segments.join("/") }),
  getDoc: async () => ({ exists: () => false, data: () => undefined }),
}));

function mockProject(
  overrides: Partial<{
    id: string;
    title: string;
    description: string;
    projectType: string;
    status: string;
    checklists: unknown[];
    createdBy: string;
  }> = {},
  events: Array<Record<string, unknown>> = []
) {
  const project = {
    id: "p1",
    title: "Device multifunzione",
    description: "Descrizione",
    projectType: "progetto",
    status: "active",
    checklists: [],
    createdBy: "admin-1",
    ...overrides,
  };
  callable.mockImplementation((name: string) => {
    if (name === "getProject") {
      return Promise.resolve({ data: { project, events } });
    }
    if (name === "listAssignableProjectUsers") return Promise.resolve({ data: { uids: [] } });
    if (name === "updateProject") return Promise.resolve({ data: { success: true } });
    if (name === "changeProjectStatus") return Promise.resolve({ data: { success: true, eventId: "e1" } });
    if (name === "deleteProject") return Promise.resolve({ data: { success: true } });
    return Promise.reject(new Error(`Unexpected callable invoked in test: ${name}`));
  });
}

function renderDetail(id = "p1", scope: "admin" | "volunteer" = "admin", canManage = true) {
  return render(
    <MemoryRouter initialEntries={[`/${scope}/projects/${id}`]}>
      <Routes>
        <Route path="/admin/projects/:id" element={<ProjectDetail scope="admin" canManage />} />
        <Route path="/volunteer/projects/:id" element={<ProjectDetail scope="volunteer" canManage={canManage} />} />
      </Routes>
    </MemoryRouter>
  );
}

describe("ProjectDetail", () => {
  beforeEach(() => {
    callable.mockReset();
    navigateMock.mockReset();
  });

  it("mostra i dati generali di un progetto 'active' (Modifica/Nota/Cambia stato abilitati)", async () => {
    mockProject({ status: "active" });
    renderDetail();

    expect((await screen.findAllByText("Device multifunzione")).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Modifica" })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "Aggiungi nota" })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "Cambia stato" })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "Elimina" })).toBeInTheDocument();
  });

  it("un progetto 'archived' disabilita Modifica/Nota/Cambia stato (terminale)", async () => {
    mockProject({ title: "Progetto vecchio", description: "", status: "archived" });
    renderDetail();

    expect((await screen.findAllByText("Progetto vecchio")).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Modifica" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Aggiungi nota" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cambia stato" })).toBeDisabled();
  });

  it("un progetto 'standby' disabilita Modifica ma permette Nota e Cambia stato", async () => {
    mockProject({ title: "Progetto in pausa", description: "", status: "standby" });
    renderDetail();

    expect((await screen.findAllByText("Progetto in pausa")).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Modifica" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Aggiungi nota" })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "Cambia stato" })).not.toBeDisabled();
  });

  it("carica il progetto via getProject (non getDoc diretto)", async () => {
    mockProject();
    renderDetail("p1");
    await screen.findAllByText("Device multifunzione");
    expect(callable).toHaveBeenCalledWith("getProject", { projectId: "p1" });
  });

  it("modifica titolo/descrizione tramite il dialog 'Modifica'", async () => {
    mockProject({ title: "Vecchio titolo", description: "Vecchia descrizione", status: "new" });
    const user = userEvent.setup();
    renderDetail();

    await screen.findAllByText("Vecchio titolo");
    await user.click(screen.getByRole("button", { name: "Modifica" }));
    const dialog = screen.getByRole("dialog");
    const titleInput = within(dialog).getByDisplayValue("Vecchio titolo");
    await user.clear(titleInput);
    await user.type(titleInput, "Nuovo titolo");
    await user.click(within(dialog).getByRole("button", { name: "Salva" }));

    expect(callable).toHaveBeenCalledWith("updateProject", {
      projectId: "p1",
      title: "Nuovo titolo",
      description: "Vecchia descrizione",
    });
  });

  it("aggiunge una nota tramite changeProjectStatus con lo stato corrente", async () => {
    mockProject({ title: "Progetto", description: "", status: "active" });
    const user = userEvent.setup();
    renderDetail();

    await screen.findAllByText("Progetto");
    await user.click(screen.getByRole("button", { name: "Aggiungi nota" }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText("Nota"), "Nota di avanzamento");
    await user.click(within(dialog).getByRole("button", { name: "Salva" }));

    expect(callable).toHaveBeenCalledWith("changeProjectStatus", {
      projectId: "p1",
      newStatus: "active",
      note: "Nota di avanzamento",
    });
  });

  it("cambia stato tramite il dialog 'Cambia stato'", async () => {
    mockProject({ title: "Progetto", description: "", status: "new" });
    const user = userEvent.setup();
    renderDetail();

    await screen.findAllByText("Progetto");
    await user.click(screen.getByRole("button", { name: "Cambia stato" }));
    const dialog = screen.getByRole("dialog");

    const statusTrigger = dialog.querySelector(".p-dropdown-trigger") as HTMLElement;
    await user.click(statusTrigger);
    const candidates = await screen.findAllByText("Attivo");
    const option = candidates.map((el) => el.closest("li")).find((li) => li?.getAttribute("role") === "option");
    if (!option) throw new Error("Option 'Attivo' not found");
    fireEvent.click(option);

    await user.click(within(dialog).getByRole("button", { name: "Salva" }));

    expect(callable).toHaveBeenCalledWith("changeProjectStatus", {
      projectId: "p1",
      newStatus: "active",
      note: "",
    });
  });

  it("non permette di salvare un titolo vuoto nel dialog 'Modifica'", async () => {
    mockProject({ title: "Vecchio titolo", description: "Desc", status: "new" });
    const user = userEvent.setup();
    renderDetail();

    await screen.findAllByText("Vecchio titolo");
    await user.click(screen.getByRole("button", { name: "Modifica" }));
    const dialog = screen.getByRole("dialog");
    const titleInput = within(dialog).getByDisplayValue("Vecchio titolo");
    await user.clear(titleInput);

    expect(within(dialog).getByRole("button", { name: "Salva" })).toBeDisabled();
    expect(callable).not.toHaveBeenCalledWith("updateProject", expect.anything());
  });

  it("elimina il progetto dopo conferma e torna all'elenco", async () => {
    mockProject({ title: "Da eliminare", status: "new" });
    const user = userEvent.setup();
    renderDetail();

    await screen.findAllByText("Da eliminare");
    await user.click(screen.getByRole("button", { name: "Elimina" }));

    // ConfirmDialog: dopo l'apertura ci sono due bottoni "Elimina" (toolbar + accept).
    const eliminateButtons = await screen.findAllByRole("button", { name: "Elimina" });
    expect(eliminateButtons.length).toBeGreaterThanOrEqual(2);
    await user.click(eliminateButtons[eliminateButtons.length - 1]);

    expect(callable).toHaveBeenCalledWith("deleteProject", { projectId: "p1" });
    expect(navigateMock).toHaveBeenCalledWith("/admin/projects");
  });

  it("in scope volunteer mostra il progetto in sola lettura", async () => {
    mockProject({ title: "Progetto readonly", status: "active" });
    renderDetail("p1", "volunteer", false);

    expect((await screen.findAllByText("Progetto readonly")).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Modifica" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Elimina" })).not.toBeInTheDocument();
  });
});
