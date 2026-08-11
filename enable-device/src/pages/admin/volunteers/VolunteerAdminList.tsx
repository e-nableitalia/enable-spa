import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Tag } from "primereact/tag";
import { Button } from "primereact/button";
import type { UserRole } from "../../../shared/types/volunteerData";
import type { VolunteerAdminRow } from "./volunteerAdminHelpers";

interface Props {
  rows: VolunteerAdminRow[];
  loading: boolean;
  roleUpdateLoadingUid: string | null;
  onToggleRole: (uid: string, currentRole: UserRole, name: string) => void;
  onShowDetail: (row: VolunteerAdminRow) => void;
}

function boolTag(value: boolean) {
  return <Tag value={value ? "Sì" : "No"} severity={value ? "success" : "danger"} />;
}

function roleTag(role: UserRole) {
  return <Tag value={role} severity={role === "admin" ? "warning" : "info"} />;
}

function arrayTagPreview(values: string[]) {
  if (values.length === 0) {
    return <span>-</span>;
  }

  const preview = values.slice(0, 2);
  const extra = values.length - preview.length;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
      {preview.map((value) => (
        <Tag key={value} value={value} severity="info" />
      ))}
      {extra > 0 ? <Tag value={`+${extra}`} severity="secondary" /> : null}
    </div>
  );
}

interface RoleActionCellProps {
  row: VolunteerAdminRow;
  roleUpdateLoadingUid: string | null;
  onToggleRole: (uid: string, currentRole: UserRole, name: string) => void;
}

function RoleActionCell({ row, roleUpdateLoadingUid, onToggleRole }: Readonly<RoleActionCellProps>) {
  const isAdmin = row.role === "admin";

  return (
    <Button
      label={isAdmin ? "Downgrade" : "Upgrade"}
      icon={isAdmin ? "pi pi-arrow-down" : "pi pi-arrow-up"}
      className={isAdmin ? "p-button-sm p-button-outlined p-button-warning" : "p-button-sm p-button-outlined p-button-success"}
      onClick={() => onToggleRole(row.uid, row.role, `${row.firstName} ${row.lastName}`.trim() || row.uid)}
      loading={roleUpdateLoadingUid === row.uid}
    />
  );
}

interface DetailCellProps {
  row: VolunteerAdminRow;
  onShowDetail: (row: VolunteerAdminRow) => void;
}

function DetailCell({ row, onShowDetail }: Readonly<DetailCellProps>) {
  return (
    <Button
      icon="pi pi-eye"
      className="p-button-sm p-button-outlined"
      tooltip="Apri dettaglio"
      tooltipOptions={{ position: "top" }}
      onClick={() => onShowDetail(row)}
    />
  );
}

export default function VolunteerAdminList({
  rows,
  loading,
  roleUpdateLoadingUid,
  onToggleRole,
  onShowDetail,
}: Readonly<Props>) {
  const mainInterestBody = (row: VolunteerAdminRow) => arrayTagPreview(row.mainInterest);
  const hasActivePrinterBody = (row: VolunteerAdminRow) => boolTag(row.hasActivePrinter);
  const roleBody = (row: VolunteerAdminRow) => roleTag(row.role);
  const activeBody = (row: VolunteerAdminRow) => boolTag(row.active);
  const detailBody = (row: VolunteerAdminRow) => <DetailCell row={row} onShowDetail={onShowDetail} />;
  const roleActionBody = (row: VolunteerAdminRow) => (
    <RoleActionCell row={row} roleUpdateLoadingUid={roleUpdateLoadingUid} onToggleRole={onToggleRole} />
  );

  return (
    <DataTable
      value={rows}
      paginator
      rows={10}
      rowsPerPageOptions={[10, 25, 50]}
      dataKey="uid"
      loading={loading}
      emptyMessage="Nessun volontario trovato"
      sortField="lastName"
      sortOrder={1}
    >
      <Column header="Dettaglio" body={detailBody} style={{ width: "100px" }} />
      <Column field="firstName" header="Nome" sortable />
      <Column field="lastName" header="Cognome" sortable />
      <Column field="email" header="Email" sortable />
      <Column field="city" header="Città" sortable />
      <Column field="region" header="Regione" sortable />
      <Column field="availability" header="Disponibilità" />
      <Column field="continuityType" header="Continuità" sortable />
      <Column field="desiredInvolvementLevel" header="Coinvolgimento" sortable />
      <Column field="mainInterest" header="Interessi principali" body={mainInterestBody} />
      <Column field="hasActivePrinter" header="Stampanti attive" body={hasActivePrinterBody} sortable />
      <Column field="role" header="Ruolo" body={roleBody} sortable />
      <Column field="active" header="Attivo" body={activeBody} sortable />
      <Column header="Azioni" body={roleActionBody} style={{ width: "150px" }} />
    </DataTable>
  );
}
