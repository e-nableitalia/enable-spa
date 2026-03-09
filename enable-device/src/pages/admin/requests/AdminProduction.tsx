import AdminRequestTable from "../../../components/requests/AdminRequestTable";

export default function AdminProduction({ requests }: { requests: any[] }) {
  return (
    <div style={{ padding: 20 }}>
      <h2>Richieste in produzione</h2>
      <AdminRequestTable requests={requests} />
    </div>
  );
}
