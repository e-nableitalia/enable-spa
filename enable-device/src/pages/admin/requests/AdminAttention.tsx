import AdminRequestTable from "../../../components/requests/AdminRequestTable";

export default function AdminAttention({ requests }: { requests: any[] }) {
  return (
    <div style={{ padding: 20 }}>
      <h2>⚠️ Richieste che richiedono attenzione</h2>
      <AdminRequestTable requests={requests} />
    </div>
  );
}
