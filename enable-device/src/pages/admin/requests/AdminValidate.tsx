import AdminRequestsWorkspace from "./AdminRequestsWorkspace";

interface Props {
  requests: any[];
}

export default function AdminValidate({ requests }: Props) {
  return (
    <AdminRequestsWorkspace
      title="Richieste da validare"
      descriptionVariant="warning"
      description="Queste richieste sono state ricevute ma non ancora validate. Aprire ciascuna richiesta per completare la validazione e renderla visibile ai volontari."
      requests={requests}
      detailBasePath="/admin/requests/validate"
    />
  );
}
