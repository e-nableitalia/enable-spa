import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import RequestDetail from "./RequestDetail";

vi.mock("react-router-dom", () => ({ useParams: () => ({ id: "req1" }) }));
vi.mock("../../../firebase", () => ({ db: {}, functions: {}, auth: {} }));
vi.mock("firebase/functions", () => ({ httpsCallable: () => vi.fn() }));

const firestoreDocs: Record<string, unknown> = {};
const firestoreCollections: Record<string, unknown[]> = {};

vi.mock("firebase/firestore", () => ({
  doc: (_db: unknown, ...segments: string[]) => ({ __path: segments.join("/") }),
  collection: (_db: unknown, ...segments: string[]) => ({ __path: segments.join("/") }),
  query: (ref: unknown) => ref,
  orderBy: () => undefined,
  updateDoc: vi.fn(),
  serverTimestamp: () => "SERVER_TIMESTAMP",
  getDoc: async (ref: { __path: string }) => {
    const data = firestoreDocs[ref.__path];
    return { exists: () => data !== undefined, data: () => data };
  },
  getDocs: async (ref: { __path: string }) => {
    const items = firestoreCollections[ref.__path] ?? [];
    return { docs: items.map((d, i) => ({ id: (d as { id?: string }).id ?? String(i), data: () => d })) };
  },
}));

vi.mock("../../../components/checklist/DeviceRequestChecklists", () => ({
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
  firestoreCollections["users"] = [];
}

describe("RequestDetail (admin) - vista a tab multi-checklist (EA-133)", () => {
  beforeEach(() => {
    for (const key of Object.keys(firestoreDocs)) delete firestoreDocs[key];
    for (const key of Object.keys(firestoreCollections)) delete firestoreCollections[key];
  });

  it("Scenario 1: una sola checklist collegata viene passata come unico checklistId alla vista a tab", async () => {
    setRequestDoc({ requestNumber: "42", checklistIds: ["c1"], assignedVolunteers: [] });
    render(<RequestDetail />);

    const checklists = await screen.findByTestId("checklists");
    expect(checklists).toHaveAttribute("data-request-id", "req1");
    expect(checklists).toHaveAttribute("data-checklist-ids", JSON.stringify(["c1"]));
  });

  it("Scenario 2: più checklist collegate vengono passate tutte alla vista a tab", async () => {
    setRequestDoc({ requestNumber: "42", checklistIds: ["c1", "c2", "c3"], assignedVolunteers: [] });
    render(<RequestDetail />);

    const checklists = await screen.findByTestId("checklists");
    expect(checklists).toHaveAttribute("data-checklist-ids", JSON.stringify(["c1", "c2", "c3"]));
  });
});
