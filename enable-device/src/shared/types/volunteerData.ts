// ========================================
// CORE USER
// ========================================

import type { ShippingAddress } from "./shippingAddress";

export type { ShippingAddress };

export type UserRole = "admin" | "volunteer";

export interface UserCore {
  active: boolean;
  email: string;
  role: UserRole;
  createdAt?: any; // Firestore Timestamp
}

// ========================================
// PRIVATE PROFILE
// users/{uid}/private/profile
// ========================================

// Valori reali usati nell'UI (VolunteerAvailability) e su Firestore
export type ContinuityType = "continuativa" | "spot" | "saltuaria";

// Valori reali usati nell'UI (VolunteerAvailability) e su Firestore
export type InvolvementLevel = "bassa" | "progetti" | "coordinamento" | "non so";

export interface VolunteerPrivateProfile {
  firstName: string;
  lastName: string;

  phone?: string;
  city?: string;
  telegramUsername?: string;

  availability?: string;
  continuityType?: ContinuityType;
  desiredInvolvementLevel?: InvolvementLevel;

  // campi futuri non ancora in UI
  mainInterest?: string;
  howDidYouKnowEnable?: string;
  additionalNotes?: string;

  consentPrivacy: boolean;

  // notifiche — campo UI non ancora salvato su Firestore
  notificationPreferences?: {
    email?: boolean;
    telegram?: boolean;
    whatsapp?: boolean;
  };

  /**
   * Indirizzo di spedizione del volontario.
   * Usato per spedire i dispositivi prodotti direttamente al volontario
   * o per la logistica di ritiro/consegna.
   *
   * Deve rimanere sotto users/{uid}/private/profile (dati privati).
   * Consistente con deviceRequestData: il campo analogo nella richiesta
   * dispositivo descrive l'indirizzo del destinatario finale.
   */
  shippingAddress?: ShippingAddress;

  updatedAt?: any; // Firestore Timestamp
}

// ========================================
// SKILLS
// users/{uid}/private/skills
// ========================================

export interface VolunteerSkills {
  // usati nell'UI (VolunteerProfile) e salvati su Firestore
  aboutMe?: string;
  mainInterest?: string[];
  enableInterestAreas?: string[];
  contributionPreferences?: string;
  desiredSkills?: string; // stringa singola (textarea), NON array

  updatedAt?: any;
}

// ========================================
// PRINTERS
// users/{uid}/printers/{printerId}
// ========================================

export interface VolunteerPrinter {
  id?: string; // Firestore document id

  brand: string;           // es. Prusa
  model: string;           // es. MK3S+
  
  buildVolumeX: number;    // mm
  buildVolumeY: number;
  buildVolumeZ: number;

  multiMaterial: boolean;
  flexibleSupported: boolean;
  directDrive: boolean;

  notes?: string;

  active: boolean;         // stampante attiva o dismessa

  createdAt?: any;
  updatedAt?: any;
}

// ========================================
// PUBLIC PROFILE
// users/{uid}/public/profile
// ========================================

export interface VolunteerPublicProfile {
  showInVolunteerList: boolean;

  publicEmail?: string;
  bio?: string;

  facebook?: string;
  instagram?: string;
  linkedin?: string;

  updatedAt?: any;
}

// ========================================
// AGGREGATED VIEW MODEL
// ========================================

export interface VolunteerData {
  uid: string;

  core: UserCore;

  privateProfile: VolunteerPrivateProfile;
  skills: VolunteerSkills;

  printers: VolunteerPrinter[];

  publicProfile: VolunteerPublicProfile;
}
