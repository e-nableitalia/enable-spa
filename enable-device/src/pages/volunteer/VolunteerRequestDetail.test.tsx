import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import VolunteerRequestDetail from "./VolunteerRequestDetail";

vi.mock("react-router-dom", () => ({ useParams: () => ({ id: "req1" }) }));
vi.mock("../../firebase", () => ({ db: {}, functions: {} }));
vi.mock("firebase/functions", () => ({ httpsCallable: () => vi.fn() }));

const firestoreDocs: Record<string, unknown> = {};
const firestoreCollections: Record<string, unknown[]> = {};

vi.mock("firebase/firestore", () => ({
  doc: (_db: unknown, ...segments: string[]) => ({ __path: segments.join("/") }),
  collection: (_db: unknown, ...segments: string[]) => ({ __path: segments.join("/") }),
  query: (ref: unknown) => ref,
  orderBy: () => undefined,
  getDoc: async (ref: { __path: string }) => {
    const data = firestoreDocs[ref.__path];
    return { exists: () => data !== undefined, data: () => data };
  },
  getDocs: async (ref: { __path: string }) => {
    const items = firestoreCollections[ref.__path] ?? [];
    return { docs: items.map((d, i) => ({ id: (d as { id?: string }).id ?? String(i), data: () => d })) };
  },
}));

vi.mock("../../components/checklist/DeviceRequestChecklists", () => ({
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
}

describe("VolunteerRequestDetail - stessa vista a tab multi-checklist dell'admin (EA-133 Scenario 4)", () => {
  beforeEach(() => {
    for (const key of Object.keys(firestoreDocs)) delete firestoreDocs[key];
    for (const key of Object.keys(firestoreCollections)) delete firestoreCollections[key];
  });

  it("un volontario assegnato che apre la richiesta vede una tab per ciascun checklistId, stesso componente della vista admin", async () => {
    setRequestDoc({ requestNumber: "42", checklistIds: ["c1", "c2"], assignedVolunteers: ["vol1"] });
    render(<VolunteerRequestDetail />);

    const checklists = await screen.findByTestId("checklists");
    expect(checklists).toHaveAttribute("data-request-id", "req1");
    expect(checklists).toHaveAttribute("data-checklist-ids", JSON.stringify(["c1", "c2"]));
  });

  it("nessuna checklist collegata: la vista viene comunque montata (nessuna condizione sul campo legacy checklistId)", async () => {
    setRequestDoc({ requestNumber: "42", assignedVolunteers: ["vol1"] });
    render(<VolunteerRequestDetail />);

    const checklists = await screen.findByTestId("checklists");
    expect(checklists).toHaveAttribute("data-checklist-ids", JSON.stringify([]));
  });
});

describe("VolunteerRequestDetail - liberatorie familiari non visibili al volontario (EA-158 Scenario 3)", () => {
  beforeEach(() => {
    for (const key of Object.keys(firestoreDocs)) delete firestoreDocs[key];
    for (const key of Object.keys(firestoreCollections)) delete firestoreCollections[key];
  });

  it("un volontario assegnato, anche con liberatorie già acquisite sulla richiesta, non vede alcun controllo né lo stato dei flag", async () => {
    setRequestDoc({
      requestNumber: "42",
      assignedVolunteers: ["vol1"],
      waiverAcquired: true,
      waiverAcquiredBy: "admin-1",
      photoReleaseAcquired: false,
    });
    render(<VolunteerRequestDetail />);

    await screen.findByTestId("checklists");

    expect(screen.queryByText("Liberatorie familiari")).not.toBeInTheDocument();
    expect(screen.queryByText(/Scarico di responsabilità/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Liberatoria foto/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Segna come acquisit/ })).not.toBeInTheDocument();
  });
});
