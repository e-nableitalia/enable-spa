import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { collection, doc, getDoc, getDocs, orderBy, query } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../../../firebase";
import { Button } from "primereact/button";
import { Dialog } from "primereact/dialog";
import { Dropdown } from "primereact/dropdown";
import { InputText } from "primereact/inputtext";
import { InputTextarea } from "primereact/inputtextarea";
import { Panel } from "primereact/panel";
import { Tag } from "primereact/tag";
import { Toast } from "primereact/toast";
import RequestTimeline from "../../../components/timeline/RequestTimeline";
import ProjectChecklists, { type ProjectChecklistRef } from "../../../components/checklist/ProjectChecklists";

const PROJECT_STATUSES = ["new", "active", "standby", "archived", "closed"] as const;
const CONTENT_WRITABLE_STATUSES = new Set(["new", "active"]);
const TERMINAL_STATUSES = new Set(["archived", "closed"]);

const STATUS_LABELS: Record<string, string> = {
  new: "Nuovo",
  active: "Attivo",
  standby: "In pausa",
  archived: "Archiviato",
  closed: "Chiuso",
};

interface ProjectData {
  title: string;
  description: string;
  projectType: string;
  status: string;
  checklists: ProjectChecklistRef[];
  createdBy: string;
}

interface ProjectEvent {
  fromStatus?: string;
  toStatus?: string;
  note?: string;
  createdBy?: string;
  userName?: string;
  timestamp?: { toDate: () => Date };
}

/**
 * Nome completo dell'utente `uid`, stesso pattern duplicato in ogni pagina
 * che ne ha bisogno (`RequestDetail.getUserFullName`,
 * `DeviceRequestAttachments.getUserFullName`): fallback sull'uid se il
 * profilo privato non esiste o non è leggibile.
 */
async function getUserFullName(uid: string): Promise<string> {
  if (!uid) return uid;
  try {
    const profileSnap = await getDoc(doc(db, "users", uid, "private", "profile"));
    if (profileSnap.exists()) {
      const data = profileSnap.data() as { firstName?: string; lastName?: string };
      const fullName = `${data.firstName ?? ""} ${data.lastName ?? ""}`.trim();
      if (fullName) return fullName;
    }
  } catch {
    // Permessi insufficienti a leggere il profilo altrui: fallback sull'uid.
  }
  return uid;
}

/**
 * Pagina admin di dettaglio di un progetto speciale/iniziativa/evento
 * (EA-169/170): dati generali (editabili solo in `new`/`active`), cambio di
 * stato con nota di cronologia (riuso di `RequestTimeline`, stessa forma
 * evento di `deviceRequests`), e gestione checklist (`ProjectChecklists`).
 */
