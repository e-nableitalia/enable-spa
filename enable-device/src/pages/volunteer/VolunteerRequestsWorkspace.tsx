import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import RequestTable from "../../components/requests/RequestTable";
import VolunteerRequestDetail from "./VolunteerRequestDetail";

interface Props {
  title: string;
  requests: any[];
  detailBasePath: string;
  description?: string;
}

function useIsDesktop(minWidth = 1200): boolean {
  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth >= minWidth : false
  );

  useEffect(() => {
    const onResize = () => setIsDesktop(window.innerWidth >= minWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [minWidth]);

  return isDesktop;
}

export default function VolunteerRequestsWorkspace({
  title,
  requests,
  detailBasePath,
  description,
}: Props) {
  const navigate = useNavigate();
  const { id } = useParams();
  const isDesktop = useIsDesktop();
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(id ?? null);
  const hasDetail = Boolean(isDesktop ? selectedRequestId : id);

  useEffect(() => {
    if (id) setSelectedRequestId(id);
  }, [id]);

  const list = useMemo(
    () => (
      <div style={{ padding: 20 }}>
        <h2>{title} ({requests.length})</h2>
        {description && <p style={{ color: "#6b7280", marginTop: 0 }}>{description}</p>}
        <RequestTable
          requests={requests}
          onOpen={(requestId) =>
            isDesktop ? setSelectedRequestId(requestId) : navigate(`${detailBasePath}/${requestId}`)
          }
          sessionKey={`volunteerRequestsTable:${detailBasePath}`}
          compact={isDesktop}
          selectedRequestId={selectedRequestId}
        />
      </div>
    ),
    [description, detailBasePath, isDesktop, navigate, requests, selectedRequestId, title]
  );

  if (!isDesktop) {
    if (!hasDetail) return list;
    return <VolunteerRequestDetail listPath={detailBasePath} />;
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "500px 1fr", gap: 16, minHeight: "100%" }}>
      <div
        style={{
          background: "#fff",
          border: "1px solid #e5e7eb",
          borderRadius: 8,
          alignSelf: "start",
          maxHeight: "100%",
          overflow: "auto",
        }}
      >
        {list}
      </div>
      <div
        style={{
          background: "#fff",
          border: "1px solid #e5e7eb",
          borderRadius: 8,
          maxHeight: "100%",
          overflow: "auto",
        }}
      >
        {hasDetail ? (
          <VolunteerRequestDetail
            key={selectedRequestId ?? id}
            compact
            requestId={selectedRequestId ?? undefined}
            listPath={detailBasePath}
          />
        ) : (
          <div style={{ padding: 24, color: "#6b7280" }}>
            Seleziona una richiesta dalla lista a sinistra per aprire il dettaglio.
          </div>
        )}
      </div>
    </div>
  );
}
