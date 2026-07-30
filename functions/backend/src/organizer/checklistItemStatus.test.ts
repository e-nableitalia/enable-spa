import {
  CHECKLIST_ITEM_STATUSES,
  isChecklistItemStatus,
  CHECKLIST_ITEM_TYPES,
  isChecklistItemType,
} from "./checklistItemStatus";

describe("CHECKLIST_ITEM_STATUSES", () => {
  // Scenario 1: costante centralizzata, unica fonte di verità per i 4 stati ammessi
  it("exposes exactly the 4 statuses of the v1 model", () => {
    expect(CHECKLIST_ITEM_STATUSES).toEqual(["Assegnare", "Da iniziare", "In corso", "Completata"]);
  });
});

describe("isChecklistItemStatus", () => {
  // Scenario 1: la validazione condivisa accetta i 4 valori ammessi
  it.each(CHECKLIST_ITEM_STATUSES)("returns true for the allowed status '%s'", (status) => {
    expect(isChecklistItemStatus(status)).toBe(true);
  });

  // Scenario 1: la validazione condivisa rifiuta valori non tra i 4 ammessi
  it("returns false for a value not among the 4 allowed statuses", () => {
    expect(isChecklistItemStatus("Non valido")).toBe(false);
  });

  it("returns false for non-string values", () => {
    expect(isChecklistItemStatus(undefined)).toBe(false);
    expect(isChecklistItemStatus(null)).toBe(false);
    expect(isChecklistItemStatus(42)).toBe(false);
  });
});

describe("CHECKLIST_ITEM_TYPES", () => {
  // Scenario 2: il modulo condiviso espone i 3 type ammessi dal futuro discriminante
  it("exposes exactly 'boolean' | 'generic' | 'numeric'", () => {
    expect(CHECKLIST_ITEM_TYPES).toEqual(["boolean", "generic", "numeric"]);
  });
});

describe("isChecklistItemType", () => {
  // Scenario 2: la funzione di validazione del type è riusabile e accetta i 3 valori ammessi
  it.each(CHECKLIST_ITEM_TYPES)("returns true for the allowed type '%s'", (type) => {
    expect(isChecklistItemType(type)).toBe(true);
  });

  // Scenario 2: la funzione di validazione del type rifiuta valori non ammessi
  it("returns false for a value not among the allowed types", () => {
    expect(isChecklistItemType("string")).toBe(false);
  });

  it("returns false for non-string values", () => {
    expect(isChecklistItemType(undefined)).toBe(false);
    expect(isChecklistItemType(null)).toBe(false);
    expect(isChecklistItemType(true)).toBe(false);
  });
});
