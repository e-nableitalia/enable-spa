import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import ProjectChecklistShareStatus from "./ProjectChecklistShareStatus";

vi.mock("../firebase", () => ({ functions: {} }));

const callable = vi.fn();
vi.mock("firebase/functions", () => ({
  httpsCallable: (_functions: unknown, name: string) => (data: unknown) => callable(name, data),
}));

let mockToken: string | undefined = "project-share-token-1";
vi.mock("react-router-dom", () => ({ useParams: () => ({ token: mockToken }) }));

describe("ProjectChecklistShareStatus", () => {
  beforeEach(() => {
    callable.mockReset();
    mockToken = "project-share-token-1";
  });

  it("carica percentuale e item dal token pubblico", async () => {
    callable.mockResolvedValue({
      data: {
        percentComplete: 50,
        projectTitle: "Progetto pilota",
        items: [
          { title: "Task 1", completed: true },
          { title: "Task 2", completed: false },
        ],
      },
    });

    render(<ProjectChecklistShareStatus />);

    expect(callable).toHaveBeenCalledWith("getProjectChecklistShareStatus", { token: "project-share-token-1" });
    expect(await screen.findByText("50%")).toBeInTheDocument();
    expect(await screen.findByText("Stato di avanzamento del progetto - Progetto pilota")).toBeInTheDocument();
    expect(await screen.findByText("Task 1")).toBeInTheDocument();
    expect(await screen.findByText("Task 2")).toBeInTheDocument();
  });

  it("mostra errore quando il token manca", async () => {
    mockToken = undefined;
    render(<ProjectChecklistShareStatus />);
    expect(await screen.findByText("Link non valido.")).toBeInTheDocument();
    expect(callable).not.toHaveBeenCalled();
  });
});
