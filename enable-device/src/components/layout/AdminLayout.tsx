import { useEffect, useState } from "react";
import { Routes, Route, Navigate, useNavigate } from "react-router-dom";
import { PanelMenu } from "primereact/panelmenu";
import { Button } from "primereact/button";
import { Avatar } from "primereact/avatar";
import { Dialog } from "primereact/dialog";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { collection, query, orderBy, onSnapshot } from "firebase/firestore";
import { auth, db } from "../../firebase";

import AdminAll from "../../pages/admin/AdminAll";
import AdminTriage from "../../pages/admin/AdminTriage";
import AdminPending from "../../pages/admin/AdminPending";
import AdminProduction from "../../pages/admin/AdminProduction";
import AdminShipping from "../../pages/admin/AdminShipping";
import AdminCompleted from "../../pages/admin/AdminCompleted";
import AdminCancelled from "../../pages/admin/AdminCancelled";
import AdminVolunteers from "../../pages/admin/AdminVolunteers";
import AdminStats from "../../pages/admin/AdminStats";
import RequestDetail from "../../pages/admin/RequestDetail";

import logo from "../../assets/logo.png";
import { PUBLIC_STATUS_GROUPS } from "../../helpers/requestStatus";

export default function AdminLayout() {
  const [user, setUser] = useState<any | null>(null);
  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInfo, setShowInfo] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, (u) => {
      if (!u) {
        navigate("/login", { replace: true });
      } else {
        setUser(u);

        const q = query(
          collection(db, "deviceRequests"),
          orderBy("createdAt", "desc")
        );

        const unsubRequests = onSnapshot(q, (snapshot) => {
          const data = snapshot.docs.map((doc) => ({
            id: doc.id,
            ...doc.data()
          }));
          setRequests(data);
          setLoading(false);
        });

        return () => unsubRequests();
      }
    });

    return () => unsubAuth();
  }, [navigate]);

  const handleLogout = async () => {
    await signOut(auth);
    navigate("/login", { replace: true });
  };

  if (loading) return <div>Loading...</div>;

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

  const panelMenuItems = [
    {
      label: `Tutte (${requests.length})`,
      icon: "pi pi-home",
      command: () => navigate("/admin"),
    },
    {
      label: `Da gestire (${triageRequests.length})`,
      icon: "pi pi-inbox",
      command: () => navigate("/admin/triage"),
    },
    {
      label: `In attesa volontario (${pendingRequests.length})`,
      icon: "pi pi-clock",
      command: () => navigate("/admin/pending"),
    },
    {
      label: `In produzione (${productionRequests.length})`,
      icon: "pi pi-cog",
      command: () => navigate("/admin/production"),
    },
    {
      label: `Spedizioni (${shippingRequests.length})`,
      icon: "pi pi-truck",
      command: () => navigate("/admin/shipping"),
    },
    {
      label: `Completate (${completedRequests.length})`,
      icon: "pi pi-check",
      command: () => navigate("/admin/completed"),
    },
    {
      label: `Annullate / KO (${cancelledRequests.length})`,
      icon: "pi pi-times",
      command: () => navigate("/admin/cancelled"),
    },
    {
      label: "Volontari",
      icon: "pi pi-users",
      command: () => navigate("/admin/volunteers"),
    },
    {
      label: "Statistiche",
      icon: "pi pi-chart-bar",
      command: () => navigate("/admin/stats"),
    },
  ];

  return (
    <div style={{ display: "flex", height: "100vh" }}>
      {/* Sidebar */}
      <div
        style={{
          width: 250,
          background: "#f4f4f4",
          borderRight: "1px solid #ddd",
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
      </div>

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
            <Route index element={<AdminAll requests={requests} />} />
            <Route path="triage" element={<AdminTriage requests={triageRequests} />} />
            <Route path="pending" element={<AdminPending requests={pendingRequests} />} />
            <Route path="production" element={<AdminProduction requests={productionRequests} />} />
            <Route path="shipping" element={<AdminShipping requests={shippingRequests} />} />
            <Route path="completed" element={<AdminCompleted requests={completedRequests} />} />
            <Route path="cancelled" element={<AdminCancelled requests={cancelledRequests} />} />
            <Route path="volunteers" element={<AdminVolunteers />} />
            <Route path="stats" element={<AdminStats />} />
            <Route path="request/:id" element={<RequestDetail />} />
            <Route path="*" element={<Navigate to="/admin" replace />} />
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
