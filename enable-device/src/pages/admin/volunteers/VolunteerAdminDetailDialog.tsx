import { Dialog } from "primereact/dialog";
import type { VolunteerAdminRow } from "./volunteerAdminHelpers";
import VolunteerAdminDetailContent from "./VolunteerAdminDetailContent";

interface Props {
  visible: boolean;
  volunteer: VolunteerAdminRow | null;
  onHide: () => void;
}

export default function VolunteerAdminDetailDialog({ visible, volunteer, onHide }: Props) {
  return (
    <Dialog
      header="Dettaglio volontario"
      visible={visible}
      onHide={onHide}
      style={{ width: "90vw", maxWidth: 1080 }}
      modal
    >
      <VolunteerAdminDetailContent volunteer={volunteer} />
    </Dialog>
  );
}
