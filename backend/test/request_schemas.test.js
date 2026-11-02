import { test } from "node:test";
import assert from "node:assert/strict";
import * as StellarSdk from "@stellar/stellar-sdk";
import { depositRequest, postNoteRequest, spendNoteRequest, transferRequest, withdrawRequest } from "../src/http/schemas.js";

// These payloads copy what the frontend really sends (lib/zk.ts, privateWithdraw.ts,
// selfTransfer.ts): if one fails, a live payment fails.
const digest = "ab".repeat(32);
const proof = "0100" + digest + "0200" + digest.slice(0, 32);
const ZERO_COMMITMENT = "0".repeat(64);
const encrypted = "cd".repeat(32) + "ef".repeat(24) + "12".repeat(120);
const recipient = StellarSdk.Keypair.random().publicKey();
const walletContract = StellarSdk.StrKey.encodeContract(Buffer.alloc(32, 7));
const token = StellarSdk.StrKey.encodeContract(Buffer.alloc(32, 9));

const withdraw = { proof, nullifier_1: digest, nullifier_2: digest, recipient, token, amount: 12.5, root: digest, change_commitment: digest, encrypted_change_note: encrypted };
const transfer = { proof, nullifier_1: digest, nullifier_2: digest, output_commitment_1: digest, encrypted_note_1: encrypted, output_commitment_2: ZERO_COMMITMENT, encrypted_note_2: "00", root: digest };

const accepts = (schema, body) => assert.equal(schema.safeParse(body).success, true, JSON.stringify(schema.safeParse(body).error?.issues));
const rejects = (schema, body) => assert.equal(schema.safeParse(body).success, false);

test("a withdrawal as the app sends it passes, with or without change", () => {
  accepts(withdrawRequest, withdraw);
  accepts(withdrawRequest, { ...withdraw, change_commitment: ZERO_COMMITMENT, encrypted_change_note: "00" });
});

test("a withdrawal can go to a smart wallet contract", () => {
  accepts(withdrawRequest, { ...withdraw, recipient: walletContract });
});

test("a transfer with its empty second output passes", () => {
  accepts(transferRequest, transfer);
});

test("notes pass with or without a spend signature", () => {
  accepts(postNoteRequest, { commitment: digest, encrypted_note: encrypted, recipient_viewing_key: "ab".repeat(32) });
  accepts(spendNoteRequest, { commitment: digest });
  accepts(spendNoteRequest, { commitment: digest, timestamp: String(Date.now()), signature: "ab".repeat(64) });
});

test("missing fields are refused", () => {
  for (const field of Object.keys(withdraw)) {
    const { [field]: dropped, ...rest } = withdraw;
    rejects(withdrawRequest, rest);
  }
});

test("hex that would be silently truncated is refused", () => {
  rejects(withdrawRequest, { ...withdraw, nullifier_1: "zz".repeat(32) });
  rejects(withdrawRequest, { ...withdraw, root: digest.slice(0, 62) });
  rejects(transferRequest, { ...transfer, encrypted_note_1: "abc" });
  rejects(transferRequest, { ...transfer, proof: "0100xyz" });
});

test("bad addresses and amounts are refused", () => {
  rejects(withdrawRequest, { ...withdraw, recipient: "GNOTANADDRESS" });
  rejects(withdrawRequest, { ...withdraw, token: recipient }); // a token is a contract
  rejects(withdrawRequest, { ...withdraw, amount: 0 });
  rejects(withdrawRequest, { ...withdraw, amount: -1 });
  rejects(withdrawRequest, { ...withdraw, amount: "5" });
});

test("a deposit needs a real transaction hash", () => {
  accepts(depositRequest, { txHash: digest });
  rejects(depositRequest, { txHash: "not-a-hash" });
});
