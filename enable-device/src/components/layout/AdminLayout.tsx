import { useEffect, useState } from "react";
import { Routes, Route, Navigate, useNavigate } from "react-router-dom";
import { PanelMenu } from "primereact/panelmenu";
import { Button } from "primereact/button";
import { Avatar } from "primereact/avatar";
import { Dialog } from "primereact/dialog";
import { Sidebar } from "primereact/sidebar";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { collection, query, orderBy, onSnapshot, getDocs, doc, getDoc } from "firebase/firestore";
import { auth, db } from "../../firebase";

import AdminAll from "../../pages/admin/requests/AdminAll";
import AdminTriage from "../../pages/admin/requests/AdminTriage";
import AdminPending from "../../pages/admin/requests/AdminPending";
import AdminProduction from "../../pages/admin/requests/AdminProduction";
import AdminShipping from "../../pages/admin/requests/AdminShipping";
import AdminCompleted from "../../pages/admin/requests/AdminCompleted";
import AdminCancelled from "../../pages/admin/requests/AdminCancelled";
import AdminVolunteers from "../../pages/admin/volunteers/AdminVolunteers";
import PendingVolunteers from "../../pages/admin/volunteers/PendingVolunteers";
import AdminStats from "../../pages/admin/AdminStats";
import RequestDetail from "../../pages/admin/requests/RequestDetail";

import logo from "../../assets/logo.png";
import { PUBLIC_STATUS_GROUPS } from "../../helpers/requestStatus";
import AdminDashboard from "../../pages/admin/AdminDashboard";

export default function AdminLayout() {
  const [user, setUser] = useState<any | null>(null);
  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInfo, setShowInfo] = useState(false);
  const [volunteers, setVolunteers] = useState<any[]>([]);
  const [volunteersLoading, setVolunteersLoading] = useState(true);
  const [sidebarVisible, setSidebarVisible] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    let unsubRequests: (() => void) | null = null;

    const unsubAuth = onAuthStateChanged(auth, async (u) => {
      if (!u) {
        navigate("/login", { replace: true });
      } else {
        setUser(u);

        // Requests listener
        const q = query(
          collection(db, "deviceRequests"),
          orderBy("createdAt", "desc")
        );
        unsubRequests = onSnapshot(q, (snapshot) => {
          const data = snapshot.docs.map((doc) => ({
            id: doc.id,
            ...doc.data()
          }));
          setRequests(data);
          setLoading(false);
        });

        // Volunteers fetch
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
      }
    });

    return () => {
      unsubAuth();
      if (unsubRequests) unsubRequests();
    };
  }, [navigate]);

  const handleLogout = async () => {
    await signOut(auth);
    navigate("/login", { replace: true });
  };

  if (loading || volunteersLoading) return <div>Loading...</div>;

  // ===== CLASSIFICAZIONE RICHIESTE =====

  const triageRequests = requests.filter((r) =>
    PUBLIC_STATUS_GROUPS["da gestire"].includes(r.status)
  );

  const pendingRequests = requests.filter(
    (r) => r.status === "attesa volontario"
  );

  const productionRequests = requests.filter((r) =>
    PUBLIC_STATUS_GROUPS["fabbricazione in corso"].includes(r.status)
  );

  const shippingRequests = requests.filter((r) =>
    ["pronta per spedizione", "spedita"].includes(r.status)
  );

  const completedRequests = requests.filter((r) =>
    PUBLIC_STATUS_GROUPS["completati"].includes(r.status)
  );

  const cancelledRequests = requests.filter((r) =>
    PUBLIC_STATUS_GROUPS["annullate / non completabili"].includes(r.status)
  );

  // Filtra i volontari non attivi
  const pendingVolunteers = volunteers.filter(v => !v.active);

  const panelMenuItems = [
    {
      label: "Dashboard",
      icon: "pi pi-home",
      command: () => navigate("/admin/dashboard"),
    }, 
    {
      label: "Richieste",
      icon: "pi pi-folder-open", // folder open per richieste
      items: [
        {
          label: `Tutte (${requests.length})`,
          icon: "pi pi-list", // elenco
          command: () => navigate("/admin"),
        },
        {
          label: `Da gestire (${triageRequests.length})`,
          icon: "pi pi-inbox",
          command: () => navigate("/admin/requests/triage"),
        },
        {
          label: `In attesa volontario (${pendingRequests.length})`,
          icon: "pi pi-clock",
          command: () => navigate("/admin/requests/pending"),
        },
        {
          label: `In produzione (${productionRequests.length})`,
          icon: "pi pi-cog",
          command: () => navigate("/admin/requests/production"),
        },
        {
          label: `Spedite (${shippingRequests.length})`,
          icon: "pi pi-send", // spedizione
          command: () => navigate("/admin/requests/shipping"),
        },
        {
          label: `Completate (${completedRequests.length})`,
          icon: "pi pi-check-circle", // completate
          command: () => navigate("/admin/requests/completed"),
        },
        {
          label: `Annullate / KO (${cancelledRequests.length})`,
          icon: "pi pi-ban", // annullate
          command: () => navigate("/admin/requests/cancelled"),
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
          command: () => navigate("/admin/volunteers/all"),
        },
        {
          label: `Attesa attivazione (${pendingVolunteers.length})`,
          icon: "pi pi-user-plus", // attesa attivazione
          command: () => navigate("/admin/volunteers/pending"),
        },
        {
          label: "Dashboard volontari",
          icon: "pi pi-id-card", // dashboard volontari
          command: () => navigate("/volunteer"),
        },        
      ],
    },
    {
      label: "Statistiche",
      icon: "pi pi-chart-bar", // statistiche
      command: () => navigate("/admin/stats"),
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
          <Routes>
            <Route path="requests" element={<AdminAll requests={requests} />} />
            <Route path="requests/triage" element={<AdminTriage requests={triageRequests} />} />
            <Route path="requests/pending" element={<AdminPending requests={pendingRequests} />} />
            <Route path="requests/production" element={<AdminProduction requests={productionRequests} />} />
            <Route path="requests/shipping" element={<AdminShipping requests={shippingRequests} />} />
            <Route path="requests/completed" element={<AdminCompleted requests={completedRequests} />} />
            <Route path="requests/cancelled" element={<AdminCancelled requests={cancelledRequests} />} />
            <Route path="volunteers/all" element={<AdminVolunteers volunteers={volunteers} />} />
            <Route path="volunteers/pending" element={<PendingVolunteers volunteers={pendingVolunteers} />} />
            <Route path="stats" element={<AdminStats />} />
            <Route path="request/:id" element={<RequestDetail />} />
            <Route path="dashboard" element={<AdminDashboard requests={requests}/>} />
            <Route path="*" element={<Navigate to="/admin/requests" replace />} />
          </Routes>
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
        <p>Versione: 1.0.0</p>
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
