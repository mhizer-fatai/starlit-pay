import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ComplianceUnavailableError, createComplianceChecker } from "../src/compliance.js";

const silent = () => undefined;
const checker = (queryContract, extra = {}) => createComplianceChecker({ queryContract, warn: silent, ...extra });
const down = async () => {
  throw new Error("rpc down");
};

describe("address screening", () => {
  test("blocks listed addresses without asking the contract", async () => {
    let asked = false;
    const isBlocked = checker(
      async () => {
        asked = true;
        return false;
      },
      { sanctionList: new Set(["GBAD"]) }
    );
    assert.equal(await isBlocked("GBAD"), true);
    assert.equal(asked, false);
  });

  test("returns the contract's answer and caches it", async () => {
    let queries = 0;
    let time = 0;
    const isBlocked = checker(
      async (address) => {
        queries += 1;
        return address === "GBLOCKED";
      },
      { now: () => time, cacheTtlMs: 100 }
    );
    assert.equal(await isBlocked("GBLOCKED"), true);
    assert.equal(await isBlocked("GCLEAN"), false);
    assert.equal(await isBlocked("GCLEAN"), false);
    assert.equal(queries, 2);
    time = 101;
    await isBlocked("GCLEAN");
    assert.equal(queries, 3);
  });

  test("withdrawals are refused when the contract can't answer", async () => {
    await assert.rejects(() => checker(down)("GADDR", { failClosed: true }), ComplianceUnavailableError);
  });

  test("other callers keep working when the contract can't answer", async () => {
    assert.equal(await checker(down)("GADDR"), false);
  });

  test("an outage is never cached as a clean result", async () => {
    let healthy = false;
    const isBlocked = checker(async () => {
      if (!healthy) throw new Error("rpc down");
      return true;
    });
    assert.equal(await isBlocked("GADDR"), false);
    healthy = true;
    assert.equal(await isBlocked("GADDR"), true);
  });

  test("with no contract configured, only the local list applies", async () => {
    assert.equal(await checker(null)("GADDR", { failClosed: true }), false);
  });
});
