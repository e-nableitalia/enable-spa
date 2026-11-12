import { useCallback, useEffect, useState } from "react";

/** Larghezza minima (px) sopra la quale e' possibile la vista lista + dettaglio affiancati. */
export const SPLIT_VIEW_MIN_WIDTH = 1200;

export type RequestsViewMode = "split" | "list";

const STORAGE_KEY = "requestsViewMode";

function loadMode(): RequestsViewMode {
  try {
    return localStorage.getItem(STORAGE_KEY) === "list" ? "list" : "split";
  } catch {
    return "split";
  }
}

function useIsDesktop(minWidth: number): boolean {
  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth >= minWidth : false
  );

  useEffect(() => {
    const onResize = () => setIsDesktop(window.innerWidth >= minWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [minWidth]);

  return isDesktop;
}

/**
 * Modalita' di presentazione delle liste di richieste (admin e volontario).
 * `splitView` e' vero solo se la risoluzione lo consente E l'utente non ha scelto la lista a tutta larghezza.
 * La scelta e' persistita e valida per tutte le viste.
 */
export function useRequestsViewMode() {
  const isDesktop = useIsDesktop(SPLIT_VIEW_MIN_WIDTH);
  const [viewMode, setViewModeState] = useState<RequestsViewMode>(loadMode);

  const setViewMode = useCallback((mode: RequestsViewMode) => {
    setViewModeState(mode);
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      /* ignore */
    }
  }, []);

  return { isDesktop, viewMode, setViewMode, splitView: isDesktop && viewMode === "split" };
}
