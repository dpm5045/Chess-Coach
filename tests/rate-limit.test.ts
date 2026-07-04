import { describe, it, expect } from "vitest";
import { allowRequest } from "@/lib/rate-limit";

describe("allowRequest", () => {
  it("allows up to the limit within a window, then blocks", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 5; i++) {
      expect(allowRequest("k1", 5, 60_000, t0 + i)).toBe(true);
    }
    expect(allowRequest("k1", 5, 60_000, t0 + 10)).toBe(false);
  });

  it("frees slots after the window expires", () => {
    const t0 = 2_000_000;
    for (let i = 0; i < 3; i++) allowRequest("k2", 3, 1_000, t0);
    expect(allowRequest("k2", 3, 1_000, t0 + 500)).toBe(false);
    expect(allowRequest("k2", 3, 1_000, t0 + 1_001)).toBe(true);
  });

  it("tracks keys independently", () => {
    const t0 = 3_000_000;
    allowRequest("k3", 1, 60_000, t0);
    expect(allowRequest("k3", 1, 60_000, t0)).toBe(false);
    expect(allowRequest("k4", 1, 60_000, t0)).toBe(true);
  });
});
