import { beforeEach, describe, expect, test, vi } from "vitest";

// Tests run in Node: the SDK's progress events go to `window`.
vi.stubGlobal("window", new EventTarget());

const pool = {
  balance: vi.fn(),
  maxSpend: vi.fn(),
  estimate: vi.fn(),
  transferToKeys: vi.fn(),
  withdraw: vi.fn(),
};
vi.mock("@/lib/wallet", () => ({ loadPrivateBalances: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getUnlockedKeys: () => ({ stellar: { secretKey: "S-test" } }) }));
vi.mock("@/lib/privatePool", () => ({
  openPrivateSession: async () => ({ sync: async () => undefined, pool: async () => pool }),
  recipientKeys: async (username: string) => ({ username, noteKey: "0xnote", encryptionKey: "0xenc" }),
}));

const { fromBaseUnits, PartialPaymentError, progressMessage, sendZkPayment, toBaseUnits } = await import("@/lib/privateWallet");

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
    expect(result).toEqual({ hashes: ["h1"], fees: 0.01 });
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
