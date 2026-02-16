// ========================================
// CORE USER
// ========================================

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

export type ContinuityType = "continuativo" | "spot";

export type InvolvementLevel = "basso" | "medio" | "alto";

export interface VolunteerPrivateProfile {
  firstName: string;
  lastName: string;

  phone?: string;
  city?: string;
  telegramUsername?: string;

  mainInterest?: string;

  availability?: string;
  continuityType?: ContinuityType;
  desiredInvolvementLevel?: InvolvementLevel;

  howDidYouKnowEnable?: string;
  additionalNotes?: string;

  consentPrivacy: boolean;

  updatedAt?: any; // Firestore Timestamp
}

// ========================================
// SKILLS
// users/{uid}/private/skills
// ========================================

export interface VolunteerSkills {
  currentSkills?: string[];
  desiredSkills?: string[];
  enableInterestAreas?: string[];
  contributionPreferences?: string;

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
  photoUrl?: string;

  facebook?: string;
  instagram?: string;
  linkedin?: string;

  city?: string;
  mainInterest?: string;

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
