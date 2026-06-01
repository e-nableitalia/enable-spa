import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";

type UserRole = "admin" | "volunteer";

interface UserCore {
  active: boolean;
  email: string;
  role: UserRole;
  createdAt?: unknown;
}

interface VolunteerPrivateProfile {
  firstName: string;
  lastName: string;
  phone?: string;
  city?: string;
  telegramUsername?: string;
  availability?: string;
  continuityType?: "continuativa" | "spot" | "saltuaria";
  desiredInvolvementLevel?: "bassa" | "progetti" | "coordinamento" | "non so";
  howDidYouKnowEnable?: string;
  additionalNotes?: string;
  consentPrivacy: boolean;
  shippingAddress?: unknown;
  updatedAt?: unknown;
}

interface VolunteerSkills {
  aboutMe?: string;
  mainInterest?: string[];
  enableInterestAreas?: string[];
  contributionPreferences?: string;
  desiredSkills?: string;
  updatedAt?: unknown;
}

interface VolunteerPrinter {
  id: string;
  brand: string;
  model: string;
  buildVolumeX: number;
  buildVolumeY: number;
  buildVolumeZ: number;
  multiMaterial: boolean;
  flexibleSupported: boolean;
  directDrive: boolean;
  notes?: string;
  active: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
}

interface VolunteerPublicProfile {
  showInVolunteerList: boolean;
  publicEmail?: string;
  bio?: string;
  facebook?: string;
  instagram?: string;
  linkedin?: string;
  updatedAt?: unknown;
}

interface VolunteerData {
  uid: string;
  core: UserCore;
  privateProfile: VolunteerPrivateProfile;
  skills: VolunteerSkills;
  printers: VolunteerPrinter[];
  publicProfile: VolunteerPublicProfile;
}

const REGION = "europe-west1";

function asUserRole(value: unknown): UserRole {
  return value === "admin" ? "admin" : "volunteer";
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}

export const listVolunteerAdminData = onCall({ region: REGION }, async (req) => {
  const { auth } = req;
  if (!auth) {
    throw new HttpsError("unauthenticated", "Authentication required");
  }

  const db = getFirestore();

  const callerSnap = await db.collection("users").doc(auth.uid).get();
  if (!callerSnap.exists || callerSnap.data()?.role !== "admin") {
    throw new HttpsError("permission-denied", "Only admins can read volunteer admin data");
  }

  const usersSnap = await db.collection("users").get();
  const volunteerDocs = usersSnap.docs.filter((docSnap) => {
    const role = docSnap.data()?.role;
    return role === "volunteer" || role === "admin";
  });

  const volunteers = await Promise.all(
    volunteerDocs.map(async (userDoc) => {
      const uid = userDoc.id;
      const coreRaw = userDoc.data() ?? {};

      const [privateProfileSnap, skillsSnap, publicProfileSnap, printersSnap] = await Promise.all([
        db.collection("users").doc(uid).collection("private").doc("profile").get(),
        db.collection("users").doc(uid).collection("private").doc("skills").get(),
        db.collection("users").doc(uid).collection("public").doc("profile").get(),
        db.collection("users").doc(uid).collection("printers").get(),
      ]);

      const privateRaw = privateProfileSnap.exists ? privateProfileSnap.data() ?? {} : {};
      const skillsRaw = skillsSnap.exists ? skillsSnap.data() ?? {} : {};
      const publicRaw = publicProfileSnap.exists ? publicProfileSnap.data() ?? {} : {};

      const core: UserCore = {
        active: asBoolean(coreRaw.active),
        email: asString(coreRaw.email) ?? "",
        role: asUserRole(coreRaw.role),
        createdAt: coreRaw.createdAt,
      };

      const privateProfile: VolunteerPrivateProfile = {
        firstName: asString(privateRaw.firstName) ?? "",
        lastName: asString(privateRaw.lastName) ?? "",
        phone: asString(privateRaw.phone),
        city: asString(privateRaw.city),
        telegramUsername: asString(privateRaw.telegramUsername),
        availability: asString(privateRaw.availability),
        continuityType:
          privateRaw.continuityType === "continuativa" ||
          privateRaw.continuityType === "spot" ||
          privateRaw.continuityType === "saltuaria"
            ? privateRaw.continuityType
            : undefined,
        desiredInvolvementLevel:
          privateRaw.desiredInvolvementLevel === "bassa" ||
          privateRaw.desiredInvolvementLevel === "progetti" ||
          privateRaw.desiredInvolvementLevel === "coordinamento" ||
          privateRaw.desiredInvolvementLevel === "non so"
            ? privateRaw.desiredInvolvementLevel
            : undefined,
        howDidYouKnowEnable: asString(privateRaw.howDidYouKnowEnable),
        additionalNotes: asString(privateRaw.additionalNotes),
        consentPrivacy: asBoolean(privateRaw.consentPrivacy),
        shippingAddress: privateRaw.shippingAddress,
        updatedAt: privateRaw.updatedAt,
      };

      const skills: VolunteerSkills = {
        aboutMe: asString(skillsRaw.aboutMe),
        mainInterest: asStringArray(skillsRaw.mainInterest),
        enableInterestAreas: asStringArray(skillsRaw.enableInterestAreas),
        contributionPreferences: asString(skillsRaw.contributionPreferences),
        desiredSkills: asString(skillsRaw.desiredSkills),
        updatedAt: skillsRaw.updatedAt,
      };

      const publicProfile: VolunteerPublicProfile = {
        showInVolunteerList: asBoolean(publicRaw.showInVolunteerList),
        publicEmail: asString(publicRaw.publicEmail),
        bio: asString(publicRaw.bio),
        facebook: asString(publicRaw.facebook),
        instagram: asString(publicRaw.instagram),
        linkedin: asString(publicRaw.linkedin),
        updatedAt: publicRaw.updatedAt,
      };

      const printers: VolunteerPrinter[] = printersSnap.docs.map((printerDoc) => {
        const printerRaw = printerDoc.data() ?? {};
        return {
          id: printerDoc.id,
          brand: asString(printerRaw.brand) ?? "",
          model: asString(printerRaw.model) ?? "",
          buildVolumeX: asNumber(printerRaw.buildVolumeX),
          buildVolumeY: asNumber(printerRaw.buildVolumeY),
          buildVolumeZ: asNumber(printerRaw.buildVolumeZ),
          multiMaterial: asBoolean(printerRaw.multiMaterial),
          flexibleSupported: asBoolean(printerRaw.flexibleSupported),
          directDrive: asBoolean(printerRaw.directDrive),
          notes: asString(printerRaw.notes),
          active: asBoolean(printerRaw.active),
          createdAt: printerRaw.createdAt,
          updatedAt: printerRaw.updatedAt,
        };
      });

      const volunteer: VolunteerData = {
        uid,
        core,
        privateProfile,
        skills,
        printers,
        publicProfile,
      };

      return volunteer;
    })
  );

  return { volunteers };
});
