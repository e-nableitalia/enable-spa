import {onCall, HttpsError} from "firebase-functions/v2/https";
import {getFirestore, FieldValue} from "firebase-admin/firestore";
import type {Firestore} from "firebase-admin/firestore";
import {logSecurityEvent} from "../security/securityLog";
import {getInvokeId} from "../utils/invoke";
import {EMAIL_TEMPLATE_IDS} from "../emailTemplates/registry";

const REGION = "europe-west1";

type ShipmentStatus = "pending" | "approved" | "in_transit" | "delivered" | "deleted";

interface ShippingAddressLike {
  fullName?: string;
  street?: string;
  city?: string;
  province?: string;
  postalCode?: string;
  country?: string;
  phone?: string;
}

export interface ShipmentAddressBookEntry {
  kind: "profile" | "deviceRequest";
  id: string;
  label: string;
  name: string;
  addressText: string;
  phone?: string;
}

function formatAddressText(addr: ShippingAddressLike): string {
  return `${addr.street ?? ""}\n${addr.postalCode ?? ""} ${addr.city ?? ""} (${addr.province ?? ""})\n${addr.country || "IT"}`;
}

function pushProfileEntry(
  entries: ShipmentAddressBookEntry[],
  uid: string,
  profile: Record<string, unknown>,
  labelPrefix: string
): void {
  const addr = profile.shippingAddress as ShippingAddressLike | undefined;
  if (!addr?.street) return;
  const fullName =
    addr.fullName ||
    `${(profile.firstName as string | undefined) ?? ""} ${(profile.lastName as string | undefined) ?? ""}`.trim();
  const entry: ShipmentAddressBookEntry = {
    kind: "profile",
    id: uid,
    label: `${labelPrefix} — ${fullName}, ${addr.street}, ${addr.postalCode ?? ""} ${addr.city ?? ""}`,
    name: fullName,
    addressText: formatAddressText(addr),
  };
  if (addr.phone) entry.phone = addr.phone;
  entries.push(entry);
}

async function loadDeviceRequestEntry(
  db: Firestore,
  requestId: string,
  data: Record<string, unknown>
): Promise<ShipmentAddressBookEntry | null> {
  const addr = data.shippingAddress as ShippingAddressLike | undefined;
  if (!addr?.street) return null;

  let beneficiaryName = addr.fullName || "";
  const privSnap = await db.collection("deviceRequests").doc(requestId).collection("private").doc("data").get();
  if (privSnap.exists) {
    const priv = privSnap.data() ?? {};
    const n = `${(priv.firstName as string | undefined) ?? ""} ${(priv.lastName as string | undefined) ?? ""}`.trim();
    if (n) beneficiaryName = n;
  }

  const seq = (data.seqId as string | undefined) || requestId.slice(0, 8);
  const entry: ShipmentAddressBookEntry = {
    kind: "deviceRequest",
    id: requestId,
    label: `Richiesta ${seq} — ${beneficiaryName}, ${addr.street}, ${addr.city ?? ""}`,
    name: beneficiaryName,
    addressText: formatAddressText(addr),
  };
  if (addr.phone) entry.phone = addr.phone;
  return entry;
}

async function requireAdmin(db: Firestore, uid: string): Promise<void> {
  const userSnap = await db.collection("users").doc(uid).get();
  if (!userSnap.exists || userSnap.data()?.role !== "admin") {
    throw new HttpsError("permission-denied", "Admin role required");
  }
}

/**
 * Address book per il form di creazione spedizione: profilo(i) e indirizzi
 * da deviceRequests, con perimetro RBAC (volunteer = proprio + assegnate;
 * admin = tutti i volontari con shippingAddress + tutte le deviceRequests
 * con indirizzo).
 */
