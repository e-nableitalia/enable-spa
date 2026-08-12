import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getInvokeId } from "../utils/invoke";
import { logSecurityEvent } from "../security/securityLog";

const REGION = "europe-west1";

/**
 * Id del documento in `emailTemplates` referenziato da `template.name` sul
 * documento scritto in `mail` (meccanismo nativo a template dell'estensione
 * Trigger Email `firestore-send-email`). Il documento stesso NON è creato
 * da questo codice: `emailTemplates` vive solo sul progetto Firebase live e
 * non ha infrastruttura di seed/migrazione in questo repo — va creato
 * manualmente con questo id esatto (vedi docs/FINDINGS.md F-36), con
 * placeholder per le variabili elencate sotto in `data`.
 *
 * Variabili attese in `data`:
 * - `recipientName`: destinatario del device (`deviceRequests.recipient`,
 *   stringa vuota se non ancora valorizzato).
 * - `requestNumber`: numero pratica (`deviceRequests.requestNumber`).
 */
const DOCUMENTS_EMAIL_TEMPLATE_ID = "device-request-documents-transmission";

/**
 * Cloud Function callable del layer device-requests: invia alla famiglia,
 * via email, i documenti da firmare (scarico di responsabilità) più gli
 * accessori/informazioni di sicurezza collegati a una `deviceRequest`
 * (EA-160), e marca l'invio con `deviceRequests/{id}.documentsEmailSent`.
 *
 * Riusa il meccanismo nativo a template dell'estensione Trigger Email
 * (`mail` con `template: { name, data }` invece di `message.html` inline)
 * — vedi F-35 in docs/FINDINGS.md per un precedente non documentato dalla
 * Story/Epic (`activateVolunteers` in `volunteer/volunteerState.ts` scrive
 * già oggi un `template` di questo tipo).
 *
 * RBAC: solo admin, stesso perimetro deciso per gli altri due flag
 * amministrativi introdotti dallo stesso Epic (scarico di responsabilità/
 * liberatoria foto,
 * `docs/implementation-requests/family-waiver-photo-release-request.md`) —
 * dato sensibile che condiziona una comunicazione formale alla famiglia.
 *
 * Idempotenza (Scenario 5 EA-160 — doppio click concorrente non deve
 * generare doppio invio): stesso pattern guard-then-set in transazione di
 * `device-requests/autoCreateProductionChecklist.ts`, ma qui la scrittura
 * del documento `mail` (il "send") e il claim del guard
 * (`documentsEmailSent: true`) avvengono nella STESSA transazione Firestore
 * invece che in due passi separati: a differenza di quel modulo — che deve
 * invocare un'altra callable con una propria scrittura non atomica, da cui
 * la necessità di un rollback condizionale sugli errori pre-scrittura — qui
 * entrambe le scritture sono dirette (`tx.set`/`tx.update`) e stanno nella
 * stessa transazione: l'atomicità nativa di Firestore (retry ottimistico su
 * conflitto) basta a garantire che un solo invocante tra due concorrenti
 * scriva sia il documento `mail` sia il flag, senza bisogno di rollback.
 */
export const sendDocumentsEmail = onCall(
  { region: REGION },
  async (request) => {
    const invokeId = getInvokeId(request);
    console.log(`[sendDocumentsEmail] Invoke ID: ${invokeId} - Function called`);

    const authUid = request.auth?.uid;
    if (!authUid) {
      console.log("[sendDocumentsEmail] KO: Unauthenticated");
      throw new HttpsError("unauthenticated", "Authentication required");
    }

    const db = getFirestore();

    const actorSnap = await db.collection("users").doc(authUid).get();
    if (!actorSnap.exists || actorSnap.data()?.role !== "admin") {
      console.log(`[sendDocumentsEmail] KO: Permission denied for uid ${authUid}`);
      throw new HttpsError("permission-denied", "Only admins can send the documents email");
    }

    const { requestId } = (request.data ?? {}) as { requestId?: unknown };
    if (!requestId || typeof requestId !== "string") {
      console.log("[sendDocumentsEmail] KO: Missing or invalid requestId");
      throw new HttpsError("invalid-argument", "Missing or invalid requestId");
    }

    const requestRef = db.collection("deviceRequests").doc(requestId);
    const privateRef = requestRef.collection("private").doc("data");

    const privateSnap = await privateRef.get();
    const email = privateSnap.exists ? privateSnap.data()?.email : undefined;
    if (typeof email !== "string" || !email.trim()) {
      console.log(`[sendDocumentsEmail] KO: no email on file for request ${requestId}`);
      throw new HttpsError("failed-precondition", "L'email del richiedente non è valorizzata");
    }

    const mailRef = db.collection("mail").doc();

    let claimed = false;
    try {
      claimed = await db.runTransaction(async (tx) => {
        const snap = await tx.get(requestRef);
        if (!snap.exists) {
          throw new HttpsError("not-found", "Device request not found");
        }
        if (snap.data()?.documentsEmailSent) {
          return false;
        }

        const requestData = snap.data() ?? {};
        tx.set(mailRef, {
          to: [email],
          template: {
            name: DOCUMENTS_EMAIL_TEMPLATE_ID,
            data: {
              recipientName: requestData.recipient ?? "",
              requestNumber: requestData.requestNumber ?? "",
            },
          },
        });
        tx.update(requestRef, {
          documentsEmailSent: true,
          updatedAt: FieldValue.serverTimestamp(),
        });
        return true;
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[sendDocumentsEmail] KO: ${errorMsg}`);
      await logSecurityEvent({
        action: "send_documents_email",
        outcome: "failure",
        severity: "medium",
        actor: { uid: authUid },
        context: {
          function: "sendDocumentsEmail",
          invokeId,
          requestId,
          metadata: { error: errorMsg },
        },
      });
      if (error instanceof HttpsError) throw error;
      throw new HttpsError("internal", "Errore durante l'invio dei documenti");
    }

    if (!claimed) {
      console.log(`[sendDocumentsEmail] KO: documents already sent for request ${requestId}`);
      await logSecurityEvent({
        action: "send_documents_email",
        outcome: "blocked",
        severity: "low",
        actor: { uid: authUid },
        context: {
          function: "sendDocumentsEmail",
          invokeId,
          requestId,
          metadata: { reason: "already_sent" },
        },
      });
      throw new HttpsError("failed-precondition", "I documenti sono già stati inviati per questa richiesta");
    }

    await logSecurityEvent({
      action: "send_documents_email",
      outcome: "success",
      severity: "medium",
      actor: { uid: authUid },
      context: {
        function: "sendDocumentsEmail",
        invokeId,
        requestId,
        metadata: { mailDocId: mailRef.id },
      },
    });

    console.log(`[sendDocumentsEmail] OK: documents email queued for request ${requestId}`);
    return { success: true };
  }
);
