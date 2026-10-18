// Bridges the server's WebAuthn JSON options and the browser's
// navigator.credentials API, and serialises the results back.
//
// SECURITY: the PRF output is the passkey's vault secret. Browsers put it in
// getClientExtensionResults(); it is read here and NEVER included in what is
// sent to the server.

import { fromB64u, prfExtensionInput, readPrfOutput, toB64u } from "./crypto";
import type { CreationOptionsJSON, CredentialJSON, RequestOptionsJSON } from "./api";

export class PasskeyCancelledError extends Error {
  constructor() {
    super("Passkey request was cancelled.");
    this.name = "PasskeyCancelledError";
  }
}

export class PasskeyUnsupportedError extends Error {
  constructor() {
    super("This browser does not support passkeys.");
    this.name = "PasskeyUnsupportedError";
  }
}

export interface CreatedCredential {
  response: CredentialJSON;
  /** Present only when the authenticator returned PRF output at creation. */
  prfOutput: Uint8Array | null;
  /** Whether the authenticator supports PRF (even if no output was returned yet). */
  prfEnabled: boolean;
}

export interface AssertedCredential {
  response: CredentialJSON;
  prfOutput: Uint8Array | null;
}

/** The two browser ceremonies, injectable so flows can be tested without a browser. */
export interface Ceremonies {
  create(options: CreationOptionsJSON, wantPrf: boolean): Promise<CreatedCredential>;
  get(options: RequestOptionsJSON, wantPrf: boolean): Promise<AssertedCredential>;
}

// --- options: JSON -> browser -----------------------------------------------

const asBuffer = (b64u: string) => fromB64u(b64u) as BufferSource;

export function toCreationOptions(json: CreationOptionsJSON, wantPrf: boolean): PublicKeyCredentialCreationOptions {
  return {
    ...json,
    challenge: asBuffer(json.challenge),
    user: { ...json.user, id: asBuffer(json.user.id) },
    excludeCredentials: json.excludeCredentials?.map((c) => ({
      ...c,
      id: asBuffer(c.id),
      transports: c.transports as AuthenticatorTransport[] | undefined,
    })),
    extensions: { ...(json.extensions ?? {}), ...(wantPrf ? prfExtensionInput() : {}) } as AuthenticationExtensionsClientInputs,
  };
}

export function toRequestOptions(json: RequestOptionsJSON, wantPrf: boolean): PublicKeyCredentialRequestOptions {
  return {
    ...json,
    challenge: asBuffer(json.challenge),
    allowCredentials: json.allowCredentials?.map((c) => ({
      ...c,
      id: asBuffer(c.id),
      transports: c.transports as AuthenticatorTransport[] | undefined,
    })),
    extensions: { ...(json.extensions ?? {}), ...(wantPrf ? prfExtensionInput() : {}) } as AuthenticationExtensionsClientInputs,
  };
}

// --- results: browser -> JSON -----------------------------------------------

const b64 = (buffer: ArrayBuffer | ArrayBufferView) =>
  toB64u(buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength));

/** Keeps only extension results the server may see. PRF results are dropped. */
export function serverSafeExtensionResults(results: unknown): Record<string, unknown> {
  const r = (results ?? {}) as Record<string, unknown>;
  const safe: Record<string, unknown> = {};
  if (r.credProps && typeof r.credProps === "object") {
    safe.credProps = { rk: (r.credProps as { rk?: unknown }).rk === true };
  }
  return safe;
}

function prfEnabledFrom(results: unknown, output: Uint8Array | null): boolean {
  const enabled = (results as { prf?: { enabled?: unknown } } | null)?.prf?.enabled;
  return enabled === true || output !== null;
}

export function registrationToJSON(credential: PublicKeyCredential): CreatedCredential {
  const r = credential.response as AuthenticatorAttestationResponse;
  const ext = credential.getClientExtensionResults();
  const prfOutput = readPrfOutput(ext);
  return {
    prfOutput,
    prfEnabled: prfEnabledFrom(ext, prfOutput),
    response: {
      id: credential.id,
      rawId: b64(credential.rawId),
      type: credential.type,
      authenticatorAttachment: credential.authenticatorAttachment ?? undefined,
      response: {
        clientDataJSON: b64(r.clientDataJSON),
        attestationObject: b64(r.attestationObject),
        transports: typeof r.getTransports === "function" ? r.getTransports() : [],
      },
      clientExtensionResults: serverSafeExtensionResults(ext),
    },
  };
}

export function assertionToJSON(credential: PublicKeyCredential): AssertedCredential {
  const r = credential.response as AuthenticatorAssertionResponse;
  const ext = credential.getClientExtensionResults();
  return {
    prfOutput: readPrfOutput(ext),
    response: {
      id: credential.id,
      rawId: b64(credential.rawId),
      type: credential.type,
      authenticatorAttachment: credential.authenticatorAttachment ?? undefined,
      response: {
        clientDataJSON: b64(r.clientDataJSON),
        authenticatorData: b64(r.authenticatorData),
        signature: b64(r.signature),
        userHandle: r.userHandle ? b64(r.userHandle) : undefined,
      },
      clientExtensionResults: serverSafeExtensionResults(ext),
    },
  };
}

// --- the real browser ceremonies --------------------------------------------

export function passkeysSupported(): boolean {
  return typeof window !== "undefined" && typeof window.PublicKeyCredential === "function" && !!navigator.credentials;
}

function mapCeremonyError(err: unknown): never {
  if (err instanceof DOMException && (err.name === "NotAllowedError" || err.name === "AbortError")) {
    throw new PasskeyCancelledError();
  }
  throw err;
}

export const browserCeremonies: Ceremonies = {
  async create(options, wantPrf) {
    if (!passkeysSupported()) throw new PasskeyUnsupportedError();
    let credential: Credential | null;
    try {
      credential = await navigator.credentials.create({ publicKey: toCreationOptions(options, wantPrf) });
    } catch (err) {
      mapCeremonyError(err);
    }
    if (!credential) throw new PasskeyCancelledError();
    return registrationToJSON(credential as PublicKeyCredential);
  },

  async get(options, wantPrf) {
    if (!passkeysSupported()) throw new PasskeyUnsupportedError();
    let credential: Credential | null;
    try {
      credential = await navigator.credentials.get({ publicKey: toRequestOptions(options, wantPrf) });
    } catch (err) {
      mapCeremonyError(err);
    }
    if (!credential) throw new PasskeyCancelledError();
    return assertionToJSON(credential as PublicKeyCredential);
  },
};
