import "@testing-library/jest-dom/vitest";

// jsdom does not implement ResizeObserver — stub it globally for component tests.
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};
