import { useEffect, useState } from "react";
import { Outlet, useNavigate, Routes, Route, Navigate } from "react-router-dom";
import { onAuthStateChanged, type Auth, signOut } from "firebase/auth";
import { getDoc, doc } from "firebase/firestore";
import { auth, db } from "../../firebase";
import { PanelMenu } from "primereact/panelmenu";
import { Button } from "primereact/button";
import { Badge } from "primereact/badge";
import logo from "../../assets/logo.png";

import VolunteerDashboard from "../../pages/volunteer/VolunteerDashboard";
import MyRequests from "../../pages/volunteer/MyRequests";
import Production from "../../pages/volunteer/Production";
import Shipping from "../../pages/volunteer/Shipping";
import Archive from "../../pages/volunteer/Archive";

export default function VolunteerLayout() {
    const navigate = useNavigate();
    const [userEmail, setUserEmail] = useState<string | null>(null);
    const [authorized, setAuthorized] = useState(false);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;

        const unsub = onAuthStateChanged(auth, async (user) => {
            if (!user) {
                navigate("/login", { replace: true });
                return;
            }
            try {
                const userDoc = await getDoc(doc(db, "users", user.uid));
                const role = userDoc.exists() ? userDoc.data()?.role : null;
                if (role !== "volunteer") {
                    if (role === "admin") {
                        navigate("/admin", { replace: true });
                    } else {
                        navigate("/login", { replace: true });
                    }
                    return;
                }
                setUserEmail(user.email);
                setAuthorized(true);
            } finally {
                if (!cancelled) setLoading(false);
            }
        });

        return () => {
            cancelled = true;
            if (unsub) unsub();
        };
    }, [navigate]);

    const logout = async () => {
        await signOut(auth);
        navigate("/login");
    };

    const items = [
        {
            label: "Dashboard",
            icon: "pi pi-home",
            command: () => navigate("/volunteer")
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
        }
    ];

    if (loading) return <div>Loading...</div>;
    if (!authorized) return null;

    return (
        <div style={{ display: "flex", minHeight: "100vh" }}>
            <div style={{ width: 250, padding: 20, borderRight: "1px solid #ddd" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
                    <img src={logo} alt="Logo" style={{ width: 32, height: 32 }} />
                    <h3 style={{ margin: 0 }}>Volunteer</h3>
                </div>
                <PanelMenu model={items} />
            </div>

            <div style={{ flex: 1, padding: 20 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 20 }}>
                    <div>
                        <strong>{userEmail}</strong>
                    </div>
                    <Button label="Logout" icon="pi pi-sign-out" onClick={logout} />
                </div>

                <Routes>
                    <Route index element={<VolunteerDashboard />} />
                    <Route path="my-requests" element={<MyRequests />} />
                    <Route path="production" element={<Production />} />
                    <Route path="shipping" element={<Shipping />} />
                    <Route path="archive" element={<Archive />} />
                    <Route path="*" element={<Navigate to="/volunteer" />} />
                </Routes>
            </div>
        </div>
    );
}

