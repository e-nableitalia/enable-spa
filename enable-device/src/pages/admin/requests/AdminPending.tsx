import AdminRequestTable from "../../../components/requests/AdminRequestTable";

export default function AdminPending({ requests }: { requests: any[] }) {
  return (
    <div style={{ padding: 20 }}>
      <h2>Richieste in attesa volontario</h2>
      <AdminRequestTable requests={requests} />
    </div>
  );
}
