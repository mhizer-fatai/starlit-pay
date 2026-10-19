// Typed client for the passkey auth layer (backend/src/auth_layer).
//
// Sessions live in httpOnly cookies the page cannot read: every request sends
// `credentials: "include"` and the CSRF header the backend requires on
// cookie-authenticated writes. A 401 for an expired session triggers one
// refresh (shared by concurrent requests) and a single retry.

import type { Argon2Params } from "./crypto";

export const CSRF_HEADER = "X-Requested-With";
export const CSRF_VALUE = "starlit";
export const EMAIL_PROOF_HEADER = "X-Supabase-Auth";

export class AuthApiError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly retryAfterSec: number | null;
  readonly attemptsRemaining: number | null;

  constructor(status: number, message: string, body: Record<string, unknown> | null) {
    super(message);
    this.name = "AuthApiError";
    this.status = status;
    this.code = typeof body?.code === "string" ? body.code : null;
    this.retryAfterSec = typeof body?.retryAfterSec === "number" ? body.retryAfterSec : null;
    this.attemptsRemaining = typeof body?.attemptsRemaining === "number" ? body.attemptsRemaining : null;
  }
}

// --- response shapes --------------------------------------------------------

export interface AuthUser {
  id: string;
  email: string;
  username: string;
  display_name?: string | null;
  avatar_url?: string | null;
  stellar_address?: string | null;
  public_encryption_key?: string | null;
  [key: string]: unknown;
}

export interface PublicPasskey {
  id: string;
  deviceName: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  backedUp: boolean;
  prfEnabled: boolean;
  pending: boolean;
}

export interface EncryptedVault {
  encryptedSeed: string;
  version: number;
}

/** WebAuthn options as JSON, exactly as @simplewebauthn/server returns them. */
export interface CreationOptionsJSON {
  challenge: string;
  rp: { id?: string; name: string };
  user: { id: string; name: string; displayName: string };
  pubKeyCredParams: { type: "public-key"; alg: number }[];
  timeout?: number;
  excludeCredentials?: { id: string; type: "public-key"; transports?: string[] }[];
  authenticatorSelection?: AuthenticatorSelectionCriteria;
  attestation?: AttestationConveyancePreference;
  extensions?: Record<string, unknown>;
}

export interface RequestOptionsJSON {
  challenge: string;
  rpId?: string;
  timeout?: number;
  allowCredentials?: { id: string; type: "public-key"; transports?: string[] }[];
  userVerification?: UserVerificationRequirement;
  extensions?: Record<string, unknown>;
}

/** A credential serialised for the server (never contains PRF output). */
export type CredentialJSON = Record<string, unknown> & { id: string };

export interface SessionInfo {
  user: AuthUser;
  amr: string[];
  authTime: number;
  fresh: boolean;
}

export interface VaultStatus {
  exists: boolean;
  version: number | null;
  passkeyWraps: string[];
  pin: { configured: boolean; locked: boolean };
  recovery: { configured: boolean };
}

export interface PasskeyLoginResult {
  user: AuthUser;
  passkeyId: string;
  vault: EncryptedVault | null;
  wrappedDek: string | null;
}

export interface PinUnlockResult {
  user: AuthUser;
  serverShare: string;
  vault: EncryptedVault | null;
  wrappedDek: string | null;
}

export interface PinSetupTicket {
  ticket: string;
  salt: string;
  params: Argon2Params;
  serverShare: string;
}

// --- client -----------------------------------------------------------------

export interface AuthApiOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch;
}

interface CallOptions {
  body?: unknown;
  emailProof?: string | null;
}

const RETRYABLE_SESSION_CODES = new Set(["no_session", "invalid_session"]);

