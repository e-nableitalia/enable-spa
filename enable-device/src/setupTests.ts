import "@testing-library/jest-dom/vitest";

// PrimeReact's overlay focus management calls scrollIntoView, unimplemented in jsdom.
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});
