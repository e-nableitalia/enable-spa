import { useCallback, useEffect, useRef, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { doc, getDoc } from "firebase/firestore";
import { auth, db, functions } from "../../firebase";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Button } from "primereact/button";
import { Dialog } from "primereact/dialog";
import { InputText } from "primereact/inputtext";
import { InputTextarea } from "primereact/inputtextarea";
import { Dropdown } from "primereact/dropdown";
import { Toast } from "primereact/toast";
import { ConfirmDialog, confirmDialog } from "primereact/confirmdialog";

interface FirestoreTimestampLike {
  _seconds: number;
  _nanoseconds: number;
}

interface DeviceRequestAttachment {
  id: string;
  fileName: string;
  extension: string;
  description: string;
  notes: string;
  category: string | null;
  size: number;
  uploadedBy: string;
  createdAt: FirestoreTimestampLike | null;
  updatedAt: FirestoreTimestampLike | null;
}

interface Props {
  /** Id della deviceRequest a cui sono collegati gli allegati. */
  requestId: string;
}

function formatTimestamp(value: FirestoreTimestampLike | null | undefined): string {
  if (!value || typeof value._seconds !== "number") return "-";
  return new Date(value._seconds * 1000).toLocaleString();
}

function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "-";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Tab "Allegati" di una `deviceRequest` (EA-168): elenco (con filtro per
 * categoria), upload, download, modifica descrizione/note ed eliminazione,
 * tramite i 5 wrapper Cloud Function del layer device-requests
 * (`uploadDeviceRequestAttachment`/`listDeviceRequestAttachments`/
 * `downloadDeviceRequestAttachment`/`updateDeviceRequestAttachmentDescription`/
 * `deleteDeviceRequestAttachment`), che applicano l'RBAC più stretto di
 * device-requests (admin o volontario assegnato) prima di delegare alla
 * capability di base "Allegati".
 *
 * Condiviso tra `RequestDetail` (admin) e `VolunteerRequestDetail`
 * (volontario assegnato), stesso principio di `DeviceRequestChecklists`
 * (F-16): l'RBAC effettivo (chi può modificare/eliminare cosa) resta
 * comunque deciso lato server, questo componente mostra/nasconde solo le
 * azioni per cui l'utente corrente ha una ragionevole aspettativa di
 * successo (admin, o proprietario dell'allegato).
 */
export default function DeviceRequestAttachments({ requestId }: Props) {
  const toast = useRef<Toast>(null);
  const currentUid = auth.currentUser?.uid ?? null;

  const [attachments, setAttachments] = useState<DeviceRequestAttachment[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploaderNames, setUploaderNames] = useState<Record<string, string>>({});
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);

  const [showUploadDialog, setShowUploadDialog] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadDescription, setUploadDescription] = useState("");
  const [uploadNotes, setUploadNotes] = useState("");
  const [uploadCategory, setUploadCategory] = useState("");
  const [uploading, setUploading] = useState(false);

  const [editingAttachment, setEditingAttachment] = useState<DeviceRequestAttachment | null>(null);
  const [editDescription, setEditDescription] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  /** Recupera il nome completo di un utente dato il suo userId (stesso
   * pattern locale già duplicato in `RequestDetail`/`VolunteerRequestDetail`,
   * nessun helper condiviso esiste oggi per questo). */
  const getUserFullName = useCallback(async (userId: string): Promise<string> => {
    if (!userId || userId.includes("/")) return userId;
    const profileRef = doc(db, "users", userId, "private", "profile");
    const profileSnap = await getDoc(profileRef);
    if (profileSnap.exists()) {
      const data = profileSnap.data();
      const fullName = `${data.firstName || ""} ${data.lastName || ""}`.trim();
      if (fullName) return fullName;
    }
    return userId;
  }, []);

  const fetchAttachments = useCallback(async () => {
    setLoading(true);
    try {
      const fn = httpsCallable<{ requestId: string }, { attachments: DeviceRequestAttachment[] }>(
        functions,
        "listDeviceRequestAttachments"
      );
      const result = await fn({ requestId });
      const list = result.data.attachments ?? [];
      setAttachments(list);

      const uniqueUploaders = Array.from(new Set(list.map((a) => a.uploadedBy)));
      const resolved = await Promise.all(uniqueUploaders.map((uid) => getUserFullName(uid)));
      setUploaderNames(Object.fromEntries(uniqueUploaders.map((uid, i) => [uid, resolved[i]])));
    } catch (err) {
      toast.current?.show({
        severity: "error",
        summary: "Errore",
        detail: err instanceof Error ? err.message : "Impossibile recuperare gli allegati.",
        life: 4000,
      });
    }
    setLoading(false);
  }, [requestId, getUserFullName]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetchAttachments fetches from a Cloud Function, not derivable from props/state
    fetchAttachments();
  }, [fetchAttachments]);

  const categories = Array.from(new Set(attachments.map((a) => a.category).filter((c): c is string => !!c)));
  const filteredAttachments = categoryFilter
    ? attachments.filter((a) => a.category === categoryFilter)
    : attachments;

  const openUploadDialog = () => {
    setUploadFile(null);
    setUploadDescription("");
    setUploadNotes("");
    setUploadCategory("");
    setShowUploadDialog(true);
  };

  const handleUpload = async () => {
    if (!uploadFile || !uploadDescription.trim()) return;
    setUploading(true);
    try {
      const fn = httpsCallable<
        { requestId: string; fileName: string; description: string; notes?: string; category?: string; size: number },
        { attachmentId: string; uploadUrl: string }
      >(functions, "uploadDeviceRequestAttachment");
      const result = await fn({
        requestId,
        fileName: uploadFile.name,
        description: uploadDescription.trim(),
        notes: uploadNotes.trim() || undefined,
        category: uploadCategory.trim() || undefined,
        size: uploadFile.size,
      });

      const putResponse = await fetch(result.data.uploadUrl, {
        method: "PUT",
        body: uploadFile,
      });
      if (!putResponse.ok) {
        throw new Error(`Caricamento del file fallito (HTTP ${putResponse.status})`);
      }

      toast.current?.show({
        severity: "success",
        summary: "Allegato caricato",
        detail: "L'allegato è stato caricato correttamente.",
        life: 3000,
      });
      setShowUploadDialog(false);
      await fetchAttachments();
    } catch (err) {
      toast.current?.show({
        severity: "error",
        summary: "Errore",
        detail: err instanceof Error ? err.message : "Errore durante il caricamento dell'allegato.",
        life: 5000,
      });
    }
    setUploading(false);
  };

  const handleDownload = async (attachment: DeviceRequestAttachment) => {
    setDownloadingId(attachment.id);
    try {
      const fn = httpsCallable<{ requestId: string; attachmentId: string }, { downloadUrl: string }>(
        functions,
        "downloadDeviceRequestAttachment"
      );
      const result = await fn({ requestId, attachmentId: attachment.id });
      window.open(result.data.downloadUrl, "_blank", "noopener,noreferrer");
    } catch (err) {
      toast.current?.show({
        severity: "error",
        summary: "Errore",
        detail: err instanceof Error ? err.message : "Impossibile scaricare l'allegato.",
        life: 4000,
      });
    }
    setDownloadingId(null);
  };

  const openEditDialog = (attachment: DeviceRequestAttachment) => {
    setEditingAttachment(attachment);
    setEditDescription(attachment.description);
    setEditNotes(attachment.notes);
  };

  const handleSaveEdit = async () => {
    if (!editingAttachment || !editDescription.trim()) return;
    setSavingEdit(true);
    try {
      const fn = httpsCallable<
        { requestId: string; attachmentId: string; description: string; notes?: string },
        { attachmentId: string }
      >(functions, "updateDeviceRequestAttachmentDescription");
      await fn({
        requestId,
        attachmentId: editingAttachment.id,
        description: editDescription.trim(),
        notes: editNotes,
      });
      toast.current?.show({
        severity: "success",
        summary: "Allegato aggiornato",
        detail: "Descrizione e note aggiornate.",
        life: 3000,
      });
      setEditingAttachment(null);
      await fetchAttachments();
    } catch (err) {
      toast.current?.show({
        severity: "error",
        summary: "Errore",
        detail: err instanceof Error ? err.message : "Errore durante l'aggiornamento dell'allegato.",
        life: 5000,
      });
    }
    setSavingEdit(false);
  };

  const handleDelete = (attachment: DeviceRequestAttachment) => {
    confirmDialog({
      message: `Eliminare l'allegato "${attachment.fileName}"? L'operazione non è reversibile.`,
      header: "Conferma eliminazione allegato",
      icon: "pi pi-exclamation-triangle",
      acceptLabel: "Elimina",
      rejectLabel: "Annulla",
      acceptClassName: "p-button-danger",
      accept: async () => {
        setDeletingId(attachment.id);
        try {
          const fn = httpsCallable<{ requestId: string; attachmentId: string }, { attachmentId: string }>(
            functions,
            "deleteDeviceRequestAttachment"
          );
          await fn({ requestId, attachmentId: attachment.id });
          toast.current?.show({
            severity: "success",
            summary: "Allegato eliminato",
            detail: "L'allegato è stato eliminato.",
            life: 3000,
          });
          await fetchAttachments();
        } catch (err) {
          toast.current?.show({
            severity: "error",
            summary: "Errore",
            detail: err instanceof Error ? err.message : "Errore durante l'eliminazione dell'allegato.",
            life: 5000,
          });
        } finally {
          setDeletingId(null);
        }
      },
    });
  };

  /** Un allegato è modificabile/eliminabile dall'utente corrente se è
   * l'uploader — l'admin vede comunque sempre le azioni, la Cloud Function
   * generica applica comunque il controllo reale (questo è solo un
   * suggerimento lato UI, non l'RBAC). Non conosciamo qui il ruolo
   * dell'utente corrente: mostriamo le azioni se l'utente è il proprietario,
   * e le lasciamo comunque visibili altrimenti (un tentativo non ammesso
   * viene comunque respinto dal server con un messaggio d'errore chiaro). */
  const canModify = (attachment: DeviceRequestAttachment) => attachment.uploadedBy === currentUid;

  return (
    <div>
      <Toast ref={toast} />
      <ConfirmDialog />

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <Button label="Carica allegato" icon="pi pi-upload" onClick={openUploadDialog} />
        {categories.length > 0 && (
          <Dropdown
            value={categoryFilter}
            options={[{ label: "Tutte le categorie", value: null }, ...categories.map((c) => ({ label: c, value: c }))]}
            optionValue="value"
            onChange={(e) => setCategoryFilter(e.value)}
            placeholder="Filtra per categoria"
            style={{ minWidth: 220 }}
          />
        )}
      </div>

      <DataTable
        value={filteredAttachments}
        loading={loading}
        emptyMessage="Nessun allegato collegato a questa richiesta."
        dataKey="id"
      >
        <Column
          header=""
          style={{ width: 40 }}
          body={(a: DeviceRequestAttachment) =>
            a.notes ? (
              <i
                className="pi pi-info-circle"
                role="img"
                aria-label={`Note: ${a.notes}`}
                title={a.notes}
                style={{ color: "#6b7280", cursor: "help" }}
              />
            ) : null
          }
        />
        <Column field="fileName" header="File" />
        <Column field="description" header="Descrizione" />
        <Column field="category" header="Categoria" body={(a: DeviceRequestAttachment) => a.category || "-"} />
        <Column field="size" header="Dimensione" body={(a: DeviceRequestAttachment) => formatSize(a.size)} />
        <Column
          header="Caricato da"
          body={(a: DeviceRequestAttachment) => uploaderNames[a.uploadedBy] || a.uploadedBy}
        />
        <Column header="Caricato il" body={(a: DeviceRequestAttachment) => formatTimestamp(a.createdAt)} />
        <Column header="Modificato il" body={(a: DeviceRequestAttachment) => formatTimestamp(a.updatedAt)} />
        <Column
          header="Azioni"
          body={(a: DeviceRequestAttachment) => (
            <div style={{ display: "flex", gap: 4 }}>
              <Button
                icon="pi pi-download"
                className="p-button-text p-button-sm"
                tooltip="Scarica"
                aria-label="Scarica"
                loading={downloadingId === a.id}
                onClick={() => handleDownload(a)}
              />
              <Button
                icon="pi pi-pencil"
                className="p-button-text p-button-sm"
                tooltip="Modifica descrizione/note"
                aria-label="Modifica descrizione/note"
                onClick={() => openEditDialog(a)}
                disabled={!canModify(a)}
              />
              <Button
                icon="pi pi-trash"
                className="p-button-text p-button-sm p-button-danger"
                tooltip="Elimina"
                aria-label="Elimina"
                loading={deletingId === a.id}
                onClick={() => handleDelete(a)}
                disabled={!canModify(a)}
              />
            </div>
          )}
        />
      </DataTable>

      {/* Dialog upload allegato */}
      <Dialog
        header="Carica allegato"
        visible={showUploadDialog}
        style={{ width: "480px" }}
        modal
        onHide={() => setShowUploadDialog(false)}
        footer={
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <Button
              label="Annulla"
              className="p-button-text"
              onClick={() => setShowUploadDialog(false)}
              disabled={uploading}
            />
            <Button
              label="Carica"
              icon="pi pi-upload"
              onClick={handleUpload}
              loading={uploading}
              disabled={!uploadFile || !uploadDescription.trim()}
            />
          </div>
        }
      >
        <div style={{ marginBottom: 16 }}>
          <label htmlFor="attachment-file" style={{ display: "block", marginBottom: 4 }}>
            File
          </label>
          <Button
            label={uploadFile ? uploadFile.name : "Scegli file"}
            icon="pi pi-file"
            className="p-button-outlined"
            onClick={() => document.getElementById("attachment-file")?.click()}
            type="button"
          />
          <input
            id="attachment-file"
            type="file"
            onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
            style={{ display: "none" }}
          />
        </div>
        <div style={{ marginBottom: 16 }}>
          <label htmlFor="attachment-description" style={{ display: "block", marginBottom: 4 }}>
            Descrizione
          </label>
          <InputText
            id="attachment-description"
            value={uploadDescription}
            onChange={(e) => setUploadDescription(e.target.value)}
            style={{ width: "100%" }}
          />
        </div>
        <div style={{ marginBottom: 16 }}>
          <label htmlFor="attachment-notes" style={{ display: "block", marginBottom: 4 }}>
            Note
          </label>
          <InputTextarea
            id="attachment-notes"
            value={uploadNotes}
            onChange={(e) => setUploadNotes(e.target.value)}
            rows={2}
            style={{ width: "100%" }}
          />
        </div>
        <div>
          <label htmlFor="attachment-category" style={{ display: "block", marginBottom: 4 }}>
            Categoria
          </label>
          <InputText
            id="attachment-category"
            value={uploadCategory}
            onChange={(e) => setUploadCategory(e.target.value)}
            placeholder="es. documenti, foto..."
            style={{ width: "100%" }}
          />
        </div>
      </Dialog>

      {/* Dialog modifica descrizione/note */}
      <Dialog
        header="Modifica allegato"
        visible={!!editingAttachment}
        style={{ width: "480px" }}
        modal
        onHide={() => setEditingAttachment(null)}
        footer={
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <Button
              label="Annulla"
              className="p-button-text"
              onClick={() => setEditingAttachment(null)}
              disabled={savingEdit}
            />
            <Button
              label="Salva"
              icon="pi pi-check"
              onClick={handleSaveEdit}
              loading={savingEdit}
              disabled={!editDescription.trim()}
            />
          </div>
        }
      >
        <div style={{ marginBottom: 16 }}>
          <label htmlFor="edit-attachment-description" style={{ display: "block", marginBottom: 4 }}>
            Descrizione
          </label>
          <InputText
            id="edit-attachment-description"
            value={editDescription}
            onChange={(e) => setEditDescription(e.target.value)}
            style={{ width: "100%" }}
          />
        </div>
        <div>
          <label htmlFor="edit-attachment-notes" style={{ display: "block", marginBottom: 4 }}>
            Note
          </label>
          <InputTextarea
            id="edit-attachment-notes"
            value={editNotes}
            onChange={(e) => setEditNotes(e.target.value)}
            rows={2}
            style={{ width: "100%" }}
          />
        </div>
      </Dialog>
    </div>
  );
}
