import { useEffect, useState } from "react";
import { collection, query, orderBy, onSnapshot } from "firebase/firestore";
import { db, auth } from "../firebase";
import { useNavigate } from "react-router-dom";
import { onAuthStateChanged } from "firebase/auth";
import RequestTable from "../components/requests/RequestTable";

export default function Dashboard() {
  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const loadRequests = () => {
    const q = query(
      collection(db, "deviceRequests"),
      orderBy("createdAt", "desc")
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data()
      }));
      setRequests(data);
      setLoading(false);
    });

    return unsubscribe;
  };

  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      if (!user) {
        navigate("/login");
      } else {
        loadRequests();
      }
    });

    return unsubscribeAuth;
  }, []);

  if (loading) return <div>Loading...</div>;

  console.log("Loaded requests:", requests);

  return (
    <div style={{ padding: 20 }}>
      <h2>Device Requests</h2>
      <RequestTable
        requests={requests}
        onOpen={(id) => navigate(`/request/${id}`)}
      />
    </div>
  );
}
