import crypto from "node:crypto";

// A software WebAuthn authenticator for tests: real P-256 keys, real CBOR
// attestation objects and real ECDSA assertion signatures, so the server-side
// verification under test is the genuine @simplewebauthn code path.

const b64u = (buf) => Buffer.from(buf).toString("base64url");
const sha256 = (data) => crypto.createHash("sha256").update(data).digest();

function cborHead(major, n) {
  if (n < 24) return Buffer.from([(major << 5) | n]);
  if (n < 0x100) return Buffer.from([(major << 5) | 24, n]);
  if (n < 0x10000) {
    const b = Buffer.alloc(3);
    b[0] = (major << 5) | 25;
    b.writeUInt16BE(n, 1);
    return b;
  }
  const b = Buffer.alloc(5);
  b[0] = (major << 5) | 26;
  b.writeUInt32BE(n, 1);
  return b;
}

function cbor(value) {
  if (value instanceof Uint8Array) return Buffer.concat([cborHead(2, value.length), Buffer.from(value)]);
  if (typeof value === "string") {
    const bytes = Buffer.from(value, "utf8");
    return Buffer.concat([cborHead(3, bytes.length), bytes]);
  }
  if (typeof value === "number") return value >= 0 ? cborHead(0, value) : cborHead(1, -1 - value);
  const entries = value instanceof Map ? [...value.entries()] : Object.entries(value);
  return Buffer.concat([cborHead(5, entries.length), ...entries.flatMap(([k, v]) => [cbor(k), cbor(v)])]);
}

export function createSoftAuthenticator({ rpId = "localhost", origin = "http://localhost:5173" } = {}) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = publicKey.export({ format: "jwk" });
  const credentialId = crypto.randomBytes(32);
  let counter = 0;
  let userHandle = null;

  const coseKey = cbor(
    new Map([
      [1, 2], // kty: EC2
      [3, -7], // alg: ES256
      [-1, 1], // crv: P-256
      [-2, Buffer.from(jwk.x, "base64url")],
      [-3, Buffer.from(jwk.y, "base64url")],
    ])
  );

  function authData(flags, extra = Buffer.alloc(0)) {
    const count = Buffer.alloc(4);
    count.writeUInt32BE(counter);
    return Buffer.concat([sha256(rpId), Buffer.from([flags]), count, extra]);
  }

  return {
    credentialId: b64u(credentialId),

    /** Answers a navigator.credentials.create() call with the given options. */
    register(options, { originOverride } = {}) {
      userHandle = options.user.id;
      const idLen = Buffer.alloc(2);
      idLen.writeUInt16BE(credentialId.length);
      const attested = Buffer.concat([Buffer.alloc(16), idLen, credentialId, coseKey]);
      const data = authData(0x01 | 0x04 | 0x40, attested); // UP | UV | AT
      const clientData = Buffer.from(
        JSON.stringify({ type: "webauthn.create", challenge: options.challenge, origin: originOverride ?? origin, crossOrigin: false })
      );
      return {
        id: b64u(credentialId),
        rawId: b64u(credentialId),
        type: "public-key",
        response: {
          clientDataJSON: b64u(clientData),
          attestationObject: b64u(cbor({ fmt: "none", attStmt: new Map(), authData: data })),
          transports: ["internal"],
        },
        clientExtensionResults: {},
        authenticatorAttachment: "platform",
      };
    },

    /** Answers a navigator.credentials.get() call. `counterOverride` simulates a cloned authenticator. */
    assert(options, { originOverride, counterOverride } = {}) {
      counter = counterOverride ?? counter + 1;
      const data = authData(0x01 | 0x04); // UP | UV
      const clientData = Buffer.from(
        JSON.stringify({ type: "webauthn.get", challenge: options.challenge, origin: originOverride ?? origin, crossOrigin: false })
      );
      const signature = crypto.sign("sha256", Buffer.concat([data, sha256(clientData)]), privateKey);
      return {
        id: b64u(credentialId),
        rawId: b64u(credentialId),
        type: "public-key",
        response: {
          clientDataJSON: b64u(clientData),
          authenticatorData: b64u(data),
          signature: b64u(signature),
          userHandle,
        },
        clientExtensionResults: {},
        authenticatorAttachment: "platform",
      };
    },
  };
}
