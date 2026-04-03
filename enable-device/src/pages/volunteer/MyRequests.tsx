import { useNavigate } from "react-router-dom";
import RequestTable from "../../components/requests/RequestTable";

export default function MyRequests({ requests }: { requests: any[] }) {
  const navigate = useNavigate();
  return (
    <div>
      <h2>Le mie richieste</h2>
      <RequestTable requests={requests} onOpen={(id) => navigate(`/volunteer/my-requests/${id}`)} />
    </div>
  );
}
