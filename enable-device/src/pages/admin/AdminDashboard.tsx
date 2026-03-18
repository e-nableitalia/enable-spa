import { useEffect, useState } from "react";
import { UncontrolledBoard } from "@caldwell619/react-kanban";
import "@caldwell619/react-kanban/dist/styles.css";
import "./AdminDashboard.css";

import { doc, getDoc } from "firebase/firestore";
import { Card } from "primereact/card";
import { Tag } from "primereact/tag";
import { Avatar } from "primereact/avatar";
import { db } from "../../firebase";
import { mapInternalStatusToPublic } from "../../helpers/requestStatus";

type Request = {
  id?: string;
  requestId?: string;
  firstName?: string;
  lastName?: string;
  age?: number;
  gender?: string;
  amputationType?: string;
  deviceType?: string;
  province?: string;
  publicStatus?: string;
  status?: string;
  assignedVolunteer?: string;
  description?: string;
};

type KanbanCard = {
  id: string;
  title: string;
  description?: string;
  name?: string;
  age?: number;
  gender?: string;
  publicStatus?: string;
  status?: string;
  assignedVolunteer?: string;
};

type Board = {
  columns: {
    id: string;
    title: string;
    cards: KanbanCard[];
  }[];
};

const ALL_STATUSES = [
  "da gestire",
  "fabbricazione in corso",
  "completati",
  "annullate / non completabili",
  "senza stato",
];

const COLUMN_COLORS: Record<string, string> = {
  "da gestire": "#f87171",
  "fabbricazione in corso": "#facc15",
  "completati": "#34d399",
  "annullate / non completabili": "#c084fc",
  "senza stato": "#94a3b8",
};

async function getUserFullName(userId: string): Promise<string> {
  const profileRef = doc(db, "users", userId, "private", "profile");
  const profileSnap = await getDoc(profileRef);
  if (profileSnap.exists()) {
    const data = profileSnap.data();
    const firstName = data.firstName || "";
    const lastName = data.lastName || "";
    return `${firstName} ${lastName}`.trim() || userId;
  }
  return userId;
}

async function buildBoard(requests: Request[]): Promise<Board> {
  const statusMap: Record<string, Request[]> = {};

  console.debug("Building board with requests:", requests); // Log per debug

  requests.forEach((req) => {
    // Usa requestStatus e mapInternalStatusToPublic per valutare lo stato pubblico
    const publicStatus = mapInternalStatusToPublic(req.status || "")
      ? mapInternalStatusToPublic(req.status || "")
      : req.publicStatus || "";

    const status = ALL_STATUSES.includes(publicStatus)
      ? publicStatus
      : "senza stato";

    if (!statusMap[status]) statusMap[status] = [];
    statusMap[status].push(req);
  });

  const columns = await Promise.all(
    ALL_STATUSES.map(async (status) => {
      const cards =
        statusMap[status] && statusMap[status].length > 0
          ? await Promise.all(
            statusMap[status].map(async (r) => ({
              id: r.id || r.requestId || Math.random().toString(),
              title: r.deviceType || "Richiesta",
              name: r.firstName ? `${r.firstName} ${r.lastName || ""}`.trim() : "Richiedente",
              age: r.age,
              gender: r.gender,
              description:
                r.description ||
                (r.province ? `Provincia: ${r.province}` : ""),
              publicStatus: r.publicStatus,
              status: r.status,
              assignedVolunteer: r.assignedVolunteer
                ? await getUserFullName(r.assignedVolunteer)
                : "",
            }))
          )
          : [];

      return {
        id: status,
        title: cards.length > 0 ? `${status} (${cards.length})` : status,
        cards,
      };
    })
  );

  return { columns };
}

