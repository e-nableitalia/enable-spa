import type { RequestsViewMode } from "./useRequestsViewMode";

function LayoutIcon({ split }: { split: boolean }) {
  // Pittogramma: riquadro con (split) colonna lista stretta + pannello dettaglio, oppure lista a tutta larghezza
  return (
    <svg width="26" height="18" viewBox="0 0 26 18" aria-hidden="true" style={{ flexShrink: 0 }}>
      <rect x="0.75" y="0.75" width="24.5" height="16.5" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      {split ? (
        <>
          <line x1="9.5" y1="1" x2="9.5" y2="17" stroke="currentColor" strokeWidth="1.5" />
          <line x1="3" y1="5" x2="7.5" y2="5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <line x1="3" y1="9" x2="7.5" y2="9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <line x1="3" y1="13" x2="7.5" y2="13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <rect x="12" y="4" width="11" height="10" rx="1.5" fill="currentColor" opacity="0.25" />
        </>
      ) : (
        <>
          <line x1="3" y1="5" x2="23" y2="5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <line x1="3" y1="9" x2="23" y2="9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <line x1="3" y1="13" x2="23" y2="13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </>
      )}
    </svg>
  );
}

const OPTIONS: { mode: RequestsViewMode; label: string; hint: string }[] = [
  { mode: "split", label: "Lista + dettaglio", hint: "Lista a sinistra, dettaglio della richiesta a destra" },
  { mode: "list", label: "Solo lista", hint: "Lista a tutta larghezza con tutte le colonne; il dettaglio si apre in una pagina" },
];

/** Selettore della modalita' di vista: mostrare solo quando `isDesktop` e' vero. */
export default function RequestsViewModeToggle({
  mode,
  onChange,
}: {
  mode: RequestsViewMode;
  onChange: (mode: RequestsViewMode) => void;
}) {
  return (
    <div role="radiogroup" aria-label="Modalità di visualizzazione" style={{ display: "inline-flex", border: "1px solid #d1d5db", borderRadius: 8, overflow: "hidden" }}>
      {OPTIONS.map((o, i) => {
        const active = o.mode === mode;
        return (
          <button
            key={o.mode}
            type="button"
            role="radio"
            aria-checked={active}
            title={o.hint}
            onClick={() => onChange(o.mode)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 10px",
              fontSize: 13,
              cursor: "pointer",
              border: "none",
              borderLeft: i === 0 ? "none" : "1px solid #d1d5db",
              background: active ? "#e0ecff" : "#fff",
              color: active ? "#1d4ed8" : "#4b5563",
              fontWeight: active ? 600 : 400,
            }}
          >
            <LayoutIcon split={o.mode === "split"} />
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
