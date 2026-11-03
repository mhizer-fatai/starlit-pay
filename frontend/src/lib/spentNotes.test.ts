import { beforeEach, describe, expect, it, vi } from "vitest";

const backend = vi.hoisted(() => ({ spendNote: vi.fn(async () => ({ success: true })) }));
vi.mock("@/lib/backend", () => backend);

import { calculateNullifier } from "@/lib/zk";
import { spentOnChain, withoutSpentOnChain } from "@/lib/spentNotes";

const note = (commitment: string) => ({ commitment, secret: `secret-${commitment}`, amount: 1 });

describe("notes spent on chain", () => {
  beforeEach(() => backend.spendNote.mockClear());

  it("asks the pool about each note's own nullifier", async () => {
    const asked: string[] = [];
    await spentOnChain([note("a1")], async (nullifier) => {
      asked.push(nullifier);
      return false;
    });
    expect(asked).toEqual([await calculateNullifier("secret-a1", "a1")]);
  });

  it("drops spent notes and corrects the backend record", async () => {
    const spentNullifier = await calculateNullifier("secret-b2", "b2");
    const kept = await withoutSpentOnChain([note("b1"), note("b2")], async (n) => n === spentNullifier);
    expect(kept.map((n) => n.commitment)).toEqual(["b1"]);
    expect(backend.spendNote).toHaveBeenCalledWith({ commitment: "b2" });
  });

  it("keeps a note it could not check", async () => {
    const kept = await withoutSpentOnChain([note("c1")], async () => {
      throw new Error("rpc down");
    });
    expect(kept).toHaveLength(1);
    expect(backend.spendNote).not.toHaveBeenCalled();
  });

  it("never asks again about a note found spent", async () => {
    const check = vi.fn(async () => true);
    await spentOnChain([note("d1")], check);
    await spentOnChain([note("d1")], check);
    expect(check).toHaveBeenCalledTimes(1);
  });
});
