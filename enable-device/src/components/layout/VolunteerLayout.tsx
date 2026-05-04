import { useEffect, useState } from "react";
import { useNavigate, Routes, Route, Navigate } from "react-router-dom";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { getDoc, doc } from "firebase/firestore";
import { auth, db } from "../../firebase";
import { PanelMenu } from "primereact/panelmenu";
import { Button } from "primereact/button";
import { Avatar } from "primereact/avatar";
import { Dialog } from "primereact/dialog";
import { Sidebar } from "primereact/sidebar";
import logo from "../../assets/logo.png";
import { PUBLIC_STATUS_GROUPS } from "../../helpers/requestStatus";

import VolunteerDashboard from "../../pages/volunteer/VolunteerDashboard";
import MyRequests from "../../pages/volunteer/MyRequests";
import Production from "../../pages/volunteer/Production";
import Shipping from "../../pages/volunteer/Shipping";
import Archive from "../../pages/volunteer/Archive";
import VolunteerProfile from "../../pages/volunteer/VolunteerProfile";
import VolunteerAvailability from "../../pages/volunteer/VolunteerAvailability";
import MyPrinters from "../../pages/volunteer/MyPrinters";
import ShipmentRequestsPage from "../../pages/shipments/ShipmentRequestsPage";
import VolunteerRequestDetail from "../../pages/volunteer/VolunteerRequestDetail";
import ManageableRequestsPage from "../../pages/volunteer/ManageableRequestsPage";
import ManageableRequestDetail from "../../pages/volunteer/ManageableRequestDetail";
import { collection, query, where, onSnapshot } from "firebase/firestore";
import { version } from "../../../package.json";

