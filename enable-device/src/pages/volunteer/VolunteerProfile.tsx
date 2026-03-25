
import { useEffect, useState, useRef } from "react";
import { getDoc, doc } from "firebase/firestore";
import { auth, db, functions } from "../../firebase";
import { httpsCallable } from "firebase/functions";
import { TabView, TabPanel } from "primereact/tabview";
import { InputText } from "primereact/inputtext";
import { InputTextarea } from "primereact/inputtextarea";
import { Dropdown } from "primereact/dropdown";
import { MultiSelect } from "primereact/multiselect";
import { Checkbox } from "primereact/checkbox";
import { Button } from "primereact/button";
import { Toast } from "primereact/toast";
import { Message } from "primereact/message";
import type { VolunteerPrivateProfile, VolunteerSkills, VolunteerPublicProfile } from "../../shared/types/volunteerData";
import type { ShippingAddress } from "../../shared/types/shippingAddress";
import provinceList from "../../helpers/province.json";

type InterestAreaOption = {
  label: string;
  value: string;
};

const interestAreaOptions: InterestAreaOption[] = [
  { label: "Progettazione e miglioramento device", value: "Progettazione e miglioramento device" },
  { label: "Stampa 3d e assemblaggio device", value: "Stampa 3d e assemblaggio device" },
  { label: "Progettazione 3d / Meccanica / CAD", value: "Progettazione 3d / Meccanica / CAD" },
  { label: "Hardware / elettronica", value: "Hardware / elettronica" },
  { label: "Firmware / sistemi embedded", value: "Firmware / sistemi embedded" },
  { label: "Software (Applicazioni, strumenti, piattaforme)", value: "Software (Applicazioni, strumenti, piattaforme)" },
  { label: "Test, validazione e sperimentazione", value: "Test, validazione e sperimentazione" },
  { label: "Ricerca e sviluppo", value: "Ricerca e sviluppo" },
  { label: "Supporto alle famiglie e agli utilizzatori finali", value: "Supporto alle famiglie e agli utilizzatori finali" },
  { label: "Documentazione (guide, istruzioni, report, survey)", value: "Documentazione (guide, istruzioni, report, survey)" },
  { label: "Organizzazione e processi", value: "Organizzazione e processi" },
  { label: "Didattica / insegnamento / attività stem", value: "Didattica / insegnamento / attività stem" },
  { label: "Comunicazione, divulgazione, social media", value: "Comunicazione, divulgazione, social media" },
];

const enableInterestAreasOptions: InterestAreaOption[] = [
  { label: "Device sportivi", value: "Device sportivi" },
  { label: "Ausili per la vita quotidiana", value: "Ausili per la vita quotidiana" },
  { label: "Adattamenti personalizzati", value: "Adattamenti personalizzati" },
  { label: "Progetti open source", value: "Progetti open source" },
  { label: "Altro", value: "Altro" },
];







const emptyAddress: ShippingAddress = {
  fullName: "",
  street: "",
  city: "",
  province: "",
  postalCode: "",
  country: "IT",
  phone: "",
  notes: "",
};

