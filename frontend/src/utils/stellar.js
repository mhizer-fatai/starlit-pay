import * as StellarSdk from "@stellar/stellar-sdk";

// Load configuration from environment or defaults
const HORIZON_URL = "https://horizon-testnet.stellar.org";
const RPC_URL = "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE = StellarSdk.Networks.TESTNET;

// Converts a hex string into a Uint8Array (browser compatible replacement for Buffer.from(hex, 'hex'))
const hexToBytes = (hex) => {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
};

// Converts a Uint8Array/Buffer into a hex string (browser compatible replacement for buf.toString('hex'))
const bytesToHex = (bytes) => {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
};

export const horizon = new StellarSdk.Horizon.Server(HORIZON_URL);
export const rpc = new StellarSdk.rpc.Server(RPC_URL);

/**
 * Gets the public balance (XLM and USDC/EURC) of an address
 */
export async function getPublicBalances(publicKey, tokensMap = {}) {
  try {
    const account = await horizon.loadAccount(publicKey);
    const balances = { XLM: "0" };

    // Initialize all configured tokens to 0
    for (const key of Object.keys(tokensMap)) {
      balances[key] = "0";
    }

    for (const b of account.balances) {
      if (b.asset_type === "native") {
        balances.XLM = b.balance;
      } else {
        // Match by asset code (USDC, EURC, etc.)
        for (const [code, issuer] of Object.entries(tokensMap)) {
          if (b.asset_code === code && b.asset_issuer === issuer) {
            balances[code] = b.balance;
          }
        }
      }
    }
    return balances;
  } catch (error) {
    if (error.response?.status === 404) {
      const defaultBals = { XLM: "0", unactivated: true };
      for (const key of Object.keys(tokensMap)) {
        defaultBals[key] = "0";
      }
      return defaultBals;
    }
    throw error;
  }
}

/**
 * Sets up a trustline for a custom asset if it doesn't exist
 */
export async function ensureTokenTrustline(userKeypair, assetCode, assetIssuer) {
  const account = await horizon.loadAccount(userKeypair.publicKey());
  const asset = new StellarSdk.Asset(assetCode, assetIssuer);
  
  const hasTrustline = account.balances.some(
    (b) => b.asset_code === assetCode && b.asset_issuer === assetIssuer
  );

  if (hasTrustline) return true;

  console.log(`Creating trustline for ${assetCode}...`);
  const tx = new StellarSdk.TransactionBuilder(account, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(StellarSdk.Operation.changeTrust({ asset: asset }))
    .setTimeout(180)
    .build();

  tx.sign(userKeypair);
  const response = await horizon.submitTransaction(tx);
  console.log(`Trustline created successfully! Tx Hash: ${response.hash}`);
  return true;
}

/**
 * Deposits public assets (XLM, USDC, EURC) into the shielded pool contract
 */
export async function depositToPool(
  userKeypair,
  contractId,
  tokenAddress,
  amount,
  commitmentHex,
  encryptedNoteBytesHex
) {
  const depositorAddress = userKeypair.publicKey();
  console.log(`Depositing ${amount} tokens of address ${tokenAddress} into shielded pool ${contractId}...`);

  // 1. Fetch account sequence from Soroban RPC
  const account = await rpc.getAccount(depositorAddress);

  // 2. Initialize contract object
  const contract = new StellarSdk.Contract(contractId);

  // 3. Convert arguments to ScVal
  const depositorVal = StellarSdk.Address.fromString(depositorAddress).toScVal();
  const tokenVal = StellarSdk.Address.fromString(tokenAddress).toScVal();
  const amountVal = StellarSdk.nativeToScVal(BigInt(Math.round(amount * 10000000)), { type: "i128" });
  const commitmentVal = StellarSdk.nativeToScVal(hexToBytes(commitmentHex), { type: "bytes" });
  const encryptedNoteVal = StellarSdk.nativeToScVal(hexToBytes(encryptedNoteBytesHex), { type: "bytes" });

  // 4. Build Initial Transaction
  let tx = new StellarSdk.TransactionBuilder(account, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call("deposit", depositorVal, tokenVal, amountVal, commitmentVal, encryptedNoteVal))
    .setTimeout(180)
    .build();

  // 5. Simulate Transaction to get resource bounds
  const simulation = await rpc.simulateTransaction(tx);
  if (StellarSdk.rpc.Api.isSimulationError(simulation)) {
    throw new Error(`Soroban simulation failed: ${simulation.error}`);
  }

  // 6. Re-assemble transaction with simulation resources
  tx = StellarSdk.rpc.assembleTransaction(tx, simulation).build();

  // 7. Sign and Submit
  tx.sign(userKeypair);
  const response = await rpc.sendTransaction(tx);

  if (response.status === "ERROR") {
    throw new Error(`Transaction failed: ${response.errorResult}`);
  }

  // 8. Poll for transaction result
  let txResult = await rpc.getTransaction(response.hash);
  let attempts = 0;
  while ((txResult.status === "NOT_FOUND" || txResult.status === "PENDING") && attempts < 30) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    txResult = await rpc.getTransaction(response.hash);
    attempts++;
  }

  if (txResult.status === "SUCCESS") {
    const rootScVal = txResult.returnValue;
    const rootHex = bytesToHex(StellarSdk.scValToNative(rootScVal));
    console.log(`Deposit successful! New Merkle Root: ${rootHex}`);
    return {
      hash: response.hash,
      rootHex
    };
  } else {
    throw new Error(`Transaction failed with status: ${txResult.status}`);
  }
}

