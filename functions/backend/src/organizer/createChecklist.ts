import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getInvokeId } from "../utils/invoke";

const REGION = "europe-west1";

export interface ChecklistItemInput {
  title: string;
  assignee?: string | null;
  quantity?: number | null;
  notes?: string | null;
}

interface ChecklistItem {
  title: string;
  assignee: string | null;
  quantity: number | null;
  notes: string | null;
  status: "Assegnare" | "Da iniziare" | "In corso" | "Completata";
  completed: boolean;
}

function normalizeItem(item: unknown): ChecklistItem {
  const raw = (item ?? {}) as Partial<ChecklistItemInput>;
  return {
    title: raw.title ?? "",
    assignee: raw.assignee ?? null,
    quantity: raw.quantity ?? null,
    notes: raw.notes ?? null,
    status: "Assegnare",
    completed: false,
  };
}

/**
 * Cloud Function to create a new Organizer core checklist instance.
 *
 * Creates a `checklists/{checklistId}` document with the fields `category`,
 * `title`, `items` and `createdAt`, then returns the generated
 * `checklistId` to the caller.
 *
 * @param request The callable request object, with `category`, `title` and
 * an optional `items` array in `data`.
 * @returns An object with the generated `checklistId`.
 * @throws HttpsError If `category` or `title` are missing/invalid.
 */
export const createChecklist = onCall(
  { region: REGION },
  async (request) => {
    const invokeId = getInvokeId(request);
    console.log(`[createChecklist] Invoke ID: ${invokeId} - Function called`);

    const data = request.data ?? {};
    const { category, title, items } = data;

    if (!category || typeof category !== "string") {
      console.log("[createChecklist] KO: Missing or invalid category");
      throw new HttpsError("invalid-argument", "Missing or invalid category");
    }
    if (!title || typeof title !== "string") {
      console.log("[createChecklist] KO: Missing or invalid title");
      throw new HttpsError("invalid-argument", "Missing or invalid title");
    }

    const normalizedItems = Array.isArray(items) ? items.map(normalizeItem) : [];

    const db = getFirestore();
    const checklistRef = db.collection("checklists").doc();

    console.log(`[createChecklist] Creating checklist document ${checklistRef.id}`);
    await checklistRef.set({
      category,
      title,
      items: normalizedItems,
      createdAt: FieldValue.serverTimestamp(),
    });

    return { checklistId: checklistRef.id };
  }
);
