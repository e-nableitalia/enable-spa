import RequestTable from "../../components/requests/RequestTable";
export default function Production({ requests }: { requests: any[] }) {
  return (
    <div>
      <h2>Richieste in produzione</h2>
      <RequestTable requests={requests} onOpen={() => {}} />
    </div>
  );
}