export default function VolunteerProfile() {
  const [privateProfile, setPrivateProfile] = useState<VolunteerPrivateProfile | null>(null);
  const [skills, setSkills] = useState<VolunteerSkills | null>(null);
  const [publicProfile, setPublicProfile] = useState<VolunteerPublicProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const toastRef = useRef<Toast>(null);

  useEffect(() => {
    const fetchData = async () => {
      const user = auth.currentUser;
      if (!user) return;
      const privateProfileSnap = await getDoc(doc(db, `users/${user.uid}/private/profile`));
      const skillsSnap = await getDoc(doc(db, `users/${user.uid}/private/skills`));
      const publicProfileSnap = await getDoc(doc(db, `users/${user.uid}/public/profile`));
      setPrivateProfile(privateProfileSnap.exists() ? privateProfileSnap.data() as VolunteerPrivateProfile : {
        firstName: "",
        lastName: "",
        phone: "",
        city: "",
        telegramUsername: "",
        availability: "",
        consentPrivacy: false,
      });
      setSkills(skillsSnap.exists() ? skillsSnap.data() as VolunteerSkills : {
        aboutMe: "",
        mainInterest: [],
        enableInterestAreas: [],
        contributionPreferences: "",
        desiredSkills: "",
      });
      setPublicProfile(publicProfileSnap.exists() ? publicProfileSnap.data() as VolunteerPublicProfile : {
        showInVolunteerList: false,
        publicEmail: "",
        bio: "",
        facebook: "",
        instagram: "",
        linkedin: "",
      });
      setLoading(false);
    };
    fetchData();
  }, []);

  const handlePrivateChange = (field: keyof VolunteerPrivateProfile, value: any) => {
    setPrivateProfile(prev => prev ? { ...prev, [field]: value } : prev);
  };
  const handleAddressChange = (field: keyof ShippingAddress, value: string) => {
    setPrivateProfile(prev => {
      if (!prev) return prev;
      return { ...prev, shippingAddress: { ...(prev.shippingAddress ?? emptyAddress), [field]: value } };
    });
  };
  const handleSkillsChange = (field: keyof VolunteerSkills, value: any) => {
    setSkills(prev => prev ? { ...prev, [field]: value } : prev);
  };
  const handlePublicChange = (field: keyof VolunteerPublicProfile, value: any) => {
    setPublicProfile(prev => prev ? { ...prev, [field]: value } : prev);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const user = auth.currentUser;
      if (!user) throw new Error("Utente non autenticato");
      const updateVolunteerProfile = httpsCallable(functions, "updateVolunteerProfile");
      await updateVolunteerProfile({
        privateProfile,
        skills,
        publicProfile
      });
      toastRef.current?.show({ severity: "success", summary: "Salvato", detail: "Informazioni aggiornate", life: 2000 });
    } catch (e) {
      console.log("Errore salvataggio profilo:", e);
      toastRef.current?.show({ severity: "error", summary: "Errore", detail: "Salvataggio fallito", life: 2000 });
    }
    setSaving(false);
  };

  if (loading || !privateProfile || !skills || !publicProfile) {
    return <div style={{ textAlign: "center", marginTop: 80 }}><span className="pi pi-spin pi-spinner" style={{ fontSize: 32 }} /> <div>Caricamento...</div></div>;
  }

  return (
    <div style={{ width: "100%", padding: 32 }}>
      <Toast ref={toastRef} />
      <TabView>
        <TabPanel header="Informazioni personali">
          <div className="p-fluid">
            <div className="p-grid p-align-center">
              <div className="p-col-12 p-md-6">
                <div style={{ display: "flex", alignItems: "center", marginBottom: 18 }}>
                  <label htmlFor="firstName" style={{ width: 200, textAlign: "left", marginRight: 16 }}>Nome</label>
                  <InputText id="firstName" value={privateProfile.firstName} onChange={e => handlePrivateChange("firstName", e.target.value)} style={{ flex: 1 }} />
                </div>
                <div style={{ display: "flex", alignItems: "center", marginBottom: 18 }}>
                  <label htmlFor="lastName" style={{ width: 200, textAlign: "left", marginRight: 16 }}>Cognome</label>
                  <InputText id="lastName" value={privateProfile.lastName} onChange={e => handlePrivateChange("lastName", e.target.value)} style={{ flex: 1 }} />
                </div>
                <div style={{ display: "flex", alignItems: "center", marginBottom: 18 }}>
                  <label htmlFor="phone" style={{ width: 200, textAlign: "left", marginRight: 16 }}>Telefono</label>
                  <InputText id="phone" value={privateProfile.phone} onChange={e => handlePrivateChange("phone", e.target.value)} style={{ flex: 1 }} />
                </div>
                <div style={{ display: "flex", alignItems: "center", marginBottom: 18 }}>
                  <label htmlFor="city" style={{ width: 200, textAlign: "left", marginRight: 16 }}>Città</label>
                  <InputText id="city" value={privateProfile.city} onChange={e => handlePrivateChange("city", e.target.value)} style={{ flex: 1 }} />
                </div>
                <div style={{ display: "flex", alignItems: "center", marginBottom: 18 }}>
                  <label htmlFor="telegramUsername" style={{ width: 200, textAlign: "left", marginRight: 16 }}>Telegram</label>
                  <InputText id="telegramUsername" value={privateProfile.telegramUsername} onChange={e => handlePrivateChange("telegramUsername", e.target.value)} style={{ flex: 1 }} />
                </div>
                <div style={{ display: "flex", alignItems: "center", marginBottom: 18 }}>
                  <label style={{ width: 200, textAlign: "left", marginRight: 16 }}>Notifiche</label>
                  <div style={{ display: "flex", gap: 24 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <Checkbox inputId="notifEmail" checked={privateProfile.notificationPreferences?.email ?? true} onChange={e => handlePrivateChange("notificationPreferences", { ...privateProfile.notificationPreferences, email: e.checked })} />
                      <label htmlFor="notifEmail">Email</label>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <Checkbox inputId="notifTelegram" checked={privateProfile.notificationPreferences?.telegram ?? false} onChange={e => handlePrivateChange("notificationPreferences", { ...privateProfile.notificationPreferences, telegram: e.checked })} disabled={!privateProfile.telegramUsername} />
                      <label htmlFor="notifTelegram" style={{ color: !privateProfile.telegramUsername ? "#aaa" : undefined }}>Telegram</label>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <Checkbox inputId="notifWhatsapp" checked={privateProfile.notificationPreferences?.whatsapp ?? false} onChange={e => handlePrivateChange("notificationPreferences", { ...privateProfile.notificationPreferences, whatsapp: e.checked })} disabled={!privateProfile.phone} />
                      <label htmlFor="notifWhatsapp" style={{ color: !privateProfile.phone ? "#aaa" : undefined }}>WhatsApp</label>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </TabPanel>
        <TabPanel header="Competenze e interessi">
          <div className="p-fluid">
            <Message severity="info" text="In questa sezione puoi indicare le tue competenze attuali, quelle che vorresti sviluppare, le aree di interesse e le preferenze di contributo. Queste informazioni ci aiutano a capire come potresti essere coinvolto al meglio nelle attività di Enable." style={{ marginBottom: 24 }} />
            <div style={{ display: "flex", alignItems: "center", marginBottom: 18 }}>
              <label htmlFor="aboutMe" style={{ width: 200, textAlign: "left", marginRight: 16 }}>Qualche informazione su di te</label>
              <InputTextarea
                id="aboutMe"
                value={skills.aboutMe}
                onChange={e => handleSkillsChange("aboutMe", e.target.value)}
                style={{ flex: 1 }}
                rows={3}
                tooltip="Se ti va, raccontaci brevemente il tuo percorso, le tue esperienze o competenze. Queste informazioni ci aiutano a capire come coinvolgerti al meglio nelle attività della community."
                tooltipOptions={{ position: "bottom" }}
              />
            </div>
            <div style={{ display: "flex", alignItems: "center", marginBottom: 18 }}>
              <label htmlFor="contributionPreferences" style={{ width: 200, textAlign: "left", marginRight: 16 }}>
                Descrivi quale potrebbe essere il tuo contributo alla community
              </label>
              <InputTextarea
                id="contributionPreferences"
                value={skills.contributionPreferences}
                onChange={e => handleSkillsChange("contributionPreferences", e.target.value)}
                rows={2}
                style={{ flex: 1 }}
                tooltip="Se vuoi, puoi specificare meglio come ti piacerebbe contribuire/quali tue competenze pensi possano essere utili alla community o che vorresti mettere a disposizione."
                tooltipOptions={{ position: "bottom" }}
              />
            </div>            
            <div style={{ display: "flex", alignItems: "center", marginBottom: 18 }}>
              <label htmlFor="mainInterest" style={{ width: 200, textAlign: "left", marginRight: 16 }}>Interessi</label>
              <MultiSelect
                id="mainInterest"
                value={skills.mainInterest}
                options={interestAreaOptions}
                onChange={e => handleSkillsChange("mainInterest", e.value)}
                style={{ flex: 1 }}
                placeholder="Seleziona i tuoi interessi principali"
                tooltip="Seleziona tutti gli argomenti che sono di tuo interesse. Puoi indicare tutte le aree che desideri."
                tooltipOptions={{ position: "bottom" }}
              />
            </div>
            <div style={{ display: "flex", alignItems: "center", marginBottom: 18 }}>
              <label htmlFor="enableInterestAreas" style={{ width: 200, textAlign: "left", marginRight: 16 }}>Interesse verso specifici ambiti e-Nable</label>
              <MultiSelect
                id="enableInterestAreas"
                value={skills.enableInterestAreas}
                options={enableInterestAreasOptions}
                onChange={e => handleSkillsChange("enableInterestAreas", e.value)}
                style={{ flex: 1 }}
                placeholder="Seleziona gli ambiti che ti interessano"
                tooltip="Ci sono ambiti o progetti che ti interessano in modo particolare?"
                tooltipOptions={{ position: "bottom" }}
              />
            </div>
            <div style={{ display: "flex", alignItems: "center", marginBottom: 18 }}>
              <label htmlFor="desiredSkills" style={{ width: 200, textAlign: "left", marginRight: 16 }}>Competenze che vorresti sviluppare</label>
              <InputTextarea
                id="desiredSkills"
                value={skills.desiredSkills}
                onChange={e => handleSkillsChange("desiredSkills", e.target.value)}
                rows={2}
                style={{ flex: 1, resize: "vertical" }}
                tooltip="Ci sono competenze che ti piacerebbe sviluppare o approfondire grazie alla community?"
                tooltipOptions={{ position: "bottom" }}
              />
            </div>
          </div>
        </TabPanel>
        <TabPanel header="Profilo pubblico">
          <div className="p-fluid">
            <Message
              severity="info"
              icon="pi pi-info-circle"
              text={
                <>
                  Nel nostro sito è presente una sezione che elenca i membri del team, puoi scegliere di essere inserito o meno in questo elenco pubblico, qui puoi consultarlo per vedere come è organizzato e le informazioni che presentiamo:{" "}
                  <a href="https://e-nableitalia.it/it_it/our-team/" target="_blank" rel="noopener noreferrer">
                    team volontari sul sito
                  </a>.
                  Tutte le informazioni raccolte dopo questa domanda sono facoltative e principalmente utili per creare la pagina del tuo profilo sul sito.
                </>
              }
              style={{ marginBottom: 24 }}
            />
            <div style={{ display: "flex", alignItems: "center", marginBottom: 18 }}>
              <Checkbox
                inputId="showInVolunteerList"
                checked={publicProfile.showInVolunteerList}
                onChange={e => handlePublicChange("showInVolunteerList", e.checked)}
                className="mr-2"
              />
              <label htmlFor="showInVolunteerList" style={{ textAlign: "left" }}>
                &nbsp;Voglio essere inserito nell'elenco dei volontari sul sito e-Nable Italia (Profilo pubblico)
              </label>
            </div>
            <div style={{ display: "flex", alignItems: "center", marginBottom: 18 }}>
              <label htmlFor="publicEmail" style={{ width: 200, textAlign: "left", marginRight: 16 }}>Email pubblica</label>
              <InputText
                id="publicEmail"
                value={publicProfile.publicEmail}
                onChange={e => handlePublicChange("publicEmail", e.target.value)}
                style={{ flex: 1 }}
                tooltip="Informazioni per il sito: indirizzo e-mail da mostrare nel tuo profilo pubblico sul sito"
                tooltipOptions={{ position: "bottom" }}
                disabled={!publicProfile.showInVolunteerList}
              />
            </div>
            <div style={{ display: "flex", alignItems: "center", marginBottom: 18 }}>
              <label htmlFor="bio" style={{ width: 200, textAlign: "left", marginRight: 16 }}>Raccontati sul sito</label>
              <InputTextarea
                id="bio"
                value={publicProfile.bio}
                onChange={e => handlePublicChange("bio", e.target.value)}
                rows={3}
                style={{ flex: 1 }}
                tooltip="Se vuoi, puoi condividere qualche riga su di te: questo testo verrà utilizzato per presentarti nella pagina del team dei volontari sul sito."
                tooltipOptions={{ position: "bottom" }}
                disabled={!publicProfile.showInVolunteerList}
              />
            </div>
            <div style={{ display: "flex", alignItems: "center", marginBottom: 18 }}>
              <label htmlFor="facebook" style={{ width: 200, textAlign: "left", marginRight: 16 }}>
                <span className="pi pi-facebook" style={{ marginRight: 8 }} />
                Facebook
              </label>
              <InputText
                id="facebook"
                value={publicProfile.facebook}
                onChange={e => handlePublicChange("facebook", e.target.value)}
                style={{ flex: 1, marginRight: 8 }}
                tooltip="Inserisci il link al tuo profilo Facebook. Se il link è valido, puoi cliccare sull'icona per aprirlo."
                tooltipOptions={{ position: "bottom" }}
                placeholder="https://facebook.com/tuoprofilo"
                disabled={!publicProfile.showInVolunteerList}
              />
              {publicProfile.facebook && /^https?:\/\/.+/.test(publicProfile.facebook) && publicProfile.showInVolunteerList && (
                <a
                  href={publicProfile.facebook}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "#4267B2", fontSize: 20 }}
                  title="Vai al profilo Facebook"
                >
                  <span className="pi pi-external-link" />
                </a>
              )}
            </div>
            <div style={{ display: "flex", alignItems: "center", marginBottom: 18 }}>
              <label htmlFor="instagram" style={{ width: 200, textAlign: "left", marginRight: 16 }}>
                <span className="pi pi-instagram" style={{ marginRight: 8 }} />
                Instagram
              </label>
              <InputText
                id="instagram"
                value={publicProfile.instagram}
                onChange={e => handlePublicChange("instagram", e.target.value)}
                style={{ flex: 1, marginRight: 8 }}
                tooltip="Informazioni per il sito: se vuoi puoi inserire qui il link al tuo profilo Instagram"
                tooltipOptions={{ position: "bottom" }}
                placeholder="https://instagram.com/tuoprofilo"
                disabled={!publicProfile.showInVolunteerList}
              />
              {publicProfile.instagram && /^https?:\/\/.+/.test(publicProfile.instagram) && publicProfile.showInVolunteerList && (
                <a
                  href={publicProfile.instagram}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "#E1306C", fontSize: 20 }}
                  title="Vai al profilo Instagram"
                >
                  <span className="pi pi-external-link" />
                </a>
              )}
            </div>
            <div style={{ display: "flex", alignItems: "center", marginBottom: 18 }}>
              <label htmlFor="linkedin" style={{ width: 200, textAlign: "left", marginRight: 16 }}>
                <span className="pi pi-linkedin" style={{ marginRight: 8 }} />
                LinkedIn
              </label>
              <InputText
                id="linkedin"
                value={publicProfile.linkedin}
                onChange={e => handlePublicChange("linkedin", e.target.value)}
                style={{ flex: 1, marginRight: 8 }}
                tooltip="Informazioni per il sito: se vuoi puoi inserire qui il link al tuo profilo LinkedIn"
                tooltipOptions={{ position: "bottom" }}
                placeholder="https://linkedin.com/in/tuoprofilo"
                disabled={!publicProfile.showInVolunteerList}
              />
              {publicProfile.linkedin && /^https?:\/\/.+/.test(publicProfile.linkedin) && publicProfile.showInVolunteerList && (
                <a
                  href={publicProfile.linkedin}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "#0077B5", fontSize: 20 }}
                  title="Vai al profilo LinkedIn"
                >
                  <span className="pi pi-external-link" />
                </a>
              )}
            </div>
          </div>
        </TabPanel>
        <TabPanel header="Indirizzo di spedizione">
          <div className="p-fluid">
            <Message
              severity="info"
              text="Questo indirizzo viene usato come indirizzo di ritiro o consegna dei device o dei materiali nei progetti a cui partecipi. Tutti i campi sono facoltativi."
              style={{ marginBottom: 24 }}
            />
            {([
              { id: "addr-fullName", label: "Nome completo", field: "fullName" as keyof ShippingAddress, placeholder: "Mario Rossi" },
              { id: "addr-street",   label: "Indirizzo",      field: "street"   as keyof ShippingAddress, placeholder: "Via Roma 1" },
              { id: "addr-city",     label: "Città",          field: "city"     as keyof ShippingAddress, placeholder: "Roma" },
              { id: "addr-postalCode", label: "CAP",          field: "postalCode" as keyof ShippingAddress, placeholder: "00100" },
              { id: "addr-phone",    label: "Telefono corriere", field: "phone" as keyof ShippingAddress, placeholder: "+39 333 1234567" },
            ] as { id: string; label: string; field: keyof ShippingAddress; placeholder: string }[]).map(({ id, label, field, placeholder }) => (
              <div key={field} style={{ display: "flex", alignItems: "center", marginBottom: 18 }}>
                <label htmlFor={id} style={{ width: 200, textAlign: "left", marginRight: 16 }}>{label}</label>
                <InputText
                  id={id}
                  value={(privateProfile.shippingAddress?.[field] as string) ?? ""}
                  onChange={e => handleAddressChange(field, e.target.value)}
                  placeholder={placeholder}
                  style={{ flex: 1 }}
                />
              </div>
            ))}
            <div style={{ display: "flex", alignItems: "center", marginBottom: 18 }}>
              <label htmlFor="addr-province" style={{ width: 200, textAlign: "left", marginRight: 16 }}>Provincia</label>
              <Dropdown
                id="addr-province"
                value={privateProfile.shippingAddress?.province ?? ""}
                options={provinceList.map((p: string) => ({ label: p, value: p }))}
                onChange={e => handleAddressChange("province", e.value)}
                placeholder="Seleziona provincia"
                filter
                showClear
                style={{ flex: 1 }}
              />
            </div>
            <div style={{ display: "flex", alignItems: "center", marginBottom: 18 }}>
              <label htmlFor="addr-country" style={{ width: 200, textAlign: "left", marginRight: 16 }}>Paese</label>
              <InputText
                id="addr-country"
                value={privateProfile.shippingAddress?.country ?? "IT"}
                onChange={e => handleAddressChange("country", e.target.value)}
                placeholder="IT"
                style={{ flex: 1 }}
              />
            </div>
            <div style={{ display: "flex", alignItems: "flex-start", marginBottom: 18 }}>
              <label htmlFor="addr-notes" style={{ width: 200, textAlign: "left", marginRight: 16, paddingTop: 6 }}>Note per il corriere</label>
              <InputTextarea
                id="addr-notes"
                value={privateProfile.shippingAddress?.notes ?? ""}
                onChange={e => handleAddressChange("notes", e.target.value)}
                rows={2}
                style={{ flex: 1 }}
                placeholder="Es: citofonare Rossi, al piano terra"
              />
            </div>
          </div>
        </TabPanel>
      </TabView>
      <div style={{ textAlign: "center", marginTop: 24 }}>
        <Button label="Salva" onClick={handleSave} loading={saving} className="p-button-lg" />
      </div>
    </div>
  );
}
