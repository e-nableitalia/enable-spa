import { useEffect, useRef, useState } from "react";
import { getDoc, doc, getDocs, collection, query } from "firebase/firestore";
import { auth, db } from "../../firebase";
import type { VolunteerPrivateProfile, VolunteerSkills, VolunteerPublicProfile } from "./Volunteer";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Chart } from "primereact/chart";
import { Card } from "primereact/card";
import { Messages, type MessagesMessage } from "primereact/messages";
import { Tag } from "primereact/tag";

export default function VolunteerDashboard() {
  const [privateProfile, setPrivateProfile] = useState<VolunteerPrivateProfile | null>(null);
  const [skills, setSkills] = useState<VolunteerSkills | null>(null);
  const [publicProfile, setPublicProfile] = useState<VolunteerPublicProfile | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(true);

  const [publicRequests, setPublicRequests] = useState<any[]>([]);
  const [privateRequests, setPrivateRequests] = useState<any[]>([]);
  const [loadingRequests, setLoadingRequests] = useState(true);

  const msgs = useRef<Messages>(null);

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
        const q = query(collection(db, `deviceRequests`));
        const privateReqSnap = await getDocs(q);

        setPrivateRequests(privateReqSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      }
      setLoadingRequests(false);
    };
    fetchRequests();
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
    ? privateRequests.filter(req => req.assignedVolunteer === user.uid)
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
  //const pendingPrivateRequests = myPrivateRequests.filter(r => r.status !== "closed" && r.status !== "completed");

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
      summary: "Sezione incompleta",
      detail: `Completa la sezione "${section}" per migliorare il tuo profilo.`,
      closable: false,
    });
  });

  if (myPrivateRequests.length === 0) {
    messages.push({
      id: "no-private-requests",
      sticky: true,
      severity: "success",
      summary: "Nessuna richiesta",
      detail: "Non ci sono richieste di device da gestire.",
      closable: false,
    });
  } else {
    messages.push({
      id: "private-requests-count",
      sticky: true,
      severity: "warn",
      summary: "Richieste da gestire",
      detail: `Hai ${myPrivateRequests.length} richieste assegnate da gestire.`,
      closable: false,
    });
  }

  useEffect(() => {
    if (msgs.current && messages.length > 0) {
      msgs.current.clear();
      msgs.current.show(messages);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, loadingProfile, loadingRequests]);

  if (loadingProfile || loadingRequests) {
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
          <h2 style={{ margin: 0, fontWeight: 700 }}>Volunteer Dashboard</h2>
          <p style={{ margin: 0, fontSize: 18 }}>Overview delle tue informazioni e richieste.</p>
        </div>
      </div>

      <div className="card flex justify-content-center" style={{ marginBottom: 24 }}>
        <Messages ref={msgs} />
      </div>

      {myPrivateRequests.length !== 0 && (
        <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 32 }}>

            <Card title="Riepilogo delle mie richieste private per stato" style={{ flex: "1 1 350px", minWidth: 300 }}>
            <div style={{ marginBottom: 16, fontWeight: 500, fontSize: 18 }}>
              Totale richieste: {myPrivateRequests.length}
            </div>
            <Chart type="pie" data={privateChartData} style={{ maxWidth: 400 }} />
            </Card>
          <Card title="Le mie richieste" style={{ flex: "2 1 500px", minWidth: 350 }}>
            <DataTable value={myPrivateRequests} paginator rows={10} filterDisplay="row">
              <Column field="province" header="Provincia"/>
              <Column field="deviceType" header="Device"/>
              <Column field="status" header="Stato Interno" />
              <Column
                header="Stato Pubblico"
                body={(row) => <Tag value={row.publicStatus} severity="info" />}
              />
              <Column
                header="Creata"
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
              <Column
                header="Modificata"
                body={(row) => {
                  const date = row["updatedAt"];
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
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ fontWeight: 500, fontSize: 16 }}>
              Totale richieste: {manageablePublicRequests.length}
            </div>
            
            </div>
            <DataTable
              value={manageablePublicRequests}
              paginator
              rows={10}
              rowsPerPageOptions={[5, 10, 20, 50]}
              style={{ marginTop: 8 }}
              sortField="createdAt"
              sortOrder={-1}
            >
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
