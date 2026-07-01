import nacl from "tweetnacl";
import crypto from "crypto";

// BN254 Modulus & ZK helper functions for Gateway deposit note creation
const BN254_MODULUS = BigInt("21888242871839275222246405745257275088548364400416034343698204186575808495617");

// Reducer function mapping arbitrary byte streams to a valid ZK scalar field value
export function reduceToField(bytes) {
  let bigIntVal = 0n;
  for (let i = 0; i < bytes.length; i++) {
    bigIntVal = (bigIntVal << 8n) + BigInt(bytes[i]);
  }
  const fieldVal = bigIntVal % BN254_MODULUS;
  return fieldVal.toString(16).padStart(64, "0");
}

// Emulates a Poseidon hash function over inputs by hashing their concatenated string values via SHA-256
export async function poseidonHash(inputs) {
  let concatenated = "";
  for (const input of inputs) {
    concatenated += input.toString();
  }
  const hashBytes = crypto.createHash("sha256").update(concatenated).digest();
  return reduceToField(hashBytes);
}

// Calculates a zero-knowledge deposit commitment from the deposit amount, recipient's public key, token address, and note secret
export async function calculateCommitment(amount, recipientPublicKeyHex, tokenAddressHex, secretHex) {
  const baseAmount = BigInt(Math.round(amount * 10000000));
  const tokenField = reduceToField(Buffer.from(tokenAddressHex));
  return await poseidonHash([baseAmount, recipientPublicKeyHex, tokenField, secretHex]);
}

// Encrypts private note parameters (amount, asset, secret, sender) using the recipient's public encryption key
export function encryptNoteForUser(amount, asset, secret, senderUsername, recipientPublicEncryptionKeyHex) {
  const payload = JSON.stringify({
    amount: amount.toString(),
    asset,
    secret,
    sender: senderUsername,
    timestamp: Date.now()
  });
  
  const payloadBytes = Buffer.from(payload, "utf-8");
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const recipientPublicKey = Buffer.from(recipientPublicEncryptionKeyHex, "hex");
  
  const ephemeralKeyPair = nacl.box.keyPair();
  
  const encrypted = nacl.box(
    payloadBytes,
    nonce,
    recipientPublicKey,
    ephemeralKeyPair.secretKey
  );
  
  return {
    ephemeralPublicKey: Buffer.from(ephemeralKeyPair.publicKey).toString("hex"),
    nonce: Buffer.from(nonce).toString("hex"),
    ciphertext: Buffer.from(encrypted).toString("hex")
  };
}
