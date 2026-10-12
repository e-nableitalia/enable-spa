import { useEffect, useMemo, useState } from "react";
import "./AdminDashboard.css";

import { doc, getDoc } from "firebase/firestore";
import { Card } from "primereact/card";
import { Tag } from "primereact/tag";
import { Avatar } from "primereact/avatar";
import { MultiSelect } from "primereact/multiselect";
import { Button } from "primereact/button";
import { db } from "../../firebase";
import {
  PUBLIC_STATUS_GROUPS_FROM_STATUS,
  PUBLIC_STATUS_SEVERITY,
  REQUEST_STATUS_SEVERITY,
  getPublicStatusGroup,
} from "../../helpers/requestStatus";

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
  status?: string;
  assignedVolunteers?: string[];
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
  assignedVolunteers?: string;
  assignedVolunteerIds?: string[];
};

type Board = {
  columns: {
    id: string;
    title: string;
    cards: KanbanCard[];
  }[];
};

const ALL_STATUSES = Object.keys(PUBLIC_STATUS_GROUPS_FROM_STATUS);

const COLUMN_COLORS: Record<string, string> = {
  "da validare": "#60a5fa",
  "da gestire": "#f87171",
  "fabbricazione in corso": "#facc15",
  "completati": "#34d399",
  "annullate / non completabili": "#c084fc",
};

const REQUEST_STATUS_COLORS: Record<string, string> = {
  "inviata": "#93c5fd",
  "validata": "#fca5a5",
  "da gestire": "#f87171",
  "attesa volontario": "#ef4444",
  "in produzione": "#facc15",
  "pronta per spedizione": "#f59e0b",
  "spedita": "#d97706",
  "followup famiglia": "#ca8a04",
  "completata": "#34d399",
  "annullata": "#c084fc",
  "standby": "#a78bfa",
};

type VolunteerOption = { label: string; value: string };
type SubstateOption = { label: string; value: string };

