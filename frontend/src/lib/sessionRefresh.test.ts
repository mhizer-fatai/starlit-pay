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
