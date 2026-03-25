import {onCall, HttpsError} from "firebase-functions/v2/https";
import {getFirestore, FieldValue} from "firebase-admin/firestore";
import {logSecurityEvent} from "../security/securityLog";
import {getInvokeId} from "../utils/invoke";

export const createShipmentRequest = onCall(
  {region: "europe-west1"},
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
        console.log(`[createShipmentRequest] KO: Missing required fields`);
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
        status: "pending",
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
        actor: { uid, email: request.auth?.token?.email ?? undefined },
        context: { function: "createShipmentRequest", invokeId, requestId: docRef.id },
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
        actor: { uid: request.auth?.uid, email: request.auth?.token?.email ?? undefined },
        context: { function: "createShipmentRequest", invokeId },
      });
      if (error instanceof HttpsError) throw error;
      throw new HttpsError("internal", "Internal Server Error");
    }
  }
);
export const approveShipmentRequest = onCall(
  { region: "europe-west1" },
  async (request) => {
    const invokeId = getInvokeId(request);
    console.log(`[approveShipmentRequest] Invoke ID: ${invokeId} - Function called`);
    try {
      const uid = request.auth?.uid;
      if (!uid) {
        throw new HttpsError("unauthenticated", "User must be authenticated");
      }

      const { requestId } = request.data;
      if (!requestId) {
        throw new HttpsError("invalid-argument", "Missing requestId");
      }

      const db = getFirestore();

      // Check admin
      const userSnap = await db.collection("users").doc(uid).get();
      if (!userSnap.exists || userSnap.data()?.role !== "admin") {
        console.log(`[approveShipmentRequest] KO: permission denied for uid ${uid}`);
        throw new HttpsError("permission-denied", "Admin role required");
      }

      // Load request
      const ref = db.collection("shipmentRequests").doc(requestId);
      const snap = await ref.get();
      if (!snap.exists) {
        throw new HttpsError("not-found", "Request not found");
      }

      const data = snap.data();
      if (!data) {
        throw new HttpsError("not-found", "Request data is unavailable");
      }

      // Update status
      await ref.update({
        status: "approved",
        updatedAt: FieldValue.serverTimestamp(),
      });

      // Send email (enqueue)
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
          to: [ data.email, 'volontari@e-nableitalia.it' ],
          template: {
            name: "shipmentRequest",
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
        actor: { uid, email: request.auth?.token?.email ?? undefined },
        context: { function: "approveShipmentRequest", invokeId, requestId },
      });

      console.log(`[approveShipmentRequest] OK: request ${requestId} approved by admin ${uid}`);
      return { success: true };
    } catch (error) {
      console.error("[approveShipmentRequest] KO:", error);
      await logSecurityEvent({
        type: "system",
        action: "approve_shipment_request_failed",
        outcome: "failure",
        severity: "high",
        actor: { uid: request.auth?.uid, email: request.auth?.token?.email ?? undefined },
        context: { function: "approveShipmentRequest", invokeId, requestId: request.data?.requestId },
      });
      if (error instanceof HttpsError) throw error;
      throw new HttpsError("internal", "Internal Server Error");
    }
  }
);

export const deleteShipmentRequest = onCall(
  {region: "europe-west1"},
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
        status: "deleted",
        updatedAt: FieldValue.serverTimestamp(),
      });

      await logSecurityEvent({
        type: "system",
        action: "delete_shipment_request",
        outcome: "success",
        severity: "low",
        actor: { uid, email: request.auth?.token?.email ?? undefined },
        context: { function: "deleteShipmentRequest", invokeId, requestId },
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
        actor: { uid: request.auth?.uid, email: request.auth?.token?.email ?? undefined },
        context: { function: "deleteShipmentRequest", invokeId, requestId: request.data?.requestId },
      });
      if (error instanceof HttpsError) throw error;
      throw new HttpsError("internal", "Internal Server Error");
    }
  }
);
