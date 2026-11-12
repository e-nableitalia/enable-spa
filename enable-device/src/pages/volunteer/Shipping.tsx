import VolunteerRequestsWorkspace from "./VolunteerRequestsWorkspace";
export default function Shipping({ requests }: { requests: any[] }) {
  return (
    <VolunteerRequestsWorkspace
      title="Richieste di spedizione"
      requests={requests}
      detailBasePath="/volunteer/shipping"
    />
  );
}
