import VolunteerRequestsWorkspace from "./VolunteerRequestsWorkspace";

export default function MyRequests({ requests }: { requests: any[] }) {
  return (
    <VolunteerRequestsWorkspace
      title="Le mie richieste"
      requests={requests}
      detailBasePath="/volunteer/my-requests"
    />
  );
}
