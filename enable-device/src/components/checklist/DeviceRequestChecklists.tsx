import { useCallback, useRef, useState } from "react";
import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../../firebase";
import { Badge } from "primereact/badge";
import { Button } from "primereact/button";
import { Checkbox } from "primereact/checkbox";
import { Dialog } from "primereact/dialog";
import { Dropdown } from "primereact/dropdown";
import { TabPanel, TabView } from "primereact/tabview";
import { Toast } from "primereact/toast";
import ChecklistPanel from "./ChecklistPanel";

/**
 * Numero massimo di checklist collegabili alla stessa deviceRequest, stesso
 * limite applicato lato backend (`createDeviceRequestChecklist.ts`,
 * `cloneDeviceRequestChecklist.ts`, EA-130). Duplicato qui solo per
 * disabilitare i pulsanti lato UI prima della chiamata: il backend resta
 * la fonte di verità e rifiuta comunque con `failed-precondition` oltre il
 * limite (es. in caso di due tab dello stesso utente aperte in parallelo).
 */
const MAX_CHECKLISTS_PER_REQUEST = 5;

interface CloneSource {
  id: string;
  requestNumber?: string;
  deviceType?: string;
  checklistIds: string[];
}

interface Props {
  /** Id della deviceRequest a cui sono collegate le checklist. */
  requestId: string;
  /** `deviceRequests/{requestId}.checklistIds`: una tab per elemento. */
  checklistIds: string[];
  /** Usato per il filtro "stesso devicetype" nel dialog di clonazione. */
  deviceType?: string;
  /** Invocato dopo una creazione/clonazione riuscita, per far ricaricare
   * al componente padre il documento `deviceRequests` (nuovo `checklistIds`). */
  onChecklistsChanged: () => Promise<void> | void;
}

/**
 * Vista a tab delle checklist di fabbricazione collegate a una
 * `deviceRequest` (EA-133): una tab per ciascun elemento di
 * `checklistIds`, ognuna monta `ChecklistPanel` mono-checklist con il
 * `checklistId` esplicito di quella tab. Sostituisce il precedente
 * pannello singolo condizionato sul campo singolare `checklistId`
 * (superato da EA-130), condiviso tra `RequestDetail` (admin) e
 * `VolunteerRequestDetail` (volontario assegnato) per evitare la
 * regressione descritta in `docs/FINDINGS.md` F-16.
 *
 * Il pulsante "Crea checklist" resta disponibile anche con checklist
 * esistenti (fino a `MAX_CHECKLISTS_PER_REQUEST`), invece di essere
 * sostituito dal pannello unico non appena ne esiste una.
 */
