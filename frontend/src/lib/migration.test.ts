import { beforeEach, describe, expect, test, vi } from "vitest";
import * as StellarSdk from "@stellar/stellar-sdk";

const m = vi.hoisted(() => ({
  notesStore: [] as { commitment: string; encrypted_note: string; recipient_viewing_key: string; status: string; root?: string }[],
  transfers: [] as Record<string, string>[],
  spent: [] as { commitment: string; timestamp?: string; signature?: string }[],
  posted: [] as { commitment: string; encrypted_note: string; recipient_viewing_key: string }[],
  order: [] as string[],
  failTransferAt: -1,
  pinSalt: vi.fn(),
  signUp: vi.fn(),
  unlockWithPin: vi.fn(),
  bindProfileKeys: vi.fn(),
  getSession: vi.fn(),
  stepUp: vi.fn(),
  loadAccount: vi.fn(),
  submitTransaction: vi.fn(),
  unlockFromVault: vi.fn(),
  clearSession: vi.fn(),
}));

vi.mock("@/lib/backend", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/backend")>()),
  clearSession: m.clearSession,
  getPoolRoot: vi.fn(async () => ({ root: "cd".repeat(32) })),
  fetchNotes: vi.fn(async (viewingKey: string) => ({
    notes: m.notesStore.filter((n) => n.recipient_viewing_key === viewingKey && n.status === "unspent"),
  })),
  postNote: vi.fn(async (note) => {
    m.posted.push(note);
    m.order.push("post");
    m.notesStore.push({ ...note, status: "unspent" });
    return { note };
  }),
  spendNote: vi.fn(async (body) => {
    m.spent.push(body);
    const n = m.notesStore.find((x) => x.commitment === body.commitment);
    if (n) n.status = "spent";
    return { success: true };
  }),
  submitRelayerTransfer: vi.fn(async (body) => {
    if (m.transfers.length === m.failTransferAt) throw new Error("relayer down");
    m.transfers.push(body);
    m.order.push("transfer");
    return { success: true, hash: "h" };
  }),
}));
vi.mock("@/lib/auth", () => ({ unlockFromVault: m.unlockFromVault }));
vi.mock("@/lib/stellar", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/stellar")>()),
  horizon: { loadAccount: m.loadAccount, submitTransaction: m.submitTransaction },
}));
vi.mock("@/lib/vault/client", () => ({
  authApi: { pinSalt: m.pinSalt, bindProfileKeys: m.bindProfileKeys, getSession: m.getSession, createVault: vi.fn() },
  getEmailProof: async () => "google-token",
  passkeyFlows: { signUp: m.signUp, unlockWithPin: m.unlockWithPin, stepUp: m.stepUp, setPin: vi.fn(), setRecoveryCode: vi.fn(async () => "FRESH-CODE") },
}));

import { encryptNote } from "@/lib/crypto";
import { deriveKeysFromEmailAndPin, bytesToHex } from "@/lib/keys";
import { decryptNotePayload } from "@/lib/notes";
import { createVault } from "@/lib/vault";
import { AuthApiError } from "@/lib/vault/api";
import { migrateLegacyAccount, needsMigrationFinish } from "./migration";

const EMAIL = "alice@example.com";
const PIN = "135790";

async function seedOldNotes(amounts: { asset: string; amount: number }[], { withRoot = true } = {}) {
  const oldKeys = await deriveKeysFromEmailAndPin(EMAIL, PIN);
  for (const [i, { asset, amount }] of amounts.entries()) {
    const secret = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
    const enc = encryptNote(amount, asset, secret, "faucet", oldKeys.viewing.publicKey);
    m.notesStore.push({
      commitment: `old-${i}`.padEnd(64, "0"),
      encrypted_note: enc.ephemeralPublicKey + enc.nonce + enc.ciphertext,
      recipient_viewing_key: oldKeys.viewing.publicKey,
      status: "unspent",
      root: withRoot ? "ab".repeat(32) : undefined,
    });
  }
  return oldKeys;
}

let newVault: Awaited<ReturnType<typeof createVault>>;

beforeEach(async () => {
  vi.clearAllMocks();
  m.notesStore.length = 0;
  m.transfers.length = 0;
  m.spent.length = 0;
  m.posted.length = 0;
  m.order.length = 0;
  m.failTransferAt = -1;
  newVault = await createVault();
  m.pinSalt.mockRejectedValue(new AuthApiError(404, "No PIN", { code: "no_pin" }));
  m.signUp.mockResolvedValue({
    user: {},
    vault: { secrets: newVault.secrets, keys: newVault.keys },
    recoveryCode: "CODE",
    passkeyCanUnlock: true,
  });
  m.getSession.mockResolvedValue({ fresh: true, user: {} });
  m.bindProfileKeys.mockImplementation(async (keys) => {
    m.order.push("bind");
    return { user: { id: "u1", email: EMAIL, username: "alice", public_encryption_key: keys.publicEncryptionKey } };
  });
  m.loadAccount.mockRejectedValue(new Error("404"));
});

