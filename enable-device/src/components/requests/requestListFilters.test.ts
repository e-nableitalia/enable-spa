import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  EMPTY_REQUEST_FILTERS,
  applyRequestFilters,
  countActiveFilters,
  EXTENDED_FILTER_KEYS,
  toDateKey,
  fromDateKey,
  useRequestListFilters,
  useVisibleColumns,
} from "./requestListFilters";

const rows = [
  {
    id: "1", seqId: "A1", firstName: "Mario", lastName: "Rossi", status: "nuova", publicStatus: "in valutazione",
    age: 30, gender: "M", deviceType: "mano", province: "MI", requiresAttention: true,
    assignedVolunteersText: "Luca Bianchi", createdAt: new Date(2026, 0, 10, 15), updatedAt: new Date(2026, 1, 5),
  },
  {
    id: "2", seqId: "B2", firstName: "Anna", lastName: "Verdi", status: "completata", publicStatus: "completati",
    age: 8, gender: "F", deviceType: "braccio", province: "RM", requiresAttention: false,
    assignedVolunteersText: "", createdAt: new Date(2026, 2, 1), updatedAt: null,
  },
];

describe("applyRequestFilters", () => {
  it("senza filtri restituisce tutte le righe", () => {
    expect(applyRequestFilters(rows, EMPTY_REQUEST_FILTERS)).toHaveLength(2);
  });

  it("filtra per testo (contiene, case-insensitive) e combina i filtri in AND", () => {
    expect(applyRequestFilters(rows, { ...EMPTY_REQUEST_FILTERS, firstName: "mar" }).map((r) => r.id)).toEqual(["1"]);
    expect(applyRequestFilters(rows, { ...EMPTY_REQUEST_FILTERS, seqId: "b", lastName: "ver" }).map((r) => r.id)).toEqual(["2"]);
    expect(applyRequestFilters(rows, { ...EMPTY_REQUEST_FILTERS, firstName: "mar", lastName: "ver" })).toHaveLength(0);
  });

  it("filtra per liste multiple, età e attenzione", () => {
    expect(applyRequestFilters(rows, { ...EMPTY_REQUEST_FILTERS, statuses: ["completata"] }).map((r) => r.id)).toEqual(["2"]);
    expect(applyRequestFilters(rows, { ...EMPTY_REQUEST_FILTERS, age: 30 }).map((r) => r.id)).toEqual(["1"]);
    expect(applyRequestFilters(rows, { ...EMPTY_REQUEST_FILTERS, requiresAttention: false }).map((r) => r.id)).toEqual(["2"]);
    expect(applyRequestFilters(rows, { ...EMPTY_REQUEST_FILTERS, assignedVolunteers: "luca" }).map((r) => r.id)).toEqual(["1"]);
  });

  it("filtra per intervallo di date, estremi inclusi, escludendo le righe senza data", () => {
    const f = { ...EMPTY_REQUEST_FILTERS };
    expect(applyRequestFilters(rows, { ...f, createdFrom: "2026-01-10", createdTo: "2026-01-10" }).map((r) => r.id)).toEqual(["1"]);
    expect(applyRequestFilters(rows, { ...f, createdFrom: "2026-02-01" }).map((r) => r.id)).toEqual(["2"]);
    expect(applyRequestFilters(rows, { ...f, updatedFrom: "2026-01-01" }).map((r) => r.id)).toEqual(["1"]);
  });
});

describe("date helpers e conteggio", () => {
  it("toDateKey/fromDateKey sono inversi", () => {
    const d = new Date(2026, 10, 3);
    expect(toDateKey(d)).toBe("2026-11-03");
    expect(fromDateKey("2026-11-03")?.getTime()).toBe(d.getTime());
    expect(fromDateKey(null)).toBeNull();
  });

  it("conta solo i filtri attivi tra quelli indicati", () => {
    const f = { ...EMPTY_REQUEST_FILTERS, firstName: "x", province: "MI", deviceTypes: ["mano"] };
    expect(countActiveFilters(f, EXTENDED_FILTER_KEYS)).toBe(2);
    expect(countActiveFilters(EMPTY_REQUEST_FILTERS)).toBe(0);
  });
});

describe("persistenza in sessionStorage", () => {
  beforeEach(() => sessionStorage.clear());

  it("i filtri sopravvivono a un nuovo mount con la stessa chiave e si azzerano con reset", () => {
    const first = renderHook(() => useRequestListFilters("k"));
    act(() => first.result.current.setFilter("firstName", "Mario"));
    first.unmount();

    const second = renderHook(() => useRequestListFilters("k"));
    expect(second.result.current.filters.firstName).toBe("Mario");
    act(() => second.result.current.reset());
    expect(second.result.current.filters).toEqual(EMPTY_REQUEST_FILTERS);
  });

  it("ignora valori salvati di tipo errato", () => {
    sessionStorage.setItem("k", JSON.stringify({ firstName: 5, statuses: "x", province: "MI" }));
    const { result } = renderHook(() => useRequestListFilters("k"));
    expect(result.current.filters.firstName).toBe("");
    expect(result.current.filters.statuses).toEqual([]);
    expect(result.current.filters.province).toBe("MI");
  });

  it("le colonne visibili vengono persistite e filtrate sulle chiavi valide", () => {
    sessionStorage.setItem("c", JSON.stringify(["a", "zzz"]));
    const { result } = renderHook(() => useVisibleColumns("c", ["a", "b"], ["a", "b"]));
    expect(result.current[0]).toEqual(["a"]);
    act(() => result.current[1](["b"]));
    expect(JSON.parse(sessionStorage.getItem("c") as string)).toEqual(["b"]);
  });
});
