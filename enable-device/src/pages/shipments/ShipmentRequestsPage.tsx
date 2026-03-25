import { useEffect, useRef, useState } from "react";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  where,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { auth, db, functions } from "../../firebase";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Button } from "primereact/button";
import { Checkbox } from "primereact/checkbox";
import { Dialog } from "primereact/dialog";
import { Dropdown } from "primereact/dropdown";
import { InputText } from "primereact/inputtext";
import { InputTextarea } from "primereact/inputtextarea";
import { InputNumber } from "primereact/inputnumber";
import { Tag, type TagProps } from "primereact/tag";
import { Toast } from "primereact/toast";
import { ConfirmDialog, confirmDialog } from "primereact/confirmdialog";
import { ProgressSpinner } from "primereact/progressspinner";
import type { ShippingAddress } from "../../shared/types/shippingAddress";

type Status = "pending" | "approved" | "deleted";

interface ShipmentRequest {
  id: string;
  createdAt: unknown;
  createdBy: string;
  email: string;
  reason: string;
  senderName: string;
  senderAddress: string;
  senderNotes?: string;
  recipientName: string;
  recipientAddress: string;
  recipientPhone?: string;
  deliveryNotes?: string;
  length?: number;
  width?: number;
  height?: number;
  weight?: number;
  status: Status;
}

interface FormState {
  reason: string;
  senderName: string;
  senderAddress: string;
  senderNotes: string;
  recipientName: string;
  recipientAddress: string;
  recipientPhone: string;
  deliveryNotes: string;
  length: number | null;
  width: number | null;
  height: number | null;
  weight: number | null;
}

const EMPTY_FORM: FormState = {
  reason: "",
  senderName: "",
  senderAddress: "",
  senderNotes: "",
  recipientName: "",
  recipientAddress: "",
  recipientPhone: "",
  deliveryNotes: "",
  length: null,
  width: null,
  height: null,
  weight: null,
};

interface KnownAddress {
  label: string;
  name: string;
  addressText: string;
  phone?: string;
}

const STATUS_SEVERITY: Record<Status, TagProps["severity"]> = {
  pending: "warning",
  approved: "success",
  deleted: "danger",
};

const STATUS_LABEL: Record<Status, string> = {
  pending: "In attesa",
  approved: "Approvata",
  deleted: "Eliminata",
};

function toDate(val: unknown): Date | null {
  if (!val) return null;
  if (typeof (val as Record<string, unknown>)?.toDate === "function")
    return (val as { toDate: () => Date }).toDate();
  if (typeof val === "object" && typeof (val as Record<string, unknown>).seconds === "number")
    return new Date(((val as Record<string, unknown>).seconds as number) * 1000);
  const d = new Date(val as string | number);
  return isNaN(d.getTime()) ? null : d;
}

