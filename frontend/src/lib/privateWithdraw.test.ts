import { beforeEach, describe, expect, test, vi } from "vitest";

const api = vi.hoisted(() => ({
  fetchNotes: vi.fn(),
  postNote: vi.fn(),
  postTransaction: vi.fn(),
  spendNote: vi.fn(),
  submitRelayerWithdraw: vi.fn(),
}));
const notesApi = vi.hoisted(() => ({ getSpendableNotes: vi.fn(), spendRootFor: vi.fn() }));

vi.mock("@/lib/spentNotes", () => ({ withoutSpentOnChain: async <T,>(notes: T[]) => notes }));
vi.mock("@/lib/backend", () => api);
vi.mock("@/lib/notes", () => notesApi);
vi.mock("@/lib/auth", () => ({
  getSpendingKey: () => "ab".repeat(32),
  getViewingSecret: () => "cd".repeat(32),
  signAuthRequest: () => "signature",
}));
vi.mock("@/lib/crypto", () => ({
  bytesToHex: (b: Uint8Array) => Buffer.from(b).toString("hex"),
  encryptNote: () => ({ ephemeralPublicKey: "aa", nonce: "bb", ciphertext: "cc" }),
}));
vi.mock("@/lib/ownedNotes", () => ({ selfNoteSecret: async () => ({ secret: "s", n: "n" }) }));
vi.mock("@/lib/stellar", () => ({ TOKENS: { XLM: "CXLM", USDC: "CUSDC" } }));
vi.mock("@/lib/zk", () => ({
  calculateCommitment: async (amount: number) => `commit-${amount}`,
  generateShieldedPaymentProof: async () => ({ proofHex: "p", nullifier1Hex: "n1", nullifier2Hex: "n2" }),
}));

import { withdrawFromPool } from "@/lib/privateWithdraw";
import type { SessionUser } from "@/lib/auth";

const user = { id: "u1", email: "a@b.c", username: "alice", public_encryption_key: "view" } as SessionUser;
const note = (amount: number, id: string) => ({ amount, secret: `sec-${id}`, commitment: id });
const recordOf = () => JSON.parse(atob(api.postTransaction.mock.calls[0]![0].encrypted_payload));

beforeEach(() => {
  vi.clearAllMocks();
  api.fetchNotes.mockResolvedValue({ notes: [] });
  api.postNote.mockResolvedValue({});
  api.postTransaction.mockResolvedValue({});
  api.spendNote.mockResolvedValue({});
  api.submitRelayerWithdraw.mockResolvedValue({ success: true, hash: "txhash" });
  notesApi.spendRootFor.mockResolvedValue("root");
});

describe("withdrawFromPool", () => {
  test("returns change to the user, marks inputs spent and records the withdrawal", async () => {
    notesApi.getSpendableNotes.mockReturnValue([note(3, "c1"), note(4, "c2")]);
    const hash = await withdrawFromPool({ user, asset: "XLM", amount: 5, recipient: "CWALLET", transfer: "to-public" });

    expect(hash).toBe("txhash");
    expect(api.submitRelayerWithdraw).toHaveBeenCalledWith(
      expect.objectContaining({ recipient: "CWALLET", token: "CXLM", amount: 5, change_commitment: "commit-2" })
    );
    expect(api.postNote).toHaveBeenCalledWith(expect.objectContaining({ commitment: "commit-2", recipient_viewing_key: "view" }));
    expect(api.spendNote.mock.calls.map((c) => c[0].commitment)).toEqual(["c1", "c2"]);
    expect(recordOf()).toMatchObject({ to: "CWALLET", amount: 5, asset: "XLM", type: "withdraw", hash: "txhash", transfer: "to-public" });
  });

  test("an exact amount creates no change note, and a plain withdrawal is not marked a transfer", async () => {
    notesApi.getSpendableNotes.mockReturnValue([note(5, "c1")]);
    await withdrawFromPool({ user, asset: "USDC", amount: 5, recipient: "GADDRESS" });

    expect(api.postNote).not.toHaveBeenCalled();
    expect(api.submitRelayerWithdraw).toHaveBeenCalledWith(expect.objectContaining({ change_commitment: "0".repeat(64) }));
    expect(recordOf().transfer).toBeUndefined();
  });

  test("refuses when funds are short, before submitting anything", async () => {
    notesApi.getSpendableNotes.mockReturnValue([note(1, "c1")]);
    await expect(withdrawFromPool({ user, asset: "XLM", amount: 5, recipient: "CWALLET" })).rejects.toThrow(/Not enough private XLM/);
    expect(api.submitRelayerWithdraw).not.toHaveBeenCalled();
  });

  test("the payment still counts as sent if bookkeeping fails afterwards", async () => {
    notesApi.getSpendableNotes.mockReturnValue([note(5, "c1")]);
    api.spendNote.mockRejectedValue(new Error("down"));
    api.postTransaction.mockRejectedValue(new Error("down"));
    await expect(withdrawFromPool({ user, asset: "XLM", amount: 5, recipient: "CWALLET" })).resolves.toBe("txhash");
  });
});
