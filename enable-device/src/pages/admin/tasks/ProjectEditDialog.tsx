import {useEffect, useState} from "react";
import {Dialog} from "primereact/dialog";
import {Button} from "primereact/button";
import {InputText} from "primereact/inputtext";
import {InputTextarea} from "primereact/inputtextarea";
import {Dropdown} from "primereact/dropdown";
import {Divider} from "primereact/divider";
import type {ProjectData, ProjectStatus} from "../../../shared/types/projectData";

interface VolunteerOption {
  uid: string;
  displayName: string;
}

interface ProjectDraft {
  name: string;
  description: string;
  status: ProjectStatus;
  referenceLinks: Array<{label: string; url: string}>;
  volunteers: Array<{uid: string; displayName?: string; role?: string}>;
  notes: string;
}

interface Props {
  visible: boolean;
  project: ProjectData | null;
  volunteerOptions: VolunteerOption[];
  onHide: () => void;
  onSave: (draft: ProjectDraft) => void;
  saving?: boolean;
}

const STATUS_OPTIONS: Array<{label: string; value: ProjectStatus}> = [
  {label: "Draft", value: "draft"},
  {label: "Active", value: "active"},
  {label: "Paused", value: "paused"},
  {label: "Completed", value: "completed"},
  {label: "Archived", value: "archived"},
];

export default function ProjectEditDialog({
  visible,
  project,
  volunteerOptions,
  onHide,
  onSave,
  saving,
}: Readonly<Props>) {
  const [draft, setDraft] = useState<ProjectDraft>({
    name: "",
    description: "",
    status: "draft",
    referenceLinks: [],
    volunteers: [],
    notes: "",
  });

  useEffect(() => {
    if (!project) {
      setDraft({
        name: "",
        description: "",
        status: "draft",
        referenceLinks: [],
        volunteers: [],
        notes: "",
      });
      return;
    }

    setDraft({
      name: project.name,
      description: project.description || "",
      status: project.status,
      referenceLinks: project.referenceLinks,
      volunteers: project.volunteers,
      notes: project.notes || "",
    });
  }, [project, visible]);

  const addLink = () => {
    setDraft((prev) => ({...prev, referenceLinks: [...prev.referenceLinks, {label: "", url: ""}]}));
  };

  const updateLink = (index: number, key: "label" | "url", value: string) => {
    setDraft((prev) => {
      const next = [...prev.referenceLinks];
      next[index] = {...next[index], [key]: value};
      return {...prev, referenceLinks: next};
    });
  };

  const removeLink = (index: number) => {
    setDraft((prev) => ({
      ...prev,
      referenceLinks: prev.referenceLinks.filter((_, idx) => idx !== index),
    }));
  };

  const addVolunteer = () => {
    setDraft((prev) => ({...prev, volunteers: [...prev.volunteers, {uid: "", displayName: "", role: ""}]}));
  };

  const updateVolunteer = (index: number, key: "uid" | "displayName" | "role", value: string) => {
    setDraft((prev) => {
      const next = [...prev.volunteers];
      next[index] = {...next[index], [key]: value};
      return {...prev, volunteers: next};
    });
  };

  const removeVolunteer = (index: number) => {
    setDraft((prev) => ({
      ...prev,
      volunteers: prev.volunteers.filter((_, idx) => idx !== index),
    }));
  };

  return (
    <Dialog
      header={project ? "Modifica progetto" : "Nuovo progetto"}
      visible={visible}
      onHide={onHide}
      style={{width: "90vw", maxWidth: 900}}
      modal
      footer={
        <div style={{display: "flex", justifyContent: "flex-end", gap: 8}}>
          <Button label="Annulla" className="p-button-text" onClick={onHide} />
          <Button label="Salva" onClick={() => onSave(draft)} loading={saving} disabled={!draft.name.trim()} />
        </div>
      }
    >
      <div style={{display: "grid", gap: 10}}>
        <div>
          <label>Nome</label>
          <InputText value={draft.name} onChange={(e) => setDraft({...draft, name: e.target.value})} style={{width: "100%"}} />
        </div>
        <div>
          <label>Descrizione</label>
          <InputTextarea value={draft.description} onChange={(e) => setDraft({...draft, description: e.target.value})} rows={3} style={{width: "100%"}} />
        </div>
        <div>
          <label>Stato</label>
          <Dropdown
            value={draft.status}
            options={STATUS_OPTIONS}
            optionLabel="label"
            optionValue="value"
            onChange={(e) => setDraft({...draft, status: e.value as ProjectStatus})}
            style={{width: "100%"}}
          />
        </div>

        <Divider />
        <div>
          <div style={{display: "flex", justifyContent: "space-between", alignItems: "center"}}>
            <strong>Reference links</strong>
            <Button label="Aggiungi link" className="p-button-text" icon="pi pi-plus" onClick={addLink} />
          </div>
          {draft.referenceLinks.map((link, index) => (
            <div key={`link-${index}`} style={{display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 8, marginTop: 8}}>
              <InputText value={link.label} onChange={(e) => updateLink(index, "label", e.target.value)} placeholder="Label" />
              <InputText value={link.url} onChange={(e) => updateLink(index, "url", e.target.value)} placeholder="URL" />
              <Button icon="pi pi-trash" className="p-button-text p-button-danger" onClick={() => removeLink(index)} />
            </div>
          ))}
        </div>

        <Divider />
        <div>
          <div style={{display: "flex", justifyContent: "space-between", alignItems: "center"}}>
            <strong>Volontari</strong>
            <Button label="Aggiungi volontario" className="p-button-text" icon="pi pi-plus" onClick={addVolunteer} />
          </div>
          {draft.volunteers.map((volunteer, index) => (
            <div key={`vol-${index}`} style={{display: "grid", gridTemplateColumns: "1fr 1fr 1fr auto", gap: 8, marginTop: 8}}>
              <Dropdown
                value={volunteer.uid}
                options={volunteerOptions.map((item) => ({label: item.displayName, value: item.uid}))}
                optionLabel="label"
                optionValue="value"
                onChange={(e) => {
                  const selectedUid = (e.value as string) ?? "";
                  const selected = volunteerOptions.find((item) => item.uid === selectedUid);
                  updateVolunteer(index, "uid", selectedUid);
                  updateVolunteer(index, "displayName", selected?.displayName ?? "");
                }}
                placeholder="UID"
              />
              <InputText value={volunteer.displayName || ""} onChange={(e) => updateVolunteer(index, "displayName", e.target.value)} placeholder="Display name" />
              <InputText value={volunteer.role || ""} onChange={(e) => updateVolunteer(index, "role", e.target.value)} placeholder="Ruolo nel progetto" />
              <Button icon="pi pi-trash" className="p-button-text p-button-danger" onClick={() => removeVolunteer(index)} />
            </div>
          ))}
        </div>

        <Divider />
        <div>
          <label>Note</label>
          <InputTextarea value={draft.notes} onChange={(e) => setDraft({...draft, notes: e.target.value})} rows={3} style={{width: "100%"}} />
        </div>
      </div>
    </Dialog>
  );
}
