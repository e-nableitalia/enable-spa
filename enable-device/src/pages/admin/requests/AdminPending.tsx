import AdminRequestsWorkspace from "./AdminRequestsWorkspace";

export default function AdminPending({ requests }: { requests: any[] }) {
  return (
    <AdminRequestsWorkspace
      title="Richieste in attesa volontario"
      requests={requests}
      detailBasePath="/admin/requests/pending"
    />
  );
}
