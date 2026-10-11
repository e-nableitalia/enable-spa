import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import ProjectsListPage from "./ProjectsListPage";
import ProjectDetail from "./ProjectDetail";

interface Props {
  scope: "admin" | "volunteer";
  canManage?: boolean;
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

/**
 * Workspace progetti condiviso tra admin e volunteer.
 * Desktop: split view lista + dettaglio affiancati.
 * Mobile/tablet: list/detail in pagine separate (route-driven).
 */
export default function ProjectsWorkspace({ scope, canManage = false }: Props) {
  const { id } = useParams();
  const isDesktop = useIsDesktop();
  const hasDetail = Boolean(id);

  const list = useMemo(
    () => (
      <ProjectsListPage
        scope={scope}
        canManage={canManage}
        compact={isDesktop && hasDetail}
        selectedProjectId={id}
      />
    ),
    [canManage, hasDetail, id, isDesktop, scope]
  );

  if (!hasDetail) return list;

  if (!isDesktop) {
    return <ProjectDetail scope={scope} canManage={canManage} />;
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "420px 1fr", gap: 16, minHeight: "100%" }}>
      <div
        style={{
          background: "#fff",
          border: "1px solid #e5e7eb",
          borderRadius: 8,
          padding: 12,
          alignSelf: "start",
          maxHeight: "100%",
          overflow: "auto",
        }}
      >
        {list}
      </div>
      <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8 }}>
        <ProjectDetail scope={scope} canManage={canManage} compact />
      </div>
    </div>
  );
}
