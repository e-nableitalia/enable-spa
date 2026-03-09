import AdminRequestTable from "../../../components/requests/AdminRequestTable";

export default function AdminTriage({ requests }: { requests: any[] }) {
  return (
    <div style={{ padding: 20 }}>
      <h2>Richieste da gestire</h2>
      <AdminRequestTable requests={requests} />
    </div>
  );
}
