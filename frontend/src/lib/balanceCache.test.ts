import { expect, test, vi } from "vitest";
import { readCachedBalance, writeCachedBalance } from "@/lib/balanceCache";

const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
});
const newKey = () => crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);

test("the last balance comes back on this device without unlocking, stored encrypted", async () => {
  const key = await newKey();
  await writeCachedBalance("u1", { xlm: 6308.64, usdc: 298.97 }, async () => key);
  expect(await readCachedBalance("u1", async () => key)).toEqual({ xlm: 6308.64, usdc: 298.97 });
  const stored = store.get("starlit_balance_u1")!;
  expect(stored).not.toContain("6308");
  expect(stored).not.toContain("298");
});

test("another device's key can't read it; no cache or no key reads as nothing", async () => {
  const other = await newKey();
  expect(await readCachedBalance("u1", async () => other)).toBeNull();
  expect(await readCachedBalance("u2", async () => other)).toBeNull();
  expect(await readCachedBalance("u1", async () => null)).toBeNull();
});
