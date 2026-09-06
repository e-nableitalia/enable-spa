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
 * (campi di `AttachmentDocumentFields` più `id`, `createdAt` e
 * `entityCollectionPath`), la forma restituita da `listAttachmentsForEntity`
 * (EA-164) e `getAttachmentById` (EA-165). */
export interface AttachmentRecord extends AttachmentDocumentFields {
  id: string;
  createdAt: unknown;
  /** Nome della collection di primo livello dell'entità proprietaria (es.
   * "deviceRequests"), persistito al momento della creazione da
   * `createAttachment` (F-42): a differenza degli altri parametri opachi di
   * questo modulo, questo campo DEVE essere letto dal documento già risolto
   * invece che ri-accettato dal chiamante per un'operazione distruttiva come
   * `deleteAttachmentRecord` — altrimenti un valore sbagliato produce un
   * batch.delete silenzioso su un path indice inesistente, senza errore,
   * lasciando l'entry reale orfana. */
  entityCollectionPath: string;
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
 *
 * `entityCollectionPath` viene anche persistito sul documento
 * `attachments/{attachmentId}` stesso (F-42): necessario a
 * `deleteAttachmentRecord` per non dover ri-accettare lo stesso valore da un
 * parametro indipendente del chiamante in un'operazione distruttiva.
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
    entityCollectionPath,
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
 * Risolve un singolo allegato dal catalogo di primo livello
 * `attachments/{attachmentId}` (EA-165, `downloadAttachment`): a differenza
 * di `listAttachmentsForEntity`, qui il chiamante conosce già
 * l'`attachmentId` (es. click su un allegato già elencato) e non serve
 * passare dall'indice subcollection dell'entità proprietaria.
 *
 * Restituisce `null` se l'allegato non esiste (id non valido o già
 * eliminato), senza errore: la decisione su come reagire spetta al
 * chiamante.
 */
export async function getAttachmentById(
  db: Firestore,
  attachmentId: string
): Promise<AttachmentRecord | null> {
  const snap = await db.collection(ATTACHMENTS_COLLECTION).doc(attachmentId).get();
  if (!snap.exists) {
    return null;
  }
  return snap.data() as AttachmentRecord;
}

/** Campi modificabili di un allegato già esistente (EA-166): solo
 * descrizione e note, mai gli altri campi (entità proprietaria, file,
 * dimensione, ecc.), che restano fissati al momento dell'upload. */
export interface AttachmentUpdateInput {
  description: string;
  notes?: string;
}

/**
 * Aggiorna descrizione (e, se fornita, le note) di un allegato già
 * esistente in `attachments/{attachmentId}` (EA-166). La descrizione resta
 * il campo obbligatorio del modello dati (Scenario 4): non può essere
 * impostata a vuoto, stessa regola di `buildAttachmentDocument` in fase di
 * creazione. `notes` è aggiornato solo se esplicitamente fornito, altrimenti
 * resta invariato (a differenza della creazione, qui non c'è un default
 * "stringa vuota" da applicare).
 *
 * L'RBAC (admin su qualunque allegato, volontario solo sui propri) è
 * responsabilità del chiamante (`updateAttachmentDescription`), non di
 * questa funzione: qui si assume che il diritto di modifica sia già stato
 * verificato.
 */
export async function updateAttachmentFields(
  db: Firestore,
  attachmentId: string,
  input: AttachmentUpdateInput
): Promise<void> {
  if (!input.description || !input.description.trim()) {
    throw new Error("description is required");
  }

  const fields: Record<string, unknown> = { description: input.description };
  if (input.notes !== undefined) {
    fields.notes = input.notes;
  }

  await db.collection(ATTACHMENTS_COLLECTION).doc(attachmentId).update(fields);
}

/**
 * Elimina l'allegato dai suoi due artefatti Firestore (EA-167): il documento
 * `attachments/{attachmentId}` nel catalogo di primo livello e l'entry
 * indice in `{entityCollectionPath}/{entityId}/attachments/{attachmentId}`,
 * nella stessa scrittura atomica (`batch.delete`, simmetrico a
 * `createAttachment`).
 *
 * A differenza di `createAttachment`/`listAttachmentsForEntity`,
 * `entityCollectionPath` NON va fornito da un parametro indipendente del
 * chiamante: il chiamante (`deleteAttachment`) deve passare il valore letto
 * dal documento già risolto via `getAttachmentById` (persistito lì da
 * `createAttachment`, F-42). Un `entityCollectionPath` indipendente e
 * potenzialmente disallineato renderebbe `batch.delete()` sull'entry indice
 * un no-op silenzioso (Firestore non segnala errore eliminando un path
 * inesistente), lasciando l'entry reale orfana in modo permanente senza che
 * la chiamata segnali alcun problema — trovato dal panel review di EA-167.
 *
 * Non tocca il file fisico nel bucket: eliminazione a carico del chiamante
 * (`deleteAttachment`), prima di questa chiamata — nessuna eliminazione
 * reale è reversibile su nessuno dei tre artefatti (Story EA-167).
 */
export async function deleteAttachmentRecord(
  db: Firestore,
  entityCollectionPath: string,
  attachmentId: string,
  entityId: string
): Promise<void> {
  const attachmentRef = db.collection(ATTACHMENTS_COLLECTION).doc(attachmentId);
  const indexRef = db
    .collection(entityCollectionPath)
    .doc(entityId)
    .collection(ATTACHMENT_INDEX_SUBCOLLECTION)
    .doc(attachmentId);

  const batch = db.batch();
  batch.delete(attachmentRef);
  batch.delete(indexRef);
  await batch.commit();
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
