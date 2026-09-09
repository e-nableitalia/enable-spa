import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { httpsCallable } from "firebase/functions";
import { functions } from "../../../firebase";
import { Button } from "primereact/button";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Dialog } from "primereact/dialog";
import { Dropdown } from "primereact/dropdown";
import { InputText } from "primereact/inputtext";
import { InputTextarea } from "primereact/inputtextarea";
import { Tag } from "primereact/tag";
import { Toast } from "primereact/toast";

const DEFAULT_PROJECT_TYPES = ["progetto", "iniziativa", "evento"];

interface ProjectListItem {
  id: string;
  title: string;
  projectType: string;
  status: string;
  createdBy: string;
}

interface NewProjectForm {
  title: string;
  description: string;
  projectType: string;
}

const EMPTY_NEW_PROJECT: NewProjectForm = { title: "", description: "", projectType: "" };

/**
 * Elenco amministrativo dei progetti speciali/iniziative/eventi (EA-169/170),
 * filtrabile per `projectType`. Fetch via Cloud Function `listProjects`
 * invece di un listener Firestore condiviso con `AdminLayout` (dominio
 * nuovo e distinto da device-requests, nessun bisogno di integrarsi nel suo
 * `onSnapshot` già corposo).
 */
export default function ProjectsListPage() {
  const navigate = useNavigate();
  const toast = useRef<Toast>(null);
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [loading, setLoading] = useState(true);
  // "" = "Tutti". Il Dropdown sotto imposta sempre optionValue="value"
  // esplicito: senza, PrimeReact (Dropdown.getOptionValue) ricade
  // sull'intera opzione (invece del solo campo `value`) ogni volta che
  // quel campo è "vuoto" per ObjectUtils.isNotEmpty (null, "", ecc.) — con
  // "Tutti" selezionato il filtro confronterebbe un oggetto con una
  // stringa categoria, non trovando mai corrispondenza (tabella vuota).
  const [typeFilter, setTypeFilter] = useState<string>("");

  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newProject, setNewProject] = useState<NewProjectForm>(EMPTY_NEW_PROJECT);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const fn = httpsCallable<Record<string, never>, { projects: ProjectListItem[] }>(functions, "listProjects");
      const result = await fn({});
      setProjects(result.data.projects ?? []);
    } catch (err) {
      toast.current?.show({
        severity: "error",
        summary: "Errore",
        detail: err instanceof Error ? err.message : "Impossibile recuperare l'elenco progetti.",
        life: 4000,
      });
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load fetches from a Cloud Function, not derivable from props/state
    load();
  }, [load]);

  const availableTypes = useMemo(() => {
    const fromData = projects.map((p) => p.projectType).filter(Boolean);
    return Array.from(new Set([...DEFAULT_PROJECT_TYPES, ...fromData]));
  }, [projects]);

  const filteredProjects = typeFilter ? projects.filter((p) => p.projectType === typeFilter) : projects;

  const openCreateDialog = () => {
    setNewProject(EMPTY_NEW_PROJECT);
    setShowCreateDialog(true);
  };

  const handleCreate = async () => {
    setCreating(true);
    try {
      const fn = httpsCallable<NewProjectForm, { projectId: string }>(functions, "createProject");
      const result = await fn({
        title: newProject.title.trim(),
        description: newProject.description.trim(),
        projectType: newProject.projectType.trim(),
      });
      toast.current?.show({ severity: "success", summary: "Progetto creato", life: 3000 });
      setShowCreateDialog(false);
      await load();
      navigate(`/admin/project/${result.data.projectId}`);
    } catch (err) {
      toast.current?.show({
        severity: "error",
        summary: "Errore",
        detail: err instanceof Error ? err.message : "Errore durante la creazione del progetto.",
        life: 5000,
      });
    }
    setCreating(false);
  };

  const statusSeverity = (status: string): "success" | "warning" | "danger" | "info" => {
    if (status === "active") return "success";
    if (status === "standby") return "warning";
    if (status === "archived" || status === "closed") return "danger";
    return "info";
  };

  return (
    <div style={{ padding: 20 }}>
      <Toast ref={toast} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h2>Progetti speciali e iniziative</h2>
        <Button label="Crea progetto" icon="pi pi-plus" onClick={openCreateDialog} />
      </div>

      <div style={{ marginBottom: 16, display: "flex", alignItems: "center", gap: 8 }}>
        <label htmlFor="projectTypeFilter">Filtra per tipo:</label>
        <Dropdown
          id="projectTypeFilter"
          value={typeFilter}
          options={[{ label: "Tutti", value: "" }, ...availableTypes.map((t) => ({ label: t, value: t }))]}
          optionValue="value"
          onChange={(e) => setTypeFilter(e.value)}
          style={{ minWidth: 200 }}
        />
      </div>

      <DataTable
        value={filteredProjects}
        loading={loading}
        emptyMessage="Nessun progetto trovato."
        selectionMode="single"
        onSelectionChange={(e) => {
          const selected = e.value as ProjectListItem;
          if (selected) navigate(`/admin/project/${selected.id}`);
        }}
        dataKey="id"
      >
        <Column field="title" header="Titolo" />
        <Column field="projectType" header="Tipo" />
        <Column header="Stato" body={(p: ProjectListItem) => <Tag value={p.status} severity={statusSeverity(p.status)} />} />
      </DataTable>

      <Dialog
        header="Crea progetto"
        visible={showCreateDialog}
        style={{ width: "480px" }}
        modal
        onHide={() => setShowCreateDialog(false)}
        footer={
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <Button
              label="Annulla"
              className="p-button-text"
              onClick={() => setShowCreateDialog(false)}
              disabled={creating}
            />
            <Button
              label="Crea"
              icon="pi pi-plus"
              onClick={handleCreate}
              loading={creating}
              disabled={!newProject.title.trim() || !newProject.projectType.trim()}
            />
          </div>
        }
      >
        <div style={{ marginBottom: 16 }}>
          <label htmlFor="newProjectTitle" style={{ display: "block", marginBottom: 4 }}>
            Titolo
          </label>
          <InputText
            id="newProjectTitle"
            value={newProject.title}
            onChange={(e) => setNewProject((f) => ({ ...f, title: e.target.value }))}
            style={{ width: "100%" }}
          />
        </div>
        <div style={{ marginBottom: 16 }}>
          <label htmlFor="newProjectType" style={{ display: "block", marginBottom: 4 }}>
            Tipo (progetto/iniziativa/evento, o un nuovo tipo)
          </label>
          <Dropdown
            id="newProjectType"
            value={newProject.projectType || null}
            options={DEFAULT_PROJECT_TYPES.map((t) => ({ label: t, value: t }))}
            onChange={(e) => setNewProject((f) => ({ ...f, projectType: e.value }))}
            editable
            placeholder="Seleziona o digita un tipo"
            style={{ width: "100%" }}
          />
        </div>
        <div>
          <label htmlFor="newProjectDescription" style={{ display: "block", marginBottom: 4 }}>
            Descrizione
          </label>
          <InputTextarea
            id="newProjectDescription"
            value={newProject.description}
            onChange={(e) => setNewProject((f) => ({ ...f, description: e.target.value }))}
            rows={3}
            style={{ width: "100%" }}
          />
        </div>
      </Dialog>
    </div>
  );
}
