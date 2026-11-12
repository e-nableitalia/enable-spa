import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SuperAdminPage from "./SuperAdminPage";

vi.mock("../../../firebase", () => ({ functions: {} }));

const callable = vi.fn();
vi.mock("firebase/functions", () => ({
  httpsCallable: (_functions: unknown, name: string) => (data: unknown) => callable(name, data),
}));

describe("SuperAdminPage (pagina 'Super Admin') - deploy template email", () => {
  beforeEach(() => {
    callable.mockReset();
  });

  it("mostra il pannello e i pulsanti 'Deploy template email'/'Backup Firestore'", () => {
    render(<SuperAdminPage />);

    expect(screen.getByText("Super Admin")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Deploy template email" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Backup Firestore" })).toBeInTheDocument();
  });

  it("chiede conferma e, dopo accettazione, invoca deployEmailTemplates e mostra il riepilogo", async () => {
    callable.mockResolvedValue({ data: { templateIds: ["attivazioneVolontario", "confermaRicezione"] } });
    const user = userEvent.setup();
    render(<SuperAdminPage />);

    await user.click(screen.getByRole("button", { name: "Deploy template email" }));
    await user.click(await screen.findByRole("button", { name: "Deploy" }));

    expect(callable).toHaveBeenCalledWith("deployEmailTemplates", {});
    expect(await screen.findByText("attivazioneVolontario, confermaRicezione", { exact: false })).toBeInTheDocument();
  });

  it("annullando la conferma non invoca la Cloud Function", async () => {
    const user = userEvent.setup();
    render(<SuperAdminPage />);

    await user.click(screen.getByRole("button", { name: "Deploy template email" }));
    await user.click(await screen.findByRole("button", { name: "Annulla" }));

    expect(callable).not.toHaveBeenCalled();
  });

  it("mostra un errore se la Cloud Function fallisce (es. permission-denied)", async () => {
    callable.mockRejectedValue(new Error("Only a super admin can perform this action"));
    const user = userEvent.setup();
    render(<SuperAdminPage />);

    await user.click(screen.getByRole("button", { name: "Deploy template email" }));
    await user.click(await screen.findByRole("button", { name: "Deploy" }));

    expect(await screen.findByText("Only a super admin can perform this action")).toBeInTheDocument();
  });
});

describe("SuperAdminPage (pagina 'Super Admin') - backup Firestore", () => {
  beforeEach(() => {
    callable.mockReset();
  });

  it("chiede conferma e, dopo accettazione, invoca triggerFirestoreBackup e mostra il path GCS", async () => {
    callable.mockResolvedValue({
      data: { outputUriPrefix: "gs://enableitalia-staging-firestore-backups/2026-09-08T00-00-00", operationName: "op-1" },
    });
    const user = userEvent.setup();
    render(<SuperAdminPage />);

    await user.click(screen.getByRole("button", { name: "Backup Firestore" }));
    await user.click(await screen.findByRole("button", { name: "Avvia backup" }));

    expect(callable).toHaveBeenCalledWith("triggerFirestoreBackup", {});
    expect(
      await screen.findByText("gs://enableitalia-staging-firestore-backups/2026-09-08T00-00-00", { exact: false })
    ).toBeInTheDocument();
  });

  it("annullando la conferma non invoca la Cloud Function", async () => {
    const user = userEvent.setup();
    render(<SuperAdminPage />);

    await user.click(screen.getByRole("button", { name: "Backup Firestore" }));
    await user.click(await screen.findByRole("button", { name: "Annulla" }));

    expect(callable).not.toHaveBeenCalled();
  });

  it("mostra un errore se la Cloud Function fallisce", async () => {
    callable.mockRejectedValue(new Error("Only a super admin can perform this action"));
    const user = userEvent.setup();
    render(<SuperAdminPage />);

    await user.click(screen.getByRole("button", { name: "Backup Firestore" }));
    await user.click(await screen.findByRole("button", { name: "Avvia backup" }));

    expect(await screen.findByText("Only a super admin can perform this action")).toBeInTheDocument();
  });
});