export function createAuthApi({ baseUrl, fetchImpl }: AuthApiOptions) {
  const doFetch = fetchImpl ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  let refreshing: Promise<boolean> | null = null;

  async function send(method: string, path: string, { body, emailProof }: CallOptions) {
    const headers: Record<string, string> = { [CSRF_HEADER]: CSRF_VALUE };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (emailProof) headers[EMAIL_PROOF_HEADER] = emailProof;
    return doFetch(`${baseUrl}${path}`, {
      method,
      credentials: "include",
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  async function parse<T>(res: Response): Promise<T> {
    let json: Record<string, unknown> | null = null;
    try {
      json = (await res.json()) as Record<string, unknown>;
    } catch {
      json = null;
    }
    if (!res.ok) {
      const message = typeof json?.error === "string" ? json.error : `Request failed (${res.status})`;
      throw new AuthApiError(res.status, message, json);
    }
    return json as T;
  }

  /** Rotates the refresh cookie. Concurrent callers share one request. */
  function refreshSession(): Promise<boolean> {
    if (!refreshing) {
      refreshing = send("POST", "/api/auth/refresh", {})
        .then((res) => res.ok)
        .catch(() => false)
        .finally(() => {
          refreshing = null;
        });
    }
    return refreshing;
  }

  async function call<T>(method: string, path: string, options: CallOptions = {}): Promise<T> {
    const res = await send(method, path, options);
    if (res.status === 401) {
      const peek = await res.clone().json().catch(() => null);
      if (RETRYABLE_SESSION_CODES.has(peek?.code) && (await refreshSession())) {
        return parse<T>(await send(method, path, options));
      }
    }
    return parse<T>(res);
  }

  return {
    refreshSession,

    // session
    getSession: () => call<SessionInfo>("GET", "/api/auth/session"),
    logout: () => call<{ ok: true }>("POST", "/api/auth/logout"),

    // passkeys
    /** es256Only: the passkey must also control an on-chain smart wallet (Stellar verifies P-256 only). */
    passkeyRegisterOptions: (emailProof?: string | null, opts: { es256Only?: boolean } = {}) =>
      call<{ challengeId: string; options: CreationOptionsJSON }>("POST", "/api/auth/passkey/register/options", {
        body: opts.es256Only ? { es256Only: true } : {},
        emailProof,
      }),
    passkeyRegisterVerify: (body: { challengeId: string; response: CredentialJSON; deviceName?: string; prfEnabled: boolean }) =>
      call<{ passkey: PublicPasskey; user: AuthUser }>("POST", "/api/auth/passkey/register/verify", { body }),
    passkeyLoginOptions: (purpose: "login" | "stepup") =>
      call<{ challengeId: string; options: RequestOptionsJSON }>("POST", "/api/auth/passkey/login/options", { body: { purpose } }),
    passkeyLoginVerify: <T = PasskeyLoginResult | { ok: true }>(body: { challengeId: string; response: CredentialJSON }) =>
      call<T>("POST", "/api/auth/passkey/login/verify", { body }),
    listPasskeys: () => call<{ passkeys: PublicPasskey[] }>("GET", "/api/auth/passkeys"),
    removePasskey: (id: string) => call<{ ok: true }>("DELETE", `/api/auth/passkeys/${encodeURIComponent(id)}`),

    // vault
    getVaultStatus: () => call<VaultStatus>("GET", "/api/vault"),
    /** profileBound: the profile already holds this vault's public keys (new sign-ups). */
    createVault: (body: { encryptedSeed: string; version?: 1; passkeyWrap?: { passkeyId: string; wrappedDek: string }; profileBound?: boolean }) =>
      call<{ ok: true }>("POST", "/api/vault", { body: { version: 1, ...body } }),
    putPasskeyWrap: (passkeyId: string, wrappedDek: string) =>
      call<{ ok: true }>("PUT", `/api/vault/wraps/passkey/${encodeURIComponent(passkeyId)}`, { body: { wrappedDek } }),

    // PIN
    pinSetupBegin: () => call<PinSetupTicket>("POST", "/api/vault/pin/setup/begin", { body: {} }),
    pinSetupComplete: (body: { ticket: string; pinVerifier: string; wrappedDek: string }) =>
      call<{ ok: true }>("POST", "/api/vault/pin/setup/complete", { body }),
    pinSalt: (emailProof?: string | null) =>
      call<{ salt: string; params: Argon2Params }>("POST", "/api/vault/pin/salt", { body: {}, emailProof }),
    pinUnlock: (pinVerifier: string, emailProof?: string | null) =>
      call<PinUnlockResult>("POST", "/api/vault/pin/unlock", { body: { pinVerifier }, emailProof }),

    // recovery code
    setRecovery: (body: { codeVerifier: string; wrappedDek: string }) =>
      call<{ ok: true }>("POST", "/api/vault/recovery", { body }),
    recoveryUnlock: (codeVerifier: string, emailProof: string) =>
      call<{ user: AuthUser; vault: EncryptedVault | null; wrappedDek: string | null }>("POST", "/api/vault/recovery/unlock", { body: { codeVerifier }, emailProof }),

    // migration from email+PIN keys: point the profile at the vault keys (once)
    bindProfileKeys: (body: { publicEncryptionKey: string; stellarAddress: string; identityCommitment: string }) =>
      call<{ user: AuthUser }>("POST", "/api/vault/migrate/profile-keys", { body }),
  };
}

export type AuthApi = ReturnType<typeof createAuthApi>;
