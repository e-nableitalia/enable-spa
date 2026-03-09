import { useState, useRef } from "react";
import { Panel } from "primereact/panel";
import { Button } from "primereact/button";
import { ProgressBar } from "primereact/progressbar";
import { Toast } from "primereact/toast";
import Papa from "papaparse";
import { db, functions } from "../../../firebase";
import { collection, addDoc, doc, setDoc, getDocs, deleteDoc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { Timestamp } from "firebase/firestore";
import { Dialog } from "primereact/dialog";
import { InputText } from "primereact/inputtext";
import { ToggleButton } from "primereact/togglebutton";
import { mapInternalStatusToPublic } from "../../../helpers/requestStatus";

export default function AdminMaintenanceRequests() {
  const [csvRows, setCsvRows] = useState<any[]>([]);
  const [parsedData, setParsedData] = useState<any[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const [dryRunMode, setDryRunMode] = useState(false);
  const [progress, setProgress] = useState(0);
  const [successCount, setSuccessCount] = useState(0);
  const [errorCount, setErrorCount] = useState(0);
  const [fileName, setFileName] = useState<string | null>(null);
  const [showDeleteAllDialog, setShowDeleteAllDialog] = useState(false);
  const [deleteAllText, setDeleteAllText] = useState("");
  const [deleteAllLoading, setDeleteAllLoading] = useState(false);
  const [legacyMode, setLegacyMode] = useState(false);
  const toast = useRef<any>(null);

  // CSV file input handler
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      delimiter: ";",
      complete: (results: Papa.ParseResult<Record<string, string>>) => {
        setCsvRows(results.data);
        setLogs([]);
        setParsedData([]);
        setProgress(0);
        setSuccessCount(0);
        setErrorCount(0);
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

  // Transform a CSV row to Firestore objects
  const transformRow = (row: any) => {
    // Parse createdAt
    let createdAt: Timestamp;
    try {
      createdAt = Timestamp.fromDate(new Date(row["Informazioni cronologiche"]));
    } catch {
      createdAt = Timestamp.now();
    }
    // Split name
    const firstName = (row["Nome"] || "").trim();
    const lastName = (row["Cognome"] || "").trim();
    // Therapy boolean
    const therapy = !!(row["Terapia occupazionale"] && row["Terapia occupazionale"].trim());
    // Private data
    const privateData = {
      email: row["Indirizzo email"] || "",
      firstName: firstName || "",
      lastName: lastName || "",
      relation: row["Relazione con il destinatario"] || "",
      province: row["Provincia"] || "",
      therapy,
      amputationType: row["Tipo di amputazione"] || "",
      description: row["Descrizione"] || "",
      preferences: row["Preferenze / Note"] || "",
      consentPrivacy: true,
    };
    // Main doc
    const mainDoc = {
      createdAt,
      updatedAt: createdAt,
      createdBy: "import",
      age: row["Anni"] || "",
      gender: row["Sesso del destinatario"] || "",
      assignedVolunteer: null,
      status: "imported", // initial status, will be changed by function
    };
    // Status change
    const statusChange = {
      newStatus: row["Stato"] || "",
      note: row["Activity"] || "Import iniziale",
    };
    // Volunteer
    const volunteerName = (row["Volontario"] || "").trim();
    // Public Request
    const publicData = {
      province: row["Provincia"] || "",
      publicStatus: mapInternalStatusToPublic(statusChange.newStatus),
      createdAt,
      devicetype: "unknown", // potremmo mappare da preferenze o descrizione in futuro
    };
    return { mainDoc, privateData, statusChange, volunteerName, publicData };
  };

  const transformRowLegacy = (row: any) => {
    // --- createdAt ---
    const createdAt = Timestamp.now();
    
    // --- Split Genitore (Richiedente) ---
    const fullName = (row["Richiedente"] || "").trim();
    const nameParts = fullName.split(" ").filter(Boolean);
    const firstName = nameParts.length > 0 ? nameParts[0] : "";
    const lastName = nameParts.length > 1 ? nameParts.slice(1).join(" ") : "";

    // --- Recipient (bambino) ---
    const recipient = (row["Destinatario"] || "").trim();

    // --- Therapy (non presente nel legacy → false) ---
    const therapy = false;

    // --- Consent privacy ---
    const consentPrivacy = true; // Nel legacy assumiamo che il consenso sia sempre dato, in quanto i dati erano già trattati secondo le normative vigenti al tempo. Se invece vogliamo mappare da un campo specifico, possiamo fare così:

    // --- Device status mapping ---
    const mappedStatus = mapInternalStatusToPublic(
      row["Stato"] || ""
    );

    // --- Build status note ---
    const noteParts: string[] = [];

    if (row["Action Point"])
      noteParts.push(`Action Point: ${row["Action Point"]}`);

    if (row["Scala"])
      noteParts.push(`Scala: ${row["Scala"]}`);

    if (row["Note Interne"])
      noteParts.push(`Note Interne: ${row["Note Interne"]}`);

    if (row["Note Interne 2"])
      noteParts.push(`Note Interne 2: ${row["Note Interne 2"]}`);

    if (row["Consegna"])
      noteParts.push(`Consegna: ${row["Consegna"]}`);

    const note =
      noteParts.length > 0
        ? noteParts.join("\n")
        : "Import legacy";

    // --- Private Data ---
    const privateData = {
      email: row["Indirizzo email"] || "",
      phone: row["Telefono"] || "",
      firstName,
      lastName,
      recipient, // nuovo campo
      relation: row["Relazione con il destinatario"] || "",
      province: row["Provincia"] || "",
      therapy,
      amputationType: row["Tipo di amputazione"] || "",
      description: row["Descrizione"] || "",
      preferences: row["Preferenze / Note"] || "",
      consentPrivacy,
    };

    // --- Main Doc ---
    const mainDoc = {
      createdAt,
      updatedAt: createdAt,
      createdBy: "legacy-import",
      age: Number(row["Anni"] || 0),
      gender: row["Sesso del destinatatio"] || "",
      assignedVolunteer: (row["Volontario"] || "").trim() || null,
      status: mappedStatus,
    };

    // --- Status Change (array come richiesto) ---
    const statusChange = [
      {
        newStatus: mappedStatus,
        note,
        changedAt: createdAt,
        changedBy: "legacy-import",
      },
    ];

    // --- Volunteer ---
    const volunteerName = (row["Volontario"] || "").trim();

    // --- Public Data ---
    const publicData = {
      createdAt,
      devicetype: row["Device"] || "unknown",
      province: row["Provincia"] || "",
      publicStatus: mapInternalStatusToPublic(mappedStatus),
    };

    return {
      mainDoc,
      privateData,
      statusChange,
      volunteerName,
      publicData,
    };
  };

  // Dry run: just transform and log
  const handleDryRun = () => {
    setDryRunMode(true);
    setLogs([]);
    const transformed = csvRows.map((row, idx) => {
      try {
        const obj = legacyMode ? transformRowLegacy(row) : transformRow(row);
        return { idx, obj };
      } catch (err: any) {
        return { idx, error: err.message || String(err) };
      }
    });
    setParsedData(transformed);
    setLogs(transformed.map((r) =>
      r.error
        ? `Row ${r.idx + 1}: ERROR - ${r.error}`
        : `Row ${r.idx + 1}: OK - ${JSON.stringify(r.obj)}`
    ));
    toast.current?.show({
      severity: "info",
      summary: "Dry Run completato",
      detail: `Righe processate: ${transformed.length}`,
      life: 3000,
    });
  };

  // Find volunteer userId by full name
  const findVolunteerId = async (fullName: string) => {
    if (!fullName) return null;
    const usersSnap = await getDocs(collection(db, "users"));
    for (const userDoc of usersSnap.docs) {
      const profileSnap = await getDocs(collection(db, `users/${userDoc.id}/private`));
      let profile: any = {};
      for (const p of profileSnap.docs) {
        if (p.id === "profile") profile = p.data();
      }
      const userFullName = `${profile.firstName || ""} ${profile.lastName || ""}`.trim();
      if (userFullName.toLowerCase() === fullName.toLowerCase()) {
        return userDoc.id;
      }
    }
    return null;
  };

  // Import handler
  const handleImport = async () => {
    setImporting(true);
    setDryRunMode(false);
    setLogs([]);
    setProgress(0);
    setSuccessCount(0);
    setErrorCount(0);

    let ok = 0, err = 0;
    for (let i = 0; i < csvRows.length; i++) {
      const row = csvRows[i];
      try {
        const { mainDoc, privateData, statusChange, volunteerName, publicData } = legacyMode ? transformRowLegacy(row) : transformRow(row);

        // Step 1: create deviceRequests doc
        const docRef = await addDoc(collection(db, "deviceRequests"), mainDoc);

        // Step 2: create private/data subdoc
        await setDoc(doc(db, "deviceRequests", docRef.id, "private", "data"), privateData);

        // Step 3: call changeStatus function
        const changeStatusFn = httpsCallable(functions, "changeStatus");
        await changeStatusFn({
          requestId: docRef.id,
          newStatus: statusChange.newStatus,
          note: statusChange.note,
        });

        // Step 4: assign volunteer if present
        if (volunteerName) {
          const userId = await findVolunteerId(volunteerName);
          const assignVolunteerFn = httpsCallable(functions, "assignVolunteer");
          if (userId) {
            await assignVolunteerFn({
              deviceId: docRef.id,
              userId,
            });
            setLogs((prev) => [
              ...prev,
              `Row ${i + 1}: Volontario "${volunteerName}" associato (userId: ${userId})`,
            ]);
          } else {
            await assignVolunteerFn({
              deviceId: docRef.id,
              userId: volunteerName, // Passiamo il nome come userId per log/error handling lato funzione
            });
            setLogs((prev) => [
              ...prev,
              `Row ${i + 1}: Volontario "${volunteerName}" NON trovato, mappato come userId per gestione manuale`,
            ]);
          }
        }

        await setDoc(doc(db, "publicDeviceRequests", docRef.id), publicData);

        setLogs((prev) => [
          ...prev,
          `Row ${i + 1}: Import OK (id: ${docRef.id})`,
        ]);
        ok++;
      } catch (error: any) {
        setLogs((prev) => [
          ...prev,
          `Row ${i + 1}: ERROR - ${error?.message || String(error)}`,
        ]);
        err++;
      }
      setProgress(Math.round(((i + 1) / csvRows.length) * 100));
      setSuccessCount(ok);
      setErrorCount(err);
    }
    setImporting(false);
    toast.current?.show({
      severity: err === 0 ? "success" : "warn",
      summary: "Import completato",
      detail: `Successi: ${ok}, Errori: ${err}`,
      life: 4000,
    });
  };

  // Delete all deviceRequests and subcollections
  const handleDeleteAll = async () => {
    setDeleteAllLoading(true);
    try {
      const requestsSnap = await getDocs(collection(db, "deviceRequests"));
      for (const reqDoc of requestsSnap.docs) {
        // Delete private/data
        await deleteDoc(doc(db, "deviceRequests", reqDoc.id, "private", "data"));
        // Delete events
        const eventsCol = collection(db, "deviceRequests", reqDoc.id, "events");
        const eventsSnap = await getDocs(eventsCol);
        const deleteEventPromises = eventsSnap.docs.map(evDoc => deleteDoc(evDoc.ref));
        await Promise.all(deleteEventPromises);
        // Delete main doc
        await deleteDoc(doc(db, "deviceRequests", reqDoc.id));

        await deleteDoc(doc(db, "publicDeviceRequests", reqDoc.id));
      }
      toast.current?.show({
        severity: "success",
        summary: "Eliminazione completata",
        detail: "Tutte le richieste sono state eliminate.",
        life: 4000,
      });
    } catch (err: any) {
      toast.current?.show({
        severity: "error",
        summary: "Errore eliminazione",
        detail: err?.message || String(err),
        life: 4000,
      });
    } finally {
      setDeleteAllLoading(false);
      setShowDeleteAllDialog(false);
      setDeleteAllText("");
    }
  };

  return (
    <div style={{ padding: 24, maxWidth: 900, margin: "0 auto" }}>
      <Toast ref={toast} />
      <Dialog
        header="Conferma eliminazione TUTTE le richieste"
        visible={showDeleteAllDialog}
        style={{ width: 400 }}
        modal
        onHide={() => setShowDeleteAllDialog(false)}
        footer={
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <Button
              label="Annulla"
              className="p-button-text"
              onClick={() => setShowDeleteAllDialog(false)}
              disabled={deleteAllLoading}
            />
            <Button
              label="Elimina tutto"
              className="p-button-danger"
              disabled={deleteAllText !== "delete all" || deleteAllLoading}
              loading={deleteAllLoading}
              onClick={handleDeleteAll}
            />
          </div>
        }
      >
        <div>
          <p>
            <strong>ATTENZIONE:</strong> Questa azione eliminerà <u>TUTTE</u> le richieste e i relativi dati.<br />
            Per confermare, scrivi <b>delete all</b> qui sotto:
          </p>
          <InputText
            value={deleteAllText}
            onChange={e => setDeleteAllText(e.target.value)}
            placeholder="delete all"
            style={{ width: "100%" }}
            disabled={deleteAllLoading}
          />
        </div>
      </Dialog>
      <Panel header="Manutenzione richieste - Import CSV" style={{ marginBottom: 24 }}>
        <div style={{ marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span className="p-buttonset">
            <Button
              label={fileName ? fileName : "Seleziona CSV"}
              icon="pi pi-file"
              onClick={() => document.getElementById("csv-upload")?.click()}
              disabled={importing}
              className="p-button-outlined"
            />
            <input
              id="csv-upload"
              type="file"
              accept=".csv"
              onChange={handleFileChange}
              disabled={importing}
              style={{ display: "none" }}
            />
          </span>
          <ToggleButton
            checked={legacyMode}
            onChange={e => setLegacyMode(e.value)}
            onLabel="Legacy"
            offLabel="Standard"
            onIcon="pi pi-history"
            offIcon="pi pi-database"
            disabled={importing}
            style={{ marginRight: 8 }}
          />
          <Button
            label="Delete All"
            icon="pi pi-trash"
            className="p-button-danger"
            onClick={() => setShowDeleteAllDialog(true)}
            disabled={importing || deleteAllLoading}
          />
        </div>
        <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
          <Button
            label="Dry Run"
            icon="pi pi-search"
            onClick={handleDryRun}
            disabled={!csvRows.length || importing}
            className="p-button-secondary"
          />
          <Button
            label="Start Import"
            icon="pi pi-upload"
            onClick={handleImport}
            disabled={!csvRows.length || importing}
          />
        </div>
        <div style={{ marginBottom: 12 }}>
          <strong>Totale righe CSV:</strong> {csvRows.length}
          {" | "}
          <strong>Successi:</strong> {successCount}
          {" | "}
          <strong>Errori:</strong> {errorCount}
        </div>
        {importing && (
          <ProgressBar value={progress} showValue={true} style={{ marginBottom: 16 }} />
        )}
        <Panel header="Log importazione" style={{ maxHeight: 300, overflowY: "auto" }}>
          <pre style={{ fontSize: 13, whiteSpace: "pre-wrap" }}>
            {logs.map((log, idx) => (
              <div key={idx}>{log}</div>
            ))}
          </pre>
        </Panel>
      </Panel>
    </div>
  );
}
