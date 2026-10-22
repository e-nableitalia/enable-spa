import { useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { InputText } from "primereact/inputtext";
import { InputTextarea } from "primereact/inputtextarea";
import { Dropdown } from "primereact/dropdown";
import { Checkbox } from "primereact/checkbox";
import { Button } from "primereact/button";
import { Toast } from "primereact/toast";
import heroImage from "../assets/projects-2.jpg";
import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase";
import { getRecaptchaToken } from "../services/security/recaptcha";
import Footer from "../components/layout/Footer";
import {
    CONTACT_MESSAGE_MAX_LENGTH,
    CONTACT_PROFILES,
    type ContactFormValues,
    readContactSource,
    validateContactForm,
} from "../helpers/contactProfiles";
import "./public.css";

const EMPTY_FORM: ContactFormValues = {
    firstName: "",
    lastName: "",
    phone: "",
    email: "",
    profile: "",
    profileOther: "",
    description: "",
    consentPrivacy: false,
};

/**
 * Form pubblica di richiesta contatto (`/contatti`, raggiungibile anche dal
 * QR code con `?src=qr`). I dati vengono salvati in `contacts` dalla callable
 * `createContactRequest`, che applica reCAPTCHA, campo trappola, tempo minimo
 * di compilazione e rate limit.
 */
export default function ContactRequest() {
    const toast = useRef<Toast>(null);
    const location = useLocation();
    // Istante di apertura della pagina, per il tempo minimo di compilazione
    const [openedAt] = useState(() => Date.now());
    const [form, setForm] = useState<ContactFormValues>(EMPTY_FORM);
    // Campo trappola: invisibile alle persone, i bot tendono a compilarlo.
    const [website, setWebsite] = useState("");
    const [sending, setSending] = useState(false);
    const [submitted, setSubmitted] = useState(false);

    const update = <K extends keyof ContactFormValues>(field: K, value: ContactFormValues[K]) => {
        setForm((prev) => ({ ...prev, [field]: value }));
    };

    const handleSubmit = async () => {
        const error = validateContactForm(form);
        if (error) {
            toast.current?.show({ severity: "error", summary: "Errore", detail: error });
            return;
        }

        setSending(true);
        try {
            const recaptchaToken = await getRecaptchaToken("create_contact_request");
            const callable = httpsCallable(functions, "createContactRequest");
            await callable({
                firstName: form.firstName,
                lastName: form.lastName,
                phone: form.phone,
                email: form.email,
                profile: form.profile || null,
                profileOther: form.profile === "altro" ? form.profileOther : null,
                description: form.description,
                consentPrivacy: form.consentPrivacy,
                source: readContactSource(location.search),
                website,
                elapsedMs: Date.now() - openedAt,
                recaptchaToken,
            });
            setForm(EMPTY_FORM);
            setSubmitted(true);
        } catch (err) {
            console.error("Error submitting contact request:", err);
            toast.current?.show({
                severity: "error",
                summary: "Errore",
                detail: "Errore durante l'invio della richiesta, riprova tra qualche minuto",
            });
        } finally {
            setSending(false);
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
                <h1 className="pub-title">Contattaci</h1>
                <p className="pub-lead">
                    Vuoi conoscere il progetto <b>e-Nable Italia</b>, collaborare come maker, coinvolgere la tua scuola o la tua organizzazione? Lasciaci i tuoi dati e ti ricontatteremo.
                </p>

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
                            <legend>I tuoi dati</legend>
                            <div className="pub-fields">
                                <div className="pub-field">
                                    <label htmlFor="cr-first">Nome *</label>
                                    <InputText
                                        id="cr-first"
                                        autoComplete="given-name"
                                        maxLength={100}
                                        value={form.firstName}
                                        onChange={(e) => update("firstName", e.target.value)}
                                    />
                                </div>
                                <div className="pub-field">
                                    <label htmlFor="cr-last">Cognome *</label>
                                    <InputText
                                        id="cr-last"
                                        autoComplete="family-name"
                                        maxLength={100}
                                        value={form.lastName}
                                        onChange={(e) => update("lastName", e.target.value)}
                                    />
                                </div>
                                <div className="pub-field">
                                    <label htmlFor="cr-phone">Telefono</label>
                                    <InputText
                                        id="cr-phone"
                                        type="tel"
                                        autoComplete="tel"
                                        maxLength={30}
                                        value={form.phone}
                                        onChange={(e) => update("phone", e.target.value)}
                                    />
                                </div>
                                <div className="pub-field">
                                    <label htmlFor="cr-email">Email</label>
                                    <InputText
                                        id="cr-email"
                                        type="email"
                                        autoComplete="email"
                                        maxLength={254}
                                        value={form.email}
                                        onChange={(e) => update("email", e.target.value)}
                                    />
                                </div>
                                <p className="pub-span-2 pub-hint">
                                    Inserisci almeno un recapito, telefono o email, per permetterci di ricontattarti.
                                </p>
                                <div
                                    aria-hidden="true"
                                    style={{ position: "absolute", left: "-10000px", width: 1, height: 1, overflow: "hidden" }}
                                >
                                    <label htmlFor="cr-website">Sito web</label>
                                    <input
                                        id="cr-website"
                                        name="website"
                                        type="text"
                                        tabIndex={-1}
                                        autoComplete="off"
                                        value={website}
                                        onChange={(e) => setWebsite(e.target.value)}
                                    />
                                </div>
                            </div>
                        </fieldset>

                        <fieldset>
                            <legend>La tua richiesta</legend>
                            <div className="pub-fields">
                                <div className="pub-field pub-span-2">
                                    <label htmlFor="cr-profile">Chi sei?</label>
                                    <Dropdown
                                        inputId="cr-profile"
                                        value={form.profile}
                                        options={[...CONTACT_PROFILES]}
                                        optionLabel="label"
                                        optionValue="value"
                                        onChange={(e) => update("profile", e.value ?? "")}
                                        placeholder="Seleziona un profilo (facoltativo)"
                                        showClear
                                    />
                                </div>
                                {form.profile === "altro" && (
                                    <div className="pub-field pub-span-2">
                                        <label htmlFor="cr-profile-other">Specifica</label>
                                        <InputText
                                            id="cr-profile-other"
                                            maxLength={100}
                                            value={form.profileOther}
                                            onChange={(e) => update("profileOther", e.target.value)}
                                        />
                                    </div>
                                )}
                                {form.profile === "famiglia" && (
                                    <div className="pub-note pub-span-2" role="note">
                                        <p>
                                            Se desideri richiedere un device e-Nable per te o per un tuo familiare, compila direttamente il{" "}
                                            <Link to="/request-device">modulo di richiesta device</Link>: è il modo più rapido per essere ricontattato dal team che segue le richieste.
                                        </p>
                                    </div>
                                )}
                                <div className="pub-field pub-span-2">
                                    <label htmlFor="cr-description">Motivo del contatto / note</label>
                                    <InputTextarea
                                        id="cr-description"
                                        rows={4}
                                        maxLength={CONTACT_MESSAGE_MAX_LENGTH}
                                        value={form.description}
                                        onChange={(e) => update("description", e.target.value)}
                                    />
                                </div>
                            </div>
                        </fieldset>

                        <fieldset>
                            <legend>Consenso privacy</legend>
                            <div className="pub-check" style={{ marginTop: 12 }}>
                                <Checkbox
                                    inputId="cr-consent"
                                    checked={form.consentPrivacy}
                                    onChange={(e) => update("consentPrivacy", Boolean(e.checked))}
                                />
                                <label htmlFor="cr-consent" className="pub-legal">
                                    * Dichiaro ai sensi dell’art. 13 del Regolamento UE 2016/679 di aver preso visione dell’
                                    <a href="https://e-nableitalia.it/it_it/privacy-policy-2/" target="_blank" rel="noopener noreferrer">
                                        informativa sulla privacy
                                    </a>{" "}
                                    e acconsento al trattamento dei miei dati. Titolare del trattamento è <b>Energy Family Project APS</b>. I dati inseriti (nome, cognome, telefono e/o email, profilo e motivo del contatto) sono raccolti al solo scopo di rispondere a questa richiesta di contatto e, se lo desidero, di coinvolgermi nelle attività del progetto e-Nable Italia. Sono consultabili solo dai volontari incaricati della gestione dei contatti, non vengono ceduti a terzi né usati per comunicazioni promozionali senza un ulteriore consenso, e sono conservati per 24 mesi dall’ultimo contatto. Posso chiederne in qualsiasi momento l’accesso, la rettifica o la cancellazione secondo quanto indicato nell’informativa.
                                </label>
                            </div>
                        </fieldset>

                        <div>
                            <Button
                                type="submit"
                                label={sending ? "Invio in corso..." : "Invia richiesta"}
                                icon="pi pi-send"
                                className="pub-btn-primary"
                                style={{ width: "auto" }}
                                disabled={sending}
                            />
                        </div>
                    </form>
                ) : (
                    <div className="pub-success" role="status">
                        <h2>Grazie, abbiamo ricevuto la tua richiesta!</h2>
                        <p>Un volontario di e-Nable Italia ti ricontatterà il prima possibile.</p>
                    </div>
                )}

                <div className="pub-brandbar">
                    <span className="pub-brandbar-meta">
                        Richiesta contatto · v{__APP_VERSION__} · Aggiornata al {__BUILD_DATE__}
                    </span>
                </div>
            </main>
            <Footer />
        </div>
    );
}
