import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { httpsCallable } from "firebase/functions";
import { doc, getDoc } from "firebase/firestore";
import { db, functions } from "../../firebase";
import { Card } from "primereact/card";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Button } from "primereact/button";
import { MultiSelect } from "primereact/multiselect";
import { Dropdown } from "primereact/dropdown";
import { Checkbox } from "primereact/checkbox";
import { InputTextarea } from "primereact/inputtextarea";
import { InputNumber } from "primereact/inputnumber";
import { Toast } from "primereact/toast";

const CHECKLIST_ITEM_STATUSES = ["Assegnare", "Da iniziare", "In corso", "Completata"];

interface ChecklistItemOrigin {
  type: string;
  id: string;
}

interface MyChecklistItem {
  id: string;
  checklistId: string;
  title: string;
  notes?: string | null;
  status: string;
  type?: "boolean" | "generic" | "numeric";
  quantity?: number | null;
  completed?: boolean | null;
  /** Sempre presente da EA-152bis (risolto per ogni item, non solo i
   * pending): null se la checklist padre non ne ha uno. */
  origin?: ChecklistItemOrigin | null;
}

/**
 * Item "chiuso" se risulta completato per qualunque segnale disponibile:
 * flag `completed` (boolean) oppure `status === "Completata"`. Usare solo
 * il ramo type-aware lasciava in "Solo aperti" i boolean con status già
 * Completata ma `completed` non allineato — letti come chiusi dall'operatore.
 */
function isItemComplete(item: MyChecklistItem): boolean {
  if (item.completed === true) return true;
  return item.status === "Completata";
}

function isEditableOrigin(origin: ChecklistItemOrigin | null | undefined): boolean {
  return origin?.type === "deviceRequest" || origin?.type === "project";
}

/**
 * "To Do List" (EA-154, Epic EA-153): elenco, aggregato tra tutte le
 * checklist esistenti, di tutti gli item assegnati all'utente autenticato
 * — via listMyChecklistItems (EA-142), invocata senza parametro scope
 * (fuori scope dell'intera Epic EA-153).
 *
 * Nata per la gestione "in blocco" di tutti gli item assegnati: oltre alla
 * sola consultazione, permette di aggiornare Stato/Completato/Note/Quantità
 * direttamente da qui (stesso pattern autosave — nessun pulsante Salva — di
 * ChecklistPanel.tsx), con un toggle "Solo aperti/Tutti" (default: solo
 * aperti) e un filtro per stato. L'assegnatario non è mostrato: è per
 * costruzione sempre l'utente corrente.
 *
 * L'aggiornamento riusa il layer RBAC dell'entità di provenienza:
 * `updateDeviceRequestChecklistItem` per origin deviceRequest,
 * `updateProjectChecklistItem` per origin project. Se l'origin manca
 * (checklist orfana non collegata), i controlli restano disabilitati.
 *
 * Durante il salvataggio i controlli restano abilitati (come in
 * ChecklistPanel): si mostra solo uno spinner. Disabilitarli per tutta la
 * chiamata faceva sembrare "bloccati" soprattutto il flag boolean e gli
 * item aperti appena toccati.
 */
