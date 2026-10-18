import { useEffect, useState, useCallback, useMemo } from "react";
import { Routes, Route, Navigate, useLocation, useNavigate, useParams } from "react-router-dom";
import { PanelMenu } from "primereact/panelmenu";
import { Button } from "primereact/button";
import { Avatar } from "primereact/avatar";
import { Dialog } from "primereact/dialog";
import { Sidebar } from "primereact/sidebar";
import { onAuthStateChanged, signOut } from "firebase/auth";
import type { User } from "firebase/auth";
import { collection, query, orderBy, onSnapshot, getDocs, doc, getDoc } from "firebase/firestore";
import { auth, db } from "../../firebase";

import AdminAll from "../../pages/admin/requests/AdminAll";
import AdminTriage from "../../pages/admin/requests/AdminTriage";
import AdminPending from "../../pages/admin/requests/AdminPending";
import AdminProduction from "../../pages/admin/requests/AdminProduction";
import AdminShipping from "../../pages/admin/requests/AdminShipping";
import AdminCompleted from "../../pages/admin/requests/AdminCompleted";
import AdminCancelled from "../../pages/admin/requests/AdminCancelled";
import AdminArchived from "../../pages/admin/requests/AdminArchived";
import AdminVolunteers from "../../pages/admin/volunteers/AdminVolunteers";
import PendingVolunteers from "../../pages/admin/volunteers/PendingVolunteers";
import AdminStats from "../../pages/admin/AdminStats";
import SuperAdminPage from "../../pages/admin/superadmin/SuperAdminPage";
import AdminValidate from "../../pages/admin/requests/AdminValidate";
import AdminAttention from "../../pages/admin/requests/AdminAttention";

import logo from "../../assets/logo.png";
import { PUBLIC_STATUS_GROUPS_FROM_STATUS, getPublicStatusGroup } from "../../helpers/requestStatus";
import AdminDashboard from "../../pages/admin/AdminDashboard";
import VolunteerMaintenance from "../../pages/admin/volunteers/VolunteerMaintenance";
import ContactsList from "../../pages/admin/volunteers/ContactsList";
import ShipmentRequestsPage from "../../pages/shipments/ShipmentRequestsPage";
import AdminEmailLogsPage from "../../pages/admin/AdminEmailLogsPage";
import AdminSecurityLogsPage from "../../pages/admin/AdminSecurityLogsPage";
import AdminMessagesPage from "../../pages/admin/AdminMessagesPage";
import AdminChecklistTemplatesPage from "../../pages/admin/AdminChecklistTemplatesPage";
import MyChecklistItems from "../../pages/volunteer/MyChecklistItems";
import ProjectsWorkspace from "../../pages/admin/projects/ProjectsWorkspace";
import { version } from "../../../package.json";

// Documenti Firestore arricchiti con sotto-dati privati/pubblici a forma
// dinamica (deviceRequests+private+publicDeviceRequests, users+private
// profile): nessuno schema fisso, coerente con l'`any[]` che i consumer
// (AdminAll, AdminTriage, AdminVolunteers, ...) si aspettano ancora oggi.
type AdminRecord = Record<string, unknown> & { id: string; status?: string };

function LegacyProjectRedirect() {
  const { id } = useParams();
  return <Navigate to={id ? `/admin/projects/${id}` : "/admin/projects"} replace />;
}

function LegacyRequestRedirect() {
  const { id } = useParams();
  return <Navigate to={id ? `/admin/requests/${id}` : "/admin/requests"} replace />;
}

