import { beforeEach, expect, test, vi } from "vitest";

// Old notes, as getSpendableNotes returns them; a withdrawal spends the first two.
let notes: { commitment: string; amount: number; asset: string }[] = [];
const withdrawals: { asset: string; amount: number; recipient: string; unrecorded?: boolean }[] = [];
let failWith: Error | null = null;
let lagging = false;

class BackendError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}
vi.mock("@/lib/backend", () => ({ BackendError, fetchGatewayAddress: async () => ({ address: "GGATEWAY" }), fetchNotes: async () => ({ notes: [] }) }));
vi.mock("@/lib/auth", () => ({ getViewingSecret: () => "viewing-secret" }));
vi.mock("@/lib/notes", () => ({ getSpendableNotes: (_n: unknown, _s: unknown, asset: string) => notes.filter((n) => n.asset === asset) }));
vi.mock("@/lib/spentNotes", () => ({ withoutSpentOnChain: async (list: unknown) => list }));
vi.mock("@/lib/privateWallet", () => ({ MIN_DEPOSIT: 0.1 }));
vi.mock("@/lib/privateWithdraw", () => ({
  withdrawFromPool: async (input: { asset: string; amount: number; recipient: string; unrecorded?: boolean; exclude?: ReadonlySet<string> }) => {
    if (failWith) throw failWith;
    withdrawals.push({ asset: input.asset, amount: input.amount, recipient: input.recipient, unrecorded: input.unrecorded });
    const mine = notes.filter((n) => n.asset === input.asset && !input.exclude?.has(n.commitment)).slice(0, 2);
    // Like the real database: spent notes may still be listed for a moment.
    if (!lagging) notes = notes.filter((n) => !mine.includes(n));
    return "hash";
  },
}));

const { loadOldBalance, moveOldBalance } = await import("@/lib/zkMigration");
const user = { email: "a@x", public_encryption_key: "key" } as never;
const note = (amount: number, asset = "XLM") => ({ commitment: `${asset}${amount}`, amount, asset });

beforeEach(() => {
  withdrawals.length = 0;
  failWith = null;
  lagging = false;
});

test("moves old notes to the gateway two at a time, whole, without recording them as payments", async () => {
  notes = [note(10), note(5), note(2.5), note(20, "USDC")];
  expect(await loadOldBalance(user)).toEqual({ xlm: 17.5, usdc: 20 });
  expect(await moveOldBalance(user)).toEqual({ moved: 3 });
  expect(withdrawals).toEqual([
    { asset: "XLM", amount: 15, recipient: "GGATEWAY", unrecorded: true },
    { asset: "XLM", amount: 2.5, recipient: "GGATEWAY", unrecorded: true },
    { asset: "USDC", amount: 20, recipient: "GGATEWAY", unrecorded: true },
  ]);
  expect(await loadOldBalance(user)).toEqual({ xlm: 0, usdc: 0 });
});

test("leaves amounts below the new pool's minimum deposit", async () => {
  notes = [note(0.05)];
  expect(await moveOldBalance(user)).toEqual({ moved: 0 });
  expect(withdrawals).toEqual([]);
});

test("asks the user to confirm when the session needs a fresh passkey or PIN", async () => {
  notes = [note(10)];
  failWith = new BackendError(401, "Please confirm this payment with your passkey or PIN.");
  expect(await moveOldBalance(user)).toEqual({ moved: 0, needsConfirmation: true });
});

test("a step that keeps failing is retried once, then the move stops without throwing", async () => {
  notes = [note(10)];
  failWith = new Error("network down");
  expect(await moveOldBalance(user, () => {}, { retryDelayMs: 0 })).toEqual({ moved: 0, failed: true });
});

test("notes sent in this run are never sent again, even while the database still lists them", async () => {
  lagging = true;
  notes = [note(10), note(5), note(3)];
  expect(await moveOldBalance(user)).toEqual({ moved: 2 });
  expect(withdrawals.map((w) => w.amount)).toEqual([15, 3]);
});

test("leftovers below the new pool's minimum don't count as a balance to move", async () => {
  notes = [note(0.01), note(0.02, "USDC")];
  expect(await loadOldBalance(user)).toEqual({ xlm: 0, usdc: 0 });
});
