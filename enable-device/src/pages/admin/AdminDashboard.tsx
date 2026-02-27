import { useEffect, useState } from "react";
import { UncontrolledBoard } from "@caldwell619/react-kanban";
import "@caldwell619/react-kanban/dist/styles.css";
import "./AdminDashboard.css";

import { doc, getDoc } from "firebase/firestore";
import { Card } from "primereact/card";
import { Tag } from "primereact/tag";
import { Avatar } from "primereact/avatar";
import { db } from "../../firebase";

type Request = {
  id?: string;
  requestId?: string;
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
  "in attesa",
  "in lavorazione",
  "completata",
  "rifiutata",
  "senza stato",
];

const COLUMN_COLORS: Record<string, string> = {
  "da gestire": "#f87171",
  "in attesa": "#facc15",
  "in lavorazione": "#34d399",
  "completata": "#38bdf8",
  "rifiutata": "#c084fc",
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

  requests.forEach((req) => {
    const status = ALL_STATUSES.includes(req.publicStatus || "")
      ? req.publicStatus!
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
        title: status,
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
          // renderColumn={(column, { children }) => (
          //   <div
          //     style={{
          //       width: 320,
          //       marginRight: 16,
          //       borderRadius: 12,
          //       display: "flex",
          //       flexDirection: "column",
          //       maxHeight: "80vh",
          //       background: "#f4f5f7", // corpo colonna Trello
          //       boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
          //     }}
          //   >
          //     {/* HEADER */}
          //     <div
          //       style={{
          //         background: COLUMN_COLORS[column.id],
          //         color: "#fff",
          //         padding: "12px 16px",
          //         borderTopLeftRadius: 12,
          //         borderTopRightRadius: 12,
          //         fontWeight: 600,
          //         textTransform: "capitalize",
          //       }}
          //     >
          //       {column.title}
          //     </div>

          //     {/* BODY */}
          //     <div
          //       style={{
          //         padding: 8,
          //         overflowY: "auto",
          //         flexGrow: 1,
          //       }}
          //     >
          //       {children}

          //       {column.cards.length === 0 && (
          //         <div
          //           style={{
          //             padding: 12,
          //             color: "#6b7280",
          //             fontStyle: "italic",
          //           }}
          //         >
          //           Nessuna richiesta
          //         </div>
          //       )}
          //     </div>
          //   </div>
          // )}

          renderCard={(card: KanbanCard) => (
            <div style={{ padding: 8, maxWidth: "25vw" }}>
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

              <div style={{ fontSize: 14, marginBottom: 12 }}>
                {card.description}
              </div>

              {card.assignedVolunteer && (
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
              )}
              </Card>
            </div>
          )}
        />
      </div>
    </div>
  );
}
