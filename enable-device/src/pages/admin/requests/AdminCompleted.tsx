import AdminRequestTable from "../../../components/requests/AdminRequestTable";

export default function AdminCompleted({ requests }: { requests: any[] }) {
  return (
    <div style={{ padding: 20 }}>
      <h2>Richieste completate</h2>
      <AdminRequestTable requests={requests} />
    </div>
  );
}
