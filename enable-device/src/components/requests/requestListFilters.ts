import { useCallback, useEffect, useState } from "react";

/**
 * Modello di filtri condiviso dalle liste di richieste (admin e volontario).
 * Filtri "base" sempre visibili, filtri "estesi" in un pannello collassabile.
 */
export interface RequestListFilters {
  // base
  seqId: string;
  firstName: string;
  lastName: string;
  statuses: string[];
  // estesi
  requestNumber: string;
  recipient: string;
  province: string;
  assignedVolunteers: string;
  age: number | null;
  genders: string[];
  amputationTypes: string[];
  deviceTypes: string[];
  publicStatuses: string[];
  requiresAttention: boolean | null;
  // intervalli di date, formato locale "YYYY-MM-DD"
  createdFrom: string | null;
  createdTo: string | null;
  updatedFrom: string | null;
  updatedTo: string | null;
}

export const EMPTY_REQUEST_FILTERS: RequestListFilters = {
  seqId: "",
  firstName: "",
  lastName: "",
  statuses: [],
  requestNumber: "",
  recipient: "",
  province: "",
  assignedVolunteers: "",
  age: null,
  genders: [],
  amputationTypes: [],
  deviceTypes: [],
  publicStatuses: [],
  requiresAttention: null,
  createdFrom: null,
  createdTo: null,
  updatedFrom: null,
  updatedTo: null,
};

export const BASE_FILTER_KEYS: (keyof RequestListFilters)[] = [
  "seqId",
  "firstName",
  "lastName",
  "statuses",
];

export const EXTENDED_FILTER_KEYS: (keyof RequestListFilters)[] = [
  "requestNumber",
  "recipient",
  "age",
  "genders",
  "amputationTypes",
  "deviceTypes",
  "publicStatuses",
  "province",
  "assignedVolunteers",
  "requiresAttention",
  "createdFrom",
  "createdTo",
  "updatedFrom",
  "updatedTo",
];

export function isFilterActive(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

export function countActiveFilters(
  filters: RequestListFilters,
  keys: (keyof RequestListFilters)[] = [...BASE_FILTER_KEYS, ...EXTENDED_FILTER_KEYS]
): number {
  return keys.filter((k) => isFilterActive(filters[k])).length;
}

/** Data locale come "YYYY-MM-DD" (confronto lessicografico = confronto per giorno). */
export function toDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function fromDateKey(key: string | null): Date | null {
  if (!key) return null;
  const [y, m, d] = key.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

const contains = (value: unknown, needle: string): boolean => {
  const n = needle.trim().toLowerCase();
  return n === "" || String(value ?? "").toLowerCase().includes(n);
};

const inList = (value: unknown, list: string[]): boolean =>
  list.length === 0 || list.includes(String(value ?? ""));

const inRange = (value: unknown, from: string | null, to: string | null): boolean => {
  if (!from && !to) return true;
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return false;
  const key = toDateKey(value);
  if (from && key < from) return false;
  if (to && key > to) return false;
  return true;
};

/**
 * Applica i filtri alle righe già normalizzate (date come Date, publicStatus calcolato,
 * assignedVolunteersText derivato). Campi assenti nella riga non corrispondono ai filtri attivi.
 */
export function applyRequestFilters<T extends Record<string, unknown>>(
  rows: T[],
  f: RequestListFilters
): T[] {
  return rows.filter(
    (r) =>
      contains(r.seqId, f.seqId) &&
      contains(r.firstName, f.firstName) &&
      contains(r.lastName, f.lastName) &&
      inList(r.status, f.statuses) &&
      contains(r.requestNumber, f.requestNumber) &&
      contains(r.recipient, f.recipient) &&
      contains(r.province, f.province) &&
      contains(r.assignedVolunteersText, f.assignedVolunteers) &&
      (f.age === null || Number(r.age) === f.age) &&
      inList(r.gender, f.genders) &&
      inList(r.amputationType, f.amputationTypes) &&
      inList(r.deviceType, f.deviceTypes) &&
      inList(r.publicStatus, f.publicStatuses) &&
      (f.requiresAttention === null || Boolean(r.requiresAttention) === f.requiresAttention) &&
      inRange(r.createdAt, f.createdFrom, f.createdTo) &&
      inRange(r.updatedAt, f.updatedFrom, f.updatedTo)
  );
}

function loadFilters(storageKey: string): RequestListFilters {
  try {
    const saved = sessionStorage.getItem(storageKey);
    if (!saved) return EMPTY_REQUEST_FILTERS;
    const parsed = JSON.parse(saved) as Partial<RequestListFilters>;
    const merged: Record<string, unknown> = { ...EMPTY_REQUEST_FILTERS };
    for (const key of Object.keys(EMPTY_REQUEST_FILTERS) as (keyof RequestListFilters)[]) {
      const candidate = parsed[key];
      const reference = EMPTY_REQUEST_FILTERS[key];
      if (candidate === undefined) continue;
      // accetta solo valori dello stesso tipo del default (stringhe, array, null/valore)
      if (Array.isArray(reference) ? Array.isArray(candidate) : typeof candidate === typeof reference || candidate === null) {
        merged[key] = candidate;
      }
    }
    return merged as unknown as RequestListFilters;
  } catch {
    return EMPTY_REQUEST_FILTERS;
  }
}

/**
 * Stato dei filtri persistito in sessionStorage: usare la stessa chiave in tutte le viste
 * dello stesso ruolo per mantenere i filtri al cambio di pagina/vista.
 */
export function useRequestListFilters(storageKey: string) {
  const [filters, setFilters] = useState<RequestListFilters>(() => loadFilters(storageKey));

  useEffect(() => {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(filters));
    } catch {
      // sessionStorage non disponibile
    }
  }, [filters, storageKey]);

  const setFilter = useCallback(
    <K extends keyof RequestListFilters>(key: K, value: RequestListFilters[K]) =>
      setFilters((prev) => ({ ...prev, [key]: value })),
    []
  );

  const reset = useCallback(() => setFilters(EMPTY_REQUEST_FILTERS), []);

  return { filters, setFilter, reset };
}

/** Colonne visibili, persistite in sessionStorage (chiave condivisa tra le viste). */
export function useVisibleColumns(
  storageKey: string,
  allKeys: string[],
  defaultKeys: string[]
) {
  const [visible, setVisible] = useState<string[]>(() => {
    try {
      const saved = sessionStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed.filter((k) => allKeys.includes(k));
      }
    } catch {
      /* ignore */
    }
    return defaultKeys;
  });

  const update = useCallback(
    (keys: string[]) => {
      setVisible(keys);
      try {
        sessionStorage.setItem(storageKey, JSON.stringify(keys));
      } catch {
        /* ignore */
      }
    },
    [storageKey]
  );

  return [visible, update] as const;
}
