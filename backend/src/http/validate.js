import * as StellarSdk from "@stellar/stellar-sdk";
import { z } from "zod";
import { HttpError } from "./errors.js";

/** Replaces req.body with the parsed value: unknown fields are dropped. */
export const validateBody = (schema) => (req, res, next) => {
  const result = schema.safeParse(req.body ?? {});
  if (result.success) {
    req.body = result.data;
    return next();
  }
  const issue = result.error.issues[0];
  const field = issue.path.join(".");
  next(new HttpError(400, field ? `Invalid ${field}: ${issue.message}` : issue.message, "validation_error"));
};

// Buffer.from(value, "hex") silently stops at the first bad character, so hex
// must be checked before it reaches a transaction.
export const hex32 = z.string().regex(/^[0-9a-fA-F]{64}$/, "expected 32 bytes of hex");
export const hexBytes = z.string().max(16_384).regex(/^(?:[0-9a-fA-F]{2})+$/, "expected hex bytes");
export const txHash = hex32;
export const stellarAddress = z
  .string()
  .refine((v) => StellarSdk.StrKey.isValidEd25519PublicKey(v) || StellarSdk.StrKey.isValidContract(v), "expected a Stellar address");
export const contractId = z.string().refine((v) => StellarSdk.StrKey.isValidContract(v), "expected a contract address");
export const positiveAmount = z.number().positive().finite();
