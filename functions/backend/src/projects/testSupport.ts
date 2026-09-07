import type { CallableRequest } from "firebase-functions/v2/https";

/**
 * Mock Firestore condiviso dai test del modulo "projects" (EA-169/170) —
 * store in-memory per `users` e `projects` (con sotto-collezione `events`),
 * stesso principio dei mock ad hoc già usati per `device-requests`, ma
 * fattorizzato una sola volta perché qui il numero di Cloud Function che
 * condividono lo stesso RBAC/shape di documento è alto (12).
 */

export const usersStore: Record<string, Record<string, unknown> | undefined> = {};
export const projectsStore: Record<string, Record<string, unknown> | undefined> = {};
export const eventsStore: Record<string, Record<string, Record<string, unknown>>> = {};

let idCounter = 0;

export function resetProjectsTestSupport(): void {
  for (const k of Object.keys(usersStore)) delete usersStore[k];
  for (const k of Object.keys(projectsStore)) delete projectsStore[k];
  for (const k of Object.keys(eventsStore)) delete eventsStore[k];
  idCounter = 0;
}

function isArrayOp(value: unknown, op: "arrayUnion" | "arrayRemove"): value is { __op: string; values: unknown[] } {
  return !!value && typeof value === "object" && (value as { __op?: string }).__op === op;
}

function applyUpdate(current: Record<string, unknown>, updates: Record<string, unknown>): Record<string, unknown> {
  const result = { ...current };
  for (const [key, value] of Object.entries(updates)) {
    if (isArrayOp(value, "arrayUnion")) {
      const existing = Array.isArray(result[key]) ? (result[key] as unknown[]) : [];
      const merged = [...existing];
      for (const v of value.values) {
        if (!merged.some((m) => JSON.stringify(m) === JSON.stringify(v))) merged.push(v);
      }
      result[key] = merged;
    } else if (isArrayOp(value, "arrayRemove")) {
      const existing = Array.isArray(result[key]) ? (result[key] as unknown[]) : [];
      result[key] = existing.filter(
        (m) => !value.values.some((r) => JSON.stringify(r) === JSON.stringify(m))
      );
    } else {
      result[key] = value;
    }
  }
  return result;
}

export const projectUpdateMock = jest.fn((id: string, updates: Record<string, unknown>) => {
  projectsStore[id] = applyUpdate(projectsStore[id] ?? {}, updates);
  return Promise.resolve();
});

export const batchSetMock = jest.fn((ref: { __type: string; id: string; __projectId?: string }, data: Record<string, unknown>) => {
  if (ref.__type === "event" && ref.__projectId) {
    eventsStore[ref.__projectId] = eventsStore[ref.__projectId] ?? {};
    eventsStore[ref.__projectId][ref.id] = data;
  }
});
export const batchUpdateMock = jest.fn((ref: { __type: string; id: string }, updates: Record<string, unknown>) => {
  if (ref.__type === "project") {
    projectsStore[ref.id] = applyUpdate(projectsStore[ref.id] ?? {}, updates);
  }
});
export const batchCommitMock = jest.fn().mockResolvedValue(undefined);

function usersCollection() {
  return {
    doc: jest.fn((uid: string) => ({
      get: jest.fn(() =>
        Promise.resolve({ exists: usersStore[uid] !== undefined, data: () => usersStore[uid] })
      ),
    })),
    where: jest.fn((field: string, _op: string, value: unknown) => ({
      get: jest.fn(() => {
        const matches = Object.entries(usersStore).filter(
          ([, d]) => d !== undefined && (d as Record<string, unknown>)[field] === value
        );
        return Promise.resolve({ docs: matches.map(([id]) => ({ id })) });
      }),
      where: jest.fn((field2: string, _op2: string, value2: unknown) => ({
        get: jest.fn(() => {
          const matches = Object.entries(usersStore).filter(
            ([, d]) =>
              d !== undefined &&
              (d as Record<string, unknown>)[field] === value &&
              (d as Record<string, unknown>)[field2] === value2
          );
          return Promise.resolve({ docs: matches.map(([id]) => ({ id })) });
        }),
      })),
    })),
  };
}

