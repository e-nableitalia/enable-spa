export function mapToPublicStatus(status: string): string {
  const daValidare = [
    "inviata"
  ];

  const daGestire = [
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
    "fitting",
    "pronta per spedizione",
    "spedita",
    "followup famiglia"
  ];

  const annullate = [
    "followup famiglia ko",
    "followup famiglia troppo piccolo",
    "annullata",
    "standby"
  ];

  if (daValidare.includes(status)) return "da validare";
  if (daGestire.includes(status)) return "da gestire";
  if (fabbricazione.includes(status)) return "fabbricazione in corso";
  if (status === "completata") return "completati";
  if (annullate.includes(status)) return "annullate / non completabili";
  return "da gestire";
}

