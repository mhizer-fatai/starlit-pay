import { describe, expect, test } from "vitest";
import { activityTitle, buildActivityFeed } from "@/lib/wallet";
import type { BackendTransaction } from "@/lib/backend";

const WALLET = "CAVA5JIZM3V4T23OJMGJREM34MFVVSFJKA55RK3UBPTSZWZ2SS77I54E";
const record = (id: string, payload: Record<string, unknown>) =>
  ({ id, created_at: new Date().toISOString(), encrypted_payload: btoa(JSON.stringify(payload)) }) as BackendTransaction;

describe("transfers between the user's own balances", () => {
  test("are labelled as transfers, with the right direction", () => {
    const feed = buildActivityFeed(
      [],
      [
        record("1", { to: WALLET, amount: 55, asset: "XLM", type: "withdraw", transfer: "to-public" }),
        record("2", { from: "public wallet", amount: 5, asset: "USDC", type: "deposit", transfer: "to-private" }),
        record("3", { to: WALLET, amount: 33, asset: "USDC", type: "withdraw" }), // older record, before the flag
        record("4", { to: "GCDQQE7CPLIGMAH4QEB2SSIEAS5MZMFSQAYSEJYSF7P5ZLA6HOU4BWWY", amount: 1, asset: "XLM" }),
      ],
      "alice",
      WALLET
    );
    const byKey = Object.fromEntries(feed.map((item) => [item.key, item]));
    expect(activityTitle(byKey["tx-1"]!)).toBe("Transfer to public wallet");
    expect(byKey["tx-1"]!.direction).toBe("out");
    expect(activityTitle(byKey["tx-2"]!)).toBe("Transfer from public wallet");
    expect(byKey["tx-2"]!.direction).toBe("in");
    expect(activityTitle(byKey["tx-3"]!)).toBe("Transfer to public wallet");
    expect(activityTitle(byKey["tx-4"]!)).toBe("Sent to GCDQ…BWWY");
  });
});
