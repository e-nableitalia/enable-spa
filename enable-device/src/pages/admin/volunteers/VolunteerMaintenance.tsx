import { useState, useRef } from "react";
import { Panel } from "primereact/panel";
import { Button } from "primereact/button";
import { Toast } from "primereact/toast";
import Papa from "papaparse";
import { TabView, TabPanel } from "primereact/tabview";
import { db } from "../../../firebase";
import { collection, addDoc } from "firebase/firestore";
 
const VOLUNTEER_FIELDS = [
  "data_ricezione",
  "nome",
  "cognome",
  "stato", // campo stato nel csv
  "email",
  "telefono",
  "interesse",
  "descrizione"
];


export default function VolunteerMaintenance() {
  const [volunteers, setVolunteers] = useState<any[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const toast = useRef<any>(null);
 const [importing, setImporting] = useState(false);
  // Mappa i campi italiani in inglese
  const mapFieldsToEnglish = (row: any) => ({
    receivedAt: row["data_ricezione"] || "",
    firstName: row["nome"] || "",
    lastName: row["cognome"] || "",
    status: row["Stato"] || "",
    email: row["email"] || "",
    phone: row["telefono"] || "",
    interest: row["interesse"] || "",
    description: (row["descrizione\r"] || "").replace(/\r$/, ""),
  });

  // Importa tutti i volontari in Firestore
  const handleImportToFirestore = async () => {
    setImporting(true);
    let ok = 0, err = 0;
    for (let i = 0; i < volunteers.length; i++) {
      const row = volunteers[i];
      try {
        const data = mapFieldsToEnglish(row);
        await addDoc(collection(db, "contacts"), data);
        ok++;
      } catch (e: any) {
        err++;
      }
    }
    setImporting(false);
    toast.current?.show({
      severity: err === 0 ? "success" : "warn",
      summary: "Import completato",
      detail: `Successi: ${ok}, Errori: ${err}`,
      life: 4000,
    });
  };  

  // CSV file input handler unico
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      delimiter: ";",
      complete: (results: Papa.ParseResult<Record<string, string>>) => {
        // Deduplica su email+telefono
        const seen = new Set();
        const deduped = results.data.filter((row) => {
          const key = `${row.email?.toLowerCase() || ""}|${row.telefono || ""}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        setVolunteers(deduped);
        setLogs([`Totale volontari unici: ${deduped.length}`]);
      },
      error: (err: Error) => {
        toast.current?.show({
          severity: "error",
          summary: "Errore parsing CSV",
          detail: err.message,
          life: 4000,
        });
      },
      newline: "\n",
      quoteChar: '"',
    });
  };

  return (
    <div style={{ padding: 24, maxWidth: 900, margin: "0 auto" }}>
      <Toast ref={toast} />
      <Panel header="Manutenzione Volontari - Import CSV" style={{ marginBottom: 24 }}>
        <div style={{ marginBottom: 16, display: "flex", gap: 16, alignItems: "center" }}>
          <span className="p-buttonset">
            <Button
              label={fileName ? fileName : "CSV Volontari"}
              icon="pi pi-file"
              onClick={() => document.getElementById("csv-upload-volunteers")?.click()}
              className="p-button-outlined"
              disabled={importing}
            />
            <input
              id="csv-upload-volunteers"
              type="file"
              accept=".csv"
              onChange={handleFileChange}
              style={{ display: "none" }}
            />
          </span>
          <Button
            label={importing ? "Importing..." : "Import to Firestore"}
            icon="pi pi-cloud-upload"
            onClick={handleImportToFirestore}
            disabled={importing || !volunteers.length}
            className="p-button-success"
          />
        </div>
        <div style={{ marginBottom: 12 }}>
          <strong>Totale volontari:</strong> {volunteers.length}
        </div>
        <Panel header="Risultati" style={{ overflowY: "auto" }}>
          <TabView>
            <TabPanel header="Log">
              <Panel header="" style={{ boxShadow: "none", marginBottom: 0 }}>
                <pre style={{ fontSize: 13, whiteSpace: "pre-wrap" }}>
                  {logs.map((log, idx) => (
                    <div key={idx}>{log}</div>
                  ))}
                </pre>
              </Panel>
            </TabPanel>
            <TabPanel header="Volontari">
              <Panel header="" style={{ boxShadow: "none", marginBottom: 0 }}>
                <pre style={{ fontSize: 13, whiteSpace: "pre-wrap" }}>
                  {volunteers.map((row, idx) => (
                    <div key={idx}>{JSON.stringify(row, null, 2)}</div>
                  ))}
                </pre>
              </Panel>
            </TabPanel>
          </TabView>
        </Panel>
      </Panel>
    </div>
  );
}
