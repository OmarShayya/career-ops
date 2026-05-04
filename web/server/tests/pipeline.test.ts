import { describe, it, expect } from "vitest";
import { validateTransition, KANBAN_COLUMNS } from "../src/modules/pipeline/service.js";

describe("validateTransition", () => {
  it("allows Evaluated → Applied", () => { expect(validateTransition("Evaluated", "Applied")).toBe(true); });
  it("allows Applied → Interview", () => { expect(validateTransition("Applied", "Interview")).toBe(true); });
  it("allows Interview → Offer", () => { expect(validateTransition("Interview", "Offer")).toBe(true); });
  it("allows any status → Rejected", () => {
    expect(validateTransition("Applied", "Rejected")).toBe(true);
    expect(validateTransition("Interview", "Rejected")).toBe(true);
  });
  it("allows any status → Discarded", () => {
    expect(validateTransition("Evaluated", "Discarded")).toBe(true);
    expect(validateTransition("Applied", "Discarded")).toBe(true);
  });
  it("allows any status → SKIP", () => { expect(validateTransition("Evaluated", "SKIP")).toBe(true); });
  it("rejects Offer → Evaluated (backwards)", () => { expect(validateTransition("Offer", "Evaluated")).toBe(false); });
  it("rejects same → same", () => { expect(validateTransition("Applied", "Applied")).toBe(false); });
});

describe("KANBAN_COLUMNS", () => {
  it("has the 5 active columns in order", () => {
    expect(KANBAN_COLUMNS).toEqual(["Evaluated", "Applied", "Responded", "Interview", "Offer"]);
  });
});
