import nacl from "tweetnacl";
import * as StellarSdk from "@stellar/stellar-sdk";

/**
 * Helper to convert a string to a Uint8Array
 */
export function stringToBytes(str) {
  return new TextEncoder().encode(str);
}

/**
 * Helper to convert bytes to hex string
 */
export function bytesToHex(bytes) {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Helper to convert hex string to Uint8Array
 */
export function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

/**
 * Hashes a string using SHA-256
 */
export async function sha256(message) {
  const msgBuffer = stringToBytes(message);
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgBuffer);
  return new Uint8Array(hashBuffer);
}

/**
 * Derives the master seed and subkeys from email and a 6-digit PIN
 */
export async function deriveKeysFromEmailAndPin(email, pin) {
  const cleanEmail = email.toLowerCase().trim();
  const cleanPin = pin.trim();
  
  // 1. Combine email and PIN and hash to get the master seed
  const combinedSalt = `${cleanEmail}:${cleanPin}`;
  const masterSeed = await sha256(combinedSalt); // 32 bytes
  
  // 2. Derive Stellar Gas Account
  const stellarSeed = await sha256(`${bytesToHex(masterSeed)}:stellar`);
  const stellarKeypair = StellarSdk.Keypair.fromRawEd25519Seed(stellarSeed);
  
  // 3. Derive ZK Spending Key (scalar field element for Noir)
  const zkSpendingSeed = await sha256(`${bytesToHex(masterSeed)}:spending`);
  // Convert to a big number hex string representation (within BN254 prime field size)
  const zkSpendingKey = bytesToHex(zkSpendingSeed);
  
  // 4. Derive ZK Viewing Keys (encryption keypair)
  const viewingSeed = await sha256(`${bytesToHex(masterSeed)}:viewing`);
  const viewingKeyPair = nacl.box.keyPair.fromSecretKey(viewingSeed);
  
  return {
    masterSeed: bytesToHex(masterSeed),
    stellar: {
      publicKey: stellarKeypair.publicKey(),
      secretKey: stellarKeypair.secret(),
      keypair: stellarKeypair
    },
    spendingKey: zkSpendingKey,
    viewing: {
      publicKey: bytesToHex(viewingKeyPair.publicKey),
      secretKey: bytesToHex(viewingKeyPair.secretKey)
    }
  };
}

/**
 * Encrypts a note metadata payload (amount, asset, secret, sender)
 */
export function encryptNote(amount, asset, secret, senderUsername, recipientPublicEncryptionKeyHex) {
  const payload = JSON.stringify({
    amount: amount.toString(),
    asset,
    secret,
    sender: senderUsername,
    timestamp: Date.now()
  });
  
  const payloadBytes = stringToBytes(payload);
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const recipientPublicKey = hexToBytes(recipientPublicEncryptionKeyHex);
  
  // Ephemeral key pair for DH exchange
  const ephemeralKeyPair = nacl.box.keyPair();
  
  const encrypted = nacl.box(
    payloadBytes,
    nonce,
    recipientPublicKey,
    ephemeralKeyPair.secretKey
  );
  
  // Package result: ephemeral public key + nonce + encrypted cipher
  return {
    ephemeralPublicKey: bytesToHex(ephemeralKeyPair.publicKey),
    nonce: bytesToHex(nonce),
    ciphertext: bytesToHex(encrypted)
  };
}

/**
 * Decrypts a note payload using the recipient's viewing secret key
 */
export function decryptNote(encryptedPayload, myViewingSecretKeyHex) {
  const { ephemeralPublicKey, nonce, ciphertext } = encryptedPayload;
  
  try {
    const decrypted = nacl.box.open(
      hexToBytes(ciphertext),
      hexToBytes(nonce),
      hexToBytes(ephemeralPublicKey),
      hexToBytes(myViewingSecretKeyHex)
    );
    
    if (!decrypted) {
      return null;
    }
    
    return JSON.parse(new TextDecoder().decode(decrypted));
  } catch (error) {
    console.error("Failed to decrypt note:", error.message);
    return null;
  }
}

/**
 * Encrypts the master seed locally with the user's PIN for browser local storage
 */
export async function encryptSeedLocally(seedHex, pin) {
  const pinHash = await sha256(pin);
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    pinHash,
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );
  
  const aesKey = await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: stringToBytes("starlit-salt"),
      iterations: 10000,
      hash: "SHA-256"
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
  
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    aesKey,
    stringToBytes(seedHex)
  );
  
  return {
    iv: bytesToHex(iv),
    ciphertext: bytesToHex(new Uint8Array(encrypted))
  };
}

/**
 * Decrypts the master seed from browser local storage using the user's PIN
 */
export async function decryptSeedLocally(encryptedData, pin) {
  const { iv, ciphertext } = encryptedData;
  const pinHash = await sha256(pin);
  
  try {
    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      pinHash,
      { name: "PBKDF2" },
      false,
      ["deriveKey"]
    );
    
    const aesKey = await crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt: stringToBytes("starlit-salt"),
        iterations: 10000,
        hash: "SHA-256"
      },
      keyMaterial,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
    
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: hexToBytes(iv) },
      aesKey,
      hexToBytes(ciphertext)
    );
    
    return new TextDecoder().decode(decrypted);
  } catch (error) {
    console.error("Local decryption failed: incorrect PIN");
    return null;
  }
}

/**
 * Encrypts arbitrary text symmetrically using the user's viewing secret key
 */
export function encryptSymmetrically(text, secretKeyHex) {
  const bytes = stringToBytes(text);
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
  const key = hexToBytes(secretKeyHex);
  const encrypted = nacl.secretbox(bytes, nonce, key);
  return bytesToHex(nonce) + bytesToHex(encrypted);
}

/**
 * Decrypts arbitrary text symmetrically using the user's viewing secret key
 */
export function decryptSymmetrically(encryptedHex, secretKeyHex) {
  try {
    const nonceLength = nacl.secretbox.nonceLength * 2; // 24 bytes = 48 hex chars
    const nonce = hexToBytes(encryptedHex.substring(0, nonceLength));
    const ciphertext = hexToBytes(encryptedHex.substring(nonceLength));
    const key = hexToBytes(secretKeyHex);
    const decrypted = nacl.secretbox.open(ciphertext, nonce, key);
    if (!decrypted) return null;
    return new TextDecoder().decode(decrypted);
  } catch (error) {
    console.error("Symmetric decryption failed:", error.message);
    return null;
  }
}

