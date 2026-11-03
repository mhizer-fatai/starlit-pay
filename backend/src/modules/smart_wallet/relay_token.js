import crypto from "node:crypto";

// smart-account-kit's relayer client cannot send cookies, so it is pointed at
// /api/smart-wallet/relay/<token>: a short-lived, HMAC-signed token minted for
// the signed-in user.

const TOKEN_TTL_MS = 10 * 60 * 1000;

export function createRelayTokens(sessionSecret, now = Date.now) {
  if (!sessionSecret) return null;
  const key = Buffer.from(crypto.hkdfSync("sha256", sessionSecret, Buffer.alloc(0), "starlit-auth:smart-wallet-relay", 32));
  const sign = (body) => crypto.createHmac("sha256", key).update(body).digest("base64url");

  return {
    mint(userId) {
      const exp = now() + TOKEN_TTL_MS;
      const body = `${userId}.${exp}`;
      return { token: Buffer.from(`${body}.${sign(body)}`).toString("base64url"), expiresAt: exp };
    },

    /** The user id, or null if the token is forged or expired. */
    read(token) {
      try {
        const [userId, exp, sig] = Buffer.from(String(token), "base64url").toString("utf8").split(".");
        const expected = sign(`${userId}.${exp}`);
        if (!sig || sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
        if (Number(exp) < now()) return null;
        return userId;
      } catch {
        return null;
      }
    },
  };
}
