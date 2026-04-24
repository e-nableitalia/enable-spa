import { useParams } from "react-router-dom";
import { useEffect, useState, useRef, useCallback } from "react";
import { doc, getDoc, collection, query, orderBy, getDocs, updateDoc, serverTimestamp } from "firebase/firestore";
import { db, functions, auth } from "../../../firebase";
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
  const [notificaVolontari, setNotificaVolontari] = useState(false);
  const [notificaAdmin, setNotificaAdmin] = useState(false);
  const [notificaTelegram, setNotificaTelegram] = useState(false);
  const [showAssignVolunteerDialog, setShowAssignVolunteerDialog] = useState(false);
  const [showAddNoteDialog, setShowAddNoteDialog] = useState(false);
  const [noteNotificaVolontari, setNoteNotificaVolontari] = useState(false);
  const [noteNotificaAdmin, setNoteNotificaAdmin] = useState(false);
  const [noteNotificaTelegram, setNoteNotificaTelegram] = useState(false);
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

  // ── Validazione richiesta (status "inviata") ─────────────────────────────
  const [showValidateDialog, setShowValidateDialog] = useState(false);
  const [validating, setValidating] = useState(false);
  const [validationForm, setValidationForm] = useState({
    recipient: "",
    relation: "",
    descriptionPublic: "",
    preferencesPublic: "",
    // campi privati correggibili in fase di validazione
    email: "",
    firstName: "",
    lastName: "",
    amputationType: "",
    // tipo device (su publicDeviceRequests)
    deviceTypeVal: "",
  });
  // gestione "altro" per tipo device nel form di validazione
  const [valIsDeviceTypeOther, setValIsDeviceTypeOther] = useState(false);
  const [valDeviceTypeOtherText, setValDeviceTypeOtherText] = useState("");
  const [deviceTypeValue, setDeviceTypeValue] = useState("");
  const [deviceTypeOtherText, setDeviceTypeOtherText] = useState("altro");
  const [isDeviceTypeOther, setIsDeviceTypeOther] = useState(false);
  const [savingDeviceType, setSavingDeviceType] = useState(false);
  const [addressForm, setAddressForm] = useState<ShippingAddress>({
    fullName: "", street: "", city: "", province: "", postalCode: "", country: "IT",
  });
  const [savingAddress, setSavingAddress] = useState(false);

  // ── Modifica dati privati ─────────────────────────────────────────────────
  const [showEditPrivateDialog, setShowEditPrivateDialog] = useState(false);
  const [privateForm, setPrivateForm] = useState({ email: "", firstName: "", lastName: "", amputationType: "", phone: "" });
  const [privateNote, setPrivateNote] = useState("");
  const [savingPrivate, setSavingPrivate] = useState(false);

  // ── Modifica dati pubblici ────────────────────────────────────────────────
  const [showEditPublicDialog, setShowEditPublicDialog] = useState(false);
  const [publicForm, setPublicForm] = useState({ recipient: "", relation: "", descriptionPublic: "", preferencesPublic: "" });
  const [publicNote, setPublicNote] = useState("");
  const [savingPublic, setSavingPublic] = useState(false);

  // ── Flag "richiede attenzione" ────────────────────────────────────────────
  const [showAttentionDialog, setShowAttentionDialog] = useState(false);
  const [attentionNote, setAttentionNote] = useState("");
  const [savingAttention, setSavingAttention] = useState(false);
  const [attentionNotificaVolontari, setAttentionNotificaVolontari] = useState(false);
  const [attentionNotificaTelegram, setAttentionNotificaTelegram] = useState(false);

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
    const privateDataLoaded = privateSnap.exists() ? privateSnap.data() : null;
    setPrivateData(privateDataLoaded);

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

    // Pre-fill validation form only with existing operational fields (if already saved).
    // Private data fallback is now explicit via the copy buttons in the UI.
    setRequest((prev: any) => {
      if (prev) {
        setValidationForm({
          recipient: prev.recipient || "",
          relation: prev.relation || "",
          descriptionPublic: prev.descriptionPublic || "",
          preferencesPublic: prev.preferencesPublic || "",
          email: privateDataLoaded?.email || "",
          firstName: privateDataLoaded?.firstName || "",
          lastName: privateDataLoaded?.lastName || "",
          amputationType: privateDataLoaded?.amputationType || "",
          deviceTypeVal: prev.deviceType || "",
        });
        // init "altro" toggle for device type
        const currentDevice = prev.deviceType || "";
        if (currentDevice && !DEVICE_TYPE_OPTIONS.includes(currentDevice)) {
          setValIsDeviceTypeOther(true);
          setValDeviceTypeOtherText(currentDevice);
        } else {
          setValIsDeviceTypeOther(false);
          setValDeviceTypeOtherText("");
        }
      }
      return prev;
    });

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
    const notifica = (notificaAdmin || notificaVolontari || notificaTelegram)
      ? { admin: notificaAdmin, volunteers: notificaVolontari, telegram: notificaTelegram }
      : undefined;
    await fn({
      requestId: id,
      newStatus,
      note: effectiveNote,
      ...(notifica ? { notifica } : {}),
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

      const notifica = (noteNotificaAdmin || noteNotificaVolontari || noteNotificaTelegram)
        ? { admin: noteNotificaAdmin, volunteers: noteNotificaVolontari, telegram: noteNotificaTelegram }
        : undefined;

      // Aggiungi evento come cambiamento di stato con lo stesso stato precedente e nota
      const fn = httpsCallable(functions, "changeStatus");
      await fn({
        requestId: id,
        newStatus: previousStatus,
        note: noteText.trim(),
        ...(notifica ? { notifica } : {}),
      });
      toast.current?.show({
        severity: "success",
        summary: "Nota aggiunta",
        detail: "Nota aggiunta alla cronologia.",
        life: 3000,
      });
      setShowAddNoteDialog(false);
      setNoteText("");
      setNoteNotificaVolontari(false);
      setNoteNotificaAdmin(false);
      setNoteNotificaTelegram(false);
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
      const fn = httpsCallable(functions, "changeStatus");
      await fn({
        requestId: id,
        newStatus: request?.status,
        note: `Tipo device aggiornato: ${newDeviceType}.`,
      });
      toast.current?.show({ severity: "success", summary: "Salvato", detail: "Tipo device aggiornato.", life: 3000 });
      setShowChangeDeviceTypeDialog(false);
      await loadData();
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
      const fn = httpsCallable(functions, "changeStatus");
      await fn({
        requestId: id,
        newStatus: request?.status,
        note: "Indirizzo di spedizione aggiornato.",
      });
      toast.current?.show({ severity: "success", summary: "Salvato", detail: "Indirizzo aggiornato.", life: 3000 });
      setShowAddressDialog(false);
      await loadData();
    } catch (err: any) {
      toast.current?.show({ severity: "error", summary: "Errore", detail: err?.message || "Errore durante il salvataggio.", life: 4000 });
    }
    setSavingAddress(false);
  };

  const handleSavePrivate = async () => {
    if (!id) return;
    setSavingPrivate(true);
    try {
      await updateDoc(doc(db, "deviceRequests", id, "private", "data"), {
        email: privateForm.email.trim(),
        firstName: privateForm.firstName.trim(),
        lastName: privateForm.lastName.trim(),
        amputationType: privateForm.amputationType.trim(),
        ...(privateForm.phone.trim() ? { phone: privateForm.phone.trim() } : {}),
      });
      setPrivateData((prev: any) => ({ ...prev, ...privateForm }));
      const fn = httpsCallable(functions, "changeStatus");
      await fn({
        requestId: id,
        newStatus: request?.status,
        note: privateNote.trim() || "Aggiornamento dati privati richiedente.",
      });
      setPrivateNote("");
      toast.current?.show({ severity: "success", summary: "Salvato", detail: "Dati privati aggiornati.", life: 3000 });
      setShowEditPrivateDialog(false);
      await loadData();
    } catch (err: any) {
      toast.current?.show({ severity: "error", summary: "Errore", detail: err?.message || "Errore durante il salvataggio.", life: 4000 });
    }
    setSavingPrivate(false);
  };

  const handleSavePublic = async () => {    if (!id) return;
    setSavingPublic(true);
    try {
      await updateDoc(doc(db, "deviceRequests", id), {
        recipient: publicForm.recipient.trim(),
        relation: publicForm.relation.trim(),
        descriptionPublic: publicForm.descriptionPublic.trim(),
        preferencesPublic: publicForm.preferencesPublic.trim(),
      });
      setRequest((prev: any) => ({ ...prev, ...publicForm }));
      const fn = httpsCallable(functions, "changeStatus");
      await fn({
        requestId: id,
        newStatus: request?.status,
        note: publicNote.trim() || "Aggiornamento dati pubblici richiedente.",
      });
      setPublicNote("");
      toast.current?.show({ severity: "success", summary: "Salvato", detail: "Dati pubblici aggiornati.", life: 3000 });
      setShowEditPublicDialog(false);
      await loadData();
    } catch (err: any) {
      toast.current?.show({ severity: "error", summary: "Errore", detail: err?.message || "Errore durante il salvataggio.", life: 4000 });
    }
    setSavingPublic(false);
  };

  const handleSetAttention = async () => {
    if (!id || !attentionNote.trim()) return;
    setSavingAttention(true);
    try {
      await updateDoc(doc(db, "deviceRequests", id), { requiresAttention: true });
      const fn = httpsCallable(functions, "changeStatus");
      await fn({
        requestId: id,
        newStatus: request?.status,
        note: `⚠️ Richiede attenzione: ${attentionNote.trim()}`,
        notifica: { admin: true, volunteers: attentionNotificaVolontari, telegram: attentionNotificaTelegram },
      });
      setRequest((prev: any) => ({ ...prev, requiresAttention: true }));
      toast.current?.show({ severity: "warn", summary: "Flag impostato", detail: "La richiesta è ora segnalata come 'richiede attenzione'.", life: 3000 });
      setShowAttentionDialog(false);
      setAttentionNote("");
      setAttentionNotificaVolontari(false);
      setAttentionNotificaTelegram(false);
      await loadData();
    } catch (err: any) {
      toast.current?.show({ severity: "error", summary: "Errore", detail: err?.message || "Errore durante il salvataggio.", life: 4000 });
    }
    setSavingAttention(false);
  };

  const handleClearAttention = async () => {
    if (!id) return;
    setSavingAttention(true);
    try {
      await updateDoc(doc(db, "deviceRequests", id), { requiresAttention: false });
      const fn = httpsCallable(functions, "changeStatus");
      await fn({ requestId: id, newStatus: request?.status, note: "✅ Flag 'richiede attenzione' rimosso." });
      setRequest((prev: any) => ({ ...prev, requiresAttention: false }));
      toast.current?.show({ severity: "success", summary: "Flag rimosso", detail: "La richiesta non richiede più attenzione.", life: 3000 });
      await loadData();
    } catch (err: any) {
      toast.current?.show({ severity: "error", summary: "Errore", detail: err?.message || "Errore durante il salvataggio.", life: 4000 });
    }
    setSavingAttention(false);
  };

  /**
   * Valida una richiesta con status "inviata":
   * 1. Salva i campi operativi in deviceRequests/{id}
   * 2. Aggiorna publicDeviceRequests/{id} con publicStatus = "da gestire"
   * 3. Cambia lo status interno a "famiglia contattata" via cloud function
   */
  const handleValidate = async () => {
    if (!id) return;
    setValidating(true);
    try {
      const adminUid = auth.currentUser?.uid ?? "";

      // 1. Salva campi operativi + metadati di validazione
      await updateDoc(doc(db, "deviceRequests", id), {
        recipient: validationForm.recipient.trim(),
        relation: validationForm.relation.trim(),
        descriptionPublic: validationForm.descriptionPublic.trim(),
        preferencesPublic: validationForm.preferencesPublic.trim(),
        validatedAt: serverTimestamp(),
        validatedBy: adminUid,
      });

      // 1b. Aggiorna dati privati correggibili
      await updateDoc(doc(db, "deviceRequests", id, "private", "data"), {
        email: validationForm.email.trim(),
        firstName: validationForm.firstName.trim(),
        lastName: validationForm.lastName.trim(),
        amputationType: validationForm.amputationType.trim(),
      });

      // 2. Rendi la richiesta visibile ai volontari (publicStatus) e aggiorna devicetype
      await updateDoc(doc(db, "publicDeviceRequests", id), {
        publicStatus: "da gestire",
        devicetype: valIsDeviceTypeOther ? valDeviceTypeOtherText.trim() : validationForm.deviceTypeVal.trim(),
      });

      // 3. Aggiorna lo status interno tramite cloud function (registra evento + cambia stato)
      const fn = httpsCallable(functions, "changeStatus");
      await fn({
        requestId: id,
        newStatus: "validata",
        note: "Richiesta validata dall'amministratore.",
      });

      toast.current?.show({
        severity: "success",
        summary: "Validazione completata",
        detail: "La richiesta è ora visibile ai volontari.",
        life: 4000,
      });
      setShowValidateDialog(false);
      await loadData();
    } catch (err: any) {
      toast.current?.show({
        severity: "error",
        summary: "Errore validazione",
        detail: err?.message || "Errore durante la validazione.",
        life: 5000,
      });
    }
    setValidating(false);
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
      {/* Dialog: segnala richiede attenzione */}
      <Dialog
        header="⚠️ Segnala richiede attenzione"
        visible={showAttentionDialog}
        style={{ width: "420px" }}
        modal
        onHide={() => setShowAttentionDialog(false)}
        footer={
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <Button label="Annulla" className="p-button-text" onClick={() => setShowAttentionDialog(false)} disabled={savingAttention} />
            <Button
              label="Conferma"
              icon="pi pi-exclamation-triangle"
              severity="warning"
              onClick={handleSetAttention}
              loading={savingAttention}
              disabled={!attentionNote.trim()}
            />
          </div>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <span>Inserisci una nota obbligatoria che descriva il motivo dell'attenzione richiesta.</span>
          <InputTextarea
            value={attentionNote}
            onChange={(e) => setAttentionNote(e.target.value)}
            rows={4}
            placeholder="Motivo attenzione..."
            style={{ width: "100%" }}
            autoFocus
          />
          <div>
            <label style={{ display: "block", marginBottom: 8, fontWeight: 600 }}>Notifiche</label>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, color: "#6b7280" }}>
                <input type="checkbox" checked disabled />
                Admin (devices@e-nableitalia.it) — sempre attivo
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                <input type="checkbox" checked={attentionNotificaVolontari} onChange={(e) => setAttentionNotificaVolontari(e.target.checked)} />
                Volontari assegnati
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                <input type="checkbox" checked={attentionNotificaTelegram} onChange={(e) => setAttentionNotificaTelegram(e.target.checked)} />
                Gruppo Telegram
              </label>
            </div>
          </div>
        </div>
      </Dialog>
      <Toolbar left={leftToolbarTemplate} style={{ marginBottom: 16 }} />
      <h2>Request Detail</h2>

      {/* ── Pannello validazione (visibile solo se status === "inviata") ── */}
      {request?.status === "inviata" && (
        <Panel
          header={
            <span style={{ color: "#92400e", fontWeight: 700 }}>
              <span className="pi pi-exclamation-triangle" style={{ marginRight: 8 }} />
              Richiesta da validare
            </span>
          }
          style={{ marginBottom: 24, border: "2px solid #fcd34d", background: "#fffbeb" }}
        >
          <p style={{ color: "#92400e", marginBottom: 16 }}>
            Questa richiesta è in attesa di validazione e non è ancora visibile ai volontari.
            Compila i campi operativi e conferma la validazione.
            <br /><br />
            <span className="pi pi-exclamation-triangle" style={{ marginRight: 6 }} />
            <strong>Attenzione:</strong> la descrizione e le preferenze pubbliche devono essere versioni
            sanificate dei testi originali: <strong>rimuovere tutti i dati sensibili</strong> (nomi,
            cognomi, indirizzi, recapiti telefonici, email e qualsiasi altro dato personale
            identificativo) prima di salvare.
          </p>

          {/* Riga 1: dati anagrafici privati correggibili */}
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 12 }}>
            <div style={{ flex: "1 1 180px" }}>
              <label htmlFor="val-firstName" style={{ display: "block", fontWeight: 600, marginBottom: 4 }}>Nome</label>
              <InputText
                id="val-firstName"
                value={validationForm.firstName}
                onChange={(e) => setValidationForm((f) => ({ ...f, firstName: e.target.value }))}
                style={{ width: "100%" }}
              />
              {privateData?.firstName && privateData.firstName !== validationForm.firstName && (
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
                  <Button icon="pi pi-copy" className="p-button-text p-button-sm p-button-secondary" style={{ padding: "2px 4px", height: "auto", minWidth: "auto" }} tooltip="Copia" onClick={() => setValidationForm((f) => ({ ...f, firstName: privateData.firstName }))} />
                  <small><strong>Dal modulo: {privateData.firstName}</strong></small>
                </div>
              )}
            </div>
            <div style={{ flex: "1 1 180px" }}>
              <label htmlFor="val-lastName" style={{ display: "block", fontWeight: 600, marginBottom: 4 }}>Cognome</label>
              <InputText
                id="val-lastName"
                value={validationForm.lastName}
                onChange={(e) => setValidationForm((f) => ({ ...f, lastName: e.target.value }))}
                style={{ width: "100%" }}
              />
              {privateData?.lastName && privateData.lastName !== validationForm.lastName && (
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
                  <Button icon="pi pi-copy" className="p-button-text p-button-sm p-button-secondary" style={{ padding: "2px 4px", height: "auto", minWidth: "auto" }} tooltip="Copia" onClick={() => setValidationForm((f) => ({ ...f, lastName: privateData.lastName }))} />
                  <small><strong>Dal modulo: {privateData.lastName}</strong></small>
                </div>
              )}
            </div>
            <div style={{ flex: "1 1 220px" }}>
              <label htmlFor="val-email" style={{ display: "block", fontWeight: 600, marginBottom: 4 }}>Email</label>
              <InputText
                id="val-email"
                value={validationForm.email}
                onChange={(e) => setValidationForm((f) => ({ ...f, email: e.target.value }))}
                style={{ width: "100%" }}
              />
              {privateData?.email && privateData.email !== validationForm.email && (
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
                  <Button icon="pi pi-copy" className="p-button-text p-button-sm p-button-secondary" style={{ padding: "2px 4px", height: "auto", minWidth: "auto" }} tooltip="Copia" onClick={() => setValidationForm((f) => ({ ...f, email: privateData.email }))} />
                  <small><strong>Dal modulo: {privateData.email}</strong></small>
                </div>
              )}
            </div>
          </div>

          {/* Riga 2: tipo amputazione e tipo device */}
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 12 }}>
            <div style={{ flex: "1 1 240px" }}>
              <label htmlFor="val-amputationType" style={{ display: "block", fontWeight: 600, marginBottom: 4 }}>Tipo amputazione</label>
              <Dropdown
                inputId="val-amputationType"
                value={validationForm.amputationType}
                options={[
                  "Mano, polso funzionale con parte residua di palmo",
                  "Braccio sotto il gomito",
                  "Braccio sopra il gomito",
                  "Altro",
                ]}
                onChange={(e) => setValidationForm((f) => ({ ...f, amputationType: e.value }))}
                placeholder="Seleziona tipo amputazione"
                style={{ width: "100%" }}
              />
              {privateData?.amputationType && privateData.amputationType !== validationForm.amputationType && (
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
                  <Button icon="pi pi-copy" className="p-button-text p-button-sm p-button-secondary" style={{ padding: "2px 4px", height: "auto", minWidth: "auto" }} tooltip="Copia" onClick={() => setValidationForm((f) => ({ ...f, amputationType: privateData.amputationType }))} />
                  <small><strong>Dal modulo: {privateData.amputationType}</strong></small>
                </div>
              )}
            </div>
            <div style={{ flex: "1 1 220px" }}>
              <label htmlFor="val-deviceType" style={{ display: "block", fontWeight: 600, marginBottom: 4 }}>Tipo device</label>
              <Dropdown
                inputId="val-deviceType"
                value={valIsDeviceTypeOther ? null : validationForm.deviceTypeVal}
                options={DEVICE_TYPE_OPTIONS}
                onChange={(e) => { setValidationForm((f) => ({ ...f, deviceTypeVal: e.value })); setValIsDeviceTypeOther(false); }}
                placeholder="Seleziona device"
                style={{ width: "100%" }}
                disabled={valIsDeviceTypeOther}
              />
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
                <Checkbox
                  inputId="val-deviceType-other"
                  checked={valIsDeviceTypeOther}
                  onChange={(e) => {
                    setValIsDeviceTypeOther(e.checked ?? false);
                    if (e.checked) setValidationForm((f) => ({ ...f, deviceTypeVal: "" }));
                  }}
                />
                <label htmlFor="val-deviceType-other" style={{ cursor: "pointer" }}>Altro</label>
              </div>
              {valIsDeviceTypeOther && (
                <InputText
                  value={valDeviceTypeOtherText}
                  onChange={(e) => setValDeviceTypeOtherText(e.target.value)}
                  placeholder="Inserisci tipo device"
                  style={{ width: "100%", marginTop: 6 }}
                />
              )}
            </div>
          </div>

          {/* Riga 3: destinatario e relazione */}
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 12 }}>
            <div style={{ flex: "1 1 220px" }}>
              <label htmlFor="val-recipient" style={{ display: "block", fontWeight: 600, marginBottom: 4 }}>
                Destinatario
              </label>
              <InputText
                id="val-recipient"
                value={validationForm.recipient}
                onChange={(e) => setValidationForm((f) => ({ ...f, recipient: e.target.value }))}
                placeholder="es. Marco..."
                style={{ width: "100%" }}
              />
            </div>
            <div style={{ flex: "1 1 220px" }}>
              <label htmlFor="val-relation" style={{ display: "block", fontWeight: 600, marginBottom: 4 }}>
                Relazione con il richiedente
              </label>
              <InputText
                id="val-relation"
                value={validationForm.relation}
                onChange={(e) => setValidationForm((f) => ({ ...f, relation: e.target.value }))}
                placeholder="es. genitore, coniuge..."
                style={{ width: "100%" }}
              />
              {privateData?.relation && (
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
                  <Button
                    icon="pi pi-copy"
                    className="p-button-text p-button-sm p-button-secondary"
                    style={{ padding: "2px 4px", height: "auto", minWidth: "auto" }}
                    tooltip="Copia nel campo"
                    tooltipOptions={{ position: "right" }}
                    onClick={() => setValidationForm((f) => ({ ...f, relation: privateData.relation }))}
                  />
                  <small>Dal modulo: <strong>{privateData.relation}</strong></small>
                </div>
              )}
            </div>
          </div>

          <div style={{ marginBottom: 12 }}>
            <label htmlFor="val-descPublic" style={{ display: "block", fontWeight: 600, marginBottom: 4 }}>
              Descrizione pubblica
            </label>
            <InputTextarea
              id="val-descPublic"
              value={validationForm.descriptionPublic}
              onChange={(e) => setValidationForm((f) => ({ ...f, descriptionPublic: e.target.value }))}
              rows={3}
              style={{ width: "100%" }}
              placeholder="Versione sanificata della descrizione (visibile ai volontari)"
            />
            {privateData?.description && (
              <div style={{ display: "flex", alignItems: "flex-start", gap: 6, marginTop: 4 }}>
                <Button
                  icon="pi pi-copy"
                  className="p-button-text p-button-sm p-button-secondary"
                  style={{ padding: "2px 4px", height: "auto", minWidth: "auto", flexShrink: 0 }}
                  tooltip="Copia nel campo"
                  tooltipOptions={{ position: "right" }}
                  onClick={() => setValidationForm((f) => ({ ...f, descriptionPublic: privateData.description }))}
                />
                <small>Dal modulo: <strong>{privateData.description}</strong></small>
              </div>
            )}
          </div>

          <div style={{ marginBottom: 16 }}>
            <label htmlFor="val-prefPublic" style={{ display: "block", fontWeight: 600, marginBottom: 4 }}>
              Preferenze pubbliche
            </label>
            <InputTextarea
              id="val-prefPublic"
              value={validationForm.preferencesPublic}
              onChange={(e) => setValidationForm((f) => ({ ...f, preferencesPublic: e.target.value }))}
              rows={2}
              style={{ width: "100%" }}
              placeholder="Versione sanificata delle preferenze (visibile ai volontari)"
            />
            {privateData?.preferences && (
              <div style={{ display: "flex", alignItems: "flex-start", gap: 6, marginTop: 4 }}>
                <Button
                  icon="pi pi-copy"
                  className="p-button-text p-button-sm p-button-secondary"
                  style={{ padding: "2px 4px", height: "auto", minWidth: "auto", flexShrink: 0 }}
                  tooltip="Copia nel campo"
                  tooltipOptions={{ position: "right" }}
                  onClick={() => setValidationForm((f) => ({ ...f, preferencesPublic: privateData.preferences }))}
                />
                <small>Dal modulo: <strong>{privateData.preferences}</strong></small>
              </div>
            )}
          </div>

          <Button
            label="Valida richiesta"
            icon="pi pi-check-circle"
            severity="warning"
            onClick={() => setShowValidateDialog(true)}
          />
        </Panel>
      )}

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
              <div style={{ marginBottom: 10, display: "flex", alignItems: "center", gap: 8 }}>
                <strong>Richiede attenzione:</strong>
                {request.requiresAttention
                  ? <Badge value="⚠️ Sì" severity="danger" />
                  : <span style={{ color: "#888" }}>No</span>
                }
                {request.requiresAttention
                  ? <Button
                      label="Rimuovi flag"
                      icon="pi pi-times"
                      className="p-button-text p-button-sm p-button-secondary"
                      loading={savingAttention}
                      onClick={handleClearAttention}
                    />
                  : <Button
                      label="Segnala"
                      icon="pi pi-exclamation-triangle"
                      className="p-button-text p-button-sm p-button-warning"
                      onClick={() => { setAttentionNote(""); setShowAttentionDialog(true); }}
                    />
                }
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
        <div className="p-panel-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>Dati richiedente (privati)</span>
          <Button
            label="Modifica"
            icon="pi pi-pencil"
            className="p-button-text"
            onClick={() => {
              setPrivateForm({
                email: privateData?.email || "",
                firstName: privateData?.firstName || "",
                lastName: privateData?.lastName || "",
                amputationType: privateData?.amputationType || "",
                phone: privateData?.phone || "",
              });
              setShowEditPrivateDialog(true);
            }}
          />
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

      {/* Dati richiedente (pubblici) */}
      <div className="p-panel p-component" style={{ marginBottom: 30 }}>
        <div className="p-panel-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>Dati richiedente (pubblici)</span>
          <Button
            label="Modifica"
            icon="pi pi-pencil"
            className="p-button-text"
            onClick={() => {
              setPublicForm({
                recipient: request.recipient || "",
                relation: request.relation || "",
                descriptionPublic: request.descriptionPublic || "",
                preferencesPublic: request.preferencesPublic || "",
              });
              setShowEditPublicDialog(true);
            }}
          />
        </div>
        <div className="p-panel-content">
          <div style={{ display: "flex", gap: 40 }}>
            <div style={{ flex: 1 }}>
              <div style={{ marginBottom: 10 }}>
                <strong>Destinatario:</strong> {request.recipient || "-"}
              </div>
              <div style={{ marginBottom: 10 }}>
                <strong>Relazione:</strong> {request.relation || "-"}
              </div>
            </div>
            <div style={{ flex: 2 }}>
              <div style={{ marginBottom: 10 }}>
                <strong>Descrizione pubblica:</strong>
                <div style={{ marginTop: 4, whiteSpace: "pre-wrap", color: request.descriptionPublic ? undefined : "#888" }}>
                  {request.descriptionPublic || "-"}
                </div>
              </div>
              <div style={{ marginBottom: 10 }}>
                <strong>Preferenze pubbliche:</strong>
                <div style={{ marginTop: 4, whiteSpace: "pre-wrap", color: request.preferencesPublic ? undefined : "#888" }}>
                  {request.preferencesPublic || "-"}
                </div>
              </div>
            </div>
          </div>
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
        <div style={{ marginBottom: 15 }}>
          <label style={{ display: "block", marginBottom: 8, fontWeight: 600 }}>Notifiche</label>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
              <input type="checkbox" checked={notificaVolontari} onChange={(e) => setNotificaVolontari(e.target.checked)} />
              Volontari assegnati
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
              <input type="checkbox" checked={notificaAdmin} onChange={(e) => setNotificaAdmin(e.target.checked)} />
              Admin (devices@e-nableitalia.it)
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
              <input type="checkbox" checked={notificaTelegram} onChange={(e) => setNotificaTelegram(e.target.checked)} />
              Gruppo Telegram
            </label>
          </div>
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
        <div style={{ marginBottom: 15 }}>
          <label style={{ display: "block", marginBottom: 8, fontWeight: 600 }}>Notifiche</label>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
              <input type="checkbox" checked={noteNotificaVolontari} onChange={(e) => setNoteNotificaVolontari(e.target.checked)} />
              Volontari assegnati
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
              <input type="checkbox" checked={noteNotificaAdmin} onChange={(e) => setNoteNotificaAdmin(e.target.checked)} />
              Admin (devices@e-nableitalia.it)
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
              <input type="checkbox" checked={noteNotificaTelegram} onChange={(e) => setNoteNotificaTelegram(e.target.checked)} />
              Gruppo Telegram
            </label>
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <Button label="Annulla" className="p-button-text" onClick={() => setShowAddNoteDialog(false)} />
          <Button label="Aggiungi" onClick={handleAddNote} disabled={!noteText.trim()} />
        </div>
      </Dialog>

      {/* Dialog modifica dati privati */}
      <Dialog
        header="Modifica dati richiedente (privati)"
        visible={showEditPrivateDialog}
        style={{ width: "520px" }}
        modal
        onHide={() => setShowEditPrivateDialog(false)}
        footer={
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <Button label="Annulla" className="p-button-text" onClick={() => setShowEditPrivateDialog(false)} disabled={savingPrivate} />
            <Button label="Salva" icon="pi pi-check" onClick={handleSavePrivate} loading={savingPrivate} />
          </div>
        }
      >
        {([
          { label: "Email", field: "email" },
          { label: "Nome", field: "firstName" },
          { label: "Cognome", field: "lastName" },
          { label: "Telefono", field: "phone" },
        ] as { label: string; field: keyof typeof privateForm }[]).map(({ label, field }) => (
          <div key={field} style={{ marginBottom: 12 }}>
            <label style={{ display: "block", fontWeight: 500, marginBottom: 4 }}>{label}</label>
            <InputText
              value={privateForm[field]}
              onChange={(e) => setPrivateForm((f) => ({ ...f, [field]: e.target.value }))}
              style={{ width: "100%" }}
            />
          </div>
        ))}
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: "block", fontWeight: 500, marginBottom: 4 }}>Tipo amputazione</label>
          <Dropdown
            value={privateForm.amputationType}
            options={[
              "Mano, polso funzionale con parte residua di palmo",
              "Braccio sotto il gomito",
              "Braccio sopra il gomito",
              "Altro",
            ]}
            onChange={(e) => setPrivateForm((f) => ({ ...f, amputationType: e.value }))}
            placeholder="Seleziona tipo amputazione"
            style={{ width: "100%" }}
          />
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: "block", fontWeight: 500, marginBottom: 4 }}>Nota (opzionale)</label>
          <InputTextarea
            value={privateNote}
            onChange={(e) => setPrivateNote(e.target.value)}
            rows={2}
            placeholder="Aggiungi una nota sull'aggiornamento..."
            style={{ width: "100%" }}
          />
        </div>
      </Dialog>

      {/* Dialog modifica dati pubblici */}
      <Dialog
        header="Modifica dati richiedente (pubblici)"
        visible={showEditPublicDialog}
        style={{ width: "560px" }}
        modal
        onHide={() => setShowEditPublicDialog(false)}
        footer={
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <Button label="Annulla" className="p-button-text" onClick={() => setShowEditPublicDialog(false)} disabled={savingPublic} />
            <Button label="Salva" icon="pi pi-check" onClick={handleSavePublic} loading={savingPublic} />
          </div>
        }
      >
        <div style={{ display: "flex", gap: 12, marginBottom: 12 }}>
          <div style={{ flex: 1 }}>
            <label style={{ display: "block", fontWeight: 500, marginBottom: 4 }}>Destinatario</label>
            <InputText
              value={publicForm.recipient}
              onChange={(e) => setPublicForm((f) => ({ ...f, recipient: e.target.value }))}
              style={{ width: "100%" }}
            />
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ display: "block", fontWeight: 500, marginBottom: 4 }}>Relazione con il richiedente</label>
            <InputText
              value={publicForm.relation}
              onChange={(e) => setPublicForm((f) => ({ ...f, relation: e.target.value }))}
              style={{ width: "100%" }}
            />
          </div>
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: "block", fontWeight: 500, marginBottom: 4 }}>Descrizione pubblica</label>
          <InputTextarea
            value={publicForm.descriptionPublic}
            onChange={(e) => setPublicForm((f) => ({ ...f, descriptionPublic: e.target.value }))}
            rows={4}
            style={{ width: "100%" }}
          />
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: "block", fontWeight: 500, marginBottom: 4 }}>Preferenze pubbliche</label>
          <InputTextarea
            value={publicForm.preferencesPublic}
            onChange={(e) => setPublicForm((f) => ({ ...f, preferencesPublic: e.target.value }))}
            rows={3}
            style={{ width: "100%" }}
          />
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: "block", fontWeight: 500, marginBottom: 4 }}>Nota (opzionale)</label>
          <InputTextarea
            value={publicNote}
            onChange={(e) => setPublicNote(e.target.value)}
            rows={2}
            placeholder="Aggiungi una nota sull'aggiornamento..."
            style={{ width: "100%" }}
          />
        </div>
      </Dialog>

      {/* Dialog conferma validazione richiesta */}
      <Dialog
        header="Conferma validazione"
        visible={showValidateDialog}
        style={{ width: "460px" }}
        modal
        onHide={() => setShowValidateDialog(false)}
        footer={
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <Button label="Annulla" className="p-button-text" onClick={() => setShowValidateDialog(false)} disabled={validating} />
            <Button
              label="Conferma validazione"
              icon="pi pi-check-circle"
              severity="warning"
              onClick={handleValidate}
              loading={validating}
            />
          </div>
        }
      >
        <p>
          Confermando, la richiesta sarà resa visibile ai volontari con stato{" "}
          <strong>«validata»</strong> e publicStatus <strong>«da gestire»</strong>.
          Questa operazione non può essere annullata automaticamente.
        </p>
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

