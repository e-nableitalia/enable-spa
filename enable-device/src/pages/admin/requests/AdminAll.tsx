import AdminRequestsWorkspace from "./AdminRequestsWorkspace";

export default function AdminAll({ requests }: { requests: any[] }) {
  return (
    <AdminRequestsWorkspace
      title="Tutte le richieste"
      requests={requests}
      detailBasePath="/admin/requests"
    />
  );
}
