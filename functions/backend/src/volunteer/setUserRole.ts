import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getInvokeId } from "../utils/invoke";
import { logSecurityEvent } from "../security/securityLog";

const REGION = "europe-west1";

const ALLOWED_ROLES = ["volunteer", "admin"] as const;
type Role = (typeof ALLOWED_ROLES)[number];

export const setUserRole = onCall(
  { region: REGION },
  async (req) => {
    const invokeId = getInvokeId(req);
    console.log(`[setUserRole] Invoke ID: ${invokeId} - Function called`);

    const { auth, data } = req;
    if (!auth) {
      console.log(`[setUserRole] KO: Unauthenticated`);
      throw new HttpsError("unauthenticated", "Authentication required");
    }

    const db = getFirestore();
    const actorSnap = await db.collection("users").doc(auth.uid).get();
    if (!actorSnap.exists || actorSnap.data()?.role !== "admin") {
      console.log(`[setUserRole] KO: Permission denied for actor ${auth.uid}`);
      throw new HttpsError("permission-denied", "Only admins can change user roles");
    }

    const { targetUid, newRole } = data as { targetUid: string; newRole: string };
    if (!targetUid || !newRole) {
      throw new HttpsError("invalid-argument", "targetUid and newRole are required");
    }
    if (!(ALLOWED_ROLES as readonly string[]).includes(newRole)) {
      throw new HttpsError("invalid-argument", `newRole must be one of: ${ALLOWED_ROLES.join(", ")}`);
    }
    if (targetUid === auth.uid) {
      throw new HttpsError("invalid-argument", "Admins cannot change their own role");
    }

    const targetSnap = await db.collection("users").doc(targetUid).get();
    if (!targetSnap.exists) {
      throw new HttpsError("not-found", `User ${targetUid} not found`);
    }

    const previousRole: string = targetSnap.data()?.role ?? "unknown";
    console.log(`[setUserRole] actor=${auth.uid}, target=${targetUid}, ${previousRole} → ${newRole}`);

    let errorMsg: string | undefined;
    try {
      await db.collection("users").doc(targetUid).update({
        role: newRole as Role,
        updatedAt: FieldValue.serverTimestamp(),
      });

      await logSecurityEvent({
        type: "system",
        action: "set_user_role",
        outcome: "success",
        severity: "high",
        actor: { uid: auth.uid },
        context: {
          function: "setUserRole",
          invokeId,
          metadata: { targetUid, previousRole, newRole },
        },
      });

      console.log(`[setUserRole] OK: ${targetUid} role changed from ${previousRole} to ${newRole}`);
      return { success: true, previousRole, newRole };
    } catch (error) {
      errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[setUserRole] KO: ${errorMsg}`);
      await logSecurityEvent({
        type: "system",
        action: "set_user_role",
        outcome: "failure",
        severity: "high",
        actor: { uid: auth.uid },
        context: {
          function: "setUserRole",
          invokeId,
          metadata: { targetUid, newRole, error: errorMsg },
        },
      });
      if (error instanceof HttpsError) throw error;
      throw new HttpsError("internal", "Errore durante il cambio ruolo");
    }
  }
);
