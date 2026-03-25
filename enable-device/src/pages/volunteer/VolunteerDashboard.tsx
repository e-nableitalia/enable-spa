import { useEffect, useState } from "react";
import { getDoc, doc, getDocs, setDoc, updateDoc, collection, query, where, serverTimestamp } from "firebase/firestore";
import { auth, db } from "../../firebase";
import type { VolunteerPrivateProfile, VolunteerSkills, VolunteerPublicProfile } from "../../shared/types/volunteerData";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Chart } from "primereact/chart";
import { Card } from "primereact/card";
import { type MessagesMessage } from "primereact/messages";
import { Tag } from "primereact/tag";
import { Button } from "primereact/button";
import { Divider } from "primereact/divider";
import { Panel } from "primereact/panel";
import { Badge } from "primereact/badge";
import type { GlobalMessage, PersonalMessage, EnrichedMessage } from "../../shared/types/messageData";
import { REQUEST_STATUS_SEVERITY, CLOSED_STATUSES } from "../../helpers/requestStatus";

// ---- Helpers ----

function toDate(val: unknown): Date | null {
  if (!val) return null;
  if (typeof (val as Record<string, unknown>)?.toDate === "function")
    return (val as { toDate: () => Date }).toDate();
  if (
    typeof val === "object" &&
    typeof (val as Record<string, unknown>).seconds === "number"
  )
    return new Date(((val as Record<string, unknown>).seconds as number) * 1000);
  const d = new Date(val as string | number);
  return isNaN(d.getTime()) ? null : d;
}

