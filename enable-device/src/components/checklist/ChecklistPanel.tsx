import { useCallback, useEffect, useRef, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { functions } from "../../firebase";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Button } from "primereact/button";
import { Dialog } from "primereact/dialog";
import { InputText } from "primereact/inputtext";
import { InputNumber } from "primereact/inputnumber";
import { InputTextarea } from "primereact/inputtextarea";
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
  /** Discriminante opzionale: gli item creati prima di EA-123 o aggiunti
   * tramite `addChecklistItem` (che non lo accetta ancora, vedi EA-121)
   * possono non averlo. In assenza di `type`, la colonna Quantità resta
   * nascosta (comportamento "fail closed", coerente con 'boolean'/'generic'). */
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

interface Props {
  /** Id della deviceRequest a cui è collegata la checklist. */
  requestId: string;
  /** Id della checklist collegata alla richiesta, se presente. */
  checklistId?: string | null;
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
 */
export default function ChecklistPanel({ requestId, checklistId }: Props) {
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
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [generatingShareLink, setGeneratingShareLink] = useState(false);

  const load = useCallback(async () => {
    if (!requestId || !checklistId) {
      setChecklist(null);
      setComplete(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const getChecklistFn = httpsCallable<{ requestId: string }, ChecklistData>(
        functions,
        "getDeviceRequestChecklist"
      );
      const getCompletenessFn = httpsCallable<{ requestId: string }, { complete: boolean }>(
        functions,
        "getDeviceRequestChecklistCompleteness"
      );
      const [checklistResult, completenessResult] = await Promise.all([
        getChecklistFn({ requestId }),
        getCompletenessFn({ requestId }),
      ]);
      setChecklist(checklistResult.data);
      setComplete(completenessResult.data.complete);
      setDrafts({});
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

  const isDirty = (itemId: string) => Boolean(drafts[itemId]);

  const saveItem = async (item: ChecklistItem) => {
    const draft = getDraft(item);
    setSavingItemId(item.id);
    try {
      const fn = httpsCallable(functions, "updateDeviceRequestChecklistItem");
      await fn({
        requestId,
        itemId: item.id,
        title: draft.title,
        assignee: draft.assignee,
        quantity: draft.quantity,
        notes: draft.notes,
        status: draft.status,
      });
      toast.current?.show({ severity: "success", summary: "Item aggiornato", life: 2500 });
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
          await fn({ requestId, itemId: item.id });
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

  const generateShareLink = async () => {
    setGeneratingShareLink(true);
    try {
      const fn = httpsCallable<{ requestId: string }, { token: string; url: string }>(
        functions,
        "createChecklistShareLink"
      );
      const result = await fn({ requestId });
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
      <ConfirmDialog />

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
              label="Genera link di condivisione"
              icon="pi pi-share-alt"
              size="small"
              className="p-button-text"
              loading={generatingShareLink}
              onClick={generateShareLink}
            />
          </div>

          <DataTable value={checklist.items} emptyMessage="Nessun item nella checklist." size="small">
            <Column
              header="Titolo"
              body={(item: ChecklistItem) => {
                const draft = getDraft(item);
                return (
                  <InputText
                    value={draft.title}
                    onChange={(e) => setDraftField(item.id, { title: e.target.value })}
                    style={{ width: "100%" }}
                  />
                );
              }}
              style={{ minWidth: 160 }}
            />
            <Column
              header="Assegnatario"
              body={(item: ChecklistItem) => {
                const draft = getDraft(item);
                return (
                  <InputText
                    value={draft.assignee ?? ""}
                    onChange={(e) => setDraftField(item.id, { assignee: e.target.value })}
                    placeholder="Non assegnato"
                    style={{ width: "100%" }}
                  />
                );
              }}
              style={{ minWidth: 140 }}
            />
            <Column
              header="Quantità"
              body={(item: ChecklistItem) => {
                const draft = getDraft(item);
                if (draft.type !== "numeric") {
                  return null;
                }
                return (
                  <InputNumber
                    value={draft.quantity ?? null}
                    onValueChange={(e) => setDraftField(item.id, { quantity: e.value ?? null })}
                    min={0}
                    style={{ width: "100%" }}
                  />
                );
              }}
              style={{ minWidth: 100 }}
            />
            <Column
              header="Note"
              body={(item: ChecklistItem) => {
                const draft = getDraft(item);
                return (
                  <InputTextarea
                    value={draft.notes ?? ""}
                    onChange={(e) => setDraftField(item.id, { notes: e.target.value })}
                    rows={1}
                    autoResize
                    style={{ width: "100%" }}
                  />
                );
              }}
              style={{ minWidth: 180 }}
            />
            <Column
              header="Stato"
              body={(item: ChecklistItem) => {
                const draft = getDraft(item);
                return (
                  <Dropdown
                    value={draft.status}
                    options={CHECKLIST_ITEM_STATUSES}
                    onChange={(e) => setDraftField(item.id, { status: e.value })}
                    style={{ width: "100%" }}
                  />
                );
              }}
              style={{ minWidth: 150 }}
            />
            <Column
              header="Azioni"
              body={(item: ChecklistItem) => (
                <div style={{ display: "flex", gap: 6 }}>
                  <Button
                    icon="pi pi-save"
                    size="small"
                    className="p-button-text"
                    tooltip="Salva"
                    disabled={!isDirty(item.id)}
                    loading={savingItemId === item.id}
                    onClick={() => saveItem(item)}
                  />
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
              disabled={!newItem.title.trim()}
              onClick={addItem}
            />
          </div>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <label style={{ display: "block", marginBottom: 4 }}>Titolo</label>
            <InputText
              value={newItem.title}
              onChange={(e) => setNewItem((f) => ({ ...f, title: e.target.value }))}
              style={{ width: "100%" }}
            />
          </div>
          <div>
            <label style={{ display: "block", marginBottom: 4 }}>Assegnatario</label>
            <InputText
              value={newItem.assignee}
              onChange={(e) => setNewItem((f) => ({ ...f, assignee: e.target.value }))}
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
                  quantity: e.value === "numeric" ? f.quantity : null,
                }))
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
