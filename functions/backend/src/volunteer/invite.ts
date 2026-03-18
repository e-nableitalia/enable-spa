// Helper: Get user role

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { initializeApp } from "firebase-admin/app";
// import { sendEmail } from "../utils/email";
import { logSecurityEvent } from "../security/securityLog";
import { getInvokeId } from "../utils/invoke";

initializeApp();

const db = getFirestore();
const REGION = "europe-west1";

// interface Contact {
//   id: string;
//   firstName: string;
//   lastName: string;
//   email: string;
// }

async function getUserRole(uid: string): Promise<string> {
  const userDoc = await db.collection("users").doc(uid).get();
  if (!userDoc.exists) throw new HttpsError("not-found", "User not found");
  const role = userDoc.get("role");
  if (!role) throw new HttpsError("failed-precondition", "Role missing");
  return role;
}

export const inviteVolunteer = onCall({ region: REGION }, async (req) => {
  const { auth, data, rawRequest } = req;
  const invokeId = getInvokeId(req);
  console.log(`[inviteVolunteer] ENTER - invokeId: ${invokeId}`);
  try {
    if (!auth) throw new HttpsError("unauthenticated", "Authentication required");
    const uid = auth.uid;
    const role = await getUserRole(uid);
    if (role !== "admin") throw new HttpsError("permission-denied", "Only admin can invite volunteers");
    if (!Array.isArray(data.contacts)) throw new HttpsError("invalid-argument", "contacts must be an array");

    await logSecurityEvent({
      type: "system",
      action: "invite_enter",
      outcome: "success",
      severity: "low",
      actor: {
        uid,
        email: auth.token?.email,
        ip: rawRequest?.ip ?? "unknown",
      },
      context: {
        function: "inviteVolunteer",
        invokeId,
        metadata: { count: data.contacts.length },
      },
    });

    const results: { id: string; success: boolean; error?: string }[] = [];

    for (const contact of data.contacts) {
      if (!contact.id || !contact.email) {
        results.push({ id: contact.id || "", success: false, error: "Missing id or email" });
        await logSecurityEvent({
          type: "system",
          action: "invite_contact_skipped",
          outcome: "failure",
          severity: "medium",
          actor: { uid, email: auth.token?.email },
          context: { function: "inviteVolunteer", invokeId, metadata: { contact } },
        });
        continue;
      }
      try {
        // Usa il formato Firestore email queue con template e params
        await db.collection("mail").add({
          to: [contact.email],
          template: {
            name: "inviteVolunteer",
            data: {
              firstName: contact.firstName || "",
              lastName: contact.lastName || "",
            }
          }
        });
        await db.collection("contacts").doc(contact.id).update({ status: "invited", updatedAt: FieldValue.serverTimestamp() });
        results.push({ id: contact.id, success: true });
        await logSecurityEvent({
          type: "system",
          action: "invite_contact_success",
          outcome: "success",
          severity: "low",
          actor: { uid, email: auth.token?.email },
          context: { function: "inviteVolunteer", invokeId, metadata: { contactId: contact.id } },
        });
      } catch (e: any) {
        results.push({ id: contact.id, success: false, error: e.message });
        await logSecurityEvent({
          type: "system",
          action: "invite_contact_failed",
          outcome: "failure",
          severity: "high",
          actor: { uid, email: auth.token?.email },
          context: { function: "inviteVolunteer", invokeId, metadata: { contactId: contact.id, error: e.message } },
        });
      }
    }

    await logSecurityEvent({
      type: "system",
      action: "invite_exit",
      outcome: "success",
      severity: "low",
      actor: { uid, email: auth.token?.email },
      context: { function: "inviteVolunteer", invokeId, metadata: { invited: results.filter(r => r.success).length, failed: results.filter(r => !r.success).length } },
    });
    console.log(`[inviteVolunteer] EXIT - invokeId: ${invokeId} - invited: ${results.filter(r => r.success).length}, failed: ${results.filter(r => !r.success).length}`);
    return { results };
  } catch (error) {
    console.error(`[inviteVolunteer] KO - invokeId: ${invokeId}`, error);
    await logSecurityEvent({
      type: "system",
      action: "inviteVolunteer_failed",
      outcome: "failure",
      severity: "high",
      actor: { email: req?.auth?.token?.email, uid: req?.auth?.uid, ip: req?.rawRequest?.ip ?? "unknown" },
      context: { function: "inviteVolunteer", invokeId },
    });
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", "Internal Server Error");
  }
});
