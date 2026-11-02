import { z } from "zod";
import { contractId, hex32, hexBytes, positiveAmount, stellarAddress, txHash } from "./validate.js";

// Request bodies for the routes that move money or write notes.

export const claimRequest = z.object({
  proof: hexBytes,
  nullifier: hex32,
  recipient: stellarAddress,
  token: contractId,
  amount: positiveAmount,
  root: hex32,
});

export const transferRequest = z.object({
  proof: hexBytes,
  nullifier_1: hex32,
  nullifier_2: hex32,
  output_commitment_1: hex32,
  encrypted_note_1: hexBytes,
  output_commitment_2: hex32,
  encrypted_note_2: hexBytes,
  root: hex32,
});

export const withdrawRequest = z.object({
  proof: hexBytes,
  nullifier_1: hex32,
  nullifier_2: hex32,
  recipient: stellarAddress,
  token: contractId,
  amount: positiveAmount,
  root: hex32,
  change_commitment: hex32,
  encrypted_change_note: hexBytes,
});

export const postNoteRequest = z.object({
  commitment: hex32,
  encrypted_note: hexBytes,
  recipient_viewing_key: z.string().min(1).max(128),
});

export const spendNoteRequest = z.object({
  commitment: hex32,
  timestamp: z.string().max(32).optional(),
  signature: z.string().max(256).optional(),
});

export const depositRequest = z.object({ txHash });