export default function VolunteerLayout() {
    const navigate = useNavigate();
    const [userEmail, setUserEmail] = useState<string | null>(null);
    const [authorized, setAuthorized] = useState(false);
    const [loading, setLoading] = useState(true);
    const [active, setActive] = useState(true);
    const [requests, setRequests] = useState<any[]>([]);
    const [shippingRequests, setShippingRequests] = useState<any[]>([]);
    const [productionRequests, setProductionRequests] = useState<any[]>([]);
    const [role, setRole] = useState<string | null>(null);
    const [showInfo, setShowInfo] = useState(false);
    const [sidebarVisible, setSidebarVisible] = useState(false);

    useEffect(() => {
        let cancelled = false;
        let unsub: (() => void) | undefined;
        const unsubAuth = onAuthStateChanged(auth, async (user) => {
            if (!user || !user.uid) {
                navigate("/login", { replace: true });
                return;
            }
            try {
                const userDoc = await getDoc(doc(db, "users", user.uid));
                const role = userDoc.exists() ? userDoc.data()?.role : null;
                setRole(role);
                if (role !== "volunteer") {
                    if (role != "admin") {
                        navigate("/login", { replace: true });
                        return;
                    }
                }
                setUserEmail(user.email);
                setAuthorized(true);
                setActive(userDoc.data()?.active !== false); // default true
                // Fetch requests assigned to this volunteer
                const q = query(
                    collection(db, "deviceRequests"),
                    where("assignedVolunteers", "array-contains", user.uid)
                );
                unsub = onSnapshot(q, async (snapshot) => {
                    const data = await Promise.all(
                        snapshot.docs.map(async (docSnap) => {
                            const base = { id: docSnap.id, ...docSnap.data() } as { id: string; status?: string; [key: string]: any };
                            const [publicSnap, privateSnap] = await Promise.all([
                                getDoc(doc(db, "publicDeviceRequests", docSnap.id)),
                                getDoc(doc(db, "deviceRequests", docSnap.id, "private", "data")),
                            ]);
                            if (publicSnap.exists()) {
                                const pub = publicSnap.data();
                                base.province = pub.province ?? base.province;
                                base.deviceType = pub.devicetype ?? base.deviceType;
                                base.publicStatus = pub.publicStatus ?? base.publicStatus;
                            }
                            if (privateSnap.exists()) {
                                const priv = privateSnap.data();
                                base.firstName = priv.firstName ?? base.firstName;
                                base.lastName = priv.lastName ?? base.lastName;
                            }
                            return base;
                        })
                    );
                    setRequests(data);
                    setShippingRequests(data.filter(r => r.status && PUBLIC_STATUS_GROUPS["fabbricazione in corso"].includes(r.status) && ["pronta per spedizione", "spedita"].includes(r.status)));
                    setProductionRequests(data.filter(r => r.status && PUBLIC_STATUS_GROUPS["fabbricazione in corso"].includes(r.status) && !["pronta per spedizione", "spedita"].includes(r.status)));
                    // setCompletedRequests(data.filter(r => r.status && PUBLIC_STATUS_GROUPS["completati"].includes(r.status)));
                });
            } finally {
                if (!cancelled) setLoading(false);
            }
        });
        return () => {
            cancelled = true;
            if (unsubAuth) unsubAuth();
            if (unsub) unsub();
        };
    }, [navigate]);

    const logout = async () => {
        await signOut(auth);
        navigate("/login");
    };

    const items = [
        {
            label: "Le mie informazioni",
            icon: "pi pi-user",
            command: () => navigate("/volunteer/profile")
        },
        {
            label: "Disponibilità e coinvolgimento",
            icon: "pi pi-heart",
            command: () => navigate("/volunteer/availability")
        },
        {
            label: "Le mie stampanti",
            icon: "pi pi-print",
            command: () => navigate("/volunteer/my-printers")
        },
        {
            label: "Dashboard",
            icon: "pi pi-home",
            command: () => navigate("/volunteer")
        },
        {
            label: "Richieste da gestire",
            icon: "pi pi-list",
            command: () => navigate("/volunteer/manageable-requests")
        },
        {
            label: "Le mie richieste",
            icon: "pi pi-inbox",
            command: () => navigate("/volunteer/my-requests")
        },
        {
            label: "In produzione",
            icon: "pi pi-cog",
            command: () => navigate("/volunteer/production")
        },
        {
            label: "Spedizioni",
            icon: "pi pi-send",
            command: () => navigate("/volunteer/shipping")
        },
        {
            label: "Archivio",
            icon: "pi pi-folder",
            command: () => navigate("/volunteer/archive")
        },
        {
            label: "Richieste spedizioni",
            icon: "pi pi-truck",
            command: () => navigate("/volunteer/shipments")
        }
    ];

    // Aggiungi voce admin dashboard se l'utente è admin
    if (role === "admin") {
        items.unshift({
            label: "Admin Dashboard",
            icon: "pi pi-shield",
            command: () => navigate("/admin")
        });
    }

    if (loading) return <div>Loading...</div>;
    if (!authorized) return null;
    console.log("Active status:", active);

    // Se non attivo, mostra solo il profilo
    if (!active) {
        return (
            <div style={{ display: "flex", height: "100vh" }}>
                {/* Sidebar mobile/nascondibile */}
                <Sidebar
                    visible={sidebarVisible}
                    onHide={() => setSidebarVisible(false)}
                    showCloseIcon={true}
                    style={{ width: 250, padding: 0 }}
                    modal={true}
                    blockScroll={true}
                    className="volunteer-sidebar"
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
                        Volunteer
                    </div>
                    <PanelMenu model={[{
                        label: "Le mie informazioni",
                        icon: "pi pi-user",
                        command: () => navigate("/volunteer/profile")
                    }]} />
                </Sidebar>

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
                                border: "1px solid #ddd",
                                borderRadius: 4,
                                background: "#fff",
                            }}
                            aria-label="Apri menu"
                            onClick={() => setSidebarVisible(true)}
                            id="sidebar-toggle-btn"
                        />
                        <div style={{ fontWeight: "bold", fontSize: 20 }}>
                            e-Nable Italia Volunteer
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                            {userEmail && (
                                <>
                                    <Avatar label={userEmail?.[0]?.toUpperCase() || "U"} size="normal" shape="circle" />
                                    <span style={{ fontWeight: "bold" }}>{userEmail}</span>
                                </>
                            )}
                            <Button icon="pi pi-info-circle" className="p-button-text" onClick={() => setShowInfo(true)} aria-label="Info" />
                            <Button label="Logout" icon="pi pi-sign-out" onClick={logout} className="p-button-text" />
                        </div>
                    </div>
                    {/* Content */}
                    <div style={{ background: "#fffbe6", border: "1px solid #ffe58f", borderRadius: 8, padding: 16, margin: 24, display: "flex", alignItems: "center", gap: 12 }}>
                        <span className="pi pi-exclamation-triangle" style={{ color: "#faad14", fontSize: 24 }} />
                        <span style={{ fontWeight: "bold", fontSize: 18, color: "#d48806" }}>
                            La tua utenza è registrata ma deve essere attivata da un amministratore per diventare pienamente operativa. Riceverai una notifica appena sarà attivata.
                        </span>
                    </div>
                    <div style={{ flex: 1, padding: 24, background: "#fafbfc", overflow: "auto" }}>
                        <Routes>
                            <Route path="profile" element={<VolunteerProfile />} />
                            <Route path="availability" element={<VolunteerAvailability />} />
                            <Route path="*" element={<Navigate to="/volunteer/profile" />} />
                        </Routes>
                        <Dialog header="Informazioni sull'applicazione" visible={showInfo} style={{ width: "500px" }} onHide={() => setShowInfo(false)}>
                            <div>
                                <h3>e-Nable Italia Volunteer</h3>
                                <p>Versione: {version}</p>
                                <p>Gestione richieste, profilo volontario e stampanti.</p>
                                <p>Per supporto o segnalazioni: <a href="mailto:info@e-nableitalia.it">info@e-nableitalia.it</a></p>
                                <p>© {new Date().getFullYear()} e-Nable Italia</p>
                            </div>
                        </Dialog>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div style={{ display: "flex", height: "100vh" }}>
            {/* Sidebar mobile/nascondibile */}
            <Sidebar
                visible={sidebarVisible}
                onHide={() => setSidebarVisible(false)}
                showCloseIcon={true}
                style={{ width: 250, padding: 0 }}
                modal={true}
                blockScroll={true}
                className="volunteer-sidebar"
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
                    Volunteer
                </div>
                <PanelMenu model={items} />
            </Sidebar>

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
                            border: "1px solid #ddd",
                            borderRadius: 4,
                            background: "#fff",
                        }}
                        aria-label="Apri menu"
                        onClick={() => setSidebarVisible(true)}
                        id="sidebar-toggle-btn"
                    />
                    <div style={{ fontWeight: "bold", fontSize: 20 }}>
                        e-Nable Italia - Volontari
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                        {userEmail && (
                            <>
                                <Avatar label={userEmail?.[0]?.toUpperCase() || "U"} size="normal" shape="circle" />
                                <span style={{ fontWeight: "bold" }}>{userEmail}</span>
                            </>
                        )}
                        <Button icon="pi pi-info-circle" className="p-button-text" onClick={() => setShowInfo(true)} aria-label="Info" />   
                        <Button label="Logout" icon="pi pi-sign-out" onClick={logout} className="p-button-text" />
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
                        <Route index element={<VolunteerDashboard />} />
                        <Route path="my-requests" element={<MyRequests requests={requests} />} />
                        <Route path="manageable-requests" element={<ManageableRequestsPage />} />
                        <Route path="manageable-requests/:id" element={<ManageableRequestDetail />} />
                        <Route path="my-requests/:id" element={<VolunteerRequestDetail />} />
                        <Route path="production" element={<Production requests={productionRequests} />} />
                        <Route path="shipping" element={<Shipping requests={shippingRequests} />} />
                        <Route path="archive" element={<Archive />} />
                        <Route path="profile" element={<VolunteerProfile />} />
                        <Route path="availability" element={<VolunteerAvailability />} />
                        <Route path="my-printers" element={<MyPrinters />} />
                        <Route path="shipments" element={<ShipmentRequestsPage />} />
                        <Route path="*" element={<Navigate to="/volunteer" />} />
                    </Routes>
                    <Dialog header="Informazioni sull'applicazione" visible={showInfo} style={{ width: "500px" }} onHide={() => setShowInfo(false)}>
                        <div>
                            <h3>e-Nable Italia Volunteer</h3>
                            <p>Versione: {version}</p>
                            <p>Gestione richieste, profilo volontario e stampanti.</p>
                            <p>Per supporto o segnalazioni: <a href="mailto:info@e-nableitalia.it">info@e-nableitalia.it</a></p>
                            <p>© {new Date().getFullYear()} e-Nable Italia</p>
                        </div>
                    </Dialog>
                </div>
            </div>
        </div>
    );
}

