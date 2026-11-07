import { beforeEach, describe, expect, test, vi } from "vitest";
import * as StellarSdk from "@stellar/stellar-sdk";

const m = vi.hoisted(() => ({
  order: [] as string[],
  failBindOnce: false,
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

import { deriveKeysFromEmailAndPin } from "@/lib/keys";
import { createVault } from "@/lib/vault";
import { AuthApiError } from "@/lib/vault/api";
import { migrateLegacyAccount, needsMigrationFinish } from "./migration";

const EMAIL = "alice@example.com";
const PIN = "135790";

let newVault: Awaited<ReturnType<typeof createVault>>;

beforeEach(async () => {
  vi.clearAllMocks();
  m.order.length = 0;
  m.failBindOnce = false;
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
    if (m.failBindOnce) {
      m.failBindOnce = false;
      throw new Error("network down");
    }
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
  test("creates the vault, switches the profile to the new keys, then signs in", async () => {
    const result = await migrateLegacyAccount({ user: await oldUser(), pin: PIN });
    // A new vault with the same PIN, not yet bound to the profile.
    expect(m.signUp).toHaveBeenCalledWith(expect.objectContaining({ pin: PIN, profileBound: false, emailProof: "google-token" }));
    expect(m.bindProfileKeys).toHaveBeenCalledWith(expect.objectContaining({ publicEncryptionKey: newVault.keys.viewing.publicKey }));
    expect(m.clearSession).toHaveBeenCalled();
    expect(m.unlockFromVault).toHaveBeenCalledOnce();
    expect(result.recoveryCode).toBe("CODE");
  });

  test("an interrupted upgrade resumes with the existing vault and a fresh recovery code", async () => {
    m.failBindOnce = true;
    await expect(migrateLegacyAccount({ user: await oldUser(), pin: PIN })).rejects.toThrow("network down");
    expect(m.unlockFromVault).not.toHaveBeenCalled();

    // Second attempt: the vault exists now, so it is unlocked with the same PIN instead of created.
    m.pinSalt.mockResolvedValue({ salt: "s", params: {} });
    m.unlockWithPin.mockResolvedValue({ user: {}, vault: { secrets: newVault.secrets, keys: newVault.keys } });
    const result = await migrateLegacyAccount({ user: await oldUser(), pin: PIN });
    expect(m.signUp).toHaveBeenCalledOnce();
    expect(m.unlockWithPin).toHaveBeenCalledWith(PIN, "google-token");
    expect(result.recoveryCode).toBe("FRESH-CODE");
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

describe("needsMigrationFinish", () => {
  test("detects a vault whose profile still points at other keys", () => {
    const opened = { secrets: newVault.secrets, keys: newVault.keys };
    expect(needsMigrationFinish({ id: "u", email: "", username: "", public_encryption_key: "old" }, opened)).toBe(true);
    expect(needsMigrationFinish({ id: "u", email: "", username: "", public_encryption_key: newVault.keys.viewing.publicKey }, opened)).toBe(false);
  });
});
