import { describe, it, expect } from "vitest";
import { categoryForMcc } from "@/lib/categorize/by-mcc";
import { MCC_TO_CATEGORY } from "@/lib/categorize/mcc-map";
import { CATEGORY_SLUGS } from "@/lib/seed/categories";

describe("categoryForMcc", () => {
  it.each([
    [5411, "groceries"],
    [5814, "restaurants"],
    [5541, "gas"],
    [5912, "health"],
    [4814, "telecom"],
    [4900, "utilities"],
    [8220, "education"],
    [7230, "services"],
    [5942, "shopping"],
    [5818, "subscriptions"],
    [4111, "transport"],
    [7832, "entertainment"],
    [4829, "transfers"],
    [6300, "fees"],
  ])("maps MCC %i → %s", (mcc, expected) => {
    expect(categoryForMcc(mcc)).toBe(expected);
  });

  it("returns null for unmapped MCC", () => {
    expect(categoryForMcc(1234)).toBeNull();
    expect(categoryForMcc(9999)).toBeNull();
    expect(categoryForMcc(0)).toBeNull();
  });

  it("returns null for null/undefined input", () => {
    expect(categoryForMcc(null)).toBeNull();
    expect(categoryForMcc(undefined)).toBeNull();
  });

  it("every mapped MCC produces a slug that exists in CATEGORY_SLUGS seed", () => {
    for (const slug of Object.values(MCC_TO_CATEGORY)) {
      expect(CATEGORY_SLUGS.has(slug)).toBe(true);
    }
  });
});
