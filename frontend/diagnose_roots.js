import * as StellarSdk from "@stellar/stellar-sdk";

const RPC_URL = "https://soroban-testnet.stellar.org";
const rpc = new StellarSdk.rpc.Server(RPC_URL);
const contractId = "CDVKQ7H6YX42T26CGRNRBIQ7HRJ73OBYNPUQVKKRWAJNHGNUBRBVNNP7";

async function main() {
  console.log("=== Contract Instance & Storage Diagnostic ===\n");

  // Check the contract instance entry
  const contractAddress = StellarSdk.Address.fromString(contractId);
  
  const instanceKey = StellarSdk.xdr.LedgerKey.contractData(
    new StellarSdk.xdr.LedgerKeyContractData({
      contract: contractAddress.toScAddress(),
      key: StellarSdk.xdr.ScVal.scvLedgerKeyContractInstance(),
      durability: StellarSdk.xdr.ContractDataDurability.persistent()
    })
  );

  try {
    const instanceRes = await rpc.getLedgerEntries(instanceKey);
    if (instanceRes.entries && instanceRes.entries.length > 0) {
      const entry = instanceRes.entries[0];
      console.log("Contract Instance Entry Found:");
      console.log(`  Last Modified Ledger: ${entry.lastModifiedLedgerSeq}`);
      console.log(`  Live Until Ledger: ${entry.liveUntilLedgerSeq}`);
    } else {
      console.log("CONTRACT INSTANCE NOT FOUND — contract may have been archived!");
    }
  } catch (err) {
    console.error("Error checking contract instance:", err.message);
  }

  // Check a specific temporary root entry directly via getLedgerEntries
  const roots = [
    "698f7bbfd0268b384eff2804321e037b75f4aeaf1efa6190d7ac54c96ae20c31",
    "cbb0e914c006c4e13b34ebe1f3837472c6185225cb4dc41a07895843d510d07a",
    "06b4cba7ed65a3549e93a61ae487372da587fe3d23d5eb22e8191d4c7efa71b4"
  ];

  console.log("\n--- Direct Ledger Entry Lookup for Temporary Root Keys ---");
  for (const rootHex of roots) {
    const rootBytes = Buffer.from(rootHex, "hex");
    const keyVal = StellarSdk.xdr.ScVal.scvVec([
      StellarSdk.xdr.ScVal.scvSymbol("MerkleRoot"),
      StellarSdk.xdr.ScVal.scvBytes(rootBytes)
    ]);

    const ledgerKey = StellarSdk.xdr.LedgerKey.contractData(
      new StellarSdk.xdr.LedgerKeyContractData({
        contract: contractAddress.toScAddress(),
        key: keyVal,
        durability: StellarSdk.xdr.ContractDataDurability.temporary()
      })
    );

    try {
      const res = await rpc.getLedgerEntries(ledgerKey);
      if (res.entries && res.entries.length > 0) {
        const entry = res.entries[0];
        console.log(`\nRoot ${rootHex.substring(0, 16)}...:`);
        console.log(`  FOUND in temporary storage`);
        console.log(`  Last Modified Ledger: ${entry.lastModifiedLedgerSeq}`);
        console.log(`  Live Until Ledger: ${entry.liveUntilLedgerSeq}`);
      } else {
        console.log(`\nRoot ${rootHex.substring(0, 16)}...: NOT FOUND in temporary storage`);
      }
    } catch (err) {
      console.error(`Error checking root ${rootHex.substring(0, 16)}:`, err.message);
    }
  }

  // Also check the NextLeafIndex instance data to confirm the contract state
  const nextLeafKey = StellarSdk.xdr.ScVal.scvVec([
    StellarSdk.xdr.ScVal.scvSymbol("NextLeafIndex")
  ]);
  
  const nextLeafLedgerKey = StellarSdk.xdr.LedgerKey.contractData(
    new StellarSdk.xdr.LedgerKeyContractData({
      contract: contractAddress.toScAddress(),
      key: nextLeafKey,
      durability: StellarSdk.xdr.ContractDataDurability.persistent()
    })
  );

  try {
    const nlRes = await rpc.getLedgerEntries(nextLeafLedgerKey);
    if (nlRes.entries && nlRes.entries.length > 0) {
      const val = StellarSdk.xdr.LedgerEntryData.fromXDR(nlRes.entries[0].xdr, "base64");
      console.log("\nNextLeafIndex entry found (contract state exists).");
    } else {
      console.log("\nNextLeafIndex NOT FOUND.");
    }
  } catch (err) {
    console.log("\nNextLeafIndex lookup error:", err.message);
  }

  console.log("\n=== Diagnostic Complete ===");
}

main().catch(console.error);
