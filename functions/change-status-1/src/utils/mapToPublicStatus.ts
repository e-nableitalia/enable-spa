export function mapToPublicStatus(status: string): string {
  const daGestire = [
    "inviata",
    "famiglia contattata",
    "definizione richiesta",
    "valutazione fattibilità",
    "attesa volontario"
  ];

  const fabbricazione = [
    "scelta device e dimensionamento",
    "personalizzazione",
    "attesa materiali",
    "fabbricazione",
    "pronta per spedizione",
    "spedita",
    "followup famiglia"
  ];

  if (daGestire.includes(status)) return "da gestire";
  if (fabbricazione.includes(status)) return "fabbricazione in corso";
  if (status === "completata") return "completati";
  return "annullate";
}

