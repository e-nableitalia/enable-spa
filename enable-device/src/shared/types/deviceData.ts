
import type { ShippingAddress } from "./shippingAddress";

export type { ShippingAddress };

export type publicStatus =
    | "da gestire"
    | "fabbricazione in corso"
    | "completati"
    | "annullate / non completabili";

export type deviceStatus =
    | "inviata"
    | "famiglia contattata"
    | "definizione richiesta"
    | "valutazione fattibilità"
    | "followup famiglia ko"
    | "followup famiglia troppo piccolo"
    | "attesa volontario"
    | "scelta device e dimensionamento"
    | "personalizzazione"
    | "attesa materiali"
    | "fabbricazione"
    | "pronta per spedizione"
    | "spedita"
    | "followup famiglia"
    | "completata"
    | "annullata";

export interface publicDeviceRequestData {
    createdAt: any; // Firestore Timestamp
    devicetype: string;
    province: string;
    publicStatus: publicStatus;
}

export interface deviceRequestData {
    age: number;
    /**
     * Lista degli uid dei volontari assegnati alla richiesta.
     *
     * Sostituisce il precedente campo scalare `assignedVolunteer: string`.
     *
     * Firestore: per filtrare le richieste di un volontario usare
     *   `where("assignedVolunteers", "array-contains", uid)`
     * invece del precedente
     *   `where("assignedVolunteer", "==", uid)`
     *
     * Compatibilità backward: i documenti Firestore creati prima della
     * migrazione hanno ancora `assignedVolunteer: string | null`. Leggere
     * entrambi i campi finché la migrazione non è completata:
     *   const volunteers = doc.assignedVolunteers
     *     ?? (doc.assignedVolunteer ? [doc.assignedVolunteer] : []);
     */
    assignedVolunteers: string[];
    createdBy: string;
    gender: string;
    status: deviceStatus;
    updatedAt: any; // Firestore Timestamp
    /**
     * Indirizzo di spedizione della richiesta (destinatario finale del dispositivo).
     * Corrisponde al campo toAddress in resolveShippingAddresses.
     * Salvato in deviceRequests/{id} — non nei dati privati, in quanto
     * usato dalla logistica senza accesso ai dati sensibili del richiedente.
     */
    shippingAddress?: ShippingAddress;

    // ── Campi operativi creati durante la validazione admin ──────────────────
    /**
     * Nome del destinatario del device (es. "Marco", "il figlio di").
     * Versione curata/pubblica dell'informazione, compilata dall'admin.
     */
    recipient?: string;
    /**
     * Relazione del richiedente con il destinatario (es. "genitore", "coniuge").
     * Versione operativa, curata dall'admin a partire dal campo privato omonimo.
     */
    relation?: string;
    /**
     * Descrizione pubblica/sanificata della situazione clinica/funzionale.
     * Derivata da privateDeviceRequestData.description, editata dall'admin.
     */
    descriptionPublic?: string;
    /**
     * Preferenze pubbliche/sanificata sul device desiderato.
     * Derivata da privateDeviceRequestData.preferences, editata dall'admin.
     */
    preferencesPublic?: string;
    /** Timestamp della validazione admin. Impostato al momento della conferma. */
    validatedAt?: any; // Firestore Timestamp
    /** UID dell'admin che ha effettuato la validazione. */
    validatedBy?: string;
}

export interface privateDeviceRequestData {
    amputationType: string;
    consentPrivacy: boolean;
    description: string;
    email: string;
    firstName: string;
    lastName: string;
    preferences: string;
    province: string;
    relation: string;
    therapy: boolean;
}