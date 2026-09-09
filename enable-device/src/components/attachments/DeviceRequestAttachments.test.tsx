import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DeviceRequestAttachments from "./DeviceRequestAttachments";

vi.mock("../../firebase", () => ({
  db: {},
  functions: {},
  auth: { currentUser: { uid: "volunteer-1" } },
}));

const callable = vi.fn();
vi.mock("firebase/functions", () => ({
  httpsCallable: (_functions: unknown, name: string) => (data: unknown) => callable(name, data),
}));

vi.mock("firebase/firestore", () => ({
  doc: vi.fn(),
  getDoc: vi.fn().mockResolvedValue({ exists: () => false }),
}));

// Nessun test in questo repo esercita il rendering reale del dialog di
// conferma PrimeReact (nessun precedente trovato in altri componenti):
// si mocka `confirmDialog` per invocare direttamente `accept`, verificando
// il comportamento del componente (chiamata alla Cloud Function dopo
// conferma) senza dipendere dalla resa a schermo del dialog stesso.
vi.mock("primereact/confirmdialog", () => ({
  ConfirmDialog: () => null,
  confirmDialog: (options: { accept?: () => void }) => options.accept?.(),
}));

const ATTACHMENT_A = {
  id: "att-1",
  fileName: "fattura.pdf",
  extension: "pdf",
  description: "Fattura di acquisto",
  notes: "",
  category: "documenti",
  size: 51200,
  uploadedBy: "volunteer-1",
  createdAt: { _seconds: 1893456000, _nanoseconds: 0 },
  updatedAt: { _seconds: 1893456000, _nanoseconds: 0 },
};

const ATTACHMENT_B = {
  id: "att-2",
  fileName: "foto.jpg",
  extension: "jpg",
  description: "Foto dispositivo",
  notes: "",
  category: "foto",
  size: 204800,
  uploadedBy: "admin-1",
  createdAt: { _seconds: 1893456100, _nanoseconds: 0 },
  updatedAt: { _seconds: 1893456100, _nanoseconds: 0 },
};

function mockDefaultLoad() {
  callable.mockImplementation((name: string) => {
    if (name === "listDeviceRequestAttachments") {
      return Promise.resolve({ data: { attachments: [ATTACHMENT_A, ATTACHMENT_B] } });
    }
    return Promise.reject(new Error(`Unexpected callable invoked in test: ${name}`));
  });
}

