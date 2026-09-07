import { useCallback, useEffect, useRef, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { doc, getDoc } from "firebase/firestore";
import { db, functions } from "../../firebase";
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

type ChecklistItemType = "boolean" | "generic" | "numeric";

const CHECKLIST_ITEM_TYPE_OPTIONS: { label: string; value: ChecklistItemType }[] = [
  { label: "Sì/No", value: "boolean" },
  { label: "Generico", value: "generic" },
  { label: "Quantità numerica", value: "numeric" },
];

interface ChecklistItem {
  id: string;
  title: string;
  type?: ChecklistItemType;
  assignee: string | null;
  quantity: number | null;
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
  notes: string;
}

const EMPTY_NEW_ITEM: NewItemForm = { title: "", type: null, assignee: "", quantity: null, notes: "" };

interface AssignableUser {
  id: string;
  label: string;
}

/**
 * Nome completo dell'utente `uid`, stesso pattern di
 * `ChecklistPanel.resolveAssignableUserLabel` (device-requests): fallback
 * sull'uid se il profilo privato non esiste o non è leggibile.
 */
async function resolveAssignableUserLabel(uid: string): Promise<string> {
  try {
    const profileSnap = await getDoc(doc(db, "users", uid, "private", "profile"));
    if (profileSnap.exists()) {
      const data = profileSnap.data() as { firstName?: string; lastName?: string };
      const fullName = `${data.firstName ?? ""} ${data.lastName ?? ""}`.trim();
      if (fullName) return fullName;
    }
  } catch {
    // Permessi insufficienti a leggere il profilo altrui: fallback sull'uid.
  }
  return uid;
}

interface Props {
  /** Id del progetto a cui è collegata la checklist. */
  projectId: string;
  checklistId: string;
  /** Invocato con il titolo reale della checklist, per etichettare la tab
   * del genitore (`ProjectChecklists.tsx`) col titolo effettivo. */
  onTitleResolved?: (title: string) => void;
  /** Vedi `ChecklistPanel.renderConfirmDialog`: il genitore monta N istanze
   * in parallelo (`renderActiveOnly={false}`), quindi un solo
   * `<ConfirmDialog />` condiviso invece di N sovrapposti. */
  renderConfirmDialog?: boolean;
  /** true quando lo stato del progetto non permette modifiche di contenuto
   * (`standby`/`archived`/`closed`): nasconde le azioni di scrittura invece
   * di lasciarle fallire lato server. */
  readOnly?: boolean;
}

/**
 * Pannello di gestione operativa della checklist collegata a un progetto
 * (EA-169/170) — stessa forma item di `ChecklistPanel.tsx` (device-requests)
 * ma verso le Cloud Function del dominio "projects", senza la funzionalità
 * di link di condivisione (non richiesta per i progetti). Componente nuovo
 * e distinto, non una generalizzazione di `ChecklistPanel`, per non
 * introdurre rischio sul codice già in produzione (decisione esplicita
 * della Story EA-170).
 */
export default function ProjectChecklistPanel({
  projectId,
  checklistId,
  onTitleResolved,
  renderConfirmDialog = true,
  readOnly = false,
}: Props) {
  const toast = useRef<Toast>(null);
  const [checklist, setChecklist] = useState<ChecklistData | null>(null);
  const [complete, setComplete] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savingItemId, setSavingItemId] = useState<string | null>(null);
  const [removingItemId, setRemovingItemId] = useState<string | null>(null);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [newItem, setNewItem] = useState<NewItemForm>(EMPTY_NEW_ITEM);
  const [addingItem, setAddingItem] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, Partial<ChecklistItem>>>({});
  const [assignableUsers, setAssignableUsers] = useState<AssignableUser[]>([]);

  const autosaveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  useEffect(() => {
    const timers = autosaveTimers.current;
    return () => {
      Object.values(timers).forEach(clearTimeout);
    };
  }, []);

  const onTitleResolvedRef = useRef(onTitleResolved);
  useEffect(() => {
    onTitleResolvedRef.current = onTitleResolved;
  }, [onTitleResolved]);

  const loadAssignableUsers = useCallback(async () => {
    try {
      const fn = httpsCallable<Record<string, never>, { uids: string[] }>(
        functions,
        "listAssignableProjectUsers"
      );
      const result = await fn({});
      const users = await Promise.all(
        result.data.uids.map(async (uid) => ({ id: uid, label: await resolveAssignableUserLabel(uid) }))
      );
      setAssignableUsers(users);
    } catch (err) {
      console.error("[ProjectChecklistPanel] Failed to load assignable users", err);
      setAssignableUsers([]);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loadAssignableUsers fetches from Firestore, not derivable from props/state
    loadAssignableUsers();
  }, [loadAssignableUsers]);

  const assigneeOptionsFor = (currentAssignee: string | null): AssignableUser[] => {
    if (currentAssignee && !assignableUsers.some((u) => u.id === currentAssignee)) {
      return [...assignableUsers, { id: currentAssignee, label: currentAssignee }];
    }
    return assignableUsers;
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const getChecklistFn = httpsCallable<{ projectId: string; checklistId: string }, ChecklistData>(
        functions,
        "getProjectChecklist"
      );
      const getCompletenessFn = httpsCallable<{ projectId: string; checklistId: string }, { complete: boolean }>(
        functions,
        "getProjectChecklistCompleteness"
      );
      const [checklistResult, completenessResult] = await Promise.all([
        getChecklistFn({ projectId, checklistId }),
        getCompletenessFn({ projectId, checklistId }),
      ]);
      setChecklist(checklistResult.data);
      setComplete(completenessResult.data.complete);
      setDrafts({});
      if (typeof checklistResult.data.title === "string") {
        onTitleResolvedRef.current?.(checklistResult.data.title);
      }
    } catch (err) {
      console.error("[ProjectChecklistPanel] Failed to load checklist", err);
      setError(err instanceof Error ? err.message : "Impossibile caricare la checklist di questo progetto.");
      setChecklist(null);
      setComplete(null);
    } finally {
      setLoading(false);
    }
  }, [projectId, checklistId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load fetches from Cloud Functions, not derivable from props/state
    load();
  }, [load]);

  const getDraft = (item: ChecklistItem): ChecklistItem => ({ ...item, ...drafts[item.id] });

  const setDraftField = (itemId: string, patch: Partial<ChecklistItem>) => {
    setDrafts((prev) => ({ ...prev, [itemId]: { ...prev[itemId], ...patch } }));
  };

  const saveItem = async (item: ChecklistItem) => {
    setSavingItemId(item.id);
    try {
      const fn = httpsCallable(functions, "updateProjectChecklistItem");
      await fn({
        projectId,
        checklistId,
        itemId: item.id,
        title: item.title,
        assignee: item.assignee,
        quantity: item.quantity,
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
          const fn = httpsCallable(functions, "removeProjectChecklistItem");
          await fn({ projectId, checklistId, itemId: item.id });
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
      const fn = httpsCallable(functions, "addProjectChecklistItem");
      await fn({
        projectId,
        checklistId,
        title: newItem.title.trim(),
        type: newItem.type ?? undefined,
        assignee: newItem.assignee.trim() || undefined,
        quantity: newItem.quantity ?? undefined,
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

  return (
    <div>
      <Toast ref={toast} />
      {renderConfirmDialog && <ConfirmDialog />}

      {loading && !checklist && <div style={{ color: "#888" }}>Caricamento checklist...</div>}

      {error && <div style={{ color: "#b91c1c", marginBottom: 12 }}>{error}</div>}

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
            {!readOnly && (
              <Button
                label="Aggiungi item"
                icon="pi pi-plus"
                size="small"
                className="p-button-text"
                onClick={() => setShowAddDialog(true)}
              />
            )}
          </div>

          <DataTable value={checklist.items.map(getDraft)} emptyMessage="Nessun item nella checklist." size="small">
            <Column
              header="Descrizione"
              body={(item: ChecklistItem) => (
                <div>
                  <InputText
                    value={item.title}
                    onChange={(e) => commitField(item, { title: e.target.value }, true)}
                    disabled={readOnly}
                    style={{ width: "100%" }}
                  />
                  {item.type === "numeric" && (
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
                      <span style={{ fontSize: 12, color: "#6b7280" }}>Quantità:</span>
                      <InputNumber
                        value={item.quantity ?? null}
                        onValueChange={(e) => commitField(item, { quantity: e.value ?? null })}
                        disabled={readOnly}
                        min={0}
                        inputStyle={{ width: 70 }}
                      />
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
                  disabled={readOnly}
                  placeholder="Non assegnato"
                  showClear
                  filter
                  emptyMessage="Nessun utente selezionabile"
                  style={{ width: "100%" }}
                />
              )}
              style={{ minWidth: 180 }}
            />
            <Column
              header="Completato"
              body={(item: ChecklistItem) => {
                if (item.type !== "boolean") return null;
                return (
                  <Checkbox
                    checked={item.completed}
                    disabled={readOnly}
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
                if (item.type === "boolean") return null;
                return (
                  <Dropdown
                    value={item.status}
                    options={CHECKLIST_ITEM_STATUSES}
                    onChange={(e) => commitField(item, { status: e.value })}
                    disabled={readOnly}
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
                  disabled={readOnly}
                  rows={1}
                  autoResize
                  style={{ width: "100%" }}
                />
              )}
              style={{ minWidth: 180 }}
            />
            {!readOnly && (
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
            )}
          </DataTable>
        </>
      )}

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
              disabled={!newItem.title.trim() || !newItem.type}
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
              emptyMessage="Nessun utente selezionabile"
              style={{ width: "100%" }}
            />
          </div>
          <div>
            <label style={{ display: "block", marginBottom: 4 }}>Tipo</label>
            <Dropdown
              value={newItem.type}
              options={CHECKLIST_ITEM_TYPE_OPTIONS}
              onChange={(e) =>
                setNewItem((f) => ({ ...f, type: e.value, quantity: e.value === "numeric" ? f.quantity : null }))
              }
              placeholder="Seleziona il tipo"
              style={{ width: "100%" }}
            />
          </div>
          {newItem.type === "numeric" && (
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
    </div>
  );
}
