import { useEffect, useState, useRef } from "react";
import { getDoc, doc } from "firebase/firestore";
import { auth, db, functions } from "../../firebase";
import { httpsCallable } from "firebase/functions";
import { Button } from "primereact/button";
import { Toast } from "primereact/toast";
import { Message } from "primereact/message";
import type { VolunteerPrivateProfile } from "../../shared/types/volunteerData";

// ─── option definitions ──────────────────────────────────────────────────────

const availabilityOptions = [
  {
    value: "Più di 2 ore a settimana",
    icon: "pi pi-bolt",
    color: "#22c55e",
    bg: "#f0fdf4",
    label: "Molto disponibile",
    sub: "Più di 2 ore a settimana",
  },
  {
    value: "1-2 ore a settimana",
    icon: "pi pi-clock",
    color: "#3b82f6",
    bg: "#eff6ff",
    label: "Costante",
    sub: "1–2 ore a settimana",
  },
  {
    value: "Qualche ora al mese",
    icon: "pi pi-calendar",
    color: "#8b5cf6",
    bg: "#f5f3ff",
    label: "Mensile",
    sub: "Qualche ora al mese",
  },
  {
    value: "Saltuaria (quando posso)",
    icon: "pi pi-star",
    color: "#f59e0b",
    bg: "#fffbeb",
    label: "Saltuaria",
    sub: "Quando posso",
  },
  {
    value: "Variabile nel tempo",
    icon: "pi pi-chart-line",
    color: "#06b6d4",
    bg: "#ecfeff",
    label: "Variabile",
    sub: "Dipende dal periodo",
  },
  {
    value: "In questo momento non riesco a dedicare tempo, ma desidero restare aggiornato/a e coinvolto/a",
    icon: "pi pi-pause-circle",
    color: "#94a3b8",
    bg: "#f8fafc",
    label: "In pausa",
    sub: "Voglio restare aggiornato/a",
  },
];

const continuityOptions = [
  {
    value: "continuativa",
    icon: "pi pi-sync",
    color: "#3b82f6",
    bg: "#eff6ff",
    label: "Continuativa",
    sub: "Attività regolari nel tempo",
  },
  {
    value: "spot",
    icon: "pi pi-bolt",
    color: "#f59e0b",
    bg: "#fffbeb",
    label: "Occasionale",
    sub: "Interventi su singoli progetti",
  },
  {
    value: "saltuaria",
    icon: "pi pi-th-large",
    color: "#8b5cf6",
    bg: "#f5f3ff",
    label: "Entrambe",
    sub: "Sia continuativa sia occasionale",
  },
];

const involvementOptions = [
  {
    value: "bassa",
    icon: "pi pi-eye",
    color: "#64748b",
    bg: "#f8fafc",
    label: "Osservatore",
    sub: "Preferisco seguire e restare informato/a",
  },
  {
    value: "progetti",
    icon: "pi pi-cog",
    color: "#22c55e",
    bg: "#f0fdf4",
    label: "Attivo su progetti",
    sub: "Voglio contribuire su progetti specifici",
  },
  {
    value: "coordinamento",
    icon: "pi pi-sitemap",
    color: "#3b82f6",
    bg: "#eff6ff",
    label: "Coordinamento",
    sub: "Disponibile a ruoli di responsabilità",
  },
  {
    value: "non so",
    icon: "pi pi-question-circle",
    color: "#f59e0b",
    bg: "#fffbeb",
    label: "Non so ancora",
    sub: "Vorrei capire meglio prima di decidere",
  },
];

// ─── SelectionCard component ──────────────────────────────────────────────────

interface CardOption {
  value: string;
  icon: string;
  color: string;
  bg: string;
  label: string;
  sub: string;
}

function SelectionCard({
  option,
  selected,
  onClick,
  disabled,
}: {
  option: CardOption;
  selected: boolean;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <div
      onClick={disabled ? undefined : onClick}
      style={{
        border: selected ? `2px solid ${option.color}` : "2px solid #e5e7eb",
        borderRadius: 12,
        padding: "16px 20px",
        background: selected ? option.bg : "#fff",
        cursor: disabled ? "default" : "pointer",
        display: "flex",
        alignItems: "center",
        gap: 16,
        transition: "border 0.15s, background 0.15s, box-shadow 0.15s",
        boxShadow: selected ? `0 0 0 3px ${option.color}22` : "none",
        opacity: disabled && !selected ? 0.5 : 1,
        minWidth: 0,
      }}
    >
      <div
        style={{
          width: 44,
          height: 44,
          borderRadius: "50%",
          background: option.bg,
          border: `2px solid ${option.color}44`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <span
          className={option.icon}
          style={{ fontSize: 20, color: option.color }}
        />
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 15, color: "#1e293b" }}>
          {option.label}
        </div>
        <div style={{ fontSize: 13, color: "#64748b", marginTop: 2 }}>
          {option.sub}
        </div>
      </div>
      {selected && (
        <span
          className="pi pi-check-circle"
          style={{ marginLeft: "auto", fontSize: 20, color: option.color, flexShrink: 0 }}
        />
      )}
    </div>
  );
}

// ─── Section component ────────────────────────────────────────────────────────

