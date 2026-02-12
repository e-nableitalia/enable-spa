import { useNavigate } from "react-router-dom";
import RequestTable from "../../components/requests/RequestTable";

export default function AdminTriage({ requests }: { requests: any[] }) {
  const navigate = useNavigate();
  return (
    <div style={{ padding: 20 }}>
      <h2>Richieste da gestire</h2>
      <RequestTable
        requests={requests}
        onOpen={(id) => navigate(`/admin/request/${id}`)}
      />
    </div>
  );
}
