import { HttpError } from "../../http/errors.js";
import { checkRelayRequest, createdContractIds, rawP256FromCose, RelayRuleError } from "../../smart_wallet_rules.js";

// Public smart wallet: an OpenZeppelin smart account per user, controlled by a
// passkey that Stellar verifies on-chain (secp256r1). The frontend uses
// smart-account-kit; this service is its fee-sponsoring relayer, restricted by
// smart_wallet_rules.js, plus the user's wallet record.

const RELAYS_PER_HOUR = 30;

export function createSmartWalletService({ repository, chain, tokens, config, logger, now = Date.now }) {
  const recentRelays = new Map();

  function withinRateLimit(userId) {
    const recent = (recentRelays.get(userId) ?? []).filter((t) => now() - t < 60 * 60 * 1000);
    if (recent.length >= RELAYS_PER_HOUR) return false;
    recent.push(now());
    recentRelays.set(userId, recent);
    return true;
  }

  async function walletContext(userId) {
    const user = await repository.findUser(userId);
    if (!user) return null;
    const passkeys = (await repository.activePasskeys(userId))
      .filter((p) => !p.pending_until || new Date(p.pending_until).getTime() <= now())
      .map((p) => ({ id: p.id, credentialId: p.credential_id, deviceName: p.device_name, rawPublicKey: rawP256FromCose(p.public_key) }));
    return {
      walletAddress: user.smart_wallet_address ?? null,
      birth: user.smart_wallet_tx_hash && user.smart_wallet_ledger ? { txHash: user.smart_wallet_tx_hash, ledger: user.smart_wallet_ledger } : null,
      passkeys,
      deployer: config.deployer,
      accountWasmHash: config.accountWasmHash,
      webauthnVerifier: config.webauthnVerifier,
      tokens: [config.xlmSac, config.usdcSac],
      poolContract: config.poolContract,
      networkPassphrase: config.networkPassphrase,
    };
  }

  return {
    async wallet(userId) {
      const ctx = await walletContext(userId);
      if (!ctx) throw new HttpError(404, "User not found.");
      return {
        address: ctx.walletAddress,
        birth: ctx.birth,
        // Passkeys that can control an on-chain wallet (ES256 / secp256r1 only).
        passkeys: ctx.passkeys
          .filter((p) => p.rawPublicKey)
          .map((p) => ({ credentialId: p.credentialId, publicKey: p.rawPublicKey.toString("base64url"), deviceName: p.deviceName })),
        config,
      };
    },

    /** Records the wallet's creation transaction, after checking on chain that it created that address. */
    async recordBirth(userId, txHash) {
      const ctx = await walletContext(userId);
      if (!ctx?.walletAddress) throw new HttpError(404, "No smart wallet.");
      if (ctx.birth) return ctx.birth;
      const tx = await chain.getTransaction(txHash);
      if (tx.status !== "SUCCESS") throw new HttpError(400, "That transaction was not found or failed.");
      if (!createdContractIds(tx.envelopeXdr, config.networkPassphrase).includes(ctx.walletAddress)) {
        throw new HttpError(400, "That transaction did not create your wallet.");
      }
      const birth = { txHash, ledger: tx.ledger };
      await repository.setBirth(userId, birth);
      return birth;
    },

    relayToken(userId) {
      if (!tokens || !chain.sponsoring) throw new HttpError(503, "Smart wallet sponsoring is not configured.");
      return tokens.mint(userId);
    },

    /** Checks a smart-account-kit request against the sponsoring rules, then submits it with the relayer paying. */
    async relay(token, body) {
      if (!tokens || !chain.sponsoring) throw new HttpError(503, "Smart wallet sponsoring is not configured.");
      const userId = tokens.read(token);
      if (!userId) throw new HttpError(401, "This request expired. Please try again.", "RELAY_TOKEN_INVALID");
      if (!withinRateLimit(userId)) throw new HttpError(429, "Too many wallet transactions. Try again later.", "RATE_LIMITED");

      const ctx = await walletContext(userId);
      if (!ctx) throw new HttpError(401, "Account not found.");
      let checked;
      try {
        checked = checkRelayRequest(body, ctx);
      } catch (err) {
        if (err instanceof RelayRuleError) throw new HttpError(403, err.message, "NOT_SPONSORED");
        throw err;
      }

      const { hash, ledger } = await chain.sponsor(checked);
      if (checked.kind === "deploy") {
        await repository.setWalletAddress(userId, checked.contractId, new Date(now()).toISOString());
        await repository.setBirth(userId, { txHash: hash, ledger }, checked.contractId);
      }
      logger.info(`[SMART-WALLET] sponsored ${checked.kind} for user ${userId}: ${hash}`);
      return { hash, status: "SUCCESS", ledger };
    },
  };
}