function formatMsgDate(val: unknown): string {
  const d = toDate(val);
  if (!d) return "";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${yyyy} ${hh}:${min}`;
}

const SYSTEM_MSG_STYLES: Record<string, { bg: string; border: string; icon: string; color: string }> = {
  info:    { bg: "#e8f4ff", border: "#b3d4f5", icon: "pi-info-circle",         color: "#084298" },
  success: { bg: "#f0faf0", border: "#a3d9a5", icon: "pi-check-circle",        color: "#155724" },
  warn:    { bg: "#fffbe6", border: "#ffe58f", icon: "pi-exclamation-triangle", color: "#664d03" },
  error:   { bg: "#fff1f0", border: "#ffccc7", icon: "pi-times-circle",         color: "#721c24" },
};

export default function VolunteerDashboard() {
  const [privateProfile, setPrivateProfile] = useState<VolunteerPrivateProfile | null>(null);
  const [skills, setSkills] = useState<VolunteerSkills | null>(null);
  const [publicProfile, setPublicProfile] = useState<VolunteerPublicProfile | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(true);

  const [publicRequests, setPublicRequests] = useState<any[]>([]);
  const [privateRequests, setPrivateRequests] = useState<any[]>([]);
  const [loadingRequests, setLoadingRequests] = useState(true);

  const [globalMessages, setGlobalMessages] = useState<GlobalMessage[]>([]);
  const [personalMessages, setPersonalMessages] = useState<PersonalMessage[]>([]);
  const [messageStatusMap, setMessageStatusMap] = useState<Record<string, boolean>>({});
  const [loadingMessages, setLoadingMessages] = useState(true);
  const [hideRead, setHideRead] = useState(true);

  useEffect(() => {
    const fetchProfile = async () => {
      const user = auth.currentUser;
      if (!user) return;
      const privateProfileSnap = await getDoc(doc(db, `users/${user.uid}/private/profile`));
      const skillsSnap = await getDoc(doc(db, `users/${user.uid}/private/skills`));
      const publicProfileSnap = await getDoc(doc(db, `users/${user.uid}/public/profile`));
      setPrivateProfile(privateProfileSnap.exists() ? privateProfileSnap.data() as VolunteerPrivateProfile : null);
      setSkills(skillsSnap.exists() ? skillsSnap.data() as VolunteerSkills : null);
      setPublicProfile(publicProfileSnap.exists() ? publicProfileSnap.data() as VolunteerPublicProfile : null);
      setLoadingProfile(false);
    };
    fetchProfile();
  }, []);

  useEffect(() => {
    const fetchRequests = async () => {
      // Public requests
      const publicReqSnap = await getDocs(collection(db, "publicDeviceRequests"));
      setPublicRequests(publicReqSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      // Private requests for current user
      const user = auth.currentUser;
      if (user) {
        const q = query(
          collection(db, "deviceRequests"),
          where("assignedVolunteers", "array-contains", user.uid)
        );
        const privateReqSnap = await getDocs(q);
        const enriched = await Promise.all(
          privateReqSnap.docs.map(async (d) => {
            const base = { id: d.id, ...d.data() };
            const privSnap = await getDoc(doc(db, "deviceRequests", d.id, "private", "data"));
            const priv = privSnap.exists() ? privSnap.data() : {};
            return { ...base, ...priv };
          })
        );
        setPrivateRequests(enriched);
      }
      setLoadingRequests(false);
    };
    fetchRequests();
  }, []);

  useEffect(() => {
    const fetchMessages = async () => {
      const user = auth.currentUser;
      if (!user) { setLoadingMessages(false); return; }
      try {
        const now = new Date();
        const globalSnap = await getDocs(
          query(collection(db, "messages"), where("active", "==", true))
        );
        const globals = globalSnap.docs
          .map((d) => ({ id: d.id, ...d.data() } as GlobalMessage))
          .filter((m) => {
            if (m.target !== "all" && m.target !== "volunteer") return false;
            if (m.expiresAt) {
              const exp = toDate(m.expiresAt);
              if (exp && exp < now) return false;
            }
            return true;
          });
        setGlobalMessages(globals);
        const statusSnap = await getDocs(collection(db, `users/${user.uid}/messageStatus`));
        const statusMap: Record<string, boolean> = {};
        statusSnap.docs.forEach((d) => {
          statusMap[d.id] = (d.data() as { read: boolean }).read ?? false;
        });
        setMessageStatusMap(statusMap);
        const personalSnap = await getDocs(collection(db, `users/${user.uid}/messages`));
        setPersonalMessages(
          personalSnap.docs.map((d) => ({ id: d.id, ...d.data() } as PersonalMessage))
        );
      } catch (err) {
        console.error("[VolunteerDashboard] Failed to load messages", err);
      } finally {
        setLoadingMessages(false);
      }
    };
    fetchMessages();
  }, []);

  // Riepilogo: individua le sezioni non compilate
  const missingSections: string[] = [];
  if (!loadingProfile) {
    if (!privateProfile || Object.values(privateProfile).every(v => v === "" || v === false)) {
      missingSections.push("Informazioni personali");
    }
    if (!skills || Object.values(skills).every(v => Array.isArray(v) ? v.length === 0 : v === "")) {
      missingSections.push("Competenze e interessi");
    }
    if (!publicProfile || Object.values(publicProfile).every(v => v === "" || v === false)) {
      missingSections.push("Profilo pubblico");
    }
    if (!privateProfile?.availability) {
      missingSections.push("Disponibilità e coinvolgimento / Tempo dedicato");
    }
    if (!privateProfile?.continuityType) {
      missingSections.push("Disponibilità e coinvolgimento / Tipo di impegno");
    }
    if (!privateProfile?.desiredInvolvementLevel) {
      missingSections.push("Disponibilità e coinvolgimento / Livello di coinvolgimento");
    }
  }

  // Pie chart: conteggio richieste per stato
  const requestStatusCount = publicRequests.reduce((acc, req) => {
    acc[req.publicStatus] = (acc[req.publicStatus] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  const chartData = {
    labels: Object.keys(requestStatusCount),
    datasets: [
      {
        data: Object.values(requestStatusCount),
        backgroundColor: ["#42A5F5", "#66BB6A", "#FFA726", "#EF5350", "#AB47BC"],
      },
    ],
  };

  const user = auth.currentUser;

  const myPrivateRequests = user
    ? privateRequests.filter(req => req.assignedVolunteers?.includes(user.uid))
    : [];


  const privateRequestStatusCount = myPrivateRequests.reduce((acc, req) => {
    acc[req.status] = (acc[req.status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  const privateChartData = {
    labels: Object.keys(privateRequestStatusCount),
    datasets: [
      {
        data: Object.values(privateRequestStatusCount),
        backgroundColor: ["#42A5F5", "#66BB6A", "#FFA726", "#EF5350", "#AB47BC"],
      },
    ],
  };

  // Banner: richieste private da gestire
  const openPrivateRequests = myPrivateRequests.filter(
    (r) => !CLOSED_STATUSES.includes(r.status)
  );

  // Filtra le richieste pubbliche "da gestire" (ad esempio, status "open" o "in_progress")
  const manageableStatuses = ["da gestire"];
  const manageablePublicRequests = publicRequests.filter(
    req => manageableStatuses.includes(req.publicStatus)
  );

  const messages: Array<MessagesMessage> = [];

  // Messaggi per sezioni mancanti
  missingSections.forEach(section => {
    messages.push({
      id: `missing-${section}`,
      sticky: true,
      severity: "info",
      summary: "Sezione incompleta:",
      detail: `Completa la sezione "${section}" per completare il tuo profilo.`,
      closable: false,
    });
  });

  if (myPrivateRequests.length === 0) {
    messages.push({
      id: "no-private-requests",
      sticky: true,
      severity: "success",
      summary: "Nessuna richiesta:",
      detail: "Non ci sono richieste di device da gestire.",
      closable: false,
    });
  } else {
    messages.push({
      id: "private-requests-count",
      sticky: true,
      severity: openPrivateRequests.length > 0 ? "warn" : "success",
      summary: "Le mie richieste",
      detail: `Hai ${openPrivateRequests.length} richieste da gestire su ${myPrivateRequests.length} totali.`,
      closable: false,
    });
  }

  const enrichedMessages: EnrichedMessage[] = [
    ...globalMessages.map((m) => ({
      ...m,
      read: messageStatusMap[m.id] ?? false,
      type: "global" as const,
    })),
    ...personalMessages.map((m) => ({
      ...m,
      type: "personal" as const,
    })),
  ].sort((a, b) => {
    if (a.read !== b.read) return a.read ? 1 : -1;
    const ta = toDate(a.createdAt)?.getTime() ?? 0;
    const tb = toDate(b.createdAt)?.getTime() ?? 0;
    return tb - ta;
  });

  const markAsRead = async (msg: EnrichedMessage) => {
    const user = auth.currentUser;
    if (!user || msg.read) return;
    if (msg.type === "global") {
      await setDoc(doc(db, `users/${user.uid}/messageStatus/${msg.id}`), {
        read: true,
        readAt: serverTimestamp(),
      });
      setMessageStatusMap((prev) => ({ ...prev, [msg.id]: true }));
    } else {
      await updateDoc(doc(db, `users/${user.uid}/messages/${msg.id}`), { read: true });
      setPersonalMessages((prev) =>
        prev.map((m) => (m.id === msg.id ? { ...m, read: true } : m))
      );
    }
  };

  if (loadingProfile || loadingRequests || loadingMessages) {
    return (
      <div style={{ textAlign: "center", marginTop: 80 }}>
        <span className="pi pi-spin pi-spinner" style={{ fontSize: 32 }} /> <div>Caricamento...</div>
      </div>
    );
  }

  return (
    <div style={{ width: "100%", padding: 32 }}>
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 16,
        background: "linear-gradient(90deg, #42A5F5 0%, #66BB6A 100%)",
        color: "#fff",
        borderRadius: 12,
        padding: "24px 32px",
        marginBottom: 32,
        boxShadow: "0 2px 8px rgba(66,165,245,0.15)"
      }}>
        <span className="pi pi-user" style={{ fontSize: 32, marginRight: 16 }} />
        <div>
          <h2 style={{ margin: 0, fontWeight: 700 }}>Dashboard Volontario</h2>
          <p style={{ margin: 0, fontSize: 18 }}>Panoramica delle tue informazioni e delle richieste.</p>
        </div>
      </div>

      {(enrichedMessages.length > 0 || messages.length > 0) && (
        <Panel
          headerTemplate={(options) => {
            const unread = enrichedMessages.filter((m) => !m.read).length;
            return (
              <div className={options.className} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {options.togglerElement}
                <span className="pi pi-bell" style={{ fontSize: 18 }} />
                <span style={{ fontWeight: 700, fontSize: 16 }}>Avvisi e comunicazioni</span>
                {unread > 0 && (
                  <Badge value={unread} severity="warning" />
                )}
                <Button
                  icon={hideRead ? "pi pi-eye" : "pi pi-eye-slash"}
                  label={hideRead ? "Mostra letti" : "Nascondi letti"}
                  size="small"
                  className="p-button-text p-button-secondary"
                  style={{ marginLeft: "auto" }}
                  onClick={(e) => { e.stopPropagation(); setHideRead((v) => !v); }}
                />
              </div>
            );
          }}
          toggleable
          collapsed={false}
          style={{ marginBottom: 32 }}
        >
          {messages.length > 0 && (
            <div style={{ marginBottom: enrichedMessages.length > 0 ? 16 : 0 }}>
              {messages.map((m) => {
                const sev = m.severity ?? "info";
                const s = SYSTEM_MSG_STYLES[sev] ?? SYSTEM_MSG_STYLES.info;
                return (
                  <div
                    key={m.id}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 10,
                      background: s.bg,
                      border: `1px solid ${s.border}`,
                      borderRadius: 6,
                      padding: "10px 14px",
                      marginBottom: 8,
                      color: s.color,
                    }}
                  >
                    <span className={`pi ${s.icon}`} style={{ fontSize: 18, marginTop: 2, flexShrink: 0 }} />
                    <span>
                      {m.summary && (
                        <strong style={{ display: "block", fontSize: "0.97em", marginBottom: 2, fontStyle: "italic" }}>{m.summary}</strong>
                      )}
                      <span style={{ fontSize: "0.9em", opacity: 0.85 }}>{m.detail}</span>
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {enrichedMessages.length > 0 && (
            <>
              {messages.length > 0 && <Divider />}
              {enrichedMessages.filter((msg) => !hideRead || !msg.read).length === 0 ? (
                <div style={{ color: "#aaa", fontSize: "0.9em", padding: "8px 0" }}>
                  Nessun messaggio non letto. Usa il pulsante in alto per mostrare anche i messaggi letti.
                </div>
              ) : (
                enrichedMessages
                  .filter((msg) => !hideRead || !msg.read)
                  .map((msg, i) => (
                    <div key={msg.id}>
                      {i > 0 && <Divider style={{ margin: "6px 0" }} />}
                      <div
                        style={{
                          background: msg.read ? "transparent" : "#fffbe6",
                          border: msg.read ? "none" : "1px solid #ffe58f",
                          borderRadius: 6,
                          padding: "10px 14px",
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "flex-start",
                          gap: 12,
                        }}
                      >
                        <div style={{ flex: 1 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                            <strong style={{ fontWeight: 700, fontSize: "1.05em", fontStyle: msg.read ? "normal" : "italic", opacity: msg.read ? 0.6 : 1 }}>{msg.title}</strong>
                            {!msg.read && <Tag value="Nuovo" severity="warning" />}
                          </div>
                          <div style={{ color: "#444", fontSize: "0.95em" }} dangerouslySetInnerHTML={{ __html: msg.body }} />
                          {!!msg.createdAt && (
                            <div style={{ color: "#aaa", fontSize: "0.8em", marginTop: 4 }}>
                              {formatMsgDate(msg.createdAt)}
                            </div>
                          )}
                        </div>
                        {!msg.read && (
                          <Button
                            label="Segna come letto"
                            icon="pi pi-check"
                            size="small"
                            className="p-button-text p-button-secondary"
                            style={{ flexShrink: 0 }}
                            onClick={() => markAsRead(msg)}
                          />
                        )}
                      </div>
                    </div>
                  ))
              )}
            </>
          )}
        </Panel>
      )}

      {myPrivateRequests.length !== 0 && (
        <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 32 }}>

            <Card title="Riepilogo delle mie richieste private per stato" style={{ flex: "1 1 350px", minWidth: 300 }}>
            <div style={{ marginBottom: 16, fontWeight: 500, fontSize: 18 }}>
              Totale richieste: {myPrivateRequests.length}
            </div>
            <Chart type="pie" data={privateChartData} style={{ maxWidth: 400 }} />
            </Card>
          <Card title="Le mie richieste" style={{ flex: "2 1 500px", minWidth: 350 }}>
            <DataTable
              value={myPrivateRequests}
              paginator
              rows={10}
              filterDisplay="row"
              paginatorTemplate="FirstPageLink PrevPageLink PageLinks NextPageLink LastPageLink CurrentPageReport"
              currentPageReportTemplate="{first}-{last} di {totalRecords} richieste"
            >
              <Column field="firstName" header="Nome" sortable />
              <Column field="lastName" header="Cognome" sortable />
              <Column field="age" header="Età" sortable />
              <Column field="deviceType" header="Device" sortable />
              <Column field="province" header="Provincia" sortable />
              <Column
                field="status"
                header="Stato"
                sortable
                body={(row) => (
                  <Tag value={row.status} severity={REQUEST_STATUS_SEVERITY[row.status] ?? "info"} />
                )}
              />
              <Column
                header="Creata"
                sortable
                sortField="createdAt"
                body={(row: any) => {
                  const date = row["createdAt"];
                  if (!date) return "-";
                  const d =
                    typeof date === "string"
                      ? new Date(date)
                      : date.toDate
                        ? date.toDate()
                        : date;
                  return d instanceof Date && !isNaN(d.getTime())
                    ? d.toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric" })
                    : "-";
                }}
                dataType="date"
              />
            </DataTable>
          </Card>
        </div>
      )}

      <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 32 }}>
        <Card title="Riepilogo richieste della comunity per stato" style={{ flex: "1 1 350px", minWidth: 300 }}>
          <div style={{ marginBottom: 16, fontWeight: 500, fontSize: 18 }}>
            Totale richieste: {publicRequests.length}
          </div>
          <Chart type="pie" data={chartData} style={{ maxWidth: 400 }} />
        </Card>

        <Card title="Elenco richieste da gestire" style={{ flex: "2 1 500px", minWidth: 350 }}>
            <DataTable
              value={manageablePublicRequests}
              paginator
              rows={10}
              rowsPerPageOptions={[5, 10, 20, 50]}
              paginatorTemplate="FirstPageLink PrevPageLink PageLinks NextPageLink LastPageLink CurrentPageReport"
              currentPageReportTemplate="{first}-{last} di {totalRecords} richieste"
              style={{ marginTop: 8 }}
              sortField="createdAt"
              sortOrder={-1}
            >
              <Column field="ageRange" header="Fascia d'età" sortable />
              <Column field="province" header="Provincia" sortable />
              <Column field="publicStatus" header="Stato" sortable />
              <Column
              field="createdAt"
              header="Data creazione"
              sortable
              body={(row) => {
                if (!row.createdAt) return "-";
                const date =
                typeof row.createdAt === "string"
                  ? new Date(row.createdAt)
                  : row.createdAt.toDate
                  ? row.createdAt.toDate()
                  : row.createdAt;
                return date instanceof Date && !isNaN(date.getTime())
                ? date.toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric" })
                : "-";
              }}
              />
            </DataTable>
        </Card>
      </div>
    </div>
  );
}
