import {onCall, HttpsError} from "firebase-functions/v2/https";
import {getFirestore} from "firebase-admin/firestore";

const REGION = "europe-west1";

type ChecklistItemStatus = "Assegnare" | "Da iniziare" | "In corso" | "Completata";

interface ChecklistItem {
  id: string;
  title: string;
  assignee?: string;
  quantity?: number;
  notes?: string;
  status: ChecklistItemStatus;
  completed: boolean;
}

interface ChecklistResponse {
  category: unknown;
  title: unknown;
  items: ChecklistItem[];
  createdAt: unknown;
  updatedAt: unknown;
}

export const getChecklist = onCall({region: REGION}, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "User must be authenticated");
  }

  const {checklistId} = request.data as { checklistId?: string };
  if (!checklistId || typeof checklistId !== "string") {
    throw new HttpsError("invalid-argument", "Missing parameter: checklistId");
  }

  const db = getFirestore();
  const snap = await db.collection("checklists").doc(checklistId).get();

  if (!snap.exists) {
    throw new HttpsError("not-found", "Checklist not found");
  }

  const data = snap.data() ?? {};

  const response: ChecklistResponse = {
    category: data.category,
    title: data.title,
    items: Array.isArray(data.items) ? data.items : [],
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
  };

  return response;
});
