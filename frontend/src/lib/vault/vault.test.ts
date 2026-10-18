import { describe, expect, test } from "vitest";
import * as StellarSdk from "@stellar/stellar-sdk";

import {
  addUnlockMethod,
  assertSafeArgon2Params,
  closeVault,
  createVault,
  decryptSeed,
  deriveWalletKeys,
  encryptSeed,
  fromB64u,
  generateRecoveryCode,
  kekFromPin,
  kekFromPrf,
  openVault,
  parseRecoveryCode,
  PRF_SALT,
  prfExtensionInput,
  randomBytes,
  readPrfOutput,
  recoveryMaterial,
  stretchPin,
  toB64u,
  unwrapDek,
  VaultError,
  wrapDek,
  type Argon2Params,
} from "@/lib/vault";

// Must match backend/src/auth_layer/settings.js (pin.argon2).
const SERVER_ARGON2: Argon2Params = { algorithm: "argon2id", memoryKiB: 64 * 1024, iterations: 3, parallelism: 1, hashLength: 32 };

// Mirrors of the backend's input validation (backend/src/auth_layer/vault.js).
const b64uWithin = (v: string, min: number, max: number) => /^[A-Za-z0-9_-]+$/.test(v) && v.length >= min && v.length <= max;
const backendAcceptsWrap = (v: string) => b64uWithin(v, 40, 512);
const backendAcceptsSeed = (v: string) => b64uWithin(v, 40, 2048);
const backendAcceptsVerifier = (v: string) => /^[A-Za-z0-9_-]+$/.test(v) && fromB64u(v).length === 32;

const flipLastByte = (b64u: string) => {
  const raw = fromB64u(b64u);
  raw[raw.length - 1] ^= 0x01;
  return toB64u(raw);
};

describe("encoding", () => {
  test("base64url round-trips arbitrary bytes", () => {
    for (const n of [0, 1, 2, 3, 31, 32, 33, 61]) {
      const bytes = randomBytes(n);
      expect(fromB64u(toB64u(bytes))).toEqual(bytes);
    }
    expect(toB64u(new Uint8Array([0xfb, 0xff]))).toBe("-_8");
  });

  test("rejects non-base64url input", () => {
    expect(() => fromB64u("ab+c")).toThrow(VaultError);
  });
});

describe("seed envelope", () => {
  test("a new vault has a random 32-byte seed and data key", async () => {
    const a = await createVault();
    const b = await createVault();
    expect(a.secrets.seed).toHaveLength(32);
    expect(a.secrets.dek).toHaveLength(32);
    expect(a.secrets.seed).not.toEqual(b.secrets.seed);
    expect(a.keys.stellar.publicKey).not.toBe(b.keys.stellar.publicKey);
    expect(backendAcceptsSeed(a.encryptedSeed)).toBe(true);
  });

  test("the seed decrypts only with its data key and untampered data", async () => {
    const { secrets, encryptedSeed } = await createVault();
    expect(await decryptSeed(encryptedSeed, secrets.dek)).toEqual(secrets.seed);
    await expect(decryptSeed(encryptedSeed, randomBytes(32))).rejects.toThrow(VaultError);
    await expect(decryptSeed(flipLastByte(encryptedSeed), secrets.dek)).rejects.toThrow(VaultError);
  });

  test("encrypting the same seed twice gives different ciphertexts", async () => {
    const { secrets } = await createVault();
    expect(await encryptSeed(secrets)).not.toBe(await encryptSeed(secrets));
  });

  test("rejects an unknown format version", async () => {
    const { secrets, encryptedSeed } = await createVault();
    const raw = fromB64u(encryptedSeed);
    raw[0] = 99;
    await expect(decryptSeed(toB64u(raw), secrets.dek)).rejects.toThrow(/Unsupported/);
  });
});

describe("passkey (PRF) unlock", () => {
  test("the same PRF output reopens the vault; a different one cannot", async () => {
    const vault = await createVault();
    const prf = randomBytes(32);
    const wrapped = await addUnlockMethod(vault.secrets, await kekFromPrf(prf), "passkey");
    expect(backendAcceptsWrap(wrapped)).toBe(true);

    const opened = await openVault(vault.encryptedSeed, wrapped, await kekFromPrf(prf), "passkey");
    expect(opened.keys).toEqual(vault.keys);

    await expect(openVault(vault.encryptedSeed, wrapped, await kekFromPrf(randomBytes(32)), "passkey")).rejects.toThrow(VaultError);
  });

  test("a passkey wrap cannot be replayed as another method's wrap", async () => {
    const vault = await createVault();
    const kek = await kekFromPrf(randomBytes(32));
    const wrapped = await wrapDek(vault.secrets.dek, kek, "passkey");
    await expect(unwrapDek(wrapped, kek, "recovery")).rejects.toThrow(VaultError);
  });

  test("reads PRF output from extension results in both buffer forms", () => {
    const out = randomBytes(32);
    expect(readPrfOutput({ prf: { results: { first: out.buffer.slice(0) } } })).toEqual(out);
    expect(readPrfOutput({ prf: { results: { first: out } } })).toEqual(out);
    expect(readPrfOutput({ prf: { enabled: true } })).toBeNull();
    expect(readPrfOutput({})).toBeNull();
    expect(readPrfOutput(null)).toBeNull();
  });

  test("the PRF input is a fixed 32-byte value", () => {
    expect(PRF_SALT).toHaveLength(32);
    expect(prfExtensionInput().prf.eval.first).toBe(PRF_SALT);
  });

  test("rejects too-short PRF output", async () => {
    await expect(kekFromPrf(randomBytes(16))).rejects.toThrow(VaultError);
  });
});

