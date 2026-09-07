import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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

const firestoreDocs: Record<string, unknown> = {};
const firestoreCollections: Record<string, Array<Record<string, unknown>>> = {};

vi.mock("firebase/firestore", () => ({
  doc: (_db: unknown, ...segments: string[]) => ({ __path: segments.join("/") }),
  getDoc: async (ref: { __path: string }) => {
    const data = firestoreDocs[ref.__path];
    return { exists: () => data !== undefined, data: () => data };
  },
  collection: (_db: unknown, ...segments: string[]) => ({ __path: segments.join("/") }),
  getDocs: async (q: { __path: string }) => {
    const items = firestoreCollections[q.__path] ?? [];
    return { docs: items.map((data) => ({ data: () => data })) };
  },
  query: (ref: unknown) => ref,
  orderBy: vi.fn(),
}));

function setProject(id: string, data: Record<string, unknown>) {
  firestoreDocs[`projects/${id}`] = data;
}

function setEvents(id: string, events: Array<Record<string, unknown>>) {
  firestoreCollections[`projects/${id}/events`] = events;
}

afterEach(() => {
  for (const key of Object.keys(firestoreDocs)) delete firestoreDocs[key];
  for (const key of Object.keys(firestoreCollections)) delete firestoreCollections[key];
});

function renderDetail(id = "p1") {
  return render(
    <MemoryRouter initialEntries={[`/admin/project/${id}`]}>
      <Routes>
        <Route path="/admin/project/:id" element={<ProjectDetail />} />
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
    setProject("p1", {
      title: "Device multifunzione",
      description: "Descrizione",
      projectType: "progetto",
      status: "active",
      checklists: [],
      createdBy: "admin-1",
    });
    setEvents("p1", []);
    callable.mockImplementation((name: string) => {
      if (name === "listAssignableProjectUsers") return Promise.resolve({ data: { uids: [] } });
      return Promise.reject(new Error(`Unexpected callable invoked in test: ${name}`));
    });

    renderDetail();

    expect(await screen.findByText("Device multifunzione")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Modifica" })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "Aggiungi nota" })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "Cambia stato" })).not.toBeDisabled();
  });

  it("un progetto 'archived' disabilita Modifica/Nota/Cambia stato (terminale)", async () => {
    setProject("p1", {
      title: "Progetto vecchio",
      description: "",
      projectType: "progetto",
      status: "archived",
      checklists: [],
      createdBy: "admin-1",
    });
    setEvents("p1", []);

    renderDetail();

    expect(await screen.findByText("Progetto vecchio")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Modifica" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Aggiungi nota" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cambia stato" })).toBeDisabled();
  });

  it("un progetto 'standby' disabilita Modifica ma permette Nota e Cambia stato", async () => {
    setProject("p1", {
      title: "Progetto in pausa",
      description: "",
      projectType: "progetto",
      status: "standby",
      checklists: [],
      createdBy: "admin-1",
    });
    setEvents("p1", []);

    renderDetail();

    expect(await screen.findByText("Progetto in pausa")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Modifica" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Aggiungi nota" })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "Cambia stato" })).not.toBeDisabled();
  });

  it("modifica titolo/descrizione tramite il dialog 'Modifica'", async () => {
    setProject("p1", {
      title: "Vecchio titolo",
      description: "Vecchia descrizione",
      projectType: "progetto",
      status: "new",
      checklists: [],
      createdBy: "admin-1",
    });
    setEvents("p1", []);
    callable.mockImplementation((name: string) => {
      if (name === "listAssignableProjectUsers") return Promise.resolve({ data: { uids: [] } });
      if (name === "updateProject") return Promise.resolve({ data: { success: true } });
      return Promise.reject(new Error(`Unexpected callable invoked in test: ${name}`));
    });

    const user = userEvent.setup();
    renderDetail();

    await screen.findByText("Vecchio titolo");
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
    setProject("p1", {
      title: "Progetto",
      description: "",
      projectType: "progetto",
      status: "active",
      checklists: [],
      createdBy: "admin-1",
    });
    setEvents("p1", []);
    callable.mockImplementation((name: string) => {
      if (name === "listAssignableProjectUsers") return Promise.resolve({ data: { uids: [] } });
      if (name === "changeProjectStatus") return Promise.resolve({ data: { success: true, eventId: "e1" } });
      return Promise.reject(new Error(`Unexpected callable invoked in test: ${name}`));
    });

    const user = userEvent.setup();
    renderDetail();

    await screen.findByText("Progetto");
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
    setProject("p1", {
      title: "Progetto",
      description: "",
      projectType: "progetto",
      status: "new",
      checklists: [],
      createdBy: "admin-1",
    });
    setEvents("p1", []);
    callable.mockImplementation((name: string) => {
      if (name === "listAssignableProjectUsers") return Promise.resolve({ data: { uids: [] } });
      if (name === "changeProjectStatus") return Promise.resolve({ data: { success: true, eventId: "e1" } });
      return Promise.reject(new Error(`Unexpected callable invoked in test: ${name}`));
    });

    const user = userEvent.setup();
    renderDetail();

    await screen.findByText("Progetto");
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
      note: undefined,
    });
  });
});
