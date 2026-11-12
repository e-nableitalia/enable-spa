import VolunteerRequestsWorkspace from "./VolunteerRequestsWorkspace";

export default function Archive({ requests }: { requests: any[] }) {
  return (
    <VolunteerRequestsWorkspace
      title="Archiviate"
      requests={requests}
      detailBasePath="/volunteer/archive"
      description="Sola lettura. Le richieste archiviate non sono modificabili dal volontario."
    />
  );
}
