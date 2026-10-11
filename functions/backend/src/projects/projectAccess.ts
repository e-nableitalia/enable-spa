import { HttpsError } from "firebase-functions/v2/https";
import type { Firestore } from "firebase-admin/firestore";

/**
 * Helper condivisi dal dominio "projects" (EA-169/170): entità
 * `projects/{projectId}` che riusa il core `process-organizer-core` per
 * le checklist collegate, stesso principio del layer `device-requests`
 * (`deviceRequestChecklistAccess.ts`) ma con un RBAC diverso — qui non
 * esiste un concetto di "volontario assegnato a questo progetto": la
 * lettura e l'assegnazione item sono aperte a qualunque admin/volontario,
 * solo la creazione/modifica del progetto e delle sue checklist resta
 * riservata all'admin.
 */

export const PROJECT_STATUSES = ["new", "active", "standby", "archived", "closed"] as const;
export type ProjectStatus = typeof PROJECT_STATUSES[number];

/** Stati terminali: nessuna modifica di alcun tipo è più permessa, nemmeno
 * una nota o un'ulteriore transizione di stato (decisione operatore). */
const TERMINAL_STATUSES = new Set<string>(["archived", "closed"]);

/** Stati in cui il contenuto (titolo/descrizione/checklist/item) può
 * essere modificato. `standby` ne è deliberatamente escluso: l'unica
 * scrittura ammessa in quello stato è l'aggiunta di una nota, gestita da
 * `changeProjectStatus` con un controllo dedicato, non da questa funzione. */
const CONTENT_WRITABLE_STATUSES = new Set<string>(["new", "active"]);

export interface ProjectChecklistRef {
  checklistId: string;
  label: string;
}

export interface ProjectRecord {
  title: string;
  description: string;
  projectType: string;
  status: string;
  checklists: ProjectChecklistRef[];
  createdBy: string;
}

export interface ProjectDoc extends ProjectRecord {
  id: string;
}

/**
 * Normalizza un documento `projects/{id}` al contratto EA-169/170.
 * Documenti legacy (pre-EA-169) usano `name` al posto di `title`,
 * `createdByUid` al posto di `createdBy`, spesso senza `projectType`, e
 * a volte `status: "draft"` (non nel dominio attuale). Senza questa
 * mappatura `listProjects` mostra righe "senza titolo/tipo".
 */
export function normalizeProjectRecord(raw: Record<string, unknown> | undefined | null): ProjectRecord {
  const data = raw ?? {};
  const titleFromTitle = typeof data.title === "string" ? data.title.trim() : "";
  const titleFromName = typeof data.name === "string" ? data.name.trim() : "";
  const title = titleFromTitle || titleFromName;

  const projectType = typeof data.projectType === "string" ? data.projectType : "";

  let status = typeof data.status === "string" ? data.status : "new";
  if (status === "draft") {
    status = "new";
  }

  const createdByFromField = typeof data.createdBy === "string" ? data.createdBy : "";
  const createdByFromUid = typeof data.createdByUid === "string" ? data.createdByUid : "";
  const createdBy = createdByFromField || createdByFromUid;

  const description = typeof data.description === "string" ? data.description : "";
  const checklists = Array.isArray(data.checklists)
    ? (data.checklists as ProjectChecklistRef[])
    : [];

  return { title, description, projectType, status, checklists, createdBy };
}

export function isValidProjectStatus(value: unknown): value is ProjectStatus {
  return typeof value === "string" && (PROJECT_STATUSES as readonly string[]).includes(value);
}

/** Lettura (progetto, checklist, cronologia): qualunque admin o volontario,
 * sempre permessa indipendentemente dallo stato. */
export async function requireStaffRole(db: Firestore, uid: string): Promise<"admin" | "volunteer"> {
  const userSnap = await db.collection("users").doc(uid).get();
  const role = userSnap.exists ? userSnap.data()?.role : undefined;
  if (role !== "admin" && role !== "volunteer") {
    throw new HttpsError("permission-denied", "Only admin or volunteers can access projects");
  }
  return role;
}

/** Creazione/modifica progetto, creazione/eliminazione checklist: solo admin. */
export async function requireAdmin(db: Firestore, uid: string): Promise<void> {
  const userSnap = await db.collection("users").doc(uid).get();
  const role = userSnap.exists ? userSnap.data()?.role : undefined;
  if (role !== "admin") {
    throw new HttpsError("permission-denied", "Only admin can perform this action");
  }
}

export async function getProjectOrThrow(db: Firestore, projectId: string): Promise<ProjectDoc> {
  const snap = await db.collection("projects").doc(projectId).get();
  if (!snap.exists) {
    throw new HttpsError("not-found", "Project not found");
  }
  return { id: snap.id, ...normalizeProjectRecord(snap.data() as Record<string, unknown>) };
}

/** Blocca qualunque modifica (entità, checklist, item) fuori da
 * `new`/`active`. Non usata da `changeProjectStatus`, che ha le proprie
 * regole (transizioni ammesse anche da `standby`, mai da stati terminali). */
export function assertProjectContentWritable(status: string): void {
  if (!CONTENT_WRITABLE_STATUSES.has(status)) {
    throw new HttpsError(
      "failed-precondition",
      "This project's status does not allow modifications (only 'new'/'active' projects can be edited)"
    );
  }
}

/** Blocca qualunque azione (incluse note e transizioni di stato) se il
 * progetto è già in uno stato terminale. */
export function assertProjectNotTerminal(status: string): void {
  if (TERMINAL_STATUSES.has(status)) {
    throw new HttpsError(
      "failed-precondition",
      "This project is archived/closed: no further changes are allowed"
    );
  }
}

export function assertChecklistBelongsToProject(project: ProjectDoc, checklistId: string): void {
  if (!project.checklists.some((c) => c.checklistId === checklistId)) {
    throw new HttpsError("not-found", "Checklist not linked to this project");
  }
}

/** Un assignee valido per un item di checklist di progetto è un admin
 * qualunque o un volontario attivo qualunque — a differenza di
 * `device-requests`, nessuna restrizione ai soli volontari "assegnati",
 * perché per i progetti non esiste quel concetto. */
export async function isResolvableProjectAssignee(db: Firestore, uid: string): Promise<boolean> {
  const userSnap = await db.collection("users").doc(uid).get();
  if (!userSnap.exists) return false;
  const data = userSnap.data() ?? {};
  if (data.role === "admin") return true;
  return data.role === "volunteer" && data.active === true;
}