describe("PIN unlock", () => {
  const salt = toB64u(randomBytes(16));
  const serverShare = toB64u(randomBytes(32));

  test("is deterministic and splits into a verifier and a private key half", async () => {
    const a = await stretchPin("123456", salt, SERVER_ARGON2);
    const b = await stretchPin("123456", salt, SERVER_ARGON2);
    expect(a.verifier).toBe(b.verifier);
    expect(a.keyPart).toEqual(b.keyPart);
    expect(backendAcceptsVerifier(a.verifier)).toBe(true);
    expect(toB64u(a.keyPart)).not.toBe(a.verifier);
  }, 30_000);

  test("different PINs or salts give different verifiers", async () => {
    const base = await stretchPin("123456", salt, SERVER_ARGON2);
    expect((await stretchPin("123457", salt, SERVER_ARGON2)).verifier).not.toBe(base.verifier);
    expect((await stretchPin("123456", toB64u(randomBytes(16)), SERVER_ARGON2)).verifier).not.toBe(base.verifier);
  }, 30_000);

  test("needs both the PIN key half and the server share", async () => {
    const vault = await createVault();
    const { keyPart } = await stretchPin("246810", salt, SERVER_ARGON2);
    const wrapped = await addUnlockMethod(vault.secrets, await kekFromPin(keyPart, serverShare), "pin");

    const opened = await openVault(vault.encryptedSeed, wrapped, await kekFromPin(keyPart, serverShare), "pin");
    expect(opened.keys.stellar.publicKey).toBe(vault.keys.stellar.publicKey);

    const wrongShare = await kekFromPin(keyPart, toB64u(randomBytes(32)));
    await expect(openVault(vault.encryptedSeed, wrapped, wrongShare, "pin")).rejects.toThrow(VaultError);

    const otherPin = await stretchPin("246811", salt, SERVER_ARGON2);
    await expect(openVault(vault.encryptedSeed, wrapped, await kekFromPin(otherPin.keyPart, serverShare), "pin")).rejects.toThrow(VaultError);
  }, 30_000);

  test("only accepts 6-digit PINs", async () => {
    for (const bad of ["12345", "1234567", "12a456", ""]) {
      await expect(stretchPin(bad, salt, SERVER_ARGON2)).rejects.toThrow(/6 digits/);
    }
  });

  test("refuses weak or abusive Argon2 settings from the server", () => {
    expect(() => assertSafeArgon2Params(SERVER_ARGON2)).not.toThrow();
    const bad: Partial<Argon2Params>[] = [
      { memoryKiB: 1024 },
      { memoryKiB: 1024 * 1024 },
      { iterations: 1 },
      { iterations: 50 },
      { parallelism: 0 },
      { hashLength: 16 },
      { algorithm: "argon2i" as "argon2id" },
    ];
    for (const change of bad) {
      expect(() => assertSafeArgon2Params({ ...SERVER_ARGON2, ...change })).toThrow(VaultError);
    }
  });

  test("rejects a short salt or malformed server share", async () => {
    await expect(stretchPin("123456", toB64u(randomBytes(8)), SERVER_ARGON2)).rejects.toThrow(/salt/);
    await expect(kekFromPin(randomBytes(32), toB64u(randomBytes(16)))).rejects.toThrow(/server share/);
  });
});

