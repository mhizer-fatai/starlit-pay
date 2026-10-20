import { describe, expect, test } from "vitest";
import { isStellarAddress } from "@/lib/stellar";

describe("isStellarAddress", () => {
  test("accepts accounts (G…) and contracts such as smart wallets (C…)", () => {
    expect(isStellarAddress("GCDQQE7CPLIGMAH4QEB2SSIEAS5MZMFSQAYSEJYSF7P5ZLA6HOU4BWWY")).toBe(true);
    expect(isStellarAddress("CC7EKIHQP3TN4CARQDND6CEOY2UXLWWC2X5GHTD5NLAT7BG5GPZIOM3F")).toBe(true);
  });

  test("rejects bad checksums, secret keys and junk", () => {
    expect(isStellarAddress("GCDQQE7CPLIGMAH4QEB2SSIEAS5MZMFSQAYSEJYSF7P5ZLA6HOU4BWWA")).toBe(false);
    expect(isStellarAddress("SCDQQE7CPLIGMAH4QEB2SSIEAS5MZMFSQAYSEJYSF7P5ZLA6HOU4BWWY")).toBe(false);
    expect(isStellarAddress("alice")).toBe(false);
  });
});
