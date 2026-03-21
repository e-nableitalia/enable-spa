import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { getAuth } from "firebase/auth";
import { getFirestore, doc, getDoc } from "firebase/firestore";
import { hasRequiredConsents } from "../helpers/consents";

export default function Home() {
    const navigate = useNavigate();

    useEffect(() => {
        const checkRoleAndRedirect = async () => {
            const auth = getAuth();
            const db = getFirestore();
            const user = auth.currentUser;
            if (!user) {
                navigate("/login", { replace: true });
                return;
            }
            const userRef = doc(db, "users", user.uid);
            const snap = await getDoc(userRef);
            if (!snap.exists()) {
                navigate("/login", { replace: true });
                return;
            }
            const data = snap.data();
            if (data.mustSetPassword) {
                navigate("/set-password", { replace: true });
                return;
            }
            if (!hasRequiredConsents(data)) {
                navigate("/volunteer-consent", { replace: true });
                return;
            }
            if (data.role === "admin") {
                navigate("/admin", { replace: true });
            } else {
                navigate("/volunteer", { replace: true });
            }
        };
        checkRoleAndRedirect();
    }, [navigate]);

    return <div>Caricamento...</div>;
}
