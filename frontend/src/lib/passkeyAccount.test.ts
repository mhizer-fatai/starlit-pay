import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  register: vi.fn(),
  signUp: vi.fn(),
  unlockWithPasskey: vi.fn(),
  unlockWithPin: vi.fn(),
  pinSalt: vi.fn(),
  getEmailProof: vi.fn(),
  unlockFromVault: vi.fn(),
  stepUp: vi.fn(),
}));

vi.mock("@/lib/backend", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/backend")>()),
  register: mocks.register,
}));
vi.mock("@/lib/auth", () => ({ unlockFromVault: mocks.unlockFromVault }));
vi.mock("@/lib/vault/client", () => ({
  authApi: { pinSalt: mocks.pinSalt },
  getEmailProof: mocks.getEmailProof,
  passkeyFlows: { signUp: mocks.signUp, unlockWithPasskey: mocks.unlockWithPasskey, unlockWithPin: mocks.unlockWithPin, stepUp: mocks.stepUp },
}));

import {
  accountUsesVault,
  confirmPaymentWithPasskey,
  confirmPaymentWithPin,
  createPasskeyAccount,
  friendlyAuthError,
  unlockWithVaultPin,
} from "./passkeyAccount";
import { AuthApiError } from "./vault/api";
import { PasskeyCancelledError } from "./vault/webauthn";

const input = { email: "Alice@Example.com", username: "alice", displayName: "Alice", pin: "135790" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getEmailProof.mockResolvedValue("google-token");
  mocks.register.mockResolvedValue({ user: { id: "u1" }, token: "legacy-jwt" });
});

describe("createPasskeyAccount", () => {
  test("registers the profile with the new wallet's public keys, then signs up", async () => {
    mocks.signUp.mockImplementation(async ({ vault }) => ({
      user: { id: "u1", email: "alice@example.com" },
      vault: { secrets: vault.secrets, keys: vault.keys },
      recoveryCode: "CODE",
      passkeyCanUnlock: true,
    }));

    const result = await createPasskeyAccount(input);

    const profile = mocks.register.mock.calls[0][0];
    const vault = mocks.signUp.mock.calls[0][0].vault;
    expect(profile.email).toBe("alice@example.com");
    expect(profile.public_encryption_key).toBe(vault.keys.viewing.publicKey);
    expect(profile.stellar_address).toBe(vault.keys.stellar.publicKey);
    expect(profile.identity_commitment).toMatch(/^[0-9a-f]{64}$/);
    expect(mocks.signUp.mock.calls[0][0]).toMatchObject({ emailProof: "google-token", pin: "135790" });
    expect(mocks.unlockFromVault).toHaveBeenCalledOnce();
    expect(result).toEqual({ recoveryCode: "CODE", passkeyCanUnlock: true });
  });

  test("a retry after a cancelled passkey prompt reuses the same keys and does not register again", async () => {
    mocks.signUp.mockRejectedValueOnce(new PasskeyCancelledError());
    await expect(createPasskeyAccount(input)).rejects.toBeInstanceOf(PasskeyCancelledError);
    expect(mocks.unlockFromVault).not.toHaveBeenCalled();

    mocks.signUp.mockImplementation(async ({ vault }) => ({
      user: { id: "u1" },
      vault: { secrets: vault.secrets, keys: vault.keys },
      recoveryCode: "CODE",
      passkeyCanUnlock: true,
    }));
    await createPasskeyAccount(input);

    expect(mocks.register).toHaveBeenCalledOnce();
    const [first, second] = mocks.signUp.mock.calls.map((c) => c[0].vault);
    expect(second).toBe(first);
  });

  test("needs a Google session", async () => {
    mocks.getEmailProof.mockResolvedValue(null);
    await expect(createPasskeyAccount({ ...input, email: "bob@example.com" })).rejects.toThrow(/Google/);
    expect(mocks.register).not.toHaveBeenCalled();
  });
});

describe("PIN unlock and account type", () => {
  test("uses the session or Google proof as asked", async () => {
    mocks.unlockWithPin.mockResolvedValue({ user: { id: "u1" }, vault: {} });
    await unlockWithVaultPin("135790", { useEmailProof: false });
    expect(mocks.unlockWithPin).toHaveBeenLastCalledWith("135790", null);
    await unlockWithVaultPin("135790", { useEmailProof: true });
    expect(mocks.unlockWithPin).toHaveBeenLastCalledWith("135790", "google-token");
  });

  test("detects passkey-vault accounts versus older PIN accounts", async () => {
    mocks.pinSalt.mockResolvedValueOnce({ salt: "s", params: {} });
    expect(await accountUsesVault()).toBe(true);
    mocks.pinSalt.mockRejectedValueOnce(new AuthApiError(404, "No PIN", { code: "no_pin" }));
    expect(await accountUsesVault()).toBe(false);
    mocks.pinSalt.mockRejectedValueOnce(new AuthApiError(500, "Server error", null));
    await expect(accountUsesVault()).rejects.toThrow("Server error");
  });
});

describe("friendlyAuthError", () => {
  test("explains wrong PINs and lockouts", () => {
    expect(friendlyAuthError(new AuthApiError(401, "Incorrect PIN.", { code: "pin_incorrect", attemptsRemaining: 1 }))).toBe(
      "Incorrect PIN. 1 attempt left."
    );
    expect(friendlyAuthError(new AuthApiError(429, "Too many", { code: "pin_locked", retryAfterSec: 1800 }))).toBe(
      "Too many incorrect PINs. Try again in 30 minutes."
    );
    expect(friendlyAuthError(new PasskeyCancelledError())).toMatch(/cancelled/);
  });
});

describe("payment confirmation", () => {
  test("a passkey confirmation runs a backend-verified step-up ceremony", async () => {
    mocks.stepUp.mockResolvedValue({ credentialId: "c", prfOutput: null });
    await confirmPaymentWithPasskey();
    expect(mocks.stepUp).toHaveBeenCalledOnce();
  });

  test("a cancelled passkey prompt does not confirm the payment", async () => {
    mocks.stepUp.mockRejectedValue(new PasskeyCancelledError());
    await expect(confirmPaymentWithPasskey()).rejects.toBeInstanceOf(PasskeyCancelledError);
  });

  test("the PIN fallback checks the PIN with the server and wipes the extra vault copy", async () => {
    const secrets = { seed: new Uint8Array(32).fill(7), dek: new Uint8Array(32).fill(9) };
    mocks.unlockWithPin.mockResolvedValue({ user: { id: "u1" }, vault: { secrets, keys: {} } });
    await confirmPaymentWithPin("135790");
    expect(mocks.unlockWithPin).toHaveBeenCalledWith("135790", null);
    expect(secrets.seed.every((b) => b === 0) && secrets.dek.every((b) => b === 0)).toBe(true);
    expect(mocks.unlockFromVault).not.toHaveBeenCalled();
  });

  test("a wrong PIN does not confirm the payment", async () => {
    mocks.unlockWithPin.mockRejectedValue(new AuthApiError(401, "Incorrect PIN.", { code: "pin_incorrect", attemptsRemaining: 3 }));
    await expect(confirmPaymentWithPin("000000")).rejects.toMatchObject({ code: "pin_incorrect" });
  });
});
