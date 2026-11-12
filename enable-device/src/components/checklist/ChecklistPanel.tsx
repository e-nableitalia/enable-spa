import { useCallback, useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { httpsCallable } from "firebase/functions";
import { functions } from "../../firebase";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Button } from "primereact/button";
import { Dialog } from "primereact/dialog";
import { InputText } from "primereact/inputtext";
import { InputNumber } from "primereact/inputnumber";
import { InputTextarea } from "primereact/inputtextarea";
import { Checkbox } from "primereact/checkbox";
import { Dropdown } from "primereact/dropdown";
import { Tag } from "primereact/tag";
import { Toast } from "primereact/toast";
import { ConfirmDialog, confirmDialog } from "primereact/confirmdialog";

const CHECKLIST_ITEM_STATUSES = ["Assegnare", "Da iniziare", "In corso", "Completata"];

type ChecklistItemType = "boolean" | "generic" | "numeric" | "purchase";

const CHECKLIST_ITEM_TYPE_OPTIONS: { label: string; value: ChecklistItemType }[] = [
  { label: "Sì/No", value: "boolean" },
  { label: "Generico", value: "generic" },
  { label: "Quantità numerica", value: "numeric" },
  { label: "Acquisto", value: "purchase" },
];

interface ChecklistItem {
  id: string;
  title: string;
  /** Discriminante opzionale: gli item creati prima di EA-123 o aggiunti
   * tramite `addChecklistItem` (che non lo accetta ancora, vedi EA-121)
   * possono non averlo. In assenza di `type`, la colonna Quantità resta
   * nascosta (comportamento "fail closed", coerente con 'boolean'/'generic'). */
  type?: ChecklistItemType;
  assignee: string | null;
  quantity: number | null;
  url: string | null;
  notes: string;
  status: string;
  completed: boolean;
}

interface ChecklistData {
  checklistId: string;
  category?: unknown;
  title?: unknown;
  items: ChecklistItem[];
}

interface NewItemForm {
  title: string;
  type: ChecklistItemType | null;
  assignee: string;
  quantity: number | null;
  url: string;
  notes: string;
}

const EMPTY_NEW_ITEM: NewItemForm = { title: "", type: null, assignee: "", quantity: null, url: "", notes: "" };

interface AssignableUser {
  id: string;
  label: string;
}

interface Props {
  /** Id della deviceRequest a cui è collegata la checklist. */
  requestId: string;
  /** Id della checklist collegata alla richiesta, se presente. */
  checklistId?: string | null;
  /**
   * Invocato dopo ogni caricamento riuscito con il `title` reale della
   * checklist: usato dal genitore (`DeviceRequestChecklists.tsx`) per
   * etichettare la tab col titolo effettivo invece del solo indice
   * posizionale ("Checklist 1"/"2"/...), che non riflette il titolo scelto
   * alla creazione né un'eventuale rinomina.
   */
  onTitleResolved?: (title: string) => void;
  /**
   * Monta il proprio `<ConfirmDialog />` (usato da `confirmDialog()` per la
   * rimozione item) — default `true`, per restare autonomo se usato
   * standalone (es. nei test). `DeviceRequestChecklists.tsx` monta N
   * istanze di `ChecklistPanel` in parallelo (una per tab, tutte mostrate
   * grazie a `renderActiveOnly={false}`): `confirmDialog()` è un servizio
   * globale, N `<ConfirmDialog />` mostrerebbero N dialog sovrapposti alla
   * stessa conferma (bug scoperto insieme a quel fix) — il genitore passa
   * `false` qui e monta un unico `<ConfirmDialog />` condiviso.
   */
  renderConfirmDialog?: boolean;
}

/**
 * Pannello di gestione operativa della checklist di fabbricazione
 * collegata a una deviceRequest (item, assegnatario, quantità, note,
 * stato — modello v1 del core Organizer), condiviso tra la vista admin
 * (RequestDetail) e le viste volontario (VolunteerRequestDetail,
 * ManageableRequestDetail).
 *
 * Tutte le operazioni passano dal layer device-requests
 * (`getDeviceRequestChecklist`, `getDeviceRequestChecklistCompleteness`,
 * `addDeviceRequestChecklistItem`, `updateDeviceRequestChecklistItem`,
 * `removeDeviceRequestChecklistItem`), che applica il controllo RBAC
 * (admin o volontario assegnato alla richiesta) prima di delegare al
 * core Organizer: nessun dato PII del beneficiario transita per questi
 * item, che sono dati operativi di fabbricazione (titolo, assegnatario,
 * note), non anagrafici.
 *
 * EA-141: l'assegnatario di un item non è più un campo di testo libero,
 * ma una selezione tra utenti reali risolti (volontari assegnati alla
 * deviceRequest più l'utente corrente se admin) — stesso perimetro
 * validato lato backend da `isResolvableChecklistAssignee`
 * (`deviceRequestChecklistAccess.ts`).
 */
