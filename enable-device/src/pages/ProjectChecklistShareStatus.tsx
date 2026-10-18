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
 * Pagina pubblica (nessuna autenticazione) per un link di condivisione
 * checklist di progetto.
 */
export default function ProjectChecklistShareStatus() {
  const { token } = useParams<{ token: string }>();
  const [percentComplete, setPercentComplete] = useState<number | null>(null);
  const [projectTitle, setProjectTitle] = useState<string | null>(null);
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
          { percentComplete: number; items: ShareChecklistItem[]; projectTitle: string | null }
        >(functions, "getProjectChecklistShareStatus");
        const result = await fn({ token });
        setPercentComplete(result.data.percentComplete);
        setItems(result.data.items ?? []);
        setProjectTitle(result.data.projectTitle ?? null);
      } catch (err) {
        console.error("[ProjectChecklistShareStatus] Failed to load share status", err);
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
      <Card title={`Stato di avanzamento del progetto${projectTitle ? ` - ${projectTitle}` : ""}`}>
        {loading && <div>Caricamento...</div>}
        {!loading && error && <Message severity="error" text={error} />}
        {!loading && !error && percentComplete !== null && (
          <>
            <ProgressBar value={percentComplete} showValue style={{ height: 24 }} />
            <p style={{ marginTop: 16, color: "#4b5563" }}>
              Qui puoi seguire lo stato di avanzamento del progetto: la percentuale e l'elenco qui
              sotto mostrano quali attività il team ha già completato. Per motivi di riservatezza
              non sono mostrati dettagli interni come note o responsabili delle singole attività.
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
