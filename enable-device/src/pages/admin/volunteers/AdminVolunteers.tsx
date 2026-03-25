import { Tag } from "primereact/tag";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Button } from "primereact/button";
import { Dialog } from "primereact/dialog";
import { Toast } from "primereact/toast";
import { useRef, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { functions } from "../../../firebase";

export default function AdminVolunteers({ volunteers, onRefresh }: { volunteers: any[]; onRefresh?: () => void }) {
  const toast = useRef<Toast>(null);
  const [confirmTarget, setConfirmTarget] = useState<{ uid: string; name: string; currentRole: string } | null>(null);
  const [loading, setLoading] = useState(false);

  const tableData = volunteers.map((u) => ({
    ...u,
    createdAt: u.createdAt?.toDate ? u.createdAt.toDate() : null,
    profileUpdatedAt: u.profileUpdatedAt,
  }));

  const boolTemplate = (row: any, field: string) => (
    <Tag value={row[field] ? "true" : "false"} severity={row[field] ? "success" : "danger"} />
  );

  const roleTemplate = (row: any) => (
    <Tag value={row.role} severity={row.role === "admin" ? "warning" : "info"} />
  );

  const handleRoleToggle = async () => {
    if (!confirmTarget) return;
    const newRole = confirmTarget.currentRole === "admin" ? "volunteer" : "admin";
    setLoading(true);
    try {
      const fn = httpsCallable(functions, "setUserRole");
      await fn({ targetUid: confirmTarget.uid, newRole });
      toast.current?.show({
        severity: "success",
        summary: "Ruolo aggiornato",
        detail: `${confirmTarget.name}: ${confirmTarget.currentRole} → ${newRole}`,
        life: 3000,
      });
      onRefresh?.();
    } catch (err: any) {
      toast.current?.show({
        severity: "error",
        summary: "Errore",
        detail: err?.message || "Errore durante il cambio ruolo.",
        life: 4000,
      });
    }
    setLoading(false);
    setConfirmTarget(null);
  };

  const roleActionTemplate = (row: any) => {
    const isAdmin = row.role === "admin";
    return (
      <Button
        label={isAdmin ? "Downgrade" : "Upgrade"}
        icon={isAdmin ? "pi pi-arrow-down" : "pi pi-arrow-up"}
        className={isAdmin ? "p-button-sm p-button-outlined p-button-warning" : "p-button-sm p-button-outlined p-button-success"}
        onClick={() =>
          setConfirmTarget({
            uid: row.id,
            name: `${row.firstName ?? ""} ${row.lastName ?? ""}`.trim() || row.id,
            currentRole: row.role,
          })
        }
        tooltip={isAdmin ? "Declassa a volunteer" : "Promuovi ad admin"}
        tooltipOptions={{ position: "top" }}
      />
    );
  };

  const newRole = confirmTarget?.currentRole === "admin" ? "volunteer" : "admin";

  return (
    <div style={{ padding: 20 }}>
      <Toast ref={toast} />
      <Dialog
        header="Conferma cambio ruolo"
        visible={!!confirmTarget}
        style={{ width: "380px" }}
        modal
        onHide={() => setConfirmTarget(null)}
        footer={
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <Button label="Annulla" className="p-button-text" onClick={() => setConfirmTarget(null)} disabled={loading} />
            <Button
              label="Conferma"
              className={newRole === "admin" ? "p-button-warning" : undefined}
              onClick={handleRoleToggle}
              loading={loading}
            />
          </div>
        }
      >
        <p>
          Vuoi cambiare il ruolo di <strong>{confirmTarget?.name}</strong> da{" "}
          <strong>{confirmTarget?.currentRole}</strong> a <strong>{newRole}</strong>?
        </p>
      </Dialog>
      <h2>Utenti</h2>
      <DataTable value={tableData} paginator rows={10} filterDisplay="row">
        <Column field="firstName" header="Nome" filter />
        <Column field="lastName" header="Cognome" filter />
        <Column field="email" header="Email" filter />
        <Column field="city" header="Città" filter />
        <Column field="phone" header="Telefono"/>
        <Column field="role" header="Ruolo" body={roleTemplate} filter />
        <Column field="active" header="Attivo" body={(row) => boolTemplate(row, "active")} filter />
        <Column field="telegramUsername" header="Telegram" filter />
        <Column header="Ruolo" body={roleActionTemplate} style={{ width: "120px" }} />
      </DataTable>
    </div>
  );
}
