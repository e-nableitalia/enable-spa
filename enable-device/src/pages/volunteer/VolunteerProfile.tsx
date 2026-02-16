
import { useEffect, useState, useRef } from "react";
import { getDoc, doc } from "firebase/firestore";
import { auth, db, functions } from "../../firebase";
import { httpsCallable } from "firebase/functions";
import { TabView, TabPanel } from "primereact/tabview";
import { InputText } from "primereact/inputtext";
import { InputTextarea } from "primereact/inputtextarea";
import { Dropdown } from "primereact/dropdown";
import { Checkbox } from "primereact/checkbox";
import { Button } from "primereact/button";
import { Toast } from "primereact/toast";

interface VolunteerPrivateProfile {
  firstName: string;
  lastName: string;
  phone: string;
  city: string;
  telegramUsername: string;
  mainInterest: string;
  availability: string;
  continuityType: string;
  desiredInvolvementLevel: string;
  consentPrivacy: boolean;
}

interface VolunteerSkills {
  currentSkills: string;
  desiredSkills: string;
  enableInterestAreas: string;
  contributionPreferences: string;
}

interface VolunteerPublicProfile {
  showInVolunteerList: boolean;
  publicEmail: string;
  bio: string;
  facebook: string;
  instagram: string;
  linkedin: string;
}

