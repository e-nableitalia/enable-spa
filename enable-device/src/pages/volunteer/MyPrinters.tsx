import { useEffect, useState } from "react";
import { auth, db, functions } from "../../firebase";
import { collection, getDocs, deleteDoc, doc } from "firebase/firestore";
import type { VolunteerPrinter } from "../../shared/types/volunteerData";
import { Card } from "primereact/card";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Button } from "primereact/button";
import { Toolbar } from "primereact/toolbar";
import { Dialog } from "primereact/dialog";
import { InputText } from "primereact/inputtext";
import { httpsCallable } from "firebase/functions";

export default function MyPrinters() {

  const [printers, setPrinters] = useState<VolunteerPrinter[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDialog, setShowDialog] = useState(false);
  const [newPrinter, setNewPrinter] = useState({
    brand: "",
    model: "",
    buildVolumeX: 0,
    buildVolumeY: 0,
    buildVolumeZ: 0,
    multiMaterial: false,
    flexibleSupported: false,
    directDrive: false,
    notes: "",
    active: true
  });
  const [saving, setSaving] = useState(false);

  const fetchPrinters = async () => {
    const user = auth.currentUser;
    if (!user) return;
    const printersRef = collection(db, `users/${user.uid}/printers`);
    const snap = await getDocs(printersRef);
    setPrinters(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as VolunteerPrinter)));
    setLoading(false);
  };

  useEffect(() => {
    fetchPrinters();
  }, []);

  const handleDelete = async (printerId: string) => {
    const user = auth.currentUser;
    if (!user) return;
    await deleteDoc(doc(db, `users/${user.uid}/printers/${printerId}`));
    fetchPrinters();
  };

  const deleteBodyTemplate = (rowData: any) => (
    <Button icon="pi pi-trash" className="p-button-rounded p-button-danger p-button-text" onClick={() => handleDelete(rowData.id)} />
  );

  const leftToolbarTemplate = () => (
    <Button label="Aggiungi stampante" icon="pi pi-plus" className="p-button-success" onClick={() => setShowDialog(true)} />
  );

  const handleAddPrinter = async () => {
    setSaving(true);
    const user = auth.currentUser;
    if (!user) return;
    const addPrinter = httpsCallable(functions, "addPrinter");
    try {
      await addPrinter({
        brand: newPrinter.brand,
        model: newPrinter.model,
        buildVolumeX: Number(newPrinter.buildVolumeX),
        buildVolumeY: Number(newPrinter.buildVolumeY),
        buildVolumeZ: Number(newPrinter.buildVolumeZ),
        multiMaterial: !!newPrinter.multiMaterial,
        flexibleSupported: !!newPrinter.flexibleSupported,
        directDrive: !!newPrinter.directDrive,
        notes: newPrinter.notes,
        active: !!newPrinter.active
      });
      setShowDialog(false);
      setNewPrinter({
        brand: "",
        model: "",
        buildVolumeX: 0,
        buildVolumeY: 0,
        buildVolumeZ: 0,
        multiMaterial: false,
        flexibleSupported: false,
        directDrive: false,
        notes: "",
        active: true
      });
      fetchPrinters();
    } catch (e) {
      // handle error if needed
    }
    setSaving(false);
  };

  return (
    <div style={{ width: "100%", padding: 32 }}>
      <Card title="Le mie stampanti">
        <Toolbar left={leftToolbarTemplate} />
        <DataTable value={printers} loading={loading} responsiveLayout="scroll">
          <Column field="brand" header="Marca" />
          <Column field="model" header="Modello" />
          <Column field="buildVolumeX" header="Volume X" />
          <Column field="buildVolumeY" header="Volume Y" />
          <Column field="buildVolumeZ" header="Volume Z" />
          <Column field="multiMaterial" header="Multi-materiale" />
          <Column field="flexibleSupported" header="Flex" />
          <Column field="directDrive" header="Direct Drive" />
          <Column field="active" header="Attiva" />
          <Column field="notes" header="Note" />
          <Column body={deleteBodyTemplate} headerStyle={{ width: 60, textAlign: "center" }} bodyStyle={{ textAlign: "center" }} />
        </DataTable>
        <Dialog header="Aggiungi stampante" visible={showDialog} style={{ width: "500px" }} onHide={() => setShowDialog(false)}>
          <div className="p-fluid">
            <div style={{ marginBottom: 18 }}>
              <label htmlFor="brand">Marca</label>
              <InputText id="brand" value={newPrinter.brand} onChange={e => setNewPrinter({ ...newPrinter, brand: e.target.value })} />
            </div>
            <div style={{ marginBottom: 18 }}>
              <label htmlFor="model">Modello</label>
              <InputText id="model" value={newPrinter.model} onChange={e => setNewPrinter({ ...newPrinter, model: e.target.value })} />
            </div>
            <div style={{ marginBottom: 18 }}>
              <label htmlFor="buildVolumeX">Volume X (mm)</label>
              <InputText id="buildVolumeX" type="number" value={newPrinter.buildVolumeX.toString()} onChange={e => setNewPrinter({ ...newPrinter, buildVolumeX: Number(e.target.value) })} />
            </div>
            <div style={{ marginBottom: 18 }}>
              <label htmlFor="buildVolumeY">Volume Y (mm)</label>
              <InputText id="buildVolumeY" type="number" value={newPrinter.buildVolumeY.toString()} onChange={e => setNewPrinter({ ...newPrinter, buildVolumeY: Number(e.target.value) })} />
            </div>
            <div style={{ marginBottom: 18 }}>
              <label htmlFor="buildVolumeZ">Volume Z (mm)</label>
              <InputText id="buildVolumeZ" type="number" value={newPrinter.buildVolumeZ.toString()} onChange={e => setNewPrinter({ ...newPrinter, buildVolumeZ: Number(e.target.value) })} />
            </div>
            <div style={{ marginBottom: 18 }}>
              <label htmlFor="multiMaterial">Multi-materiale</label>
              <input id="multiMaterial" type="checkbox" checked={newPrinter.multiMaterial} onChange={e => setNewPrinter({ ...newPrinter, multiMaterial: e.target.checked })} style={{ marginLeft: 8 }} />
            </div>
            <div style={{ marginBottom: 18 }}>
              <label htmlFor="flexibleSupported">Supporto materiali flessibili</label>
              <input id="flexibleSupported" type="checkbox" checked={newPrinter.flexibleSupported} onChange={e => setNewPrinter({ ...newPrinter, flexibleSupported: e.target.checked })} style={{ marginLeft: 8 }} />
            </div>
            <div style={{ marginBottom: 18 }}>
              <label htmlFor="directDrive">Direct Drive</label>
              <input id="directDrive" type="checkbox" checked={newPrinter.directDrive} onChange={e => setNewPrinter({ ...newPrinter, directDrive: e.target.checked })} style={{ marginLeft: 8 }} />
            </div>
            <div style={{ marginBottom: 18 }}>
              <label htmlFor="notes">Note</label>
              <InputText id="notes" value={newPrinter.notes} onChange={e => setNewPrinter({ ...newPrinter, notes: e.target.value })} />
            </div>
            <div style={{ marginBottom: 18 }}>
              <label htmlFor="active">Stampante attiva</label>
              <input id="active" type="checkbox" checked={newPrinter.active} onChange={e => setNewPrinter({ ...newPrinter, active: e.target.checked })} style={{ marginLeft: 8 }} />
            </div>
            <Button label="Salva" icon="pi pi-check" onClick={handleAddPrinter} loading={saving} />
          </div>
        </Dialog>
      </Card>
    </div>
  );
}
