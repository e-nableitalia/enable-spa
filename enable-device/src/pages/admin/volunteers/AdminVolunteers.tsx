import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "primereact/button";
import { Dialog } from "primereact/dialog";
import { Toast } from "primereact/toast";
import { Message } from "primereact/message";
import { httpsCallable } from "firebase/functions";
import { functions } from "../../../firebase";
import type { UserRole, VolunteerData } from "../../../shared/types/volunteerData";
import VolunteerAdminList from "./VolunteerAdminList";
import VolunteerAdminDetailDialog from "./VolunteerAdminDetailDialog";
import VolunteerAdminFilters from "./VolunteerAdminFilters";
import {
  applyVolunteerAdminFilters,
  EMPTY_VOLUNTEER_ADMIN_FILTERS,
  fallbackVolunteerDataFromLegacy,
  normalizeVolunteerRows,
  type VolunteerAdminRow,
  type VolunteerAdminFilters as VolunteerAdminFiltersState,
} from "./volunteerAdminHelpers";

interface LegacyVolunteer {
  id?: string;
  uid?: string;
  active?: boolean;
  email?: string;
  role?: UserRole;
  createdAt?: unknown;
  firstName?: string;
  lastName?: string;
  phone?: string;
  city?: string;
  telegramUsername?: string;
  availability?: string;
  continuityType?: "continuativa" | "spot" | "saltuaria";
  desiredInvolvementLevel?: "bassa" | "progetti" | "coordinamento" | "non so";
  desiredSkills?: string;
}

interface AdminVolunteersProps {
  volunteers: LegacyVolunteer[];
  onRefresh?: () => void;
}

interface ListVolunteerAdminDataResponse {
  volunteers: VolunteerData[];
}

