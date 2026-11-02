import { describe, expect, test } from "vitest";
import { pickSigningPasskey, type WalletPasskey } from "@/lib/smartWallet";

const passkey = (credentialId: string, ruleId: number): WalletPasskey => ({ credentialId, ruleId, publicKey: new Uint8Array(65) });

describe("pickSigningPasskey", () => {
  const original = passkey("original", 0);
  const added = passkey("added", 2);

  test("uses the newest passkey on the wallet that is registered with Starlit", () => {
    expect(pickSigningPasskey([original, added], ["original", "added"])).toBe(added);
    expect(pickSigningPasskey([original, added], ["original"])).toBe(original);
  });

  test("still uses a passkey removed from Starlit, since the wallet accepts it", () => {
    expect(pickSigningPasskey([original], [])).toBe(original);
  });

  test("ignores registered passkeys the wallet doesn't accept", () => {
    expect(pickSigningPasskey([original], ["other"])).toBe(original);
    expect(pickSigningPasskey([], ["other"])).toBeNull();
  });
});