export default function MyChecklistItems({
  originBasePath = "/volunteer/my-requests",
  projectBasePath,
}: {
  originBasePath?: string;
  /** Se assente, gli item di progetto mostrano la label senza link. */
  projectBasePath?: string;
}) {
  const navigate = useNavigate();
  const toast = useRef<Toast>(null);
  const [items, setItems] = useState<MyChecklistItem[]>([]);
  const [requestLabels, setRequestLabels] = useState<Record<string, string>>({});
  const [projectLabels, setProjectLabels] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // true = nascondi i completati (default "Solo aperti").
  const [showOnlyOpen, setShowOnlyOpen] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [savingItemId, setSavingItemId] = useState<string | null>(null);
  const showOnlyOpenRef = useRef(showOnlyOpen);
  showOnlyOpenRef.current = showOnlyOpen;

  // Debounce per-item dell'autosave sul campo testo (Note): stesso pattern
  // di ChecklistPanel.tsx, salvataggio immediato per gli altri campi
  // (eventi discreti: Dropdown/Checkbox/InputNumber).
  const autosaveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  useEffect(() => {
    const timers = autosaveTimers.current;
    return () => {
      Object.values(timers).forEach(clearTimeout);
    };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const listMyChecklistItemsFn = httpsCallable<Record<string, never>, { items: MyChecklistItem[] }>(
        functions,
        "listMyChecklistItems"
      );
      const result = await listMyChecklistItemsFn({});
      const fetchedItems = result.data.items;

      const deviceRequestIds = Array.from(
        new Set(
          fetchedItems
            .filter((item) => item.origin?.type === "deviceRequest")
            .map((item) => item.origin!.id)
        )
      );
      const projectIds = Array.from(
        new Set(
          fetchedItems.filter((item) => item.origin?.type === "project").map((item) => item.origin!.id)
        )
      );
      const [requestLabelEntries, projectLabelEntries] = await Promise.all([
        Promise.all(
          deviceRequestIds.map(async (id) => {
            try {
              const snap = await getDoc(doc(db, "deviceRequests", id));
              const requestNumber = snap.exists()
                ? (snap.data()?.requestNumber as string | undefined)
                : undefined;
              return [id, requestNumber || id] as const;
            } catch {
              return [id, id] as const;
            }
          })
        ),
        Promise.all(
          projectIds.map(async (id) => {
            try {
              const snap = await getDoc(doc(db, "projects", id));
              const title = snap.exists() ? (snap.data()?.title as string | undefined) : undefined;
              return [id, title || id] as const;
            } catch {
              return [id, id] as const;
            }
          })
        ),
      ]);

      setRequestLabels(Object.fromEntries(requestLabelEntries));
      setProjectLabels(Object.fromEntries(projectLabelEntries));
      setItems(fetchedItems);
    } catch (err) {
      console.error("[MyChecklistItems] Failed to load checklist items", err);
      setError(
        err instanceof Error
          ? err.message
          : "Impossibile caricare l'elenco dei tuoi item di checklist."
      );
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load fetches from a Cloud Function, not derivable from props/state
    load();
  }, [load]);

  const originLabel = (item: MyChecklistItem): string | null => {
    if (!item.origin) return null;
    if (item.origin.type === "deviceRequest") {
      return `Richiesta ${requestLabels[item.origin.id] ?? item.origin.id}`;
    }
    if (item.origin.type === "project") {
      return `Progetto ${projectLabels[item.origin.id] ?? item.origin.id}`;
    }
    return null;
  };

  const originColumnBody = (item: MyChecklistItem) => {
    const label = originLabel(item);
    if (!item.origin || !label) {
      return <span style={{ color: "#6b7280" }}>Senza provenienza</span>;
    }
    if (item.origin.type === "deviceRequest") {
      return (
        <Button
          label={label}
          className="p-button-text p-button-sm"
          onClick={() => navigate(`${originBasePath}/${item.origin!.id}`)}
        />
      );
    }
    if (item.origin.type === "project" && projectBasePath) {
      return (
        <Button
          label={label}
          className="p-button-text p-button-sm"
          onClick={() => navigate(`${projectBasePath}/${item.origin!.id}`)}
        />
      );
    }
    return label;
  };

  /**
   * Aggiorna un campo e lo mappa immediatamente sul backend: aggiornamento
   * ottimistico dello stato locale (nessun reload completo dell'elenco dopo
   * ogni singolo click, a differenza di ChecklistPanel — qui l'uso previsto
   * è modificare molti item in sequenza rapida), con rollback locale se il
   * salvataggio fallisce.
   *
   * Con filtro "Solo aperti", un item che diventa completo scompare dalla
   * vista: in quel caso un toast conferma che il salvataggio è andato a
   * buon fine (altrimenti sembra che l'edit non abbia funzionato).
   */
  const updateItem = async (
    item: MyChecklistItem,
    patch: Partial<Pick<MyChecklistItem, "status" | "completed" | "notes" | "quantity">>
  ) => {
    if (!isEditableOrigin(item.origin)) return;
    const origin = item.origin!;
    const previous = item;
    const optimistic = { ...item, ...patch };
    const willHideFromOpenFilter =
      showOnlyOpenRef.current && !isItemComplete(item) && isItemComplete(optimistic);
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, ...patch } : i)));
    setSavingItemId(item.id);
    try {
      if (origin.type === "deviceRequest") {
        const fn = httpsCallable(functions, "updateDeviceRequestChecklistItem");
        await fn({ requestId: origin.id, checklistId: item.checklistId, itemId: item.id, ...patch });
      } else {
        const fn = httpsCallable(functions, "updateProjectChecklistItem");
        await fn({ projectId: origin.id, checklistId: item.checklistId, itemId: item.id, ...patch });
      }
      if (willHideFromOpenFilter) {
        toast.current?.show({
          severity: "success",
          summary: "Completato",
          detail: `"${item.title}" segnato come completato. Passa a "Tutti" per rivederlo.`,
          life: 3500,
        });
      }
    } catch (err) {
      setItems((prev) => prev.map((i) => (i.id === item.id ? previous : i)));
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
   * Wrapper di `updateItem` con debounce opzionale (600ms), per il campo
   * testo Note: un salvataggio ad ogni singolo tasto digitato sarebbe
   * troppo frequente. Gli altri campi (Stato/Completato/Quantità) restano
   * su `updateItem` diretto, eventi discreti già salvati immediatamente.
   */
  const commitField = (
    item: MyChecklistItem,
    patch: Partial<Pick<MyChecklistItem, "status" | "completed" | "notes" | "quantity">>,
    debounce = false
  ) => {
    const pendingTimer = autosaveTimers.current[item.id];
    if (pendingTimer) {
      clearTimeout(pendingTimer);
      delete autosaveTimers.current[item.id];
    }
    if (!debounce) {
      updateItem(item, patch);
      return;
    }
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, ...patch } : i)));
    const merged = { ...item, ...patch };
    autosaveTimers.current[item.id] = setTimeout(() => {
      delete autosaveTimers.current[item.id];
      updateItem(merged, patch);
    }, 600);
  };

  const visibleItems = useMemo(() => {
    return items.filter((item) => {
      const matchesStatus = statusFilter.length === 0 || statusFilter.includes(item.status);
      if (!matchesStatus) return false;
      // Solo aperti: escludi i completati. Tutti: nessun filtro di completezza.
      if (showOnlyOpen && isItemComplete(item)) return false;
      return true;
    });
  }, [items, showOnlyOpen, statusFilter]);

  const openCount = useMemo(() => items.filter((item) => !isItemComplete(item)).length, [items]);
  const totalCount = items.length;

  const statusColumnBody = (item: MyChecklistItem) => {
    const editable = isEditableOrigin(item.origin);
    const saving = savingItemId === item.id;
    if (item.type === "boolean") {
      // Coerente con ChecklistPanel.tsx: per un item boolean lo stato non
      // ha alcun ruolo nel gate di completezza ed è sincronizzato in
      // automatico dal checkbox Completato; non mostrare il Dropdown.
      return (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Checkbox
            inputId={`todo-completed-${item.id}`}
            checked={item.completed === true}
            disabled={!editable}
            onChange={(e) => {
              const completed = Boolean(e.checked);
              updateItem(item, { completed, status: completed ? "Completata" : "Assegnare" });
            }}
          />
          <label htmlFor={`todo-completed-${item.id}`} style={{ fontSize: 13, cursor: editable ? "pointer" : "default" }}>
            Completato
          </label>
          {saving && <i className="pi pi-spin pi-spinner" title="Salvataggio in corso..." style={{ fontSize: 14 }} />}
        </div>
      );
    }
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Dropdown
          value={item.status}
          options={CHECKLIST_ITEM_STATUSES}
          disabled={!editable}
          onChange={(e) => updateItem(item, { status: e.value })}
          style={{ width: "100%" }}
        />
        {saving && <i className="pi pi-spin pi-spinner" title="Salvataggio in corso..." style={{ fontSize: 14 }} />}
      </div>
    );
  };

  /**
   * Niente colonna Quantità dedicata (svuota per il 99% degli item, non
   * numeric — bug segnalato dall'operatore, proposta scelta: inline sotto
   * la Descrizione, visibile e gestibile solo dove serve davvero).
   */
  const descriptionColumnBody = (item: MyChecklistItem) => {
    if (item.type !== "numeric") return item.title;
    const editable = isEditableOrigin(item.origin);
    return (
      <div>
        <div>{item.title}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
          <span style={{ fontSize: 12, color: "#6b7280" }}>Quantità:</span>
          <InputNumber
            value={item.quantity ?? null}
            disabled={!editable}
            onValueChange={(e) => updateItem(item, { quantity: e.value ?? null })}
            min={0}
            inputStyle={{ width: 70 }}
          />
        </div>
      </div>
    );
  };

  const notesColumnBody = (item: MyChecklistItem) => {
    const editable = isEditableOrigin(item.origin);
    return (
      <InputTextarea
        value={item.notes ?? ""}
        disabled={!editable}
        onChange={(e) => commitField(item, { notes: e.target.value }, true)}
        rows={1}
        autoResize
        style={{ width: "100%" }}
      />
    );
  };

  return (
    <div style={{ width: "100%", padding: 32 }}>
      <Toast ref={toast} />
      <Card title="To Do List">
        {error && <div style={{ color: "#b91c1c", marginBottom: 12 }}>{error}</div>}
        {!error && !loading && items.length === 0 && (
          <div>Non hai al momento nessun item di checklist assegnato.</div>
        )}
        {!error && (loading || items.length > 0) && (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap", marginBottom: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <Button
                  type="button"
                  label="Solo aperti"
                  size="small"
                  outlined={!showOnlyOpen}
                  onClick={() => setShowOnlyOpen(true)}
                />
                <Button
                  type="button"
                  label="Tutti"
                  size="small"
                  outlined={showOnlyOpen}
                  onClick={() => setShowOnlyOpen(false)}
                />
                <span style={{ fontSize: 13, color: "#6b7280" }}>
                  {showOnlyOpen
                    ? `Attività aperte: ${openCount}`
                    : `Tutte le attività: ${totalCount} (${openCount} aperte)`}
                </span>
              </div>
              <MultiSelect
                value={statusFilter}
                options={CHECKLIST_ITEM_STATUSES}
                onChange={(e) => setStatusFilter(e.value)}
                placeholder="Filtra per stato"
                display="chip"
                style={{ minWidth: 220 }}
              />
            </div>
            <DataTable
              value={visibleItems}
              dataKey="id"
              loading={loading}
              size="small"
              emptyMessage="Nessun item corrispondente ai filtri."
            >
              <Column header="Descrizione" body={descriptionColumnBody} />
              <Column header="Stato" body={statusColumnBody} style={{ minWidth: 180 }} />
              <Column header="Note" body={notesColumnBody} style={{ minWidth: 180 }} />
              <Column header="Provenienza" body={originColumnBody} />
            </DataTable>
          </>
        )}
      </Card>
    </div>
  );
}
