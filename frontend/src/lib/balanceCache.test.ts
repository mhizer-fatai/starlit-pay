import * as StellarSdk from "@stellar/stellar-sdk";
import { expect, test, vi } from "vitest";

const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
});
let secret = StellarSdk.Keypair.random().secret();
vi.mock("@/lib/auth", () => ({ getUnlockedKeys: () => ({ stellar: { secretKey: secret } }) }));

const { readCachedBalance, writeCachedBalance } = await import("@/lib/balanceCache");

test("the last balance comes back for the same wallet, and is stored encrypted", async () => {
  await writeCachedBalance("u1", { xlm: 6308.64, usdc: 298.97 });
  expect(await readCachedBalance("u1")).toEqual({ xlm: 6308.64, usdc: 298.97 });
  const stored = store.get("starlit_balance_u1")!;
  expect(stored).not.toContain("6308");
  expect(stored).not.toContain("298");
});

test("another wallet's key can't read it, and nothing cached reads as nothing", async () => {
  secret = StellarSdk.Keypair.random().secret();
  expect(await readCachedBalance("u1")).toBeNull();
  expect(await readCachedBalance("u2")).toBeNull();
});
