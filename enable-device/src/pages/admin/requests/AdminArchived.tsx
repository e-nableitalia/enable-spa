import AdminRequestTable from "../../../components/requests/AdminRequestTable";

export default function AdminArchived({ requests }: { requests: any[] }) {
  return (
    <div style={{ padding: 20 }}>
      <h2>Richieste archiviate</h2>
      <p style={{ color: "#6b7280", marginTop: 0 }}>
        Sola lettura. Da dettaglio è possibile ripristinare una richiesta.
      </p>
      <AdminRequestTable requests={requests} />
    </div>
  );
}
