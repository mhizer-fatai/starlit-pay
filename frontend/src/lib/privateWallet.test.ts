import { beforeEach, describe, expect, test, vi } from "vitest";

// Tests run in Node: the SDK's progress events go to `window`.
vi.stubGlobal("window", new EventTarget());

const signedBy: string[] = [];
let lastSigner: { sign(xdr: string): Promise<unknown> } | null = null;
let freed = 0;

const pool = {
  balance: vi.fn(),
  fee: vi.fn(),
  deposit: vi.fn(),
  maxSpend: vi.fn(),
  estimate: vi.fn(),
  transferToKeys: vi.fn(),
  withdraw: vi.fn(),
  notes: vi.fn(),
};
vi.mock("@/lib/wallet", async (original) => ({ ...(await original<object>()), loadPrivateBalances: vi.fn() }));
vi.mock("@/lib/zkHistory", () => ({
  createdLeavesOrNone: async () => [7, 8],
  ledgerTime: async (ledger: number) => ledger * 1000,
  leafKey: (asset: string, leaf: number) => `${asset}:${leaf}`,
}));
vi.mock("@/lib/backend", () => ({ fetchZkDeposits: vi.fn(), signZkDeposit: vi.fn(), lookupUser: vi.fn(), postTransaction: vi.fn(), BackendError: class extends Error {} }));
vi.mock("@/lib/auth", () => ({ getUnlockedKeys: () => ({ stellar: { secretKey: "S-test" } }), getUser: async () => ({ id: "u1" }) }));
class RecipientKeysError extends Error {}
vi.mock("@/lib/privatePool", () => ({
  RecipientKeysError,
  openPrivateSession: async () => ({
    sync: async () => undefined,
    pool: async () => pool,
    poolSignedBy: async (_asset: string, signer: { address(): Promise<string>; sign(xdr: string): Promise<unknown> }) => {
      signedBy.push(await signer.address());
      lastSigner = signer;
      return { pool, free: () => freed++ };
    },
  }),
  recipientKeys: async (username: string) => ({ username, noteKey: "0xnote", encryptionKey: "0xenc" }),
}));

const { completeArrivals, fromBaseUnits, loadArrivals, loadZkNotes, PartialPaymentError, progressMessage, sendZkPayment, toBaseUnits } = await import("@/lib/privateWallet");

describe("amounts", () => {
  test("converts to 7-decimal base units exactly", () => {
    expect(toBaseUnits("1")).toBe(10_000_000n);
    expect(toBaseUnits("0.0000001")).toBe(1n);
    expect(toBaseUnits(" 12.5 ")).toBe(125_000_000n);
    expect(fromBaseUnits(2_900_000n)).toBe(0.29);
  });

  test("refuses zero, negatives, too many decimals and junk", () => {
    for (const bad of ["0", "-1", "1.00000001", "1e5", "abc", ""]) expect(() => toBaseUnits(bad)).toThrow();
  });
});

test("progress reads plainly, with steps only when there are several", () => {
  expect(progressMessage({ stage: "prove", current: 1, total: 1 })).toBe("Securing your payment…");
  expect(progressMessage({ stage: "submit", current: 2, total: 3 })).toBe("Sending (step 2 of 3)…");
});