export default function AdminVolunteers({ volunteers, onRefresh }: Readonly<AdminVolunteersProps>) {
  const toast = useRef<Toast>(null);
  const [confirmTarget, setConfirmTarget] = useState<{ uid: string; name: string; currentRole: UserRole } | null>(null);
  const [detailVolunteer, setDetailVolunteer] = useState<VolunteerAdminRow | null>(null);
  const [adminVolunteers, setAdminVolunteers] = useState<VolunteerData[]>([]);
  const [filters, setFilters] = useState<VolunteerAdminFiltersState>(EMPTY_VOLUNTEER_ADMIN_FILTERS);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [dataLoading, setDataLoading] = useState(true);
  const [loading, setLoading] = useState(false);

  const normalizedRows = useMemo(() => normalizeVolunteerRows(adminVolunteers), [adminVolunteers]);

  const filteredRows = useMemo(
    () => applyVolunteerAdminFilters(normalizedRows, filters),
    [normalizedRows, filters]
  );

  const availableMainInterest = useMemo(
    () =>
      Array.from(new Set(normalizedRows.flatMap((row) => row.mainInterest)))
        .sort((a, b) => a.localeCompare(b))
        .map((value) => ({ label: value, value })),
    [normalizedRows]
  );

  const availablePrinterBrands = useMemo(
    () =>
      Array.from(new Set(normalizedRows.flatMap((row) => row.printerBrands)))
        .sort((a, b) => a.localeCompare(b))
        .map((value) => ({ label: value, value })),
    [normalizedRows]
  );

  const availablePrinterModels = useMemo(
    () =>
      Array.from(new Set(normalizedRows.flatMap((row) => row.printerModels)))
        .sort((a, b) => a.localeCompare(b))
        .map((value) => ({ label: value, value })),
    [normalizedRows]
  );

  const availableEnableInterestAreas = useMemo(
    () =>
      Array.from(new Set(normalizedRows.flatMap((row) => row.enableInterestAreas)))
        .sort((a, b) => a.localeCompare(b))
        .map((value) => ({ label: value, value })),
    [normalizedRows]
  );

  const loadAdminVolunteers = async () => {
    setDataLoading(true);
    setErrorMessage(null);

    try {
      const fn = httpsCallable<undefined, ListVolunteerAdminDataResponse>(functions, "listVolunteerAdminData");
      const result = await fn();
      setAdminVolunteers(result.data.volunteers ?? []);
    } catch (err: unknown) {
      const fallback = fallbackVolunteerDataFromLegacy(volunteers);
      setAdminVolunteers(fallback);

      const detail = err instanceof Error ? err.message : "Errore sconosciuto";
      setErrorMessage(
        `Impossibile caricare i dati estesi dalla callable admin. Mostro una vista ridotta con i dati legacy. Dettaglio: ${detail}`
      );
    }

    setDataLoading(false);
  };

  useEffect(() => {
    void loadAdminVolunteers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRoleToggle = async () => {
    if (!confirmTarget) return;
    const newRole = confirmTarget.currentRole === "admin" ? "volunteer" : "admin";
    setLoading(true);
    try {
      const fn = httpsCallable(functions, "setUserRole");
      await fn({ targetUid: confirmTarget.uid, newRole });
      toast.current?.show({
        severity: "success",
        summary: "Ruolo aggiornato",
        detail: `${confirmTarget.name}: ${confirmTarget.currentRole} → ${newRole}`,
        life: 3000,
      });
      onRefresh?.();
      await loadAdminVolunteers();
    } catch (err: unknown) {
      const detail = err instanceof Error ? err.message : "Errore durante il cambio ruolo.";
      toast.current?.show({
        severity: "error",
        summary: "Errore",
        detail,
        life: 4000,
      });
    }
    setLoading(false);
    setConfirmTarget(null);
  };

  const newRole = confirmTarget?.currentRole === "admin" ? "volunteer" : "admin";

  return (
    <div style={{ padding: 20 }}>
      <Toast ref={toast} />
      <Dialog
        header="Conferma cambio ruolo"
        visible={!!confirmTarget}
        style={{ width: "380px" }}
        modal
        onHide={() => setConfirmTarget(null)}
        footer={
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <Button label="Annulla" className="p-button-text" onClick={() => setConfirmTarget(null)} disabled={loading} />
            <Button
              label="Conferma"
              className={newRole === "admin" ? "p-button-warning" : undefined}
              onClick={handleRoleToggle}
              loading={loading}
            />
          </div>
        }
      >
        <p>
          Vuoi cambiare il ruolo di <strong>{confirmTarget?.name}</strong> da{" "}
          <strong>{confirmTarget?.currentRole}</strong> a <strong>{newRole}</strong>?
        </p>
      </Dialog>
      <VolunteerAdminDetailDialog
        visible={detailVolunteer !== null}
        volunteer={detailVolunteer}
        onHide={() => setDetailVolunteer(null)}
      />

      <h2>Volontari</h2>

      {errorMessage ? <Message severity="warn" text={errorMessage} style={{ marginBottom: 12 }} /> : null}

      <VolunteerAdminFilters
        filters={filters}
        availableMainInterest={availableMainInterest}
        availablePrinterBrands={availablePrinterBrands}
        availablePrinterModels={availablePrinterModels}
        availableEnableInterestAreas={availableEnableInterestAreas}
        onChange={setFilters}
        onReset={() => setFilters({ ...EMPTY_VOLUNTEER_ADMIN_FILTERS })}
      />

      <div style={{ marginTop: 12 }}>
        <div style={{ marginBottom: 8, fontSize: 14 }}>
          {filteredRows.length} volontari trovati su {normalizedRows.length}
        </div>
        <VolunteerAdminList
          rows={filteredRows}
          loading={dataLoading}
          roleUpdateLoadingUid={loading ? confirmTarget?.uid ?? null : null}
          onShowDetail={setDetailVolunteer}
          onToggleRole={(uid, currentRole, name) => setConfirmTarget({ uid, currentRole, name })}
        />
      </div>
    </div>
  );
}