/**
 * Submits a ZK claim directly from the client, paying transaction fees
 */
export async function claimFromPool(
  userKeypair,
  contractId,
  proofHex,
  nullifierHex,
  recipientAddress,
  tokenAddress,
  amount,
  rootHex
) {
  const submitterAddress = userKeypair.publicKey();
  console.log(`Broadcasting direct claim of ${amount} to ${recipientAddress} for token ${tokenAddress}...`);

  // 1. Fetch account sequence
  const account = await rpc.getAccount(submitterAddress);

  // 2. Initialize contract
  const contract = new StellarSdk.Contract(contractId);

  // 3. Convert arguments to ScVal
  const proofVal = StellarSdk.nativeToScVal(hexToBytes(proofHex), { type: "bytes" });
  const nullifierVal = StellarSdk.nativeToScVal(hexToBytes(nullifierHex), { type: "bytes" });
  const recipientVal = StellarSdk.Address.fromString(recipientAddress).toScVal();
  const tokenVal = StellarSdk.Address.fromString(tokenAddress).toScVal();
  const amountVal = StellarSdk.nativeToScVal(BigInt(Math.round(amount * 10000000)), { type: "i128" });
  const rootVal = StellarSdk.nativeToScVal(hexToBytes(rootHex), { type: "bytes" });

  // 4. Build Initial Transaction
  let tx = new StellarSdk.TransactionBuilder(account, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call("claim", proofVal, nullifierVal, recipientVal, tokenVal, amountVal, rootVal))
    .setTimeout(180)
    .build();

  // 5. Simulate
  const simulation = await rpc.simulateTransaction(tx);
  if (StellarSdk.rpc.Api.isSimulationError(simulation)) {
    throw new Error(`Claim simulation failed: ${simulation.error}`);
  }

  // 6. Re-assemble
  tx = StellarSdk.rpc.assembleTransaction(tx, simulation).build();

  // 7. Sign and Submit
  tx.sign(userKeypair);
  const response = await rpc.sendTransaction(tx);

  if (response.status === "ERROR") {
    throw new Error(`Claim submission failed: ${response.errorResult}`);
  }

  // 8. Poll for transaction result
  let txResult = await rpc.getTransaction(response.hash);
  let attempts = 0;
  while ((txResult.status === "NOT_FOUND" || txResult.status === "PENDING") && attempts < 30) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    txResult = await rpc.getTransaction(response.hash);
    attempts++;
  }

  if (txResult.status === "SUCCESS") {
    return {
      success: true,
      hash: response.hash,
      ledger: txResult.ledger
    };
  } else {
    throw new Error(`Transaction failed with status: ${txResult.status}`);
  }
}

/**
 * Polls the Soroban RPC for all deposit events to reconstruct private note state
 */
