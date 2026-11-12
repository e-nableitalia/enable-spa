import AdminRequestsWorkspace from "./AdminRequestsWorkspace";

export default function AdminArchived({ requests }: { requests: any[] }) {
  return (
    <AdminRequestsWorkspace
      title="Richieste archiviate"
      description="Sola lettura. Da dettaglio è possibile ripristinare una richiesta."
      requests={requests}
      detailBasePath="/admin/requests/archived"
    />
  );
}