export default function AdminLayout() {
  const [user, setUser] = useState<User | null>(null);
  const [requests, setRequests] = useState<AdminRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInfo, setShowInfo] = useState(false);
  const [volunteers, setVolunteers] = useState<AdminRecord[]>([]);
  const [volunteersLoading, setVolunteersLoading] = useState(true);
  const [sidebarVisible, setSidebarVisible] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  const navTo = useCallback(
    (path: string) => {
      navigate(path);
      setSidebarVisible(false);
    },
    [navigate]
  );

  const menuLabel = useCallback(
    (label: string, isActive: boolean) => (isActive ? `• ${label}` : label),
    []
  );

  const loadVolunteers = useCallback(async () => {
    setVolunteersLoading(true);
    const snap = await getDocs(collection(db, "users"));
    const usersData = await Promise.all(
      snap.docs.map(async (docSnap) => {
        const user = { id: docSnap.id, ...docSnap.data() };
        const profileRef = doc(db, `users/${docSnap.id}/private/profile`);
        const profileSnap = await getDoc(profileRef);
        const profile = profileSnap.exists() ? profileSnap.data() : {};
        return {
          ...user,
          ...profile,
          profileUpdatedAt: profile.updatedAt?.toDate
            ? profile.updatedAt.toDate()
            : null
        };
      })
    );
    setVolunteers(usersData);
    setVolunteersLoading(false);
  }, []);

