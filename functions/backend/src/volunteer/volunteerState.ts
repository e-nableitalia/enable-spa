import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { initializeApp } from "firebase-admin/app";
import { logSecurityEvent } from "../security/securityLog";

initializeApp();

const db = getFirestore();
const REGION = "europe-west1";

// Helper: Get user role
async function getUserRole(uid: string): Promise<string> {
  const userDoc = await db.collection("users").doc(uid).get();
  if (!userDoc.exists) throw new HttpsError("not-found", "User not found");
  const role = userDoc.get("role");
  if (!role) throw new HttpsError("failed-precondition", "Role missing");
  return role;
}

// Attiva volontari
export const activateVolunteers = onCall(
  { region: REGION },
  async (req) => {
    const { auth, data, rawRequest } = req;
    if (!auth) throw new HttpsError("unauthenticated", "Authentication required");
    const uid = auth.uid;
    const role = await getUserRole(uid);
    if (role !== "admin") throw new HttpsError("permission-denied", "Only admins can activate volunteers");

    const { ids } = data;
    if (!Array.isArray(ids) || ids.length === 0) {
      throw new HttpsError("invalid-argument", "ids must be a non-empty array");
    }

    let errorMsg = undefined;
    try {
      const batch = db.batch();
      const emails: string[] = [];
      for (const volunteerId of ids) {
        const userRef = db.collection("users").doc(volunteerId);
        batch.update(userRef, {
          active: true,
          updatedAt: FieldValue.serverTimestamp(),
        });
        // Recupera email per invio
        const userDoc = await userRef.get();
        const email = userDoc.get("email");
        if (email) emails.push(email);
      }
      await batch.commit();
      // Invia email a tutti
      for (const email of emails) {
        await db.collection("mail").add({
          to: [email],
          message: {
            subject: "La tua utenza è stata attivata - e-Nable Italia",
            html: `
              <div style=\"font-family: Arial, sans-serif; max-width:600px; margin:auto;\">
                <h2 style=\"color:#2c7be5;\">Utenza attivata</h2>
                <p>Ciao, la tua utenza su <b>e-Nable Italia</b> è stata attivata.<br>
                Ora puoi accedere alla piattaforma e partecipare come volontario.</p>
                <p style=\"font-size:14px;color:#555;\">Se non hai richiesto questa email puoi ignorarla.</p>
              </div>
            `,
          },
        });
      }
      // Log security event: successo
      await logSecurityEvent({
        type: "system",
        action: "activate_volunteers",
        outcome: "success",
        severity: "medium",
        actor: {
          uid,
          email: auth.token?.email,
          ip: rawRequest?.ip ?? "unknown",
        },
        context: {
          function: "activateVolunteers",
          metadata: { ids },
        },
      });
      return { success: true };
    } catch (error) {
      errorMsg = error instanceof Error ? error.message : String(error);
      console.error("Errore attivazione volontari:", error);
      // Log security event: errore
      await logSecurityEvent({
        type: "system",
        action: "activate_volunteers",
        outcome: "failure",
        severity: "high",
        actor: {
          uid,
          email: auth.token?.email,
          ip: rawRequest?.ip ?? "unknown",
        },
        context: {
          function: "activateVolunteers",
          metadata: { ids, error: errorMsg },
        },
      });
      throw new HttpsError("internal", "Errore attivazione volontari");
    }
  }
);

// Disattiva volontari
export const deactivateVolunteers = onCall(
  { region: REGION },
  async (req) => {
    const { auth, data, rawRequest } = req;
    if (!auth) throw new HttpsError("unauthenticated", "Authentication required");
    const uid = auth.uid;
    const role = await getUserRole(uid);
    if (role !== "admin") throw new HttpsError("permission-denied", "Only admins can deactivate volunteers");

    const { ids } = data;
    if (!Array.isArray(ids) || ids.length === 0) {
      throw new HttpsError("invalid-argument", "ids must be a non-empty array");
    }

    let errorMsg = undefined;
    try {
      const batch = db.batch();
      const emails: string[] = [];
      for (const volunteerId of ids) {
        const userRef = db.collection("users").doc(volunteerId);
        batch.update(userRef, {
          active: false,
          updatedAt: FieldValue.serverTimestamp(),
        });
        // Recupera email per invio
        const userDoc = await userRef.get();
        const email = userDoc.get("email");
        if (email) emails.push(email);
      }
      await batch.commit();
      // // Invia email a tutti
      // for (const email of emails) {
      //   await db.collection("mail").add({
      //     to: [email],
      //     message: {
      //       subject: "La tua utenza è stata disattivata - e-Nable Italia",
      //       html: `
      //         <div style=\"font-family: Arial, sans-serif; max-width:600px; margin:auto;\">
      //           <h2 style=\"color:#e52c2c;\">Utenza disattivata</h2>
      //           <p>Ciao, la tua utenza su <b>e-Nable Italia</b> è stata disattivata.<br>
      //           Se ritieni si tratti di un errore, contatta un amministratore.</p>
      //           <p style=\"font-size:14px;color:#555;\">Se non hai richiesto questa email puoi ignorarla.</p>
      //         </div>
      //       `,
      //     },
      //   });
      // }
      // Log security event: successo
      await logSecurityEvent({
        type: "system",
        action: "deactivate_volunteers",
        outcome: "success",
        severity: "medium",
        actor: {
          uid,
          email: auth.token?.email,
          ip: rawRequest?.ip ?? "unknown",
        },
        context: {
          function: "deactivateVolunteers",
          metadata: { ids },
        },
      });
      return { success: true };
    } catch (error) {
      errorMsg = error instanceof Error ? error.message : String(error);
      console.error("Errore disattivazione volontari:", error);
      // Log security event: errore
      await logSecurityEvent({
        type: "system",
        action: "deactivate_volunteers",
        outcome: "failure",
        severity: "high",
        actor: {
          uid,
          email: auth.token?.email,
          ip: rawRequest?.ip ?? "unknown",
        },
        context: {
          function: "deactivateVolunteers",
          metadata: { ids, error: errorMsg },
        },
      });
      throw new HttpsError("internal", "Errore disattivazione volontari");
    }
  }
);
