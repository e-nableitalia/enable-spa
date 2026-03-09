
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
    assignedVolunteer: string;
    createdBy: string;
    gender: string;
    status: deviceStatus;
    updatedAt: any; // Firestore Timestamp
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