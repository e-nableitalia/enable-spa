import AdminRequestsWorkspace from "./AdminRequestsWorkspace";

export default function AdminProduction({ requests }: { requests: any[] }) {
  return (
    <AdminRequestsWorkspace
      title="Richieste in produzione"
      requests={requests}
      detailBasePath="/admin/requests/production"
    />
  );
}
