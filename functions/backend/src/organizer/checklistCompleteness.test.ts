import {
  isChecklistItemComplete,
  isChecklistComplete,
  ChecklistItemLike,
} from "./checklistCompleteness";

function buildItem(overrides: Partial<ChecklistItemLike> = {}): ChecklistItemLike {
  return {
    assignee: "Mario Rossi",
    quantity: 3,
    status: "Da iniziare",
    ...overrides,
  };
}

describe("isChecklistItemComplete", () => {
  // Scenario: item completo con assegnatario, quantità e stato avanzato
  it("returns true when assignee is set, quantity is set and status is not the initial one", () => {
    expect(isChecklistItemComplete(buildItem())).toBe(true);
  });

  // Scenario: assegnatario mancante (null)
  it("returns false when assignee is null", () => {
    expect(isChecklistItemComplete(buildItem({ assignee: null }))).toBe(false);
  });

  // Scenario: assegnatario mancante (undefined)
  it("returns false when assignee is undefined", () => {
    expect(isChecklistItemComplete(buildItem({ assignee: undefined }))).toBe(false);
  });

  // Scenario: assegnatario stringa vuota
  it("returns false when assignee is an empty string", () => {
    expect(isChecklistItemComplete(buildItem({ assignee: "" }))).toBe(false);
  });

  // Scenario: assegnatario solo whitespace
  it("returns false when assignee is a whitespace-only string", () => {
    expect(isChecklistItemComplete(buildItem({ assignee: "   " }))).toBe(false);
  });

  // Scenario: campo quantità presente ma non valorizzato (null) -> incompleto
  it("returns false when the quantity field is present but null", () => {
    expect(isChecklistItemComplete(buildItem({ quantity: null }))).toBe(false);
  });

  // Scenario: campo quantità assente -> non rilevante, non blocca il completamento
  it("returns true when the quantity field is entirely absent from the item", () => {
    const item: ChecklistItemLike = {
      assignee: "Mario Rossi",
      status: "Da iniziare",
    };
    expect(isChecklistItemComplete(item)).toBe(true);
  });

  // Scenario: quantità valorizzata a 0 è comunque un valore valido
  it("returns true when quantity is explicitly set to 0", () => {
    expect(isChecklistItemComplete(buildItem({ quantity: 0 }))).toBe(true);
  });

  // Scenario: stato ancora "Assegnare" (stato iniziale) -> incompleto
  it("returns false when status is still 'Assegnare'", () => {
    expect(isChecklistItemComplete(buildItem({ status: "Assegnare" }))).toBe(false);
  });

  // Scenario: stato "In corso" o "Completata" -> soddisfa il criterio di stato
  it.each(["In corso", "Completata"])(
    "returns true when status is '%s' and other fields are valid",
    (status) => {
      expect(isChecklistItemComplete(buildItem({ status }))).toBe(true);
    }
  );
});

describe("isChecklistComplete", () => {
  // Scenario: checklist senza item è considerata completa
  it("returns true for an empty list of items", () => {
    expect(isChecklistComplete([])).toBe(true);
  });

  // Scenario: checklist completa quando tutti gli item sono completi
  it("returns true when all items are complete", () => {
    const items = [
      buildItem(),
      buildItem({ quantity: undefined, status: "Completata" }),
    ];
    expect(isChecklistComplete(items)).toBe(true);
  });

  // Scenario: checklist incompleta quando almeno un item non è completo
  it("returns false when at least one item is incomplete", () => {
    const items = [
      buildItem(),
      buildItem({ assignee: null }),
    ];
    expect(isChecklistComplete(items)).toBe(false);
  });

  // Regression: non muta gli item forniti in input (nessun side effect)
  it("does not mutate the provided items", () => {
    const items = [buildItem({ assignee: null })];
    const snapshot = JSON.parse(JSON.stringify(items));

    isChecklistComplete(items);

    expect(items).toEqual(snapshot);
  });
});
