import { HttpError } from "../../http/errors.js";

// Testnet faucet: a drip of 10 XLM and 20 USDC, paid to the gateway with the
// signed-in user's deposit memo so it lands in their private balance. One
// claim per account every 24 hours.

export const FAUCET_COOLDOWN_MS = 24 * 60 * 60 * 1000;
export const DRIP = { xlm: "10.0000000", usdc: "20.0000000" };

/**
 * Cloudflare Turnstile, enforced once TURNSTILE_SECRET_KEY is set (planned
 * before mainnet). Then the page's "bypass-offline" fallback only works in
 * local development.
 */
export function createCaptchaVerifier({ secret, production, fetchImpl = fetch }) {
  return async function verify(token) {
    if (!secret) return;
    if (!production && token === "bypass-offline") return;
    if (!token) throw new HttpError(400, "Captcha verification required.");
    let verdict;
    try {
      const res = await fetchImpl("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret, response: token }),
      });
      verdict = await res.json().catch(() => ({}));
    } catch {
      throw new HttpError(503, "Captcha service unavailable. Please try again.");
    }
    if (!verdict.success) throw new HttpError(403, "Captcha verification failed. Please try again.");
  };
}

export function createFaucetService({ repository, sendPayment, verifyCaptcha, logger, now = Date.now }) {
  const remaining = (claimedAt) => (claimedAt ? Math.max(0, FAUCET_COOLDOWN_MS - (now() - Date.parse(claimedAt))) : 0);

  return {
    async status(viewingKey) {
      const user = await repository.findByViewingKey(viewingKey);
      const remainingMs = remaining(user?.faucet_claimed_at);
      return remainingMs > 0
        ? { canClaim: false, remainingMs, nextClaimAt: Date.parse(user.faucet_claimed_at) + FAUCET_COOLDOWN_MS }
        : { canClaim: true, remainingMs: 0 };
    },

    async fund(userId, { captchaToken }) {
      // Before the captcha: a bad request must not use up a single-use solve.
      const user = await repository.findById(userId);
      if (!user) throw new HttpError(401, "Unauthorized: No registered Starlit account found.");
      if (!/^\d{1,19}$/.test(String(user.deposit_memo ?? ""))) throw new HttpError(400, "Your account has no deposit memo.");
      await verifyCaptcha(captchaToken);

      // Claiming the cooldown first means two requests at once can't both pay out.
      const previousClaim = user.faucet_claimed_at ?? null;
      const claimedAt = new Date(now()).toISOString();
      const cutoff = new Date(now() - FAUCET_COOLDOWN_MS).toISOString();
      if (!(await repository.claimCooldown(userId, claimedAt, cutoff))) {
        const remainingMs = remaining(previousClaim) || FAUCET_COOLDOWN_MS;
        const hours = Math.floor(remainingMs / 3_600_000);
        const minutes = Math.ceil((remainingMs % 3_600_000) / 60_000);
        throw Object.assign(new HttpError(429, `Faucet cooldown active for this account. You can claim again in ${hours}h ${minutes}m.`, "cooldown"), {
          remainingMs,
        });
      }

      let hash;
      try {
        hash = await sendPayment({ memo: String(user.deposit_memo), ...DRIP });
      } catch (err) {
        // Nothing was paid: give the claim back.
        await repository.restoreCooldown(userId, previousClaim).catch(() => undefined);
        logger.error("Faucet payment failed:", err);
        throw new HttpError(500, "Faucet transaction failed");
      }

      return {
        success: true,
        hash,
        amountXlm: 10,
        amountUsdc: 20,
        memo: String(user.deposit_memo),
        cooldownMs: FAUCET_COOLDOWN_MS,
        message: "Sent 10 XLM and 20 USDC to your private balance.",
      };
    },
  };
}
