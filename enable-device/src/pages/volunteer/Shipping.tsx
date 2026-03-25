import RequestTable from "../../components/requests/RequestTable";
export default function Shipping({ requests }: { requests: any[] }) {
  return (
    <div>
      <h2>Richieste di spedizione</h2>
      <RequestTable requests={requests} onOpen={() => {}} />
    </div>
  );
}