function formatDate(val: unknown): string {
  const d = toDate(val);
  if (!d) return "";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${yyyy} ${hh}:${min}`;
}

export default function ShipmentRequestsPage() {
  const toast = useRef<Toast>(null);
  const [role, setRole] = useState<string | null>(null);
  const [uid, setUid] = useState<string | null>(null);
  const [requests, setRequests] = useState<ShipmentRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showDialog, setShowDialog] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [senderFromList, setSenderFromList] = useState(false);
  const [recipientFromList, setRecipientFromList] = useState(false);
  const [selectedSenderAddress, setSelectedSenderAddress] = useState<KnownAddress | null>(null);
  const [selectedRecipientAddress, setSelectedRecipientAddress] = useState<KnownAddress | null>(null);
  const [knownAddresses, setKnownAddresses] = useState<KnownAddress[]>([]);
  const [loadingAddresses, setLoadingAddresses] = useState(false);
  const [viewRequest, setViewRequest] = useState<ShipmentRequest | null>(null);

  const loadKnownAddresses = async () => {
    const user = auth.currentUser;
    if (!user) return;
    setLoadingAddresses(true);
    const result: KnownAddress[] = [];

    // User's own shipping address from profile
    const profileSnap = await getDoc(doc(db, "users", user.uid, "private", "profile"));
    if (profileSnap.exists()) {
      const profile = profileSnap.data();
      const addr = profile.shippingAddress as ShippingAddress | undefined;
      if (addr?.street) {
        const fullName = addr.fullName || `${profile.firstName ?? ""} ${profile.lastName ?? ""}`.trim();
        result.push({
          label: `Il mio indirizzo — ${fullName}, ${addr.street}, ${addr.postalCode} ${addr.city}`,
          name: fullName,
          addressText: `${addr.street}\n${addr.postalCode} ${addr.city} (${addr.province})\n${addr.country || "IT"}`,
          phone: addr.phone,
        });
      }
    }

    // Shipping addresses from device requests assigned to this user
    const q = query(
      collection(db, "deviceRequests"),
      where("assignedVolunteers", "array-contains", user.uid)
    );
    const reqSnap = await getDocs(q);
    for (const d of reqSnap.docs) {
      const data = d.data();
      const addr = data.shippingAddress as ShippingAddress | undefined;
      if (addr?.street) {
        let beneficiaryName = addr.fullName || "";
        const privSnap = await getDoc(doc(db, "deviceRequests", d.id, "private", "data"));
        if (privSnap.exists()) {
          const priv = privSnap.data();
          const n = `${priv.firstName ?? ""} ${priv.lastName ?? ""}`.trim();
          if (n) beneficiaryName = n;
        }
        result.push({
          label: `Richiesta ${data.seqId || d.id.slice(0, 8)} — ${beneficiaryName}, ${addr.street}, ${addr.city}`,
          name: beneficiaryName,
          addressText: `${addr.street}\n${addr.postalCode} ${addr.city} (${addr.province})\n${addr.country || "IT"}`,
          phone: addr.phone,
        });
      }
    }

    setKnownAddresses(result);
    setLoadingAddresses(false);
  };

  useEffect(() => {
    const user = auth.currentUser;
    if (!user) return;
    setUid(user.uid);

    let unsub: (() => void) | undefined;

    const init = async () => {
      const userSnap = await getDoc(doc(db, "users", user.uid));
      const userRole = userSnap.exists() ? (userSnap.data()?.role as string) : null;
      setRole(userRole);

      const col = collection(db, "shipmentRequests");
      const q =
        userRole === "admin"
          ? col
          : query(col, where("createdBy", "==", user.uid));

      unsub = onSnapshot(q, (snap) => {
        const data = snap.docs
          .map((d) => ({ id: d.id, ...d.data() } as ShipmentRequest))
          .filter((r) => r.status !== "deleted");
        setRequests(data);
        setLoading(false);
      });
    };

    init().catch(() => setLoading(false));

    return () => {
      if (unsub) unsub();
    };
  }, []);

  // Pre-process dates for sortable DataTable columns
  const tableData = requests.map((r) => ({
    ...r,
    createdAt: toDate(r.createdAt),
  }));

  const validateForm = (): boolean => {
    const errs: Partial<Record<keyof FormState, string>> = {};
    if (!form.reason.trim()) errs.reason = "Campo obbligatorio";
    if (!form.senderName.trim()) errs.senderName = "Campo obbligatorio";
    if (!form.senderAddress.trim()) errs.senderAddress = "Campo obbligatorio";
    if (!form.recipientName.trim()) errs.recipientName = "Campo obbligatorio";
    if (!form.recipientAddress.trim()) errs.recipientAddress = "Campo obbligatorio";
    if (form.length !== null && form.length <= 0) errs.length = "Deve essere > 0";
    if (form.width !== null && form.width <= 0) errs.width = "Deve essere > 0";
    if (form.height !== null && form.height <= 0) errs.height = "Deve essere > 0";
    if (form.weight !== null && form.weight <= 0) errs.weight = "Deve essere > 0";
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleCreate = async () => {
    if (!validateForm() || saving) return;
    setSaving(true);
    try {
      const fn = httpsCallable(functions, "createShipmentRequest");
      await fn({
        reason: form.reason.trim(),
        senderName: form.senderName.trim(),
        senderAddress: form.senderAddress.trim(),
        senderNotes: form.senderNotes.trim() || undefined,
        recipientName: form.recipientName.trim(),
        recipientAddress: form.recipientAddress.trim(),
        recipientPhone: form.recipientPhone.trim() || undefined,
        deliveryNotes: form.deliveryNotes.trim() || undefined,
        length: form.length ?? undefined,
        width: form.width ?? undefined,
        height: form.height ?? undefined,
        weight: form.weight ?? undefined,
      });
      toast.current?.show({
        severity: "success",
        summary: "Richiesta creata",
        detail: "La richiesta di spedizione è stata inviata.",
        life: 3000,
      });
      setShowDialog(false);
      setForm(EMPTY_FORM);
      setErrors({});
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Errore durante la creazione della richiesta.";
      toast.current?.show({ severity: "error", summary: "Errore", detail: msg, life: 4000 });
    } finally {
      setSaving(false);
    }
  };

  const handleApprove = async (requestId: string) => {
    if (saving) return;
    setSaving(true);
    try {
      const fn = httpsCallable(functions, "approveShipmentRequest");
      await fn({ requestId });
      toast.current?.show({
        severity: "success",
        summary: "Approvata",
        detail: "La richiesta è stata approvata.",
        life: 3000,
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Errore durante l'approvazione.";
      toast.current?.show({ severity: "error", summary: "Errore", detail: msg, life: 4000 });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (requestId: string) => {
    confirmDialog({
      message: "Sei sicuro di voler eliminare questa richiesta?",
      header: "Conferma eliminazione",
      icon: "pi pi-exclamation-triangle",
      acceptLabel: "Elimina",
      rejectLabel: "Annulla",
      acceptClassName: "p-button-danger",
      accept: async () => {
        setSaving(true);
        try {
          const fn = httpsCallable(functions, "deleteShipmentRequest");
          await fn({ requestId });
          toast.current?.show({
            severity: "success",
            summary: "Eliminata",
            detail: "La richiesta è stata eliminata.",
            life: 3000,
          });
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : "Errore durante l'eliminazione.";
          toast.current?.show({ severity: "error", summary: "Errore", detail: msg, life: 4000 });
        } finally {
          setSaving(false);
        }
      },
      reject: () => {},
    });
  };

  const closeDialog = () => {
    if (saving) return;
    setShowDialog(false);
    setForm(EMPTY_FORM);
    setErrors({});
    setSenderFromList(false);
    setRecipientFromList(false);
    setSelectedSenderAddress(null);
    setSelectedRecipientAddress(null);
  };

  // ---- Renderers ----

  const statusBody = (row: ShipmentRequest) => (
    <Tag
      value={STATUS_LABEL[row.status] ?? row.status}
      severity={STATUS_SEVERITY[row.status] ?? "secondary"}
    />
  );

  const actionsBody = (row: ShipmentRequest) => (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <Button
        icon="pi pi-search"
        size="small"
        severity="secondary"
        tooltip="Dettaglio"
        tooltipOptions={{ position: "top" }}
        onClick={() => setViewRequest(row)}
      />
      {role === "admin" && row.status === "pending" && (
        <Button
          icon="pi pi-check"
          label="Approva"
          severity="success"
          size="small"
          disabled={saving}
          onClick={() => handleApprove(row.id)}
        />
      )}
      {(role === "admin" || (row.status === "pending" && row.createdBy === uid)) && (
        <Button
          icon="pi pi-trash"
          label="Elimina"
          severity="danger"
          size="small"
          disabled={saving}
          onClick={() => handleDelete(row.id)}
        />
      )}
    </div>
  );

  // ---- Form field helper ----

  const textField = (
    label: string,
    key: keyof FormState,
    required = false,
    textarea = false
  ) => (
    <div style={{ marginBottom: 12 }}>
      <label style={{ display: "block", fontWeight: 500, marginBottom: 4 }}>
        {label}
        {required && <span style={{ color: "red" }}> *</span>}
      </label>
      {textarea ? (
        <InputTextarea
          value={form[key] as string}
          onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
          rows={2}
          style={{ width: "100%" }}
          className={errors[key] ? "p-invalid" : ""}
        />
      ) : (
        <InputText
          value={form[key] as string}
          onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
          style={{ width: "100%" }}
          className={errors[key] ? "p-invalid" : ""}
        />
      )}
      {errors[key] && <small style={{ color: "red" }}>{errors[key]}</small>}
    </div>
  );

  const numericField = (label: string, key: keyof FormState) => (
    <div style={{ marginBottom: 12 }}>
      <label style={{ display: "block", fontWeight: 500, marginBottom: 4 }}>{label}</label>
      <InputNumber
        value={form[key] as number | null}
        onValueChange={(e) => setForm((f) => ({ ...f, [key]: e.value ?? null }))}
        min={0}
        minFractionDigits={0}
        maxFractionDigits={2}
        style={{ width: "100%" }}
        inputStyle={{ width: "100%" }}
        className={errors[key] ? "p-invalid" : ""}
      />
      {errors[key] && <small style={{ color: "red" }}>{errors[key]}</small>}
    </div>
  );

  // ---- Loading state ----

  if (loading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: 60 }}>
        <ProgressSpinner />
      </div>
    );
  }

  // ---- Main render ----

  return (
    <div style={{ padding: 20 }}>
      <Toast ref={toast} />
      <ConfirmDialog />

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 20,
        }}
      >
        <h2 style={{ margin: 0 }}>Richieste di spedizione</h2>
        {(role === "volunteer" || role === "admin") && (
          <Button
            label="Nuova richiesta"
            icon="pi pi-plus"
            onClick={() => {
              setForm(EMPTY_FORM);
              setErrors({});
              setSenderFromList(false);
              setRecipientFromList(false);
              setSelectedSenderAddress(null);
              setSelectedRecipientAddress(null);
              setShowDialog(true);
              loadKnownAddresses();
            }}
          />
        )}
      </div>

      <DataTable
        value={tableData}
        emptyMessage="Nessuna richiesta di spedizione"
        paginator
        rows={10}
        sortMode="multiple"
        dataKey="id"
      >
        <Column
          field="createdAt"
          header="Data"
          body={(row) => formatDate(row.createdAt)}
          sortable
          style={{ minWidth: 140 }}
        />
        <Column
          field="reason"
          header="Motivo"
          sortable
          style={{ minWidth: 160 }}
        />
        <Column
          field="recipientName"
          header="Destinatario"
          sortable
          style={{ minWidth: 140 }}
        />
        <Column
          field="senderName"
          header="Mittente"
          sortable
          style={{ minWidth: 140 }}
        />
        <Column
          field="status"
          header="Stato"
          body={statusBody}
          sortable
          style={{ minWidth: 110 }}
        />
        <Column
          header="Azioni"
          body={actionsBody}
          style={{ minWidth: 180 }}
        />
      </DataTable>

      {/* ---- View Dialog ---- */}
      <Dialog
        header={`Richiesta di spedizione — ${viewRequest ? formatDate(viewRequest.createdAt) : ""}`}
        visible={!!viewRequest}
        style={{ width: "640px" }}
        contentStyle={{ maxHeight: "75vh", overflowY: "auto" }}
        onHide={() => setViewRequest(null)}
        footer={
          <Button
            label="Chiudi"
            icon="pi pi-times"
            className="p-button-text"
            onClick={() => setViewRequest(null)}
          />
        }
      >
        {viewRequest && (() => {
          const r = viewRequest;
          const row = (label: string, value: string | number | undefined | null) =>
            value != null && value !== "" ? (
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontWeight: 600, fontSize: "0.82em", color: "#888", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 2 }}>{label}</div>
                <div style={{ whiteSpace: "pre-wrap" }}>{String(value)}</div>
              </div>
            ) : null;
          return (
            <>
              <div style={{ marginBottom: 12 }}>
                <span style={{ fontWeight: 600, fontSize: "0.82em", color: "#888", textTransform: "uppercase", letterSpacing: "0.04em" }}>Stato&nbsp;</span>
                <Tag value={STATUS_LABEL[r.status] ?? r.status} severity={STATUS_SEVERITY[r.status] ?? "secondary"} />
              </div>
              {row("Motivo", r.reason)}
              <h4 style={{ margin: "16px 0 8px", color: "#555" }}>Mittente</h4>
              {row("Nome", r.senderName)}
              {row("Indirizzo", r.senderAddress)}
              {row("Note", r.senderNotes)}
              <h4 style={{ margin: "16px 0 8px", color: "#555" }}>Destinatario</h4>
              {row("Nome", r.recipientName)}
              {row("Indirizzo", r.recipientAddress)}
              {row("Telefono", r.recipientPhone)}
              {row("Note consegna", r.deliveryNotes)}
              {(r.length != null || r.width != null || r.height != null || r.weight != null) && (
                <>
                  <h4 style={{ margin: "16px 0 8px", color: "#555" }}>Dimensioni e peso</h4>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "0 16px" }}>
                    {row("Lunghezza (cm)", r.length)}
                    {row("Larghezza (cm)", r.width)}
                    {row("Altezza (cm)", r.height)}
                    {row("Peso (kg)", r.weight)}
                  </div>
                </>
              )}
            </>
          );
        })()}
      </Dialog>

      {/* ---- Create Dialog ---- */}
      <Dialog
        header="Nuova richiesta di spedizione"
        visible={showDialog}
        style={{ width: "680px" }}
        contentStyle={{ maxHeight: "70vh", overflowY: "auto" }}
        onHide={closeDialog}
        footer={
          <div>
            <Button
              label="Annulla"
              icon="pi pi-times"
              className="p-button-text"
              onClick={closeDialog}
              disabled={saving}
            />
            <Button
              label="Crea richiesta"
              icon="pi pi-check"
              onClick={handleCreate}
              loading={saving}
            />
          </div>
        }
      >
        {/* Motivo */}
        {textField("Motivo della spedizione", "reason", true)}

        {/* Mittente */}
        <h4 style={{ margin: "16px 0 8px", color: "#555" }}>Mittente</h4>
        {textField("Nome mittente", "senderName", true)}
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <label style={{ fontWeight: 500 }}>Indirizzo mittente <span style={{ color: "red" }}>*</span></label>
            <Checkbox
              inputId="sender-fromlist"
              checked={senderFromList}
              onChange={(e) => { setSenderFromList(e.checked ?? false); if (!e.checked) setSelectedSenderAddress(null); }}
            />
            <label htmlFor="sender-fromlist" style={{ cursor: "pointer" }}>da lista</label>
          </div>
          {senderFromList ? (
            <Dropdown
              value={selectedSenderAddress}
              options={knownAddresses}
              optionLabel="label"
              onChange={(e) => {
                const addr: KnownAddress = e.value;
                setSelectedSenderAddress(addr);
                setForm((f) => ({ ...f, senderName: addr.name, senderAddress: addr.addressText }));
              }}
              placeholder={loadingAddresses ? "Caricamento..." : knownAddresses.length === 0 ? "Nessun indirizzo salvato" : "Seleziona indirizzo..."}
              style={{ width: "100%" }}
              filter
              disabled={loadingAddresses}
            />
          ) : (
            <InputTextarea
              value={form.senderAddress}
              onChange={(e) => setForm((f) => ({ ...f, senderAddress: e.target.value }))}
              rows={3}
              style={{ width: "100%" }}
              className={errors.senderAddress ? "p-invalid" : ""}
              placeholder={"Via Roma 1\n00100 Roma (RM)\nIT"}
            />
          )}
          {errors.senderAddress && <small style={{ color: "red" }}>{errors.senderAddress}</small>}
        </div>
        {textField("Note mittente", "senderNotes", false, true)}

        {/* Destinatario */}
        <h4 style={{ margin: "16px 0 8px", color: "#555" }}>Destinatario</h4>
        {textField("Nome destinatario", "recipientName", true)}
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <label style={{ fontWeight: 500 }}>Indirizzo destinatario <span style={{ color: "red" }}>*</span></label>
            <Checkbox
              inputId="recipient-fromlist"
              checked={recipientFromList}
              onChange={(e) => { setRecipientFromList(e.checked ?? false); if (!e.checked) setSelectedRecipientAddress(null); }}
            />
            <label htmlFor="recipient-fromlist" style={{ cursor: "pointer" }}>da lista</label>
          </div>
          {recipientFromList ? (
            <Dropdown
              value={selectedRecipientAddress}
              options={knownAddresses}
              optionLabel="label"
              onChange={(e) => {
                const addr: KnownAddress = e.value;
                setSelectedRecipientAddress(addr);
                setForm((f) => ({ ...f, recipientName: addr.name, recipientAddress: addr.addressText, recipientPhone: addr.phone ?? f.recipientPhone }));
              }}
              placeholder={loadingAddresses ? "Caricamento..." : knownAddresses.length === 0 ? "Nessun indirizzo salvato" : "Seleziona indirizzo..."}
              style={{ width: "100%" }}
              filter
              disabled={loadingAddresses}
            />
          ) : (
            <InputTextarea
              value={form.recipientAddress}
              onChange={(e) => setForm((f) => ({ ...f, recipientAddress: e.target.value }))}
              rows={3}
              style={{ width: "100%" }}
              className={errors.recipientAddress ? "p-invalid" : ""}
              placeholder={"Via Roma 1\n00100 Roma (RM)\nIT"}
            />
          )}
          {errors.recipientAddress && <small style={{ color: "red" }}>{errors.recipientAddress}</small>}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 16px" }}>
          <div>{textField("Telefono destinatario", "recipientPhone")}</div>
          <div>{textField("Note consegna", "deliveryNotes")}</div>
        </div>

        {/* Dimensioni */}
        <h4 style={{ margin: "16px 0 8px", color: "#555" }}>
          Dimensioni e peso <span style={{ fontWeight: 400, fontSize: "0.85em" }}>(opzionale)</span>
        </h4>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "0 16px" }}>
          <div>{numericField("Lunghezza (cm)", "length")}</div>
          <div>{numericField("Larghezza (cm)", "width")}</div>
          <div>{numericField("Altezza (cm)", "height")}</div>
          <div>{numericField("Peso (kg)", "weight")}</div>
        </div>
      </Dialog>
    </div>
  );
}