async function getUserFullName(userId: string): Promise<string> {
  if (!userId || userId.includes("/")) return userId;
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

async function resolveUserDisplayNames(uids: string[]): Promise<Record<string, string>> {
  const unique = Array.from(new Set(uids.filter(Boolean)));
  const entries = await Promise.all(
    unique.map(async (uid) => [uid, await getUserFullName(uid)] as const)
  );
  return Object.fromEntries(entries);
}

function statusColor(status: string): string {
  return REQUEST_STATUS_COLORS[status] ?? "#9ca3af";
}

async function buildCards(requests: Request[]): Promise<KanbanCard[]> {
  const allAssignedVolunteerIds = requests.flatMap((req) => req.assignedVolunteers ?? []);
  const userNamesById = await resolveUserDisplayNames(allAssignedVolunteerIds);

  return requests.map((r, index) => {
    // Raggruppamento pubblico display-only, ricalcolato al volo da status.
    const safeStatus = r.status ?? "";
    const safeVolunteerIds = r.assignedVolunteers ?? [];
    const assignedVolunteers = safeVolunteerIds.map((uid) => userNamesById[uid] ?? uid).join(", ");
    const publicStatus = getPublicStatusGroup(safeStatus);
    return {
      id: r.id || r.requestId || `req-${index}`,
      title: r.deviceType || "Richiesta",
      name: r.firstName ? `${r.firstName} ${r.lastName || ""}`.trim() : "Richiedente",
      age: r.age,
      gender: r.gender,
      description: r.description || (r.province ? `Provincia: ${r.province}` : ""),
      publicStatus: ALL_STATUSES.includes(publicStatus) ? publicStatus : "da gestire",
      status: safeStatus,
      assignedVolunteerIds: safeVolunteerIds,
      assignedVolunteers,
    };
  });
}

export default function AdminDashboard({
  requests,
}: {
  requests: Request[];
}) {
  const [cards, setCards] = useState<KanbanCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [selectedPublicStatuses, setSelectedPublicStatuses] = useState<string[]>([]);
  const [selectedSubstates, setSelectedSubstates] = useState<string[]>([]);
  const [selectedVolunteerIds, setSelectedVolunteerIds] = useState<string[]>([]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    buildCards(requests)
      .then((nextCards) => {
        if (active) setCards(nextCards);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [requests]);

  const volunteerOptions = useMemo<VolunteerOption[]>(() => {
    const byId = new Map<string, string>();
    cards.forEach((card) => {
      const ids = card.assignedVolunteerIds ?? [];
      const names = (card.assignedVolunteers ?? "").split(", ").filter(Boolean);
      ids.forEach((id, idx) => {
        byId.set(id, names[idx] ?? id);
      });
    });
    return Array.from(byId.entries())
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([value, label]) => ({ value, label }));
  }, [cards]);

  const substateOptions = useMemo<SubstateOption[]>(() => {
    const states = new Set(
      cards
        .map((card) => card.status)
        .filter((status): status is string => typeof status === "string" && status.length > 0)
    );
    return Array.from(states).sort().map((value) => ({ value, label: value }));
  }, [cards]);

  const filteredCards = useMemo(() => {
    return cards.filter((card) => {
      const matchesPublicStatus =
        selectedPublicStatuses.length === 0 ||
        selectedPublicStatuses.includes(card.publicStatus || "");
      const matchesSubstate = selectedSubstates.length === 0 || selectedSubstates.includes(card.status || "");
      const matchesVolunteer =
        selectedVolunteerIds.length === 0 ||
        selectedVolunteerIds.every((uid) => (card.assignedVolunteerIds ?? []).includes(uid));
      return matchesPublicStatus && matchesSubstate && matchesVolunteer;
    });
  }, [cards, selectedPublicStatuses, selectedSubstates, selectedVolunteerIds]);

  const board = useMemo<Board>(() => {
    return {
      columns: ALL_STATUSES.map((status) => {
        const columnCards = filteredCards.filter((card) => card.publicStatus === status);
        return {
          id: status,
          title: `${status} (${columnCards.length})`,
          cards: columnCards,
        };
      }),
    };
  }, [filteredCards]);

  if (loading) return <div style={{ padding: 24 }}>Loading...</div>;

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

      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div style={{ minWidth: 220 }}>
            <label htmlFor="filter-public-status" style={{ display: "block", marginBottom: 4 }}>
              Stato pubblico
            </label>
            <MultiSelect
              id="filter-public-status"
              value={selectedPublicStatuses}
              options={ALL_STATUSES.map((s) => ({ label: s, value: s }))}
              onChange={(e) => setSelectedPublicStatuses(e.value)}
              display="chip"
              placeholder="Tutti"
              style={{ width: "100%" }}
            />
          </div>
          <div style={{ minWidth: 260 }}>
            <label htmlFor="filter-substate" style={{ display: "block", marginBottom: 4 }}>
              Substate (status interno)
            </label>
            <MultiSelect
              id="filter-substate"
              value={selectedSubstates}
              options={substateOptions}
              onChange={(e) => setSelectedSubstates(e.value)}
              display="chip"
              placeholder="Tutti"
              style={{ width: "100%" }}
            />
          </div>
          <div style={{ minWidth: 260 }}>
            <label htmlFor="filter-volunteers" style={{ display: "block", marginBottom: 4 }}>
              Volontari assegnati
            </label>
            <MultiSelect
              id="filter-volunteers"
              value={selectedVolunteerIds}
              options={volunteerOptions}
              onChange={(e) => setSelectedVolunteerIds(e.value)}
              display="chip"
              placeholder="Tutti"
              style={{ width: "100%" }}
            />
          </div>
          <Button
            type="button"
            label="Reset filtri"
            className="p-button-text"
            onClick={() => {
              setSelectedPublicStatuses([]);
              setSelectedSubstates([]);
              setSelectedVolunteerIds([]);
            }}
          />
        </div>
      </Card>

      <div style={{ overflowX: "auto" }}>
        <div style={{ display: "flex", gap: 12, minWidth: "max-content", alignItems: "flex-start" }}>
          {board.columns.map((column) => {
            const isCollapsed = collapsed[column.id] === true;
            return (
              <div key={column.id} style={{ width: 340 }}>
                <div
                  style={{
                    background: COLUMN_COLORS[column.id],
                    color: "#fff",
                    padding: "10px 12px",
                    borderTopLeftRadius: 12,
                    borderTopRightRadius: 12,
                    fontWeight: 700,
                    textTransform: "capitalize",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <span>{column.title}</span>
                  <Button
                    type="button"
                    icon={isCollapsed ? "pi pi-chevron-down" : "pi pi-chevron-up"}
                    className="p-button-rounded p-button-text p-button-sm"
                    style={{ color: "#fff" }}
                    onClick={() =>
                      setCollapsed((prev) => ({
                        ...prev,
                        [column.id]: !isCollapsed,
                      }))
                    }
                    aria-label={isCollapsed ? "Espandi colonna" : "Comprimi colonna"}
                  />
                </div>
                {!isCollapsed && (
                  <div
                    style={{
                      background: "#f8fafc",
                      borderBottomLeftRadius: 12,
                      borderBottomRightRadius: 12,
                      padding: 6,
                      minHeight: 40,
                      border: "1px solid #e2e8f0",
                      borderTop: "none",
                    }}
                  >
                    {column.cards.map((card) => (
                      <div key={card.id} style={{ padding: 6 }}>
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
                              gap: 6,
                              flexWrap: "wrap",
                            }}
                          >
                            <Tag
                              value={card.publicStatus}
                              severity={PUBLIC_STATUS_SEVERITY[card.publicStatus || "da gestire"]}
                              style={{
                                background: COLUMN_COLORS[card.publicStatus || "da gestire"],
                                borderColor: COLUMN_COLORS[card.publicStatus || "da gestire"],
                                color: "#fff",
                              }}
                            />
                            {card.status && (
                              <Tag
                                value={card.status}
                                severity={REQUEST_STATUS_SEVERITY[card.status] ?? "secondary"}
                                style={{
                                  background: statusColor(card.status),
                                  borderColor: statusColor(card.status),
                                  color: "#111827",
                                }}
                              />
                            )}
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
                      <td style={{ padding: "6px 8px", paddingRight: 12, wordBreak: "break-word", overflowWrap: "anywhere", maxWidth: 0, width: "60%" }}>
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

                <div style={{ fontSize: 14, marginBottom: 12, fontStyle: "italic", wordBreak: "break-word", overflowWrap: "anywhere" }}>
                  {card.description}
                </div>

                {card.assignedVolunteers && (
                  <>
                    <hr style={{ margin: "12px 0", border: "none", borderTop: "1px solid #e5e7eb" }} />
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        fontSize: 13,
                        minWidth: 0,
                      }}
                    >
                      <Avatar
                        label={card.assignedVolunteers[0]}
                        shape="circle"
                        size="normal"
                        style={{ flexShrink: 0 }}
                      />
                      <span style={{ wordBreak: "break-word", overflowWrap: "anywhere" }}>{card.assignedVolunteers}</span>
                    </div>
                  </>
                )}
                        </Card>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