describe("sendZkPayment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pool.balance.mockResolvedValue(5_000_000n);
    pool.maxSpend.mockResolvedValue(4_900_000n);
    pool.estimate.mockResolvedValue({ fees: "100000", txCount: 1 });
    pool.transferToKeys.mockResolvedValue({ status: "ok", hashes: ["h1"] });
    pool.withdraw.mockResolvedValue({ status: "ok", hashes: ["h2"] });
  });

  test("pays a user to their verified keys", async () => {
    const result = await sendZkPayment({ asset: "XLM", amount: "0.2", to: { kind: "user", username: "bob" } });
    expect(pool.transferToKeys).toHaveBeenCalledWith("0xnote", "0xenc", 2_000_000n);
    expect(result).toEqual({ hashes: ["h1"], fees: 0.01, leaves: [7, 8] });
  });

  test("withdraws to a public address", async () => {
    await sendZkPayment({ asset: "XLM", amount: "0.1", to: { kind: "address", address: "GABC" } });
    expect(pool.withdraw).toHaveBeenCalledWith(1_000_000n, "GABC");
  });

  test("refuses more than the balance allows before sending anything", async () => {
    await expect(sendZkPayment({ asset: "XLM", amount: "0.5", to: { kind: "user", username: "bob" } })).rejects.toThrow(/at most 0.49 XLM/);
    expect(pool.transferToKeys).not.toHaveBeenCalled();
  });

  test("says plainly when only part of a payment went through", async () => {
    pool.transferToKeys.mockResolvedValue({ status: "failed", hashes: ["h1"], message: "boom" });
    await expect(sendZkPayment({ asset: "XLM", amount: "0.2", to: { kind: "user", username: "bob" } })).rejects.toBeInstanceOf(PartialPaymentError);
    pool.transferToKeys.mockResolvedValue({ status: "failed", hashes: [], message: "pool said no" });
    await expect(sendZkPayment({ asset: "XLM", amount: "0.2", to: { kind: "user", username: "bob" } })).rejects.toThrow("pool said no");
  });

  test("forwards the SDK's progress while paying, and stops listening after", async () => {
    const seen: string[] = [];
    pool.transferToKeys.mockImplementation(async () => {
      window.dispatchEvent(new CustomEvent("stellar-private-payments:tx-progress", { detail: { flow: "transfer", stage: "prove", current: 1, total: 1 } }));
      return { status: "ok", hashes: ["h1"] };
    });
    await sendZkPayment({ asset: "XLM", amount: "0.2", to: { kind: "user", username: "bob" } }, (m) => seen.push(m));
    expect(seen).toEqual(["Getting ready…", "Securing your payment…"]);
    window.dispatchEvent(new CustomEvent("stellar-private-payments:tx-progress", { detail: { stage: "prove" } }));
    expect(seen).toHaveLength(2);
  });
});

describe("arrivals", () => {
  const credits = (deposits: object[]) => async () => ({ gateway: "GGATEWAY", deposits }) as never;

  beforeEach(() => {
    vi.clearAllMocks();
    signedBy.length = 0;
    freed = 0;
    pool.fee.mockResolvedValue(100_000n);
    pool.deposit.mockResolvedValue({ status: "ok", hashes: ["d1"] });
  });

  test("totals what is still arriving, per asset", async () => {
    const fetchCredits = credits([
      { id: "a:0", amount: "2.5000000", asset: "XLM", status: "credited" },
      { id: "b:0", amount: "1.0000000", asset: "XLM", status: "claiming" },
      { id: "c:0", amount: "10.0000000", asset: "USDC", status: "credited" },
    ]);
    expect(await loadArrivals({ fetchCredits })).toEqual({ xlm: 3.5, usdc: 10 });
  });

  test("deposits each credit as the gateway, pulling exactly the amount received", async () => {
    const signDeposit = vi.fn(async () => ({ signedTxXdr: "signed" }));
    const fetchCredits = credits([
      { id: "a:0", amount: "2.5000000", asset: "XLM", status: "credited" },
      { id: "b:0", amount: "1.0000000", asset: "XLM", status: "claiming" },
    ]);
    expect(await completeArrivals(() => {}, { fetchCredits, signDeposit })).toBe(1);
    // The pool adds its 0.01 fee on top: 2.49 + 0.01 = the 2.5 received.
    expect(pool.deposit).toHaveBeenCalledWith(24_900_000n);
    expect(signedBy).toEqual(["GGATEWAY"]);
    await lastSigner!.sign("xdr");
    expect(signDeposit).toHaveBeenCalledWith("a:0", "xdr");
    expect(freed).toBe(1);
  });

  test("a failed deposit stays a credit for next time, and runs never overlap", async () => {
    pool.deposit.mockRejectedValueOnce(new Error("offline"));
    const fetchCredits = credits([{ id: "a:0", amount: "2.5000000", asset: "XLM", status: "credited" }]);
    const first = completeArrivals(() => {}, { fetchCredits });
    expect(completeArrivals(() => {}, { fetchCredits })).toBe(first);
    expect(await first).toBe(0);
    expect(freed).toBe(1);
  });
});