describe("recovery code", () => {
  test("has the expected shape and 128 bits of randomness", async () => {
    const { display, bytes } = await generateRecoveryCode();
    expect(display).toMatch(/^([0-9A-HJKMNP-TV-Z]{4}-){6}[0-9A-HJKMNP-TV-Z]{4}$/);
    expect(bytes).toHaveLength(16);
    expect((await generateRecoveryCode()).display).not.toBe(display);
  });

  test("parses what users actually type", async () => {
    const { display, bytes } = await generateRecoveryCode();
    const sloppy = ` ${display.toLowerCase().replace(/-/g, " ").replace(/0/g, "o").replace(/1/g, "l")} `;
    expect(await parseRecoveryCode(display)).toEqual(bytes);
    expect(await parseRecoveryCode(sloppy)).toEqual(bytes);
  });

  test("the checksum catches typos", async () => {
    const { display } = await generateRecoveryCode();
    const chars = display.replace(/-/g, "").split("");
    const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
    let caught = 0;
    for (let i = 0; i < 26; i++) {
      const typo = [...chars];
      typo[i] = alphabet[(alphabet.indexOf(typo[i]) + 1) % 32];
      if ((await parseRecoveryCode(typo.join(""))) === null) caught++;
    }
    // A 10-bit checksum misses about 1 in 1024 single-character typos.
    expect(caught).toBeGreaterThanOrEqual(25);
    expect(await parseRecoveryCode(display.slice(0, -1))).toBeNull();
    expect(await parseRecoveryCode(display + "X")).toBeNull();
    expect(await parseRecoveryCode("UUUU-UUUU-UUUU-UUUU-UUUU-UUUU-UUUU")).toBeNull();
  });

  test("reopens the vault and gives a verifier the backend accepts", async () => {
    const vault = await createVault();
    const code = await generateRecoveryCode();
    const setup = await recoveryMaterial(code.bytes);
    expect(backendAcceptsVerifier(setup.verifier)).toBe(true);
    const wrapped = await addUnlockMethod(vault.secrets, setup.kek, "recovery");

    const typed = await parseRecoveryCode(code.display.toLowerCase());
    const later = await recoveryMaterial(typed!);
    expect(later.verifier).toBe(setup.verifier);
    const opened = await openVault(vault.encryptedSeed, wrapped, later.kek, "recovery");
    expect(opened.keys).toEqual(vault.keys);
  });
});

describe("wallet key derivation", () => {
  test("is frozen: known-answer vector (changing this moves every wallet)", async () => {
    const seed = Uint8Array.from({ length: 32 }, (_, i) => i);
    const keys = await deriveWalletKeys(seed);
    // Cross-checked against Node's crypto.hkdfSync + stellar-sdk + tweetnacl.
    expect(keys.stellar.publicKey).toBe("GCDHUUKCWLKES4YH5337EXSRLOZSJIR2WKOQRJHKHS4UJXZQDY3SZVSO");
    expect(keys.spendingKey).toBe("583209fe1b6eebedbccc34bfe048cd964d532d420440910c54d6c04cfcde4386");
    expect(keys.viewing.publicKey).toBe("a518d631b60e2e274a4af306c3a680bbfad762e6613a3707af5a2776f5cabd71");
    expect(keys.masterSeed).toBe("");
  });

  test("produces a valid Stellar keypair and independent keys", async () => {
    const { keys } = await createVault();
    const kp = StellarSdk.Keypair.fromSecret(keys.stellar.secretKey);
    expect(kp.publicKey()).toBe(keys.stellar.publicKey);
    expect(keys.spendingKey).toMatch(/^[0-9a-f]{64}$/);
    expect(keys.viewing.secretKey).toMatch(/^[0-9a-f]{64}$/);
    expect(new Set([keys.spendingKey, keys.viewing.secretKey, Buffer.from(kp.rawSecretKey()).toString("hex")]).size).toBe(3);
  });

  test("rejects a seed of the wrong length", async () => {
    await expect(deriveWalletKeys(randomBytes(16))).rejects.toThrow(VaultError);
  });
});

describe("full lifecycle", () => {
  test("one vault, three unlock methods, all open to the same wallet", async () => {
    const vault = await createVault();
    const prf = randomBytes(32);
    const salt = toB64u(randomBytes(16));
    const share = toB64u(randomBytes(32));
    const pin = await stretchPin("135790", salt, SERVER_ARGON2);
    const code = await generateRecoveryCode();
    const recovery = await recoveryMaterial(code.bytes);

    const wraps = {
      passkey: await addUnlockMethod(vault.secrets, await kekFromPrf(prf), "passkey"),
      pin: await addUnlockMethod(vault.secrets, await kekFromPin(pin.keyPart, share), "pin"),
      recovery: await addUnlockMethod(vault.secrets, recovery.kek, "recovery"),
    };
    const expected = vault.keys.stellar.publicKey;

    const viaPasskey = await openVault(vault.encryptedSeed, wraps.passkey, await kekFromPrf(prf), "passkey");
    const viaPin = await openVault(vault.encryptedSeed, wraps.pin, await kekFromPin(pin.keyPart, share), "pin");
    const viaRecovery = await openVault(vault.encryptedSeed, wraps.recovery, recovery.kek, "recovery");
    for (const opened of [viaPasskey, viaPin, viaRecovery]) {
      expect(opened.keys.stellar.publicKey).toBe(expected);
    }

    closeVault(viaPasskey.secrets);
    expect(viaPasskey.secrets.seed.every((b) => b === 0)).toBe(true);
    expect(viaPasskey.secrets.dek.every((b) => b === 0)).toBe(true);
  }, 30_000);
});
