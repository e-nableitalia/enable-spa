import type { Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";

/**
 * Modello dati di base della capability "Allegati" (EA-162, prima Story di
 * EA-161). Modulo condiviso, senza alcuna Cloud Function callable ancora
 * agganciata: le Story successive (upload/list/update/delete) importeranno
 * queste funzioni invece di duplicare la logica di scrittura, stesso pattern
 * già stabilito da `checklistItemStatus` per il core Organizer.
 *
 * Collection di primo livello `attachments/{attachmentId}` come catalogo
 * metadati agnostico rispetto al dominio consumer (decisione "modello dati
 * ibrido", docs/implementation-requests/cross-entity-attachments-request.md).
 */
export const ATTACHMENTS_COLLECTION = "attachments";

/** Nome della subcollection indice sotto l'entità proprietaria (stesso nome
 * della collection di primo livello, per coerenza semantica: entrambe si
 * chiamano "attachments", una è il catalogo, l'altra il suo indice locale). */
export const ATTACHMENT_INDEX_SUBCOLLECTION = "attachments";

export interface AttachmentInput {
  entityType: string;
  entityId: string;
  uploadedBy: string;
  /** Obbligatoria (decisione operatore 2026-09-06): non un campo opzionale. */
  description: string;
  notes?: string;
  category?: string;
  fileName: string;
  storagePath: string;
  size: number;
}

export interface AttachmentDocumentFields {
  entityType: string;
  entityId: string;
  uploadedBy: string;
  description: string;
  notes: string;
  category: string | null;
  fileName: string;
  extension: string;
  storagePath: string;
  size: number;
}

/** Documento completo così com'è persistito in `attachments/{attachmentId}`
 * (campi di `AttachmentDocumentFields` più `id` e `createdAt`), la forma
 * restituita da `listAttachmentsForEntity` (EA-164). */
export interface AttachmentRecord extends AttachmentDocumentFields {
  id: string;
  createdAt: unknown;
}

/**
 * Deduce l'estensione dal nome file, senza il punto (es. "foto.jpg" -> "jpg").
 * Non è mai un campo fornito indipendentemente dal chiamante (Scenario 2).
 *
 * Un file senza punto, o un dotfile senza altro punto (es. ".gitignore"),
 * non ha estensione dedotta: restituisce stringa vuota.
 */
export function deduceFileExtension(fileName: string): string {
  const lastDotIndex = fileName.lastIndexOf(".");
  if (lastDotIndex <= 0 || lastDotIndex === fileName.length - 1) {
    return "";
  }
  return fileName.slice(lastDotIndex + 1).toLowerCase();
}

/**
 * Assembla i campi del documento `attachments/{attachmentId}` a partire
 * dall'input del consumer, deducendo `extension` da `fileName` (Scenario 2).
 * Non tocca Firestore: pura funzione di normalizzazione, riusabile dalla
 * futura Cloud Function `uploadAttachment` così come dai test.
 */
export function buildAttachmentDocument(input: AttachmentInput): AttachmentDocumentFields {
  if (!input.description || !input.description.trim()) {
    throw new Error("description is required");
  }

  return {
    entityType: input.entityType,
    entityId: input.entityId,
    uploadedBy: input.uploadedBy,
    description: input.description,
    notes: input.notes ?? "",
    category: input.category ?? null,
    fileName: input.fileName,
    extension: deduceFileExtension(input.fileName),
    storagePath: input.storagePath,
    size: input.size,
  };
}

/**
 * Genera un id di allegato prima ancora di scrivere alcun documento —
 * serve a `uploadAttachment` (EA-163) per costruire `storagePath` (che
 * incorpora l'id nel path GCS) prima di chiamare `createAttachment`, così
 * che l'id del path di storage e l'id del documento Firestore coincidano
 * sempre, invece di essere due identificatori indipendenti.
 */
export function newAttachmentId(db: Firestore): string {
  return db.collection(ATTACHMENTS_COLLECTION).doc().id;
}

/**
 * Crea l'allegato: un documento in `attachments/{attachmentId}` (catalogo
 * metadati di primo livello, Scenario 2) e, nella stessa scrittura atomica,
 * un documento indice in `{entityCollectionPath}/{entityId}/attachments/{attachmentId}`
 * (Scenario 3) che referenzia lo stesso `attachmentId` — sufficiente per
 * enumerare gli allegati dell'entità senza una query `where` sulla collection
 * di primo livello.
 *
 * `entityCollectionPath` è il nome della collection di primo livello
 * dell'entità proprietaria (es. "deviceRequests"), fornito esplicitamente dal
 * chiamante invece di essere derivato da `entityType` (es. pluralizzando
 * "deviceRequest"): il core Allegati resta così agnostico rispetto a come un
 * dominio consumer nomina la propria collection, senza inventare una
 * convenzione di pluralizzazione che potrebbe non valere per un futuro
 * `entityType`.
 *
 * `attachmentId`, se fornito (tipicamente da `newAttachmentId`), viene
 * riusato come id del documento invece di generarne uno nuovo — necessario
 * a `uploadAttachment` per allineare id del documento e id già incorporato
 * in `input.storagePath`.
 */
export async function createAttachment(
  db: Firestore,
  entityCollectionPath: string,
  input: AttachmentInput,
  attachmentId?: string
): Promise<{ attachmentId: string }> {
  const fields = buildAttachmentDocument(input);

  const attachmentRef = attachmentId
    ? db.collection(ATTACHMENTS_COLLECTION).doc(attachmentId)
    : db.collection(ATTACHMENTS_COLLECTION).doc();
  const indexRef = db
    .collection(entityCollectionPath)
    .doc(input.entityId)
    .collection(ATTACHMENT_INDEX_SUBCOLLECTION)
    .doc(attachmentRef.id);

  const batch = db.batch();
  batch.set(attachmentRef, {
    id: attachmentRef.id,
    ...fields,
    createdAt: FieldValue.serverTimestamp(),
  });
  batch.set(indexRef, {
    attachmentId: attachmentRef.id,
    createdAt: FieldValue.serverTimestamp(),
  });

  await batch.commit();

  return { attachmentId: attachmentRef.id };
}

/**
 * Enumera gli allegati di un'entità (EA-164) leggendo prima l'indice
 * subcollection `{entityCollectionPath}/{entityId}/attachments`
 * (solo `attachmentId`/`createdAt`, scritto da `createAttachment`), poi
 * risolvendo i metadati completi con un'unica lettura batch (`db.getAll`,
 * stesso pattern di `listMyChecklistItems`) sui documenti
 * `attachments/{attachmentId}` referenziati — mai una query `where` sulla
 * collection di primo livello, coerente con lo scopo dell'indice.
 *
 * Ordinati per `createdAt` crescente (ordine di caricamento). Un'entità
 * senza alcun allegato restituisce un array vuoto, senza errore.
 */
export async function listAttachmentsForEntity(
  db: Firestore,
  entityCollectionPath: string,
  entityId: string
): Promise<AttachmentRecord[]> {
  const indexSnap = await db
    .collection(entityCollectionPath)
    .doc(entityId)
    .collection(ATTACHMENT_INDEX_SUBCOLLECTION)
    .orderBy("createdAt", "asc")
    .get();

  if (indexSnap.empty) {
    return [];
  }

  const attachmentRefs = indexSnap.docs.map((doc) =>
    db.collection(ATTACHMENTS_COLLECTION).doc(doc.id)
  );
  const attachmentSnaps = await db.getAll(...attachmentRefs);

  return attachmentSnaps
    .filter((snap) => snap.exists)
    .map((snap) => snap.data() as AttachmentRecord);
}
