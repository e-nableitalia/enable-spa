import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
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

interface Props {
  scope: "admin" | "volunteer";
  canManage?: boolean;
  compact?: boolean;
  selectedProjectId?: string;
}

/**
 * Elenco amministrativo dei progetti speciali/iniziative/eventi (EA-169/170),
 * filtrabile per `projectType`. Fetch via Cloud Function `listProjects`
 * invece di un listener Firestore condiviso con `AdminLayout` (dominio
 * nuovo e distinto da device-requests, nessun bisogno di integrarsi nel suo
 * `onSnapshot` già corposo).
 */
export default function ProjectsListPage({
  scope,
  canManage = false,
  compact = false,
  selectedProjectId,
}: Props) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const toast = useRef<Toast>(null);
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [loading, setLoading] = useState(true);
  // "" = "Tutti". Il Dropdown sotto imposta sempre optionValue="value"
  // esplicito: senza, PrimeReact (Dropdown.getOptionValue) ricade
  // sull'intera opzione (invece del solo campo `value`) ogni volta che
  // quel campo è "vuoto" per ObjectUtils.isNotEmpty (null, "", ecc.) — con
  // "Tutti" selezionato il filtro confronterebbe un oggetto con una
  // stringa categoria, non trovando mai corrispondenza (tabella vuota).
  const typeFilter = searchParams.get("type") ?? "";
  const queryFilter = searchParams.get("q") ?? "";

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

  const filteredProjects = useMemo(() => {
    return projects.filter((project) => {
      const matchesType = typeFilter ? project.projectType === typeFilter : true;
      const matchesQuery = queryFilter
        ? project.title.toLowerCase().includes(queryFilter.toLowerCase())
        : true;
      return matchesType && matchesQuery;
    });
  }, [projects, queryFilter, typeFilter]);

  const listPath = `/${scope}/projects`;
  const fromPath = `${listPath}${searchParams.toString() ? `?${searchParams.toString()}` : ""}`;

  const updateSearch = (patch: { type?: string; q?: string }) => {
    const next = new URLSearchParams(searchParams);
    if (patch.type !== undefined) {
      if (patch.type) next.set("type", patch.type);
      else next.delete("type");
    }
    if (patch.q !== undefined) {
      if (patch.q) next.set("q", patch.q);
      else next.delete("q");
    }
    setSearchParams(next, { replace: true });
  };

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
      navigate(`${listPath}/${result.data.projectId}`, { state: { from: fromPath } });
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
    <div style={{ padding: compact ? 0 : 20 }}>
      <Toast ref={toast} />
      {!compact && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h2>Progetti speciali e iniziative</h2>
          {canManage && <Button label="Crea progetto" icon="pi pi-plus" onClick={openCreateDialog} />}
        </div>
      )}
      {compact && canManage && (
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
          <Button label="Crea progetto" icon="pi pi-plus" onClick={openCreateDialog} size="small" />
        </div>
      )}

      <div style={{ marginBottom: 16, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <label htmlFor="projectTypeFilter">Filtra per tipo:</label>
        <Dropdown
          id="projectTypeFilter"
          value={typeFilter}
          options={[{ label: "Tutti", value: "" }, ...availableTypes.map((t) => ({ label: t, value: t }))]}
          optionValue="value"
          onChange={(e) => updateSearch({ type: e.value })}
          style={{ minWidth: 200 }}
        />
        <label htmlFor="projectTitleFilter">Cerca titolo:</label>
        <InputText
          id="projectTitleFilter"
          value={queryFilter}
          onChange={(e) => updateSearch({ q: e.target.value })}
          placeholder="Es. Maker Faire"
          style={{ minWidth: 220 }}
        />
      </div>

      <DataTable
        value={filteredProjects}
        loading={loading}
        emptyMessage="Nessun progetto trovato."
        selectionMode="single"
        selection={filteredProjects.find((p) => p.id === selectedProjectId) ?? null}
        onSelectionChange={(e) => {
          const selected = e.value as ProjectListItem;
          if (selected) navigate(`${listPath}/${selected.id}`, { state: { from: fromPath } });
        }}
        dataKey="id"
        size={compact ? "small" : undefined}
      >
        <Column field="title" header="Titolo" body={(p: ProjectListItem) => p.title || "—"} />
        <Column field="projectType" header="Tipo" body={(p: ProjectListItem) => p.projectType || "—"} />
        <Column header="Stato" body={(p: ProjectListItem) => <Tag value={p.status || "—"} severity={statusSeverity(p.status)} />} />
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
            optionValue="value"
            onChange={(e) =>
              setNewProject((f) => ({
                ...f,
                projectType: typeof e.value === "string" ? e.value : "",
              }))
            }
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
