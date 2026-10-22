import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import AdminRequestTable from "../../../components/requests/AdminRequestTable";
import RequestDetail from "./RequestDetail";

interface Props {
  title: string;
  requests: any[];
  detailBasePath: string;
  description?: string;
  descriptionVariant?: "default" | "warning";
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

export default function AdminRequestsWorkspace({
  title,
  requests,
  detailBasePath,
  description,
  descriptionVariant = "default",
}: Props) {
  const { id } = useParams();
  const isDesktop = useIsDesktop();
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(id ?? null);
  const hasDetail = Boolean(isDesktop ? selectedRequestId : id);

  useEffect(() => {
    if (id) {
      setSelectedRequestId(id);
    }
  }, [id]);

  const list = useMemo(
    () => (
      <div style={{ padding: 20 }}>
        <h2>{title}</h2>
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
          compact={isDesktop}
          onOpenRequest={isDesktop ? (requestId) => setSelectedRequestId(requestId) : undefined}
          selectedRequestId={selectedRequestId}
        />
      </div>
    ),
    [description, descriptionVariant, detailBasePath, isDesktop, requests, selectedRequestId, title]
  );

  if (!isDesktop) {
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
            key={isDesktop ? selectedRequestId ?? id : id}
            compact
            listPath={detailBasePath}
            requestId={isDesktop ? selectedRequestId ?? undefined : undefined}
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
