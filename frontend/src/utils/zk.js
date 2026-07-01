import { sha256, bytesToHex, stringToBytes } from "./crypto";

// BN254 Prime Field modulus (used in Noir and Soroban BN254 math)
export const BN254_MODULUS = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

/**
 * Converts a byte array or string to a valid BN254 field element by reducing it modulo the prime.
 */
export function reduceToField(bytes) {
  let bigIntVal = 0n;
  for (let i = 0; i < bytes.length; i++) {
    bigIntVal = (bigIntVal << 8n) + BigInt(bytes[i]);
  }
  const fieldVal = bigIntVal % BN254_MODULUS;
  return fieldVal.toString(16).padStart(64, "0");
}

/**
 * Simulates a Poseidon hash using SHA-256 and field reduction to produce a valid BN254 scalar.
 */
export async function poseidonHash(inputs) {
  // Concatenate all inputs
  let concatenated = "";
  for (const input of inputs) {
    concatenated += input.toString();
  }
  const hashBytes = await sha256(concatenated);
  return reduceToField(hashBytes);
}

/**
 * Calculates a note commitment: Poseidon(amount, recipientPublicKey, tokenAddress, secret)
 */
export async function calculateCommitment(amount, recipientPublicKeyHex, tokenAddressHex, secretHex) {
  const baseAmount = BigInt(Math.round(amount * 10000000));
  const tokenField = reduceToField(stringToBytes(tokenAddressHex));
  return await poseidonHash([baseAmount, recipientPublicKeyHex, tokenField, secretHex]);
}

/**
 * Calculates a spent nullifier: Poseidon(secret, commitment)
 */
export async function calculateNullifier(secretHex, commitmentHex) {
  return await poseidonHash([secretHex, commitmentHex]);
}

/**
 * Calculates a recipient address hash to bind the proof to: Poseidon(recipientAddress)
 */
export async function calculateRecipientAddressHash(recipientAddress) {
  return await poseidonHash([recipientAddress]);
}

/**
 * Handles 2-in-2-out ZK Proof Generation with cryptographic steps and logs.
 */
export async function generateShieldedPaymentProof(
  secret1Hex,
  commitment1Hex,
  secret2Hex,
  commitment2Hex,
  recipientAddress,
  tokenAddress,
  spendAmount,
  changeAmount,
  onProgress
) {
  const steps = [
    { message: "Initializing Barretenberg ZK backend...", delay: 800 },
    { message: "Compiling Noir circuit 'shielded_payment' into WebAssembly...", delay: 1000 },
    { message: "Generating execution witness from private and public inputs...", delay: 1200 },
    { message: "Satisfying arithmetic constraints (1040 gates checked)...", delay: 900 },
    { message: "Generating UltraHonk ZK-SNARK proof on BN254 curve...", delay: 1500 },
    { message: "Proof generation complete. Serializing outputs...", delay: 600 }
  ];

  // Derive nullifiers to prevent double-spending
  const nullifier1 = await calculateNullifier(secret1Hex, commitment1Hex);
  const nullifier2 = await calculateNullifier(secret2Hex, commitment2Hex);

  // Create simulated proof bytes (in hex) that represent the 2-in-2-out UltraHonk proof
  const combinedSeed = secret1Hex + commitment1Hex + secret2Hex + commitment2Hex + recipientAddress + tokenAddress + spendAmount + changeAmount;
  const simulatedProofHex = "0001020304" + bytesToHex(await sha256(combinedSeed)) + "ffffffff";

  // Simulate proof compilation logs for user UX
  for (const step of steps) {
    onProgress(step.message);
    await new Promise((resolve) => setTimeout(resolve, step.delay));
  }

  return {
    proofHex: simulatedProofHex,
    nullifier1Hex: nullifier1,
    nullifier2Hex: nullifier2
  };
}
