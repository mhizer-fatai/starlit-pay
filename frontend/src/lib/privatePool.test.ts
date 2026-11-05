import * as StellarSdk from "@stellar/stellar-sdk";
import { describe, expect, test } from "vitest";
import { recipientKeys, RecipientKeysError, storageDirectory } from "@/lib/privatePool";
import { signZkKeys } from "@/lib/zkSigner";

const bob = StellarSdk.Keypair.random();
const note = `0x${"11".repeat(32)}`;
const enc = `0x${"22".repeat(32)}`;
const served = (keys: ReturnType<typeof signZkKeys>, stellarAddress = bob.publicKey()) => async () => ({
  keys: { ...keys, username: "bob", stellarAddress },
});

describe("recipientKeys", () => {
  test("returns keys the recipient's wallet signed", async () => {
    expect(await recipientKeys("bob", served(signZkKeys(bob, note, enc)))).toEqual({ username: "bob", noteKey: note, encryptionKey: enc });
  });

  test("refuses keys a server swapped, or signed by someone else", async () => {
    const swapped = { ...signZkKeys(bob, note, enc), noteKey: `0x${"33".repeat(32)}` };
    await expect(recipientKeys("bob", served(swapped))).rejects.toBeInstanceOf(RecipientKeysError);
    const mallory = StellarSdk.Keypair.random();
    await expect(recipientKeys("bob", served(signZkKeys(mallory, note, enc)))).rejects.toBeInstanceOf(RecipientKeysError);
  });
});

test("each wallet gets its own database folder, in the shape the SDK accepts", async () => {
  const a = await storageDirectory(bob.publicKey());
  expect(a).toMatch(/^\.opfs-sahpool-encrypted-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  expect(await storageDirectory(bob.publicKey())).toBe(a);
  expect(await storageDirectory(StellarSdk.Keypair.random().publicKey())).not.toBe(a);
});
