import AdminRequestsWorkspace from "./AdminRequestsWorkspace";

export default function AdminShipping({ requests }: { requests: any[] }) {
  return (
    <AdminRequestsWorkspace
      title="Richieste spedizioni"
      requests={requests}
      detailBasePath="/admin/requests/shipping"
    />
  );
}
