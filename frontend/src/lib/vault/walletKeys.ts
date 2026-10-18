// Wallet keys derived from the random master seed. Each key comes from its own
// HKDF label, so learning one tells you nothing about the others.
//
// FROZEN: changing a label or the derivation moves every user's wallet to new
// addresses. The known-answer test in vault.test.ts guards this.

import { Buffer } from "buffer";
import * as StellarSdk from "@stellar/stellar-sdk";
import nacl from "tweetnacl";

import { bytesToHex, type DerivedKeys } from "@/lib/keys";
import { hkdf, VaultError, wipe } from "./crypto";

export async function deriveWalletKeys(seed: Uint8Array): Promise<DerivedKeys> {
  if (seed.length !== 32) throw new VaultError("Master seed must be 32 bytes.");

  const stellarSeed = await hkdf(seed, "wallet:stellar");
  const spending = await hkdf(seed, "wallet:spending");
  const viewingSeed = await hkdf(seed, "wallet:viewing");

  const stellar = StellarSdk.Keypair.fromRawEd25519Seed(Buffer.from(stellarSeed));
  const viewing = nacl.box.keyPair.fromSecretKey(viewingSeed);

  const keys: DerivedKeys = {
    // The seed itself is never exposed through the key object.
    masterSeed: "",
    stellar: { publicKey: stellar.publicKey(), secretKey: stellar.secret() },
    spendingKey: bytesToHex(spending),
    viewing: { publicKey: bytesToHex(viewing.publicKey), secretKey: bytesToHex(viewing.secretKey) },
  };
  wipe(stellarSeed, spending, viewingSeed);
  return keys;
}
