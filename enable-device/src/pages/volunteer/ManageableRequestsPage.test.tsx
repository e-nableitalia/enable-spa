import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import ManageableRequestsPage from "./ManageableRequestsPage";

vi.mock("../../firebase", () => ({ db: {} }));
vi.mock("react-router-dom", () => ({ useNavigate: () => vi.fn() }));

const { whereMock, queryMock, getDocsMock, getDocMock } = vi.hoisted(() => ({
  whereMock: vi.fn((...args: unknown[]) => ({ __where: args })),
  queryMock: vi.fn((...args: unknown[]) => ({ __query: args })),
  getDocsMock: vi.fn(() => Promise.resolve({ docs: [] as unknown[] })),
  getDocMock: vi.fn(() => Promise.resolve({ exists: () => false })),
}));

vi.mock("firebase/firestore", () => ({
  collection: vi.fn((_db: unknown, name: string) => ({ __collection: name })),
  getDocs: getDocsMock,
  getDoc: getDocMock,
  doc: vi.fn((_db: unknown, ...segments: string[]) => ({ __doc: segments })),
  query: queryMock,
  where: whereMock,
}));

describe("ManageableRequestsPage - query 'da gestire' (F-31)", () => {
  beforeEach(() => {
    whereMock.mockClear();
    queryMock.mockClear();
    getDocsMock.mockClear();
  });

  // Regressione F-31: PUBLIC_STATUS_GROUPS (dominio a 19 valori pre-EA-148)
  // non includeva il valore letterale "da gestire" introdotto da EA-148 —
  // le richieste con quello status non comparivano mai nell'elenco. Il fix
  // usa PUBLIC_STATUS_GROUPS_FROM_STATUS (dominio a 11 valori corrente).
  it("filtra sul dominio a 11 stati corrente, incluso il letterale 'da gestire'", async () => {
    render(<ManageableRequestsPage />);

    await screen.findByText(/Richieste da gestire/);

    expect(whereMock).toHaveBeenCalledWith(
      "status",
      "in",
      ["validata", "da gestire", "attesa volontario"]
    );
  });
});
