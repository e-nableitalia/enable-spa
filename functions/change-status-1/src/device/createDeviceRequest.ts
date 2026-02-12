import {onRequest} from "firebase-functions/v2/https";
import {getFirestore, FieldValue} from "firebase-admin/firestore";
import {mapToPublicStatus} from "../utils/mapToPublicStatus";

export const createDeviceRequest = onRequest(
  {region: "europe-west1"},
  async (req, res) => {
    try {
      if (req.method !== "POST") {
        res.status(405).send("Method Not Allowed");
        return;
      }

      const data = req.body;

      if (!data.email || !data.deviceType || !data.province) {
        res.status(400).send("Missing required fields");
        return;
      }

      const db = getFirestore();
      const requestRef = db.collection("deviceRequests").doc();

      await db.runTransaction(async (tx) => {

        tx.set(requestRef, {
          deviceType: data.deviceType,
          province: data.province,
          status: "inviata",
          publicStatus: mapToPublicStatus("inviata"),
          assignedVolunteer: null,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          createdBy: "public-form"
        });

        tx.set(requestRef.collection("private").doc("data"), {
          email: data.email,
          firstName: data.firstName || null,
          lastName: data.lastName || null,
          phone: data.phone || null,
          description: data.description || null,
          consentPrivacy: data.consentPrivacy || false
        });

        tx.set(requestRef.collection("events").doc(), {
          type: "status_change",
          fromStatus: null,
          toStatus: "inviata",
          timestamp: FieldValue.serverTimestamp(),
          createdBy: "system",
          note: "Richiesta creata da form pubblica"
        });

        tx.set(
          db.collection("publicDeviceRequests").doc(requestRef.id),
          {
            deviceType: data.deviceType,
            province: data.province,
            publicStatus: mapToPublicStatus("inviata"),
            createdAt: FieldValue.serverTimestamp()
          }
        );
      });

      res.status(200).json({success: true});
      return;

    } catch (error) {
      console.error(error);
      res.status(500).send("Internal Server Error");
      return;
    }
  }
);

