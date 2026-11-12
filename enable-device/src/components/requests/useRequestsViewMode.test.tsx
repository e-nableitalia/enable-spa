import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act, render, screen, fireEvent } from "@testing-library/react";
import { useRequestsViewMode } from "./useRequestsViewMode";
import RequestsViewModeToggle from "./RequestsViewModeToggle";

function setWidth(w: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: w });
}

describe("useRequestsViewMode", () => {
  beforeEach(() => localStorage.clear());

  it("lo split è attivo solo sopra la soglia di risoluzione", () => {
    setWidth(1000);
    expect(renderHook(() => useRequestsViewMode()).result.current.splitView).toBe(false);
    setWidth(1400);
    expect(renderHook(() => useRequestsViewMode()).result.current.splitView).toBe(true);
  });

  it("la scelta 'solo lista' è persistita e disattiva lo split anche su schermi larghi", () => {
    setWidth(1400);
    const first = renderHook(() => useRequestsViewMode());
    act(() => first.result.current.setViewMode("list"));
    expect(first.result.current.splitView).toBe(false);
    first.unmount();
    expect(renderHook(() => useRequestsViewMode()).result.current.viewMode).toBe("list");
  });
});

describe("RequestsViewModeToggle", () => {
  it("evidenzia la modalità corrente e notifica il cambio", () => {
    const calls: string[] = [];
    render(<RequestsViewModeToggle mode="split" onChange={(m) => calls.push(m)} />);
    expect(screen.getByRole("radio", { name: /Lista \+ dettaglio/ })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("radio", { name: /Solo lista/ }));
    expect(calls).toEqual(["list"]);
  });
});