export const listShipmentAddressBook = onCall({region: REGION}, async (request) => {
  const invokeId = getInvokeId(request);
  console.log(`[listShipmentAddressBook] Invoke ID: ${invokeId} - Function called`);

  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "User must be authenticated");
  }

  const db = getFirestore();
  const userSnap = await db.collection("users").doc(uid).get();
  if (!userSnap.exists) {
    throw new HttpsError("permission-denied", "User not found");
  }
  const role = userSnap.data()?.role as string | undefined;
  const entries: ShipmentAddressBookEntry[] = [];

  try {
    if (role === "admin") {
      const ownProfile = await db.collection("users").doc(uid).collection("private").doc("profile").get();
      if (ownProfile.exists) {
        pushProfileEntry(entries, uid, ownProfile.data() ?? {}, "Il mio indirizzo");
      }

      const volunteersSnap = await db.collection("users").where("role", "==", "volunteer").get();
      for (const userDoc of volunteersSnap.docs) {
        const profileSnap = await userDoc.ref.collection("private").doc("profile").get();
        if (!profileSnap.exists) continue;
        const profile = profileSnap.data() ?? {};
        const name =
          `${(profile.firstName as string | undefined) ?? ""} ${(profile.lastName as string | undefined) ?? ""}`.trim() ||
          userDoc.id.slice(0, 8);
        pushProfileEntry(entries, userDoc.id, profile, `Volontario ${name}`);
      }

      const requestsSnap = await db.collection("deviceRequests").get();
      for (const d of requestsSnap.docs) {
        const entry = await loadDeviceRequestEntry(db, d.id, d.data());
        if (entry) entries.push(entry);
      }
    } else {
      const profileSnap = await db.collection("users").doc(uid).collection("private").doc("profile").get();
      if (profileSnap.exists) {
        pushProfileEntry(entries, uid, profileSnap.data() ?? {}, "Il mio indirizzo");
      }

      const reqSnap = await db
        .collection("deviceRequests")
        .where("assignedVolunteers", "array-contains", uid)
        .get();
      for (const d of reqSnap.docs) {
        const entry = await loadDeviceRequestEntry(db, d.id, d.data());
        if (entry) entries.push(entry);
      }
    }

    console.log(`[listShipmentAddressBook] OK: ${entries.length} entries for ${uid}`);
    return {addresses: entries};
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    console.error("[listShipmentAddressBook] KO:", error);
    throw new HttpsError("internal", "Internal Server Error");
  }
});

export const createShipmentRequest = onCall(
  {region: REGION},
  async (request) => {
    const invokeId = getInvokeId(request);
    console.log(`[createShipmentRequest] Invoke ID: ${invokeId} - Function called`);
    try {
      const uid = request.auth?.uid;
      if (!uid) {
        throw new HttpsError("unauthenticated", "User must be authenticated");
      }

      const {
        reason,
        senderName,
        senderAddress,
        senderNotes,
        recipientName,
        recipientAddress,
        recipientPhone,
        deliveryNotes,
        length,
        width,
        height,
        weight,
      } = request.data;

      if (!reason || !senderName || !senderAddress || !recipientName || !recipientAddress) {
        console.log("[createShipmentRequest] KO: Missing required fields");
        throw new HttpsError("invalid-argument", "Missing required fields");
      }

      const db = getFirestore();
      const now = FieldValue.serverTimestamp();

      const payload: Record<string, unknown> = {
        createdAt: now,
        updatedAt: now,
        createdBy: uid,
        email: request.auth?.token?.email ?? null,
        reason,
        senderName,
        senderAddress,
        recipientName,
        recipientAddress,
        status: "pending" satisfies ShipmentStatus,
      };

      if (senderNotes !== undefined && senderNotes !== "") payload.senderNotes = senderNotes;
      if (recipientPhone !== undefined && recipientPhone !== "") payload.recipientPhone = recipientPhone;
      if (deliveryNotes !== undefined && deliveryNotes !== "") payload.deliveryNotes = deliveryNotes;
      if (length !== undefined && length !== null) payload.length = length;
      if (width !== undefined && width !== null) payload.width = width;
      if (height !== undefined && height !== null) payload.height = height;
      if (weight !== undefined && weight !== null) payload.weight = weight;

      const docRef = await db.collection("shipmentRequests").add(payload);

      await logSecurityEvent({
        type: "system",
        action: "create_shipment_request",
        outcome: "success",
        severity: "low",
        actor: {uid, email: request.auth?.token?.email ?? undefined},
        context: {function: "createShipmentRequest", invokeId, requestId: docRef.id},
      });

      console.log(`[createShipmentRequest] OK: shipment request ${docRef.id} created by ${uid}`);
      return {success: true, id: docRef.id};
    } catch (error) {
      console.error("[createShipmentRequest] KO:", error);
      await logSecurityEvent({
        type: "system",
        action: "create_shipment_request_failed",
        outcome: "failure",
        severity: "high",
        actor: {uid: request.auth?.uid, email: request.auth?.token?.email ?? undefined},
        context: {function: "createShipmentRequest", invokeId},
      });
      if (error instanceof HttpsError) throw error;
      throw new HttpsError("internal", "Internal Server Error");
    }
  }
);

