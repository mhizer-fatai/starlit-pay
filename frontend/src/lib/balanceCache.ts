// The last private balance seen on this device, shown while the pools sync.
// Encrypted with a key from the user's wallet, so it is never stored in the
// clear; its "starlit" prefix means sign-out wipes it (clearSession).

import * as StellarSdk from "@stellar/stellar-sdk";

import { getUnlockedKeys } from "@/lib/auth";
import { hkdf } from "@/lib/vault/crypto";

export interface CachedBalance {
  xlm: number;
  usdc: number;
}

const storageKey = (userId: string) => `starlit_balance_${userId}`;
const toB64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromB64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

async function cacheKey(): Promise<CryptoKey | null> {
  const secret = getUnlockedKeys()?.stellar.secretKey;
  if (!secret) return null;
  const raw = await hkdf(new Uint8Array(StellarSdk.Keypair.fromSecret(secret).rawSecretKey()), "balance-cache");
  return crypto.subtle.importKey("raw", raw as BufferSource, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function readCachedBalance(userId: string): Promise<CachedBalance | null> {
  try {
    const stored = localStorage.getItem(storageKey(userId));
    const key = stored && (await cacheKey());
    if (!stored || !key) return null;
    const { iv, data } = JSON.parse(stored) as { iv: string; data: string };
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(iv) as BufferSource }, key, fromB64(data) as BufferSource);
    const balance = JSON.parse(new TextDecoder().decode(plain)) as CachedBalance;
    return Number.isFinite(balance.xlm) && Number.isFinite(balance.usdc) ? balance : null;
  } catch {
    return null;
  }
}

export async function writeCachedBalance(userId: string, balance: CachedBalance): Promise<void> {
  try {
    const key = await cacheKey();
    if (!key) return;
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plain = new TextEncoder().encode(JSON.stringify({ xlm: balance.xlm, usdc: balance.usdc }));
    const data = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource }, key, plain as BufferSource));
    localStorage.setItem(storageKey(userId), JSON.stringify({ iv: toB64(iv), data: toB64(data) }));
  } catch {
    /* storage unavailable: just no cache */
  }
}
