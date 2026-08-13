import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { httpsCallable } from "firebase/functions";
import { Card } from "primereact/card";
import { ProgressBar } from "primereact/progressbar";
import { Message } from "primereact/message";
import { functions } from "../firebase";
import logo from "../assets/logo.png";
import Footer from "../components/layout/Footer";

interface ShareChecklistItem {
  title: string;
  completed: boolean;
}

/**
 * Pagina pubblica (nessuna autenticazione) aperta dal link di
 * condivisione a sola lettura di una checklist di fabbricazione (Story
 * EA-113, livello famiglia/visibilita' esterna). Mostra la percentuale di
 * avanzamento e l'elenco degli item restituiti da `getChecklistShareStatus`
 * — solo titolo e un flag di completamento omogeneo per ogni item, senza
 * distinzione tra i type (`boolean`/`numeric`/`generic`): nessun nome
 * assegnatario, nota, quantita' o altro dettaglio interno.
 *
 * Titolo generico "Stato di avanzamento della richiesta" (richiesto
 * dall'operatore: rimosso il riferimento a "checklist di fabbricazione",
 * troppo specifico/tecnico per una famiglia), con `requestNumber` se
 * risolvibile dal backend.
 */
export default function ChecklistShareStatus() {
  const { token } = useParams<{ token: string }>();
  const [percentComplete, setPercentComplete] = useState<number | null>(null);
  const [requestNumber, setRequestNumber] = useState<string | null>(null);
  const [items, setItems] = useState<ShareChecklistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      if (!token) {
        setError("Link non valido.");
        setLoading(false);
        return;
      }
      try {
        const fn = httpsCallable<
          { token: string },
          { percentComplete: number; items: ShareChecklistItem[]; requestNumber: string | null }
        >(functions, "getChecklistShareStatus");
        const result = await fn({ token });
        setPercentComplete(result.data.percentComplete);
        setItems(result.data.items ?? []);
        setRequestNumber(result.data.requestNumber ?? null);
      } catch (err) {
        console.error("[ChecklistShareStatus] Failed to load share status", err);
        setError(
          err instanceof Error
            ? err.message
            : "Impossibile caricare l'avanzamento della checklist per questo link."
        );
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [token]);

  return (
    <div style={{ padding: 24, maxWidth: 560, margin: "auto" }}>
      <div style={{ textAlign: "center", marginBottom: 24 }}>
        <img src={logo} alt="e-Nable Italia" style={{ height: 56 }} />
      </div>
      <Card
        title={`Stato di avanzamento della richiesta${requestNumber ? ` - ${requestNumber}` : ""}`}
      >
        {loading && <div>Caricamento...</div>}
        {!loading && error && <Message severity="error" text={error} />}
        {!loading && !error && percentComplete !== null && (
          <>
            <ProgressBar value={percentComplete} showValue style={{ height: 24 }} />
            <p style={{ marginTop: 16, color: "#4b5563" }}>
              Qui puoi seguire lo stato di avanzamento della richiesta: la percentuale e l'elenco
              qui sotto mostrano quali attività il team di volontari ha già completato. Per motivi
              di riservatezza non sono mostrati dettagli interni come note o responsabili delle
              singole attività — solo l'avanzamento complessivo, sempre aggiornato.
            </p>
            {items.length > 0 && (
              <ul style={{ listStyle: "none", margin: "16px 0 0", padding: 0 }}>
                {items.map((item, index) => (
                  <li
                    key={index}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "8px 0",
                      borderBottom: index < items.length - 1 ? "1px solid #e5e7eb" : "none",
                    }}
                  >
                    <i
                      className={item.completed ? "pi pi-check-circle" : "pi pi-circle"}
                      style={{ color: item.completed ? "#22c55e" : "#9ca3af", fontSize: 18 }}
                    />
                    <span style={{ color: item.completed ? "#374151" : "#6b7280" }}>{item.title}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </Card>
      <Footer />
    </div>
  );
}
