import { useState, useRef } from "react";
import { Panel } from "primereact/panel";
import { Button } from "primereact/button";
import { ProgressBar } from "primereact/progressbar";
import { Toast } from "primereact/toast";
import Papa from "papaparse";
import { db, functions } from "../../../firebase";
import { collection, doc, getDocs, deleteDoc, updateDoc, writeBatch, deleteField } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { Timestamp } from "firebase/firestore";
import { Dialog } from "primereact/dialog";
import { InputText } from "primereact/inputtext";
import { ToggleButton } from "primereact/togglebutton";
import { mapInternalStatusToPublic } from "../../../helpers/requestStatus";
import { TabView, TabPanel } from "primereact/tabview";

export default function AdminMaintenanceRequests() {
  const [csvRows, setCsvRows] = useState<any[]>([]);
  const [parsedData, setParsedData] = useState<any[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  //const [dryRunMode, setDryRunMode] = useState(false);
  const [progress, setProgress] = useState(0);
  const [successCount, setSuccessCount] = useState(0);
  const [errorCount, setErrorCount] = useState(0);
  const [fileName, setFileName] = useState<string | null>(null);
  const [showDeleteAllDialog, setShowDeleteAllDialog] = useState(false);
  const [deleteAllText, setDeleteAllText] = useState("");
  const [deleteAllLoading, setDeleteAllLoading] = useState(false);
  const [legacyMode, setLegacyMode] = useState(false);
  const [logsTab, setLogsTab] = useState(true);
  const [updatingDates, setUpdatingDates] = useState(false);
  const [migratingVolunteers, setMigratingVolunteers] = useState(false);
  const toast = useRef<any>(null);

  type PrivateData = {
    email: string;
    firstName: string;
    lastName: string;
    phone?: string;
    recipient?: string;
    relation?: string;
    province: string;
    therapy: boolean;
    amputationType: string;
    description?: string;
    preferences?: string;
    consentPrivacy: boolean;
  };

  // CSV file input handler
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      delimiter: legacyMode ? ";" : ",",
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
      phone: row["Telefono"] || "",
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
      assignedVolunteers: [],
      status: "imported", // initial status, will be changed by function
    };
    // Status change
    const statusChange = {
      newStatus: (row["Stato"] || "").trim().toLowerCase(),
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
    const stato = (row["Stato"] || "").trim().toLowerCase();
    const mappedStatus = mapInternalStatusToPublic(
      stato
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
      assignedVolunteers: (row["Volontario"] || "").trim() ? [(row["Volontario"] || "").trim()] : [],
      status: stato,
      publicStatus: mappedStatus,
    };

    // --- Status Change (array come richiesto) ---
    const statusChange = [
      {
        newStatus: stato,
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
      publicStatus: mappedStatus,
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
        : `Row ${r.idx + 1}: OK`
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
    setLogs([]);
    setProgress(0);
    setSuccessCount(0);
    setErrorCount(0);

    const createFn = httpsCallable<Record<string, unknown>, { requestId: string }>(functions, "createDeviceRequestInternal");
    const changeStatusFn = httpsCallable(functions, "changeStatus");
    const assignVolunteerFn = httpsCallable(functions, "assignVolunteer");

    let ok = 0, err = 0;
    for (let i = 0; i < csvRows.length; i++) {
      const row = csvRows[i];
      try {
        const transformed = legacyMode ? transformRowLegacy(row) : transformRow(row);
        const { mainDoc, statusChange, volunteerName, publicData } = transformed;
        const privateData: PrivateData = transformed.privateData;

        // Step 1: create device request via Cloud Function
        const res = await createFn({
          source: legacyMode ? "legacy-import" : "import",
          email: privateData.email,
          firstName: privateData.firstName,
          lastName: privateData.lastName,
          phone: privateData.phone,
          relation: privateData.relation,
          province: privateData.province,
          therapy: privateData.therapy,
          amputationType: privateData.amputationType,
          description: privateData.description,
          preferences: privateData.preferences,
          consentPrivacy: privateData.consentPrivacy,
          ...(privateData.recipient && { recipient: privateData.recipient }),
          age: mainDoc.age,
          gender: mainDoc.gender,
          devicetype: publicData.devicetype,
        });
        const requestId = res.data.requestId;

        // Step 2: call changeStatus function
        if (Array.isArray(statusChange)) {
          for (const sc of statusChange) {
            if (!sc.newStatus) throw new Error("Missing status");
            await changeStatusFn({
              requestId,
              newStatus: sc.newStatus,
              note: sc.note,
            });
          }
        } else {
          if (!statusChange.newStatus) throw new Error("Missing status");
          await changeStatusFn({
            requestId,
            newStatus: statusChange.newStatus,
            note: statusChange.note,
          });
        }

        // Step 3: assign volunteer if present
        if (volunteerName) {
          const userId = await findVolunteerId(volunteerName);
          if (userId) {
            await assignVolunteerFn({
              deviceId: requestId,
              userId,
            });
            setLogs((prev) => [
              ...prev,
              `Row ${i + 1}: Volontario "${volunteerName}" associato (userId: ${userId})`,
            ]);
          } else {
            await assignVolunteerFn({
              deviceId: requestId,
              userId: volunteerName, // Passiamo il nome come userId per log/error handling lato funzione
            });
            setLogs((prev) => [
              ...prev,
              `Row ${i + 1}: Volontario "${volunteerName}" NON trovato, mappato come userId per gestione manuale`,
            ]);
          }
        }

        setLogs((prev) => [
          ...prev,
          `Row ${i + 1}: Import OK (id: ${requestId})`,
        ]);
        ok++;
      } catch (error: unknown) {
        setLogs((prev) => [
          ...prev,
          `Row ${i + 1}: ERROR - ${(error as { message?: string })?.message || String(error)}`,
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

  // Parse date string formatted as "25/02/2024 17.57.38"
  const parseLegacyDate = (raw: string): Timestamp | null => {
    if (!raw) return null;
    const [datePart, timePart] = raw.trim().split(" ");
    if (!datePart) return null;
    const [day, month, year] = datePart.split("/").map(Number);
    const [h = 0, m = 0, s = 0] = (timePart || "").split(".").map(Number);
    const d = new Date(year, month - 1, day, h, m, s);
    if (isNaN(d.getTime())) return null;
    return Timestamp.fromDate(d);
  };

  // Update createdAt on existing "import" requests matched by email from CSV
  const handleUpdateDates = async () => {
    if (!csvRows.length) return;
    setUpdatingDates(true);
    setLogs([]);

    try {
      // Load all deviceRequests with createdBy === "import"
      const requestsSnap = await getDocs(collection(db, "deviceRequests"));
      const importDocs = requestsSnap.docs.filter(d => d.data().createdBy === "import");

      // For each, load private/data to get email → build map email -> id
      const emailToId = new Map<string, string>();
      for (const reqDoc of importDocs) {
        const privateSnap = await getDocs(collection(db, `deviceRequests/${reqDoc.id}/private`));
        for (const p of privateSnap.docs) {
          if (p.id === "data") {
            const email = (p.data().email || "").toLowerCase().trim();
            if (email) emailToId.set(email, reqDoc.id);
          }
        }
      }

      let ok = 0, notFound = 0, err = 0;
      const newLogs: string[] = [];

      for (let i = 0; i < csvRows.length; i++) {
        const row = csvRows[i];
        const email = (row["Indirizzo email"] || "").toLowerCase().trim();
        const rawDate = row["Informazioni cronologiche"] || "";
        const ts = parseLegacyDate(rawDate);

        if (!ts) {
          newLogs.push(`Row ${i + 1}: SKIP - data non valida ("${rawDate}")`);
          notFound++;
          continue;
        }
        const requestId = emailToId.get(email);
        if (!requestId) {
          newLogs.push(`Row ${i + 1}: NOT FOUND - nessuna richiesta per email "${email}"`);
          notFound++;
          continue;
        }
        try {
          await updateDoc(doc(db, "deviceRequests", requestId), { createdAt: ts, updatedAt: ts });
          await updateDoc(doc(db, "publicDeviceRequests", requestId), { createdAt: ts });
          newLogs.push(`Row ${i + 1}: OK - aggiornato ${requestId} → ${rawDate}`);
          ok++;
        } catch (e: unknown) {
          newLogs.push(`Row ${i + 1}: ERROR - ${(e as { message?: string })?.message || String(e)}`);
          err++;
        }
      }

      setLogs(newLogs);
      toast.current?.show({
        severity: err === 0 ? "success" : "warn",
        summary: "Aggiornamento date completato",
        detail: `OK: ${ok}, Non trovati: ${notFound}, Errori: ${err}`,
        life: 5000,
      });
    } catch (e: unknown) {
      toast.current?.show({
        severity: "error",
        summary: "Errore",
        detail: (e as { message?: string })?.message || String(e),
        life: 4000,
      });
    } finally {
      setUpdatingDates(false);
    }
  };

  // Migrate assignedVolunteer (string|null) → assignedVolunteers (string[])
  // Idempotent: skips documents that already have assignedVolunteers
  const handleMigrateVolunteers = async () => {
    setMigratingVolunteers(true);
    setLogs([]);
    setProgress(0);
    setSuccessCount(0);
    setErrorCount(0);

    const newLogs: string[] = [];

    try {
      const requestsSnap = await getDocs(collection(db, "deviceRequests"));
      const all = requestsSnap.docs;

      // Idempotent: migrate docs missing assignedVolunteers OR shippingAddress
      const needsVolunteers = (d: { data: () => Record<string, unknown> }) => !("assignedVolunteers" in d.data());
      const needsShipping   = (d: { data: () => Record<string, unknown> }) => !("shippingAddress" in d.data());
      const toMigrate   = all.filter((d) => needsVolunteers(d) || needsShipping(d));
      const skippedDocs = all.filter((d) => !needsVolunteers(d) && !needsShipping(d));

      newLogs.push(`── Inizio migrazione ──────────────────────────`);
      newLogs.push(`Totale documenti  : ${all.length}`);
      newLogs.push(`Da migrare        : ${toMigrate.length}`);
      newLogs.push(`Già migrati (skip): ${skippedDocs.length}`);
      newLogs.push(`───────────────────────────────────────────────`);
      skippedDocs.forEach((d) =>
        newLogs.push(`SKIP  ${d.id}  (già migrato)`)
      );
      setLogs([...newLogs]);

      if (toMigrate.length === 0) {
        newLogs.push(`\nNessun documento da migrare.`);
        setLogs([...newLogs]);
        toast.current?.show({
          severity: "info",
          summary: "Migrazione non necessaria",
          detail: "Tutti i documenti risultano già migrati.",
          life: 3000,
        });
        return;
      }

      const BATCH_SIZE = 499; // Firestore max 500 ops/batch
      let ok = 0, err = 0;

      for (let i = 0; i < toMigrate.length; i += BATCH_SIZE) {
        const chunk = toMigrate.slice(i, i + BATCH_SIZE);
        const batchNum = Math.floor(i / BATCH_SIZE) + 1;
        const batch = writeBatch(db);

        // Prepare per-doc data before committing (data() reflects pre-commit state)
        const chunkMeta = chunk.map((docSnap) => {
          const data = docSnap.data();
          const update: Record<string, unknown> = {};
          const changes: string[] = [];

          // assignedVolunteers migration
          if (!("assignedVolunteers" in data)) {
            const raw: string = data.assignedVolunteer ?? "";
            // Split on "/" to handle "Name1 / Name2" legacy format, trim each, remove empty, deduplicate
            const assignedVolunteers: string[] = [
              ...new Set(
                raw
                  .split("/")
                  .map((v: string) => v.trim())
                  .filter((v: string) => v.length > 0)
              ),
            ];
            update.assignedVolunteers = assignedVolunteers;
            update.assignedVolunteer = deleteField();
            changes.push(
              `assignedVolunteer: ${raw ? `"${raw}"` : "null"} → [${assignedVolunteers.map((v) => `"${v}"`).join(", ")}]`
            );
          }

          // shippingAddress initialization (never overwrite existing)
          if (!("shippingAddress" in data)) {
            update.shippingAddress = null;
            changes.push(`shippingAddress: (missing) → null`);
          }

          batch.update(docSnap.ref, update);
          return { docSnap, changes };
        });

        try {
          await batch.commit();
          ok += chunk.length;
          chunkMeta.forEach(({ docSnap, changes }) => {
            newLogs.push(`OK    ${docSnap.id}`);
            changes.forEach((c) => newLogs.push(`  └─ ${c}`));
          });
        } catch (e: unknown) {
          err += chunk.length;
          newLogs.push(
            `ERROR batch ${batchNum}: ${(e as { message?: string })?.message || String(e)}`
          );
          chunkMeta.forEach(({ docSnap }) =>
            newLogs.push(`  └─ ${docSnap.id} non aggiornato`)
          );
        }

        setProgress(Math.round((Math.min(i + BATCH_SIZE, toMigrate.length) / toMigrate.length) * 100));
        setSuccessCount(ok);
        setErrorCount(err);
        setLogs([...newLogs]);
      }

      // Final summary
      newLogs.push(`───────────────────────────────────────────────`);
      newLogs.push(`── Riepilogo ──────────────────────────────────`);
      newLogs.push(`Totale processati : ${all.length}`);
      newLogs.push(`Aggiornati        : ${ok}`);
      newLogs.push(`Saltati           : ${skippedDocs.length}`);
      newLogs.push(`Errori            : ${err}`);
      newLogs.push(`───────────────────────────────────────────────`);
      setLogs([...newLogs]);

      toast.current?.show({
        severity: err === 0 ? "success" : "warn",
        summary: "Migrazione completata",
        detail: `Aggiornati: ${ok} | Saltati: ${skippedDocs.length} | Errori: ${err}`,
        life: 5000,
      });
    } catch (e: unknown) {
      toast.current?.show({
        severity: "error",
        summary: "Errore migrazione",
        detail: (e as { message?: string })?.message || String(e),
        life: 4000,
      });
    } finally {
      setMigratingVolunteers(false);
    }
  };

  // Delete all deviceRequests and subcollections
  const handleDeleteAll = async () => {
    setDeleteAllLoading(true);
    try {
      const requestsSnap = await getDocs(collection(db, "deviceRequests"));
      for (const reqDoc of requestsSnap.docs) {
        // Skip legacy imports
        //if (reqDoc.data().createdBy === "legacy-import") continue;
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
            disabled={!csvRows.length || importing || updatingDates}
            className="p-button-secondary"
          />
          <Button
            label="Start Import"
            icon="pi pi-upload"
            onClick={handleImport}
            disabled={!csvRows.length || importing || updatingDates}
          />
          <Button
            label="Aggiorna date"
            icon="pi pi-calendar"
            onClick={handleUpdateDates}
            disabled={!csvRows.length || importing || updatingDates || migratingVolunteers}
            loading={updatingDates}
            className="p-button-warning"
          />
          <Button
            label="Migra volontari"
            icon="pi pi-users"
            onClick={handleMigrateVolunteers}
            disabled={importing || updatingDates || migratingVolunteers}
            loading={migratingVolunteers}
            className="p-button-help"
            tooltip="Migra assignedVolunteer → assignedVolunteers (idempotente)"
            tooltipOptions={{ position: "top" }}
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
        <Panel header="Risultati" style={{ overflowY: "auto" }}>
          <TabView activeIndex={logsTab ? 0 : 1} onTabChange={e => setLogsTab(e.index === 0)}>
            <TabPanel header="Log importazione">
              <Panel header="" style={{ boxShadow: "none", marginBottom: 0 }}>
                <pre style={{ fontSize: 13, whiteSpace: "pre-wrap" }}>
                  {logs.map((log, idx) => (
                    <div key={idx}>{log}</div>
                  ))}
                </pre>
              </Panel>
            </TabPanel>
            <TabPanel header="Parsed Data">
              <Panel header="" style={{ boxShadow: "none", marginBottom: 0 }}>
                <pre style={{ fontSize: 13, whiteSpace: "pre-wrap" }}>
                  {parsedData.map((row, idx) => (
                    <div key={idx}>
                      {row.error
                        ? `Row ${idx + 1}: ERROR - ${row.error}`
                        : `Row ${idx + 1}: ${JSON.stringify(row.obj, null, 2)}`}
                    </div>
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
