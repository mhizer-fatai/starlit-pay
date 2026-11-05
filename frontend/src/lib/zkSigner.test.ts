import { Buffer } from "buffer";
import * as StellarSdk from "@stellar/stellar-sdk";
import { describe, expect, test } from "vitest";
import { createZkSigner, deriveZkStorageKey } from "@/lib/zkSigner";

const owner = StellarSdk.Keypair.random();
const payer = StellarSdk.Keypair.random().publicKey();

function signer(sent: string[] = []) {
  return createZkSigner({
    owner,
    payerAddress: payer,
    signWithPayer: async (xdr) => {
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

  test("transactions go to the backend payer, never the owner key", async () => {
    const sent: string[] = [];
    expect(await signer(sent).signTransaction("AAAA", { address: payer })).toEqual({ signedTxXdr: "signed:AAAA", signerAddress: payer });
    expect(sent).toEqual(["AAAA"]);
  });

  test("refuses to sign for the wrong account, and never signs auth entries", async () => {
    await expect(signer().signMessage("x", { address: payer })).rejects.toThrow();
    await expect(signer().signTransaction("AAAA", { address: owner.publicKey() })).rejects.toThrow();
    await expect(signer().signAuthEntry()).rejects.toThrow();
  });
});

test("the storage key is 32 bytes, stable for a wallet and different per wallet", async () => {
  const a = await deriveZkStorageKey(owner);
  expect(a).toHaveLength(32);
  expect(await deriveZkStorageKey(StellarSdk.Keypair.fromSecret(owner.secret()))).toEqual(a);
  expect(await deriveZkStorageKey(StellarSdk.Keypair.random())).not.toEqual(a);
});
