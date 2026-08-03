import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import crypto from "crypto";
import { getInvokeId } from "../utils/invoke";
import { logSecurityEvent } from "../security/securityLog";
import { resolveDeviceRequestChecklistAccess } from "./deviceRequestChecklistAccess";

const REGION = "europe-west1";
const SHARE_BASE_URL = "https://app.e-nableitalia.it";

/**
 * Cloud Function callable del layer di integrazione device-requests:
 * genera (o riusa, se gia' esistente) il link di condivisione a sola
 * lettura della checklist di fabbricazione collegata a una
 * `deviceRequest` (Story EA-113, livello famiglia/visibilita' esterna,
 * unico tier di condivisione a link previsto dall'Epic).
 *
 * Riceve dal consumer `requestId` e `checklistId` (EA-131: `checklistId`
 * esplicito, non più risolto implicitamente, stesso cambio di contratto
 * applicato alle 5 Cloud Function del layer): applica lo stesso controllo
 * RBAC e la verifica di appartenenza a `checklistIds`
 * (`deviceRequestChecklistAccess.ts` — admin o volontario assegnato).
 *
 * Il token e' persistito lato server nella collection
 * `checklistShareLinks/{token}` e non scade ne' e' revocabile (decisione
 * confermata in refinement EA-108, 2026-07-09): nessuna logica di
 * scadenza/revoca va aggiunta qui.
 *
 * Idempotenza: se un link esiste gia' per la checklist, viene
 * restituito lo stesso token invece di crearne uno nuovo, per evitare
 * di accumulare token multipli validi per la stessa checklist a ogni
 * richiesta di generazione.
 */
export const createChecklistShareLink = onCall(
  { region: REGION },
  async (request) => {
    const invokeId = getInvokeId(request);
    console.log(`[createChecklistShareLink] Invoke ID: ${invokeId} - Function called`);

    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", "User must be authenticated");
    }

    const { requestId, checklistId } = request.data as { requestId?: string; checklistId?: string };
    if (!requestId || typeof requestId !== "string") {
      throw new HttpsError("invalid-argument", "Missing parameter: requestId");
    }
    if (!checklistId || typeof checklistId !== "string") {
      throw new HttpsError("invalid-argument", "Missing parameter: checklistId");
    }

    const db = getFirestore();
    await resolveDeviceRequestChecklistAccess(db, uid, requestId, checklistId);

    const existingSnap = await db
      .collection("checklistShareLinks")
      .where("checklistId", "==", checklistId)
      .limit(1)
      .get();

    let token: string;
    if (!existingSnap.empty) {
      token = existingSnap.docs[0].id;
      console.log(
        `[createChecklistShareLink] Reusing existing share link ${token} for checklist ${checklistId}`
      );
    } else {
      token = crypto.randomUUID();
      await db.collection("checklistShareLinks").doc(token).set({
        checklistId,
        requestId,
        createdAt: FieldValue.serverTimestamp(),
        createdBy: uid,
      });
      console.log(
        `[createChecklistShareLink] Created share link ${token} for checklist ${checklistId} by ${uid}`
      );
    }

    await logSecurityEvent({
      type: "system",
      action: "create_checklist_share_link",
      outcome: "success",
      severity: "low",
      actor: { uid, email: request.auth?.token?.email ?? undefined },
      context: { function: "createChecklistShareLink", invokeId, requestId },
    });

    return { token, url: `${SHARE_BASE_URL}/checklist-share/${token}` };
  }
);
