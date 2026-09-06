const SERVER_TIMESTAMP_SENTINEL = { __type: "serverTimestamp" };

const batchSetMock = jest.fn();
const batchCommitMock = jest.fn().mockResolvedValue(undefined);

let attachmentDocCounter = 0;

function attachmentsDoc() {
  attachmentDocCounter += 1;
  return { id: `generated-attachment-id-${attachmentDocCounter}` };
}

jest.mock("firebase-admin/firestore", () => ({
  FieldValue: {
    serverTimestamp: jest.fn(() => SERVER_TIMESTAMP_SENTINEL),
  },
}));

import {
  deduceFileExtension,
  buildAttachmentDocument,
  createAttachment,
  getAttachmentById,
  updateAttachmentFields,
  listAttachmentsForEntity,
  ATTACHMENTS_COLLECTION,
  ATTACHMENT_INDEX_SUBCOLLECTION,
  AttachmentInput,
} from "./attachmentModel";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function attachmentDocSetCall(id: string): [{ id: string }, any] {
  const call = batchSetMock.mock.calls.find(([ref]) => ref.id === id && !("entityId" in ref));
  if (!call) {
    throw new Error(`No batch.set call found for the attachments/${id} document`);
  }
  return call;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function indexDocSetCall(id: string): [{ id: string; entityId: string }, any] {
  const call = batchSetMock.mock.calls.find(([ref]) => ref.id === id && "entityId" in ref);
  if (!call) {
    throw new Error(`No batch.set call found for the index document of ${id}`);
  }
  return call;
}

function baseInput(overrides: Partial<AttachmentInput> = {}): AttachmentInput {
  return {
    entityType: "deviceRequest",
    entityId: "request-42",
    uploadedBy: "user-1",
    description: "Fattura di acquisto",
    fileName: "fattura.pdf",
    storagePath: "attachments/deviceRequest/request-42/att-1/fattura.pdf",
    size: 1024,
    ...overrides,
  };
}

describe("deduceFileExtension", () => {
  it("deduces the extension from a simple filename", () => {
    expect(deduceFileExtension("fattura.pdf")).toBe("pdf");
  });

  it("lowercases the deduced extension", () => {
    expect(deduceFileExtension("Foto.JPG")).toBe("jpg");
  });

  it("uses the last segment when the filename has multiple dots", () => {
    expect(deduceFileExtension("archivio.tar.gz")).toBe("gz");
  });

  it("returns an empty string when the filename has no dot", () => {
    expect(deduceFileExtension("README")).toBe("");
  });

  it("returns an empty string for a dotfile with no further extension", () => {
    expect(deduceFileExtension(".gitignore")).toBe("");
  });

  it("returns an empty string when the dot is the last character", () => {
    expect(deduceFileExtension("nomestrano.")).toBe("");
  });
});

describe("buildAttachmentDocument", () => {
  // Scenario 2: tutti i campi elencati sono presenti sul documento
  it("includes all the fields decided for the Attachment entity", () => {
    const result = buildAttachmentDocument(
      baseInput({ notes: "Da archiviare", category: "amministrativo" })
    );

    expect(result).toEqual({
      entityType: "deviceRequest",
      entityId: "request-42",
      uploadedBy: "user-1",
      description: "Fattura di acquisto",
      notes: "Da archiviare",
      category: "amministrativo",
      fileName: "fattura.pdf",
      extension: "pdf",
      storagePath: "attachments/deviceRequest/request-42/att-1/fattura.pdf",
      size: 1024,
    });
  });

  // Scenario 2: l'estensione è dedotta dal nome file, non un campo fornito dal chiamante
  it("deduces the extension from fileName instead of accepting it from the caller", () => {
    const result = buildAttachmentDocument(baseInput({ fileName: "cartella-clinica.PDF" }));
    expect(result.extension).toBe("pdf");
  });

  it("defaults notes to an empty string when not provided", () => {
    const result = buildAttachmentDocument(baseInput());
    expect(result.notes).toBe("");
  });

  it("defaults category to null when not provided", () => {
    const result = buildAttachmentDocument(baseInput());
    expect(result.category).toBeNull();
  });

  // Scenario 2: la descrizione è obbligatoria
  it("throws when description is missing", () => {
    expect(() => buildAttachmentDocument(baseInput({ description: "" }))).toThrow(
      "description is required"
    );
  });

  it("throws when description is blank", () => {
    expect(() => buildAttachmentDocument(baseInput({ description: "   " }))).toThrow(
      "description is required"
    );
  });
});

describe("createAttachment", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    attachmentDocCounter = 0;
    batchCommitMock.mockResolvedValue(undefined);
  });

  function buildDbMock() {
    const collectionMock = jest.fn((name: string) => {
      if (name === ATTACHMENTS_COLLECTION) {
        return { doc: jest.fn(() => attachmentsDoc()) };
      }
      // entity collection: db.collection(entityCollectionPath).doc(entityId).collection(...).doc(attachmentId)
      return {
        doc: jest.fn((entityId: string) => ({
          collection: jest.fn((subName: string) => {
            expect(subName).toBe(ATTACHMENT_INDEX_SUBCOLLECTION);
            return {
              doc: jest.fn((attachmentId: string) => ({ id: attachmentId, entityId })),
            };
          }),
        })),
      };
    });

    const batchMock = jest.fn(() => ({
      set: batchSetMock,
      commit: batchCommitMock,
    }));

    return { collection: collectionMock, batch: batchMock } as unknown as import("firebase-admin/firestore").Firestore;
  }

  // Scenario 2: il documento viene scritto in attachments/{attachmentId} con tutti i campi
  it("writes the attachment document in the attachments top-level collection", async () => {
    const db = buildDbMock();

    const { attachmentId } = await createAttachment(db, "deviceRequests", baseInput());

    const [, attachmentDocument] = attachmentDocSetCall(attachmentId);
    expect(attachmentDocument).toEqual({
      id: attachmentId,
      entityType: "deviceRequest",
      entityId: "request-42",
      uploadedBy: "user-1",
      description: "Fattura di acquisto",
      notes: "",
      category: null,
      fileName: "fattura.pdf",
      extension: "pdf",
      storagePath: "attachments/deviceRequest/request-42/att-1/fattura.pdf",
      size: 1024,
      createdAt: SERVER_TIMESTAMP_SENTINEL,
    });
  });

  // Scenario 3: esiste un documento nella subcollection dell'entità proprietaria
  // che referenzia lo stesso attachmentId
  it("writes an index document under the owning entity's subcollection referencing the same attachmentId", async () => {
    const db = buildDbMock();

    const { attachmentId } = await createAttachment(db, "deviceRequests", baseInput());

    const [indexRef, indexDocument] = indexDocSetCall(attachmentId);
    expect(indexRef).toEqual({ id: attachmentId, entityId: "request-42" });
    expect(indexDocument).toEqual({
      attachmentId,
      createdAt: SERVER_TIMESTAMP_SENTINEL,
    });
  });

  it("writes both documents in the same atomic batch", async () => {
    const db = buildDbMock();

    await createAttachment(db, "deviceRequests", baseInput());

    expect(batchSetMock).toHaveBeenCalledTimes(2);
    expect(batchCommitMock).toHaveBeenCalledTimes(1);
  });

  it("returns the generated attachmentId", async () => {
    const db = buildDbMock();

    const result = await createAttachment(db, "deviceRequests", baseInput());

    expect(result).toEqual({ attachmentId: expect.any(String) });
  });

  it("propagates validation errors (e.g. missing description) without writing anything", async () => {
    const db = buildDbMock();

    await expect(
      createAttachment(db, "deviceRequests", baseInput({ description: "" }))
    ).rejects.toThrow("description is required");

    expect(batchCommitMock).not.toHaveBeenCalled();
  });
});

