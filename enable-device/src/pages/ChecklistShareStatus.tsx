import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { httpsCallable } from "firebase/functions";
import { Card } from "primereact/card";
import { ProgressBar } from "primereact/progressbar";
import { Message } from "primereact/message";
import { functions } from "../firebase";
import logo from "../assets/logo.png";
import Footer from "../components/layout/Footer";

/**
 * Pagina pubblica (nessuna autenticazione) aperta dal link di
 * condivisione a sola lettura di una checklist di fabbricazione (Story
 * EA-113, livello famiglia/visibilita' esterna). Mostra esclusivamente
 * la percentuale di avanzamento restituita da `getChecklistShareStatus`
 * — nessun nome assegnatario, nota o altro dettaglio interno.
 */
export default function ChecklistShareStatus() {
  const { token } = useParams<{ token: string }>();
  const [percentComplete, setPercentComplete] = useState<number | null>(null);
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
        const fn = httpsCallable<{ token: string }, { percentComplete: number }>(
          functions,
          "getChecklistShareStatus"
        );
        const result = await fn({ token });
        setPercentComplete(result.data.percentComplete);
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
      <Card title="Avanzamento checklist di fabbricazione">
        {loading && <div>Caricamento...</div>}
        {!loading && error && <Message severity="error" text={error} />}
        {!loading && !error && percentComplete !== null && (
          <>
            <ProgressBar value={percentComplete} showValue style={{ height: 24 }} />
            <p style={{ marginTop: 16, color: "#4b5563" }}>
              Questa pagina mostra solo l'avanzamento macro della checklist di fabbricazione, senza
              dettagli interni sugli item o sugli assegnatari.
            </p>
          </>
        )}
      </Card>
      <Footer />
    </div>
  );
}
