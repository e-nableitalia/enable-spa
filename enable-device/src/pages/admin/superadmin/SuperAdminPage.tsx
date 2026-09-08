import { useRef, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { functions } from "../../../firebase";
import { Panel } from "primereact/panel";
import { Button } from "primereact/button";
import { ConfirmDialog, confirmDialog } from "primereact/confirmdialog";
import { Toast } from "primereact/toast";

/**
 * Pagina "Super Admin" (EA-171/172) — riservata a chi ha
 * `users/{uid}.superAdmin === true` (nessun controllo lato client: il
 * backend applica comunque l'RBAC, questa pagina resta raggiungibile solo
 * dal menu admin/URL diretto). Ospita azioni che superano il perimetro di
 * un admin qualunque: deploy dei template email versionati e trigger di
 * backup Firestore.
 */
export default function AdminMaintenanceRequests() {
  const toast = useRef<Toast>(null);
  const [deploying, setDeploying] = useState(false);
  const [backingUp, setBackingUp] = useState(false);

  const handleDeployEmailTemplates = () => {
    confirmDialog({
      message:
        "Questa azione scrive il contenuto versionato dei template sulla collection emailTemplates: le prossime email inviate dall'applicazione useranno questo contenuto. Procedere?",
      header: "Conferma deploy template email",
      icon: "pi pi-exclamation-triangle",
      acceptLabel: "Deploy",
      rejectLabel: "Annulla",
      accept: async () => {
        setDeploying(true);
        try {
          const fn = httpsCallable<Record<string, never>, { templateIds: string[] }>(
            functions,
            "deployEmailTemplates"
          );
          const result = await fn({});
          toast.current?.show({
            severity: "success",
            summary: "Template email aggiornati",
            detail: `Id aggiornati: ${result.data.templateIds.join(", ")}`,
            life: 6000,
          });
        } catch (err) {
          toast.current?.show({
            severity: "error",
            summary: "Errore",
            detail: err instanceof Error ? err.message : "Errore durante il deploy dei template email.",
            life: 5000,
          });
        } finally {
          setDeploying(false);
        }
      },
    });
  };

  const handleTriggerBackup = () => {
    confirmDialog({
      message: "Avviare un export completo di Firestore verso il bucket di backup dedicato?",
      header: "Conferma backup Firestore",
      icon: "pi pi-exclamation-triangle",
      acceptLabel: "Avvia backup",
      rejectLabel: "Annulla",
      accept: async () => {
        setBackingUp(true);
        try {
          const fn = httpsCallable<Record<string, never>, { outputUriPrefix: string }>(
            functions,
            "triggerFirestoreBackup"
          );
          const result = await fn({});
          toast.current?.show({
            severity: "success",
            summary: "Backup avviato",
            detail: `Export in corso verso ${result.data.outputUriPrefix}`,
            life: 6000,
          });
        } catch (err) {
          toast.current?.show({
            severity: "error",
            summary: "Errore",
            detail: err instanceof Error ? err.message : "Errore durante l'avvio del backup Firestore.",
            life: 5000,
          });
        } finally {
          setBackingUp(false);
        }
      },
    });
  };

  return (
    <div style={{ padding: 24, maxWidth: 900, margin: "0 auto" }}>
      <Toast ref={toast} />
      <ConfirmDialog />
      <Panel header="Super Admin">
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <Button
              label="Deploy template email"
              icon="pi pi-envelope"
              onClick={handleDeployEmailTemplates}
              loading={deploying}
            />
            <p style={{ color: "#888", fontSize: 13, marginTop: 8 }}>
              Applica il contenuto versionato nel repo alla collection Firestore
              <code> emailTemplates</code> di questo progetto (forward-only: mai il contrario).
            </p>
          </div>
          <div>
            <Button
              label="Backup Firestore"
              icon="pi pi-database"
              className="p-button-outlined"
              onClick={handleTriggerBackup}
              loading={backingUp}
            />
            <p style={{ color: "#888", fontSize: 13, marginTop: 8 }}>
              Avvia un export completo di Firestore verso il bucket di backup dedicato di questo
              progetto (eliminazione automatica degli export dopo 30 giorni).
            </p>
          </div>
        </div>
      </Panel>
    </div>
  );
}