function projectDocRef(id: string) {
  return {
    id,
    __type: "project" as const,
    get: jest.fn(() =>
      Promise.resolve({ exists: projectsStore[id] !== undefined, id, data: () => projectsStore[id] })
    ),
    set: jest.fn((data: Record<string, unknown>) => {
      projectsStore[id] = data;
      return Promise.resolve();
    }),
    update: jest.fn((updates: Record<string, unknown>) => projectUpdateMock(id, updates)),
    collection: jest.fn((name: string) => {
      if (name !== "events") throw new Error(`Unexpected subcollection ${name}`);
      return {
        doc: jest.fn(() => {
          idCounter += 1;
          return { id: `event-${idCounter}`, __type: "event" as const, __projectId: id };
        }),
      };
    }),
  };
}

function projectsCollection() {
  return {
    doc: jest.fn((id?: string) => {
      if (id) return projectDocRef(id);
      idCounter += 1;
      return projectDocRef(`generated-project-${idCounter}`);
    }),
    orderBy: jest.fn(() => ({
      get: jest.fn(() => {
        const docs = Object.entries(projectsStore)
          .filter(([, d]) => d !== undefined)
          .map(([id, d]) => ({ id, data: () => d }));
        return Promise.resolve({ docs });
      }),
    })),
  };
}

export const collectionMock = jest.fn((name: string) => {
  if (name === "users") return usersCollection();
  if (name === "projects") return projectsCollection();
  throw new Error(`Unexpected collection ${name}`);
});

export function firestoreMockModule() {
  return {
    getFirestore: jest.fn(() => ({
      collection: (name: string) => collectionMock(name),
      batch: jest.fn(() => ({ set: batchSetMock, update: batchUpdateMock, commit: batchCommitMock })),
    })),
    FieldValue: {
      serverTimestamp: jest.fn(() => "SERVER_TIMESTAMP"),
      arrayUnion: jest.fn((...values: unknown[]) => ({ __op: "arrayUnion", values })),
      arrayRemove: jest.fn((...values: unknown[]) => ({ __op: "arrayRemove", values })),
    },
  };
}

export function buildRequest(data: Record<string, unknown>, uid: string | null = "admin-1"): CallableRequest {
  return {
    auth: uid ? ({ uid } as CallableRequest["auth"]) : undefined,
    data,
    rawRequest: { headers: {} } as CallableRequest["rawRequest"],
  } as CallableRequest;
}

export function seedDefaultUsersAndProjects(): void {
  Object.assign(usersStore, {
    "admin-1": { role: "admin" },
    "volunteer-1": { role: "volunteer", active: true },
    "volunteer-inactive": { role: "volunteer", active: false },
  });
  Object.assign(projectsStore, {
    "proj-new": {
      title: "Progetto nuovo",
      description: "desc",
      projectType: "progetto",
      status: "new",
      checklists: [],
      createdBy: "admin-1",
    },
    "proj-active": {
      title: "Progetto attivo",
      description: "desc",
      projectType: "evento",
      status: "active",
      checklists: [{ checklistId: "checklist-1", label: "Fase 1" }],
      createdBy: "admin-1",
    },
    "proj-standby": {
      title: "Progetto in standby",
      description: "desc",
      projectType: "iniziativa",
      status: "standby",
      checklists: [{ checklistId: "checklist-2", label: "Fase 1" }],
      createdBy: "admin-1",
    },
    "proj-archived": {
      title: "Progetto archiviato",
      description: "desc",
      projectType: "progetto",
      status: "archived",
      checklists: [],
      createdBy: "admin-1",
    },
    "proj-closed": {
      title: "Progetto chiuso",
      description: "desc",
      projectType: "progetto",
      status: "closed",
      checklists: [],
      createdBy: "admin-1",
    },
  });
}
