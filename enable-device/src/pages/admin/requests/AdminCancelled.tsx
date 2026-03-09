import AdminRequestTable from "../../../components/requests/AdminRequestTable";

export default function AdminCancelled({ requests }: { requests: any[] }) {
  return (
    <div style={{ padding: 20 }}>
      <h2>Richieste annullate / KO</h2>
      <AdminRequestTable requests={requests} />
    </div>
  );
}
