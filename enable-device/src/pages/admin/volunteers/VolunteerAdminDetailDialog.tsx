import { Dialog } from "primereact/dialog";
import { Panel } from "primereact/panel";
import { Divider } from "primereact/divider";
import { Tag } from "primereact/tag";
import type { VolunteerAdminRow } from "./volunteerAdminHelpers";
import {
  formatArray,
  formatBoolean,
  formatFirestoreTimestamp,
} from "./volunteerAdminHelpers";
import VolunteerPrinterSummary from "./VolunteerPrinterSummary";

interface Props {
  visible: boolean;
  volunteer: VolunteerAdminRow | null;
  onHide: () => void;
}

function boolTag(value: boolean | undefined) {
  return <Tag value={formatBoolean(value)} severity={value ? "success" : "danger"} />;
}

function chips(values: string[]) {
  if (values.length === 0) {
    return <span>-</span>;
  }

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {values.map((item) => (
        <Tag key={item} value={item} severity="info" />
      ))}
    </div>
  );
}

export default function VolunteerAdminDetailDialog({ visible, volunteer, onHide }: Props) {
  const data = volunteer?.raw;

  return (
    <Dialog
      header="Dettaglio volontario"
      visible={visible}
      onHide={onHide}
      style={{ width: "90vw", maxWidth: 1080 }}
      modal
    >
      {!volunteer || !data ? (
        <p>Nessun volontario selezionato.</p>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          <Panel header="Anagrafica e contatti">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 10 }}>
              <div><strong>Nome</strong><br />{volunteer.firstName || "-"}</div>
              <div><strong>Cognome</strong><br />{volunteer.lastName || "-"}</div>
              <div><strong>Email</strong><br />{volunteer.email || "-"}</div>
              <div><strong>Telefono</strong><br />{volunteer.phone || "-"}</div>
              <div><strong>Telegram</strong><br />{volunteer.telegramUsername || "-"}</div>
              <div><strong>Città</strong><br />{volunteer.city || "-"}</div>
              <div><strong>Regione</strong><br />{volunteer.region || "-"}</div>
              <div><strong>Ruolo</strong><br /><Tag value={volunteer.role} severity={volunteer.role === "admin" ? "warning" : "info"} /></div>
              <div><strong>Attivo</strong><br />{boolTag(volunteer.active)}</div>
            </div>
          </Panel>

          <Panel header="Disponibilità e coinvolgimento">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 10 }}>
              <div><strong>Disponibilità</strong><br />{volunteer.availability || "-"}</div>
              <div><strong>Continuità</strong><br />{volunteer.continuityType || "-"}</div>
              <div><strong>Livello coinvolgimento</strong><br />{volunteer.desiredInvolvementLevel || "-"}</div>
            </div>
          </Panel>

          <Panel header="Interessi e skills">
            <div style={{ display: "grid", gap: 8 }}>
              <div>
                <strong>Interessi principali</strong>
                <div style={{ marginTop: 4 }}>{chips(volunteer.mainInterest)}</div>
              </div>
              <Divider />
              <div>
                <strong>Aree interesse e-Nable</strong>
                <div style={{ marginTop: 4 }}>{chips(volunteer.enableInterestAreas)}</div>
              </div>
              <Divider />
              <div>
                <strong>Competenze desiderate</strong>
                <div>{volunteer.desiredSkills || "-"}</div>
              </div>
              <Divider />
              <div>
                <strong>About me</strong>
                <div>{data.skills.aboutMe || "-"}</div>
              </div>
              <Divider />
              <div>
                <strong>Preferenze contributo</strong>
                <div>{data.skills.contributionPreferences || "-"}</div>
              </div>
            </div>
          </Panel>

          <Panel header="Profilo pubblico">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 10 }}>
              <div><strong>Visibile in elenco</strong><br />{boolTag(data.publicProfile.showInVolunteerList)}</div>
              <div><strong>Email pubblica</strong><br />{data.publicProfile.publicEmail || "-"}</div>
              <div><strong>Bio</strong><br />{data.publicProfile.bio || "-"}</div>
              <div><strong>Facebook</strong><br />{data.publicProfile.facebook || "-"}</div>
              <div><strong>Instagram</strong><br />{data.publicProfile.instagram || "-"}</div>
              <div><strong>LinkedIn</strong><br />{data.publicProfile.linkedin || "-"}</div>
            </div>
          </Panel>

          <Panel header="Stampanti">
            <div style={{ marginBottom: 8, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 10 }}>
              <div><strong>Stampanti attive</strong><br />{boolTag(volunteer.hasActivePrinter)}</div>
              <div><strong>Brand</strong><br />{formatArray(volunteer.printerBrands)}</div>
              <div><strong>Modelli</strong><br />{formatArray(volunteer.printerModels)}</div>
              <div><strong>Supporto flessibili</strong><br />{boolTag(volunteer.supportsFlexible)}</div>
              <div><strong>Multi-materiale</strong><br />{boolTag(volunteer.supportsMultiMaterial)}</div>
              <div><strong>Direct drive</strong><br />{boolTag(volunteer.hasDirectDrive)}</div>
            </div>
            <VolunteerPrinterSummary printers={data.printers} />
          </Panel>

          <Panel header="Note e metadati">
            <div style={{ display: "grid", gap: 8 }}>
              <div><strong>Note aggiuntive</strong><br />{data.privateProfile.additionalNotes || "-"}</div>
              <div><strong>Come ha conosciuto e-Nable</strong><br />{data.privateProfile.howDidYouKnowEnable || "-"}</div>
              <div><strong>Skills aggiornate il</strong><br />{formatFirestoreTimestamp(data.skills.updatedAt)}</div>
              <div><strong>Profilo privato aggiornato il</strong><br />{formatFirestoreTimestamp(data.privateProfile.updatedAt)}</div>
              <div><strong>Profilo pubblico aggiornato il</strong><br />{formatFirestoreTimestamp(data.publicProfile.updatedAt)}</div>
              <div><strong>Creato il</strong><br />{formatFirestoreTimestamp(data.core.createdAt)}</div>
            </div>
          </Panel>
        </div>
      )}
    </Dialog>
  );
}
