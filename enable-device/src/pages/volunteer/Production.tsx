import VolunteerRequestsWorkspace from "./VolunteerRequestsWorkspace";
export default function Production({ requests }: { requests: any[] }) {
  return (
    <VolunteerRequestsWorkspace
      title="Richieste in produzione"
      requests={requests}
      detailBasePath="/volunteer/production"
    />
  );
}
