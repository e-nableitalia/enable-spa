import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import ManageableRequestsPage from "./ManageableRequestsPage";
import ManageableRequestDetail from "./ManageableRequestDetail";

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

export default function ManageableRequestsWorkspace() {
  const { id } = useParams();
  const isDesktop = useIsDesktop();
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(id ?? null);
  const hasDetail = Boolean(isDesktop ? selectedRequestId : id);

  useEffect(() => {
    if (id) setSelectedRequestId(id);
  }, [id]);

  const list = useMemo(
    () => (
      <ManageableRequestsPage
        compact={isDesktop}
        onOpenRequest={isDesktop ? (requestId) => setSelectedRequestId(requestId) : undefined}
        selectedRequestId={selectedRequestId}
      />
    ),
    [isDesktop, selectedRequestId]
  );

  if (!isDesktop) {
    if (!hasDetail) return list;
    return <ManageableRequestDetail listPath="/volunteer/manageable-requests" />;
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
          <ManageableRequestDetail
            key={selectedRequestId ?? id}
            compact
            requestId={selectedRequestId ?? undefined}
            listPath="/volunteer/manageable-requests"
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