export const approveShipmentRequest = onCall(
  {region: REGION},
  async (request) => {
    const invokeId = getInvokeId(request);
    console.log(`[approveShipmentRequest] Invoke ID: ${invokeId} - Function called`);
    try {
      const uid = request.auth?.uid;
      if (!uid) {
        throw new HttpsError("unauthenticated", "User must be authenticated");
      }

      const {requestId} = request.data;
      if (!requestId || typeof requestId !== "string") {
        throw new HttpsError("invalid-argument", "Missing requestId");
      }

      const db = getFirestore();
      await requireAdmin(db, uid);

      const ref = db.collection("shipmentRequests").doc(requestId);
      const snap = await ref.get();
      if (!snap.exists) {
        throw new HttpsError("not-found", "Request not found");
      }

      const data = snap.data();
      if (!data) {
        throw new HttpsError("not-found", "Request data is unavailable");
      }

      if (data.status !== "pending") {
        throw new HttpsError(
          "failed-precondition",
          "Only pending shipment requests can be approved"
        );
      }

      await ref.update({
        status: "approved" satisfies ShipmentStatus,
        updatedAt: FieldValue.serverTimestamp(),
      });

      try {
        const emailData: Record<string, unknown> = {
          id: requestId,
          email: data.email,
          senderName: data.senderName,
          senderAddress: data.senderAddress,
          recipientName: data.recipientName,
          recipientAddress: data.recipientAddress,
          reason: data.reason,
          createdAt: data.createdAt?.toDate
            ? data.createdAt.toDate().toLocaleString("it-IT")
            : "",
        };
        if (data.senderNotes != null) emailData.senderNotes = data.senderNotes;
        if (data.recipientPhone != null) emailData.recipientPhone = data.recipientPhone;
        if (data.deliveryNotes != null) emailData.deliveryNotes = data.deliveryNotes;
        if (data.length != null) emailData.length = data.length;
        if (data.width != null) emailData.width = data.width;
        if (data.height != null) emailData.height = data.height;
        if (data.weight != null) emailData.weight = data.weight;

        const emailDoc = {
          to: [data.email, "spedizione@e-nableitalia.it"],
          template: {
            name: EMAIL_TEMPLATE_IDS.shipmentRequest,
            data: emailData,
          },
          createdAt: FieldValue.serverTimestamp(),
        };
        await db.collection("mail").add(emailDoc);
        console.log(`[approveShipmentRequest] Email enqueued for ${data.email}`);
      } catch (emailError) {
        console.error("[approveShipmentRequest] Failed to enqueue email", emailError);
      }

      await logSecurityEvent({
        type: "system",
        action: "approve_shipment_request",
        outcome: "success",
        severity: "low",
        actor: {uid, email: request.auth?.token?.email ?? undefined},
        context: {function: "approveShipmentRequest", invokeId, requestId},
      });

      console.log(`[approveShipmentRequest] OK: request ${requestId} approved by admin ${uid}`);
      return {success: true};
    } catch (error) {
      console.error("[approveShipmentRequest] KO:", error);
      await logSecurityEvent({
        type: "system",
        action: "approve_shipment_request_failed",
        outcome: "failure",
        severity: "high",
        actor: {uid: request.auth?.uid, email: request.auth?.token?.email ?? undefined},
        context: {function: "approveShipmentRequest", invokeId, requestId: request.data?.requestId},
      });
      if (error instanceof HttpsError) throw error;
      throw new HttpsError("internal", "Internal Server Error");
    }
  }
);

/**
 * Admin: imposta/aggiorna il tracking. Da `approved` passa a `in_transit`;
 * se già `in_transit` aggiorna solo il numero senza cambiare stato.
 */
export const updateShipmentTracking = onCall({region: REGION}, async (request) => {
  const invokeId = getInvokeId(request);
  console.log(`[updateShipmentTracking] Invoke ID: ${invokeId} - Function called`);

  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "User must be authenticated");
  }

  const {requestId, trackingNumber} = (request.data ?? {}) as {
    requestId?: string;
    trackingNumber?: string;
  };

  if (!requestId || typeof requestId !== "string") {
    throw new HttpsError("invalid-argument", "Missing requestId");
  }
  if (typeof trackingNumber !== "string" || !trackingNumber.trim()) {
    throw new HttpsError("invalid-argument", "trackingNumber must be a non-empty string");
  }

  const db = getFirestore();
  await requireAdmin(db, uid);

  const ref = db.collection("shipmentRequests").doc(requestId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new HttpsError("not-found", "Request not found");
  }

  const data = snap.data()!;
  const status = data.status as ShipmentStatus;
  if (status !== "approved" && status !== "in_transit") {
    throw new HttpsError(
      "failed-precondition",
      "Tracking can only be set on approved or in-transit shipments"
    );
  }

  const updates: Record<string, unknown> = {
    trackingNumber: trackingNumber.trim(),
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (status === "approved") {
    updates.status = "in_transit" satisfies ShipmentStatus;
  }

  await ref.update(updates);

  await logSecurityEvent({
    type: "system",
    action: "update_shipment_tracking",
    outcome: "success",
    severity: "low",
    actor: {uid, email: request.auth?.token?.email ?? undefined},
    context: {function: "updateShipmentTracking", invokeId, requestId},
  });

  console.log(`[updateShipmentTracking] OK: request ${requestId} tracking set by ${uid}`);
  return {success: true, status: status === "approved" ? "in_transit" : status};
});