describe("history on the real-ZK pools", () => {
  const record = (payload: object) => ({ id: "r", user_id: "u1", encrypted_payload: btoa(JSON.stringify(payload)), created_at: "2026-11-07T00:00:00Z" });
  const note = (leafIndex: number, amount: string, spent = false) => ({ id: `n${leafIndex}`, leafIndex, amount, createdAtLedger: 100 + leafIndex, spent });

  test("own change is marked as the user's, completed arrivals as deposits, the rest as received", async () => {
    pool.notes.mockImplementation(async () => [note(3, "2000000"), note(7, "4900000", true), note(18, "4900000")]);
    const txs = [
      record({ to: "@bob", amount: 0.2, asset: "XLM", type: "send", leaves: [6, 7] }),
      record({ amount: 0.49, asset: "XLM", type: "arrival", leaves: [18, 19] }),
    ];
    const notes = await loadZkNotes({ id: "u1", username: "alice" } as never, undefined, txs as never);
    const xlm = notes.filter((n) => n.asset === "XLM");
    expect(xlm.map((n) => [n.commitment, n.sender, n.amount, n.spent])).toEqual([
      ["n3", undefined, 0.2, false], // someone paid alice
      ["n7", "alice", 0.49, true], // her change: the feed leaves it out
      ["n18", "deposit", 0.49, false], // a gateway arrival she completed
    ]);
    expect(xlm[0].createdAt).toBe(103_000);
  });

  test("a completed arrival is recorded with the notes it created", async () => {
    pool.fee.mockResolvedValue(100_000n);
    pool.deposit.mockResolvedValue({ status: "ok", hashes: ["d1"] });
    const record = vi.fn(async () => undefined);
    const fetchCredits = async () => ({ gateway: "G", deposits: [{ id: "a:0", amount: "0.5000000", asset: "XLM", status: "credited" }] }) as never;
    await completeArrivals(() => {}, { fetchCredits, signDeposit: vi.fn(), record });
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ type: "arrival", amount: 0.49, asset: "XLM", hash: "d1", leaves: [7, 8] }));
  });
});

test("credits that arrive while deposits run are picked up in the same run, each tried once", async () => {
  pool.fee.mockResolvedValue(100_000n);
  pool.deposit.mockResolvedValue({ status: "ok", hashes: ["d"] });
  const credit = (id: string) => ({ id, amount: "1.0000000", asset: "XLM", status: "credited" });
  let call = 0;
  const fetchCredits = vi.fn(async () => {
    call++;
    // Round 1 sees one credit; a second appears while it is being deposited.
    const deposits = call === 1 ? [credit("a:0")] : [credit("a:0"), credit("b:0")];
    return { gateway: "G", deposits } as never;
  });
  expect(await completeArrivals(() => {}, { fetchCredits, signDeposit: vi.fn(), record: vi.fn(async () => undefined) })).toBe(2);
  expect(pool.deposit).toHaveBeenCalledTimes(2);
});

describe("checkRecipient", () => {
  test("found, not set up yet, missing, or unknown", async () => {
    const { RecipientKeysError } = await import("@/lib/privatePool");
    const { checkRecipient } = await import("@/lib/privateWallet");
    vi.stubEnv("VITE_PRIVATE_POOL", "spp");
    const fail = (err: Error) => async () => {
      throw err;
    };
    expect(await checkRecipient("@bob", { lookupKeys: async () => ({}) })).toBe("ok");
    expect(await checkRecipient("bob", { lookupKeys: fail(new RecipientKeysError("@bob can't receive private payments yet.")) })).toBe("not-ready");
    expect(await checkRecipient("nobody", { lookupKeys: fail(new RecipientKeysError("No Starlit user named @nobody.")) })).toBe("missing");
    expect(await checkRecipient("bob", { lookupKeys: fail(new Error("offline")) })).toBe("unknown");
    vi.unstubAllEnvs();
  });
});
