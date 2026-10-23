import { describe, expect, test } from "vitest";
import { activityTitle, buildActivityFeed, recentStarlitRecipients } from "@/lib/wallet";
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

describe("received payments in history", () => {
  test("a deposit stays listed after it was spent or re-shielded", () => {
    const feed = buildActivityFeed(
      [
        { commitment: "c1", amount: 5, asset: "USDC", createdAt: 2, sender: "GANULJEXAMPLE", spent: true },
        { commitment: "c2", amount: 5, asset: "USDC", createdAt: 3, sender: "alice", spent: false },
      ],
      [],
      "alice"
    );
    // c2 is the user's own re-shielded note (sender = self): not a new receipt.
    expect(feed.map((item) => item.key)).toEqual(["note-c1"]);
    expect(feed[0]!.direction).toBe("in");
  });
});

describe("recentStarlitRecipients", () => {
  test("lists Starlit usernames paid, newest first, once each, skipping addresses", () => {
    const at = (iso: string, payload: Record<string, unknown>) =>
      ({ id: iso, created_at: iso, encrypted_payload: btoa(JSON.stringify(payload)) }) as BackendTransaction;
    const txs = [
      at("2026-10-20T10:00:00Z", { to: "@bob", amount: 1, asset: "USDC" }),
      at("2026-10-23T10:00:00Z", { to: "@stunnermatins", amount: 3, asset: "USDC" }),
      at("2026-10-22T10:00:00Z", { to: "GCDQQE7CPLIGMAH4QEB2SSIEAS5MZMFSQAYSEJYSF7P5ZLA6HOU4BWWY", amount: 1, asset: "XLM" }),
      at("2026-10-21T10:00:00Z", { to: "@Bob", amount: 2, asset: "XLM" }),
    ];
    expect(recentStarlitRecipients(txs)).toEqual(["stunnermatins", "Bob"]);
  });
});
