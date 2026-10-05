import { useNavigate } from "react-router-dom";
import RequestTable from "../../components/requests/RequestTable";

export default function Archive({ requests }: { requests: any[] }) {
  const navigate = useNavigate();
  return (
    <div>
      <h2>Archiviate</h2>
      <p style={{ color: "#6b7280", marginTop: 0 }}>
        Sola lettura. Le richieste archiviate non sono modificabili dal volontario.
      </p>
      <RequestTable
        requests={requests}
        onOpen={(id) => navigate(`/volunteer/my-requests/${id}`)}
      />
    </div>
  );
}
