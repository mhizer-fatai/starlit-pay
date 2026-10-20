import { beforeEach, describe, expect, test, vi } from "vitest";

const m = vi.hoisted(() => ({
  store: [] as { commitment: string; encrypted_note: string; recipient_viewing_key: string; status: string; root?: string }[],
  transfers: [] as Record<string, string>[],
  events: [] as string[],
}));

vi.mock("@/lib/backend", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/backend")>()),
  fetchNotes: vi.fn(async (viewingKey: string) => ({
    notes: m.store.filter((n) => n.recipient_viewing_key === viewingKey && n.status === "unspent"),
  })),
  postNote: vi.fn(async (note) => {
    m.store.push({ ...note, status: "unspent" });
    return { note };
  }),
  spendNote: vi.fn(async ({ commitment }) => {
    const n = m.store.find((x) => x.commitment === commitment);
    if (n) n.status = "spent";
    return { success: true };
  }),
  submitRelayerTransfer: vi.fn(async (body) => {
    m.transfers.push(body);
    return { success: true, hash: "h" };
  }),
  getPoolRoot: vi.fn(async () => ({ root: "cd".repeat(32) })),
}));

import { encryptNote } from "@/lib/crypto";
import { bytesToHex } from "@/lib/keys";
import { decryptNotePayload } from "@/lib/notes";
import { isSelfCreated, selfNoteSecret } from "@/lib/ownedNotes";
import { createVault } from "@/lib/vault";
import { findForeignNotes, reshieldIncomingNotes, withNoteLock } from "./reshield";

let me: Awaited<ReturnType<typeof createVault>>["keys"];
let counter = 0;

function addNote(asset: string, amount: number, secret: string, n?: string, owner = me) {
  const enc = encryptNote(amount, asset, secret, "someone", owner.viewing.publicKey, n ? { n } : undefined);
  m.store.push({
    commitment: `c${counter++}`.padEnd(64, "0"),
    encrypted_note: enc.ephemeralPublicKey + enc.nonce + enc.ciphertext,
    recipient_viewing_key: owner.viewing.publicKey,
    status: "unspent",
  });
}
const randomSecret = () => bytesToHex(crypto.getRandomValues(new Uint8Array(32)));

beforeEach(async () => {
  m.store.length = 0;
  m.transfers.length = 0;
  m.events.length = 0;
  me = (await createVault()).keys;
});

describe("self-created note secrets", () => {
  test("only the owner's spending key reproduces them", async () => {
    const { secret, n } = await selfNoteSecret(me.spendingKey);
    expect(await isSelfCreated(me.spendingKey, { secret, n })).toBe(true);

    const other = (await createVault()).keys;
    expect(await isSelfCreated(other.spendingKey, { secret, n })).toBe(false);
  });

  test("a sender cannot fake one: a nonce with any other secret is rejected", async () => {
    const n = bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
    expect(await isSelfCreated(me.spendingKey, { secret: randomSecret(), n })).toBe(false);
    expect(await isSelfCreated(me.spendingKey, { secret: randomSecret() })).toBe(false);
    expect(await isSelfCreated(me.spendingKey, { secret: randomSecret(), n: "not-hex" })).toBe(false);
  });
});

describe("re-shielding", () => {
  test("moves notes created by others into ones only the user can spend; leaves own notes alone", async () => {
    addNote("XLM", 10, randomSecret()); // e.g. a gateway deposit
    addNote("XLM", 5, randomSecret()); // e.g. a payment from another user
    addNote("USDC", 20, randomSecret()); // e.g. the faucet
    const own = await selfNoteSecret(me.spendingKey);
    addNote("XLM", 7, own.secret, own.n); // the user's own change note

    const moved = await reshieldIncomingNotes({ keys: me, username: "alice" });
    expect(moved).toBe(2); // XLM pair + USDC single
    expect(m.transfers).toHaveLength(2);

    const unspent = m.store.filter((n) => n.status === "unspent");
    const plain = unspent.map((n) => decryptNotePayload(n.encrypted_note, me.viewing.secretKey)!);
    for (const p of plain) expect(await isSelfCreated(me.spendingKey, p)).toBe(true);
    const totals = plain.reduce<Record<string, number>>((acc, p) => ({ ...acc, [p.asset]: (acc[p.asset] ?? 0) + p.amount }), {});
    expect(totals).toEqual({ XLM: 22, USDC: 20 });

    // Nothing foreign remains, so a second run does nothing.
    expect(await reshieldIncomingNotes({ keys: me, username: "alice" })).toBe(0);
  });

  test("ignores notes encrypted to someone else", async () => {
    const other = (await createVault()).keys;
    addNote("XLM", 3, randomSecret(), undefined, other);
    const foreign = await findForeignNotes(me);
    expect(foreign.XLM).toHaveLength(0);
  });

  test("spends against a valid pool root when the note has none", async () => {
    addNote("XLM", 1, randomSecret());
    await reshieldIncomingNotes({ keys: me, username: "alice" });
    expect(m.transfers[0].root).toBe("cd".repeat(32));
  });
});

describe("note lock", () => {
  test("note-spending tasks never overlap", async () => {
    const task = (name: string, ms: number) => () =>
      new Promise<void>((resolve) => {
        m.events.push(`${name}:start`);
        setTimeout(() => {
          m.events.push(`${name}:end`);
          resolve();
        }, ms);
      });
    await Promise.all([withNoteLock(task("reshield", 30)), withNoteLock(task("send", 5))]);
    expect(m.events).toEqual(["reshield:start", "reshield:end", "send:start", "send:end"]);
  });

  test("a failed task does not block the next one", async () => {
    await expect(withNoteLock(async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    await expect(withNoteLock(async () => "ok")).resolves.toBe("ok");
  });
});