describe("DeviceRequestAttachments (EA-168)", () => {
  beforeEach(() => {
    callable.mockReset();
    mockDefaultLoad();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
    vi.stubGlobal("open", vi.fn());
  });

  it("carica ed elenca gli allegati della richiesta al montaggio", async () => {
    render(<DeviceRequestAttachments requestId="req-1" />);

    expect(await screen.findByText("fattura.pdf")).toBeInTheDocument();
    expect(screen.getByText("foto.jpg")).toBeInTheDocument();
    expect(callable).toHaveBeenCalledWith("listDeviceRequestAttachments", { requestId: "req-1" });
  });

  it("filtra l'elenco per categoria, e tornare su 'Tutte le categorie' mostra di nuovo tutto", async () => {
    // Regressione: senza optionValue="value" esplicito, PrimeReact Dropdown
    // risolve un'opzione con value:null (qui "Tutte le categorie") all'intero
    // oggetto opzione invece che a null (ObjectUtils.isNotEmpty(null) e'
    // false, quindi getOptionValue ricade sull'opzione intera) — il filtro
    // confrontava poi una stringa categoria con un oggetto, non trovando mai
    // corrispondenza: la tabella restava vuota anche selezionando "tutte".
    const user = userEvent.setup();
    const { container } = render(<DeviceRequestAttachments requestId="req-1" />);
    await screen.findByText("fattura.pdf");

    const trigger = () => container.querySelector(".p-dropdown-trigger") as HTMLElement;
    await user.click(trigger());
    const documentiOptions = await screen.findAllByText("documenti");
    const documentiOption = documentiOptions.find((el) => el.className.includes("p-dropdown-item-label"));
    await user.click(documentiOption!);

    expect(screen.getByText("fattura.pdf")).toBeInTheDocument();
    expect(screen.queryByText("foto.jpg")).not.toBeInTheDocument();

    await user.click(trigger());
    const tutteOptions = await screen.findAllByText("Tutte le categorie");
    const tutteOption = tutteOptions.find((el) => el.className.includes("p-dropdown-item-label"));
    await user.click(tutteOption!);

    expect(screen.getByText("fattura.pdf")).toBeInTheDocument();
    expect(screen.getByText("foto.jpg")).toBeInTheDocument();
  });

  it("mostra un'icona informativa con le note al passaggio del mouse, solo per gli allegati che ne hanno", async () => {
    callable.mockImplementation((name: string) => {
      if (name === "listDeviceRequestAttachments") {
        return Promise.resolve({
          data: { attachments: [{ ...ATTACHMENT_A, notes: "Documento firmato in originale" }, ATTACHMENT_B] },
        });
      }
      return Promise.reject(new Error(`Unexpected callable invoked in test: ${name}`));
    });

    render(<DeviceRequestAttachments requestId="req-1" />);
    await screen.findByText("fattura.pdf");

    expect(screen.getByRole("img", { name: "Note: Documento firmato in originale" })).toBeInTheDocument();
    // ATTACHMENT_B ha notes vuote: nessuna icona per quella riga.
    expect(screen.queryAllByRole("img", { name: /^Note:/ })).toHaveLength(1);
  });

  it("carica un nuovo allegato: chiama la Cloud Function, effettua il PUT del file sulla signed URL e ricarica l'elenco", async () => {
    const user = userEvent.setup();
    callable.mockImplementation((name: string) => {
      if (name === "listDeviceRequestAttachments") {
        return Promise.resolve({ data: { attachments: [ATTACHMENT_A, ATTACHMENT_B] } });
      }
      if (name === "uploadDeviceRequestAttachment") {
        return Promise.resolve({
          data: { attachmentId: "att-3", uploadUrl: "https://storage.example/signed-upload" },
        });
      }
      return Promise.reject(new Error(`Unexpected callable invoked in test: ${name}`));
    });

    render(<DeviceRequestAttachments requestId="req-1" />);
    await screen.findByText("fattura.pdf");

    await user.click(screen.getByRole("button", { name: "Carica allegato" }));

    const file = new File(["contenuto"], "manuale.pdf", { type: "application/pdf" });
    const fileInput = document.getElementById("attachment-file") as HTMLInputElement;
    await user.upload(fileInput, file);

    await user.type(screen.getByLabelText("Descrizione"), "Manuale d'uso");
    await user.click(screen.getByRole("button", { name: "Carica" }));

    await waitFor(() =>
      expect(callable).toHaveBeenCalledWith("uploadDeviceRequestAttachment", {
        requestId: "req-1",
        fileName: "manuale.pdf",
        description: "Manuale d'uso",
        notes: undefined,
        category: undefined,
        size: file.size,
      })
    );
    expect(fetch).toHaveBeenCalledWith("https://storage.example/signed-upload", {
      method: "PUT",
      body: file,
    });
    // Ricarica l'elenco dopo l'upload riuscito.
    await waitFor(() => expect(callable).toHaveBeenCalledTimes(3));
  });

  it("scarica un allegato aprendo la signed URL restituita", async () => {
    const user = userEvent.setup();
    callable.mockImplementation((name: string) => {
      if (name === "listDeviceRequestAttachments") {
        return Promise.resolve({ data: { attachments: [ATTACHMENT_A] } });
      }
      if (name === "downloadDeviceRequestAttachment") {
        return Promise.resolve({ data: { downloadUrl: "https://storage.example/signed-download" } });
      }
      return Promise.reject(new Error(`Unexpected callable invoked in test: ${name}`));
    });

    render(<DeviceRequestAttachments requestId="req-1" />);
    await screen.findByText("fattura.pdf");

    await user.click(screen.getByRole("button", { name: "Scarica" }));

    await waitFor(() =>
      expect(callable).toHaveBeenCalledWith("downloadDeviceRequestAttachment", {
        requestId: "req-1",
        attachmentId: "att-1",
      })
    );
    expect(window.open).toHaveBeenCalledWith(
      "https://storage.example/signed-download",
      "_blank",
      "noopener,noreferrer"
    );
  });

  // L'utente corrente ("volunteer-1", mock di auth.currentUser) è
  // uploader di ATTACHMENT_A ma non di ATTACHMENT_B: le azioni di
  // modifica/eliminazione sono un suggerimento lato UI, l'RBAC reale
  // resta comunque lato server.
  it("abilita modifica/eliminazione solo sui propri allegati", async () => {
    render(<DeviceRequestAttachments requestId="req-1" />);
    await screen.findByText("fattura.pdf");

    const editButtons = screen.getAllByRole("button", { name: "Modifica descrizione/note" });
    const deleteButtons = screen.getAllByRole("button", { name: "Elimina" });

    expect(editButtons[0]).not.toBeDisabled();
    expect(deleteButtons[0]).not.toBeDisabled();
    expect(editButtons[1]).toBeDisabled();
    expect(deleteButtons[1]).toBeDisabled();
  });

  it("modifica descrizione e note di un allegato proprio", async () => {
    const user = userEvent.setup();
    callable.mockImplementation((name: string) => {
      if (name === "listDeviceRequestAttachments") {
        return Promise.resolve({ data: { attachments: [ATTACHMENT_A] } });
      }
      if (name === "updateDeviceRequestAttachmentDescription") {
        return Promise.resolve({ data: { attachmentId: "att-1" } });
      }
      return Promise.reject(new Error(`Unexpected callable invoked in test: ${name}`));
    });

    render(<DeviceRequestAttachments requestId="req-1" />);
    await screen.findByText("fattura.pdf");

    await user.click(screen.getByRole("button", { name: "Modifica descrizione/note" }));
    const descriptionInput = screen.getByLabelText("Descrizione") as HTMLInputElement;
    await user.clear(descriptionInput);
    await user.type(descriptionInput, "Fattura aggiornata");
    await user.click(screen.getByRole("button", { name: "Salva" }));

    await waitFor(() =>
      expect(callable).toHaveBeenCalledWith("updateDeviceRequestAttachmentDescription", {
        requestId: "req-1",
        attachmentId: "att-1",
        description: "Fattura aggiornata",
        notes: "",
      })
    );
  });

  it("elimina un allegato proprio dopo conferma", async () => {
    const user = userEvent.setup();
    callable.mockImplementation((name: string) => {
      if (name === "listDeviceRequestAttachments") {
        return Promise.resolve({ data: { attachments: [ATTACHMENT_A] } });
      }
      if (name === "deleteDeviceRequestAttachment") {
        return Promise.resolve({ data: { attachmentId: "att-1" } });
      }
      return Promise.reject(new Error(`Unexpected callable invoked in test: ${name}`));
    });

    render(<DeviceRequestAttachments requestId="req-1" />);
    await screen.findByText("fattura.pdf");

    await user.click(screen.getByRole("button", { name: "Elimina" }));

    await waitFor(() =>
      expect(callable).toHaveBeenCalledWith("deleteDeviceRequestAttachment", {
        requestId: "req-1",
        attachmentId: "att-1",
      })
    );
  });

  it("mostra un errore leggibile se il caricamento dell'elenco fallisce", async () => {
    callable.mockImplementation((name: string) => {
      if (name === "listDeviceRequestAttachments") {
        return Promise.reject(new Error("Errore di rete"));
      }
      return Promise.reject(new Error(`Unexpected callable invoked in test: ${name}`));
    });

    render(<DeviceRequestAttachments requestId="req-1" />);

    expect(await screen.findByText("Nessun allegato collegato a questa richiesta.")).toBeInTheDocument();
  });
});