export default function ChecklistPanel({
  requestId,
  checklistId,
  onTitleResolved,
  renderConfirmDialog = true,
}: Props) {
  const toast = useRef<Toast>(null);
  const [checklist, setChecklist] = useState<ChecklistData | null>(null);
  const [complete, setComplete] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savingItemId, setSavingItemId] = useState<string | null>(null);
  const [removingItemId, setRemovingItemId] = useState<string | null>(null);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showEditChecklistDialog, setShowEditChecklistDialog] = useState(false);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [showImportHelpDialog, setShowImportHelpDialog] = useState(false);
  const [newItem, setNewItem] = useState<NewItemForm>(EMPTY_NEW_ITEM);
  const [addingItem, setAddingItem] = useState(false);
  const [savingChecklistTitle, setSavingChecklistTitle] = useState(false);
  const [editChecklistTitle, setEditChecklistTitle] = useState("");
  const [importingItems, setImportingItems] = useState(false);
  const [importText, setImportText] = useState("");
  const [importFileName, setImportFileName] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Partial<ChecklistItem>>>({});
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [generatingShareLink, setGeneratingShareLink] = useState(false);
  const [assignableUsers, setAssignableUsers] = useState<AssignableUser[]>([]);

  // Debounce per-item dell'autosave sui campi testo (Descrizione/Note): un
  // salvataggio ad ogni singolo tasto digitato sarebbe troppo frequente,
  // mentre per select/checkbox/numero (eventi discreti, non stream di
  // keystroke) il salvataggio è sempre immediato.
  const autosaveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  useEffect(() => {
    const timers = autosaveTimers.current;
    return () => {
      Object.values(timers).forEach(clearTimeout);
    };
  }, []);

  // Ref stabile per onTitleResolved: evita di doverla includere nelle
  // dipendenze di `load` sotto, dove causerebbe un loop di ricarica se il
  // genitore non la memoizza (ogni render del genitore ricrea altrimenti
  // una nuova identità di funzione).
  const onTitleResolvedRef = useRef(onTitleResolved);
  useEffect(() => {
    onTitleResolvedRef.current = onTitleResolved;
  }, [onTitleResolved]);

  /**
   * Utenti reali selezionabili come assegnatario di un item (EA-141,
   * estesa da F-27): i volontari assegnati alla deviceRequest più
   * **tutti** gli admin dell'organizzazione. `listAssignableChecklistUsers`
   * restituisce già `{ id, label }[]` con i nomi risolti via Admin SDK —
   * le regole Firestore non permettono al client di leggere i
   * `private/profile` altrui né di enumerare gli admin. Stesso perimetro
   * RBAC validato lato backend da `isResolvableChecklistAssignee`.
   */
  const loadAssignableUsers = useCallback(async () => {
    if (!requestId) {
      setAssignableUsers([]);
      return;
    }
    try {
      const fn = httpsCallable<{ requestId: string }, { users: AssignableUser[] }>(
        functions,
        "listAssignableChecklistUsers"
      );
      const result = await fn({ requestId });
      setAssignableUsers(Array.isArray(result.data.users) ? result.data.users : []);
    } catch (err) {
      console.error("[ChecklistPanel] Failed to load assignable users", err);
      setAssignableUsers([]);
      toast.current?.show({
        severity: "warn",
        summary: "Assegnatari non disponibili",
        detail: "Impossibile caricare l'elenco degli assegnatari per questa richiesta.",
        life: 4000,
      });
    }
  }, [requestId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loadAssignableUsers fetches from Firestore, not derivable from props/state
    loadAssignableUsers();
  }, [loadAssignableUsers]);

  /** Opzioni per la Dropdown assegnatario di `item`: include il valore
   * attualmente salvato anche se non (più) tra gli `assignableUsers`
   * risolti, cosi' resta visibile invece di apparire come non impostato. */
  const assigneeOptionsFor = (currentAssignee: string | null): AssignableUser[] => {
    if (currentAssignee && !assignableUsers.some((u) => u.id === currentAssignee)) {
      return [...assignableUsers, { id: currentAssignee, label: currentAssignee }];
    }
    return assignableUsers;
  };

  const load = useCallback(async () => {
    if (!requestId || !checklistId) {
      setChecklist(null);
      setComplete(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const getChecklistFn = httpsCallable<{ requestId: string; checklistId: string }, ChecklistData>(
        functions,
        "getDeviceRequestChecklist"
      );
      const getCompletenessFn = httpsCallable<{ requestId: string; checklistId: string }, { complete: boolean }>(
        functions,
        "getDeviceRequestChecklistCompleteness"
      );
      const [checklistResult, completenessResult] = await Promise.all([
        getChecklistFn({ requestId, checklistId }),
        getCompletenessFn({ requestId, checklistId }),
      ]);
      setChecklist(checklistResult.data);
      setComplete(completenessResult.data.complete);
      setDrafts({});
      if (typeof checklistResult.data.title === "string") {
        onTitleResolvedRef.current?.(checklistResult.data.title);
      }
    } catch (err) {
      console.error("[ChecklistPanel] Failed to load checklist", err);
      setError(
        err instanceof Error
          ? err.message
          : "Impossibile caricare la checklist di fabbricazione per questa richiesta."
      );
      setChecklist(null);
      setComplete(null);
    } finally {
      setLoading(false);
    }
  }, [requestId, checklistId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load fetches from Cloud Functions, not derivable from props/state
    load();
  }, [load]);

  const getDraft = (item: ChecklistItem): ChecklistItem => ({ ...item, ...drafts[item.id] });

  const setDraftField = (itemId: string, patch: Partial<ChecklistItem>) => {
    setDrafts((prev) => ({ ...prev, [itemId]: { ...prev[itemId], ...patch } }));
  };

  // Nessun pulsante "Salva" esplicito: ogni modifica a una riga è mappata
  // immediatamente sul backend. Il toast di successo è stato rimosso
  // (sarebbe apparso ad ogni singolo campo modificato, troppo invasivo per
  // un salvataggio ormai silenzioso) — resta solo l'indicatore "in corso"
  // per riga (vedi savingItemId nella colonna Azioni) e il toast di errore.
  const saveItem = async (item: ChecklistItem) => {
    setSavingItemId(item.id);
    try {
      const fn = httpsCallable(functions, "updateDeviceRequestChecklistItem");
      await fn({
        requestId,
        checklistId,
        itemId: item.id,
        title: item.title,
        assignee: item.assignee,
        quantity: item.quantity,
        url: item.url,
        notes: item.notes,
        status: item.status,
        completed: item.completed,
      });
      await load();
    } catch (err) {
      toast.current?.show({
        severity: "error",
        summary: "Errore",
        detail: err instanceof Error ? err.message : "Errore durante l'aggiornamento dell'item.",
        life: 4000,
      });
    } finally {
      setSavingItemId(null);
    }
  };

  /**
   * Applica una modifica al draft locale (reattività immediata in UI) e la
   * mappa sul backend: senza debounce per select/checkbox/numero (eventi
   * discreti, salvataggio immediato), con debounce di 600ms per i campi
   * testo (Descrizione/Note) per non salvare ad ogni singolo tasto.
   */
  const commitField = (item: ChecklistItem, patch: Partial<ChecklistItem>, debounce = false) => {
    setDraftField(item.id, patch);
    const updated: ChecklistItem = { ...item, ...patch };

    const pendingTimer = autosaveTimers.current[item.id];
    if (pendingTimer) {
      clearTimeout(pendingTimer);
      delete autosaveTimers.current[item.id];
    }

    if (!debounce) {
      saveItem(updated);
      return;
    }
    autosaveTimers.current[item.id] = setTimeout(() => {
      delete autosaveTimers.current[item.id];
      saveItem(updated);
    }, 600);
  };

  const removeItem = (item: ChecklistItem) => {
    confirmDialog({
      message: `Rimuovere l'item "${item.title}" dalla checklist?`,
      header: "Conferma rimozione",
      icon: "pi pi-exclamation-triangle",
      acceptLabel: "Rimuovi",
      rejectLabel: "Annulla",
      acceptClassName: "p-button-danger",
      accept: async () => {
        setRemovingItemId(item.id);
        try {
          const fn = httpsCallable(functions, "removeDeviceRequestChecklistItem");
          await fn({ requestId, checklistId, itemId: item.id });
          toast.current?.show({ severity: "success", summary: "Item rimosso", life: 2500 });
          await load();
        } catch (err) {
          toast.current?.show({
            severity: "error",
            summary: "Errore",
            detail: err instanceof Error ? err.message : "Errore durante la rimozione dell'item.",
            life: 4000,
          });
        } finally {
          setRemovingItemId(null);
        }
      },
    });
  };

  const addItem = async () => {
    if (!newItem.title.trim()) return;
    setAddingItem(true);
    try {
      const fn = httpsCallable(functions, "addDeviceRequestChecklistItem");
      await fn({
        requestId,
        checklistId,
        title: newItem.title.trim(),
        type: newItem.type ?? undefined,
        assignee: newItem.assignee.trim() || undefined,
        quantity: newItem.quantity ?? undefined,
        url: newItem.url.trim() || undefined,
        notes: newItem.notes.trim() || undefined,
      });
      toast.current?.show({ severity: "success", summary: "Item aggiunto", life: 2500 });
      setShowAddDialog(false);
      setNewItem(EMPTY_NEW_ITEM);
      await load();
    } catch (err) {
      toast.current?.show({
        severity: "error",
        summary: "Errore",
        detail: err instanceof Error ? err.message : "Errore durante l'aggiunta dell'item.",
        life: 4000,
      });
    } finally {
      setAddingItem(false);
    }
  };

  const openEditChecklistDialog = () => {
    setEditChecklistTitle((checklist?.title as string) ?? "");
    setShowEditChecklistDialog(true);
  };

  const saveChecklistTitle = async () => {
    const title = editChecklistTitle.trim();
    if (!title) return;
    setSavingChecklistTitle(true);
    try {
      const fn = httpsCallable<
        { requestId: string; checklistId: string; title: string },
        { checklistId: string; title: string }
      >(functions, "updateDeviceRequestChecklistTitle");
      await fn({ requestId, checklistId: checklistId as string, title });
      toast.current?.show({ severity: "success", summary: "Checklist aggiornata", life: 2500 });
      setShowEditChecklistDialog(false);
      await load();
    } catch (err) {
      toast.current?.show({
        severity: "error",
        summary: "Errore",
        detail: err instanceof Error ? err.message : "Errore durante il salvataggio della checklist.",
        life: 4000,
      });
    } finally {
      setSavingChecklistTitle(false);
    }
  };

  interface ParsedImportLine {
    type: "boolean" | "numeric" | "purchase";
    title: string;
    quantity?: number;
    url?: string;
    notes?: string;
    assignee?: string;
  }

  const parseImportedLines = (raw: string): string[] =>
    raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

  const parseChecklistImportLine = (line: string): ParsedImportLine | null => {
    const [basePart, ...notesParts] = line.split("|");
    const baseWithAssignee = basePart.trim();
    const notes = notesParts.join("|").trim();
    const assigneeMatch = baseWithAssignee.match(/\s+@(?:\[([^\]]+)\]|([^\s]+))\s*$/);
    const assigneeToken = (assigneeMatch?.[1] ?? assigneeMatch?.[2] ?? "").trim();
    const base = assigneeMatch
      ? baseWithAssignee.slice(0, assigneeMatch.index).trim()
      : baseWithAssignee;

    const assignee = assigneeToken || undefined;

    const withLinkMatch = base.match(/^(\d+)\s*x\s+\[([^\]]+)\]\((https?:\/\/\S+)\)$/i);
    if (withLinkMatch) {
      return {
        type: "purchase",
        quantity: Number(withLinkMatch[1]),
        title: withLinkMatch[2].trim(),
        url: withLinkMatch[3].trim(),
        notes: notes || undefined,
        assignee,
      };
    }
    const quantityMatch = base.match(/^(\d+)\s*x\s+(.+)$/i);
    if (quantityMatch) {
      return {
        type: "numeric",
        quantity: Number(quantityMatch[1]),
        title: quantityMatch[2].trim(),
        notes: notes || undefined,
        assignee,
      };
    }

    // Senza prefisso "<digit>x" l'item e' considerato item base (boolean):
    // descrizione valida come parola singola, oppure testo multi-parola
    // racchiuso tra [].
    const bracketedTitleMatch = base.match(/^\[([^\]]+)\]$/);
    if (bracketedTitleMatch) {
      return {
        type: "boolean",
        title: bracketedTitleMatch[1].trim(),
        notes: notes || undefined,
        assignee,
      };
    }
    if (/^\S+$/.test(base)) {
      return {
        type: "boolean",
        title: base.trim(),
        notes: notes || undefined,
        assignee,
      };
    }
    return null;
  };

  const handleImportFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setImportFileName(file.name);
    try {
      const text = await file.text();
      setImportText((prev) => {
        if (!prev.trim()) return text;
        return `${prev}\n${text}`;
      });
    } catch {
      toast.current?.show({
        severity: "error",
        summary: "Errore",
        detail: "Impossibile leggere il file selezionato.",
        life: 4000,
      });
    } finally {
      event.target.value = "";
    }
  };

  const importItems = async () => {
    const lines = parseImportedLines(importText);
    if (lines.length === 0) {
      toast.current?.show({
        severity: "warn",
        summary: "Nessun item da importare",
        detail: "Inserisci almeno una riga non vuota.",
        life: 3000,
      });
      return;
    }

    setImportingItems(true);
    try {
      const fn = httpsCallable(functions, "addDeviceRequestChecklistItem");
      const parsed = lines.map((line) => ({ line, parsed: parseChecklistImportLine(line) }));
      const invalid = parsed.filter((entry) => !entry.parsed).map((entry) => entry.line);
      if (invalid.length > 0) {
        toast.current?.show({
          severity: "warn",
          summary: "Formato non valido",
          detail:
            "Usa '3x Titolo', '3x [Titolo](https://url)' oppure item senza quantita': 'Titolo' / '[Titolo con spazi]'. Modificatori: @owner e '| nota'.",
          life: 5000,
        });
        setImportingItems(false);
        return;
      }
      for (const entry of parsed) {
        const item = entry.parsed as ParsedImportLine;
        await fn({
          requestId,
          checklistId,
          title: item.title,
          type: item.type,
          quantity: item.quantity,
          url: item.url,
          notes: item.notes,
          assignee: item.assignee,
        });
      }
      toast.current?.show({
        severity: "success",
        summary: "Import completato",
        detail: `${lines.length} item importati.`,
        life: 3000,
      });
      setShowImportDialog(false);
      setImportText("");
      setImportFileName(null);
      await load();
    } catch (err) {
      toast.current?.show({
        severity: "error",
        summary: "Errore",
        detail: err instanceof Error ? err.message : "Errore durante l'import degli item.",
        life: 5000,
      });
    } finally {
      setImportingItems(false);
    }
  };

  const generateShareLink = async () => {
    setGeneratingShareLink(true);
    try {
      const fn = httpsCallable<{ requestId: string; checklistId: string }, { token: string; url: string }>(
        functions,
        "createChecklistShareLink"
      );
      const result = await fn({ requestId, checklistId: checklistId as string });
      setShareUrl(result.data.url);
    } catch (err) {
      toast.current?.show({
        severity: "error",
        summary: "Errore",
        detail: err instanceof Error ? err.message : "Errore durante la generazione del link di condivisione.",
        life: 4000,
      });
    } finally {
      setGeneratingShareLink(false);
    }
  };

  const copyShareLink = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      toast.current?.show({ severity: "success", summary: "Link copiato", life: 2000 });
    } catch {
      // Copia negli appunti non disponibile: il link resta comunque visibile e selezionabile a mano.
    }
  };

  if (!checklistId) {
    return null;
  }

  return (
    <div>
      <Toast ref={toast} />
      {renderConfirmDialog && <ConfirmDialog />}

      {loading && !checklist && <div style={{ color: "#888" }}>Caricamento checklist...</div>}

      {error && (
        <div style={{ color: "#b91c1c", marginBottom: 12 }}>{error}</div>
      )}

      {checklist && (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
            <div>
              <strong>Titolo:</strong> {(checklist.title as string) || "-"}
            </div>
            <div>
              <strong>Categoria:</strong> {(checklist.category as string) || "-"}
            </div>
            {complete !== null && (
              <Tag
                value={complete ? "Checklist completa" : "Checklist in corso"}
                severity={complete ? "success" : "warning"}
              />
            )}
            <Button
              label="Aggiungi item"
              icon="pi pi-plus"
              size="small"
              className="p-button-text"
              onClick={() => setShowAddDialog(true)}
            />
            <Button
              label="Modifica checklist"
              icon="pi pi-pencil"
              size="small"
              className="p-button-text"
              onClick={openEditChecklistDialog}
            />
            <Button
              label="Importa item"
              icon="pi pi-upload"
              size="small"
              className="p-button-text"
              onClick={() => setShowImportDialog(true)}
            />
            <Button
              label="Genera link di condivisione"
              icon="pi pi-share-alt"
              size="small"
              className="p-button-text"
              loading={generatingShareLink}
              onClick={generateShareLink}
            />
          </div>

          <DataTable
            value={checklist.items.map(getDraft)}
            emptyMessage="Nessun item nella checklist."
            size="small"
          >
            <Column
              header="Descrizione"
              body={(item: ChecklistItem) => (
                <div>
                  <InputText
                    value={item.title}
                    onChange={(e) => commitField(item, { title: e.target.value }, true)}
                    style={{ width: "100%" }}
                  />
                  {(item.type === "numeric" || item.type === "purchase") && (
                    // Niente colonna Quantità dedicata (vuota per gli item
                    // non numeric, bug segnalato dall'operatore — stesso
                    // pattern già applicato a MyChecklistItems.tsx): inline
                    // sotto la Descrizione, solo dove serve davvero.
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 12, color: "#6b7280" }}>Quantità:</span>
                      <InputNumber
                        value={item.quantity ?? null}
                        onValueChange={(e) => commitField(item, { quantity: e.value ?? null })}
                        min={0}
                        inputStyle={{ width: 70 }}
                      />
                      {item.type === "purchase" && (
                        <InputText
                          value={item.url ?? ""}
                          onChange={(e) => commitField(item, { url: e.target.value }, true)}
                          placeholder="https://..."
                          style={{ flex: 1, minWidth: 220 }}
                        />
                      )}
                    </div>
                  )}
                </div>
              )}
              style={{ minWidth: 160 }}
            />
            <Column
              header="Assegnatario"
              body={(item: ChecklistItem) => (
                <Dropdown
                  value={item.assignee ?? null}
                  options={assigneeOptionsFor(item.assignee)}
                  optionLabel="label"
                  optionValue="id"
                  onChange={(e) => commitField(item, { assignee: e.value ?? null })}
                  placeholder="Non assegnato"
                  showClear
                  filter
                  emptyMessage="Nessun utente selezionabile per questa richiesta"
                  style={{ width: "100%" }}
                />
              )}
              style={{ minWidth: 180 }}
            />
            <Column
              header="Completato"
              body={(item: ChecklistItem) => {
                if (item.type !== "boolean") {
                  return null;
                }
                return (
                  <Checkbox
                    checked={item.completed}
                    // Il flag è la sola fonte di completezza per un item
                    // boolean (isBooleanItemComplete lo status non lo
                    // considera): tenerlo comunque sincronizzato con status
                    // evita un valore incoerente sul campo, anche se non più
                    // mostrato/editabile direttamente per questo tipo (vedi
                    // colonna "Stato" sotto).
                    onChange={(e) => {
                      const completed = Boolean(e.checked);
                      commitField(item, { completed, status: completed ? "Completata" : "Assegnare" });
                    }}
                  />
                );
              }}
              style={{ minWidth: 100 }}
            />
            <Column
              header="Stato"
              body={(item: ChecklistItem) => {
                // Per un item boolean lo stato non ha alcun ruolo nel gate
                // di completezza (isBooleanItemComplete lo ignora del
                // tutto) ed è tenuto sincronizzato automaticamente dal
                // checkbox "Completato" sopra: mostrarlo come editabile
                // qui suggerirebbe un controllo che non esiste.
                if (item.type === "boolean") {
                  return null;
                }
                return (
                  <Dropdown
                    value={item.status}
                    options={CHECKLIST_ITEM_STATUSES}
                    onChange={(e) => commitField(item, { status: e.value })}
                    style={{ width: "100%" }}
                  />
                );
              }}
              style={{ minWidth: 150 }}
            />
            <Column
              header="Note"
              body={(item: ChecklistItem) => (
                <InputTextarea
                  value={item.notes ?? ""}
                  onChange={(e) => commitField(item, { notes: e.target.value }, true)}
                  rows={1}
                  autoResize
                  style={{ width: "100%" }}
                />
              )}
              style={{ minWidth: 180 }}
            />
            <Column
              header="Azioni"
              body={(item: ChecklistItem) => (
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  {savingItemId === item.id && (
                    <i className="pi pi-spin pi-spinner" title="Salvataggio in corso..." style={{ fontSize: 14 }} />
                  )}
                  <Button
                    icon="pi pi-trash"
                    size="small"
                    className="p-button-text p-button-danger"
                    tooltip="Rimuovi"
                    loading={removingItemId === item.id}
                    onClick={() => removeItem(item)}
                  />
                </div>
              )}
              style={{ minWidth: 100 }}
            />
          </DataTable>
        </>
      )}

      <Dialog
        header="Modifica checklist"
        visible={showEditChecklistDialog}
        onHide={() => setShowEditChecklistDialog(false)}
        style={{ width: 480 }}
        footer={
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <Button
              label="Annulla"
              className="p-button-text"
              onClick={() => setShowEditChecklistDialog(false)}
              disabled={savingChecklistTitle}
            />
            <Button
              label="Salva"
              icon="pi pi-check"
              loading={savingChecklistTitle}
              disabled={!editChecklistTitle.trim()}
              onClick={saveChecklistTitle}
            />
          </div>
        }
      >
        <label htmlFor="editChecklistTitle" style={{ display: "block", marginBottom: 6 }}>
          Titolo checklist
        </label>
        <InputText
          id="editChecklistTitle"
          value={editChecklistTitle}
          onChange={(e) => setEditChecklistTitle(e.target.value)}
          style={{ width: "100%" }}
        />
      </Dialog>

      <Dialog
        header="Aggiungi item alla checklist"
        visible={showAddDialog}
        onHide={() => setShowAddDialog(false)}
        style={{ width: 480 }}
        footer={
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <Button label="Annulla" className="p-button-text" onClick={() => setShowAddDialog(false)} />
            <Button
              label="Aggiungi"
              icon="pi pi-plus"
              loading={addingItem}
              disabled={
                !newItem.title.trim() ||
                !newItem.type ||
                (newItem.type === "purchase" && (!newItem.quantity || newItem.quantity <= 0))
              }
              onClick={addItem}
            />
          </div>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <label style={{ display: "block", marginBottom: 4 }}>Descrizione</label>
            <InputText
              value={newItem.title}
              onChange={(e) => setNewItem((f) => ({ ...f, title: e.target.value }))}
              style={{ width: "100%" }}
            />
          </div>
          <div>
            <label style={{ display: "block", marginBottom: 4 }}>Assegnatario</label>
            <Dropdown
              value={newItem.assignee || null}
              options={assignableUsers}
              optionLabel="label"
              optionValue="id"
              onChange={(e) => setNewItem((f) => ({ ...f, assignee: e.value ?? "" }))}
              placeholder="Non assegnato"
              showClear
              filter
              emptyMessage="Nessun utente selezionabile per questa richiesta"
              style={{ width: "100%" }}
            />
          </div>
          <div>
            <label style={{ display: "block", marginBottom: 4 }}>Tipo</label>
            <Dropdown
              value={newItem.type}
              options={CHECKLIST_ITEM_TYPE_OPTIONS}
              onChange={(e) =>
                setNewItem((f) => ({
                  ...f,
                  type: e.value,
                  quantity: e.value === "numeric" || e.value === "purchase" ? f.quantity : null,
                  url: e.value === "purchase" ? f.url : "",
                }))
              }
              placeholder="Seleziona il tipo"
              style={{ width: "100%" }}
            />
          </div>
          {(newItem.type === "numeric" || newItem.type === "purchase") && (
            <div>
              <label style={{ display: "block", marginBottom: 4 }}>Quantità</label>
              <InputNumber
                value={newItem.quantity}
                onValueChange={(e) => setNewItem((f) => ({ ...f, quantity: e.value ?? null }))}
                min={0}
                style={{ width: "100%" }}
              />
            </div>
          )}
          {newItem.type === "purchase" && (
            <div>
              <label style={{ display: "block", marginBottom: 4 }}>URL (opzionale)</label>
              <InputText
                value={newItem.url}
                onChange={(e) => setNewItem((f) => ({ ...f, url: e.target.value }))}
                placeholder="https://..."
                style={{ width: "100%" }}
              />
            </div>
          )}
          <div>
            <label style={{ display: "block", marginBottom: 4 }}>Note</label>
            <InputTextarea
              value={newItem.notes}
              onChange={(e) => setNewItem((f) => ({ ...f, notes: e.target.value }))}
              rows={2}
              style={{ width: "100%" }}
            />
          </div>
        </div>
      </Dialog>

      <Dialog
        header="Importa item da testo o file"
        visible={showImportDialog}
        onHide={() => setShowImportDialog(false)}
        style={{ width: 520 }}
        footer={
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
            <Button
              label="Guida formato"
              icon="pi pi-question-circle"
              className="p-button-text"
              onClick={() => setShowImportHelpDialog(true)}
              disabled={importingItems}
            />
            <div style={{ display: "flex", gap: 8 }}>
            <Button
              label="Annulla"
              className="p-button-text"
              onClick={() => setShowImportDialog(false)}
              disabled={importingItems}
            />
            <Button
              label="Importa"
              icon="pi pi-upload"
              loading={importingItems}
              disabled={parseImportedLines(importText).length === 0}
              onClick={importItems}
            />
            </div>
          </div>
        }
      >
        <p style={{ marginTop: 0 }}>
          Esempio rapido: <code>3x [fogli protocollo](https://shop.example/fogli) @[Mario Rossi] | comprare A4</code>.
          Per tutti i formati supportati usa <strong>Guida formato</strong>.
        </p>
        <div style={{ marginBottom: 12 }}>
          <label htmlFor="checklistImportFile" style={{ display: "block", marginBottom: 6 }}>
            File locale (.txt)
          </label>
          <Button
            type="button"
            icon="pi pi-file"
            className="p-button-outlined p-button-sm"
            label={importFileName ?? "Scegli file .txt"}
            onClick={() => document.getElementById("checklistImportFile")?.click()}
            disabled={importingItems}
          />
          <input
            id="checklistImportFile"
            type="file"
            accept=".txt,text/plain"
            onChange={handleImportFileChange}
            style={{ display: "none" }}
          />
        </div>
        <div>
          <label htmlFor="checklistImportText" style={{ display: "block", marginBottom: 6 }}>
            Oppure incolla il testo (una riga per item)
          </label>
          <InputTextarea
            id="checklistImportText"
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            rows={10}
            style={{ width: "100%" }}
          />
        </div>
      </Dialog>

      <Dialog
        header="Guida formato import checklist"
        visible={showImportHelpDialog}
        onHide={() => setShowImportHelpDialog(false)}
        style={{ width: 560 }}
      >
        <p style={{ marginTop: 0 }}>
          Una riga = un item. La parte dopo il primo <code>|</code> viene salvata nelle note.
        </p>
        <p style={{ marginTop: 0, color: "#4b5563" }}>
          Casi supportati: item senza quantità (tipo boolean), quantità (<code>3x ...</code>), acquisto con link, owner/assegnatario,
          note e combinazioni tra questi.
        </p>
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          <li><code>fogli</code> - item base senza quantità (tipo boolean, descrizione a parola singola)</li>
          <li><code>[fogli protocollo]</code> - item base senza quantità (tipo boolean, descrizione con spazi tra parentesi quadre)</li>
          <li><code>[fogli protocollo] @alberto | da portare martedì</code> - item base + owner + note</li>
          <li><code>3x fogli</code> - item con quantità (tipo numeric)</li>
          <li><code>3x [fogli protocollo](https://shop.example/fogli)</code> - item da acquistare (tipo purchase)</li>
          <li><code>3x fogli @alberto</code> - owner/assegnatario senza spazi (uid o token)</li>
          <li><code>3x fogli @[Mario Rossi]</code> - owner/assegnatario con spazi nel nome</li>
          <li><code>3x [fogli protocollo](https://shop.example/fogli) @alberto</code> - acquisto + owner</li>
          <li><code>3x fogli @alberto | da portare martedì</code> - owner + note</li>
          <li><code>3x [fogli protocollo](https://shop.example/fogli) @[Mario Rossi] | comprare A4</code> - link + owner + note</li>
          <li><code>3x fogli | da portare | urgenti</code> - note con più separatori (restano nel testo note)</li>
        </ul>
        <p style={{ marginTop: 12, marginBottom: 0, color: "#4b5563" }}>
          Regola descrizione: senza quantità usa <code>parola</code> oppure <code>[testo con spazi]</code>; con quantità puoi usare
          testo libero dopo <code>3x</code> oppure il formato link <code>[titolo](https://url)</code>.
        </p>
        <p style={{ marginTop: 8, marginBottom: 0, color: "#4b5563" }}>
          Regola owner: <code>@token</code> o <code>@[Nome Cognome]</code> vanno prima delle note (prima di <code>|</code>).
          Best practice: usa <code>@[Nome Cognome]</code> quando il nome contiene spazi; usa <code>@uid</code> per un riferimento tecnico stabile nel tempo.
        </p>
      </Dialog>

      <Dialog
        header="Link di condivisione checklist"
        visible={shareUrl !== null}
        onHide={() => setShareUrl(null)}
        style={{ width: 480 }}
      >
        <p>
          Questo link mostra a chiunque lo apra, senza bisogno di accedere, solo la percentuale di
          avanzamento della checklist (nessun nome assegnatario, nota o altro dettaglio interno). Il
          link non scade e resta valido indefinitamente.
        </p>
        <div style={{ display: "flex", gap: 8 }}>
          <InputText value={shareUrl ?? ""} readOnly style={{ width: "100%" }} />
          <Button icon="pi pi-copy" tooltip="Copia" onClick={copyShareLink} />
        </div>
      </Dialog>
    </div>
  );
}
