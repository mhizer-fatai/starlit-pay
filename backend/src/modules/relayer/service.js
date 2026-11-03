import * as StellarSdk from "@stellar/stellar-sdk";
import { ComplianceUnavailableError } from "../../compliance.js";
import { HttpError } from "../../http/errors.js";

// Private payments the relayer submits to the pool on the user's behalf, so
// the user's own account never appears on chain. Inputs are validated by the
// route schemas before they get here.

const bytes = (hex) => StellarSdk.nativeToScVal(Buffer.from(hex, "hex"), { type: "bytes" });
const address = (value) => StellarSdk.Address.fromString(value).toScVal();
const stroops = (amount) => StellarSdk.nativeToScVal(BigInt(Math.round(amount * 10_000_000)), { type: "i128" });

export function createRelayerService({ invoke, isAddressBlocked, misconfigured = null, onWithdrawn = () => {}, logger }) {
  // Money leaving the pool must pass screening: if screening can't answer, refuse.
  async function screen(recipient) {
    let blocked;
    try {
      blocked = await isAddressBlocked(recipient, { failClosed: true });
    } catch (err) {
      if (!(err instanceof ComplianceUnavailableError)) throw err;
      logger.error(err.message);
      throw new HttpError(503, "Compliance check unavailable, try again shortly.", "compliance_unavailable");
    }
    if (blocked) throw new HttpError(403, "Recipient address is restricted under compliance policy.");
  }

  async function submit(method, args, failMessage) {
    if (misconfigured) throw new HttpError(500, misconfigured);
    try {
      return await invoke(method, args);
    } catch (err) {
      logger.error(`Relayer ${method} failed:`, err);
      throw new HttpError(500, failMessage);
    }
  }

  return {
    async transfer(body) {
      logger.info("Relayer submitting transfer...");
      return submit(
        "transfer",
        [body.proof, body.nullifier_1, body.nullifier_2, body.output_commitment_1, body.encrypted_note_1, body.output_commitment_2, body.encrypted_note_2, body.root].map(bytes),
        "Could not submit the payment. Please try again."
      );
    },

    async withdraw(body) {
      await screen(body.recipient);
      logger.info("Relayer submitting withdrawal with change...");
      const result = await submit(
        "withdraw",
        [
          bytes(body.proof),
          bytes(body.nullifier_1),
          bytes(body.nullifier_2),
          address(body.recipient),
          address(body.token),
          stroops(body.amount),
          bytes(body.root),
          bytes(body.change_commitment),
          bytes(body.encrypted_change_note),
        ],
        "Could not submit the withdrawal. Please try again."
      );
      onWithdrawn();
      return result;
    },
  };
}
