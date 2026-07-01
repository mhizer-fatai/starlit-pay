import * as StellarSdk from "@stellar/stellar-sdk";

const RPC_URL = "https://soroban-testnet.stellar.org";
const rpc = new StellarSdk.rpc.Server(RPC_URL);
const contractId = "CDVKQ7H6YX42T26CGRNRBIQ7HRJ73OBYNPUQVKKRWAJNHGNUBRBVNNP7";

async function run() {
  try {
    console.log("Querying all events for contract:", contractId);
    
    // We query starting from ledger 3280000 (around when the deposits occurred)
    const filter = {
      startLedger: 3280000,
      filters: [
        {
          type: "contract",
          contractIds: [contractId]
        }
      ],
      limit: 100
    };

    const response = await rpc.getEvents(filter);
    console.log(`Found ${response.events.length} events:`);
    
    response.events.forEach((e, idx) => {
      console.log(`\n--- Event #${idx + 1} ---`);
      console.log(`Ledger: ${e.ledger}`);
      console.log(`Type: ${e.type}`);
      
      // Parse topics
      const topics = e.topic.map((t, tIdx) => {
        try {
          const val = StellarSdk.scValToNative(t);
          if (val instanceof Uint8Array || Buffer.isBuffer(val)) {
            return `Uint8Array/Buffer(${Buffer.from(val).toString("hex")})`;
          }
          return val.toString();
        } catch (err) {
          return `Unparsable: ${t.toXDR("base64")}`;
        }
      });
      console.log("Topics:", topics);

      // Parse value
      try {
        const val = StellarSdk.scValToNative(e.value);
        if (Array.isArray(val)) {
          const parsedArr = val.map(v => {
            if (v instanceof Uint8Array || Buffer.isBuffer(v)) {
              return Buffer.from(v).toString("hex");
            }
            return v;
          });
          console.log("Value (Parsed Array):", parsedArr);
        } else if (val instanceof Uint8Array || Buffer.isBuffer(val)) {
          console.log("Value (Raw Hex):", Buffer.from(val).toString("hex"));
        } else {
          console.log("Value:", val);
        }
      } catch (err) {
        console.log("Value (Unparsable Raw XDR):", e.value.toXDR("base64"));
      }
    });
    
  } catch (err) {
    console.error("Query failed:", err);
  }
}

run();
