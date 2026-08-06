import { HttpsError } from "firebase-functions/v2/https";
import { normalizeTemplateItem } from "./templateItem";

describe("normalizeTemplateItem", () => {
  // Scenario: oggetto con title e type - comportamento invariato
  it("returns a TemplateItem for an object with title, type and quantity", () => {
    expect(normalizeTemplateItem({ title: "Vite M3", type: "numeric", quantity: 4 })).toEqual({
      title: "Vite M3",
      type: "numeric",
      quantity: 4,
    });
  });

  it("defaults quantity to null when omitted", () => {
    expect(normalizeTemplateItem({ title: "Vite M3", type: "generic" })).toEqual({
      title: "Vite M3",
      type: "generic",
      quantity: null,
    });
  });

  // Scenario: shorthand a stringa rimosso (EA-144)
  it("throws invalid-argument when the item is a bare string", () => {
    expect(() => normalizeTemplateItem("Vite M3")).toThrow(
      new HttpsError("invalid-argument", "Each item must be a string or an object with a title")
    );
  });

  it("throws invalid-argument when the item is neither a string nor an object", () => {
    expect(() => normalizeTemplateItem(42)).toThrow(
      new HttpsError("invalid-argument", "Each item must be a string or an object with a title")
    );
    expect(() => normalizeTemplateItem(null)).toThrow(
      new HttpsError("invalid-argument", "Each item must be a string or an object with a title")
    );
  });

  it("throws invalid-argument when title is missing or empty", () => {
    expect(() => normalizeTemplateItem({ type: "numeric" })).toThrow(
      new HttpsError("invalid-argument", "Each item must have a non-empty title")
    );
    expect(() => normalizeTemplateItem({ title: "   ", type: "numeric" })).toThrow(
      new HttpsError("invalid-argument", "Each item must have a non-empty title")
    );
  });

  it("throws invalid-argument when type is missing or not among the allowed values", () => {
    expect(() => normalizeTemplateItem({ title: "Vite M3" })).toThrow(
      new HttpsError("invalid-argument", "Each item must have a valid type ('boolean' | 'generic' | 'numeric')")
    );
    expect(() => normalizeTemplateItem({ title: "Vite M3", type: "unknown-type" })).toThrow(
      new HttpsError("invalid-argument", "Each item must have a valid type ('boolean' | 'generic' | 'numeric')")
    );
  });

  it("throws invalid-argument when quantity is provided but not a number", () => {
    expect(() => normalizeTemplateItem({ title: "Vite M3", type: "numeric", quantity: "4" })).toThrow(
      new HttpsError("invalid-argument", "Item quantity must be a number")
    );
  });
});
