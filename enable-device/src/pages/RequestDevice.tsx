import { useState, useRef } from "react";
import { InputText } from "primereact/inputtext";
import { InputTextarea } from "primereact/inputtextarea";
import { Dropdown } from "primereact/dropdown";
import { RadioButton } from "primereact/radiobutton";
import { Checkbox } from "primereact/checkbox";
import { Button } from "primereact/button";
import { Toast } from "primereact/toast";
import heroImage from "../assets/projects-2.jpg";
import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase";
import { getRecaptchaToken } from "../services/security/recaptcha";
import Footer from "../components/layout/Footer";
import PROVINCE from "../helpers/province.json";
import "./public.css";

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
        <div className="pub">
            <Toast ref={toast} />

            <img
                className="pub-hero"
                src={heroImage}
                alt="Mano robotica che tocca il logo e-Nable Italia"
            />

            <main className="pub-main pub-narrow">
                <h1 className="pub-title">Richiedi un device e-Nable</h1>
                <p className="pub-lead">
                    I device sono progettati e realizzati <b>a titolo completamente gratuito</b> da volontari — ingegneri, tecnici e maker — di <b>e-Nable Italia</b>, che mettono a disposizione il proprio tempo e le proprie competenze per supportare bambini e adulti con limb difference.
                </p>

                <div className="pub-note">
                    <p>
                        L’iniziativa è <b>coordinata e sostenuta da Energy Family Project APS</b>, associazione di famiglie impegnata nel promuovere soluzioni accessibili e inclusive.
                    </p>
                    <p>
                        Compilando il modulo puoi inviare una richiesta per te o per un’altra persona. Dopo l’invio sarai ricontattato via email dal nostro team di volontari per valutare insieme la fattibilità della richiesta.
                    </p>
                </div>

                <div className="pub-note" role="note">
                    <p>
                        <strong>I device e-Nable sono dispositivi assistivi sperimentali realizzati a partire da progetti Open Source, non sono ausili protesici.</strong>
                    </p>
                    <p>
                        Per approfondire le caratteristiche dei device e-Nable, visita la pagina <a href="https://e-nableitalia.it/it_it/richiedi-un-device/" target="_blank" rel="noopener noreferrer">Scopri i device e-Nable</a>.
                    </p>
                    <p>
                        Se non conosci il tipo di collaborazione richiesta alla famiglia per la costruzione del device, o hai dubbi su cosa aspettarti, <a href="https://e-nableitalia.it/it_it/richiedi-un-device" target="_blank" rel="noopener noreferrer">qui trovi maggiori dettagli e informazioni</a>.
                    </p>
                    <p>
                        Per qualsiasi dubbio o chiarimento puoi contattarci via email a <a href="mailto:device@e-nableitalia.it">device@e-nableitalia.it</a> o telefonicamente al <a href="tel:+393291003302">+39-329-1003302</a>.
                    </p>
                </div>

                {!submitted ? (
                    <form
                        className="pub-form p-fluid"
                        noValidate
                        onSubmit={(e) => {
                            e.preventDefault();
                            handleSubmit();
                        }}
                    >
                        <fieldset>
                            <legend>Dati richiedente</legend>
                            <div className="pub-fields">
                                <div className="pub-field pub-span-2">
                                    <label htmlFor="rd-email">Email *</label>
                                    <InputText
                                        id="rd-email"
                                        type="email"
                                        autoComplete="email"
                                        value={form.email}
                                        onChange={(e) => update("email", e.target.value)}
                                    />
                                </div>
                                <div className="pub-field">
                                    <label htmlFor="rd-first">Nome *</label>
                                    <InputText
                                        id="rd-first"
                                        autoComplete="given-name"
                                        value={form.firstName}
                                        onChange={(e) => update("firstName", e.target.value)}
                                    />
                                </div>
                                <div className="pub-field">
                                    <label htmlFor="rd-last">Cognome *</label>
                                    <InputText
                                        id="rd-last"
                                        autoComplete="family-name"
                                        value={form.lastName}
                                        onChange={(e) => update("lastName", e.target.value)}
                                    />
                                </div>
                                <div className="pub-field">
                                    <label htmlFor="rd-phone">Telefono *</label>
                                    <InputText
                                        id="rd-phone"
                                        type="tel"
                                        autoComplete="tel"
                                        value={form.phone}
                                        onChange={(e) => update("phone", e.target.value)}
                                    />
                                </div>
                                <div className="pub-field">
                                    <label htmlFor="rd-province">Provincia *</label>
                                    <Dropdown
                                        inputId="rd-province"
                                        value={form.province}
                                        options={PROVINCE}
                                        onChange={(e) => update("province", e.value)}
                                        placeholder="Seleziona provincia"
                                    />
                                </div>
                            </div>
                        </fieldset>

                        <fieldset>
                            <legend>Dati destinatario</legend>
                            <div className="pub-fields">
                                <div className="pub-field">
                                    <label htmlFor="rd-relation">Relazione con destinatario</label>
                                    <InputText
                                        id="rd-relation"
                                        value={form.relation}
                                        onChange={(e) => update("relation", e.target.value)}
                                        tooltip="Inserire il tipo di relazione con il destinatario del device (es. Padre, madre, ecc.)"
                                        tooltipOptions={{ position: "top" }}
                                    />
                                </div>
                                <div className="pub-field">
                                    <label htmlFor="rd-age">Età destinatario</label>
                                    <InputText
                                        id="rd-age"
                                        value={form.age}
                                        onChange={(e) => update("age", e.target.value)}
                                    />
                                </div>
                                <div className="pub-field pub-span-2">
                                    <label id="rd-gender-label">Sesso destinatario</label>
                                    <div className="pub-inline" role="radiogroup" aria-labelledby="rd-gender-label">
                                        <RadioButton
                                            inputId="rd-gender-m"
                                            value="Maschio"
                                            checked={form.gender === "Maschio"}
                                            onChange={(e) => update("gender", e.value)}
                                        />
                                        <label htmlFor="rd-gender-m" style={{ marginRight: 16 }}>Maschio</label>
                                        <RadioButton
                                            inputId="rd-gender-f"
                                            value="Femmina"
                                            checked={form.gender === "Femmina"}
                                            onChange={(e) => update("gender", e.value)}
                                        />
                                        <label htmlFor="rd-gender-f">Femmina</label>
                                    </div>
                                </div>
                                <div className="pub-check pub-span-2">
                                    <Checkbox
                                        inputId="rd-therapy"
                                        checked={form.therapy}
                                        onChange={(e) => update("therapy", e.checked)}
                                        tooltip="Selezionare questa voce se il destinatario segue un percorso fisioterapico/abilitativo/riabilitativo o è in carico ad una struttura medica"
                                        tooltipOptions={{ position: "top" }}
                                    />
                                    <label htmlFor="rd-therapy">
                                        Segue terapia occupazionale / riabilitativa
                                    </label>
                                </div>
                            </div>
                        </fieldset>

                        <fieldset>
                            <legend>Dettagli richiesta</legend>
                            <div className="pub-fields">
                                <div className="pub-field pub-span-2">
                                    <label htmlFor="rd-amputation">Tipo di amputazione *</label>
                                    <Dropdown
                                        inputId="rd-amputation"
                                        value={form.amputationType}
                                        options={AMPUTATIONS}
                                        onChange={(e) => update("amputationType", e.value)}
                                        placeholder="Seleziona opzione"
                                        tooltip="Specificare l'opzione che meglio identifica l'amputazione o la problematica del beneficiario, se la problematica non è riconducibile a quelle riportare in elenco selezionare l'opzione 'Altro' e, possibilmente, dettagliarne le caratteristiche."
                                        tooltipOptions={{ position: "top" }}
                                    />
                                </div>
                                <div className="pub-field pub-span-2">
                                    <label htmlFor="rd-description">Descrizione</label>
                                    <InputTextarea
                                        id="rd-description"
                                        rows={4}
                                        value={form.description}
                                        onChange={(e) => update("description", e.target.value)}
                                        tooltip="Ti chiediamo un momento per descrivere il tuo caso. Migliori sono i dettagli che fornisci, migliore sarà la valutazione da parte della comunità del tuo caso e prima potrai ottenere aiuto."
                                        tooltipOptions={{ position: "top" }}
                                    />
                                </div>
                                <div className="pub-field pub-span-2">
                                    <label htmlFor="rd-preferences">Preferenze / Note</label>
                                    <InputTextarea
                                        id="rd-preferences"
                                        rows={3}
                                        value={form.preferences}
                                        onChange={(e) => update("preferences", e.target.value)}
                                        tooltip="Qui puoi scrivere le tue preferenze o informazioni che ci potranno essere utili per la realizzazione del device (es. per un bambino supereroe o personaggio preferito, colori o altre informazioni utili)"
                                        tooltipOptions={{ position: "top" }}
                                    />
                                </div>
                            </div>
                        </fieldset>

                        <fieldset>
                            <legend>Consenso privacy</legend>
                            <div className="pub-check" style={{ marginTop: 12 }}>
                                <Checkbox
                                    inputId="rd-consent"
                                    checked={form.consentPrivacy}
                                    onChange={(e) => update("consentPrivacy", e.checked)}
                                />
                                <label htmlFor="rd-consent" className="pub-legal">
                                    * Dichiaro ai sensi dell’ex art 13 del Regolamento UE 2016/679 di aver preso visione della{" "}
                                    <a href="https://e-nableitalia.it/it_it/privacy-policy-2/" target="_blank" rel="noopener noreferrer">
                                        informativa sulla privacy
                                    </a>{" "}
                                    e di essere informato sulle finalità e le modalità di trattamento cui sono destinati i dati, i soggetti a cui gli stessi potranno essere comunicati, anche in qualità di incaricati, nonché sul diritto di accesso ai dati personali forniti con facoltà di chiederne l’aggiornamento, la rettifica, l’integrazione e la cancellazione. Per quanto sopra, con l’invio della mia richiesta, esprimo il mio consenso al trattamento dei miei dati personali nelle modalità e per le finalità strettamente connesse e strumentali alla gestione della richiesta di un device e-Nable ed acconsento espressamente alla trasmissione dei dati in essa contenuti.
                                </label>
                            </div>
                        </fieldset>

                        <div>
                            <Button
                                type="submit"
                                label="Invia richiesta"
                                icon="pi pi-send"
                                className="pub-btn-primary"
                                style={{ width: "auto" }}
                            />
                        </div>
                    </form>
                ) : (
                    <div className="pub-success" role="status">
                        <h2>Grazie per aver inviato la tua richiesta!</h2>
                        <p>
                            Ti ricontatteremo via email il prima possibile per aggiornarti sullo stato della richiesta o per eventuali approfondimenti.
                        </p>
                        <p>
                            Per qualsiasi dubbio puoi scriverci a <a href="mailto:device@e-nableitalia.it">device@e-nableitalia.it</a> o chiamarci al <a href="tel:+393291003302">+39-329-1003302</a>.
                        </p>
                        <Button
                            label="Chiudi pagina"
                            icon="pi pi-times"
                            onClick={() => window.close()}
                            className="pub-btn-outline"
                        />
                    </div>
                )}

                <div className="pub-brandbar">
                    <span className="pub-brandbar-meta">
                        Richiesta device · v{__APP_VERSION__} · Aggiornata al {__BUILD_DATE__}
                    </span>
                </div>
            </main>
            <Footer />
        </div>
    );
}
