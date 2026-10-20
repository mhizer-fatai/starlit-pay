import { describe, expect, test } from "vitest";

import { AuthApiError, createAuthApi } from "./api";

type Call = { url: string; init: RequestInit };

/** Scripted fetch: each entry answers one request in order. */
function scripted(responses: { status: number; body?: unknown }[]) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (!next) throw new Error(`unexpected request ${init.method} ${url}`);
    return new Response(next.body === undefined ? null : JSON.stringify(next.body), {
      status: next.status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

const headersOf = (call: Call) => call.init.headers as Record<string, string>;

describe("auth API client", () => {
  test("sends cookies, the CSRF header and JSON", async () => {
    const { calls, fetchImpl } = scripted([{ status: 200, body: { ok: true } }]);
    const api = createAuthApi({ baseUrl: "https://api.test", fetchImpl });
    await api.createVault({ encryptedSeed: "x".repeat(60) });

    expect(calls[0].url).toBe("https://api.test/api/vault");
    expect(calls[0].init.credentials).toBe("include");
    expect(headersOf(calls[0])["X-Requested-With"]).toBe("starlit");
    expect(headersOf(calls[0])["Content-Type"]).toBe("application/json");
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ version: 1, encryptedSeed: "x".repeat(60) });
  });

  test("attaches email proof only when given", async () => {
    const { calls, fetchImpl } = scripted([
      { status: 200, body: { salt: "s", params: {} } },
      { status: 200, body: { salt: "s", params: {} } },
    ]);
    const api = createAuthApi({ baseUrl: "", fetchImpl });
    await api.pinSalt("google-token");
    await api.pinSalt(null);
    expect(headersOf(calls[0])["X-Supabase-Auth"]).toBe("google-token");
    expect(headersOf(calls[1])["X-Supabase-Auth"]).toBeUndefined();
  });

  test("refreshes once and retries when the session expired", async () => {
    const { calls, fetchImpl } = scripted([
      { status: 401, body: { code: "no_session" } },
      { status: 200, body: { ok: true } },
      { status: 200, body: { exists: true } },
    ]);
    const api = createAuthApi({ baseUrl: "", fetchImpl });
    await expect(api.getVaultStatus()).resolves.toEqual({ exists: true });
    expect(calls.map((c) => `${c.init.method} ${c.url}`)).toEqual(["GET /api/vault", "POST /api/auth/refresh", "GET /api/vault"]);
  });

  test("concurrent expired requests share a single refresh", async () => {
    const { calls, fetchImpl } = scripted([
      { status: 401, body: { code: "invalid_session" } },
      { status: 401, body: { code: "invalid_session" } },
      { status: 200, body: { ok: true } },
      { status: 200, body: { passkeys: [] } },
      { status: 200, body: { passkeys: [] } },
    ]);
    const api = createAuthApi({ baseUrl: "", fetchImpl });
    await Promise.all([api.listPasskeys(), api.listPasskeys()]);
    expect(calls.filter((c) => c.url === "/api/auth/refresh")).toHaveLength(1);
  });

  test("gives up when the refresh fails", async () => {
    const { calls, fetchImpl } = scripted([
      { status: 401, body: { code: "no_session", error: "Not signed in." } },
      { status: 401, body: { code: "invalid_session" } },
    ]);
    const api = createAuthApi({ baseUrl: "", fetchImpl });
    await expect(api.getSession()).rejects.toMatchObject({ status: 401, code: "no_session" });
    expect(calls).toHaveLength(2);
  });

  test("does not refresh on other 401s, such as a wrong PIN", async () => {
    const { calls, fetchImpl } = scripted([
      { status: 401, body: { code: "pin_incorrect", error: "Incorrect PIN.", attemptsRemaining: 3 } },
    ]);
    const api = createAuthApi({ baseUrl: "", fetchImpl });
    const err = await api.pinUnlock("v").catch((e) => e);
    expect(err).toBeInstanceOf(AuthApiError);
    expect(err).toMatchObject({ status: 401, code: "pin_incorrect", attemptsRemaining: 3, message: "Incorrect PIN." });
    expect(calls).toHaveLength(1);
  });

  test("exposes lockout timing", async () => {
    const { fetchImpl } = scripted([{ status: 429, body: { code: "pin_locked", retryAfterSec: 900, error: "Too many" } }]);
    const api = createAuthApi({ baseUrl: "", fetchImpl });
    await expect(api.pinUnlock("v")).rejects.toMatchObject({ status: 429, code: "pin_locked", retryAfterSec: 900 });
  });
});
