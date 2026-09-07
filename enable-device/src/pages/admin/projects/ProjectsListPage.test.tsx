import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import ProjectsListPage from "./ProjectsListPage";

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

async function selectDropdownOption(user: ReturnType<typeof userEvent.setup>, trigger: HTMLElement, optionLabel: string) {
  await user.click(trigger);
  // Il testo dell'opzione può comparire anche altrove nella pagina (es. una
  // cella della tabella sottostante, ancora nel DOM mentre il pannello del
  // Dropdown è aperto): si filtra sulla label dell'opzione del Dropdown.
  const candidates = await screen.findAllByText(optionLabel);
  const option = candidates.map((el) => el.closest("li")).find((li) => li?.getAttribute("role") === "option");
  if (!option) throw new Error(`Dropdown option "${optionLabel}" not found`);
  fireEvent.click(option);
}

function renderPage() {
  return render(
    <MemoryRouter>
      <ProjectsListPage />
    </MemoryRouter>
  );
}

describe("ProjectsListPage", () => {
  beforeEach(() => {
    callable.mockReset();
    navigateMock.mockReset();
    callable.mockImplementation((name: string) => {
      if (name === "listProjects") {
        return Promise.resolve({
          data: {
            projects: [
              { id: "p1", title: "Device multifunzione", projectType: "progetto", status: "active", createdBy: "admin-1" },
              { id: "p2", title: "Maker Faire", projectType: "evento", status: "new", createdBy: "admin-1" },
            ],
          },
        });
      }
      if (name === "createProject") {
        return Promise.resolve({ data: { projectId: "p3" } });
      }
      return Promise.reject(new Error(`Unexpected callable invoked in test: ${name}`));
    });
  });

  it("carica e mostra l'elenco progetti", async () => {
    renderPage();

    expect(await screen.findByText("Device multifunzione")).toBeInTheDocument();
    expect(screen.getByText("Maker Faire")).toBeInTheDocument();
    expect(callable).toHaveBeenCalledWith("listProjects", {});
  });

  it("filtra per projectType", async () => {
    const user = userEvent.setup();
    const { container } = renderPage();
    await screen.findByText("Device multifunzione");

    // Un solo Dropdown presente a questo punto (il filtro): individuato per
    // classe, non per nome accessibile (il trigger non espone un aria-label
    // quando mostra un'opzione già selezionata, a differenza del caso
    // "placeholder senza selezione" di ChecklistPanel.test.tsx).
    const filterTrigger = container.querySelector(".p-dropdown-trigger") as HTMLElement;
    await selectDropdownOption(user, filterTrigger, "evento");

    expect(screen.queryByText("Device multifunzione")).not.toBeInTheDocument();
    expect(screen.getByText("Maker Faire")).toBeInTheDocument();
  });

  it("crea un progetto e naviga al dettaglio", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Device multifunzione");

    await user.click(screen.getByRole("button", { name: "Crea progetto" }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText("Titolo"), "Nuovo progetto");

    const typeTrigger = dialog.querySelector(".p-dropdown-trigger") as HTMLElement;
    await selectDropdownOption(user, typeTrigger, "progetto");

    const createButton = within(dialog).getByRole("button", { name: "Crea" });
    await user.click(createButton);

    expect(callable).toHaveBeenCalledWith(
      "createProject",
      expect.objectContaining({ title: "Nuovo progetto", projectType: "progetto" })
    );
    expect(navigateMock).toHaveBeenCalledWith("/admin/project/p3");
  });
});
