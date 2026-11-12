import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import AdminRequestTable from "../../../components/requests/AdminRequestTable";
import RequestDetail from "./RequestDetail";
import { useRequestsViewMode } from "../../../components/requests/useRequestsViewMode";
import RequestsViewModeToggle from "../../../components/requests/RequestsViewModeToggle";

interface Props {
  title: string;
  requests: any[];
  detailBasePath: string;
  description?: string;
  descriptionVariant?: "default" | "warning";
}

export default function AdminRequestsWorkspace({
  title,
  requests,
  detailBasePath,
  description,
  descriptionVariant = "default",
}: Props) {
  const { id } = useParams();
  const { isDesktop, viewMode, setViewMode, splitView } = useRequestsViewMode();
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(id ?? null);
  const hasDetail = Boolean(splitView ? selectedRequestId : id);

  useEffect(() => {
    if (id) {
      setSelectedRequestId(id);
    }
  }, [id]);

  const list = useMemo(
    () => (
      <div style={{ padding: 20 }}>
        <h2 style={{ margin: "0 0 8px" }}>{title}</h2>
        {isDesktop && (
          <div style={{ marginBottom: 12 }}>
            <RequestsViewModeToggle mode={viewMode} onChange={setViewMode} />
          </div>
        )}
        {description && (
          <p
            style={{
              color: descriptionVariant === "warning" ? "#92400e" : "#6b7280",
              background: descriptionVariant === "warning" ? "#fffbeb" : undefined,
              border: descriptionVariant === "warning" ? "1px solid #fcd34d" : undefined,
              borderRadius: descriptionVariant === "warning" ? 6 : undefined,
              padding: descriptionVariant === "warning" ? "10px 14px" : undefined,
              marginBottom: 16,
              marginTop: 0,
            }}
          >
            {description}
          </p>
        )}
        <AdminRequestTable
          requests={requests}
          detailBasePath={detailBasePath}
          compact={splitView}
          onOpenRequest={splitView ? (requestId) => setSelectedRequestId(requestId) : undefined}
          selectedRequestId={selectedRequestId}
        />
      </div>
    ),
    [description, descriptionVariant, detailBasePath, isDesktop, requests, selectedRequestId, setViewMode, splitView, title, viewMode]
  );

  if (!splitView) {
    if (!hasDetail) return list;
    return <RequestDetail listPath={detailBasePath} />;
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
          <RequestDetail
            key={selectedRequestId ?? id}
            compact
            listPath={detailBasePath}
            requestId={selectedRequestId ?? undefined}
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
