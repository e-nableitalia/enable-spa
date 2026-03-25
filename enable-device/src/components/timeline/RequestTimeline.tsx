import { Timeline } from "primereact/timeline";

interface Props {
  events: any[];
}

export default function RequestTimeline({ events }: Props) {

  return (
    <Timeline
      value={events}
      opposite={(item) => {
        if (item.type === "assign_volunteer") {
            return <strong>Assegnazione volontario</strong>;
        } else if (item.fromStatus === item.toStatus) {
            return <strong>Aggiornamento / Nota</strong>;
        }
        return <strong>{item.fromStatus || "—"} → {item.toStatus || "—"}</strong>;
      }}
      content={(item) => (
        <div>
          {(item.userName || item.createdBy) && item.timestamp && typeof item.timestamp.toDate === "function" && (
            <div style={{ fontSize: "0.9em", color: "#888" }}>
              {item.userName || item.createdBy} @ {item.timestamp.toDate().toLocaleString()}
            </div>
          )}
          <p>{item.note}</p>
        </div>
      )}
    />
  );
}