useEffect(() => {
  let unsubRequests: (() => void) | null = null;

  const unsubAuth = onAuthStateChanged(auth, async (u) => {
    if (!u) {
      navigate("/login", { replace: true });
      return;
    }

    // 1. Read user role from Firestore
    const userDoc = await getDoc(doc(db, "users", u.uid));
    const userData = userDoc.data();
    const userRole = userData?.role as string | undefined;

    if (userRole !== "admin") {
      // 2. Non‑admin: redirect to home and stop loading
      setUser(u);
      setLoading(false);
      navigate("/home", { replace: true });
      return;
    }

    // 3. Admin only from here on
    setUser(u);

    // Requests listener – enriched with private sub-data and publicDeviceRequests fields
    const q = query(
      collection(db, "deviceRequests"),
      orderBy("createdAt", "desc")
    );
    unsubRequests = onSnapshot(q, async (snapshot) => {
      const data = await Promise.all(
        snapshot.docs.map(async (docSnap) => {
          const baseData = { id: docSnap.id, ...docSnap.data() };
          const privateRef = doc(db, `deviceRequests/${docSnap.id}/private/data`);
          const privateSnap = await getDoc(privateRef);
          const privateData = privateSnap.exists() ? privateSnap.data() : {};
          // Merge public fields: deviceType (fallback) and publicStatus
          const publicRef = doc(db, `publicDeviceRequests/${docSnap.id}`);
          const publicSnap = await getDoc(publicRef);
          const publicData = publicSnap.exists() ? publicSnap.data() : {};
          return {
            ...baseData,
            ...privateData,
            // Keep deviceType from private if present, otherwise use public's devicetype
            deviceType: publicData.devicetype ?? undefined,
            // Stato pubblico display-only, ricalcolato al volo da status (EA-150):
            // non più letto dal campo publicStatus persistito su publicDeviceRequests.
            publicStatus2: docSnap.data().status ? getPublicStatusGroup(docSnap.data().status) : undefined,
            sequenceNumber: publicData.requestNumber ?? undefined,
          };
        })
      );
      setRequests(data);
      setLoading(false);
    });

    // Volunteers fetch
    await loadVolunteers();
  });

  return () => {
    unsubAuth();
    if (unsubRequests) unsubRequests();
  };
}, [navigate, loadVolunteers]);

  const handleLogout = async () => {
    await signOut(auth);
    navigate("/login", { replace: true });
  };

  const isBootstrapping = loading || volunteersLoading;

  // ===== CLASSIFICAZIONE RICHIESTE =====
  // Memoize per evitare che il cambio route (es. /requests -> /requests/:id)
  // ricrei ogni array e forzi redraw completo della tabella master.
  const liveRequests = useMemo(
    () => requests.filter((r) => r.archived !== true),
    [requests]
  );
  const archivedRequests = useMemo(
    () => requests.filter((r) => r.archived === true),
    [requests]
  );

  // Richieste da validare: status "inviata" — non ancora visibili ai volontari
  const validateRequests = useMemo(
    () => liveRequests.filter((r) => r.status === "inviata"),
    [liveRequests]
  );

  const triageRequests = useMemo(
    () => liveRequests.filter((r) =>
      PUBLIC_STATUS_GROUPS_FROM_STATUS["da gestire"].includes(r.status ?? "")
    ),
    [liveRequests]
  );

  // Filtro letterale invariato, non derivato dal raggruppamento pubblico (EA-150)
  const pendingRequests = useMemo(
    () => liveRequests.filter(
      (r) => r.status === "attesa volontario"
    ),
    [liveRequests]
  );

  const productionRequests = useMemo(
    () => liveRequests.filter((r) =>
      PUBLIC_STATUS_GROUPS_FROM_STATUS["fabbricazione in corso"].includes(r.status ?? "")
    ),
    [liveRequests]
  );

  // Filtro letterale invariato, non derivato dal raggruppamento pubblico (EA-150)
  const shippingRequests = useMemo(
    () => liveRequests.filter((r) =>
      ["pronta per spedizione", "spedita"].includes(r.status ?? "")
    ),
    [liveRequests]
  );

  const completedRequests = useMemo(
    () => liveRequests.filter((r) =>
      PUBLIC_STATUS_GROUPS_FROM_STATUS["completati"].includes(r.status ?? "")
    ),
    [liveRequests]
  );

  const cancelledRequests = useMemo(
    () => liveRequests.filter((r) =>
      PUBLIC_STATUS_GROUPS_FROM_STATUS["annullate / non completabili"].includes(r.status ?? "")
    ),
    [liveRequests]
  );

  const attentionRequests = useMemo(
    () => liveRequests.filter((r) => r.requiresAttention === true),
    [liveRequests]
  );

  // Filtra i volontari non attivi
  const pendingVolunteers = useMemo(
    () => volunteers.filter((v) => !v.active),
    [volunteers]
  );

  const panelMenuItems = [
    {
      label: "Dashboard",
      icon: "pi pi-home",
      command: () => navTo("/admin/dashboard"),
    },
    {
      label: "To Do List",
      icon: "pi pi-check-square",
      command: () => navTo("/admin/my-checklist-items"),
    },
    {
      label: "Richieste",
      icon: "pi pi-folder-open", // folder open per richieste
      items: [
        {
          label: menuLabel(`Tutte (${liveRequests.length})`, location.pathname === "/admin" || location.pathname.startsWith("/admin/requests")),
          icon: "pi pi-list", // elenco
          command: () => navTo("/admin/requests"),
        },
        {
          label: `Da validare (${validateRequests.length})`,
          icon: "pi pi-clock",
          command: () => navTo("/admin/requests/validate"),
        },
        {
          label: `Da gestire (${triageRequests.length})`,
          icon: "pi pi-inbox",
          command: () => navTo("/admin/requests/triage"),
        },
        {
          label: `In attesa volontario (${pendingRequests.length})`,
          icon: "pi pi-user",
          command: () => navTo("/admin/requests/pending"),
        },
        {
          label: `In produzione (${productionRequests.length})`,
          icon: "pi pi-cog",
          command: () => navTo("/admin/requests/production"),
        },
        {
          label: `Spedite (${shippingRequests.length})`,
          icon: "pi pi-send", // spedizione
          command: () => navTo("/admin/requests/shipping"),
        },
        {
          label: `Completate (${completedRequests.length})`,
          icon: "pi pi-check-circle", // completate
          command: () => navTo("/admin/requests/completed"),
        },
        {
          label: `Annullate / KO (${cancelledRequests.length})`,
          icon: "pi pi-ban", // annullate
          command: () => navTo("/admin/requests/cancelled"),
        },
        {
          label: `Archiviate (${archivedRequests.length})`,
          icon: "pi pi-inbox",
          command: () => navTo("/admin/requests/archived"),
        },
        {
          label: `Richiede attenzione (${attentionRequests.length})`,
          icon: "pi pi-exclamation-triangle",
          command: () => navTo("/admin/requests/attention"),
        },
      ],
    },
    {
      label: "Volontari",
      icon: "pi pi-users", // gruppo utenti
      items: [
        {
          label: `Elenco (${volunteers.length})`,
          icon: "pi pi-address-book", // elenco volontari
          command: () => navTo("/admin/volunteers/all"),
        },
        {
          label: `Attesa attivazione (${pendingVolunteers.length})`,
          icon: "pi pi-user-plus", // attesa attivazione
          command: () => navTo("/admin/volunteers/pending"),
        },
        {
          label: `Contatti`,
          icon: "pi pi-address-book", // elenco contatti
          command: () => navTo("/admin/volunteers/contacts"),
        },
        {
          label: "Manutenzione Volontari",
          icon: "pi pi-wrench", // manutenzione volontari
          command: () => navTo("/admin/volunteers/maintenance"),
        },
        {
          label: "Dashboard volontari",
          icon: "pi pi-id-card", // dashboard volontari
          command: () => navTo("/volunteer"),
        },        
      ],
    },
    {
      label: "Richieste spedizioni",
      icon: "pi pi-truck",
      command: () => navTo("/admin/shipments"),
    },
    {
      label: menuLabel("Progetti, iniziative, eventi", location.pathname.startsWith("/admin/projects")),
      icon: "pi pi-sitemap",
      command: () => navTo("/admin/projects"),
    },
    {
      label: "Comunicazioni",
      icon: "pi pi-comments",
      command: () => navTo("/admin/messages"),
    },
    {
      label: "Catalogo template checklist",
      icon: "pi pi-list-check",
      command: () => navTo("/admin/checklist-templates"),
    },
    {
      label: "Log Email",
      icon: "pi pi-envelope",
      command: () => navTo("/admin/email-logs"),
    },
    {
      label: "Security Logs",
      icon: "pi pi-shield",
      command: () => navTo("/admin/security-logs"),
    },
    {
      label: "Statistiche",
      icon: "pi pi-chart-bar", // statistiche
      command: () => navTo("/admin/stats"),
    },
  ];

  return (
    <div style={{ display: "flex", height: "100vh" }}>
      {/* Sidebar Toggle Button (visible on small screens) */}


      <Sidebar
        visible={sidebarVisible}
        onHide={() => setSidebarVisible(false)}
        showCloseIcon={true}
        style={{ width: 250, padding: 0 }}
        modal={true}
        blockScroll={true}
        className="admin-sidebar"
      >
        <div
          style={{
            padding: 16,
            fontWeight: "bold",
            fontSize: 18,
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <img src={logo} alt="Logo" style={{ width: 32, height: 32 }} />
          Admin
        </div>
        <PanelMenu model={panelMenuItems} />
      </Sidebar>

      {/* Desktop Sidebar */}
      {/* <div
      className="admin-sidebar-desktop"
      style={{
        width: 250,
        background: "#f4f4f4",
        borderRight: "1px solid #ddd",
        display: "flex",
        flexDirection: "column",
      }}
      >
      <div
        style={{
        padding: 16,
        fontWeight: "bold",
        fontSize: 18,
        display: "flex",
        alignItems: "center",
        gap: 8,
        }}
      >
        <img src={logo} alt="Logo" style={{ width: 32, height: 32 }} />
        Admin
      </div>
      <PanelMenu model={panelMenuItems} />
      </div> */}

      {/* Main */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        {/* Topbar */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "0 24px",
            height: 60,
            borderBottom: "1px solid #ddd",
            background: "#fff",
          }}
        >
          <Button
            icon="pi pi-bars"
            className="p-button-text"
            style={{
              border: "1px solid #ddd", // bordo visibile
              borderRadius: 4,
              background: "#fff",
            }}
            aria-label="Apri menu"
            onClick={() => setSidebarVisible(true)}
            id="sidebar-toggle-btn"
          />
          <div style={{ fontWeight: "bold", fontSize: 20 }}>
            e-Nable Italia Admin
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            {user && (
              <>
                <Avatar
                  label={user.email?.[0]?.toUpperCase() || "U"}
                  size="normal"
                  shape="circle"
                />
                <span>{user.email}</span>
              </>
            )}

            <Button
              icon="pi pi-info-circle"
              className="p-button-text"
              onClick={() => setShowInfo(true)}
            />

            <Button
              label="Logout"
              icon="pi pi-sign-out"
              onClick={handleLogout}
              className="p-button-text"
            />
          </div>
        </div>

        {/* Content */}
        <div
          style={{
            flex: 1,
            padding: 24,
            background: "#fafbfc",
            overflow: "auto",
          }}
        >
          {isBootstrapping ? (
            <div
              style={{
                minHeight: 360,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#6b7280",
                fontWeight: 600,
              }}
            >
              Caricamento...
            </div>
          ) : (
            <Routes>
              <Route path="requests/:id?" element={<AdminAll requests={liveRequests} />} />
            <Route path="requests/validate/:id?" element={<AdminValidate requests={validateRequests} />} />
            <Route path="requests/triage/:id?" element={<AdminTriage requests={triageRequests} />} />
            <Route path="requests/pending/:id?" element={<AdminPending requests={pendingRequests} />} />
            <Route path="requests/production/:id?" element={<AdminProduction requests={productionRequests} />} />
            <Route path="requests/shipping/:id?" element={<AdminShipping requests={shippingRequests} />} />
            <Route path="requests/completed/:id?" element={<AdminCompleted requests={completedRequests} />} />
            <Route path="requests/cancelled/:id?" element={<AdminCancelled requests={cancelledRequests} />} />
            <Route path="requests/archived/:id?" element={<AdminArchived requests={archivedRequests} />} />
            <Route path="requests/attention/:id?" element={<AdminAttention requests={attentionRequests} />} />
            <Route path="superadmin" element={<SuperAdminPage />} />
            <Route
              path="my-checklist-items"
              element={<MyChecklistItems originBasePath="/admin/requests" projectBasePath="/admin/projects" />}
            />
            <Route path="volunteers/all" element={<AdminVolunteers volunteers={volunteers} onRefresh={loadVolunteers} />} />
            <Route path="volunteers/all/:uid" element={<AdminVolunteers volunteers={volunteers} onRefresh={loadVolunteers} />} />
            <Route path="volunteers/pending" element={<PendingVolunteers volunteers={pendingVolunteers} />} />
            <Route path="volunteers/contacts" element={<ContactsList />} />
            <Route path="volunteers/maintenance" element={<VolunteerMaintenance />} />
            <Route path="shipments" element={<ShipmentRequestsPage />} />
            <Route path="messages" element={<AdminMessagesPage />} />
            <Route path="checklist-templates" element={<AdminChecklistTemplatesPage />} />
            <Route path="email-logs" element={<AdminEmailLogsPage />} />
            <Route path="security-logs" element={<AdminSecurityLogsPage />} />
            <Route path="stats" element={<AdminStats />} />
            <Route path="request/:id" element={<LegacyRequestRedirect />} />
            <Route path="projects" element={<ProjectsWorkspace scope="admin" canManage />} />
            <Route path="projects/:id" element={<ProjectsWorkspace scope="admin" canManage />} />
            <Route path="project/:id" element={<LegacyProjectRedirect />} />
            <Route path="dashboard" element={<AdminDashboard requests={requests}/>} />
            <Route path="*" element={<Navigate to="/admin/requests" replace />} />
            </Routes>
          )}
        </div>
      </div>

      {/* Info Dialog */}
      <Dialog
        header="Informazioni sull'applicazione"
        visible={showInfo}
        style={{ width: "500px" }}
        onHide={() => setShowInfo(false)}
      >
        <h3>e-Nable Italia Admin</h3>
        <p>Versione: {version}</p>
        <p>Gestione richieste dispositivi, volontari e statistiche.</p>
        <p>
          Supporto:{" "}
          <a href="mailto:info@e-nableitalia.it">
        info@e-nableitalia.it
          </a>
        </p>
        <p>© {new Date().getFullYear()} e-Nable Italia</p>
      </Dialog>
    </div>
  );
}
