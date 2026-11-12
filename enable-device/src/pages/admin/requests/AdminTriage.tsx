import AdminRequestsWorkspace from "./AdminRequestsWorkspace";

export default function AdminTriage({ requests }: { requests: any[] }) {
  return (
    <AdminRequestsWorkspace
      title="Richieste da gestire"
      requests={requests}
      detailBasePath="/admin/requests/triage"
    />
  );
}
