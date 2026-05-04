import AdminRequestTable from "../../../components/requests/AdminRequestTable";

interface Props {
  requests: any[];
}

export default function AdminValidate({ requests }: Props) {
  return (
    <div style={{ padding: 20 }}>
      <h2>Richieste da validare</h2>
      <p style={{ color: "#92400e", background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: 6, padding: "10px 14px", marginBottom: 16 }}>
        Queste richieste sono state ricevute ma non ancora validate. Aprire ciascuna richiesta per completare la validazione
        e renderla visibile ai volontari.
      </p>
      <AdminRequestTable requests={requests} />
    </div>
  );
}
