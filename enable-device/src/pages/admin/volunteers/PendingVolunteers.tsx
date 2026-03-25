import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Calendar } from "primereact/calendar";
import { Button } from "primereact/button";
import { Toolbar } from "primereact/toolbar";
import { useState, useRef } from "react";
import { Toast } from "primereact/toast";
import { httpsCallable } from "firebase/functions";
import { functions } from "../../../firebase";

export default function PendingVolunteers({ volunteers }: { volunteers: any[] }) {
  const [selectedVolunteers, setSelectedVolunteers] = useState<any[]>([]);
  const toast = useRef<any>(null);

  const tableData = volunteers.map((u) => ({
    ...u,
    createdAt: u.createdAt?.toDate ? u.createdAt.toDate() : null,
    profileUpdatedAt: u.profileUpdatedAt,
    consentPrivacy: u.consents?.privacy?.accepted === true,
    consentCode: u.consents?.codeOfConduct?.accepted === true,
  }));

  const dateTemplate = (row: any, field: string) => {
    const date = row[field];
    return date ? date.toLocaleString() : "-";
  };

  const dateFilterTemplate = (options: any) => (
    <Calendar
      value={options.value}
      onChange={(e) => options.filterCallback(e.value, options.index)}
      dateFormat="dd/mm/yy"
      placeholder="gg/mm/aaaa"
      mask="99/99/9999"
      showIcon
    />
  );

  const handleActivate = async () => {
    const activateVolunteersFn = httpsCallable(functions, "activateVolunteers");
    const ids = selectedVolunteers.map(v => v.id);
    try {
      await activateVolunteersFn({ ids });
      toast.current?.show({
        severity: "success",
        summary: "Volontari attivati",
        detail: "Attivazione completata con successo.",
        life: 3000,
      });
      setSelectedVolunteers([]);
    } catch (err) {
      toast.current?.show({
        severity: "error",
        summary: "Errore",
        detail: "Errore durante l'attivazione dei volontari.",
        life: 4000,
      });
      console.error("Errore attivazione volontari:", err);
    }
  };

  const leftToolbarTemplate = () => (
    <Button
      label="Attiva"
      icon="pi pi-check"
      disabled={selectedVolunteers.length === 0}
      onClick={handleActivate}
    />
  );

  return (
    <div style={{ padding: 20 }}>
      <Toast ref={toast} />
      <h2>Volontari in attesa di attivazione</h2>
      <Toolbar left={leftToolbarTemplate} />
      <DataTable
        value={tableData}
        paginator
        rows={10}
        filterDisplay="row"
        selection={selectedVolunteers}
        onSelectionChange={e => setSelectedVolunteers(e.value)}
        selectionMode="multiple"
        dataKey="id"
      >
        <Column selectionMode="multiple" headerStyle={{ width: '3em' }} />
        <Column field="firstName" header="Nome" filter />
        <Column field="lastName" header="Cognome" filter />
        <Column field="email" header="Email" filter />
        <Column field="city" header="Città" filter />
        <Column field="phone" header="Telefono"/>
        <Column field="telegramUsername" header="Telegram" filter />
        {/* <Column field="role" header="Ruolo" body={roleTemplate} filter /> */}
        {/* <Column field="active" header="Attivo" body={(row) => boolTemplate(row, "active")} filter /> */}
        {/* <Column field="mustSetPassword" header="Da impostare password" body={(row) => boolTemplate(row, "mustSetPassword")} filter /> */}
        {/* <Column field="authProvider" header="Provider" body={providerTemplate} filter /> */}
        <Column header="Creato" body={(row) => dateTemplate(row, "createdAt")} filter field="createdAt" dataType="date" filterElement={dateFilterTemplate} />
        <Column
          field="consentPrivacy"
          header="Privacy"
          body={(row) => row.consentPrivacy
            ? <span className="pi pi-check" style={{ color: "#22c55e", fontSize: 18 }} />
            : <span className="pi pi-times" style={{ color: "#ef4444", fontSize: 18 }} />}
        />
        <Column
          field="consentCode"
          header="Cod. Etico"
          body={(row) => row.consentCode
            ? <span className="pi pi-check" style={{ color: "#22c55e", fontSize: 18 }} />
            : <span className="pi pi-times" style={{ color: "#ef4444", fontSize: 18 }} />}
        />
        {/* Campi profilo */}
        {/* <Column field="availability" header="Disponibilità" filter /> */}
        {/* <Column field="consentPrivacy" header="Privacy" body={(row) => boolTemplate(row, "consentPrivacy")} filter /> */}
        {/* <Column field="continuityType" header="Continuità" filter />
        <Column field="desiredInvolvementLevel" header="Livello coinvolgimento" filter />
        <Column field="mainInterest" header="Interessi" filter /> */}
        {/* <Column header="Profilo aggiornato" body={(row) => dateTemplate(row, "profileUpdatedAt")} filter field="profileUpdatedAt" dataType="date" filterElement={dateFilterTemplate} /> */}
      </DataTable>
    </div>
  );
}
