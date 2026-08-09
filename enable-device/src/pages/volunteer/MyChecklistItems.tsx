import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { httpsCallable } from "firebase/functions";
import { doc, getDoc } from "firebase/firestore";
import { db, functions } from "../../firebase";
import { Card } from "primereact/card";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Tag } from "primereact/tag";
import { Button } from "primereact/button";

interface ChecklistItemOrigin {
  type: string;
  id: string;
}

interface MyChecklistItem {
  id: string;
  checklistId: string;
  title: string;
  status: string;
  /** Presente solo per gli item non completati (listMyChecklistItems.ts,
   * righe 78-93): assente (non `null`) per gli item completati. */
  origin?: ChecklistItemOrigin | null;
}

/**
 * "I miei item" (EA-154, Epic EA-153): elenco piatto, senza raggruppamento
 * né ordinamento per checklist/richiesta di provenienza, di tutti gli item
 * di checklist assegnati al volontario autenticato, aggregati tra tutte le
 * checklist esistenti — via listMyChecklistItems (EA-142), invocata senza
 * parametro scope (fuori scope dell'intera Epic EA-153).
 *
 * Per gli item non completati con provenienza da una deviceRequest, mostra
 * un riferimento leggibile (requestNumber) risolto con una lettura diretta
 * di `deviceRequests/{id}` (leggibile da qualunque volontario autenticato,
 * firestore.rules riga 39), non incluso nella risposta del backend.
 *
 * Il riferimento di provenienza e' cliccabile (EA-155) solo quando origin.type
 * === 'deviceRequest': naviga a `${originBasePath}/:id`. Nessuna azione per
 * origin null (item non collegato a una deviceRequest) o assente (item
 * completato).
 *
 * Riusata identica sia da VolunteerLayout (default, dettaglio richiesta su
 * /volunteer/my-requests/:id) sia da AdminLayout (dettaglio richiesta su
 * /admin/request/:id, passato esplicitamente via originBasePath): la
 * funzione di aggregazione backend (listMyChecklistItems) e' self-only e
 * generica per qualunque utente autenticato, non specifica del volontario.
 */
export default function MyChecklistItems({
  originBasePath = "/volunteer/my-requests",
}: {
  originBasePath?: string;
}) {
  const navigate = useNavigate();
  const [items, setItems] = useState<MyChecklistItem[]>([]);
  const [requestLabels, setRequestLabels] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
      const labelEntries = await Promise.all(
        deviceRequestIds.map(async (id) => {
          try {
            const snap = await getDoc(doc(db, "deviceRequests", id));
            const requestNumber = snap.exists() ? (snap.data()?.requestNumber as string | undefined) : undefined;
            return [id, requestNumber || id] as const;
          } catch {
            return [id, id] as const;
          }
        })
      );

      setRequestLabels(Object.fromEntries(labelEntries));
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
    if (!item.origin || item.origin.type !== "deviceRequest") return null;
    return `Richiesta ${requestLabels[item.origin.id] ?? item.origin.id}`;
  };

  const originColumnBody = (item: MyChecklistItem) => {
    const label = originLabel(item);
    if (!label || !item.origin) return "-";
    return (
      <Button
        label={label}
        className="p-button-text p-button-sm"
        onClick={() => navigate(`${originBasePath}/${item.origin!.id}`)}
      />
    );
  };

  return (
    <div style={{ width: "100%", padding: 32 }}>
      <Card title="I miei item">
        {error && <div style={{ color: "#b91c1c", marginBottom: 12 }}>{error}</div>}
        {!error && !loading && items.length === 0 && (
          <div>Non hai al momento nessun item di checklist assegnato.</div>
        )}
        {!error && (loading || items.length > 0) && (
          <DataTable value={items} loading={loading} size="small">
            <Column field="title" header="Titolo" />
            <Column header="Stato" body={(item: MyChecklistItem) => <Tag value={item.status} />} />
            <Column header="Provenienza" body={originColumnBody} />
          </DataTable>
        )}
      </Card>
    </div>
  );
}
