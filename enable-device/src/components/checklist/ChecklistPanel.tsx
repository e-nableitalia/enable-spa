import { useCallback, useEffect, useRef, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { doc, getDoc } from "firebase/firestore";
import { auth, db, functions } from "../../firebase";
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

interface AssignableUser {
  id: string;
  label: string;
}

/**
 * Nome completo dell'utente `uid`, risolto da `users/{uid}/private/profile`
 * (stesso pattern di `RequestDetail.getUserFullName`). Non tutti i chiamanti
 * possono leggere il profilo privato di un altro utente (regole Firestore:
 * un volontario legge solo il proprio, EA-141) — in quel caso, o se il
 * profilo non esiste, l'etichetta ricade sull'uid stesso.
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
  const [newItem, setNewItem] = useState<NewItemForm>(EMPTY_NEW_ITEM);
  const [addingItem, setAddingItem] = useState(false);
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
   * Utenti reali selezionabili come assegnatario di un item (EA-141):
   * i volontari assegnati alla deviceRequest (`assignedVolunteers`, leggibile
   * da qualunque volontario o admin autenticato, vedi `firestore.rules`) più
   * l'utente corrente se admin — stesso perimetro RBAC validato lato backend
   * da `isResolvableChecklistAssignee`. Sostituisce il precedente campo di
   * testo libero, mai risolto a un'identità reale.
   */
  const loadAssignableUsers = useCallback(async () => {
    if (!requestId) {
      setAssignableUsers([]);
      return;
    }
    try {
      const requestSnap = await getDoc(doc(db, "deviceRequests", requestId));
      const assignedVolunteers: string[] = requestSnap.exists()
        ? ((requestSnap.data()?.assignedVolunteers as string[] | undefined) ?? [])
        : [];

      const candidateUids = new Set(assignedVolunteers);
      const selfUid = auth.currentUser?.uid;
      if (selfUid) {
        const selfSnap = await getDoc(doc(db, "users", selfUid));
        if (selfSnap.exists() && selfSnap.data()?.role === "admin") {
          candidateUids.add(selfUid);
        }
      }

      const users = await Promise.all(
        Array.from(candidateUids).map(async (uid) => ({ id: uid, label: await resolveAssignableUserLabel(uid) }))
      );
      setAssignableUsers(users);
    } catch (err) {
      console.error("[ChecklistPanel] Failed to load assignable users", err);
      setAssignableUsers([]);
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
                  {item.type === "numeric" && (
                    // Niente colonna Quantità dedicata (vuota per gli item
                    // non numeric, bug segnalato dall'operatore — stesso
                    // pattern già applicato a MyChecklistItems.tsx): inline
                    // sotto la Descrizione, solo dove serve davvero.
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
                      <span style={{ fontSize: 12, color: "#6b7280" }}>Quantità:</span>
                      <InputNumber
                        value={item.quantity ?? null}
                        onValueChange={(e) => commitField(item, { quantity: e.value ?? null })}
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
