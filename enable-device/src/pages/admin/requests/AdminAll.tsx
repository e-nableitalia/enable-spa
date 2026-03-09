import AdminRequestTable from "../../../components/requests/AdminRequestTable";

export default function AdminAll({ requests }: { requests: any[] }) {
  return (
    <div style={{ padding: 20 }}>
      <h2>Tutte le richieste</h2>
      <AdminRequestTable requests={requests} />
    </div>
  );
}
