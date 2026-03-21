import { useState, useRef } from "react";
import { auth, functions } from "../firebase";
import { httpsCallable } from "firebase/functions";
import { useNavigate } from "react-router-dom";
import { Checkbox } from "primereact/checkbox";
import { Button } from "primereact/button";
import { Panel } from "primereact/panel";
import { Toast } from "primereact/toast";
import { Accordion, AccordionTab } from "primereact/accordion";
import { Message } from "primereact/message";

export default function VolunteerConsentPage() {
    const [privacyAccepted, setPrivacyAccepted] = useState(false);
    const [codeAccepted, setCodeAccepted] = useState(false);
    const [saving, setSaving] = useState(false);
    const navigate = useNavigate();
    const toast = useRef<Toast>(null);

    const handleSubmit = async () => {
        if (saving) return;
        setSaving(true);
        try {
            const user = auth.currentUser;
            if (!user) throw new Error("Utente non autenticato");
            const acceptFn = httpsCallable(functions, "acceptVolunteerConsents");
            await acceptFn();
            navigate("/home", { replace: true });
        } catch (error: unknown) {
            toast.current?.show({ severity: "error", summary: "Errore", detail: (error as { message?: string })?.message || "Salvataggio fallito. Riprova.", life: 3000 });
        }
        setSaving(false);
    };

    return (
        <div style={{ margin: "40px auto", padding: "0 16px 60px" }}>
            <Toast ref={toast} />

            {/* Header */}
            <div style={{ textAlign: "center", marginBottom: 32, maxWidth: 720, margin: "0 auto 32px" }}>
                <h2 style={{ color: "#0050b3", margin: 0, fontSize: 28 }}>Benvenuto in e-Nable Italia</h2>
                <p style={{ color: "#64748b", marginTop: 8, fontSize: 15 }}>
                    Prima di accedere al portale ti chiediamo di leggere e accettare l'informativa
                    sulla privacy e il codice etico della nostra community.
                </p>
                <p style={{ marginTop: 4 }}>
                    <a
                        href="https://e-nableitalia.it/it_it/informazioni-volontari/"
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: "#0050b3" }}
                    >
                        Maggiori informazioni sulla community e sui volontari
                    </a>
                </p>
            </div>

            {/* Privacy + Codice Etico — wider panel area */}
            <div style={{ maxWidth: 1400, margin: "0 auto" }}>
            {/* Privacy */}
            <Panel header="Informativa Privacy" style={{ marginBottom: 24 }}>
                <div
                    style={{
                        maxHeight: 220,
                        overflowY: "auto",
                        fontSize: 14,
                        color: "#334155",
                        lineHeight: 1.7,
                        padding: "0 4px",
                    }}
                >
                    <p>
                        I dati personali raccolti tramite questo portale (nome, cognome, email, telefono, username Telegram, provincia)
                        sono trattati da Energy Family Project APS, titolare del trattamento, con sede legale in Italia,
                        CF 96433570582, nel rispetto del Regolamento Europeo 2016/679 (GDPR) e del D.Lgs. 196/2003 come modificato.
                    </p>
                    <p>
                        I dati sono utilizzati esclusivamente per la gestione delle attività di volontariato della community
                        e-Nable Italia: coordinamento delle richieste di device, comunicazione con volontari e famiglie,
                        reportistica interna. Non sono ceduti a terzi né utilizzati per finalità commerciali.
                    </p>
                    <p>
                        I dati sono conservati per tutta la durata del rapporto di volontariato e per il periodo successivo
                        previsto dagli obblighi di legge. Puoi esercitare i tuoi diritti (accesso, rettifica, cancellazione,
                        portabilità, opposizione) scrivendo a{" "}
                        <a href="mailto:info@e-nableitalia.it">info@e-nableitalia.it</a>.
                    </p>
                    <p>
                        Per l'informativa completa visita il sito{" "}
                        <a href="https://e-nableitalia.it/it_it/privacy-policy-2/" target="_blank" rel="noopener noreferrer">
                            e-nableitalia.it/privacy-policy
                        </a>.
                    </p>
                </div>
            </Panel>

            {/* Code of conduct */}
            <Panel header="Codice Etico" style={{ marginBottom: 32 }}>
                <div
                    style={{
                        maxHeight: 480,
                        overflowY: "auto",
                        fontSize: 14,
                        color: "#334155",
                        lineHeight: 1.7,
                        padding: "0 4px",
                    }}
                >
                    <Message
                        severity="info"
                        text="La community e-Nable Italia si basa su collaborazione, rispetto e condivisione. Le linee guida qui sotto non sono semplici regole, ma il risultato dell'esperienza maturata nel tempo per garantire un ambiente positivo per tutti."
                        style={{ marginBottom: 16, width: "100%" }}
                    />

                    <Accordion>

                        <AccordionTab header="Principi della community">
                            <p>
                                Il movimento internazionale e-Nable è alimentato dai principi di <strong>rispetto reciproco</strong>,
                                <strong> supporto</strong> e <strong>buona volontà</strong>: per questo la cultura della community
                                è fondamentale ed è importante contribuire a mantenerla nel tempo.
                            </p>

                            <p>
                                Ci aspettiamo che ogni membro dimostri rispetto per gli altri in ogni momento, adotti uno spirito
                                di condivisione, metta in discussione gli argomenti e non le persone, e contribuisca con
                                osservazioni, soluzioni e analisi costruttive.
                            </p>

                            <p>
                                La community e-Nable è aperta a tutti, indipendentemente da sesso, orientamento sessuale,
                                disabilità, aspetto fisico, etnia o religione. Le comunicazioni dovrebbero essere sempre
                                <strong> professionali, inclusive e rispettose</strong>, in un contesto che valorizza le differenze
                                come elemento di crescita comune.
                            </p>

                            <p>
                                Ti chiediamo di prestare attenzione a comportamenti o linguaggi che possano escludere, sminuire
                                o mettere a disagio altre persone. In caso di situazioni non coerenti con questi principi,
                                il gruppo di coordinamento potrà intervenire per tutelare la community e le persone coinvolte.
                            </p>
                        </AccordionTab>

                        <AccordionTab header="Ruolo del volontario">
                            <p>
                                e-Nable Italia è una <strong>community aperta e inclusiva</strong>, parte del movimento
                                internazionale e-Nable: una rete globale di volontari che mettono a disposizione competenze,
                                tempo e strumenti per realizzare <em>device stampati in 3D</em> destinati a persone con
                                limb difference.
                            </p>

                            <p>
                                È importante sapere che <strong>e-Nable Italia non è un’azienda e non vende prodotti</strong>:
                                i device sono <strong>realizzati e donati gratuitamente</strong> a chi ne ha bisogno.
                                Il contributo dei volontari si basa quindi su uno spirito di collaborazione e condivisione,
                                senza finalità commerciali.
                            </p>

                            <p>
                                I device e-Nable <strong>non sono protesi e non intendono sostituirle</strong>. Si tratta di strumenti che possono:
                            </p>

                            <ul>
                                <li>favorire un <strong>avvicinamento graduale all’uso delle protesi</strong>, soprattutto nei bambini;</li>
                                <li>integrare le soluzioni esistenti dove <strong>non sono disponibili alternative adeguate</strong> (ad esempio in ambito ludico o sportivo);</li>
                                <li>supportare percorsi di <strong>inclusione e autonomia</strong> nella vita quotidiana.</li>
                            </ul>

                            <p>
                                L’iniziativa è <strong>promossa e coordinata da Energy Family Project APS</strong>, che svolge
                                un ruolo di raccordo tra famiglie e volontari: raccoglie le richieste, le condivide con la community
                                e facilita il coordinamento delle attività.
                            </p>

                            <p>
                                I volontari operano <strong>in autonomia o in piccoli gruppi</strong>, in base alle proprie competenze
                                e disponibilità, all’interno di un contesto collaborativo condiviso.
                                L’associazione, quando possibile, supporta le attività contribuendo ai costi dei materiali,
                                offrendo supporto logistico e mettendo a disposizione strumenti e risorse.
                            </p>

                            <p>
                                <strong>Tempi e modalità di partecipazione sono flessibili</strong> e vengono definiti insieme
                                al coordinamento: la disponibilità può variare nel tempo e non implica automaticamente
                                un impegno continuativo su tutti i progetti.
                            </p>

                            <p>
                                Quando scegli di prendere in carico un’attività, ti chiediamo di farlo con responsabilità
                                verso la community e verso i recipient, <strong>portando a termine quanto condiviso</strong>
                                oppure segnalando tempestivamente eventuali difficoltà.
                            </p>

                            <p>
                                È importante operare seguendo le linee guida della community, prestando attenzione alla
                                <strong>qualità e sicurezza dei device</strong>, affinché siano adeguati alle esigenze degli utilizzatori.
                            </p>

                            <p>
                                Ti invitiamo inoltre a rimanere aggiornato sulle evoluzioni dei progetti e dei device
                                condivisi dalla community e-Nable, anche attraverso gli strumenti disponibili a livello internazionale.
                            </p>
                        </AccordionTab>

                        <AccordionTab header="Progetti e collaborazione">
                            <p>
                                Le attività della community e-Nable Italia si sviluppano principalmente in due ambiti:
                            </p>

                            <ul>
                                <li>
                                    <strong>la realizzazione di un device</strong>, su richiesta di una famiglia o di un utilizzatore;
                                </li>
                                <li>
                                    <strong>lo sviluppo o il miglioramento di progetti open source</strong>, condivisi con la community.
                                </li>
                            </ul>

                            <p>
                                La realizzazione di un device è generalmente gestita da volontari che operano
                                <strong> in autonomia</strong>, organizzandosi in base alle proprie competenze,
                                disponibilità e, quando possibile, alla vicinanza geografica con il recipient.
                            </p>

                            <p>
                                I progetti di <strong>ricerca, sviluppo e miglioramento open source</strong> sono invece
                                attività collaborative, con l’obiettivo di creare soluzioni accessibili, migliorabili
                                e riutilizzabili da tutti.
                            </p>

                            <p>
                                In questo contesto è fondamentale mantenere uno <strong>spirito di condivisione e rispetto</strong>:
                                i file, le documentazioni e i contributi sono il risultato di un lavoro collettivo.
                                Ti chiediamo quindi di prestare attenzione alle <strong>licenze dei progetti</strong>,
                                verificando sempre le condizioni d’uso prima di modificare o distribuire materiali.
                            </p>

                            <p>
                                Quando contribuisci a un progetto:
                            </p>

                            <ul>
                                <li>il lavoro viene generalmente condiviso come <strong>progetto collettivo della community</strong>;</li>
                                <li>i contributi individuali sono riconosciuti e valorizzati nel contesto del progetto;</li>
                                <li>i nuovi sviluppi sono normalmente rilasciati come <strong>open source</strong>, in linea con i principi del movimento e-Nable.</li>
                            </ul>

                            <p>
                                È possibile portare avanti anche progetti personali, purché siano mantenuti
                                <strong> distinti dalle attività e-Nable Italia</strong> e non generino ambiguità
                                rispetto alla community o ai suoi progetti.
                            </p>

                            <p>
                                La condivisione di contenuti (foto, video, comunicazioni) è benvenuta:
                                ti chiediamo di farlo con attenzione, nel rispetto delle persone coinvolte
                                e coordinandoti quando necessario per garantire coerenza e tutela della privacy.
                            </p>

                            <p>
                                Per approfondire puoi consultare il sito{" "}
                                <a href="https://e-nableitalia.it" target="_blank" rel="noopener noreferrer">
                                    e-nableitalia.it
                                </a>.
                            </p>
                        </AccordionTab>
                    </Accordion>
                </div>
            </Panel>
            </div>{/* end wider panel area */}

            {/* Checkboxes */}
            <div style={{ background: "#f8fafc", borderRadius: 8, padding: "20px 24px", marginBottom: 28, border: "1px solid #e2e8f0", maxWidth: 720, margin: "0 auto 28px" }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 16 }}>
                    <Checkbox
                        inputId="acceptPrivacy"
                        checked={privacyAccepted}
                        onChange={e => setPrivacyAccepted(!!e.checked)}
                    />
                    <label htmlFor="acceptPrivacy" style={{ cursor: "pointer", lineHeight: 1.5 }}>
                        Ho letto e accetto l'<strong>informativa sulla privacy</strong>
                    </label>
                </div>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                    <Checkbox
                        inputId="acceptCode"
                        checked={codeAccepted}
                        onChange={e => setCodeAccepted(!!e.checked)}
                    />
                    <label htmlFor="acceptCode" style={{ cursor: "pointer", lineHeight: 1.5 }}>
                        Ho letto e accetto il <strong>codice etico</strong> della community e-Nable Italia
                    </label>
                </div>
            </div>

            <div style={{ textAlign: "center", maxWidth: 720, margin: "0 auto" }}>
                <Button
                    label="Accetta e continua"
                    icon="pi pi-check"
                    onClick={handleSubmit}
                    disabled={!privacyAccepted || !codeAccepted}
                    loading={saving}
                    className="p-button-lg"
                />
            </div>
        </div>
    );
}
