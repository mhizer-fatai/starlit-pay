// The last private balance seen on this device, shown at once on the next
// visit while the pools sync (before the wallet is even unlocked).
//
// Encrypted with a device key that the browser keeps as a non-exportable
// CryptoKey in IndexedDB, so the balance is never stored in the clear and
// the key can't be copied out. The "starlit" prefix means sign-out wipes the
// stored balance (clearSession).

export interface CachedBalance {
  xlm: number;
  usdc: number;
}

type KeySource = () => Promise<CryptoKey | null>;

const storageKey = (userId: string) => `starlit_balance_${userId}`;
const toB64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromB64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

const DB = "starlit-device";
const STORE = "keys";
const KEY_ID = "balance-cache";

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

let deviceKey: Promise<CryptoKey | null> | null = null;

/** This browser's own key, created once; null where IndexedDB isn't available. */
function browserDeviceKey(): Promise<CryptoKey | null> {
  deviceKey ??= (async () => {
    const open = indexedDB.open(DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE);
    const db = await request(open);
    const existing = (await request(db.transaction(STORE).objectStore(STORE).get(KEY_ID))) as CryptoKey | undefined;
    if (existing) return existing;
    const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    await request(db.transaction(STORE, "readwrite").objectStore(STORE).put(key, KEY_ID));
    return key;
  })().catch(() => null);
  return deviceKey;
}

export async function readCachedBalance(userId: string, getKey: KeySource = browserDeviceKey): Promise<CachedBalance | null> {
  try {
    const stored = localStorage.getItem(storageKey(userId));
    const key = stored && (await getKey());
    if (!stored || !key) return null;
    const { iv, data } = JSON.parse(stored) as { iv: string; data: string };
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(iv) as BufferSource }, key, fromB64(data) as BufferSource);
    const balance = JSON.parse(new TextDecoder().decode(plain)) as CachedBalance;
    return Number.isFinite(balance.xlm) && Number.isFinite(balance.usdc) ? balance : null;
  } catch {
    return null;
  }
}

export async function writeCachedBalance(userId: string, balance: CachedBalance, getKey: KeySource = browserDeviceKey): Promise<void> {
  try {
    const key = await getKey();
    if (!key) return;
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plain = new TextEncoder().encode(JSON.stringify({ xlm: balance.xlm, usdc: balance.usdc }));
    const data = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource }, key, plain as BufferSource));
    localStorage.setItem(storageKey(userId), JSON.stringify({ iv: toB64(iv), data: toB64(data) }));
  } catch {
    /* storage unavailable: just no cache */
  }
}