export default function DeviceRequestChecklists({
  requestId,
  checklistIds,
  deviceType,
  onChecklistsChanged,
}: Props) {
  const toast = useRef<Toast>(null);
  const [creatingChecklist, setCreatingChecklist] = useState(false);
  const [showCloneChecklistDialog, setShowCloneChecklistDialog] = useState(false);
  const [cloningChecklist, setCloningChecklist] = useState(false);
  const [loadingCloneSources, setLoadingCloneSources] = useState(false);
  const [cloneSources, setCloneSources] = useState<CloneSource[]>([]);
  const [cloneSameTypeOnly, setCloneSameTypeOnly] = useState(true);
  const [cloneSourceId, setCloneSourceId] = useState<string | null>(null);
  const [cloneSourceChecklistId, setCloneSourceChecklistId] = useState<string | null>(null);

  const atMaxChecklists = checklistIds.length >= MAX_CHECKLISTS_PER_REQUEST;

  const handleCreateChecklist = async () => {
    setCreatingChecklist(true);
    try {
      const fn = httpsCallable<{ requestId: string }, { checklistId: string }>(
        functions,
        "createDeviceRequestChecklist"
      );
      await fn({ requestId });
      toast.current?.show({
        severity: "success",
        summary: "Checklist creata",
        detail: "La checklist di fabbricazione è stata collegata alla richiesta.",
        life: 4000,
      });
      await onChecklistsChanged();
    } catch (err) {
      toast.current?.show({
        severity: "error",
        summary: "Errore",
        detail: err instanceof Error ? err.message : "Errore durante la creazione della checklist.",
        life: 5000,
      });
    }
    setCreatingChecklist(false);
  };

  /**
   * Recupera le deviceRequest candidate come sorgente di clonazione: tutte
   * le richieste diverse da quella corrente che hanno almeno una checklist
   * collegata (`checklistIds` non vuoto). Il `deviceType` mostrato segue la
   * stessa risoluzione (documento principale, fallback `publicDeviceRequests`)
   * usata da `cloneDeviceRequestChecklist` lato backend.
   */
  const fetchCloneSources = useCallback(async () => {
    setLoadingCloneSources(true);
    try {
      const snapshot = await getDocs(collection(db, "deviceRequests"));
      const candidates = await Promise.all(
        snapshot.docs
          .filter((d) => d.id !== requestId && Array.isArray(d.data().checklistIds) && d.data().checklistIds.length > 0)
          .map(async (d) => {
            const data = d.data();
            let candidateDeviceType: string | undefined = data.deviceType;
            if (!candidateDeviceType) {
              const publicSnap = await getDoc(doc(db, "publicDeviceRequests", d.id));
              candidateDeviceType = publicSnap.exists() ? publicSnap.data().devicetype : undefined;
            }
            return {
              id: d.id,
              requestNumber: data.requestNumber,
              deviceType: candidateDeviceType,
              checklistIds: data.checklistIds as string[],
            };
          })
      );
      setCloneSources(candidates);
    } catch (err) {
      toast.current?.show({
        severity: "error",
        summary: "Errore",
        detail: err instanceof Error ? err.message : "Impossibile recuperare le richieste da cui clonare.",
        life: 4000,
      });
    }
    setLoadingCloneSources(false);
  }, [requestId]);

  const openCloneChecklistDialog = () => {
    setCloneSourceId(null);
    setCloneSourceChecklistId(null);
    setCloneSameTypeOnly(true);
    setShowCloneChecklistDialog(true);
    fetchCloneSources();
  };

  const selectedCloneSource = cloneSources.find((s) => s.id === cloneSourceId) ?? null;

  const handleSelectCloneSource = (sourceId: string | null) => {
    setCloneSourceId(sourceId);
    const source = cloneSources.find((s) => s.id === sourceId);
    // Se la sorgente ha una sola checklist, la selezioniamo direttamente;
    // altrimenti l'utente deve scegliere esplicitamente quale clonare.
    setCloneSourceChecklistId(source && source.checklistIds.length === 1 ? source.checklistIds[0] : null);
  };

  const handleCloneChecklist = async () => {
    if (!cloneSourceId || !cloneSourceChecklistId) return;
    setCloningChecklist(true);
    try {
      const fn = httpsCallable<
        { requestId: string; sourceRequestId: string; sourceChecklistId: string },
        { checklistId: string }
      >(functions, "cloneDeviceRequestChecklist");
      await fn({ requestId, sourceRequestId: cloneSourceId, sourceChecklistId: cloneSourceChecklistId });
      toast.current?.show({
        severity: "success",
        summary: "Checklist clonata",
        detail: "La checklist è stata clonata dalla richiesta selezionata.",
        life: 4000,
      });
      setShowCloneChecklistDialog(false);
      await onChecklistsChanged();
    } catch (err) {
      toast.current?.show({
        severity: "error",
        summary: "Errore",
        detail: err instanceof Error ? err.message : "Errore durante la clonazione della checklist.",
        life: 5000,
      });
    }
    setCloningChecklist(false);
  };

  return (
    <div>
      <Toast ref={toast} />

      {checklistIds.length > 0 && (
        <TabView>
          {checklistIds.map((checklistId, index) => (
            <TabPanel key={checklistId} header={`Checklist ${index + 1}`}>
              <ChecklistPanel requestId={requestId} checklistId={checklistId} />
            </TabPanel>
          ))}
        </TabView>
      )}

      {checklistIds.length === 0 && (
        <div style={{ color: "#888", marginBottom: 12 }}>
          Nessuna checklist di fabbricazione collegata a questa richiesta.
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: checklistIds.length > 0 ? 16 : 0 }}>
        <Button
          label="Crea checklist di fabbricazione"
          icon="pi pi-plus"
          onClick={handleCreateChecklist}
          loading={creatingChecklist}
          disabled={atMaxChecklists}
          tooltip={atMaxChecklists ? `Numero massimo di checklist raggiunto (${MAX_CHECKLISTS_PER_REQUEST})` : undefined}
        />
        <Button
          label="Clona da device simile"
          icon="pi pi-copy"
          className="p-button-outlined"
          onClick={openCloneChecklistDialog}
          disabled={atMaxChecklists}
          tooltip={atMaxChecklists ? `Numero massimo di checklist raggiunto (${MAX_CHECKLISTS_PER_REQUEST})` : undefined}
        />
        {atMaxChecklists && (
          <Badge value={`Limite di ${MAX_CHECKLISTS_PER_REQUEST} checklist raggiunto`} severity="warning" />
        )}
      </div>

      {/* Dialog clonazione checklist da device simile */}
      <Dialog
        header="Clona checklist da un'altra richiesta"
        visible={showCloneChecklistDialog}
        style={{ width: "520px" }}
        modal
        onHide={() => setShowCloneChecklistDialog(false)}
        footer={
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <Button
              label="Annulla"
              className="p-button-text"
              onClick={() => setShowCloneChecklistDialog(false)}
              disabled={cloningChecklist}
            />
            <Button
              label="Clona"
              icon="pi pi-copy"
              onClick={handleCloneChecklist}
              loading={cloningChecklist}
              disabled={!cloneSourceId || !cloneSourceChecklistId}
            />
          </div>
        }
      >
        <div style={{ marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
          <Checkbox
            inputId="cloneSameTypeOnly"
            checked={cloneSameTypeOnly}
            onChange={(e) => {
              setCloneSameTypeOnly(e.checked ?? false);
              handleSelectCloneSource(null);
            }}
            disabled={!deviceType}
          />
          <label htmlFor="cloneSameTypeOnly" style={{ cursor: "pointer" }}>
            Mostra solo richieste dello stesso devicetype ({deviceType || "-"})
          </label>
        </div>
        <div>
          <label style={{ display: "block", fontWeight: 500, marginBottom: 6 }}>
            Richiesta sorgente
          </label>
          <Dropdown
            value={cloneSourceId}
            options={cloneSources
              .filter((s) => !(cloneSameTypeOnly && deviceType) || s.deviceType === deviceType)
              .map((s) => ({
                label: `${s.requestNumber || s.id}${s.deviceType ? ` — ${s.deviceType}` : ""}`,
                value: s.id,
              }))}
            onChange={(e) => handleSelectCloneSource(e.value)}
            placeholder={loadingCloneSources ? "Caricamento..." : "Seleziona richiesta sorgente"}
            disabled={loadingCloneSources}
            filter
            style={{ width: "100%" }}
            emptyMessage="Nessuna richiesta con checklist trovata"
          />
        </div>
        {selectedCloneSource && selectedCloneSource.checklistIds.length > 1 && (
          <div style={{ marginTop: 12 }}>
            <label style={{ display: "block", fontWeight: 500, marginBottom: 6 }}>
              Checklist da clonare
            </label>
            <Dropdown
              value={cloneSourceChecklistId}
              options={selectedCloneSource.checklistIds.map((cid, index) => ({
                label: `Checklist ${index + 1}`,
                value: cid,
              }))}
              onChange={(e) => setCloneSourceChecklistId(e.value)}
              placeholder="Seleziona la checklist da clonare"
              style={{ width: "100%" }}
            />
          </div>
        )}
        <p style={{ color: "#888", marginTop: 12, marginBottom: 0 }}>
          Vengono copiati titolo e quantità degli item della checklist sorgente; stato, assegnatario
          e completamento ripartono da zero. La richiesta sorgente resta un riferimento storico e può
          essere modificata o eliminata in seguito senza impatto su questa checklist.
        </p>
      </Dialog>
    </div>
  );
}
