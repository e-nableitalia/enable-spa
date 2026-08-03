import {
  isChecklistItemComplete,
  isChecklistComplete,
  ChecklistItemLike,
} from "./checklistCompleteness";

function buildItem(overrides: Partial<ChecklistItemLike> = {}): ChecklistItemLike {
  return {
    type: "generic",
    assignee: "Mario Rossi",
    quantity: 3,
    status: "Completata",
    completed: false,
    ...overrides,
  };
}

describe("isChecklistItemComplete", () => {
  describe("type='boolean'", () => {
    // Scenario 1: item boolean con assignee e completed=true è completo
    it("returns true when assignee is set and completed is true, regardless of status and quantity", () => {
      const item = buildItem({
        type: "boolean",
        completed: true,
        status: "Assegnare",
        quantity: null,
      });
      expect(isChecklistItemComplete(item)).toBe(true);
    });

    it("returns false when completed is false", () => {
      expect(
        isChecklistItemComplete(buildItem({ type: "boolean", completed: false }))
      ).toBe(false);
    });

    it("returns false when completed is undefined", () => {
      expect(
        isChecklistItemComplete(buildItem({ type: "boolean", completed: undefined }))
      ).toBe(false);
    });

    it("returns false when assignee is missing even if completed is true", () => {
      expect(
        isChecklistItemComplete(buildItem({ type: "boolean", completed: true, assignee: null }))
      ).toBe(false);
    });
  });

  describe("type='generic'", () => {
    // Scenario 2: item generic con status 'Da iniziare' o 'In corso' NON è completo (fix del bug)
    it.each(["Da iniziare", "In corso"])(
      "returns false when status is '%s' (previously treated as complete)",
      (status) => {
        expect(
          isChecklistItemComplete(buildItem({ type: "generic", status }))
        ).toBe(false);
      }
    );

    // Scenario 3: item generic con status 'Completata' è completo
    it("returns true when assignee is set and status is 'Completata'", () => {
      expect(
        isChecklistItemComplete(buildItem({ type: "generic", status: "Completata" }))
      ).toBe(true);
    });

    it("returns false when status is still 'Assegnare'", () => {
      expect(
        isChecklistItemComplete(buildItem({ type: "generic", status: "Assegnare" }))
      ).toBe(false);
    });

    it("returns false when assignee is missing", () => {
      expect(
        isChecklistItemComplete(buildItem({ type: "generic", assignee: null }))
      ).toBe(false);
    });

    it("ignores quantity entirely (complete even if quantity is null or absent)", () => {
      expect(
        isChecklistItemComplete(buildItem({ type: "generic", quantity: null }))
      ).toBe(true);
      const withoutQuantity: ChecklistItemLike = {
        type: "generic",
        assignee: "Mario Rossi",
        status: "Completata",
      };
      expect(isChecklistItemComplete(withoutQuantity)).toBe(true);
    });
  });

  describe("type='numeric'", () => {
    // Scenario 4: item numeric con quantity non valorizzata NON è completo
    it("returns false when quantity is null", () => {
      expect(
        isChecklistItemComplete(buildItem({ type: "numeric", status: "Completata", quantity: null }))
      ).toBe(false);
    });

    it("returns false when quantity is entirely absent", () => {
      const item: ChecklistItemLike = {
        type: "numeric",
        assignee: "Mario Rossi",
        status: "Completata",
      };
      expect(isChecklistItemComplete(item)).toBe(false);
    });

    // Scenario 5: item numeric con quantity valorizzata è completo
    it("returns true when assignee is set, status is 'Completata' and quantity is set", () => {
      expect(
        isChecklistItemComplete(buildItem({ type: "numeric", status: "Completata", quantity: 5 }))
      ).toBe(true);
    });

    it("returns true when quantity is explicitly 0", () => {
      expect(
        isChecklistItemComplete(buildItem({ type: "numeric", status: "Completata", quantity: 0 }))
      ).toBe(true);
    });

    it("returns false when status is not 'Completata' even if quantity is set", () => {
      expect(
        isChecklistItemComplete(buildItem({ type: "numeric", status: "In corso", quantity: 5 }))
      ).toBe(false);
    });

    it("returns false when assignee is missing", () => {
      expect(
        isChecklistItemComplete(
          buildItem({ type: "numeric", status: "Completata", quantity: 5, assignee: null })
        )
      ).toBe(false);
    });
  });

  describe("type assente o non riconosciuto (item legacy pre-EA-123)", () => {
    it("falls back to the 'generic' calculation when type is undefined", () => {
      const completeItem: ChecklistItemLike = { assignee: "Mario Rossi", status: "Completata" };
      expect(isChecklistItemComplete(completeItem)).toBe(true);

      const inProgressItem: ChecklistItemLike = { assignee: "Mario Rossi", status: "In corso" };
      expect(isChecklistItemComplete(inProgressItem)).toBe(false);
    });

    it("falls back to the 'generic' calculation for an unrecognized type value", () => {
      expect(
        isChecklistItemComplete(buildItem({ type: "unknown-type", status: "Completata" }))
      ).toBe(true);
      expect(
        isChecklistItemComplete(buildItem({ type: "unknown-type", status: "In corso" }))
      ).toBe(false);
    });
  });
});

describe("isChecklistComplete", () => {
  // Scenario: checklist senza item è considerata completa
  it("returns true for an empty list of items", () => {
    expect(isChecklistComplete([])).toBe(true);
  });

  // Scenario: checklist completa quando tutti gli item sono completi, tipi misti
  it("returns true when all items are complete across mixed types", () => {
    const items = [
      buildItem({ type: "boolean", completed: true }),
      buildItem({ type: "generic", status: "Completata" }),
      buildItem({ type: "numeric", status: "Completata", quantity: 2 }),
    ];
    expect(isChecklistComplete(items)).toBe(true);
  });

  // Scenario: checklist incompleta quando almeno un item non è completo
  it("returns false when at least one item is incomplete", () => {
    const items = [
      buildItem({ type: "generic", status: "Completata" }),
      buildItem({ type: "generic", status: "In corso" }),
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