const continuityTypeOptions = [
  { label: "Continuativa", value: "continuativa" },
  { label: "Saltuaria", value: "saltuaria" },
];
const involvementLevelOptions = [
  { label: "Bassa", value: "bassa" },
  { label: "Media", value: "media" },
  { label: "Alta", value: "alta" },
];

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
        mainInterest: "",
        availability: "",
        continuityType: "",
        desiredInvolvementLevel: "",
        consentPrivacy: false,
      });
      setSkills(skillsSnap.exists() ? skillsSnap.data() as VolunteerSkills : {
        currentSkills: "",
        desiredSkills: "",
        enableInterestAreas: "",
        contributionPreferences: "",
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
  const handleSkillsChange = (field: keyof VolunteerSkills, value: any) => {
    setSkills(prev => prev ? { ...prev, [field]: value } : prev);
  };
  const handlePublicChange = (field: keyof VolunteerPublicProfile, value: any) => {
    setPublicProfile(prev => prev ? { ...prev, [field]: value } : prev);
  };

  const handleSave = async () => {
    if (!privateProfile?.consentPrivacy) {
      toastRef.current?.show({ severity: "error", summary: "Errore", detail: "Devi accettare la privacy", life: 2000 });
      return;
    }
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
                  <label htmlFor="mainInterest" style={{ width: 200, textAlign: "left", marginRight: 16 }}>Interesse principale</label>
                  <InputText id="mainInterest" value={privateProfile.mainInterest} onChange={e => handlePrivateChange("mainInterest", e.target.value)} style={{ flex: 1 }} />
                </div>
                <div style={{ display: "flex", alignItems: "center", marginBottom: 18 }}>
                  <label htmlFor="availability" style={{ width: 200, textAlign: "left", marginRight: 16 }}>Disponibilità</label>
                  <InputText id="availability" value={privateProfile.availability} onChange={e => handlePrivateChange("availability", e.target.value)} style={{ flex: 1 }} />
                </div>
              </div>
              <div className="p-col-12 p-md-6">
                <div style={{ display: "flex", alignItems: "center", marginBottom: 18 }}>
                  <label htmlFor="continuityType" style={{ width: 200, textAlign: "left", marginRight: 16 }}>Tipo di continuità</label>
                  <Dropdown id="continuityType" value={privateProfile.continuityType} options={continuityTypeOptions} onChange={e => handlePrivateChange("continuityType", e.value)} style={{ flex: 1 }} />
                </div>
                <div style={{ display: "flex", alignItems: "center", marginBottom: 18 }}>
                  <label htmlFor="desiredInvolvementLevel" style={{ width: 200, textAlign: "left", marginRight: 16 }}>Livello coinvolgimento</label>
                  <Dropdown id="desiredInvolvementLevel" value={privateProfile.desiredInvolvementLevel} options={involvementLevelOptions} onChange={e => handlePrivateChange("desiredInvolvementLevel", e.value)} style={{ flex: 1 }} />
                </div>
                <div style={{ display: "flex", alignItems: "center", marginBottom: 18 }}>
                  <Checkbox inputId="privacy" checked={privateProfile.consentPrivacy} onChange={e => handlePrivateChange("consentPrivacy", e.checked)} className="mr-2" />
                  <label htmlFor="privacy" style={{ textAlign: "left" }}>Accetto la privacy</label>
                </div>
              </div>
            </div>
          </div>
        </TabPanel>
        <TabPanel header="Competenze">
          <div className="p-fluid">
            <div style={{ display: "flex", alignItems: "center", marginBottom: 18 }}>
              <label htmlFor="currentSkills" style={{ width: 200, textAlign: "left", marginRight: 16 }}>Competenze attuali</label>
              <InputText id="currentSkills" value={skills.currentSkills} onChange={e => handleSkillsChange("currentSkills", e.target.value)} style={{ flex: 1 }} />
            </div>
            <div style={{ display: "flex", alignItems: "center", marginBottom: 18 }}>
              <label htmlFor="desiredSkills" style={{ width: 200, textAlign: "left", marginRight: 16 }}>Competenze desiderate</label>
              <InputText id="desiredSkills" value={skills.desiredSkills} onChange={e => handleSkillsChange("desiredSkills", e.target.value)} style={{ flex: 1 }} />
            </div>
            <div style={{ display: "flex", alignItems: "center", marginBottom: 18 }}>
              <label htmlFor="enableInterestAreas" style={{ width: 200, textAlign: "left", marginRight: 16 }}>Aree di interesse</label>
              <InputText id="enableInterestAreas" value={skills.enableInterestAreas} onChange={e => handleSkillsChange("enableInterestAreas", e.target.value)} style={{ flex: 1 }} />
            </div>
            <div style={{ display: "flex", alignItems: "center", marginBottom: 18 }}>
              <label htmlFor="contributionPreferences" style={{ width: 200, textAlign: "left", marginRight: 16 }}>Preferenze di contributo</label>
              <InputTextarea id="contributionPreferences" value={skills.contributionPreferences} onChange={e => handleSkillsChange("contributionPreferences", e.target.value)} rows={3} style={{ flex: 1 }} />
            </div>
          </div>
        </TabPanel>
        <TabPanel header="Profilo pubblico">
          <div className="p-fluid">
            <div style={{ display: "flex", alignItems: "center", marginBottom: 18 }}>
              <Checkbox inputId="showInVolunteerList" checked={publicProfile.showInVolunteerList} onChange={e => handlePublicChange("showInVolunteerList", e.checked)} className="mr-2" />
              <label htmlFor="showInVolunteerList" style={{ textAlign: "left" }}>Mostra nella lista volontari</label>
            </div>
            <div style={{ display: "flex", alignItems: "center", marginBottom: 18 }}>
              <label htmlFor="publicEmail" style={{ width: 200, textAlign: "left", marginRight: 16 }}>Email pubblica</label>
              <InputText id="publicEmail" value={publicProfile.publicEmail} onChange={e => handlePublicChange("publicEmail", e.target.value)} style={{ flex: 1 }} />
            </div>
            <div style={{ display: "flex", alignItems: "center", marginBottom: 18 }}>
              <label htmlFor="bio" style={{ width: 200, textAlign: "left", marginRight: 16 }}>Bio</label>
              <InputTextarea id="bio" value={publicProfile.bio} onChange={e => handlePublicChange("bio", e.target.value)} rows={3} style={{ flex: 1 }} />
            </div>
            <div style={{ display: "flex", alignItems: "center", marginBottom: 18 }}>
              <label htmlFor="facebook" style={{ width: 200, textAlign: "left", marginRight: 16 }}>Facebook</label>
              <InputText id="facebook" value={publicProfile.facebook} onChange={e => handlePublicChange("facebook", e.target.value)} style={{ flex: 1 }} />
            </div>
            <div style={{ display: "flex", alignItems: "center", marginBottom: 18 }}>
              <label htmlFor="instagram" style={{ width: 200, textAlign: "left", marginRight: 16 }}>Instagram</label>
              <InputText id="instagram" value={publicProfile.instagram} onChange={e => handlePublicChange("instagram", e.target.value)} style={{ flex: 1 }} />
            </div>
            <div style={{ display: "flex", alignItems: "center", marginBottom: 18 }}>
              <label htmlFor="linkedin" style={{ width: 200, textAlign: "left", marginRight: 16 }}>LinkedIn</label>
              <InputText id="linkedin" value={publicProfile.linkedin} onChange={e => handlePublicChange("linkedin", e.target.value)} style={{ flex: 1 }} />
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
