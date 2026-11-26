import { expect, test } from "vitest";
import { refreshOnce } from "@/lib/sessionRefresh";

test("refreshes running at the same moment share one request (a refresh token works once)", async () => {
  let calls = 0;
  let finish: (ok: boolean) => void = () => {};
  const refresh = () => {
    calls++;
    return new Promise<boolean>((resolve) => (finish = resolve));
  };
  const first = refreshOnce(refresh);
  const second = refreshOnce(refresh);
  expect(second).toBe(first);
  finish(true);
  expect(await first).toBe(true);
  expect(calls).toBe(1);
  // Once done, the next expiry can refresh again.
  const third = refreshOnce(async () => (calls++, false));
  expect(await third).toBe(false);
  expect(calls).toBe(2);
});

test("another tab having just refreshed counts as refreshed", async () => {
  const { refreshSucceeded } = await import("@/lib/sessionRefresh");
  expect(refreshSucceeded({ ok: true, status: 200 })).toBe(true);
  expect(refreshSucceeded({ ok: false, status: 409 })).toBe(true);
  expect(refreshSucceeded({ ok: false, status: 401 })).toBe(false);
});

test("tabs take turns refreshing when the browser has Web Locks", async () => {
  const held: string[] = [];
  const locks = { request: async (name: string, run: () => Promise<boolean>) => (held.push(name), run()) };
  Object.defineProperty(globalThis, "navigator", { value: { locks }, configurable: true });
  try {
    expect(await refreshOnce(async () => true)).toBe(true);
    expect(held).toEqual(["starlit-session-refresh"]);
  } finally {
    Object.defineProperty(globalThis, "navigator", { value: undefined, configurable: true });
  }
});