async function oldUser() {
  const oldKeys = await deriveKeysFromEmailAndPin(EMAIL, PIN);
  return { id: "u1", email: EMAIL, username: "alice", public_encryption_key: oldKeys.viewing.publicKey };
}

describe("migrateLegacyAccount", () => {
  test("moves every old note to the new keys, then switches the profile", async () => {
    const oldKeys = await seedOldNotes([
      { asset: "XLM", amount: 10 },
      { asset: "XLM", amount: 2.5 },
      { asset: "XLM", amount: 1 },
      { asset: "USDC", amount: 50 },
      { asset: "USDC", amount: 25 },
    ]);
    const result = await migrateLegacyAccount({ user: await oldUser(), pin: PIN });

    // A new vault with the same PIN, not yet bound to the profile.
    expect(m.signUp).toHaveBeenCalledWith(expect.objectContaining({ pin: PIN, profileBound: false, emailProof: "google-token" }));

    // XLM: (10 + 2.5) and (1), USDC: (50 + 25)  ->  3 transfers
    expect(m.transfers).toHaveLength(3);
    expect(result.notesMoved).toBe(3);

    // Every new note decrypts with the NEW viewing key, never the old one; totals are preserved.
    const totals: Record<string, number> = {};
    for (const note of m.posted) {
      expect(note.recipient_viewing_key).toBe(newVault.keys.viewing.publicKey);
      expect(decryptNotePayload(note.encrypted_note, oldKeys.viewing.secretKey)).toBeNull();
      const plain = decryptNotePayload(note.encrypted_note, newVault.keys.viewing.secretKey)!;
      totals[plain.asset] = (totals[plain.asset] ?? 0) + plain.amount;
    }
    expect(totals).toEqual({ XLM: 13.5, USDC: 75 });

    // All five old notes are retired, each with a signature from the OLD Stellar key.
    expect(m.spent.map((s) => s.commitment).sort()).toEqual([0, 1, 2, 3, 4].map((i) => `old-${i}`.padEnd(64, "0")));
    const oldStellar = StellarSdk.Keypair.fromPublicKey(oldKeys.stellar.publicKey);
    for (const s of m.spent) {
      expect(oldStellar.verify(Buffer.from(s.timestamp!), Buffer.from(s.signature!, "hex"))).toBe(true);
    }

    // The profile switches only after the funds moved, to the vault's public keys.
    expect(m.order.at(-1)).toBe("bind");
    expect(m.bindProfileKeys).toHaveBeenCalledWith(
      expect.objectContaining({
        publicEncryptionKey: newVault.keys.viewing.publicKey,
        stellarAddress: newVault.keys.stellar.publicKey,
      })
    );
    expect(m.clearSession).toHaveBeenCalled();
    expect(m.unlockFromVault).toHaveBeenCalledOnce();
    expect(result.recoveryCode).toBe("CODE");
  });

  test("a new note is recorded before the old notes are retired", async () => {
    await seedOldNotes([{ asset: "XLM", amount: 4 }]);
    await migrateLegacyAccount({ user: await oldUser(), pin: PIN });
    expect(m.order.slice(0, 2)).toEqual(["transfer", "post"]);
  });

  test("an interrupted upgrade resumes with the existing vault and the remaining notes", async () => {
    await seedOldNotes([
      { asset: "XLM", amount: 1 },
      { asset: "XLM", amount: 2 },
      { asset: "XLM", amount: 3 },
      { asset: "XLM", amount: 4 },
    ]);
    m.failTransferAt = 1;
    await expect(migrateLegacyAccount({ user: await oldUser(), pin: PIN })).rejects.toThrow("relayer down");
    expect(m.transfers).toHaveLength(1);
    expect(m.bindProfileKeys).not.toHaveBeenCalled();

    // Second attempt: the vault exists now, so it is unlocked with the same PIN instead of created.
    m.failTransferAt = -1;
    m.pinSalt.mockResolvedValue({ salt: "s", params: {} });
    m.unlockWithPin.mockResolvedValue({ user: {}, vault: { secrets: newVault.secrets, keys: newVault.keys } });
    const result = await migrateLegacyAccount({ user: await oldUser(), pin: PIN });

    expect(m.signUp).toHaveBeenCalledOnce();
    expect(m.unlockWithPin).toHaveBeenCalledWith(PIN, "google-token");
    expect(m.transfers).toHaveLength(2);
    // a resumed upgrade always shows a fresh recovery code
    expect(result.recoveryCode).toBe("FRESH-CODE");
    expect(m.notesStore.filter((n) => n.status === "unspent" && n.recipient_viewing_key !== newVault.keys.viewing.publicKey)).toHaveLength(0);
  });

  test("asks for a fresh passkey confirmation before switching keys when needed", async () => {
    m.getSession.mockResolvedValue({ fresh: false, user: {} });
    await migrateLegacyAccount({ user: await oldUser(), pin: PIN });
    expect(m.stepUp).toHaveBeenCalledOnce();
  });

  test("moves XLM from the old public address with create + merge, signed by the old key", async () => {
    const oldKeys = await deriveKeysFromEmailAndPin(EMAIL, PIN);
    m.loadAccount.mockImplementation(async (address: string) => {
      if (address !== oldKeys.stellar.publicKey) throw new Error("404");
      return new StellarSdk.Account(address, "100") as unknown as StellarSdk.Horizon.AccountResponse & object;
    });
    m.loadAccount.mockImplementationOnce(async (address: string) =>
      Object.assign(new StellarSdk.Account(address, "100"), { subentry_count: 0, balances: [{ asset_type: "native", balance: "4.93" }] })
    );
    m.submitTransaction.mockResolvedValue({ hash: "x" });

    const result = await migrateLegacyAccount({ user: await oldUser(), pin: PIN });
    expect(result.publicXlm).toEqual({ status: "moved", amount: "4.93" });

    const tx = m.submitTransaction.mock.calls[0][0] as StellarSdk.Transaction;
    expect(tx.source).toBe(oldKeys.stellar.publicKey);
    expect(tx.operations.map((op) => op.type)).toEqual(["createAccount", "accountMerge"]);
    expect((tx.operations[1] as StellarSdk.Operation.AccountMerge).destination).toBe(newVault.keys.stellar.publicKey);
    expect(StellarSdk.Keypair.fromPublicKey(oldKeys.stellar.publicKey).verify(tx.hash(), tx.signatures[0].signature())).toBe(true);
  });

  test("leaves an old address with trustlines alone and says so", async () => {
    m.loadAccount.mockResolvedValueOnce({ subentry_count: 1, balances: [] });
    const result = await migrateLegacyAccount({ user: await oldUser(), pin: PIN });
    expect(result.publicXlm.status).toBe("skipped");
    expect(m.submitTransaction).not.toHaveBeenCalled();
  });

  test("an already-switched profile is accepted on resume", async () => {
    m.bindProfileKeys.mockRejectedValue(new AuthApiError(409, "bound", { code: "already_bound" }));
    m.getSession.mockResolvedValue({ fresh: true, user: { id: "u1", email: EMAIL, public_encryption_key: newVault.keys.viewing.publicKey } });
    await expect(migrateLegacyAccount({ user: await oldUser(), pin: PIN })).resolves.toBeTruthy();
  });

  test("refuses to finish if the profile ends up on different keys", async () => {
    m.bindProfileKeys.mockResolvedValue({ user: { id: "u1", public_encryption_key: "something-else" } });
    await expect(migrateLegacyAccount({ user: await oldUser(), pin: PIN })).rejects.toThrow(/different keys/);
    expect(m.unlockFromVault).not.toHaveBeenCalled();
  });
});

describe("notes without a recorded root", () => {
  test("are spent against a root the pool currently accepts, never zeros", async () => {
    await seedOldNotes([{ asset: "XLM", amount: 5 }], { withRoot: false });
    await migrateLegacyAccount({ user: await oldUser(), pin: PIN });
    expect(m.transfers).toHaveLength(1);
    expect(m.transfers[0].root).toBe("cd".repeat(32));
  });
});

describe("needsMigrationFinish", () => {
  test("detects a vault whose profile still points at other keys", () => {
    const opened = { secrets: newVault.secrets, keys: newVault.keys };
    expect(needsMigrationFinish({ id: "u", email: "", username: "", public_encryption_key: "old" }, opened)).toBe(true);
    expect(needsMigrationFinish({ id: "u", email: "", username: "", public_encryption_key: newVault.keys.viewing.publicKey }, opened)).toBe(false);
  });
});
