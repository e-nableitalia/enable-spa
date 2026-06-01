import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Tag } from "primereact/tag";
import type { VolunteerPrinter } from "../../../shared/types/volunteerData";
import { printerVolumeText } from "./volunteerAdminHelpers";

interface Props {
  printers: VolunteerPrinter[];
}

function boolTag(value: boolean) {
  return <Tag value={value ? "Sì" : "No"} severity={value ? "success" : "danger"} />;
}

export default function VolunteerPrinterSummary({ printers }: Props) {
  return (
    <DataTable value={printers} size="small" emptyMessage="Nessuna stampante disponibile" dataKey="id">
      <Column field="brand" header="Brand" />
      <Column field="model" header="Modello" />
      <Column header="Volume" body={(row: VolunteerPrinter) => printerVolumeText(row)} />
      <Column header="Multi-materiale" body={(row: VolunteerPrinter) => boolTag(row.multiMaterial)} />
      <Column header="Flessibile" body={(row: VolunteerPrinter) => boolTag(row.flexibleSupported)} />
      <Column header="Direct drive" body={(row: VolunteerPrinter) => boolTag(row.directDrive)} />
      <Column header="Attiva" body={(row: VolunteerPrinter) => boolTag(row.active)} />
      <Column field="notes" header="Note" body={(row: VolunteerPrinter) => row.notes || "-"} />
    </DataTable>
  );
}
