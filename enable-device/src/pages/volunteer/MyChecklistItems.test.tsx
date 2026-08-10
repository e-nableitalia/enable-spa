import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MyChecklistItems from "./MyChecklistItems";

async function rowFor(title: string) {
  const cell = await screen.findByText(title);
  const row = cell.closest("tr");
  if (!row) throw new Error(`Row not found for item "${title}"`);
  return row;
}

vi.mock("../../firebase", () => ({ db: {}, functions: {} }));

const callable = vi.fn();
vi.mock("firebase/functions", () => ({
  httpsCallable: (_functions: unknown, name: string) => (data: unknown) => callable(name, data),
}));

const mockNavigate = vi.fn();
vi.mock("react-router-dom", () => ({ useNavigate: () => mockNavigate }));

const firestoreDocs: Record<string, unknown> = {};
vi.mock("firebase/firestore", () => ({
  doc: (_db: unknown, ...segments: string[]) => ({ __path: segments.join("/") }),
  getDoc: async (ref: { __path: string }) => {
    const data = firestoreDocs[ref.__path];
    return { exists: () => data !== undefined, data: () => data };
  },
}));

describe("MyChecklistItems - elenco aggregato dei propri item di checklist (EA-154)", () => {
  beforeEach(() => {
    callable.mockReset();
    mockNavigate.mockReset();
    for (const key of Object.keys(firestoreDocs)) delete firestoreDocs[key];
  });

  // Scenario: il volontario con item assegnati vede titolo e stato di ciascun item
  it("invoca listMyChecklistItems senza parametro scope e mostra title e status di ciascun item restituito", async () => {
    callable.mockResolvedValue({
      data: {
        items: [
          { id: "item-1", checklistId: "checklist-a", title: "Stampa mano", status: "In corso" },
          { id: "item-2", checklistId: "checklist-b", title: "Verifica misure", status: "Assegnare" },
        ],
      },
    });

    render(<MyChecklistItems />);

    const row1 = await rowFor("Stampa mano");
    const row2 = await rowFor("Verifica misure");
    // Lo stato e' ora un Dropdown editabile (non piu' testo statico): il
    // suo valore corrente e' comunque visibile come testo nel trigger.
    expect(within(row1).getByText("In corso", { selector: "span" })).toBeInTheDocument();
    expect(within(row2).getByText("Assegnare", { selector: "span" })).toBeInTheDocument();

    expect(callable).toHaveBeenCalledWith("listMyChecklistItems", {});
    const [, requestData] = callable.mock.calls[0];
    expect(requestData).not.toHaveProperty("scope");
  });

  // Scenario: un item non completato mostra il contesto di provenienza dalla deviceRequest collegata
  it("mostra un riferimento leggibile alla richiesta di provenienza per un item non completato con origin deviceRequest", async () => {
    firestoreDocs["deviceRequests/req-1"] = { requestNumber: "REQ-000042" };
    callable.mockResolvedValue({
      data: {
        items: [
          {
            id: "item-1",
            checklistId: "checklist-a",
            title: "Stampa mano",
            status: "In corso",
            origin: { type: "deviceRequest", id: "req-1" },
          },
        ],
      },
    });

    render(<MyChecklistItems />);

    expect(await screen.findByText("Richiesta REQ-000042")).toBeInTheDocument();
  });

  // Scenario: click sul contesto di provenienza di un item non completato con origin di tipo deviceRequest naviga al dettaglio della richiesta (EA-155)
  it("naviga a /volunteer/my-requests/:id quando si clicca sul riferimento alla richiesta di provenienza", async () => {
    firestoreDocs["deviceRequests/req-1"] = { requestNumber: "REQ-000042" };
    callable.mockResolvedValue({
      data: {
        items: [
          {
            id: "item-1",
            checklistId: "checklist-a",
            title: "Stampa mano",
            status: "In corso",
            origin: { type: "deviceRequest", id: "req-1" },
          },
        ],
      },
    });

    render(<MyChecklistItems />);

    const originButton = await screen.findByRole("button", { name: "Richiesta REQ-000042" });
    await userEvent.click(originButton);

    expect(mockNavigate).toHaveBeenCalledWith("/volunteer/my-requests/req-1");
  });

  // Regressione: originBasePath e' usato da AdminLayout per riusare lo stesso
  // componente con la propria rotta di dettaglio richiesta (/admin/request/:id),
  // diversa da quella del volontario.
  it("naviga a <originBasePath>/:id quando originBasePath e' passato esplicitamente", async () => {
    firestoreDocs["deviceRequests/req-1"] = { requestNumber: "REQ-000042" };
    callable.mockResolvedValue({
      data: {
        items: [
          {
            id: "item-1",
            checklistId: "checklist-a",
            title: "Stampa mano",
            status: "In corso",
            origin: { type: "deviceRequest", id: "req-1" },
          },
        ],
      },
    });

    render(<MyChecklistItems originBasePath="/admin/request" />);

    const originButton = await screen.findByRole("button", { name: "Richiesta REQ-000042" });
    await userEvent.click(originButton);

    expect(mockNavigate).toHaveBeenCalledWith("/admin/request/req-1");
  });

  // Scenario: un item il cui origin e' null non mostra alcuna azione di navigazione (EA-155)
  it("non mostra alcuna azione di navigazione per un item con origin null", async () => {
    callable.mockResolvedValue({
      data: {
        items: [
          { id: "item-1", checklistId: "checklist-a", title: "Stampa mano", status: "In corso", origin: null },
        ],
      },
    });

    render(<MyChecklistItems />);
    const row = await rowFor("Stampa mano");

    expect(within(row).queryByRole("button", { name: /Richiesta/ })).not.toBeInTheDocument();
    // Colonne, in ordine: Descrizione, Stato, Quantità, Note, Provenienza —
    // l'ultima (Provenienza) mostra "-" quando origin e' null.
    expect(row.querySelectorAll("td")[4]).toHaveTextContent("-");
  });

  // Scenario: un item completato (senza origin nella risposta) non mostra alcuna azione di navigazione (EA-155)
  it("non mostra alcun contesto di provenienza per un item con stato Completata (nessun campo origin)", async () => {
    callable.mockResolvedValue({
      data: {
        items: [
          { id: "item-1", checklistId: "checklist-a", title: "Stampa mano", status: "Completata" },
        ],
      },
    });

    render(<MyChecklistItems />);

    // Il filtro "Solo aperti" e' attivo di default: un item completato
    // resta nascosto finche' non si passa a "Tutti".
    await screen.findByText("Nessun item corrispondente ai filtri.");
    await userEvent.click(screen.getByRole("checkbox"));

    const row = await rowFor("Stampa mano");
    expect(within(row).queryByText(/Richiesta/)).not.toBeInTheDocument();
    expect(row.querySelectorAll("td")[4]).toHaveTextContent("-");
  });

  // Scenario: il volontario senza item assegnati vede uno stato vuoto esplicativo
  it("mostra un messaggio esplicativo di assenza item, non una tabella vuota, quando non ci sono item assegnati", async () => {
    callable.mockResolvedValue({ data: { items: [] } });

    render(<MyChecklistItems />);

    expect(
      await screen.findByText("Non hai al momento nessun item di checklist assegnato.")
    ).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  // Scenario: un errore restituito dalla Cloud Function mostra un messaggio di errore al volontario
  it("mostra un messaggio di errore comprensibile quando la chiamata a listMyChecklistItems fallisce", async () => {
    callable.mockRejectedValue(new Error("internal"));

    render(<MyChecklistItems />);

    expect(await screen.findByText("internal")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});

// Regressione (bug segnalato dall'operatore): la pagina nasce per gestire
// "in blocco" tutti gli item assegnati — toggle Tutti/Solo aperti, filtro
// per stato, colonna Note, e possibilita' di aggiornare Stato/Completato
// direttamente da qui, non solo consultare in sola lettura.
describe("MyChecklistItems - gestione in blocco: toggle, filtro stato, Note ed editing diretto", () => {
  beforeEach(() => {
    callable.mockReset();
    mockNavigate.mockReset();
    for (const key of Object.keys(firestoreDocs)) delete firestoreDocs[key];
  });

  it("di default mostra solo gli item aperti; il toggle 'Tutti' mostra anche quelli completati", async () => {
    callable.mockResolvedValue({
      data: {
        items: [
          { id: "item-1", checklistId: "checklist-a", title: "Item aperto", status: "In corso" },
          { id: "item-2", checklistId: "checklist-b", title: "Item completato", status: "Completata" },
        ],
      },
    });

    render(<MyChecklistItems />);

    expect(await screen.findByText("Item aperto")).toBeInTheDocument();
    expect(screen.queryByText("Item completato")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("checkbox"));

    expect(await screen.findByText("Item completato")).toBeInTheDocument();
    expect(screen.getByText("Item aperto")).toBeInTheDocument();
  });

  it("un item boolean completato (completed=true, status diverso da Completata) e' considerato chiuso dal filtro 'Solo aperti'", async () => {
    callable.mockResolvedValue({
      data: {
        items: [
          {
            id: "item-1",
            checklistId: "checklist-a",
            title: "Verifica batteria",
            type: "boolean",
            status: "Assegnare",
            completed: true,
          },
        ],
      },
    });

    render(<MyChecklistItems />);

    await screen.findByText("Nessun item corrispondente ai filtri.");
  });

  it("mostra il contenuto del campo Note per ciascun item, editabile, vuoto se assente", async () => {
    callable.mockResolvedValue({
      data: {
        items: [
          { id: "item-1", checklistId: "checklist-a", title: "Con nota", status: "In corso", notes: "Attenzione al peso" },
          { id: "item-2", checklistId: "checklist-b", title: "Senza nota", status: "In corso" },
        ],
      },
    });

    render(<MyChecklistItems />);

    const row1 = await rowFor("Con nota");
    expect(within(row1).getByDisplayValue("Attenzione al peso")).toBeInTheDocument();
    const row2 = await rowFor("Senza nota");
    expect(row2.querySelector("textarea")).toHaveValue("");
  });

  it("modificare il campo Note la mappa (con debounce) su updateDeviceRequestChecklistItem", async () => {
    callable.mockImplementation((name: string) => {
      if (name === "listMyChecklistItems") {
        return Promise.resolve({
          data: {
            items: [
              {
                id: "item-1",
                checklistId: "checklist-a",
                title: "Stampa mano",
                type: "generic",
                status: "Assegnare",
                notes: "",
                origin: { type: "deviceRequest", id: "req-1" },
              },
            ],
          },
        });
      }
      if (name === "updateDeviceRequestChecklistItem") {
        return Promise.resolve({ data: {} });
      }
      return Promise.reject(new Error(`Unexpected callable invoked in test: ${name}`));
    });

    render(<MyChecklistItems />);
    const row = await rowFor("Stampa mano");
    // Il Dropdown "Stato" espone anche un input nascosto di sola lettura
    // con role="textbox" per l'accessibilita': va selezionata direttamente
    // la textarea delle Note, non tramite role (ambiguo in questa riga).
    const notesInput = row.querySelector("textarea") as HTMLTextAreaElement;
    await userEvent.type(notesInput, "Peso verificato");

    await vi.waitFor(
      () => {
        expect(callable).toHaveBeenCalledWith("updateDeviceRequestChecklistItem", {
          requestId: "req-1",
          checklistId: "checklist-a",
          itemId: "item-1",
          notes: "Peso verificato",
        });
      },
      { timeout: 1500 }
    );
  });

  it("modificare la Quantità di un item numeric la mappa immediatamente su updateDeviceRequestChecklistItem", async () => {
    callable.mockImplementation((name: string) => {
      if (name === "listMyChecklistItems") {
        return Promise.resolve({
          data: {
            items: [
              {
                id: "item-1",
                checklistId: "checklist-a",
                title: "Filamento",
                type: "numeric",
                status: "Assegnare",
                quantity: null,
                origin: { type: "deviceRequest", id: "req-1" },
              },
            ],
          },
        });
      }
      if (name === "updateDeviceRequestChecklistItem") {
        return Promise.resolve({ data: {} });
      }
      return Promise.reject(new Error(`Unexpected callable invoked in test: ${name}`));
    });

    render(<MyChecklistItems />);
    const row = await rowFor("Filamento");
    const quantityInput = within(row).getByRole("spinbutton");
    await userEvent.type(quantityInput, "3");
    await userEvent.tab();

    expect(callable).toHaveBeenCalledWith("updateDeviceRequestChecklistItem", {
      requestId: "req-1",
      checklistId: "checklist-a",
      itemId: "item-1",
      quantity: 3,
    });
  });

  it("cambiare lo Stato di un item generic lo mappa immediatamente su updateDeviceRequestChecklistItem, senza reload dell'intero elenco", async () => {
    callable.mockImplementation((name: string) => {
      if (name === "listMyChecklistItems") {
        return Promise.resolve({
          data: {
            items: [
              {
                id: "item-1",
                checklistId: "checklist-a",
                title: "Stampa mano",
                type: "generic",
                status: "Assegnare",
                origin: { type: "deviceRequest", id: "req-1" },
              },
            ],
          },
        });
      }
      if (name === "updateDeviceRequestChecklistItem") {
        return Promise.resolve({ data: {} });
      }
      return Promise.reject(new Error(`Unexpected callable invoked in test: ${name}`));
    });

    render(<MyChecklistItems />);
    const row = await rowFor("Stampa mano");
    const statusTrigger = row.querySelector(".p-dropdown-trigger") as HTMLElement;
    await userEvent.click(statusTrigger);
    const option = (await screen.findByText("Completata")).closest("li");
    if (!option) throw new Error("Option 'Completata' not found");
    await userEvent.click(option);

    expect(callable).toHaveBeenCalledWith("updateDeviceRequestChecklistItem", {
      requestId: "req-1",
      checklistId: "checklist-a",
      itemId: "item-1",
      status: "Completata",
    });
    // Nessun secondo giro di listMyChecklistItems dopo l'update: solo la
    // chiamata iniziale di caricamento.
    expect(callable.mock.calls.filter(([n]) => n === "listMyChecklistItems")).toHaveLength(1);
  });

  it("selezionare il checkbox 'Completato' per un item boolean sincronizza anche lo status a 'Completata'", async () => {
    callable.mockImplementation((name: string) => {
      if (name === "listMyChecklistItems") {
        return Promise.resolve({
          data: {
            items: [
              {
                id: "item-1",
                checklistId: "checklist-a",
                title: "Verifica batteria",
                type: "boolean",
                status: "Assegnare",
                completed: false,
                origin: { type: "deviceRequest", id: "req-1" },
              },
            ],
          },
        });
      }
      if (name === "updateDeviceRequestChecklistItem") {
        return Promise.resolve({ data: {} });
      }
      return Promise.reject(new Error(`Unexpected callable invoked in test: ${name}`));
    });

    render(<MyChecklistItems />);
    const row = await rowFor("Verifica batteria");
    await userEvent.click(within(row).getByRole("checkbox"));

    expect(callable).toHaveBeenCalledWith("updateDeviceRequestChecklistItem", {
      requestId: "req-1",
      checklistId: "checklist-a",
      itemId: "item-1",
      completed: true,
      status: "Completata",
    });
  });

  it("disabilita l'editing di Stato/Completato quando l'item non ha un origin di tipo deviceRequest risolto", async () => {
    callable.mockResolvedValue({
      data: {
        items: [
          { id: "item-1", checklistId: "checklist-a", title: "Item orfano", status: "In corso", origin: null },
        ],
      },
    });

    render(<MyChecklistItems />);
    const row = await rowFor("Item orfano");

    // Il trigger del Dropdown e' un <div role="button">, non un elemento
    // form nativo disabilitabile via attributo HTML: PrimeReact esprime lo
    // stato disabilitato con la classe p-disabled sul contenitore root.
    expect(row.querySelector(".p-dropdown")).toHaveClass("p-disabled");
  });

  it("un errore durante l'aggiornamento ripristina il valore precedente e mostra un messaggio", async () => {
    callable.mockImplementation((name: string) => {
      if (name === "listMyChecklistItems") {
        return Promise.resolve({
          data: {
            items: [
              {
                id: "item-1",
                checklistId: "checklist-a",
                title: "Stampa mano",
                type: "generic",
                status: "Assegnare",
                origin: { type: "deviceRequest", id: "req-1" },
              },
            ],
          },
        });
      }
      if (name === "updateDeviceRequestChecklistItem") {
        return Promise.reject(new Error("Permission denied"));
      }
      return Promise.reject(new Error(`Unexpected callable invoked in test: ${name}`));
    });

    render(<MyChecklistItems />);
    const row = await rowFor("Stampa mano");
    const statusTrigger = row.querySelector(".p-dropdown-trigger") as HTMLElement;
    await userEvent.click(statusTrigger);
    const option = (await screen.findByText("Completata")).closest("li");
    if (!option) throw new Error("Option 'Completata' not found");
    await userEvent.click(option);

    expect(await screen.findByText("Permission denied")).toBeInTheDocument();
    // Rollback: lo stato torna quello precedente al tentativo fallito.
    // Nodo di riga ri-ottenuto: dopo il rollback React puo' aver
    // rimpiazzato l'elemento <tr>, la vecchia referenza risulterebbe stale.
    const rowAfterRollback = await rowFor("Stampa mano");
    expect(within(rowAfterRollback).getByText("Assegnare", { selector: "span" })).toBeInTheDocument();
  });

  it("filtra per stato tramite il MultiSelect dedicato", async () => {
    callable.mockResolvedValue({
      data: {
        items: [
          { id: "item-1", checklistId: "checklist-a", title: "Da iniziare qui", status: "Da iniziare" },
          { id: "item-2", checklistId: "checklist-b", title: "In corso qui", status: "In corso" },
        ],
      },
    });

    render(<MyChecklistItems />);
    await screen.findByText("Da iniziare qui");
    await screen.findByText("In corso qui");

    const filterTrigger = screen.getByText("Filtra per stato");
    await userEvent.click(filterTrigger);
    const option = (await screen.findAllByText("Da iniziare")).find((el) => el.closest("li"));
    if (!option) throw new Error("Filter option 'Da iniziare' not found");
    await userEvent.click(option);
    // Chiude il pannello del MultiSelect cliccando altrove, cosi' non
    // interferisce con le query successive sul testo delle righe.
    await userEvent.click(document.body);

    expect(screen.getByText("Da iniziare qui")).toBeInTheDocument();
    expect(screen.queryByText("In corso qui")).not.toBeInTheDocument();
  });
});
