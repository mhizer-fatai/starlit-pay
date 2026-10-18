import crypto from "node:crypto";
import express from "express";
import { createAuthLayer } from "../../src/auth_layer/index.js";
import { createMemoryStore } from "../../src/auth_layer/store_memory.js";

export const ORIGIN = "http://localhost:5173";

export const TEST_ENV = {
  AUTH_SESSION_SECRET: "test-session-secret-0123456789-abcdefghij",
  PIN_PEPPER_KEY: "11".repeat(32),
  WEBAUTHN_RP_ID: "localhost",
  WEBAUTHN_ORIGINS: ORIGIN,
  COOKIE_SECURE: "false",
};

/** Boots the auth layer on an ephemeral port with an in-memory store and a virtual clock. */
export async function startHarness({ env = TEST_ENV } = {}) {
  const clock = { t: Date.parse("2026-10-17T12:00:00Z") };
  const now = () => clock.t;
  const alice = {
    id: crypto.randomUUID(),
    email: "alice@example.com",
    username: "alice",
    display_name: "Alice",
    identity_commitment: "legacy-secret",
    public_encryption_key: "pk",
  };
  const store = createMemoryStore({ now, users: [alice] });
  const emailTokens = new Map([["google-token-alice", alice.email]]);
  const identity = { verifyEmail: async (token) => emailTokens.get(token) ?? null };

  const layer = createAuthLayer({ store, identity, env, settings: { now } });
  const app = express();
  app.use(layer.router);

  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  return {
    base,
    store,
    layer,
    alice,
    emailTokens,
    clock,
    advance: (ms) => {
      clock.t += ms;
    },
    client: () => new Client(base),
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

/** Minimal browser stand-in: keeps a cookie jar and sends the CSRF header by default. */
export class Client {
  constructor(base) {
    this.base = base;
    this.jar = new Map();
  }

  async req(method, path, { body, headers = {}, csrf = true } = {}) {
    const h = { "content-type": "application/json", ...headers };
    if (csrf) h["x-requested-with"] = "starlit";
    if (this.jar.size) h.cookie = [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ");
    const res = await fetch(this.base + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
    for (const raw of res.headers.getSetCookie()) {
      const [pair, ...attrs] = raw.split(";").map((p) => p.trim());
      const eq = pair.indexOf("=");
      const name = pair.slice(0, eq);
      const value = decodeURIComponent(pair.slice(eq + 1));
      const expired = attrs.some((a) => /^expires=/i.test(a) && new Date(a.slice(8)).getTime() < Date.now());
      if (!value || expired) this.jar.delete(name);
      else this.jar.set(name, value);
    }
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = text;
    }
    return { status: res.status, body: json, headers: res.headers };
  }

  post(path, body, opts = {}) {
    return this.req("POST", path, { ...opts, body });
  }
  get(path, opts = {}) {
    return this.req("GET", path, opts);
  }
}