export async function getPoolDepositEvents(contractId, startLedger = 1) {
  let resolvedStartLedger = startLedger;
  let latestLedger = 0;
  try {
    const latestLedgerRes = await horizon.ledgers().limit(1).order("desc").call();
    latestLedger = latestLedgerRes.records[0].sequence;
    const CONTRACT_BIRTH_LEDGER = 3300000;
    if (resolvedStartLedger === 1 || resolvedStartLedger < CONTRACT_BIRTH_LEDGER) {
      resolvedStartLedger = CONTRACT_BIRTH_LEDGER;
    }
  } catch (err) {
    console.error("Failed to query latest ledger from Horizon, using fallback:", err.message);
    return [];
  }

  const rawEvents = [];
  let currentStart = resolvedStartLedger;
  const chunkSize = 10000;

  // Queries events in chunks of 10000 ledgers to prevent range errors from the RPC node
  while (currentStart <= latestLedger) {
    const currentEnd = Math.min(latestLedger, currentStart + chunkSize);
    const filter = {
      startLedger: currentStart,
      endLedger: currentEnd + 1,
      filters: [
        {
          type: "contract",
          contractIds: [contractId]
        }
      ],
      limit: 1000
    };

    try {
      console.log(`Querying events for range [${currentStart}, ${currentEnd}]`);
      const res = await rpc.getEvents(filter);
      if (res.events && res.events.length > 0) {
        rawEvents.push(...res.events);
      }
      currentStart = currentEnd + 1;
    } catch (queryErr) {
      console.error(`Query failed for range [${currentStart}, ${currentEnd}]:`, queryErr);
      const errMsg = queryErr.message || (queryErr.error && queryErr.error.message) || String(queryErr);
      const match = errMsg.match(/ledger range:\s*(\d+)/i);
      
      // Adjusts the start ledger if it is older than the oldest indexed ledger available on the RPC node
      if (match && match[1]) {
        const minLedger = parseInt(match[1], 10);
        if (minLedger > currentStart) {
          currentStart = minLedger;
          continue;
        }
      }
      throw queryErr;
    }
  }

  try {
    // Maps the raw Soroban events to the application format
    const events = rawEvents.map((e) => {
      const root = bytesToHex(StellarSdk.scValToNative(e.topic[1]));
      const amountNative = StellarSdk.scValToNative(e.topic[2]);
      const amount = Number(amountNative) / 10000000;
      const tokenAddress = StellarSdk.scValToNative(e.topic[3]).toString();

      const valArray = StellarSdk.scValToNative(e.value);
      const commitment = bytesToHex(valArray[0]);
      const encryptedNoteHex = bytesToHex(valArray[1]);

      return {
        ledger: e.ledger,
        root,
        amount,
        tokenAddress,
        commitment,
        encryptedNoteHex
      };
    });
    // Attach the latest ledger sequence for incremental scanning references
    events.latestLedger = latestLedger;
    return events;
  } catch (error) {
    console.error("Failed to query pool deposit events:", error.message);
    throw new Error("Failed to query pool deposit events: " + error.message);
  }
}

/**
 * Sends a public Stellar payment (XLM or custom token trustline transfer)
 */
export async function sendPublicPayment(
  senderKeypair,
  recipientAddress,
  amount,
  assetCode,
  assetIssuer
) {
  console.log(`Sending public payment of ${amount} ${assetCode} to ${recipientAddress}...`);
  const senderPublicKey = senderKeypair.publicKey();

  const account = await horizon.loadAccount(senderPublicKey);

  let asset;
  if (assetCode === "XLM") {
    asset = StellarSdk.Asset.native();
  } else {
    asset = new StellarSdk.Asset(assetCode, assetIssuer);
  }

  const tx = new StellarSdk.TransactionBuilder(account, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      StellarSdk.Operation.payment({
        destination: recipientAddress,
        asset: asset,
        amount: amount.toFixed(7),
      })
    )
    .setTimeout(180)
    .build();

  tx.sign(senderKeypair);
  const response = await horizon.submitTransaction(tx);
  console.log(`Public payment sent successfully! Tx Hash: ${response.hash}`);
  return response.hash;
}

/**
 * Builds an unsigned Stellar payment transaction and returns its base64 XDR representation
 */
export async function buildPublicPaymentTxXdr(
  senderPublicKey,
  recipientAddress,
  amount,
  assetCode,
  assetIssuer,
  memoId
) {
  const account = await horizon.loadAccount(senderPublicKey);

  let asset;
  if (assetCode === "XLM") {
    asset = StellarSdk.Asset.native();
  } else {
    asset = new StellarSdk.Asset(assetCode, assetIssuer);
  }

  const txBuilder = new StellarSdk.TransactionBuilder(account, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      StellarSdk.Operation.payment({
        destination: recipientAddress,
        asset: asset,
        amount: amount.toFixed(7),
      })
    )
    .setTimeout(180);

  if (memoId) {
    txBuilder.addMemo(StellarSdk.Memo.id(memoId.toString()));
  }

  const tx = txBuilder.build();
  return tx.toXDR();
}

/**
 * Submits a signed Stellar transaction XDR to the Horizon network
 */
export async function submitSignedXdr(signedXdr) {
  const tx = StellarSdk.TransactionBuilder.fromXDR(signedXdr, NETWORK_PASSPHRASE);
  const response = await horizon.submitTransaction(tx);
  return response.hash;
}
