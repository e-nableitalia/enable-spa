import RequestTable from "../../components/requests/RequestTable";

export default function MyRequests({ requests }: { requests: any[] }) {
  return (
    <div>
      <h2>Le mie richieste</h2>
      <RequestTable requests={requests} onOpen={() => {}} />
    </div>
  );
}