export default function ProjectDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useRef<Toast>(null);

  const [project, setProject] = useState<ProjectData | null>(null);
  const [events, setEvents] = useState<ProjectEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [creatorName, setCreatorName] = useState("");

  const [showEditDialog, setShowEditDialog] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  const [showStatusDialog, setShowStatusDialog] = useState(false);
  const [statusDialogMode, setStatusDialogMode] = useState<"note" | "transition">("note");
  const [newStatus, setNewStatus] = useState<string>("new");
  const [statusNote, setStatusNote] = useState("");
  const [savingStatus, setSavingStatus] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const snap = await getDoc(doc(db, "projects", id));
      if (!snap.exists()) {
        toast.current?.show({ severity: "error", summary: "Progetto non trovato", life: 4000 });
        setProject(null);
        return;
      }
      const data = snap.data() as ProjectData;
      setProject(data);
      getUserFullName(data.createdBy).then(setCreatorName);

      const eventsSnap = await getDocs(query(collection(db, "projects", id, "events"), orderBy("timestamp", "desc")));
      const eventsData = eventsSnap.docs.map((d) => d.data());
      const enriched = await Promise.all(
        eventsData.map(async (ev) => ({ ...ev, userName: ev.createdBy ? await getUserFullName(ev.createdBy) : "-" }))
      );
      setEvents(enriched);
    } catch (err) {
      toast.current?.show({
        severity: "error",
        summary: "Errore",
        detail: err instanceof Error ? err.message : "Impossibile caricare il progetto.",
        life: 4000,
      });
    }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load fetches from Firestore, not derivable from props/state
    load();
  }, [load]);

  const contentWritable = project ? CONTENT_WRITABLE_STATUSES.has(project.status) : false;
  const isTerminal = project ? TERMINAL_STATUSES.has(project.status) : false;

  const openEditDialog = () => {
    if (!project) return;
    setEditTitle(project.title);
    setEditDescription(project.description);
    setShowEditDialog(true);
  };

  const handleSaveEdit = async () => {
    if (!id) return;
    setSavingEdit(true);
    try {
      const fn = httpsCallable(functions, "updateProject");
      await fn({ projectId: id, title: editTitle.trim(), description: editDescription });
      toast.current?.show({ severity: "success", summary: "Progetto aggiornato", life: 3000 });
      setShowEditDialog(false);
      await load();
    } catch (err) {
      toast.current?.show({
        severity: "error",
        summary: "Errore",
        detail: err instanceof Error ? err.message : "Errore durante l'aggiornamento del progetto.",
        life: 5000,
      });
    }
    setSavingEdit(false);
  };

  const openNoteDialog = () => {
    if (!project) return;
    setStatusDialogMode("note");
    setNewStatus(project.status);
    setStatusNote("");
    setShowStatusDialog(true);
  };

  const openTransitionDialog = () => {
    if (!project) return;
    setStatusDialogMode("transition");
    setNewStatus(project.status);
    setStatusNote("");
    setShowStatusDialog(true);
  };

  const handleSaveStatus = async () => {
    if (!id) return;
    setSavingStatus(true);
    try {
      const fn = httpsCallable(functions, "changeProjectStatus");
      await fn({ projectId: id, newStatus, note: statusNote.trim() || undefined });
      toast.current?.show({ severity: "success", summary: "Cronologia aggiornata", life: 3000 });
      setShowStatusDialog(false);
      await load();
    } catch (err) {
      toast.current?.show({
        severity: "error",
        summary: "Errore",
        detail: err instanceof Error ? err.message : "Errore durante l'aggiornamento dello stato.",
        life: 5000,
      });
    }
    setSavingStatus(false);
  };

  if (loading) return <div style={{ padding: 20 }}>Caricamento...</div>;
  if (!project) return <div style={{ padding: 20 }}>Progetto non trovato.</div>;

  const statusSeverity = (status: string): "success" | "warning" | "danger" | "info" => {
    if (status === "active") return "success";
    if (status === "standby") return "warning";
    if (status === "archived" || status === "closed") return "danger";
    return "info";
  };

  return (
    <div style={{ padding: 20 }}>
      <Toast ref={toast} />
      <Button
        label="Torna all'elenco"
        icon="pi pi-arrow-left"
        className="p-button-text"
        onClick={() => navigate("/admin/projects")}
        style={{ marginBottom: 16 }}
      />

      <Panel header="Dati generali" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div>
            <strong>Titolo:</strong> {project.title}
          </div>
          <div>
            <strong>Descrizione:</strong> {project.description || "-"}
          </div>
          <div>
            <strong>Tipo:</strong> {project.projectType}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <strong>Stato:</strong>
            <Tag value={STATUS_LABELS[project.status] ?? project.status} severity={statusSeverity(project.status)} />
          </div>
          <div>
            <strong>Creato da:</strong> {creatorName || project.createdBy}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <Button
              label="Modifica"
              icon="pi pi-pencil"
              className="p-button-outlined"
              onClick={openEditDialog}
              disabled={!contentWritable}
              tooltip={!contentWritable ? "Modifica disponibile solo per progetti 'new'/'active'" : undefined}
            />
            <Button
              label="Aggiungi nota"
              icon="pi pi-comment"
              className="p-button-outlined"
              onClick={openNoteDialog}
              disabled={isTerminal}
            />
            <Button
              label="Cambia stato"
              icon="pi pi-sync"
              className="p-button-outlined"
              onClick={openTransitionDialog}
              disabled={isTerminal}
              tooltip={isTerminal ? "Un progetto archiviato/chiuso è terminale" : undefined}
            />
          </div>
        </div>
      </Panel>

      <Panel header="Cronologia" style={{ marginBottom: 16 }}>
        {events.length > 0 ? (
          <RequestTimeline events={events} />
        ) : (
          <div style={{ color: "#888" }}>Nessun evento registrato.</div>
        )}
      </Panel>

      <Panel header="Checklist">
        <ProjectChecklists
          projectId={id as string}
          checklists={project.checklists ?? []}
          projectType={project.projectType}
          onChecklistsChanged={load}
          isAdmin
          readOnly={!contentWritable}
        />
      </Panel>

      <Dialog
        header="Modifica progetto"
        visible={showEditDialog}
        style={{ width: "480px" }}
        modal
        onHide={() => setShowEditDialog(false)}
        footer={
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <Button label="Annulla" className="p-button-text" onClick={() => setShowEditDialog(false)} disabled={savingEdit} />
            <Button label="Salva" icon="pi pi-check" onClick={handleSaveEdit} loading={savingEdit} disabled={!editTitle.trim()} />
          </div>
        }
      >
        <div style={{ marginBottom: 16 }}>
          <label htmlFor="editProjectTitle" style={{ display: "block", marginBottom: 4 }}>
            Titolo
          </label>
          <InputText
            id="editProjectTitle"
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            style={{ width: "100%" }}
          />
        </div>
        <div>
          <label htmlFor="editProjectDescription" style={{ display: "block", marginBottom: 4 }}>
            Descrizione
          </label>
          <InputTextarea
            id="editProjectDescription"
            value={editDescription}
            onChange={(e) => setEditDescription(e.target.value)}
            rows={3}
            style={{ width: "100%" }}
          />
        </div>
      </Dialog>

      <Dialog
        header={statusDialogMode === "note" ? "Aggiungi nota" : "Cambia stato"}
        visible={showStatusDialog}
        style={{ width: "480px" }}
        modal
        onHide={() => setShowStatusDialog(false)}
        footer={
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <Button label="Annulla" className="p-button-text" onClick={() => setShowStatusDialog(false)} disabled={savingStatus} />
            <Button label="Salva" icon="pi pi-check" onClick={handleSaveStatus} loading={savingStatus} />
          </div>
        }
      >
        {statusDialogMode === "transition" && (
          <div style={{ marginBottom: 16 }}>
            <label htmlFor="newProjectStatus" style={{ display: "block", marginBottom: 4 }}>
              Nuovo stato
            </label>
            <Dropdown
              id="newProjectStatus"
              value={newStatus}
              options={PROJECT_STATUSES.map((s) => ({ label: STATUS_LABELS[s], value: s }))}
              onChange={(e) => setNewStatus(e.value)}
              style={{ width: "100%" }}
            />
          </div>
        )}
        <div>
          <label htmlFor="statusNoteText" style={{ display: "block", marginBottom: 4 }}>
            Nota
          </label>
          <InputTextarea
            id="statusNoteText"
            value={statusNote}
            onChange={(e) => setStatusNote(e.target.value)}
            rows={3}
            style={{ width: "100%" }}
          />
        </div>
      </Dialog>
    </div>
  );
}
