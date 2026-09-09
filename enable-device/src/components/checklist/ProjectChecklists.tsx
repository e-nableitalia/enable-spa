import { useCallback, useRef, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { functions } from "../../firebase";
import { Button } from "primereact/button";
import { ConfirmDialog, confirmDialog } from "primereact/confirmdialog";
import { Dialog } from "primereact/dialog";
import { Dropdown } from "primereact/dropdown";
import { InputText } from "primereact/inputtext";
import { TabPanel, TabView } from "primereact/tabview";
import { Toast } from "primereact/toast";
import ProjectChecklistPanel from "./ProjectChecklistPanel";

export interface ProjectChecklistRef {
  checklistId: string;
  label: string;
}

interface AvailableTemplate {
  id: string;
  title: string;
}

interface Props {
  /** Id del progetto a cui sono collegate le checklist. */
  projectId: string;
  /** `projects/{projectId}.checklists`: una tab per elemento. */
  checklists: ProjectChecklistRef[];
  /** Categoria usata per proporre i template disponibili nel dialog di
   * creazione (`projectType` del progetto, stesso principio del
   * `devicetype` di device-requests). */
  projectType: string;
  /** Invocato dopo una creazione/eliminazione riuscita, per far ricaricare
   * al genitore il documento `projects` (nuovo array `checklists`). */
  onChecklistsChanged: () => Promise<void> | void;
  /** Mostra l'azione di eliminazione checklist, riservata all'admin. */
  isAdmin?: boolean;
  /** true quando lo stato del progetto blocca le modifiche di contenuto
   * (`standby`/`archived`/`closed`): nasconde creazione/eliminazione e
   * passa `readOnly` ai pannelli item. */
  readOnly?: boolean;
}

/**
 * Vista a tab delle checklist collegate a un progetto (EA-169/170) — stessa
 * struttura di `DeviceRequestChecklists.tsx` ma verso le Cloud Function del
 * dominio "projects", senza la funzionalità di clonazione da un'altra
 * richiesta (non richiesta per i progetti). Componente nuovo e distinto,
 * non una generalizzazione di `DeviceRequestChecklists`, per non introdurre
 * rischio sul codice già in produzione (decisione esplicita della Story
 * EA-170).
 */
export default function ProjectChecklists({
  projectId,
  checklists,
  projectType,
  onChecklistsChanged,
  isAdmin = false,
  readOnly = false,
}: Props) {
  const toast = useRef<Toast>(null);
  const [creatingChecklist, setCreatingChecklist] = useState(false);
  const [deletingChecklistId, setDeletingChecklistId] = useState<string | null>(null);
  const [titles, setTitles] = useState<Record<string, string>>({});

  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [createLabel, setCreateLabel] = useState("");
  const [createTitle, setCreateTitle] = useState("");
  const [createTemplateId, setCreateTemplateId] = useState<string | null>(null);
  const [availableTemplates, setAvailableTemplates] = useState<AvailableTemplate[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);

  const fetchAvailableTemplates = useCallback(async () => {
    setLoadingTemplates(true);
    try {
      const fn = httpsCallable<{ category: string }, { templates: AvailableTemplate[] }>(
        functions,
        "listTemplates"
      );
      const result = await fn({ category: projectType });
      setAvailableTemplates(result.data.templates ?? []);
    } catch (err) {
      toast.current?.show({
        severity: "error",
        summary: "Errore",
        detail: err instanceof Error ? err.message : "Impossibile recuperare i template disponibili.",
        life: 4000,
      });
    }
    setLoadingTemplates(false);
  }, [projectType]);

  const openCreateDialog = () => {
    setCreateLabel("");
    setCreateTitle("");
    setCreateTemplateId(null);
    setShowCreateDialog(true);
    fetchAvailableTemplates();
  };

  const handleCreateChecklist = async () => {
    setCreatingChecklist(true);
    try {
      const fn = httpsCallable<
        { projectId: string; label: string; title: string; templateId?: string },
        { checklistId: string }
      >(functions, "createProjectChecklist");
      await fn({
        projectId,
        label: createLabel.trim(),
        title: createTitle.trim() || createLabel.trim(),
        templateId: createTemplateId ?? undefined,
      });
      toast.current?.show({
        severity: "success",
        summary: "Checklist creata",
        detail: "La checklist è stata collegata al progetto.",
        life: 4000,
      });
      setShowCreateDialog(false);
      await onChecklistsChanged();
    } catch (err) {
      toast.current?.show({
        severity: "error",
        summary: "Errore",
        detail: err instanceof Error ? err.message : "Errore durante la creazione della checklist.",
        life: 5000,
      });
    }
    setCreatingChecklist(false);
  };

  const handleDeleteChecklist = (checklistId: string, label: string) => {
    confirmDialog({
      message: `Eliminare la checklist "${label}"? Verranno eliminati anche tutti i suoi item. L'operazione non è reversibile.`,
      header: "Conferma eliminazione checklist",
      icon: "pi pi-exclamation-triangle",
      acceptLabel: "Elimina",
      rejectLabel: "Annulla",
      acceptClassName: "p-button-danger",
      accept: async () => {
        setDeletingChecklistId(checklistId);
        try {
          const fn = httpsCallable(functions, "deleteProjectChecklist");
          await fn({ projectId, checklistId });
          toast.current?.show({
            severity: "success",
            summary: "Checklist eliminata",
            detail: "La checklist e i suoi item sono stati eliminati.",
            life: 3000,
          });
          await onChecklistsChanged();
        } catch (err) {
          toast.current?.show({
            severity: "error",
            summary: "Errore",
            detail: err instanceof Error ? err.message : "Errore durante l'eliminazione della checklist.",
            life: 5000,
          });
        } finally {
          setDeletingChecklistId(null);
        }
      },
    });
  };

  return (
    <div>
      <Toast ref={toast} />
      <ConfirmDialog />

      {checklists.length > 0 && (
        <TabView renderActiveOnly={false}>
          {checklists.map((c) => {
            const title = titles[c.checklistId] ?? c.label;
            return (
              <TabPanel
                key={c.checklistId}
                header={
                  <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {title}
                    {isAdmin && !readOnly && (
                      <i
                        className="pi pi-trash"
                        role="button"
                        aria-label={`Elimina checklist ${title}`}
                        title="Elimina checklist"
                        style={{
                          fontSize: 12,
                          color: "#b91c1c",
                          opacity: deletingChecklistId === c.checklistId ? 0.5 : 1,
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (deletingChecklistId) return;
                          handleDeleteChecklist(c.checklistId, title);
                        }}
                      />
                    )}
                  </span>
                }
              >
                <ProjectChecklistPanel
                  projectId={projectId}
                  checklistId={c.checklistId}
                  onTitleResolved={(resolvedTitle) =>
                    setTitles((prev) => ({ ...prev, [c.checklistId]: resolvedTitle }))
                  }
                  renderConfirmDialog={false}
                  readOnly={readOnly}
                />
              </TabPanel>
            );
          })}
        </TabView>
      )}

      {checklists.length === 0 && (
        <div style={{ color: "#888", marginBottom: 12 }}>Nessuna checklist collegata a questo progetto.</div>
      )}

      {!readOnly && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: checklists.length > 0 ? 16 : 0 }}>
          <Button label="Crea checklist" icon="pi pi-plus" onClick={openCreateDialog} />
        </div>
      )}

      <Dialog
        header="Crea checklist"
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
              disabled={creatingChecklist}
            />
            <Button
              label="Crea"
              icon="pi pi-plus"
              onClick={handleCreateChecklist}
              loading={creatingChecklist}
              disabled={!createLabel.trim()}
            />
          </div>
        }
      >
        <div style={{ marginBottom: 16 }}>
          <label htmlFor="createChecklistLabel" style={{ display: "block", marginBottom: 4 }}>
            Etichetta tab
          </label>
          <InputText
            id="createChecklistLabel"
            value={createLabel}
            onChange={(e) => setCreateLabel(e.target.value)}
            placeholder="Es. Fase 1 - Preparazione"
            style={{ width: "100%" }}
          />
        </div>
        <div style={{ marginBottom: 16 }}>
          <label htmlFor="createChecklistTitle" style={{ display: "block", marginBottom: 4 }}>
            Titolo (opzionale, di default usa l'etichetta)
          </label>
          <InputText
            id="createChecklistTitle"
            value={createTitle}
            onChange={(e) => setCreateTitle(e.target.value)}
            style={{ width: "100%" }}
          />
        </div>
        <div>
          <label htmlFor="createChecklistTemplate" style={{ display: "block", marginBottom: 4 }}>
            Template
          </label>
          <Dropdown
            id="createChecklistTemplate"
            value={createTemplateId}
            onChange={(e) => setCreateTemplateId(e.value)}
            options={[
              { label: "Nessun template (checklist vuota)", value: null },
              ...availableTemplates.map((t) => ({ label: t.title, value: t.id })),
            ]}
            optionValue="value"
            loading={loadingTemplates}
            placeholder="Seleziona un template"
            style={{ width: "100%" }}
          />
        </div>
      </Dialog>
    </div>
  );
}