function Section({
  title,
  description,
  options,
  value,
  onChange,
  editing,
}: {
  title: string;
  description: string;
  options: CardOption[];
  value: string;
  onChange: (v: string) => void;
  editing: boolean;
}) {
  return (
    <div style={{ marginBottom: 40 }}>
      <h3 style={{ margin: "0 0 4px", fontSize: 17, color: "#1e293b" }}>{title}</h3>
      <p style={{ margin: "0 0 16px", fontSize: 13, color: "#64748b" }}>{description}</p>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
          gap: 12,
        }}
      >
        {options.map((opt) => (
          <SelectionCard
            key={opt.value}
            option={opt}
            selected={value === opt.value}
            onClick={() => onChange(opt.value)}
            disabled={!editing}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function VolunteerAvailability() {
  const [profile, setProfile] = useState<Pick<
    VolunteerPrivateProfile,
    "availability" | "continuityType" | "desiredInvolvementLevel"
  > | null>(null);
  const [draft, setDraft] = useState(profile);
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const toast = useRef<Toast>(null);

  useEffect(() => {
    const load = async () => {
      const user = auth.currentUser;
      if (!user) return;
      const snap = await getDoc(doc(db, `users/${user.uid}/private/profile`));
      const data = snap.exists() ? snap.data() as VolunteerPrivateProfile : null;
      const availability = {
        availability: data?.availability ?? "",
        continuityType: data?.continuityType,
        desiredInvolvementLevel: data?.desiredInvolvementLevel,
      };
      setProfile(availability);
      setDraft(availability);
      const raw = (snap.data() as any)?.updatedAt;
      setUpdatedAt(raw?.toDate ? raw.toDate() : null);
      setLoading(false);
    };
    load();
  }, []);

  const handleChange = (field: "availability" | "continuityType" | "desiredInvolvementLevel", value: string) => {
    setDraft(prev => prev ? { ...prev, [field]: value } : prev);
  };

  const handleSave = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const user = auth.currentUser;
      if (!user) throw new Error("Utente non autenticato");
      // Load full profile to merge changes
      const snap = await getDoc(doc(db, `users/${user.uid}/private/profile`));
      const fullProfile = snap.exists() ? snap.data() as VolunteerPrivateProfile : {};
      const updateFn = httpsCallable(functions, "updateVolunteerProfile");
      await updateFn({
        privateProfile: { ...fullProfile, ...draft },
      });
      setProfile(draft);
      setEditing(false);
      setUpdatedAt(new Date());
      toast.current?.show({ severity: "success", summary: "Salvato", detail: "Disponibilità aggiornata", life: 2500 });
    } catch {
      toast.current?.show({ severity: "error", summary: "Errore", detail: "Salvataggio fallito", life: 3000 });
    }
    setSaving(false);
  };

  const handleCancel = () => {
    setDraft(profile);
    setEditing(false);
  };

  if (loading || !draft) {
    return (
      <div style={{ textAlign: "center", marginTop: 80 }}>
        <span className="pi pi-spin pi-spinner" style={{ fontSize: 32 }} />
        <div>Caricamento...</div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: 32 }}>
      <Toast ref={toast} />

      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 8 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 24, color: "#1e293b" }}>Disponibilità e coinvolgimento</h2>
          <p style={{ margin: "4px 0 0", color: "#64748b", fontSize: 14 }}>
            Indica come e quanto vuoi essere coinvolto/a nella community.
          </p>
          {updatedAt && (
            <p style={{ margin: "6px 0 0", color: "#94a3b8", fontSize: 12 }}>
              <span className="pi pi-clock" style={{ marginRight: 4, fontSize: 11 }} />
              Ultimo aggiornamento: {updatedAt.toLocaleString()}
            </p>
          )}
        </div>
        {!editing ? (
          <Button
            label="Modifica"
            icon="pi pi-pencil"
            onClick={() => setEditing(true)}
            className="p-button-outlined"
          />
        ) : (
          <div style={{ display: "flex", gap: 8 }}>
            <Button label="Annulla" icon="pi pi-times" className="p-button-text" onClick={handleCancel} disabled={saving} />
            <Button label="Salva" icon="pi pi-check" onClick={handleSave} loading={saving} />
          </div>
        )}
      </div>

      <Message
        severity="info"
        icon="pi pi-info-circle"
        text="Ogni contributo è prezioso, anche se limitato nel tempo. Puoi modificare queste informazioni in qualsiasi momento: ci aiutano a coinvolgerti nel modo più adatto."
        style={{ marginBottom: 32, width: "100%" }}
      />

      <Section
        title="Quanto tempo puoi dedicare?"
        description="Indica la tua disponibilità attuale. Non è un impegno formale."
        options={availabilityOptions}
        value={draft.availability ?? ""}
        onChange={v => handleChange("availability", v)}
        editing={editing}
      />

      <Section
        title="Che tipo di impegno preferisci?"
        description="Preferisci attività regolari o interventi su singoli progetti?"
        options={continuityOptions}
        value={draft.continuityType ?? ""}
        onChange={v => handleChange("continuityType", v)}
        editing={editing}
      />

      <Section
        title="Che livello di coinvolgimento desideri?"
        description="Non è un impegno definitivo: puoi cambiarlo in qualsiasi momento."
        options={involvementOptions}
        value={draft.desiredInvolvementLevel ?? ""}
        onChange={v => handleChange("desiredInvolvementLevel", v)}
        editing={editing}
      />
    </div>
  );
}
