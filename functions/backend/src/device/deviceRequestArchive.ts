import { HttpsError } from "firebase-functions/v2/https";
import type { DocumentData, Firestore } from "firebase-admin/firestore";

/** Stati terminali soft da cui è consentito archiviare (flag additivo, non un nuovo status). */
export const ARCHIVEABLE_STATUSES = new Set(["completata", "annullata"]);

export function isDeviceRequestArchived(data: DocumentData | undefined | null): boolean {
  return data?.archived === true;
}

/**
 * Blocca qualsiasi scrittura "live" su una device request già archiviata.
 * Usare su changeStatus, assegnazioni, allegati, checklist, ecc. — non su restore.
 */
export function assertDeviceRequestNotArchived(data: DocumentData | undefined | null): void {
  if (isDeviceRequestArchived(data)) {
    throw new HttpsError(
      "failed-precondition",
      "La richiesta è archiviata: ripristinarla prima di modificarla"
    );
  }
}

export async function requireAdminRole(db: Firestore, uid: string): Promise<void> {
  const userSnap = await db.collection("users").doc(uid).get();
  const role = userSnap.exists ? userSnap.data()?.role : undefined;
  if (role !== "admin") {
    throw new HttpsError("permission-denied", "Only admin can archive or restore device requests");
  }
}