export default function AdminDashboard({
  requests,
}: {
  requests: Request[];
}) {
  const [board, setBoard] = useState<Board | null>(null);

  useEffect(() => {
    buildBoard(requests).then(setBoard);
  }, [requests]);

  if (!board) return <div style={{ padding: 24 }}>Loading...</div>;

  return (
    <div style={{ padding: 24 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          background: "linear-gradient(90deg, #38bdf8 0%, #c084fc 100%)",
          color: "#fff",
          padding: "20px 32px",
          borderRadius: 16,
          marginBottom: 24,
          boxShadow: "0 2px 8px rgba(56,189,248,0.15)",
        }}
      >
        <Avatar
          icon="pi pi-shield"
          shape="circle"
          size="large"
          style={{ background: "#fff", color: "#38bdf8", fontSize: 24 }}
        />
        <div>
          <h2 style={{ margin: 0, fontWeight: 700, fontSize: 28 }}>
            Dashboard Amministratore
          </h2>
          <div style={{ fontSize: 16, opacity: 0.85 }}>
            Overview delle richieste e gestione del processo di abbinamento
          </div>
        </div>
      </div>

      <div style={{ overflowX: "auto" }}>
        <UncontrolledBoard
          initialBoard={board}
          renderColumnHeader={(column) => (
            <div
              style={{
                background: COLUMN_COLORS[column.id],
                color: "#fff",
                padding: "12px 16px",
                borderTopLeftRadius: 12,
                borderTopRightRadius: 12,
                fontWeight: 600,
                textTransform: "capitalize",
              }}
            >
              {column.title}
            </div>
          )}

          renderCard={(card: KanbanCard) => (
            <div style={{ padding: 8, width: "20vw", minWidth: 220, maxWidth: 320 }}>
              <Card
                style={{
                  borderRadius: 12,
                  boxShadow: "0 2px 6px rgba(0,0,0,0.08)",
                  border: "none",
                  maxWidth: "100%",
                }}
              >
                <div style={{ fontWeight: 600, marginBottom: 8 }}>
                  {card.title}
                </div>

                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    marginBottom: 8,
                  }}
                >
                  <Tag value={card.publicStatus} severity="info" />
                  <Tag value={card.status} severity="secondary" />
                </div>
                <hr style={{ margin: "12px 0", border: "none", borderTop: "1px solid #e5e7eb" }} />
                <table
                  style={{
                    width: "100%",
                    marginBottom: 8,
                    borderCollapse: "collapse",
                    background: "#f3f4f6",
                    borderRadius: 8,
                    overflow: "hidden",
                    boxShadow: "0 1px 4px rgba(0,0,0,0.04)",
                  }}
                >
                  <thead>
                    <tr style={{ background: "#b4d1f3" }}>
                      <th
                        style={{
                          textAlign: "left",
                          fontWeight: 600,
                          fontSize: 13,
                          padding: "6px 8px",
                          paddingBottom: 4,
                        }}
                      >
                        Richiedente
                      </th>
                      <th
                        style={{
                          textAlign: "left",
                          fontWeight: 600,
                          fontSize: 13,
                          padding: "6px 8px",
                          paddingBottom: 4,
                        }}
                      >
                        Età
                      </th>
                      <th
                        style={{
                          textAlign: "left",
                          fontWeight: 600,
                          fontSize: 13,
                          padding: "6px 8px",
                          paddingBottom: 4,
                        }}
                      >
                        Genere
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr
                      style={{
                        background: "#fff",
                        borderBottom: "1px solid #e5e7eb",
                        transition: "background 0.2s",
                      }}
                    >
                      <td style={{ padding: "6px 8px", paddingRight: 12 }}>
                        {card.name ? card.name.toLowerCase() : "-"}
                      </td>
                      <td style={{ padding: "6px 8px", paddingRight: 12 }}>
                        {card.age || "-"}
                      </td>
                      <td style={{ padding: "6px 8px" }}>
                        {card.gender || "-"}
                      </td>
                    </tr>
                  </tbody>
                </table>

                <div style={{ fontSize: 14, marginBottom: 12, fontStyle: "italic" }}>
                  {card.description}
                </div>

                {card.assignedVolunteer && (
                  <>
                    <hr style={{ margin: "12px 0", border: "none", borderTop: "1px solid #e5e7eb" }} />
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        fontSize: 13,
                      }}
                    >
                      <Avatar
                        label={card.assignedVolunteer[0]}
                        shape="circle"
                        size="normal"
                      />
                      {card.assignedVolunteer}
                    </div>
                  </>
                )}
              </Card>
            </div>
          )}
        />
      </div>
    </div>
  );
}
