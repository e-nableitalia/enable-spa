import AdminRequestsWorkspace from "./AdminRequestsWorkspace";

export default function AdminCompleted({ requests }: { requests: any[] }) {
  return (
    <AdminRequestsWorkspace
      title="Richieste completate"
      requests={requests}
      detailBasePath="/admin/requests/completed"
    />
  );
}