/**
 * Admin: flag manuale «Consegnata» da `in_transit` → `delivered`.
 */
export const markShipmentDelivered = onCall({region: REGION}, async (request) => {
  const invokeId = getInvokeId(request);
  console.log(`[markShipmentDelivered] Invoke ID: ${invokeId} - Function called`);

  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "User must be authenticated");
  }

  const {requestId} = (request.data ?? {}) as {requestId?: string};
  if (!requestId || typeof requestId !== "string") {
    throw new HttpsError("invalid-argument", "Missing requestId");
  }

  const db = getFirestore();
  await requireAdmin(db, uid);

  const ref = db.collection("shipmentRequests").doc(requestId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new HttpsError("not-found", "Request not found");
  }

  const data = snap.data()!;
  if (data.status !== "in_transit") {
    throw new HttpsError(
      "failed-precondition",
      "Only in-transit shipments can be marked as delivered"
    );
  }

  await ref.update({
    status: "delivered" satisfies ShipmentStatus,
    updatedAt: FieldValue.serverTimestamp(),
  });

  await logSecurityEvent({
    type: "system",
    action: "mark_shipment_delivered",
    outcome: "success",
    severity: "low",
    actor: {uid, email: request.auth?.token?.email ?? undefined},
    context: {function: "markShipmentDelivered", invokeId, requestId},
  });

  console.log(`[markShipmentDelivered] OK: request ${requestId} delivered by ${uid}`);
  return {success: true};
});

export const deleteShipmentRequest = onCall(
  {region: REGION},
  async (request) => {
    const invokeId = getInvokeId(request);
    console.log(`[deleteShipmentRequest] Invoke ID: ${invokeId} - Function called`);
    try {
      const uid = request.auth?.uid;
      if (!uid) {
        throw new HttpsError("unauthenticated", "User must be authenticated");
      }

      const {requestId} = request.data;
      if (!requestId) {
        throw new HttpsError("invalid-argument", "Missing requestId");
      }

      const db = getFirestore();

      const userSnap = await db.collection("users").doc(uid).get();
      if (!userSnap.exists) {
        throw new HttpsError("permission-denied", "User not found");
      }
      const role = userSnap.data()?.role;

      const ref = db.collection("shipmentRequests").doc(requestId);
      const snap = await ref.get();
      if (!snap.exists) {
        throw new HttpsError("not-found", "Request not found");
      }

      const data = snap.data()!;

      if (role !== "admin") {
        if (data.createdBy !== uid) {
          console.log(`[deleteShipmentRequest] KO: uid ${uid} tried to delete another user's request ${requestId}`);
          throw new HttpsError("permission-denied", "Cannot delete another user's request");
        }
        if (data.status !== "pending") {
          console.log(`[deleteShipmentRequest] KO: uid ${uid} tried to delete non-pending request ${requestId}`);
          throw new HttpsError("permission-denied", "Can only delete pending requests");
        }
      }

      await ref.update({
        status: "deleted" satisfies ShipmentStatus,
        updatedAt: FieldValue.serverTimestamp(),
      });

      await logSecurityEvent({
        type: "system",
        action: "delete_shipment_request",
        outcome: "success",
        severity: "low",
        actor: {uid, email: request.auth?.token?.email ?? undefined},
        context: {function: "deleteShipmentRequest", invokeId, requestId},
      });

      console.log(`[deleteShipmentRequest] OK: request ${requestId} deleted by ${uid}`);
      return {success: true};
    } catch (error) {
      console.error("[deleteShipmentRequest] KO:", error);
      await logSecurityEvent({
        type: "system",
        action: "delete_shipment_request_failed",
        outcome: "failure",
        severity: "high",
        actor: {uid: request.auth?.uid, email: request.auth?.token?.email ?? undefined},
        context: {function: "deleteShipmentRequest", invokeId, requestId: request.data?.requestId},
      });
      if (error instanceof HttpsError) throw error;
      throw new HttpsError("internal", "Internal Server Error");
    }
  }
);
