import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { mapToPublicStatus } from "../utils/mapToPublicStatus";

const REGION = "europe-west1";

function getAgeRange(age: number): string {
  if (age <= 6) return "0-6";
  if (age <= 12) return "7-12";
  if (age <= 18) return "13-18";
  return "18+";
}

export const createDeviceRequestInternal = onCall(
    { region: REGION },
    async (request) => {
        try {
            const data = request.data;
            const db = getFirestore();

            const source = data.source || "import"; // public | import | legacy

            const requestRef = db.collection("deviceRequests").doc();

            const counterRef = db.collection("counters").doc("deviceRequests");

            await db.runTransaction(async (tx) => {
                // 1. Leggi contatore
                const counterSnap = await tx.get(counterRef);

                let newSeqId = 1;
                if (counterSnap.exists) {
                    newSeqId = (counterSnap.data()?.lastId || 0) + 1;
                }

                // 2. Aggiorna contatore
                tx.set(counterRef, { lastId: newSeqId });

                // 3. Genera ID leggibile
                const requestNumber = `REQ-${String(newSeqId).padStart(6, "0")}`;

                // MAIN DOC
                tx.set(requestRef, {
                    age: data.age || null,
                    gender: data.gender || null,
                    status: "inviata",
                    publicStatus: mapToPublicStatus("inviata"),
                    assignedVolunteers: [],
                    createdAt: FieldValue.serverTimestamp(),
                    updatedAt: FieldValue.serverTimestamp(),
                    createdBy: source,
                    seqId: newSeqId,
                    requestNumber: requestNumber
                });

                // PRIVATE
                tx.set(requestRef.collection("private").doc("data"), {
                    email: data.email,
                    firstName: data.firstName || null,
                    lastName: data.lastName || null,
                    phone: data.phone || null,
                    relation: data.relation || null,
                    province: data.province,
                    therapy: data.therapy || false,
                    amputationType: data.amputationType,
                    description: data.description || null,
                    preferences: data.preferences || null,
                    consentPrivacy: data.consentPrivacy || false,
                    recipient: data.recipient || null // opzionale legacy
                });

                // EVENT INIZIALE (STANDARDIZZATO)
                tx.set(requestRef.collection("events").doc(), {
                    type: "status_change",
                    fromStatus: null,
                    toStatus: "inviata",
                    timestamp: FieldValue.serverTimestamp(),
                    createdBy: source,
                    note: "Richiesta creata"
                });

                // PUBLIC
                tx.set(
                    db.collection("publicDeviceRequests").doc(requestRef.id),
                    {
                        province: data.province,
                        publicStatus: mapToPublicStatus("inviata"),
                        createdAt: FieldValue.serverTimestamp(),
                        devicetype: data.devicetype || "unknown",
                        requestNumber: requestNumber,
                        ageRange: data.age ? getAgeRange(Number(data.age)) : null
                    }
                );
            });

            return { requestId: requestRef.id };
        } catch (err) {
            console.error(err);
            throw new HttpsError("internal", "Error creating request");
        }
    }
);