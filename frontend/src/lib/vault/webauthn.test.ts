import { describe, expect, test } from "vitest";

import { fromB64u, PRF_SALT, randomBytes, toB64u } from "./crypto";
import {
  assertionToJSON,
  registrationToJSON,
  serverSafeExtensionResults,
  toCreationOptions,
  toRequestOptions,
} from "./webauthn";

const buf = (bytes: Uint8Array) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

function fakeCredential(kind: "create" | "get", extensionResults: unknown): PublicKeyCredential {
  const rawId = randomBytes(32);
  const common = { clientDataJSON: buf(randomBytes(40)) };
  const response =
    kind === "create"
      ? { ...common, attestationObject: buf(randomBytes(80)), getTransports: () => ["internal", "hybrid"] }
      : { ...common, authenticatorData: buf(randomBytes(37)), signature: buf(randomBytes(70)), userHandle: buf(randomBytes(16)) };
  return {
    id: toB64u(rawId),
    rawId: buf(rawId),
    type: "public-key",
    authenticatorAttachment: "platform",
    response,
    getClientExtensionResults: () => extensionResults,
  } as unknown as PublicKeyCredential;
}

describe("options conversion", () => {
  test("decodes base64url fields and adds the PRF input when asked", () => {
    const challenge = randomBytes(32);
    const userId = randomBytes(16);
    const exclude = randomBytes(32);
    const opts = toCreationOptions(
      {
        challenge: toB64u(challenge),
        rp: { id: "starlitpay.xyz", name: "Starlit Pay" },
        user: { id: toB64u(userId), name: "alice", displayName: "Alice" },
        pubKeyCredParams: [{ type: "public-key", alg: -7 }],
        excludeCredentials: [{ id: toB64u(exclude), type: "public-key", transports: ["internal"] }],
      },
      true
    );
    expect(new Uint8Array(opts.challenge as ArrayBuffer)).toEqual(challenge);
    expect(new Uint8Array(opts.user.id as ArrayBuffer)).toEqual(userId);
    expect(new Uint8Array(opts.excludeCredentials![0].id as ArrayBuffer)).toEqual(exclude);
    expect((opts.extensions as { prf: { eval: { first: Uint8Array } } }).prf.eval.first).toBe(PRF_SALT);

    const noPrf = toRequestOptions({ challenge: toB64u(challenge) }, false);
    expect((noPrf.extensions as Record<string, unknown>).prf).toBeUndefined();
  });
});

describe("PRF output never reaches the server", () => {
  const prf = randomBytes(32);
  const prfB64u = toB64u(prf);
  const leaky = { prf: { enabled: true, results: { first: buf(prf) } }, credProps: { rk: true } };

  test("registration: PRF is returned locally and stripped from the payload", () => {
    const out = registrationToJSON(fakeCredential("create", leaky));
    expect(out.prfOutput).toEqual(prf);
    expect(out.prfEnabled).toBe(true);
    const wire = JSON.stringify(out.response);
    expect(wire).not.toContain("prf");
    expect(wire).not.toContain(prfB64u);
    expect(out.response.clientExtensionResults).toEqual({ credProps: { rk: true } });
  });

  test("authentication: PRF is returned locally and stripped from the payload", () => {
    const out = assertionToJSON(fakeCredential("get", leaky));
    expect(out.prfOutput).toEqual(prf);
    const wire = JSON.stringify(out.response);
    expect(wire).not.toContain("prf");
    expect(wire).not.toContain(prfB64u);
  });

  test("unknown extension results are dropped too", () => {
    expect(serverSafeExtensionResults({ largeBlob: { blob: new ArrayBuffer(8) }, somethingNew: 1 })).toEqual({});
  });
});

describe("serialisation", () => {
  test("registration carries what the server verifies", () => {
    const cred = fakeCredential("create", { prf: { enabled: false } });
    const out = registrationToJSON(cred);
    const r = out.response.response as Record<string, unknown>;
    expect(out.response.rawId).toBe(cred.id);
    expect(fromB64u(r.attestationObject as string)).toHaveLength(80);
    expect(r.transports).toEqual(["internal", "hybrid"]);
    expect(out.prfEnabled).toBe(false);
    expect(out.prfOutput).toBeNull();
  });

  test("assertion carries signature, authenticator data and user handle", () => {
    const out = assertionToJSON(fakeCredential("get", {}));
    const r = out.response.response as Record<string, string>;
    expect(fromB64u(r.signature)).toHaveLength(70);
    expect(fromB64u(r.authenticatorData)).toHaveLength(37);
    expect(fromB64u(r.userHandle)).toHaveLength(16);
    expect(out.prfOutput).toBeNull();
  });
});
