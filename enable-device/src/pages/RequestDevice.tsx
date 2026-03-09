import { useState, useRef } from "react";
import { Card } from "primereact/card";
import { InputText } from "primereact/inputtext";
import { InputTextarea } from "primereact/inputtextarea";
import { Dropdown } from "primereact/dropdown";
import { RadioButton } from "primereact/radiobutton";
import { Checkbox } from "primereact/checkbox";
import { Button } from "primereact/button";
import { Toast } from "primereact/toast";
import { Message } from "primereact/message";
import logo from "../assets/logo.png";
import { httpsCallable } from "@firebase/functions";
import { functions } from "../firebase";
import { getRecaptchaToken } from "../services/security/recaptcha";
import Footer from "../components/layout/Footer";
import PROVINCE from "../helpers/province.json";

type FormData = {
    email: string;
    firstName: string;
    lastName: string;
    phone: string;
    province: string;

    relation: string;
    age: string;
    gender: string;

    therapy: boolean;
    amputationType: string;

    description: string;
    preferences: string;
    consentPrivacy: boolean;
};

const AMPUTATIONS = [
    "Mano, polso funzionale con parte residua di palmo",
    "Braccio sotto il gomito",
    "Braccio sopra il gomito",
    "Altro",
];

export default function RequestDevice() {
    const toast = useRef<Toast>(null);

    const [form, setForm] = useState<FormData>({
        email: "",
        firstName: "",
        lastName: "",
        phone: "",
        province: "",
        relation: "",
        age: "",
        gender: "",
        therapy: false,
        amputationType: "",
        description: "",
        preferences: "",
        consentPrivacy: false,
    });
    const [submitted, setSubmitted] = useState(false);

    const update = (field: keyof FormData, value: any) => {
        setForm({ ...form, [field]: value });
    };

    const validate = () => {
        if (
            !form.email ||
            !form.firstName ||
            !form.lastName ||
            !form.phone ||
            !form.province ||
            !form.amputationType ||
            !form.consentPrivacy
        ) {
            toast.current?.show({
                severity: "error",
                summary: "Errore",
                detail: "Compila tutti i campi obbligatori",
            });
            return false;
        }
        return true;
    };

    const handleSubmit = async () => {
        if (!validate()) return;

        try {
            const token = await getRecaptchaToken("create_device_request");

            const callable = httpsCallable(functions, "createDeviceRequest");

            const formDataToSubmit = {
                ...form,
                recaptchaToken: token,
            };

            console.log("FORM SENT:", formDataToSubmit);

            await callable(formDataToSubmit);

            toast.current?.show({
                severity: "success",
                summary: "Richiesta inviata",
                detail: "Riceverai una email di conferma",
            });

            setForm({
                email: "",
                firstName: "",
                lastName: "",
                phone: "",
                province: "",
                relation: "",
                age: "",
                gender: "",
                therapy: false,
                amputationType: "",
                description: "",
                preferences: "",
                consentPrivacy: false,
            });
            setSubmitted(true);
        } catch (err) {
            console.error("Error submitting device request:", err);
            toast.current?.show({
                severity: "error",
                summary: "Errore",
                detail: "Errore durante l'invio della richiesta",
            });
        }
    };

    return (
        <div style={{ padding: 0, maxWidth: 900, margin: "auto" }}>
            {/* Banner con logo e descrizione */}
            <div
                style={{
                    width: "100%",
                    background: "#f5f7fa",
                    borderBottom: "1px solid #e0e3e7",
                    padding: "24px 0 16px 0",
                    marginBottom: 24,
                    display: "flex",
                    alignItems: "center",
                    gap: 24,
                    flexWrap: "wrap"
                }}
            >
                <div style={{
                    flex: 1,
                    textAlign: "center"
                }}>
                    <img
                        src={logo}
                        alt="e-Nable Italia"
                        style={{ height: 56, marginLeft: 24, marginRight: 8 }}
                    />
                    <div>
                        <div
                            style={{
                                fontWeight: 700,
                                fontSize: 22,
                                color: "#2d3a4a",
                            }}
                        >
                            Richiesta Device e-Nable Italia
                        </div>
                    </div>
                </div>
                <div style={{
                    textAlign: "center"
                }}>
                    <div
                        style={{
                            fontSize: 16,
                            color: "#4b5563",
                            marginTop: 4,
                        }}
                    >
                        <i>
                            I device sono progettati e realizzati <b>a titolo completamente gratuito</b> da volontari — ingegneri, tecnici e maker — di <b>e-Nable Italia</b> che mettono a disposizione il proprio tempo e le proprie competenze per supportare bambini e adulti con problemi di limb difference.<br /><br />
                            L’iniziativa è <b>coordinata e sostenuta da Energy Family Project APS</b>
                        </i>, associazione di famiglie impegnata nel promuovere soluzioni accessibili e inclusive.<br /><br />

                        Compilando il modulo sottostante puoi inviare una richiesta per te o per un’altra persona.<br /><br />
                        <span style={{ color: "#1976d2" }}>
                            Dopo l’invio sarai ricontattato via email dal nostro team di volontari per valutare insieme la fattibilità della richiesta.
                        </span>                    
                    </div>
                </div>
            </div>

            <div style={{ padding: 24 }}>
                <Toast ref={toast} />
                <Card title="Richiesta Device">
                    <div className="p-fluid grid">
                        <Message
                            style={{
                                border: "solid #1976d2",
                                borderWidth: "0 0 0 6px",
                                color: "#1976d2",
                                background: "#f5f7fa",
                            }}
                            className="border-primary w-full justify-content-start"
                            severity="info"
                            content={
                                <div
                                    style={{
                                        display: "flex",
                                        alignItems: "flex-start",
                                        gap: 12,
                                    }}
                                >
                                    <i
                                        className="pi pi-info-circle"
                                        style={{
                                            fontSize: 24,
                                            color: "#1976d2",
                                            marginTop: 4,
                                        }}
                                    />
                                    <div>
                                        <b>
                                            <i style={{ fontSize: 20 }}>
                                                &nbsp;I device e-Nable sono dispositivi assistivi sperimentali realizzati a partire da progetti Open Source, non sono ausili protesici.
                                            </i>
                                        </b>
                                        <p>
                                            Per approfondire le caratteristiche dei device e-Nable, visita la pagina <a href="https://e-nableitalia.it/it_it/richiedi-un-device/" target="_blank" rel="noopener noreferrer" style={{ color: "#1976d2", textDecoration: "underline" }}>Scopri i device e-Nable</a>.
                                        </p>
                                        <p>
                                            Se non conosci il tipo di collaborazione richiesta alla famiglia per la costruzione del device, o hai dubbi su cosa aspettarti, <a href="https://e-nableitalia.it/it_it/richiedi-un-device" target="_blank" rel="noopener noreferrer" style={{ color: "#1976d2", textDecoration: "underline" }}>qui trovi maggiori dettagli e informazioni</a>.
                                        </p>
                                        <p>
                                            Per qualsiasi dubbio o chiarimento puoi contattarci via email a <a href="mailto:device@e-nableitalia.it" style={{ color: "#1976d2", textDecoration: "underline" }}>device@e-nableitalia.it</a> o telefonicamente al <a href="tel:+393291003302" style={{ color: "#1976d2", textDecoration: "underline" }}>+39-329-1003302</a>.
                                        </p>
                                    </div>
                                </div>
                            }
                        />
                        {!submitted ? (
                            <>
                                {/* --- Requester Data --- */}
                                <div className="col-12">
                                    <h3>Dati Richiedente</h3>
                                    <div className="grid">
                                        <div className="col-12" style={{ marginTop: 16 }}>
                                            <label>Email *</label>
                                            <InputText
                                                value={form.email}
                                                onChange={(e) => update("email", e.target.value)}
                                            />
                                        </div>
                                        <div className="col-6" style={{ marginTop: 16 }}>
                                            <label>Nome *</label>
                                            <InputText
                                                value={form.firstName}
                                                onChange={(e) => update("firstName", e.target.value)}
                                            />
                                        </div>
                                        <div className="col-6" style={{ marginTop: 16 }}>
                                            <label>Cognome *</label>
                                            <InputText
                                                value={form.lastName}
                                                onChange={(e) => update("lastName", e.target.value)}
                                            />
                                        </div>
                                        <div className="col-6" style={{ marginTop: 16 }}>
                                            <label>Telefono *</label>
                                            <InputText
                                                value={form.phone}
                                                onChange={(e) => update("phone", e.target.value)}
                                            />
                                        </div>
                                        <div className="col-6" style={{ marginTop: 16 }}>
                                            <label>Provincia *</label>
                                            <Dropdown
                                                value={form.province}
                                                options={PROVINCE}
                                                onChange={(e) => update("province", e.value)}
                                                placeholder="Seleziona provincia"
                                            />
                                        </div>
                                    </div>
                                </div>

                                {/* --- Recipient Data --- */}
                                <div className="col-12" style={{ marginTop: 24 }}>
                                    <h3>Dati Destinatario</h3>
                                    <div className="grid">
                                        <div className="col-6" style={{ marginTop: 16 }}>
                                            <label>Relazione con destinatario</label>
                                            <InputText
                                                value={form.relation}
                                                onChange={(e) => update("relation", e.target.value)}
                                                tooltip="Inserire il tipo di relazione con il destinatario del device (es. Padre, madre, ecc.)"
                                                tooltipOptions={{ position: "right" }}
                                            />
                                        </div>
                                        <div className="col-6" style={{ marginTop: 16 }}>
                                            <label>Età destinatario</label>
                                            <InputText
                                                value={form.age}
                                                onChange={(e) => update("age", e.target.value)}
                                            />
                                        </div>
                                        <div className="col-12" style={{ marginTop: 16 }}>
                                            <label>Sesso destinatario</label>
                                            <div style={{ display: "flex", gap: 16 }}>
                                                <RadioButton
                                                    value="Maschio"
                                                    checked={form.gender === "Maschio"}
                                                    onChange={(e) => update("gender", e.value)}
                                                />
                                                Maschio
                                                <RadioButton
                                                    value="Femmina"
                                                    checked={form.gender === "Femmina"}
                                                    onChange={(e) => update("gender", e.value)}
                                                />
                                                Femmina
                                            </div>
                                        </div>
                                        <div className="col-12" style={{ marginTop: 16 }}>
                                            <Checkbox
                                                checked={form.therapy}
                                                onChange={(e) => update("therapy", e.checked)}
                                                tooltip="Selezionare questa voce se il destinatario segue un percorso fisioterapico/abilitativo/riabilitativo o è in carico ad una struttura medica"
                                                tooltipOptions={{ position: "right" }}
                                            />
                                            <label style={{ marginLeft: 8 }}>
                                                Segue terapia occupazionale / riabilitativa
                                            </label>
                                        </div>
                                    </div>
                                </div>

                                {/* --- Request Details --- */}
                                <div className="col-12" style={{ marginTop: 24 }}>
                                    <h3>Dettagli Richiesta</h3>
                                    <div className="grid">
                                        <div className="col-12">
                                            <label>Tipo di amputazione *</label>
                                            <Dropdown
                                                value={form.amputationType}
                                                options={AMPUTATIONS}
                                                onChange={(e) => update("amputationType", e.value)}
                                                placeholder="Seleziona opzione"
                                                tooltip="Specificare l'opzione che meglio identifica l'amputazione o la problematica del beneficiario, se la problematica non è riconducibile a quelle riportare in elenco selezionare l'opzione 'Altro' e, possibilmente, dettagliarne le caratteristiche."
                                                tooltipOptions={{ position: "right" }}
                                            />
                                        </div>
                                        <div className="col-12">
                                            <label>Descrizione</label>
                                            <InputTextarea
                                                rows={4}
                                                value={form.description}
                                                onChange={(e) => update("description", e.target.value)}
                                                tooltip="Ti chiediamo un momento per descrivere il tuo caso. Migliori sono i dettagli che fornisci, migliore sarà la valutazione da parte della comunità del tuo caso e prima potrai ottenere aiuto."
                                                tooltipOptions={{ position: "right" }}
                                            />
                                        </div>
                                        <div className="col-12">
                                            <label>Preferenze / Note</label>
                                            <InputTextarea
                                                rows={3}
                                                value={form.preferences}
                                                onChange={(e) => update("preferences", e.target.value)}
                                                tooltip="Qui puoi scrivere le tue preferenze o informazioni che ci potranno essere utili per la realizzazione del device (es. per un bambino supereroe o personaggio preferito, colori o altre informazioni utili)"
                                                tooltipOptions={{ position: "right" }}
                                            />
                                        </div>
                                    </div>
                                </div>

                                {/* --- Privacy Consent --- */}
                                <div className="col-12" style={{ marginTop: 24 }}>
                                    <h3>Consenso Privacy</h3>
                                    <div className="grid">
                                        <div className="col-12">
                                            <Checkbox
                                                checked={form.consentPrivacy}
                                                onChange={(e) => update("consentPrivacy", e.checked)}
                                            />
                                            <label style={{ marginLeft: 8 }}>
                                                * Dichiaro ai sensi dell’ex art 13 del Regolamento UE 2016/679 di aver preso visione della &nbsp;
                                                <a href="https://e-nableitalia.it/it_it/privacy-policy-2/" target="_blank" rel="noopener noreferrer" style={{ color: "#888", textDecoration: "underline" }}>
                                                informativa sulla privacy
                                                </a>&nbsp;
                                                e di essere informato sulle finalità e le modalità di trattamento cui sono destinati i dati, i soggetti a cui gli stessi potranno essere comunicati, anche in qualità di incaricati, nonché sul diritto di accesso ai dati personali forniti con facoltà di chiederne l’aggiornamento, la rettifica, l’integrazione e la cancellazione. Per quanto sopra, con l’invio della mia richiesta, esprimo il mio consenso al trattamento dei miei dati personali nelle modalità e per le finalità strettamente connesse e strumentali alla gestione della richiesta di un device e-Nable ed acconsento espressamente alla trasmissione dei dati in essa contenuti.
                                            </label>
                                        </div>
                                    </div>
                                </div>

                                <div className="col-12" style={{ marginTop: 16 }}>
                                    <Button
                                        label="Invia richiesta"
                                        icon="pi pi-send"
                                        onClick={handleSubmit}
                                    />
                                </div>
                            </>
                        ) : (
                            <div className="col-12" style={{
                                marginTop: 32,
                                background: "#f6ffed",
                                border: "1px solid #b7eb8f",
                                borderRadius: 6,
                                padding: 32,
                                color: "#135200",
                                fontSize: 18,
                                textAlign: "center"
                            }}>
                                <strong>Grazie per aver inviato la tua richiesta!</strong>
                                <br /><br />
                                Ti ricontatteremo via email il prima possibile per aggiornarti sullo stato della richiesta o per eventuali approfondimenti.
                                <br /><br />
                                Per qualsiasi dubbio puoi scriverci a <a href="mailto:device@e-nableitalia.it" style={{ color: "#1976d2", textDecoration: "underline" }}>device@e-nableitalia.it</a> o chiamarci al <a href="tel:+393291003302" style={{ color: "#1976d2", textDecoration: "underline" }}>+39-329-1003302</a>.
                                <div style={{ marginTop: 24 }}>
                                    <Button
                                        label="Chiudi pagina"
                                        icon="pi pi-times"
                                        onClick={() => window.close()}
                                        className="p-button-secondary"
                                    />
                                </div>
                            </div>
                        )}
                    </div>
                </Card>
            </div>
            <Footer />
        </div>
    );
}