describe("getAttachmentById", () => {
  function buildDbMock(docSnap: { exists: boolean; data: () => unknown }) {
    const getMock = jest.fn().mockResolvedValue(docSnap);
    const collectionMock = jest.fn((name: string) => {
      expect(name).toBe(ATTACHMENTS_COLLECTION);
      return { doc: jest.fn(() => ({ get: getMock })) };
    });

    return {
      db: { collection: collectionMock } as unknown as import("firebase-admin/firestore").Firestore,
      getMock,
    };
  }

  // Scenario 1 (downloadAttachment, EA-165): risolve i metadati completi dal catalogo di primo livello
  it("resolves the full attachment document from the top-level catalog", async () => {
    const { db } = buildDbMock({
      exists: true,
      data: () => ({ id: "att-1", description: "Fattura di acquisto" }),
    });

    const result = await getAttachmentById(db, "att-1");

    expect(result).toEqual({ id: "att-1", description: "Fattura di acquisto" });
  });

  it("returns null when the attachment does not exist", async () => {
    const { db } = buildDbMock({ exists: false, data: () => undefined });

    const result = await getAttachmentById(db, "missing-id");

    expect(result).toBeNull();
  });
});

describe("updateAttachmentFields", () => {
  const updateMock = jest.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    jest.clearAllMocks();
    updateMock.mockResolvedValue(undefined);
  });

  function buildDbMock() {
    const collectionMock = jest.fn((name: string) => {
      expect(name).toBe(ATTACHMENTS_COLLECTION);
      return { doc: jest.fn((id: string) => ({ id, update: updateMock })) };
    });

    return { collection: collectionMock } as unknown as import("firebase-admin/firestore").Firestore;
  }

  // Scenario 1/2: la modifica è persistita sul documento attachments/{attachmentId}
  it("updates the description field on the attachments/{attachmentId} document", async () => {
    const db = buildDbMock();

    await updateAttachmentFields(db, "att-1", { description: "Nuova descrizione" });

    expect(updateMock).toHaveBeenCalledWith({ description: "Nuova descrizione" });
  });

  it("also updates notes when explicitly provided", async () => {
    const db = buildDbMock();

    await updateAttachmentFields(db, "att-1", { description: "Nuova descrizione", notes: "Nuova nota" });

    expect(updateMock).toHaveBeenCalledWith({ description: "Nuova descrizione", notes: "Nuova nota" });
  });

  it("leaves notes untouched when not provided", async () => {
    const db = buildDbMock();

    await updateAttachmentFields(db, "att-1", { description: "Nuova descrizione" });

    const [fields] = updateMock.mock.calls[0];
    expect(fields).not.toHaveProperty("notes");
  });

  // Scenario 4: la descrizione resta il campo obbligatorio del modello dati
  it("throws when description is missing, without writing anything", async () => {
    const db = buildDbMock();

    await expect(
      updateAttachmentFields(db, "att-1", { description: "" })
    ).rejects.toThrow("description is required");

    expect(updateMock).not.toHaveBeenCalled();
  });

  it("throws when description is blank, without writing anything", async () => {
    const db = buildDbMock();

    await expect(
      updateAttachmentFields(db, "att-1", { description: "   " })
    ).rejects.toThrow("description is required");

    expect(updateMock).not.toHaveBeenCalled();
  });
});

