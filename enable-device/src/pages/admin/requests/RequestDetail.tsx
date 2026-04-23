import { useParams } from "react-router-dom";
import { useEffect, useState, useRef, useCallback } from "react";
import { doc, getDoc, collection, query, orderBy, getDocs, updateDoc } from "firebase/firestore";
import { db, functions } from "../../../firebase";
import { httpsCallable } from "firebase/functions";
import { Button } from "primereact/button";
import { Checkbox } from "primereact/checkbox";
import { Dropdown } from "primereact/dropdown";
import { InputText } from "primereact/inputtext";
import { InputTextarea } from "primereact/inputtextarea";
import { ListBox } from "primereact/listbox";
import RequestTimeline from "../../../components/timeline/RequestTimeline";
import { Toast } from "primereact/toast";
import { Panel } from "primereact/panel";
import { Dialog } from "primereact/dialog";
import { Badge } from "primereact/badge";
import { Toolbar } from "primereact/toolbar";
import { REQUEST_STATUSES } from "../../../helpers/requestStatus";
import type { ShippingAddress } from "../../../shared/types/shippingAddress";
import provinceList from "../../../helpers/province.json";

export default function RequestDetail() {
  const { id } = useParams();
  const [request, setRequest] = useState<any>(null);
  const [events, setEvents] = useState<any[]>([]);
  const [newStatus, setNewStatus] = useState("");
  const [note, setNote] = useState("");
  const [privateData, setPrivateData] = useState<any>(null);
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [showChangeStatusDialog, setShowChangeStatusDialog] = useState(false);
  const [showAssignVolunteerDialog, setShowAssignVolunteerDialog] = useState(false);
  const [showAddNoteDialog, setShowAddNoteDialog] = useState(false);
  const [volunteers, setVolunteers] = useState<any[]>([]);
  const [noteText, setNoteText] = useState("");
  const [assignedVolunteersList, setAssignedVolunteersList] = useState<{ id: string; label: string }[]>([]);
  const [selectedToRemove, setSelectedToRemove] = useState<{ id: string; label: string }[]>([]);
  const [volunteerToAdd, setVolunteerToAdd] = useState<any>(null);
  const [showAddRow, setShowAddRow] = useState(false);
  const [addingVolunteer, setAddingVolunteer] = useState(false);
  const [removingVolunteer, setRemovingVolunteer] = useState(false);
  const [showAddressDialog, setShowAddressDialog] = useState(false);
  const [showChangeDeviceTypeDialog, setShowChangeDeviceTypeDialog] = useState(false);
  const [deviceTypeValue, setDeviceTypeValue] = useState("");
  const [deviceTypeOtherText, setDeviceTypeOtherText] = useState("altro");
  const [isDeviceTypeOther, setIsDeviceTypeOther] = useState(false);
  const [savingDeviceType, setSavingDeviceType] = useState(false);
  const [addressForm, setAddressForm] = useState<ShippingAddress>({
    fullName: "", street: "", city: "", province: "", postalCode: "", country: "IT",
  });
  const [savingAddress, setSavingAddress] = useState(false);
  const toast = useRef<any>(null);

  /**
   * Recupera il nome completo di un utente dato il suo userId.
   * Se non trova il profilo privato, ritorna lo userId.
   */
  async function getUserFullName(userId: string): Promise<string> {
    if (!userId || userId.includes("/")) return userId;
    const profileRef = doc(db, "users", userId, "private", "profile");
    const profileSnap = await getDoc(profileRef);
    if (profileSnap.exists()) {
      const data = profileSnap.data();
      const firstName = data.firstName || "";
      const lastName = data.lastName || "";
      const fullName = `${firstName} ${lastName}`.trim();
      return fullName || userId;
    }
    return userId;
  }

  const loadData = useCallback(async () => {
    if (!id) return;
    const docSnap = await getDoc(doc(db, "deviceRequests", id));
    if (docSnap.exists()) {
      const data = docSnap.data();
      if (data.assignedVolunteers?.length) {
        const volunteerNames = await Promise.all(
          data.assignedVolunteers.map((uid: string) => getUserFullName(uid))
        );
        setRequest({
          ...data,
          assignedVolunteerName: volunteerNames.join(", "),
        });
      } else {
        setRequest(data);
      }
    } else {
      toast.current?.show({
        severity: "error",
        summary: "Errore",
        detail: "Richiesta non trovata.",
        life: 4000,
      });
      setRequest(null);
      return;
    }
    // Load private data
    const privateSnap = await getDoc(doc(db, "deviceRequests", id, "private", "data"));
    setPrivateData(privateSnap.exists() ? privateSnap.data() : null);

    // Load public data (contains devicetype and publicStatus)
    const publicSnap = await getDoc(doc(db, "publicDeviceRequests", id));
    if (publicSnap.exists()) {
      const publicData = publicSnap.data();
      setRequest((prev: any) => ({
        ...prev,
        deviceType: publicData.devicetype ?? prev?.deviceType,
        publicStatus: publicData.publicStatus ?? prev?.publicStatus,
      }));
    }



    const q = query(
      collection(db, "deviceRequests", id, "events"),
      orderBy("timestamp", "desc")
    );
    const snapshot = await getDocs(q);
    const eventsData = snapshot.docs.map((doc) => doc.data());

    // Arricchisci gli eventi con nome e cognome usando getUserFullName
    const enrichedEvents = await Promise.all(
      eventsData.map(async (ev) => ({
        ...ev,
        userName: ev.createdBy ? await getUserFullName(ev.createdBy) : "-"
      }))
    );

    setEvents(enrichedEvents);
  }, [id]);

  const fetchVolunteers = useCallback(async () => {
    // Recupera tutti gli utenti, poi per ciascuno prendi il profilo privato
    const usersSnapshot = await getDocs(collection(db, "users"));
    const userProfiles = await Promise.all(
      usersSnapshot.docs
        .filter((userDoc) => userDoc.data().active === true)
        .map(async (userDoc) => {
          const profileSnap = await getDoc(doc(db, "users", userDoc.id, "private", "profile"));
          if (profileSnap.exists()) {
            return { id: userDoc.id, ...profileSnap.data() };
          }
          return null;
        })
    );

    // Filtra solo i volontari e ordina per firstName
    const list = userProfiles
      .filter((u): u is NonNullable<typeof u> => !!u);
    setVolunteers(list);
  }, []);

  useEffect(() => {
    if (!id) return;
    loadData();
    fetchVolunteers();
  }, [id, loadData, fetchVolunteers]);

  useEffect(() => {
    if (!showAssignVolunteerDialog) {
      setSelectedToRemove([]);
      setVolunteerToAdd(null);
      setShowAddRow(false);
      return;
    }
    const uids: string[] = (request?.assignedVolunteers as string[]) ?? [];
    Promise.all(
      uids.map(async (uid: string) => ({
        id: uid,
        label: await getUserFullName(uid),
      }))
    ).then(setAssignedVolunteersList);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showAssignVolunteerDialog]);

  const handleChangeStatus = async () => {
    const fn = httpsCallable(functions, "changeStatus");
    const effectiveNote = note.trim() || `cambio stato da "${request?.status}" a "${newStatus}"`;
    await fn({
      requestId: id,
      newStatus,
      note: effectiveNote
    });
    toast.current?.show({
      severity: "success",
      summary: "Stato aggiornato",
      detail: "Lo stato della richiesta è stato aggiornato.",
      life: 3000,
    });
    setShowChangeStatusDialog(false);
    await loadData();
  };

  const handleAddVolunteerToList = async () => {
    if (!volunteerToAdd || !id) return;
    setAddingVolunteer(true);
    try {
      const fn = httpsCallable(functions, "assignVolunteer");
      const newList = [...assignedVolunteersList.map((v) => v.id), volunteerToAdd.id];
      await fn({ deviceId: id, userId: newList });
      const label = await getUserFullName(volunteerToAdd.id);
      setAssignedVolunteersList((prev) => [...prev, { id: volunteerToAdd.id, label }]);
      setVolunteerToAdd(null);
      setShowAddRow(false);
      await loadData();
      toast.current?.show({
        severity: "success",
        summary: "Volontario aggiunto",
        detail: `${label} è stato aggiunto alla richiesta.`,
        life: 3000,
      });
    } catch (err: any) {
      toast.current?.show({
        severity: "error",
        summary: "Errore",
        detail: err?.message || "Errore durante l'aggiunta del volontario.",
        life: 4000,
      });
    }
    setAddingVolunteer(false);
  };

  const handleRemoveFromList = async () => {
    if (!selectedToRemove.length || !id) return;
    setRemovingVolunteer(true);
    try {
      const fn = httpsCallable(functions, "assignVolunteer");
      const newList = assignedVolunteersList
        .filter((v) => !selectedToRemove.find((r) => r.id === v.id))
        .map((v) => v.id);
      await fn({ deviceId: id, userId: newList });
      const removedNames = selectedToRemove.map((v) => v.label).join(", ");
      setAssignedVolunteersList((prev) =>
        prev.filter((v) => !selectedToRemove.find((r) => r.id === v.id))
      );
      setSelectedToRemove([]);
      await loadData();
      toast.current?.show({
        severity: "success",
        summary: "Rimosso",
        detail: `${removedNames} rimosso/i dalla richiesta.`,
        life: 3000,
      });
    } catch (err: any) {
      toast.current?.show({
        severity: "error",
        summary: "Errore",
        detail: err?.message || "Errore durante la rimozione.",
        life: 4000,
      });
    }
    setRemovingVolunteer(false);
  };

  const handleAddNote = async () => {
    if (!id || !noteText.trim()) return;
    try {
      // Recupera lo stato precedente (ultimo evento)
      const lastEvent = events[0];
      const previousStatus = lastEvent?.status || request.status || "sconosciuto";

      // Aggiungi evento come cambiamento di stato con lo stesso stato precedente e nota
      const fn = httpsCallable(functions, "changeStatus");
      await fn({
        requestId: id,
        newStatus: previousStatus,
        note: noteText.trim()
      });
      toast.current?.show({
        severity: "success",
        summary: "Nota aggiunta",
        detail: "Nota aggiunta alla cronologia.",
        life: 3000,
      });
      setShowAddNoteDialog(false);
      setNoteText("");
      await loadData();
    } catch (error: any) {
      toast.current?.show({
        severity: "error",
        summary: "Errore",
        detail: error?.message || "Errore durante l'aggiunta della nota.",
        life: 4000,
      });
    }
  };

  const DEVICE_TYPE_OPTIONS = [
    "Kinetic Hand",
    "Kinetic Arm",
    "Bike Adapter",
    "Guitar Pick",
    "Kwawu Arm",
    "Device Batteria",
    "Kwawu Gripper",
    "Phoenix Hand",
  ];

  const handleSaveDeviceType = async () => {
    if (!id) return;
    setSavingDeviceType(true);
    try {
      const newDeviceType = isDeviceTypeOther ? deviceTypeOtherText.trim() : deviceTypeValue;
      await updateDoc(doc(db, "publicDeviceRequests", id), { devicetype: newDeviceType });
      setRequest((prev: any) => ({ ...prev, deviceType: newDeviceType }));
      toast.current?.show({ severity: "success", summary: "Salvato", detail: "Tipo device aggiornato.", life: 3000 });
      setShowChangeDeviceTypeDialog(false);
    } catch (err: any) {
      toast.current?.show({ severity: "error", summary: "Errore", detail: err?.message || "Errore durante il salvataggio.", life: 4000 });
    }
    setSavingDeviceType(false);
  };

  const handleSaveAddress = async () => {
    if (!id) return;
    setSavingAddress(true);
    try {
      const addr: ShippingAddress = { ...addressForm };
      if (!addr.phone) delete addr.phone;
      if (!addr.notes) delete addr.notes;
      await updateDoc(doc(db, "deviceRequests", id), { shippingAddress: addr });
      setRequest((prev: any) => ({ ...prev, shippingAddress: addr }));
      toast.current?.show({ severity: "success", summary: "Salvato", detail: "Indirizzo aggiornato.", life: 3000 });
      setShowAddressDialog(false);
    } catch (err: any) {
      toast.current?.show({ severity: "error", summary: "Errore", detail: err?.message || "Errore durante il salvataggio.", life: 4000 });
    }
    setSavingAddress(false);
  };

  const goBack = () => {
    window.history.back();
  };

  const leftToolbarTemplate = () => (
    <Button
      label="Indietro"
      icon="pi pi-arrow-left"
      className="p-button-text"
      onClick={goBack}
    />
  );

  if (!request) return <div>Loading...</div>;

  return (
    <div style={{ padding: 20 }}>
      <Toast ref={toast} />
      <Toolbar left={leftToolbarTemplate} style={{ marginBottom: 16 }} />
      <h2>Request Detail</h2>

      <div className="p-panel p-component" style={{ marginBottom: 30 }}>
        <div className="p-panel-header">
          <span>Dettagli richiesta</span>
        </div>
        <div className="p-panel-content">
          <div style={{ display: "flex", gap: 40 }}>
            <div style={{ flex: 1 }}>
              <div style={{ marginBottom: 10, display: "flex", alignItems: "center", gap: 8 }}>
                <strong>Device:</strong>
                <span>{request.deviceType || '-'}</span>
                <Button
                  label="Modifica"
                  icon="pi pi-pencil"
                  className="p-button-text"
                  onClick={() => {
                    const currentType = request.deviceType ?? "";
                    if (!currentType || DEVICE_TYPE_OPTIONS.includes(currentType)) {
                      setDeviceTypeValue(currentType);
                      setIsDeviceTypeOther(false);
                      setDeviceTypeOtherText("altro");
                    } else {
                      setIsDeviceTypeOther(true);
                      setDeviceTypeOtherText(currentType);
                      setDeviceTypeValue("");
                    }
                    setShowChangeDeviceTypeDialog(true);
                  }}
                />
              </div>
              <div style={{ marginBottom: 10, display: "flex", alignItems: "center", gap: 8 }}>
                <strong>Status:</strong>
                <span style={{ marginLeft: 8 }}>
                  <Badge value={request.status} severity="info" />
                </span>
                <Button
                  label="Cambia Stato"
                  icon="pi pi-pencil"
                  className="p-button-text"
                  style={{ marginLeft: 8 }}
                  onClick={() => setShowChangeStatusDialog(true)}
                />
              </div>
              <div style={{ marginBottom: 10 }}>
                <strong>Stato pubblico:</strong>
                {request.publicStatus ? (
                  <span style={{ marginLeft: 8 }}>
                    <Badge value={request.publicStatus} severity="warning" />
                  </span>
                ) : (
                  <span style={{ marginLeft: 8 }}>-</span>
                )}
              </div>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ marginBottom: 10 }}>
                <strong>Volontario associato:</strong>{" "}
                {request.assignedVolunteerName
                  ? request.assignedVolunteerName
                  : request.assignedVolunteers?.length
                    ? request.assignedVolunteers.join(", ")
                    : "-"}
                <Button
                  label="Associa volontario"
                  icon="pi pi-pencil"
                  className="p-button-text"
                  style={{ marginLeft: 8 }}
                  onClick={() => setShowAssignVolunteerDialog(true)}
                />
              </div>
              <div style={{ marginBottom: 10 }}>
                <strong>Data creazione:</strong>{" "}
                {request.createdAt?.toDate
                  ? request.createdAt.toDate().toLocaleString()
                  : "-"}
              </div>
              <div style={{ marginBottom: 10 }}>
                <strong>Ultimo aggiornamento:</strong>{" "}
                {request.updatedAt?.toDate
                  ? request.updatedAt.toDate().toLocaleString()
                  : "-"}
              </div>
              <div style={{ marginBottom: 10 }}>
                <strong>N° richiesta:</strong> {request.requestNumber || "-"}
              </div>
              <div style={{ marginBottom: 10 }}>
                <strong>ID sequenziale:</strong> {request.seqId ?? "-"}
              </div>
              <div style={{ marginBottom: 10 }}>
                <strong>Età:</strong> {request.age ?? "-"}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="p-panel p-component" style={{ marginBottom: 30 }}>
        <div className="p-panel-header">
          <span>Dati richiedente (privati)</span>
        </div>
        <div className="p-panel-content">
          {privateData ? (
            <div style={{ display: "flex", gap: 40 }}>
              <div style={{ flex: 1 }}>
                <div style={{ marginBottom: 10 }}>
                  <strong>Email:</strong> {privateData.email || "-"}
                </div>
                <div style={{ marginBottom: 10 }}>
                  <strong>Nome:</strong> {privateData.firstName || "-"}
                </div>
                <div style={{ marginBottom: 10 }}>
                  <strong>Cognome:</strong> {privateData.lastName || "-"}
                </div>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ marginBottom: 10 }}>
                  <strong>Consenso privacy:</strong> {privateData.consentPrivacy ? "Sì" : "No"}
                </div>
                <div style={{ marginBottom: 10 }}>
                  <strong>Telefono:</strong> {privateData.phone || "-"}
                </div>
                <div style={{ marginBottom: 10 }}>
                  <strong>Descrizione:</strong> {privateData.description || "-"}
                </div>
                <div style={{ marginBottom: 10 }}>
                  <strong>Tipo amputazione:</strong> {privateData.amputationType || "-"}
                </div>
                <div style={{ marginBottom: 10 }}>
                  <strong>Preferenze:</strong> {privateData.preferences || "-"}
                </div>
              </div>
            </div>
          ) : (
            <div>Nessun dato privato disponibile.</div>
          )}
        </div>
      </div>

      {/* Indirizzo di spedizione */}
      <div className="p-panel p-component" style={{ marginBottom: 30 }}>
        <div className="p-panel-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>Indirizzo di spedizione</span>
          <Button
            label="Modifica"
            icon="pi pi-pencil"
            className="p-button-text"
            onClick={() => {
              const addr = request.shippingAddress;
              setAddressForm(addr ? { ...{ phone: "", notes: "", ...addr } } : { fullName: "", street: "", city: "", province: "", postalCode: "", country: "IT", phone: "", notes: "" });
              setShowAddressDialog(true);
            }}
          />
        </div>
        <div className="p-panel-content">
          {request.shippingAddress?.street ? (
            <div style={{ display: "flex", gap: 40 }}>
              <div style={{ flex: 1 }}>
                <div style={{ marginBottom: 8 }}><strong>Nominativo:</strong> {request.shippingAddress.fullName || "-"}</div>
                <div style={{ marginBottom: 8 }}><strong>Via:</strong> {request.shippingAddress.street}</div>
                <div style={{ marginBottom: 8 }}><strong>CAP:</strong> {request.shippingAddress.postalCode}</div>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ marginBottom: 8 }}><strong>Città:</strong> {request.shippingAddress.city}</div>
                <div style={{ marginBottom: 8 }}><strong>Provincia:</strong> {request.shippingAddress.province}</div>
                <div style={{ marginBottom: 8 }}><strong>Paese:</strong> {request.shippingAddress.country}</div>
                {request.shippingAddress.phone && <div style={{ marginBottom: 8 }}><strong>Telefono:</strong> {request.shippingAddress.phone}</div>}
                {request.shippingAddress.notes && <div style={{ marginBottom: 8 }}><strong>Note:</strong> {request.shippingAddress.notes}</div>}
              </div>
            </div>
          ) : (
            <div style={{ color: "#888" }}>Nessun indirizzo di spedizione inserito.</div>
          )}
        </div>
      </div>

      {/* Ultimo stato come panel con bottone e dialog */}
      <Panel
        header={
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span>Ultimo evento</span>
            <Button
              label="Aggiungi nota"
              icon="pi pi-plus"
              className="p-button-text"
              onClick={() => setShowAddNoteDialog(true)}
            />
          </div>
        }
        style={{ marginBottom: 30 }}
      >
        {events.length > 0 ? (
          <div>
            <strong>{events[0].status}</strong>
            <div>
              <span>
                {events[0].timestamp?.toDate
                  ? events[0].timestamp.toDate().toLocaleString()
                  : "-"}
              </span>
            </div>
            {events[0].note && (
              <div>
                <strong>Nota:</strong> {events[0].note}
              </div>
            )}
          </div>
        ) : (
          <div>Nessun evento disponibile.</div>
        )}
      </Panel>

      {/* Dialog indirizzo di spedizione */}
      <Dialog
        header="Indirizzo di spedizione"
        visible={showAddressDialog}
        style={{ width: "560px" }}
        modal
        onHide={() => setShowAddressDialog(false)}
        footer={
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <Button label="Annulla" className="p-button-text" onClick={() => setShowAddressDialog(false)} disabled={savingAddress} />
            <Button label="Salva" icon="pi pi-check" onClick={handleSaveAddress} loading={savingAddress} />
          </div>
        }
      >
        {([
          { label: "Nominativo", field: "fullName" as keyof ShippingAddress },
          { label: "Via / Indirizzo", field: "street" as keyof ShippingAddress },
          { label: "Città", field: "city" as keyof ShippingAddress },
          { label: "CAP", field: "postalCode" as keyof ShippingAddress },
          { label: "Paese", field: "country" as keyof ShippingAddress },
          { label: "Telefono", field: "phone" as keyof ShippingAddress },
          { label: "Note", field: "notes" as keyof ShippingAddress },
        ] as { label: string; field: keyof ShippingAddress }[]).map(({ label, field }) => (
          <div key={field} style={{ marginBottom: 12 }}>
            <label style={{ display: "block", fontWeight: 500, marginBottom: 4 }}>{label}</label>
            <InputText
              value={(addressForm[field] as string) ?? ""}
              onChange={(e) => setAddressForm((f) => ({ ...f, [field]: e.target.value }))}
              style={{ width: "100%" }}
            />
          </div>
        ))}
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: "block", fontWeight: 500, marginBottom: 4 }}>Provincia</label>
          <Dropdown
            value={addressForm.province}
            options={provinceList}
            onChange={(e) => setAddressForm((f) => ({ ...f, province: e.value }))}
            placeholder="Seleziona provincia"
            style={{ width: "100%" }}
            filter
          />
        </div>
      </Dialog>

      {/* Dialog per cambio stato */}
      <Dialog
        header="Cambia stato richiesta"
        visible={showChangeStatusDialog}
        style={{ width: "500px" }}
        modal
        onHide={() => setShowChangeStatusDialog(false)}
      >
        <div style={{ marginBottom: 15 }}>
          <Dropdown
            value={newStatus}
            options={REQUEST_STATUSES}
            onChange={(e) => setNewStatus(e.value)}
            placeholder="Seleziona stato"
            className="mb-3"
            style={{ width: "100%" }}
          />
        </div>
        <div style={{ marginBottom: 15 }}>
          <label htmlFor="note" style={{ display: "block", marginBottom: 5 }}>
            Note
          </label>
          <InputTextarea
            id="note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            className="mb-3"
            style={{ width: "100%" }}
          />
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <Button label="Annulla" className="p-button-text" onClick={() => setShowChangeStatusDialog(false)} />
          <Button label="Conferma" onClick={handleChangeStatus} />
        </div>
      </Dialog>

      {/* Dialog per associare volontario */}
      <Dialog
        header="Gestisci volontari associati"
        visible={showAssignVolunteerDialog}
        style={{ width: "480px" }}
        modal
        onHide={() => setShowAssignVolunteerDialog(false)}
      >
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: "block", marginBottom: 6, fontWeight: 600 }}>
            Volontari associati
          </label>
          <ListBox
            multiple
            value={selectedToRemove}
            options={assignedVolunteersList}
            optionLabel="label"
            onChange={(e) => setSelectedToRemove(e.value ?? [])}
            style={{ width: "100%" }}
            listStyle={{ maxHeight: "180px" }}
            emptyMessage="Nessun volontario associato"
          />
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <Button
            label={showAddRow ? "Annulla aggiunta" : "Aggiungi"}
            icon={showAddRow ? "pi pi-times" : "pi pi-plus"}
            className="p-button-sm p-button-outlined"
            onClick={() => { setShowAddRow(!showAddRow); setVolunteerToAdd(null); }}
          />
          <Button
            label="Rimuovi selezionati"
            icon="pi pi-trash"
            className="p-button-sm p-button-outlined p-button-danger"
            disabled={!selectedToRemove.length || removingVolunteer}
            loading={removingVolunteer}
            onClick={handleRemoveFromList}
          />
        </div>
        {showAddRow && (
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
            <Dropdown
              value={volunteerToAdd}
              options={volunteers.filter((v) => !assignedVolunteersList.some((a) => a.id === v.id))}
              optionLabel="firstName"
              itemTemplate={(opt) =>
                opt ? <span>{opt.firstName} {opt.lastName}</span> : null
              }
              valueTemplate={(opt) =>
                opt ? <span>{opt.firstName} {opt.lastName}</span> : <span>Seleziona volontario</span>
              }
              onChange={(e) => setVolunteerToAdd(e.value)}
              placeholder="Seleziona volontario"
              style={{ flex: 1 }}
              filter
              showClear
            />
            <Button
              label="Aggiungi"
              icon="pi pi-check"
              className="p-button-sm"
              disabled={!volunteerToAdd || addingVolunteer}
              loading={addingVolunteer}
              onClick={handleAddVolunteerToList}
            />
          </div>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <Button
            label="Chiudi"
            className="p-button-text"
            onClick={() => setShowAssignVolunteerDialog(false)}
          />
        </div>
      </Dialog>

      {/* Dialog per aggiungere nota */}
      <Dialog
        header="Aggiungi nota"
        visible={showAddNoteDialog}
        style={{ width: "400px" }}
        modal
        onHide={() => setShowAddNoteDialog(false)}
      >
        <div style={{ marginBottom: 15 }}>
          <label htmlFor="noteText" style={{ display: "block", marginBottom: 5 }}>
            Testo nota
          </label>
          <InputTextarea
            id="noteText"
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            rows={3}
            style={{ width: "100%" }}
          />
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <Button label="Annulla" className="p-button-text" onClick={() => setShowAddNoteDialog(false)} />
          <Button label="Aggiungi" onClick={handleAddNote} disabled={!noteText.trim()} />
        </div>
      </Dialog>

      {/* Dialog per tipo device */}
      <Dialog
        header="Tipo device"
        visible={showChangeDeviceTypeDialog}
        style={{ width: "420px" }}
        modal
        onHide={() => setShowChangeDeviceTypeDialog(false)}
        footer={
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <Button label="Annulla" className="p-button-text" onClick={() => setShowChangeDeviceTypeDialog(false)} disabled={savingDeviceType} />
            <Button
              label="Salva"
              icon="pi pi-check"
              onClick={handleSaveDeviceType}
              loading={savingDeviceType}
              disabled={isDeviceTypeOther ? !deviceTypeOtherText.trim() : !deviceTypeValue}
            />
          </div>
        }
      >
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: "block", fontWeight: 500, marginBottom: 6 }}>Tipo device</label>
          <Dropdown
            value={deviceTypeValue}
            options={DEVICE_TYPE_OPTIONS}
            onChange={(e) => setDeviceTypeValue(e.value)}
            placeholder="Seleziona tipo"
            style={{ width: "100%" }}
            disabled={isDeviceTypeOther}
          />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <Checkbox
            inputId="deviceTypeOther"
            checked={isDeviceTypeOther}
            onChange={(e) => {
              setIsDeviceTypeOther(e.checked ?? false);
              if (e.checked) setDeviceTypeValue("");
            }}
          />
          <label htmlFor="deviceTypeOther" style={{ cursor: "pointer" }}>Altro</label>
        </div>
        <div style={{ marginBottom: 12 }}>
          <InputText
            value={deviceTypeOtherText}
            onChange={(e) => setDeviceTypeOtherText(e.target.value)}
            style={{ width: "100%" }}
            placeholder="Inserisci tipo device"
            disabled={!isDeviceTypeOther}
          />
        </div>
      </Dialog>

      {/* Timeline collapsable */}
      <Panel
        header="Cronologia gestione richiesta"
        toggleable
        collapsed={!timelineOpen}
        onToggle={() => setTimelineOpen(!timelineOpen)}
        style={{ marginBottom: 30 }}
      >
        <RequestTimeline events={events} />
      </Panel>
    </div>
  );
}

