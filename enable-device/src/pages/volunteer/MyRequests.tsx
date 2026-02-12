import { useEffect, useState } from "react";
import { collection, query, where, onSnapshot } from "firebase/firestore";
import { db, auth } from "../../firebase";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Tag } from "primereact/tag";

export default function MyRequests() {
  const [requests, setRequests] = useState<any[]>([]);

  useEffect(() => {
    const user = auth.currentUser;
    if (!user) return;

    const q = query(
      collection(db, "deviceRequests"),
      where("assignedVolunteer", "==", user.uid)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data()
      }));
      setRequests(data);
    });

    return unsubscribe;
  }, []);

  return (
    <div>
      <h2>Le mie richieste</h2>

      <DataTable value={requests} paginator rows={10}>
        <Column field="province" header="Provincia" />
        <Column field="deviceType" header="Device" />
        <Column field="status" header="Stato" />
      </DataTable>
    </div>
  );
}