describe("listAttachmentsForEntity", () => {
  const orderByMock = jest.fn();
  const indexGetMock = jest.fn();
  const getAllMock = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    orderByMock.mockReturnValue({ get: indexGetMock });
  });

  function buildDbMock() {
    const collectionMock = jest.fn((name: string) => {
      if (name === ATTACHMENTS_COLLECTION) {
        return { doc: jest.fn((id: string) => ({ __ref: id })) };
      }
      // collection dell'entità proprietaria (es. "deviceRequests"), opaca
      return {
        doc: jest.fn((entityId: string) => ({
          collection: jest.fn((subName: string) => {
            expect(subName).toBe(ATTACHMENT_INDEX_SUBCOLLECTION);
            expect(entityId).toBe("request-42");
            return { orderBy: orderByMock };
          }),
        })),
      };
    });

    return {
      collection: collectionMock,
      getAll: getAllMock,
    } as unknown as import("firebase-admin/firestore").Firestore;
  }

  function indexDoc(id: string) {
    return { id };
  }

  function attachmentSnap(id: string, exists = true) {
    return {
      exists,
      data: () => ({ id, description: `desc-${id}` }),
    };
  }

  // Scenario 1/2: elenco completo con metadati risolti dall'indice
  it("resolves the full attachment documents referenced by the entity's index subcollection", async () => {
    const db = buildDbMock();
    indexGetMock.mockResolvedValue({ empty: false, docs: [indexDoc("att-1"), indexDoc("att-2")] });
    getAllMock.mockResolvedValue([attachmentSnap("att-1"), attachmentSnap("att-2")]);

    const result = await listAttachmentsForEntity(db, "deviceRequests", "request-42");

    expect(orderByMock).toHaveBeenCalledWith("createdAt", "asc");
    expect(getAllMock).toHaveBeenCalledWith({ __ref: "att-1" }, { __ref: "att-2" });
    expect(result).toEqual([
      { id: "att-1", description: "desc-att-1" },
      { id: "att-2", description: "desc-att-2" },
    ]);
  });

  // Scenario 4: entità senza allegati -> elenco vuoto, senza errore, nessuna lettura batch
  it("returns an empty array without calling db.getAll when the index subcollection is empty", async () => {
    const db = buildDbMock();
    indexGetMock.mockResolvedValue({ empty: true, docs: [] });

    const result = await listAttachmentsForEntity(db, "deviceRequests", "request-42");

    expect(result).toEqual([]);
    expect(getAllMock).not.toHaveBeenCalled();
  });

  it("filters out an index entry whose attachment document no longer exists", async () => {
    const db = buildDbMock();
    indexGetMock.mockResolvedValue({ empty: false, docs: [indexDoc("att-1"), indexDoc("att-missing")] });
    getAllMock.mockResolvedValue([attachmentSnap("att-1"), attachmentSnap("att-missing", false)]);

    const result = await listAttachmentsForEntity(db, "deviceRequests", "request-42");

    expect(result).toEqual([{ id: "att-1", description: "desc-att-1" }]);
  });
});
