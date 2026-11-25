import { Buffer } from "buffer";
import * as StellarSdk from "@stellar/stellar-sdk";
import { describe, expect, test } from "vitest";
import { createZkSigner, deriveZkStorageKey, signZkKeys, zkKeysMessage, zkKeysSignedBy } from "@/lib/zkSigner";

const owner = StellarSdk.Keypair.random();
const relayer = StellarSdk.Keypair.random().publicKey();

function signer(sent: string[] = []) {
  return createZkSigner({
    owner,
    relayerAddress: relayer,
    signWithRelayer: async (xdr) => {
      sent.push(xdr);
      return { signedTxXdr: `signed:${xdr}` };
    },
  });
}

describe("createZkSigner", () => {
  test("the owner signs messages per SEP-53, base64 like Freighter", async () => {
    const { signedMessage, signerAddress } = await signer().signMessage("derive keys", { address: owner.publicKey() });
    expect(signerAddress).toBe(owner.publicKey());
    expect(owner.verifyMessage("derive keys", Buffer.from(signedMessage, "base64"))).toBe(true);
  });

  test("transactions go to the backend relayer, never the owner key", async () => {
    const sent: string[] = [];
    expect(await signer(sent).signTransaction("AAAA", { address: relayer })).toEqual({ signedTxXdr: "signed:AAAA", signerAddress: relayer });
    expect(sent).toEqual(["AAAA"]);
  });

  test("refuses to sign for the wrong account, and never signs auth entries", async () => {
    await expect(signer().signMessage("x", { address: relayer })).rejects.toThrow();
    await expect(signer().signTransaction("AAAA", { address: owner.publicKey() })).rejects.toThrow();
    await expect(signer().signAuthEntry()).rejects.toThrow();
  });
});

describe("published keys", () => {
  const note = `0x${"AB".repeat(32)}`;
  const enc = `0x${"cd".repeat(32)}`;

  test("the signed text matches the backend's, byte for byte", () => {
    expect(zkKeysMessage(note, enc)).toBe(`Starlit Pay private keys\nnote: 0x${"ab".repeat(32)}\nencryption: 0x${"cd".repeat(32)}`);
  });

  test("a sender accepts keys signed by the recipient's wallet only", () => {
    const keys = signZkKeys(owner, note, enc);
    expect(zkKeysSignedBy(owner.publicKey(), keys)).toBe(true);
    expect(zkKeysSignedBy(relayer, keys)).toBe(false);
    expect(zkKeysSignedBy(owner.publicKey(), { ...keys, encryptionKey: `0x${"ee".repeat(32)}` })).toBe(false);
    expect(zkKeysSignedBy(owner.publicKey(), { ...keys, signature: "garbage" })).toBe(false);
  });
});

test("the storage key is 32 bytes, stable for a wallet and different per wallet", async () => {
  const a = await deriveZkStorageKey(owner);
  expect(a).toHaveLength(32);
  expect(await deriveZkStorageKey(StellarSdk.Keypair.fromSecret(owner.secret()))).toEqual(a);
  expect(await deriveZkStorageKey(StellarSdk.Keypair.random())).not.toEqual(a);
});
