import AdminRequestsWorkspace from "./AdminRequestsWorkspace";

export default function AdminCancelled({ requests }: { requests: any[] }) {
  return (
    <AdminRequestsWorkspace
      title="Richieste annullate / KO"
      requests={requests}
      detailBasePath="/admin/requests/cancelled"
    />
  );
}
