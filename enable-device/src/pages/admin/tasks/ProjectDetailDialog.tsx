import {Dialog} from "primereact/dialog";
import {Panel} from "primereact/panel";
import type {ProjectData} from "../../../shared/types/projectData";
import {asDateString} from "./taskHelpers";

interface Props {
  project: ProjectData | null;
  visible: boolean;
  onHide: () => void;
}

export default function ProjectDetailDialog({project, visible, onHide}: Readonly<Props>) {
  return (
    <Dialog header="Dettaglio progetto" visible={visible} onHide={onHide} style={{width: "90vw", maxWidth: 900}} modal>
      {!project ? (
        <div>Nessun progetto selezionato.</div>
      ) : (
        <div style={{display: "grid", gap: 10}}>
          <Panel header="Informazioni">
            <div><strong>Nome:</strong> {project.name}</div>
            <div><strong>Descrizione:</strong> {project.description || "-"}</div>
            <div><strong>Stato:</strong> {project.status}</div>
            <div><strong>Note:</strong> {project.notes || "-"}</div>
          </Panel>
          <Panel header="Riferimenti">
            {project.referenceLinks.length === 0 ? "Nessun riferimento" : (
              <ul>
                {project.referenceLinks.map((link, index) => (
                  <li key={`${link.url}-${index}`}>
                    <a href={link.url} target="_blank" rel="noreferrer">{link.label}</a>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel header="Volontari">
            {project.volunteers.length === 0 ? "Nessun volontario" : (
              <ul>
                {project.volunteers.map((volunteer) => (
                  <li key={volunteer.uid}>{volunteer.displayName || volunteer.uid}{volunteer.role ? ` (${volunteer.role})` : ""}</li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel header="Date">
            <div><strong>Creato:</strong> {asDateString(project.createdAt)}</div>
            <div><strong>Aggiornato:</strong> {asDateString(project.updatedAt)}</div>
          </Panel>
        </div>
      )}
    </Dialog>
  );
}
