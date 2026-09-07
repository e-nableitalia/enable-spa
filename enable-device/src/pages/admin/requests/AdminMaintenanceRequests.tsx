import { Panel } from "primereact/panel";

/**
 * Pagina admin di manutenzione — svuotata (operatore, 2026-09-07): le
 * migrazioni one-shot già completate (assignedVolunteers, EA-152), l'import
 * CSV e la cancellazione bulk sono stati rimossi, non più necessari.
 *
 * Diventerà la pagina "Super Admin" (deploy dei template email versionati,
 * trigger di backup Firestore), ancora da implementare.
 */
export default function AdminMaintenanceRequests() {
  return (
    <div style={{ padding: 24, maxWidth: 900, margin: "0 auto" }}>
      <Panel header="Super Admin">
        <p style={{ color: "#888" }}>Nessuna funzione disponibile al momento.</p>
      </Panel>
    </div>
  );
}
