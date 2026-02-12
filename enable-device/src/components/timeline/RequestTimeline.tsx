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
          {item.timestamp && typeof item.timestamp.toDate === "function" ? (
            <div>
              {item.timestamp.toDate().toLocaleString()} <strong>{item.fromStatus || "—"} → {item.toStatus}</strong>
            </div>
          ) : <strong>{item.fromStatus || "—"} → {item.toStatus}</strong>}
            {item.note != null && <p>{item.note}</p>}
        </div>
      )}
    />
  );
}
