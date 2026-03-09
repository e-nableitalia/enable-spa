import AdminRequestTable from "../../../components/requests/AdminRequestTable";

export default function AdminShipping({ requests }: { requests: any[] }) {
  return (
    <div style={{ padding: 20 }}>
      <h2>Richieste spedizioni</h2>
      <AdminRequestTable requests={requests} />
    </div>
  );
}
