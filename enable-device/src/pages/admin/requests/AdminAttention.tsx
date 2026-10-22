import AdminRequestsWorkspace from "./AdminRequestsWorkspace";

export default function AdminAttention({ requests }: { requests: any[] }) {
  return (
    <AdminRequestsWorkspace
      title="⚠️ Richieste che richiedono attenzione"
      requests={requests}
      detailBasePath="/admin/requests/attention"
    />
  );
}
