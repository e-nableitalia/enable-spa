import { Timeline } from "primereact/timeline";

interface Props {
  events: any[];
}

export default function RequestTimeline({ events }: Props) {

  console.log("Timeline events:", events);
  return (
    <Timeline
      value={events}
      content={(item) => (
        <div>
          <strong>{item.fromStatus || "—"} → {item.toStatus}</strong>
          <p>{item.note}</p>
          {item.timestamp && typeof item.timestamp.toDate === "function" ? (
            <div style={{ fontSize: "0.9em", color: "#888" }}>
              {item.timestamp.toDate().toLocaleString()}
            </div>
          ) : null}
          {item.createdBy && (
            <div style={{ fontSize: "0.9em", color: "#888" }}>
              Autore: {item.createdBy}
            </div>
          )}
        </div>
      )}
    />
  );
}
